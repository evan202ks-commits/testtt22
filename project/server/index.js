'use strict';

/**
 * server/index.js
 * ----------------------------------------------------------------------
 * Point d'entrée du serveur. Ce fichier est le seul endroit du projet qui
 * connaît Socket.IO : il traduit les évènements réseau en appels vers le
 * RoomManager, et inversement.
 *
 * IMPORTANT : ce projet est UNIQUEMENT une infrastructure de communication
 * temps réel (salles, utilisateurs, messages JSON, ping...). Il ne contient
 * aucune règle de jeu : c'est une fondation neutre destinée à être
 * consommée plus tard par un jeu multijoueur.
 * ----------------------------------------------------------------------
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./roomManager');
const { AccountManager } = require('./accounts');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
app.use(express.json());

const io = new Server(server, {
  // Ping applicatif du transport (au-delà de notre propre mesure de ping
  // "utilisateur") : permet à Socket.IO de détecter les sockets zombies.
  pingInterval: 10_000,
  pingTimeout: 8_000,
  cors: {
    origin: '*', // Fondation générique : à restreindre en production.
  },
});

const roomManager = new RoomManager();
const accountManager = new AccountManager();

// Association socket.id (volatile, change à chaque reconnexion) -> userId
// (stable, persisté côté client en localStorage). C'est ce qui permet de
// retrouver "qui parle" quel que soit l'état de la connexion physique.
const socketIdToUserId = new Map();
const userIdToSocketId = new Map();

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: roomManager.rooms.size,
    uptime: process.uptime(),
  });
});

// --------------------------------------------------------------------
// Comptes (inscription / connexion) — API REST simple, indépendante de
// Socket.IO. Le client garde le jeton de session reçu ici et le fournit
// ensuite lors de la connexion WebSocket (voir plus bas).
// --------------------------------------------------------------------

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  const result = accountManager.register(username, password);
  if (!result.ok) return res.status(400).json(result);
  log(`Nouveau compte créé : ${result.account.username}`);
  res.json(result);
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const result = accountManager.login(username, password);
  if (!result.ok) return res.status(401).json(result);
  log(`Connexion compte : ${result.account.username}`);
  res.json(result);
});

app.post('/api/logout', (req, res) => {
  const { token } = req.body || {};
  accountManager.destroySession(token);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const token = req.headers['x-session-token'];
  const account = accountManager.getAccountByToken(token);
  if (!account) return res.status(401).json({ ok: false });
  res.json({ ok: true, account });
});

// --------------------------------------------------------------------
// Utilitaires internes
// --------------------------------------------------------------------

function broadcastUserList(roomCode) {
  const users = roomManager.getUsersList(roomCode);
  io.to(roomCode).emit('room:users', users);
}

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// --------------------------------------------------------------------
// Connexion Socket.IO
// --------------------------------------------------------------------

io.on('connection', (socket) => {
  // Le client doit désormais fournir un jeton de session valide (obtenu via
  // /api/register ou /api/login) : c'est le compte qui fait foi pour le
  // pseudo, plus une simple saisie libre du client.
  const sessionToken = socket.handshake.auth?.sessionToken;
  const account = accountManager.getAccountByToken(sessionToken);

  if (!account) {
    log(`Connexion refusée socket=${socket.id} (jeton de session absent ou invalide)`);
    socket.emit('auth:required');
    socket.disconnect(true);
    return;
  }

  // Le userId reste lié au compte (stable, quel que soit l'onglet/socket),
  // ce qui permet de retrouver "qui parle" quel que soit l'état de la
  // connexion physique.
  const userId = `usr_${account.id}`;

  socketIdToUserId.set(socket.id, userId);
  userIdToSocketId.set(userId, socket.id);

  socket.emit('identity', { userId, username: account.username });
  log(`Connexion socket=${socket.id} user=${userId} compte=${account.username}`);

  // ------------------------------------------------------------------
  // Créer une salle
  // ------------------------------------------------------------------
  socket.on('room:create', (_payload = {}, callback) => {
    try {
      const user = {
        id: userId,
        username: account.username,
        connected: true,
        ping: null,
        joinedAt: Date.now(),
      };

      const room = roomManager.createRoom(user);
      socket.join(room.code);
      socket.data.roomCode = room.code;

      log(`Salle créée code=${room.code} par user=${userId}`);
      callback?.({
        ok: true,
        roomCode: room.code,
        userId,
        users: roomManager.getUsersList(room.code),
      });
    } catch (err) {
      log('Erreur room:create', err);
      callback?.({ ok: false, error: 'Impossible de créer la salle.' });
    }
  });

  // ------------------------------------------------------------------
  // Rejoindre une salle existante
  // ------------------------------------------------------------------
  socket.on('room:join', ({ roomCode } = {}, callback) => {
    const code = String(roomCode || '').trim().toUpperCase();

    if (!roomManager.roomExists(code)) {
      return callback?.({ ok: false, error: "Cette salle n'existe pas." });
    }

    // Cas d'une reconnexion : l'utilisateur était déjà dans cette salle et
    // revient dans la fenêtre de grâce.
    const existing = roomManager.findUserInRoom(code, userId);
    const wasPendingRemoval = roomManager.cancelPendingRemoval(userId);

    const user = existing || {
      id: userId,
      username: account.username,
      connected: true,
      ping: null,
      joinedAt: Date.now(),
    };
    user.connected = true;

    roomManager.addUserToRoom(code, user);
    socket.join(code);
    socket.data.roomCode = code;

    callback?.({
      ok: true,
      roomCode: code,
      userId,
      users: roomManager.getUsersList(code),
    });

    if (existing && wasPendingRemoval) {
      log(`Reconnexion user=${userId} salle=${code}`);
      socket.to(code).emit('user:reconnected', { id: userId, username: user.username });
    } else {
      log(`Utilisateur user=${userId} rejoint salle=${code}`);
      socket.to(code).emit('user:joined', { id: userId, username: user.username });
    }
    broadcastUserList(code);
  });

  // ------------------------------------------------------------------
  // Quitter volontairement une salle
  // ------------------------------------------------------------------
  socket.on('room:leave', (_payload, callback) => {
    const code = socket.data.roomCode;
    if (code) {
      roomManager.removeUserFromRoom(code, userId);
      socket.leave(code);
      socket.to(code).emit('user:left', { id: userId });
      broadcastUserList(code);
      socket.data.roomCode = null;
      log(`Utilisateur user=${userId} quitte salle=${code}`);
    }
    callback?.({ ok: true });
  });

  // ------------------------------------------------------------------
  // Message diffusé à toute la salle (broadcast)
  // ------------------------------------------------------------------
  socket.on('message:broadcast', (msg = {}) => {
    const code = socket.data.roomCode;
    if (!code) return;

    const envelope = {
      from: userId,
      type: msg.type ?? 'message',
      data: msg.data ?? null,
      timestamp: Date.now(),
    };

    // io.to() envoie aussi à l'émetteur : utile pour que la console de
    // test affiche bien "ce que j'ai envoyé" en plus de ce qu'il reçoit.
    io.to(code).emit('message:broadcast', envelope);
  });

  // ------------------------------------------------------------------
  // Message envoyé à un utilisateur spécifique (unicast)
  // ------------------------------------------------------------------
  socket.on('message:direct', (msg = {}, callback) => {
    const code = socket.data.roomCode;
    const targetId = msg.targetUserId;
    if (!code || !targetId) {
      return callback?.({ ok: false, error: 'Salle ou destinataire manquant.' });
    }

    const targetUser = roomManager.findUserInRoom(code, targetId);
    const targetSocketId = userIdToSocketId.get(targetId);

    if (!targetUser || !targetSocketId) {
      return callback?.({ ok: false, error: 'Destinataire introuvable dans la salle.' });
    }

    const envelope = {
      from: userId,
      to: targetId,
      type: msg.type ?? 'message',
      data: msg.data ?? null,
      timestamp: Date.now(),
    };

    io.to(targetSocketId).emit('message:direct', envelope);
    // Accusé de réception pour l'expéditeur (utile pour la console de test).
    callback?.({ ok: true, envelope });
  });

  // ------------------------------------------------------------------
  // Mesure de ping (aller-retour applicatif)
  // ------------------------------------------------------------------
  socket.on('ping:measure', (clientSentAt, callback) => {
    // On répond immédiatement : le client calcule le round-trip time.
    callback?.(clientSentAt);
  });

  socket.on('ping:report', (rtt) => {
    const code = socket.data.roomCode;
    if (!code) return;
    const user = roomManager.findUserInRoom(code, userId);
    if (user) {
      user.ping = Math.max(0, Math.round(rtt));
      broadcastUserList(code);
    }
  });

  // ------------------------------------------------------------------
  // Déconnexion (fermeture d'onglet, perte réseau, veille...)
  // ------------------------------------------------------------------
  socket.on('disconnect', (reason) => {
    const code = socket.data.roomCode;
    socketIdToUserId.delete(socket.id);
    // On ne supprime userIdToSocketId que si aucune autre socket active
    // pour ce même userId ne l'a déjà remplacé (cas de reconnexion rapide).
    if (userIdToSocketId.get(userId) === socket.id) {
      userIdToSocketId.delete(userId);
    }

    log(`Déconnexion socket=${socket.id} user=${userId} raison="${reason}"`);

    if (!code) return;

    const user = roomManager.findUserInRoom(code, userId);
    if (!user) return;

    user.connected = false;
    socket.to(code).emit('user:disconnected_temp', { id: userId });
    broadcastUserList(code);

    // On laisse une fenêtre de grâce avant de retirer réellement
    // l'utilisateur, pour absorber les coupures réseau temporaires.
    roomManager.scheduleRemoval(code, userId, () => {
      io.to(code).emit('user:left', { id: userId });
      broadcastUserList(code);
      log(`Suppression définitive user=${userId} salle=${code} (grâce expirée)`);
    });
  });
});

server.listen(PORT, () => {
  log(`Serveur d'infrastructure temps réel démarré sur http://localhost:${PORT}`);
});
