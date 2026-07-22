'use strict';

/**
 * game/GameEngine.js
 * ----------------------------------------------------------------------
 * Chef d'orchestre du mini-jeu : possède la boucle de jeu (update/render),
 * la liste des joueurs présents, et fait le lien entre InputManager,
 * GameNetwork et IsoRenderer. Aucun de ces modules ne se connaît entre
 * eux directement : tout passe par GameEngine, ce qui garde chaque
 * brique indépendante et remplaçable.
 *
 * Points d'extension prévus (sans refonte) :
 *   - remplacer drawPlayerMarker par un sprite animé dans IsoRenderer
 *   - ajouter une carte/collisions en enrichissant `update()`
 *   - ajouter des objets/interactions comme nouvelles entités + types
 *     de messages réseau ("game:interact", "game:pickup"...)
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.GameEngine = class GameEngine {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {SocketIOClient.Socket} opts.socket - socket déjà connecté (réutilisé, non modifié)
   * @param {() => {myUserId: string, myUsername: string, users: Array}} opts.getSessionState
   *   Fonction qui lit l'état courant exposé par client.js (state global),
   *   sans jamais le modifier — juste le consulter.
   * @param {(count: number) => void} [opts.onRosterChange] callback UI (HUD)
   */
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
    this.worldBound = 1600; // limite douce, en attendant une vraie carte

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
    });

    this.input.enable();
    window.addEventListener('resize', this._boundResize);
    this.renderer.resize();

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

  // ------------------------------------------------------------------
  // Boucle de jeu
  // ------------------------------------------------------------------

  _loop(now) {
    if (!this._running) return;
    const dt = Math.min(0.05, (now - this._lastFrameAt) / 1000); // clamp anti gros sauts
    this._lastFrameAt = now;

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
    if (dir.x !== 0 || dir.y !== 0) {
      me.x = window.Game.mathUtils.clamp(me.x + dir.x * this.speed * dt, -this.worldBound, this.worldBound);
      me.y = window.Game.mathUtils.clamp(me.y + dir.y * this.speed * dt, -this.worldBound, this.worldBound);
      me.targetX = me.x;
      me.targetY = me.y;
      this.network.sendPosition(me.x, me.y);
    }

    for (const player of this.players.values()) {
      if (player.isLocal) continue;
      player.interpolate(dt);
    }

    this.renderer.setCamera(me.x, me.y);
  }

  _render() {
    this.renderer.clear();
    this.renderer.drawGroundGrid();

    // Tri peintre : on dessine du fond vers le premier plan pour que les
    // joueurs "plus bas" dans le monde se superposent correctement.
    const sorted = Array.from(this.players.values()).sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const player of sorted) {
      this.renderer.drawPlayerMarker({
        x: player.x,
        y: player.y,
        color: player.color,
        isMe: player.isLocal,
        label: player.username,
      });
    }
  }

  // ------------------------------------------------------------------
  // Gestion des joueurs (roster)
  // ------------------------------------------------------------------

  _spawnPosition(seedId) {
    // Position de départ déterministe mais variée par joueur, pour que
    // tout le monde n'apparaisse pas superposé au centre. Remplaçable
    // plus tard par de vrais points de spawn définis par une carte.
    const hash = window.Game.mathUtils.hashString(String(seedId));
    const angle = (hash % 360) * (Math.PI / 180);
    const dist = 60 + (hash % 120);
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
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

    // Retire les joueurs qui ne sont plus dans la salle (départ détecté
    // via la resynchronisation complète, filet de sécurité en plus de
    // user:left).
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
};
