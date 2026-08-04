'use strict';

/**
 * game/GameEngine.js
 * ----------------------------------------------------------------------
 * Chef d'orchestre du mini-jeu : boucle de jeu (update/render), liste des
 * joueurs présents, lien entre InputManager, GameNetwork et le renderer.
 * Aucun de ces modules ne se connaît entre eux directement : tout passe
 * par GameEngine, ce qui garde chaque brique indépendante et remplaçable.
 *
 * Zones (village + biomes nature, voir game/render/WorldBuilder.js),
 * reliées par des chemins/arches (portails). Le changement de zone est
 * géré ICI (détection de proximité + bascule de décor/lumière côté
 * renderer) et voyage dans le protocole réseau EXISTANT en ajoutant un
 * champ `zone` + `running` au payload générique {x, y} déjà utilisé
 * (voir game/GameNetwork.js) — le serveur ne les valide pas, il relaie
 * tel quel, donc aucune modification serveur.
 *
 * start() est asynchrone : il attend que la couche graphique modulaire
 * (voir game/render/AssetManifest.js) ait fini de charger ses manifestes
 * JSON avant de démarrer la boucle — un aller-retour réseau minime
 * (petits fichiers, même origine), pas un vrai temps de chargement.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

const PORTAL_TRIGGER_RADIUS = 11;
const TRAVEL_COOLDOWN_S = 1.1;

window.Game.GameEngine = class GameEngine {
  constructor({ canvas, socket, getSessionState, onRosterChange, bubbleLayerEl, bannerEl }) {
    this.canvas = canvas;
    this.getSessionState = getSessionState;
    this.onRosterChange = onRosterChange || (() => {});
    this.bubbleLayerEl = bubbleLayerEl || null;

    this.renderer = new window.Game.WorldRenderer(canvas, { bubbleLayerEl, bannerEl });
    this.input = new window.Game.InputManager();
    this.network = new window.Game.GameNetwork(socket);

    /** @type {Map<string, InstanceType<typeof window.Game.Player>>} */
    this.players = new Map();
    this._bubbleEls = new Map();

    this.walkSpeed = 100; // unités monde / seconde (ralenti par rapport à la version précédente)
    this.runSpeed = 165;
    this.gameTime = 0;

    this.currentZoneId = 'village';
    this._activeZoneConfig = null;
    this.activePortals = [];
    this._travelCooldown = 0;

    // Paramètre : bulles de chat au-dessus des personnages. Activé par
    // défaut ; peut être coupé via setChatBubblesEnabled (voir main.js).
    this.chatBubblesEnabled = true;

    this._running = false;
    this._starting = false;
    this._rafId = null;
    this._lastFrameAt = 0;

    this._boundResize = this._handleResize.bind(this);
    this._loop = this._loop.bind(this);
  }

  // ------------------------------------------------------------------
  // Cycle de vie
  // ------------------------------------------------------------------

  async start() {
    if (this._running || this._starting) return;
    const session = this.getSessionState();
    if (!session?.myUserId) return;

    this._starting = true;
    await this.renderer.ready;
    if (!this._starting) return; // stop() appelé pendant le chargement des assets
    this._starting = false;
    this._running = true;

    const { zone, portalMeshes } = this.renderer.setActiveZone('village');
    this.currentZoneId = 'village';
    this._activeZoneConfig = zone;
    this.activePortals = portalMeshes;
    this._travelCooldown = 0;

    this._syncLocalPlayer(session, zone);
    this._seedRosterFromSession(session);

    this.network.connectHandlers({
      onMove: (userId, x, y, zoneId, running) => this._handleRemoteMove(userId, x, y, zoneId, running),
      onRosterSync: (users) => this._handleRosterSync(users),
      onPlayerJoined: (user) => this._handlePlayerJoined(user),
      onPlayerLeft: (userId) => this._handlePlayerLeft(userId),
      onChatMessage: (userId, text) => this._handleChatMessage(userId, text),
    });

    this.input.enable();
    window.addEventListener('resize', this._boundResize);

    // Le canvas passe de display:none à display:flex juste avant start() ;
    // sa taille peut être 0 le temps d'un tick. On repousse le premier
    // resize à la frame suivante pour laisser le navigateur finir la mise
    // en page (même filet de sécurité que l'ancien renderer).
    requestAnimationFrame(() => {
      this.renderer.resize();
    });

    const me = this.players.get(session.myUserId);
    if (me) this.network.sendPosition(me.x, me.y, this.currentZoneId, false, true);

    this._lastFrameAt = performance.now();
    this._rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    this._starting = false; // annule un start() en cours d'attente d'assets
    if (!this._running) return;
    this._running = false;
    cancelAnimationFrame(this._rafId);
    this.network.disconnectHandlers();
    this.input.disable();
    window.removeEventListener('resize', this._boundResize);

    for (const id of this.players.keys()) this.renderer.removeAvatar(id);
    this._clearBubbles();
  }

  _handleResize() {
    this.renderer.resize();
  }

  /** Active/désactive l'affichage des bulles de chat au-dessus des joueurs. */
  setChatBubblesEnabled(enabled) {
    this.chatBubblesEnabled = !!enabled;
    if (!this.chatBubblesEnabled) this._clearBubbles();
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

    const dir = this.input.getDirection();
    const running = this.input.isRunning();
    const speed = running ? this.runSpeed : this.walkSpeed;
    const prevX = me.x;
    const prevY = me.y;
    if (dir.x !== 0 || dir.y !== 0) {
      let nextX = me.x + dir.x * speed * dt;
      let nextY = me.y + dir.y * speed * dt;
      if (this._activeZoneConfig) {
        const clamped = window.Game.mathUtils.clampToDisc(nextX, nextY, this._activeZoneConfig.radius * 0.96);
        nextX = clamped.x;
        nextY = clamped.y;
      }
      me.x = nextX;
      me.y = nextY;
      me.targetX = me.x;
      me.targetY = me.y;
      this.network.sendPosition(me.x, me.y, this.currentZoneId, running);
    }
    me.updateAnimation(dt, me.x - prevX, me.y - prevY, running);

    for (const player of this.players.values()) {
      if (player.isLocal) continue;
      const beforeX = player.x;
      const beforeY = player.y;
      player.interpolate(dt);
      player.updateAnimation(dt, player.x - beforeX, player.y - beforeY, player.isRunning);
    }

    this.renderer.followTarget(me.x, me.y, dt);
    this.renderer.setTime(this.gameTime);

    if (this._travelCooldown > 0) {
      this._travelCooldown = Math.max(0, this._travelCooldown - dt);
    } else {
      this._checkPortals(me);
    }
  }

  _checkPortals(me) {
    for (const portal of this.activePortals) {
      const dx = me.x - portal.worldX;
      const dy = me.y - portal.worldY;
      if (dx * dx + dy * dy <= PORTAL_TRIGGER_RADIUS * PORTAL_TRIGGER_RADIUS) {
        this._travelTo(portal.to);
        return;
      }
    }
  }

  _travelTo(zoneId) {
    const session = this.getSessionState();
    if (!session?.myUserId) return;
    const me = this.players.get(session.myUserId);
    if (!me) return;

    const { zone, portalMeshes } = this.renderer.setActiveZone(zoneId);
    this.currentZoneId = zoneId;
    this._activeZoneConfig = zone;
    this.activePortals = portalMeshes;
    this._travelCooldown = TRAVEL_COOLDOWN_S;

    const spawn = this._spawnPosition(session.myUserId, zone, true);
    me.x = spawn.x;
    me.y = spawn.y;
    me.targetX = spawn.x;
    me.targetY = spawn.y;
    me.zone = zoneId;

    this.network.sendPosition(me.x, me.y, zoneId, false, true);
    this._clearBubbles();
  }

  _render(dt) {
    for (const [id, player] of this.players) {
      this.renderer.ensureAvatar(id, { color: player.color, isLocal: player.isLocal });
      this.renderer.updateAvatar(id, player, dt);
      this.renderer.setAvatarVisible(id, player.zone === this.currentZoneId);
    }
    this._syncBubbles();
    this.renderer.render(dt);
  }

  // ------------------------------------------------------------------
  // Bulles de chat (overlay HTML par-dessus le canvas 3D — même
  // déclencheur : player.getVisibleChatText(), voir game/Player.js).
  // ------------------------------------------------------------------

  _syncBubbles() {
    if (!this.bubbleLayerEl) return;
    const seen = new Set();

    for (const [id, player] of this.players) {
      if (player.zone !== this.currentZoneId) continue;
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

      const proj = this.renderer.projectToScreen(player.x, player.y);
      if (!proj.visible) {
        el.style.display = 'none';
      } else {
        el.style.display = '';
        el.style.transform = `translate(${proj.x}px, ${proj.y}px) translate(-50%, -100%)`;
      }
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

  _spawnPosition(seedId, zone, tight = false) {
    const hash = window.Game.mathUtils.hashString(String(seedId));
    const angle = (hash % 360) * (Math.PI / 180);
    const dist = tight ? 8 + (hash % 18) : 40 + (hash % Math.min(140, zone.radius * 0.55));
    const raw = {
      x: zone.spawn.x + Math.cos(angle) * dist,
      y: zone.spawn.y + Math.sin(angle) * dist,
    };
    return window.Game.mathUtils.clampToDisc(raw.x, raw.y, zone.radius * 0.9);
  }

  _syncLocalPlayer(session, zone) {
    if (this.players.has(session.myUserId)) return;
    const spawn = this._spawnPosition(session.myUserId, zone);
    const me = new window.Game.Player({
      id: session.myUserId,
      username: session.myUsername || 'Moi',
      x: spawn.x,
      y: spawn.y,
      isLocal: true,
    });
    me.zone = this.currentZoneId;
    this.players.set(me.id, me);
    this.renderer.ensureAvatar(me.id, { color: me.color, isLocal: true });
  }

  _seedRosterFromSession(session) {
    (session.users || []).forEach((u) => this._ensurePlayer(u.id, u.username));
    this.onRosterChange(this.players.size);
  }

  _ensurePlayer(id, username) {
    if (this.players.has(id)) return this.players.get(id);
    const zone = this._activeZoneConfig || { spawn: { x: 0, y: 0 }, radius: 200 };
    const spawn = this._spawnPosition(id, zone);
    const player = new window.Game.Player({ id, username, x: spawn.x, y: spawn.y, isLocal: false });
    // Tout le monde démarre sa session sur 'village' (voir start()) :
    // c'est l'hypothèse par défaut la plus fiable tant qu'on n'a pas
    // encore reçu sa vraie position réseau (qui, elle, porte la bonne zone).
    player.zone = 'village';
    this.players.set(id, player);
    this.renderer.ensureAvatar(id, { color: player.color, isLocal: false });
    this.onRosterChange(this.players.size);
    return player;
  }

  _handleRemoteMove(userId, x, y, zoneId, running) {
    const session = this.getSessionState();
    if (userId === session?.myUserId) return; // io.to() renvoie aussi à l'émetteur : on s'ignore soi-même
    const player = this._ensurePlayer(userId);
    player.setTarget(x, y);
    if (zoneId) player.zone = zoneId;
    player.isRunning = !!running;
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
  }

  _handlePlayerLeft(userId) {
    this.players.delete(userId);
    this.renderer.removeAvatar(userId);
    this.onRosterChange(this.players.size);
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
