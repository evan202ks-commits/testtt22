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
 * simplement contraint à l'intérieur d'un rectangle (voir
 * window.Game.mathUtils.clampToRect).
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.GameEngine = class GameEngine {
  constructor({ canvas, socket, getSessionState, onRosterChange, bubbleLayerEl }) {
    this.canvas = canvas;
    this.getSessionState = getSessionState;
    this.onRosterChange = onRosterChange || (() => {});
    this.bubbleLayerEl = bubbleLayerEl || null;

    this.renderer = new window.Game.WorldRenderer(canvas, { bubbleLayerEl });
    this.world = window.Game.WorldBuilder.WORLD;
    this.input = new window.Game.InputManager();
    this.network = new window.Game.GameNetwork(socket);

    /** @type {Map<string, InstanceType<typeof window.Game.Player>>} */
    this.players = new Map();
    this._bubbleEls = new Map();

    this.speed = 165; // unités monde (px) / seconde
    this.gameTime = 0;

    // Paramètre : bulles de chat au-dessus des personnages. Activé par
    // défaut ; peut être coupé via setChatBubblesEnabled (voir main.js).
    this.chatBubblesEnabled = true;

    this._running = false;
    this._rafId = null;
    this._lastFrameAt = 0;

    this._boundResize = this._handleResize.bind(this);
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
    });

    this.input.enable();
    window.addEventListener('resize', this._boundResize);

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
    const prevX = me.x;
    const prevY = me.y;
    if (dir.x !== 0 || dir.y !== 0) {
      const nextX = me.x + dir.x * this.speed * dt;
      const nextY = me.y + dir.y * this.speed * dt;
      const clamped = window.Game.mathUtils.clampToRect(
        nextX, nextY, this.world.halfWidth - 24, this.world.halfHeight - 24
      );
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

    this.renderer.followTarget(me.x, me.y, dt);
    this.renderer.setTime(this.gameTime);
  }

  _render(dt) {
    for (const [id, player] of this.players) {
      this.renderer.ensureAvatar(id, { color: player.color, isLocal: player.isLocal });
      this.renderer.updateAvatar(id, player);
    }
    this._syncBubbles();
    this.renderer.render(dt, this.players);
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
    const dist = tight ? 20 + (hash % 60) : 60 + (hash % 320);
    const raw = {
      x: this.world.spawn.x + Math.cos(angle) * dist,
      y: this.world.spawn.y + Math.sin(angle) * dist,
    };
    return window.Game.mathUtils.clampToRect(
      raw.x, raw.y, this.world.halfWidth - 24, this.world.halfHeight - 24
    );
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
