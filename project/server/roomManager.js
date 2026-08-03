'use strict';

/**
 * roomManager.js
 * ----------------------------------------------------------------------
 * Gère l'état applicatif : salles, utilisateurs, identifiants persistants,
 * et la logique de grâce en cas de déconnexion temporaire (reconnexion).
 *
 * Ce module ne connaît rien de Socket.IO : il ne fait que manipuler des
 * structures de données en mémoire. Toute la "tuyauterie" réseau vit dans
 * server/index.js. Cette séparation facilite les tests et l'évolution
 * future (ex: remplacer le stockage en mémoire par Redis pour du multi-
 * instance, sans toucher au protocole).
 * ----------------------------------------------------------------------
 */

const crypto = require('crypto');

// Combien de temps on garde la place d'un utilisateur après une coupure
// réseau avant de considérer qu'il a réellement quitté la salle.
const RECONNECT_GRACE_MS = 25_000;

// Alphabet volontairement sans caractères ambigus (0/O, 1/I/l...)
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} code de salle -> salle */
    this.rooms = new Map();
    /** @type {Map<string, {roomCode: string, timeout: NodeJS.Timeout}>} */
    this.pendingRemovals = new Map();
  }

  // ------------------------------------------------------------------
  // Identifiants
  // ------------------------------------------------------------------

  generateUserId() {
    return `usr_${crypto.randomUUID()}`;
  }

  generateRoomCode() {
    let code;
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () =>
        ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)]
      ).join('');
    } while (this.rooms.has(code));
    return code;
  }

  // ------------------------------------------------------------------
  // Salles
  // ------------------------------------------------------------------

  createRoom(hostUser) {
    const code = this.generateRoomCode();
    const room = {
      code,
      createdAt: Date.now(),
      users: new Map(), // userId -> user
    };
    this.rooms.set(code, room);
    this.addUserToRoom(code, hostUser);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code?.toUpperCase());
  }

  roomExists(code) {
    return this.rooms.has(code?.toUpperCase());
  }

  addUserToRoom(code, user) {
    const room = this.getRoom(code);
    if (!room) return null;
    room.users.set(user.id, user);
    return room;
  }

  removeUserFromRoom(code, userId) {
    const room = this.getRoom(code);
    if (!room) return;
    room.users.delete(userId);
    // On supprime la salle si elle est vide, pour ne pas fuir la mémoire.
    if (room.users.size === 0) {
      this.rooms.delete(code);
    }
  }

  getUsersList(code) {
    const room = this.getRoom(code);
    if (!room) return [];
    return Array.from(room.users.values()).map((u) => ({
      id: u.id,
      username: u.username,
      connected: u.connected,
      ping: u.ping,
      joinedAt: u.joinedAt,
    }));
  }

  findUserInRoom(code, userId) {
    const room = this.getRoom(code);
    return room?.users.get(userId) || null;
  }

  // ------------------------------------------------------------------
  // Gestion de la grâce de reconnexion
  // ------------------------------------------------------------------

  /**
   * À appeler quand un socket se déconnecte. On ne retire pas
   * immédiatement l'utilisateur : on lui laisse une fenêtre de temps
   * pour revenir (coupure Wi-Fi, changement de réseau, veille mobile...).
   */
  scheduleRemoval(roomCode, userId, onExpire) {
    this.cancelPendingRemoval(userId);
    const timeout = setTimeout(() => {
      this.pendingRemovals.delete(userId);
      this.removeUserFromRoom(roomCode, userId);
      onExpire();
    }, RECONNECT_GRACE_MS);
    this.pendingRemovals.set(userId, { roomCode, timeout });
  }

  cancelPendingRemoval(userId) {
    const pending = this.pendingRemovals.get(userId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRemovals.delete(userId);
      return true;
    }
    return false;
  }
}

module.exports = { RoomManager, RECONNECT_GRACE_MS };
