'use strict';

/**
 * game/GameNetwork.js
 * ----------------------------------------------------------------------
 * Pont entre le mini-jeu et l'infrastructure temps réel EXISTANTE
 * (public/client.js). On ne touche à rien côté serveur ni au client.js :
 * on se contente d'ajouter NOS PROPRES écouteurs sur le `socket` global
 * déjà connecté, et d'utiliser les évènements génériques déjà prévus
 * pour ça (`message:broadcast` avec un `type` dédié "game:*").
 *
 * Comme un canal EventEmitter accepte plusieurs écouteurs pour un même
 * évènement, ajouter socket.on('message:broadcast', ...) ici n'entre pas
 * en conflit avec celui déjà défini dans client.js pour le chat : les
 * deux coexistent et reçoivent chacun tous les messages.
 *
 * Protocole applicatif du jeu (au-dessus de l'enveloppe générique
 * {from, type, data, timestamp} déjà fournie par le serveur) :
 *   - type "game:move" , data: { x, y } -> position d'un joueur dans le
 *     monde 2D (un seul monde, plus de champ "planet" à transporter).
 *   - type "game:equip", data: { equipId } -> objet actuellement tenu en
 *     main par ce joueur (identifiant `equipId` d'un objet du sac, ex.
 *     "peanut_launcher", ou null si mains vides). Diffusé à chaque
 *     changement de sélection de la hotbar (voir game/Inventory.js /
 *     GameEngine.setLocalEquipped), et rediffusé par les joueurs déjà en
 *     salle quand quelqu'un de nouveau arrive, pour que son état actuel
 *     leur soit connu sans transiter par le serveur.
 *   - type "chat"       , data: { text }        -> message de chat (déjà
 *     émis par public/client.js pour alimenter le panneau de chat) ; on
 *     l'écoute ICI EN PLUS, sans rien changer à client.js, pour afficher
 *     le même message dans une bulle au-dessus du personnage concerné.
 *   - type "game:shoot" , data: { x, y, dirX, dirY, shotId } -> un joueur
 *     vient de tirer avec le lance-cacahuète depuis (x,y) dans la
 *     direction normalisée (dirX,dirY). Purement visuel pour tout le
 *     monde SAUF le tireur : c'est LUI (et lui seul) qui détecte les
 *     collisions sur sa propre machine (voir GameEngine._updateProjectiles),
 *     exactement comme chacun est déjà seul autoritaire sur sa propre
 *     position (game:move) ou son propre équipement (game:equip).
 *   - type "game:hit"   , data: { targetId, amount, shotId } -> diffusé
 *     par le tireur quand SA simulation locale détecte qu'un projectile a
 *     touché `targetId`. Seul le joueur concerné (celui dont l'id
 *     correspond à targetId) applique réellement les dégâts à sa propre
 *     barre de vie ; tous les autres l'ignorent.
 * Le roster (qui est dans la salle) réutilise room:users / user:joined /
 * user:left / user:disconnected_temp, déjà diffusés par le serveur.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.GameNetwork = class GameNetwork {
  /**
   * @param {SocketIOClient.Socket} socket instance socket.io déjà connectée
   *   (celle créée par public/client.js — on la réutilise telle quelle).
   */
  constructor(socket) {
    this.socket = socket;
    this._lastSentAt = 0;
    this._minSendIntervalMs = 80; // ~12 envois/s max pendant le mouvement

    this._moveHandler = null;
    this._rosterHandler = null;
    this._joinHandler = null;
    this._leaveHandler = null;
    this._chatHandler = null;
    this._equipHandler = null;
    this._shootHandler = null;
    this._hitHandler = null;

    this._onBroadcast = this._onBroadcast.bind(this);
    this._onRoomUsers = this._onRoomUsers.bind(this);
    this._onUserJoined = this._onUserJoined.bind(this);
    this._onUserLeft = this._onUserLeft.bind(this);
  }

  connectHandlers({ onMove, onRosterSync, onPlayerJoined, onPlayerLeft, onChatMessage, onEquip, onShoot, onHit }) {
    this._moveHandler = onMove;
    this._rosterHandler = onRosterSync;
    this._joinHandler = onPlayerJoined;
    this._leaveHandler = onPlayerLeft;
    this._chatHandler = onChatMessage;
    this._equipHandler = onEquip;
    this._shootHandler = onShoot;
    this._hitHandler = onHit;

    this.socket.on('message:broadcast', this._onBroadcast);
    this.socket.on('room:users', this._onRoomUsers);
    this.socket.on('user:joined', this._onUserJoined);
    this.socket.on('user:reconnected', this._onUserJoined);
    this.socket.on('user:left', this._onUserLeft);
  }

  disconnectHandlers() {
    this.socket.off('message:broadcast', this._onBroadcast);
    this.socket.off('room:users', this._onRoomUsers);
    this.socket.off('user:joined', this._onUserJoined);
    this.socket.off('user:reconnected', this._onUserJoined);
    this.socket.off('user:left', this._onUserLeft);
  }

  _onBroadcast(envelope) {
    if (!envelope?.type || !envelope.data) return;
    if (envelope.type === 'game:move') {
      this._moveHandler?.(envelope.from, envelope.data.x, envelope.data.y);
      return;
    }
    if (envelope.type === 'game:equip') {
      this._equipHandler?.(envelope.from, envelope.data.equipId || null);
      return;
    }
    if (envelope.type === 'game:shoot') {
      this._shootHandler?.(envelope.from, envelope.data);
      return;
    }
    if (envelope.type === 'game:hit') {
      this._hitHandler?.(envelope.data.targetId, envelope.data.amount, envelope.data.shotId);
      return;
    }
    if (envelope.type === 'chat' && typeof envelope.data.text === 'string') {
      this._chatHandler?.(envelope.from, envelope.data.text);
    }
  }

  _onRoomUsers(users) {
    this._rosterHandler?.(users);
  }

  _onUserJoined(user) {
    this._joinHandler?.(user);
  }

  _onUserLeft(user) {
    this._leaveHandler?.(user.id);
  }

  /**
   * Diffuse la position du joueur local à toute la salle. Limité en
   * fréquence côté client (throttle) pour ne pas saturer le réseau ;
   * `force` permet de contourner le throttle (ex: à l'ouverture du jeu,
   * pour que les autres nous voient tout de suite).
   */
  sendPosition(x, y, force = false) {
    const now = Date.now();
    if (!force && now - this._lastSentAt < this._minSendIntervalMs) return;
    this._lastSentAt = now;
    this.socket.emit('message:broadcast', {
      type: 'game:move',
      data: { x: Math.round(x), y: Math.round(y) },
    });
  }

  /**
   * Diffuse l'objet actuellement tenu en main par le joueur local (ou
   * `null` pour "mains vides") à toute la salle. Contrairement à
   * sendPosition, jamais throttlé : un changement de sélection dans la
   * hotbar est un évènement ponctuel, pas un flux continu.
   */
  sendEquip(equipId) {
    this.socket.emit('message:broadcast', {
      type: 'game:equip',
      data: { equipId: equipId || null },
    });
  }

  /**
   * Diffuse un tir de lance-cacahuète depuis (x,y) dans la direction
   * normalisée (dirX,dirY), avec un identifiant unique `shotId` (utile
   * pour un futur suivi côté client, ex. éviter un double traitement).
   * Jamais throttlé : chaque tir est un évènement ponctuel volontaire.
   */
  sendShoot({ x, y, dirX, dirY, shotId }) {
    this.socket.emit('message:broadcast', {
      type: 'game:shoot',
      data: { x: Math.round(x), y: Math.round(y), dirX, dirY, shotId },
    });
  }

  /**
   * Diffuse le résultat d'une collision détectée LOCALEMENT par le
   * tireur (voir GameEngine._updateProjectiles) : "j'ai touché
   * `targetId`". Seul le joueur visé applique réellement les dégâts.
   */
  sendHit({ targetId, amount, shotId }) {
    this.socket.emit('message:broadcast', {
      type: 'game:hit',
      data: { targetId, amount, shotId },
    });
  }
};
