'use strict';

/**
 * game/GameEngine.js
 * ----------------------------------------------------------------------
 * Chef d'orchestre du mini-jeu : boucle de jeu (update/render), liste des
 * joueurs présents, lien entre InputManager, GameNetwork et le renderer.
 * Aucun de ces modules ne se connaît entre eux directement : tout passe
 * par GameEngine, ce qui garde chaque brique indépendante et remplaçable
 * (c'est ce qui a permis de remplacer tout le rendu 3D par du Canvas 2D
 * sans toucher au réseau, à l'input ni à l'inventaire).
 *
 * Un seul monde désormais (voir game/render/WorldBuilder.js) : plus de
 * planètes, plus de portails à surveiller. Le déplacement du joueur est
 * contraint à l'intérieur de l'île (voir
 * window.Game.WorldBuilder.clampToIsland, qui suit le contour irrégulier
 * de la côte plutôt qu'un simple rectangle).
 *
 * Course : la touche Shift (voir game/InputManager.js) fait passer le
 * joueur de sa vitesse de marche à sa vitesse de course tant qu'elle est
 * maintenue ET qu'une direction est demandée. Aucun nouveau champ réseau
 * n'est nécessaire : Player.updateAnimation déduit la vitesse réelle du
 * déplacement mesuré (dx, dy / dt) pour accélérer l'animation de marche
 * en conséquence, aussi bien pour le joueur local que pour les joueurs
 * distants (dont on ne connaît que les positions successives).
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

// Réglages du tir au lance-cacahuète (voir _tryShoot / _updateProjectiles).
const SHOT_COOLDOWN_MS = 500; // délai minimum entre deux tirs
const PROJECTILE_SPEED = 520; // unités monde (px) / seconde
const PROJECTILE_LIFE = 1.1; // secondes avant disparition (portée effective)
const HIT_RADIUS = 34; // rayon de collision projectile <-> joueur
const HIT_DAMAGE = 34; // dégâts par coup — 3 coups (34*3=102) suffisent à vider 100 PV
const RESPAWN_DELAY_MS = 3000; // délai avant réapparition après K.O.
const INVULNERABLE_MS = 1000; // immunité juste après réapparition

// Décalage du point de tir par rapport au point au sol du joueur (me.x,
// me.y — voir game/Player.js), pour que la cacahuète parte visuellement
// de la main/du pistolet plutôt que des pieds : relevée à hauteur de main
// (voir EQUIP_HAND_Y_FRAC dans WorldRenderer, ~74% de la hauteur du
// personnage depuis le haut) et légèrement avancée dans la direction du
// tir. Cohérent avec CHAR_HEIGHT (88px) défini dans WorldRenderer, sans y
// dépendre directement pour garder les deux modules indépendants.
const MUZZLE_HEIGHT_OFFSET = 46; // hauteur main/arme au-dessus du point au sol
const MUZZLE_FORWARD_OFFSET = 18; // avancée vers l'avant dans la direction visée

window.Game.GameEngine = class GameEngine {
  constructor({ canvas, socket, getSessionState, onRosterChange, onHealthChange, onDeathChange, bubbleLayerEl }) {
    this.canvas = canvas;
    this.getSessionState = getSessionState;
    this.onRosterChange = onRosterChange || (() => {});
    // Appelé à chaque frame avec (health, maxHealth) du joueur local, pour
    // que main.js puisse tenir à jour la barre de vie au-dessus de la
    // hotbar (voir index.html #healthBar).
    this.onHealthChange = onHealthChange || (() => {});
    // Appelé avec (true) quand le joueur local tombe à 0 PV, puis (false)
    // à sa réapparition — voir index.html #koOverlay.
    this.onDeathChange = onDeathChange || (() => {});
    this.bubbleLayerEl = bubbleLayerEl || null;

    this.renderer = new window.Game.WorldRenderer(canvas, { bubbleLayerEl });
    this.world = window.Game.WorldBuilder.WORLD;
    this.input = new window.Game.InputManager();
    this.network = new window.Game.GameNetwork(socket);

    /** @type {Map<string, InstanceType<typeof window.Game.Player>>} */
    this.players = new Map();
    this._bubbleEls = new Map();

    this.speedWalk = 165; // unités monde (px) / seconde, marche
    this.speedRun = 300; // unités monde (px) / seconde, course (Shift)
    this.gameTime = 0;

    // Objet actuellement tenu en main par le joueur local (voir
    // setLocalEquipped), rappliqué au Player local dès sa création et
    // rediffusé aux nouveaux arrivants (voir _handlePlayerJoined).
    this._localEquipId = null;

    // Paramètre : bulles de chat au-dessus des personnages. Activé par
    // défaut ; peut être coupé via setChatBubblesEnabled (voir main.js).
    this.chatBubblesEnabled = true;

    // ------------------------------------------------------------------
    // Tir au lance-cacahuète : liste des projectiles actifs (tirés par
    // soi ou par les autres, voir _spawnProjectile), position souris
    // (coordonnées écran, converties en monde au moment du tir via
    // renderer.screenToWorld), et état K.O./réapparition du joueur local.
    // ------------------------------------------------------------------
    this.projectiles = [];
    this._mouseScreen = { x: 0, y: 0 };
    this._shotCooldownUntil = 0;
    this._nextShotId = 1;
    this._dead = false;
    this._respawnAt = 0;
    this._invulnerableUntil = 0;

    this._running = false;
    this._rafId = null;
    this._lastFrameAt = 0;

    this._boundResize = this._handleResize.bind(this);
    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundMouseDown = this._onMouseDown.bind(this);
    this._loop = this._loop.bind(this);
  }

  // ------------------------------------------------------------------
  // Cycle de vie
  // ------------------------------------------------------------------

  start() {
    if (this._running) return;
    const session = this.getSessionState();
    if (!session?.myUserId) return;

    this._running = true;

    this._syncLocalPlayer(session);
    this._seedRosterFromSession(session);

    this.network.connectHandlers({
      onMove: (userId, x, y) => this._handleRemoteMove(userId, x, y),
      onRosterSync: (users) => this._handleRosterSync(users),
      onPlayerJoined: (user) => this._handlePlayerJoined(user),
      onPlayerLeft: (userId) => this._handlePlayerLeft(userId),
      onChatMessage: (userId, text) => this._handleChatMessage(userId, text),
      onEquip: (userId, equipId) => this._handleRemoteEquip(userId, equipId),
      onShoot: (userId, data) => this._handleRemoteShoot(userId, data),
      onHit: (targetId, amount, shotId) => this._handleRemoteHit(targetId, amount, shotId),
    });

    this.input.enable();
    window.addEventListener('resize', this._boundResize);
    this.canvas.addEventListener('mousemove', this._boundMouseMove);
    this.canvas.addEventListener('mousedown', this._boundMouseDown);

    // Le canvas passe de display:none à display:flex juste avant start() ;
    // sa taille peut être 0 le temps d'un tick. On repousse le premier
    // resize à la frame suivante pour laisser le navigateur finir la mise
    // en page.
    requestAnimationFrame(() => {
      this.renderer.resize();
    });

    const me = this.players.get(session.myUserId);
    if (me) this.network.sendPosition(me.x, me.y, true);

    this._lastFrameAt = performance.now();
    this._rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    if (!this._running) return;
    this._running = false;
    cancelAnimationFrame(this._rafId);
    this.network.disconnectHandlers();
    this.input.disable();
    window.removeEventListener('resize', this._boundResize);
    this.canvas.removeEventListener('mousemove', this._boundMouseMove);
    this.canvas.removeEventListener('mousedown', this._boundMouseDown);

    for (const id of this.players.keys()) this.renderer.removeAvatar(id);
    this._clearBubbles();

    this.projectiles = [];
    this._dead = false;
    this.onDeathChange(false);
  }

  _handleResize() {
    this.renderer.resize();
  }

  /** Active/désactive l'affichage des bulles de chat au-dessus des joueurs. */
  setChatBubblesEnabled(enabled) {
    this.chatBubblesEnabled = !!enabled;
    if (!this.chatBubblesEnabled) this._clearBubbles();
  }

  /**
   * Objet tenu en main par le joueur local (voir game/Inventory.js,
   * callback `onSelectionChange`, branché depuis game/main.js). Met à
   * jour l'affichage local tout de suite et diffuse le changement au
   * reste de la salle (voir GameNetwork.sendEquip / protocole
   * "game:equip"), pour que les autres joueurs le voient aussi.
   */
  setLocalEquipped(equipId) {
    this._localEquipId = equipId || null;
    const session = this.getSessionState();
    const me = session?.myUserId ? this.players.get(session.myUserId) : null;
    if (me) me.setEquipped(this._localEquipId);
    if (this._running) this.network.sendEquip(this._localEquipId);
  }

  /**
   * Points de vie du joueur local (voir game/Player.js : setHealth/damage/
   * heal). Purement local pour l'instant — aucun message réseau dédié —
   * mais suffisant pour piloter la barre de vie de la hotbar dès qu'une
   * mécanique de jeu voudra l'utiliser.
   */
  getLocalPlayer() {
    const session = this.getSessionState();
    return session?.myUserId ? this.players.get(session.myUserId) : null;
  }

  setLocalHealth(value) {
    this.getLocalPlayer()?.setHealth(value);
  }

  damageLocal(amount) {
    this.getLocalPlayer()?.damage(amount);
  }

  healLocal(amount) {
    this.getLocalPlayer()?.heal(amount);
  }

  // ------------------------------------------------------------------
  // Tir au lance-cacahuète
  // ------------------------------------------------------------------

  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    this._mouseScreen.x = e.clientX - rect.left;
    this._mouseScreen.y = e.clientY - rect.top;
  }

  _onMouseDown(e) {
    if (e.button !== 0) return; // clic gauche uniquement
    this._tryShoot();
  }

  /**
   * Tente un tir vers la position actuelle de la souris (convertie en
   * coordonnées monde via la caméra du renderer). Ignoré si l'objet
   * équipé n'est pas le lance-cacahuète, si le K.O. est en cours, ou si
   * la cadence de tir (SHOT_COOLDOWN_MS) n'est pas encore écoulée.
   */
  _tryShoot() {
    if (this._localEquipId !== 'peanut_launcher') return;
    if (this._dead) return;

    const now = performance.now();
    if (now < this._shotCooldownUntil) return;

    const session = this.getSessionState();
    const me = session?.myUserId ? this.players.get(session.myUserId) : null;
    if (!me) return;

    this._shotCooldownUntil = now + SHOT_COOLDOWN_MS;

    const worldMouse = this.renderer.screenToWorld(this._mouseScreen.x, this._mouseScreen.y);
    let dirX = worldMouse.x - me.x;
    let dirY = worldMouse.y - me.y;
    const dist = Math.hypot(dirX, dirY) || 1;
    dirX /= dist;
    dirY /= dist;

    // Point de départ décalé vers la main tenant le lance-cacahuète (voir
    // MUZZLE_HEIGHT_OFFSET / MUZZLE_FORWARD_OFFSET) plutôt que le point au
    // sol du personnage — sinon la cacahuète semblait sortir des pieds.
    const originX = me.x + dirX * MUZZLE_FORWARD_OFFSET;
    const originY = me.y - MUZZLE_HEIGHT_OFFSET + dirY * MUZZLE_FORWARD_OFFSET;

    const shotId = `${session.myUserId}:${this._nextShotId++}`;
    this._spawnProjectile({ id: shotId, ownerId: session.myUserId, x: originX, y: originY, dirX, dirY });
    this.network.sendShoot({ x: originX, y: originY, dirX, dirY, shotId });
  }

  _spawnProjectile({ id, ownerId, x, y, dirX, dirY }) {
    this.projectiles.push({ id, ownerId, x, y, dirX, dirY, age: 0 });
  }

  /**
   * Fait avancer tous les projectiles actifs et gère leur disparition
   * (portée max atteinte). Seul le tireur (ownerId === joueur local)
   * détecte les collisions avec les autres joueurs : chacun reste
   * autoritaire sur ce que SES PROPRES tirs touchent, exactement comme
   * chacun est déjà seul autoritaire sur sa propre position/équipement.
   */
  _updateProjectiles(dt) {
    if (!this.projectiles.length) return;
    const session = this.getSessionState();
    const myId = session?.myUserId;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.dirX * PROJECTILE_SPEED * dt;
      p.y += p.dirY * PROJECTILE_SPEED * dt;
      p.age += dt;

      let remove = p.age >= PROJECTILE_LIFE;

      if (!remove && p.ownerId === myId) {
        for (const [id, player] of this.players) {
          if (id === p.ownerId) continue;
          const dist = Math.hypot(player.x - p.x, player.y - p.y);
          if (dist <= HIT_RADIUS) {
            this.network.sendHit({ targetId: id, amount: HIT_DAMAGE, shotId: p.id });
            remove = true;
            break;
          }
        }
      }

      if (remove) this.projectiles.splice(i, 1);
    }
  }

  /**
   * Un tireur (soi-même ou un autre joueur) vient d'annoncer un tir. On
   * ignore nos propres tirs (déjà simulés localement dès l'émission, voir
   * _tryShoot) — même logique que _handleRemoteMove pour game:move.
   */
  _handleRemoteShoot(userId, data) {
    const session = this.getSessionState();
    if (userId === session?.myUserId) return;
    this._spawnProjectile({
      id: data.shotId, ownerId: userId, x: data.x, y: data.y, dirX: data.dirX, dirY: data.dirY,
    });
  }

  /**
   * Un tireur annonce que SA simulation locale a détecté un coup sur
   * `targetId`. On ignore tout ce qui ne nous concerne pas : seule la
   * victime applique réellement les dégâts à sa propre barre de vie.
   */
  _handleRemoteHit(targetId, amount) {
    const session = this.getSessionState();
    if (targetId !== session?.myUserId) return;
    if (this._dead) return;
    if (performance.now() < this._invulnerableUntil) return;

    const me = this.players.get(targetId);
    if (!me) return;

    me.damage(amount);
    this.renderer.triggerDamageFlash();

    if (me.health <= 0) this._enterDead();
  }

  _enterDead() {
    this._dead = true;
    this._respawnAt = performance.now() + RESPAWN_DELAY_MS;
    this.onDeathChange(true);
  }

  _respawn(me) {
    const spawn = this._spawnPosition(me.id, true);
    me.x = spawn.x;
    me.y = spawn.y;
    me.targetX = spawn.x;
    me.targetY = spawn.y;
    me.setHealth(me.maxHealth);
    this._dead = false;
    this._invulnerableUntil = performance.now() + INVULNERABLE_MS;
    this.network.sendPosition(me.x, me.y, true);
    this.onDeathChange(false);
  }

  // ------------------------------------------------------------------
  // Boucle de jeu
  // ------------------------------------------------------------------

  _loop(now) {
    if (!this._running) return;
    const dt = Math.min(0.05, (now - this._lastFrameAt) / 1000); // clamp anti gros sauts
    this._lastFrameAt = now;
    this.gameTime += dt;

    this._update(dt);
    this._render(dt);

    this._rafId = requestAnimationFrame(this._loop);
  }

  _update(dt) {
    const session = this.getSessionState();
    if (!session?.myUserId) return;
    const me = this.players.get(session.myUserId);
    if (!me) return;

    // K.O. en cours : on gèle les entrées/tirs du joueur local (mais le
    // reste du monde — autres joueurs, projectiles en vol — continue de
    // vivre normalement) jusqu'à l'écoulement du délai de réapparition.
    if (this._dead) {
      if (performance.now() >= this._respawnAt) {
        this._respawn(me);
      } else {
        me.updateAnimation(dt, 0, 0);
        for (const player of this.players.values()) {
          if (player.isLocal) continue;
          const beforeX = player.x;
          const beforeY = player.y;
          player.interpolate(dt);
          player.updateAnimation(dt, player.x - beforeX, player.y - beforeY);
        }
        this._updateProjectiles(dt);
        this.renderer.followTarget(me.x, me.y, dt);
        this.renderer.setTime(this.gameTime);
        this.onHealthChange(me.health, me.maxHealth);
        return;
      }
    }

    const dir = this.input.getDirection();
    const holdingMove = dir.x !== 0 || dir.y !== 0;
    const prevX = me.x;
    const prevY = me.y;

    if (holdingMove) {
      const running = this.input.isRunning();
      const speed = running ? this.speedRun : this.speedWalk;
      const nextX = me.x + dir.x * speed * dt;
      const nextY = me.y + dir.y * speed * dt;
      // resolvePlayerMove contraint à la fois au contour de l'île ET aux
      // montagnes (couronne rocheuse infranchissable).
      const clamped = window.Game.WorldBuilder.resolvePlayerMove(me.x, me.y, nextX, nextY, 24);
      me.x = clamped.x;
      me.y = clamped.y;
      me.targetX = me.x;
      me.targetY = me.y;
      this.network.sendPosition(me.x, me.y);
    }

    me.updateAnimation(dt, me.x - prevX, me.y - prevY);

    for (const player of this.players.values()) {
      if (player.isLocal) continue;
      const beforeX = player.x;
      const beforeY = player.y;
      player.interpolate(dt);
      player.updateAnimation(dt, player.x - beforeX, player.y - beforeY);
    }

    this._updateProjectiles(dt);

    this.renderer.followTarget(me.x, me.y, dt);
    this.renderer.setTime(this.gameTime);

    this.onHealthChange(me.health, me.maxHealth);
  }

  _render(dt) {
    for (const [id, player] of this.players) {
      this.renderer.ensureAvatar(id, { color: player.color, isLocal: player.isLocal });
      this.renderer.updateAvatar(id, player);
    }
    this._syncBubbles();
    this.renderer.render(dt, this.players, this.projectiles);
  }

  // ------------------------------------------------------------------
  // Bulles de chat (overlay HTML par-dessus le canvas 2D, positionné via
  // renderer.projectToScreen — même déclencheur que dans Player.js :
  // player.getVisibleChatText()).
  // ------------------------------------------------------------------

  _syncBubbles() {
    if (!this.bubbleLayerEl) return;
    const seen = new Set();

    for (const [id, player] of this.players) {
      const text = this.chatBubblesEnabled ? player.getVisibleChatText() : '';
      if (!text) continue;
      seen.add(id);

      let el = this._bubbleEls.get(id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'world-bubble';
        this.bubbleLayerEl.appendChild(el);
        this._bubbleEls.set(id, el);
      }
      if (el.dataset.text !== text) {
        el.textContent = text;
        el.dataset.text = text;
      }

      const proj = this.renderer.projectToScreen(player.x, player.y, 100);
      el.style.display = '';
      el.style.transform = `translate(${proj.x}px, ${proj.y}px) translate(-50%, -100%)`;
    }

    for (const [id, el] of this._bubbleEls) {
      if (!seen.has(id)) {
        el.remove();
        this._bubbleEls.delete(id);
      }
    }
  }

  _clearBubbles() {
    for (const el of this._bubbleEls.values()) el.remove();
    this._bubbleEls.clear();
  }

  // ------------------------------------------------------------------
  // Gestion des joueurs (roster)
  // ------------------------------------------------------------------

  _spawnPosition(seedId, tight = false) {
    const hash = window.Game.mathUtils.hashString(String(seedId));
    const angle = (hash % 360) * (Math.PI / 180);
    const dist = tight ? 16 + (hash % 45) : 30 + (hash % 80);
    const raw = {
      x: this.world.spawn.x + Math.cos(angle) * dist,
      y: this.world.spawn.y + Math.sin(angle) * dist,
    };
    return window.Game.WorldBuilder.clampToIsland(raw.x, raw.y, 24);
  }

  _syncLocalPlayer(session) {
    if (this.players.has(session.myUserId)) return;
    const spawn = this._spawnPosition(session.myUserId, true);
    const me = new window.Game.Player({
      id: session.myUserId,
      username: session.myUsername || 'Moi',
      x: spawn.x,
      y: spawn.y,
      isLocal: true,
    });
    me.setEquipped(this._localEquipId);
    this.players.set(me.id, me);
    this.renderer.ensureAvatar(me.id, { color: me.color, isLocal: true });
  }

  _seedRosterFromSession(session) {
    (session.users || []).forEach((u) => this._ensurePlayer(u.id, u.username));
    this.onRosterChange(this.players.size);
  }

  _ensurePlayer(id, username) {
    if (this.players.has(id)) return this.players.get(id);
    const spawn = this._spawnPosition(id);
    const player = new window.Game.Player({ id, username, x: spawn.x, y: spawn.y, isLocal: false });
    this.players.set(id, player);
    this.renderer.ensureAvatar(id, { color: player.color, isLocal: false });
    this.onRosterChange(this.players.size);
    return player;
  }

  _handleRemoteMove(userId, x, y) {
    const session = this.getSessionState();
    if (userId === session?.myUserId) return; // io.to() renvoie aussi à l'émetteur : on s'ignore soi-même
    const player = this._ensurePlayer(userId);
    player.setTarget(x, y);
  }

  _handleRosterSync(users) {
    const session = this.getSessionState();
    const incomingIds = new Set(users.map((u) => u.id));

    users.forEach((u) => {
      const player = this._ensurePlayer(u.id, u.username);
      player.username = u.username; // pseudo à jour si changé
    });

    for (const id of Array.from(this.players.keys())) {
      if (id !== session?.myUserId && !incomingIds.has(id)) {
        this.players.delete(id);
        this.renderer.removeAvatar(id);
      }
    }
    this.onRosterChange(this.players.size);
  }

  _handlePlayerJoined(user) {
    this._ensurePlayer(user.id, user.username);
    // Le nouvel arrivant ne peut pas deviner ce qu'on tient déjà en main
    // (le protocole "game:equip" n'est diffusé qu'aux changements) : on
    // rediffuse notre état courant pour qu'il le reçoive tout de suite.
    if (this._running) this.network.sendEquip(this._localEquipId);
  }

  _handlePlayerLeft(userId) {
    this.players.delete(userId);
    this.renderer.removeAvatar(userId);
    this.onRosterChange(this.players.size);
  }

  /**
   * Un autre joueur vient de changer (ou d'annoncer) l'objet qu'il tient
   * en main (voir GameNetwork "game:equip"). Ignoré pour soi-même : io.to()
   * renvoie aussi à l'émetteur, et notre propre état est déjà à jour
   * localement (voir setLocalEquipped).
   */
  _handleRemoteEquip(userId, equipId) {
    const session = this.getSessionState();
    if (userId === session?.myUserId) return;
    const player = this._ensurePlayer(userId);
    player.setEquipped(equipId);
  }

  /**
   * Un message de chat vient d'être reçu (venant de soi ou d'un autre
   * joueur — le serveur renvoie aussi à l'émetteur, voir GameNetwork).
   * On l'attache au joueur correspondant pour affichage en bulle.
   */
  _handleChatMessage(userId, text) {
    const player = this._ensurePlayer(userId);
    player.showChatBubble(text);
  }
};
