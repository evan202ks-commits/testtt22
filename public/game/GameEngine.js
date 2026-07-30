'use strict';

/**
 * game/GameEngine.js
 * ----------------------------------------------------------------------
 * Chef d'orchestre du mini-jeu : possède la boucle de jeu (update/render),
 * la liste des joueurs présents, et fait le lien entre InputManager,
 * GameNetwork et IsoRenderer. Aucun de ces modules ne se connaît entre
 * eux directement : tout passe par GameEngine, ce qui garde chaque
 * brique indépendante et remplaçable.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.GameEngine = class GameEngine {
  constructor({ canvas, socket, getSessionState, onRosterChange }) {
    this.canvas = canvas;
    this.getSessionState = getSessionState;
    this.onRosterChange = onRosterChange || (() => {});

    this.renderer = new window.Game.IsoRenderer(canvas);
    this.input = new window.Game.InputManager();
    this.network = new window.Game.GameNetwork(socket);

    /** @type {Map<string, InstanceType<typeof window.Game.Player>>} */
    this.players = new Map();

    this.speed = 220; // unités monde / seconde
    this.map = window.Game.Sprites?.IslandMap || null; // carte + collisions
    this.gameTime = 0;

    // Paramètre : bulles de chat au-dessus des personnages. Activé par
    // défaut ; peut être coupé via setChatBubblesEnabled (voir main.js,
    // qui relie ça à une case à cocher persistée en localStorage).
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

    // The game-overlay transitions from display:none to display:flex just
    // before start() is called. The canvas clientWidth/Height may still be 0
    // at this exact tick, so we defer the first resize to the next frame to
    // let the browser finish the layout pass.
    requestAnimationFrame(() => {
      this.renderer.resize();
      // Also centre the camera on the local player right away so the map
      // is not stuck at (0,0) on the first frame.
      const meNow = this.players.get(this.getSessionState()?.myUserId);
      if (meNow) this.renderer.setCamera(meNow.x, meNow.y);
    });

    // On s'annonce immédiatement pour apparaître tout de suite chez les
    // autres, sans attendre le premier mouvement.
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
  }

  _handleResize() {
    this.renderer.resize();
  }

  /** Active/désactive l'affichage des bulles de chat au-dessus des joueurs. */
  setChatBubblesEnabled(enabled) {
    this.chatBubblesEnabled = !!enabled;
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
    this._render();

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
      let nextX = me.x + dir.x * this.speed * dt;
      let nextY = me.y + dir.y * this.speed * dt;
      if (this.map) {
        const clamped = this.map.clampToIsland(nextX, nextY);
        nextX = clamped.x;
        nextY = clamped.y;
      }
      me.x = nextX;
      me.y = nextY;
      me.targetX = me.x;
      me.targetY = me.y;
      this.network.sendPosition(me.x, me.y);
    }
    me.updateAnimation(dt, me.x - prevX, me.y - prevY, this.renderer);

    for (const player of this.players.values()) {
      if (player.isLocal) continue;
      const beforeX = player.x;
      const beforeY = player.y;
      player.interpolate(dt);
      player.updateAnimation(dt, player.x - beforeX, player.y - beforeY, this.renderer);
    }

    this.renderer.setCamera(me.x, me.y);
    this.renderer.setTime(this.gameTime);
  }

  _render() {
    this.renderer.clear();
    if (this.map) {
      this.map.draw(this.renderer);
    } else {
      this.renderer.drawGroundGrid();
    }

    // Tri peintre COMMUN décor + joueurs : tout ce qui est "plus bas"
    // dans le monde (x+y plus grand) se dessine par-dessus, pour qu'un
    // personnage puisse passer devant/derrière un arbre ou une maison.
    const decorEntries = (this.map?.getDecor ? this.map.getDecor() : []).map((d) => ({
      kind: 'decor',
      sortKey: d.x + d.y,
      data: d,
    }));
    const playerEntries = Array.from(this.players.values()).map((p) => ({
      kind: 'player',
      sortKey: p.x + p.y,
      data: p,
    }));

    const scene = decorEntries.concat(playerEntries).sort((a, b) => a.sortKey - b.sortKey);

    for (const entry of scene) {
      if (entry.kind === 'decor') {
        const d = entry.data;
        this.renderer.drawDecor(d.x, d.y, d.type, d.seed, d.scale);
      } else {
        const p = entry.data;
        this.renderer.drawPlayerMarker({
          x: p.x,
          y: p.y,
          color: p.color,
          userId: p.id,
          isMe: p.isLocal,
          label: p.username,
          direction: p.direction,
          moving: p.isMoving,
          animTime: p.animTime,
          hpRatio: 1,
          chatText: this.chatBubblesEnabled ? p.getVisibleChatText() : '',
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // Gestion des joueurs (roster)
  // ------------------------------------------------------------------

  _spawnPosition(seedId) {
    const hash = window.Game.mathUtils.hashString(String(seedId));
    const angle = (hash % 360) * (Math.PI / 180);
    const dist = 60 + (hash % 120);
    const spawn = { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
    return this.map ? this.map.clampToIsland(spawn.x, spawn.y) : spawn;
  }

  _syncLocalPlayer(session) {
    if (this.players.has(session.myUserId)) return;
    const spawn = this._spawnPosition(session.myUserId);
    const me = new window.Game.Player({
      id: session.myUserId,
      username: session.myUsername || 'Moi',
      x: spawn.x,
      y: spawn.y,
      isLocal: true,
    });
    this.players.set(me.id, me);
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
      }
    }
    this.onRosterChange(this.players.size);
  }

  _handlePlayerJoined(user) {
    this._ensurePlayer(user.id, user.username);
  }

  _handlePlayerLeft(userId) {
    this.players.delete(userId);
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
