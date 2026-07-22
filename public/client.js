'use strict';

/**
 * client.js
 * ----------------------------------------------------------------------
 * Logique front-end pure : gère la connexion Socket.IO, l'UI des deux
 * écrans (accueil / salle), le chat en temps réel, et un panneau
 * "avancé" repliable pour tester l'envoi de données JSON brutes avant
 * de brancher un vrai jeu par-dessus.
 * ----------------------------------------------------------------------
 */

// ------------------------------------------------------------------
// Identité persistante — sessionStorage (et non localStorage).
//
// IMPORTANT : sessionStorage est isolé PAR ONGLET, alors que localStorage
// est partagé par tous les onglets d'un même navigateur/origine. Si on
// utilisait localStorage, deux onglets ouverts pour tester "deux
// utilisateurs" partageraient le même identifiant et le serveur les
// confondrait (c'est ce qui causait des messages qui semblaient ne pas
// arriver en temps réel). Avec sessionStorage, chaque onglet garde sa
// propre identité stable (survit à un F5) sans se mélanger avec les
// autres onglets.
// ------------------------------------------------------------------
const STORAGE_KEY = 'realtime-infra:userId';
const storedUserId = sessionStorage.getItem(STORAGE_KEY) || undefined;

const socket = io({
  auth: { userId: storedUserId },
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
});

// ------------------------------------------------------------------
// Références DOM
// ------------------------------------------------------------------
const el = {
  statusDot: document.getElementById('statusDot'),
  myUserId: document.getElementById('myUserId'),
  myPing: document.getElementById('myPing'),

  screenHome: document.getElementById('screen-home'),
  screenRoom: document.getElementById('screen-room'),

  usernameInput: document.getElementById('usernameInput'),
  btnCreateRoom: document.getElementById('btnCreateRoom'),
  roomCodeInput: document.getElementById('roomCodeInput'),
  btnJoinRoom: document.getElementById('btnJoinRoom'),
  homeError: document.getElementById('homeError'),

  roomCodeDisplay: document.getElementById('roomCodeDisplay'),
  btnLeaveRoom: document.getElementById('btnLeaveRoom'),
  userList: document.getElementById('userList'),

  chatMessages: document.getElementById('chatMessages'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),

  consoleEl: document.getElementById('console'),
  btnClearConsole: document.getElementById('btnClearConsole'),
  sendForm: document.getElementById('sendForm'),
  msgTarget: document.getElementById('msgTarget'),
  msgType: document.getElementById('msgType'),
  msgPayload: document.getElementById('msgPayload'),
};

// ------------------------------------------------------------------
// État local
// ------------------------------------------------------------------
const state = {
  myUserId: storedUserId || null,
  myUsername: '',
  roomCode: null,
  users: [], // dernière liste connue des utilisateurs de la salle (avec pseudos)
};

function getUsernameById(userId) {
  if (userId === state.myUserId) return state.myUsername || 'Moi';
  const u = state.users.find((x) => x.id === userId);
  return u ? u.username : `Utilisateur ${userId.slice(4, 8)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeNow() {
  return new Date().toLocaleTimeString('fr-FR', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

// ------------------------------------------------------------------
// Chat en temps réel — c'est l'interface principale de la salle
// ------------------------------------------------------------------
function addChatBubble({ author, text, mine, time }) {
  const wrap = document.createElement('div');
  wrap.className = `chat-bubble${mine ? ' chat-bubble--mine' : ''}`;
  wrap.innerHTML = `
    <div class="chat-bubble__meta">
      <span class="chat-bubble__author">${escapeHtml(author)}${mine ? ' (moi)' : ''}</span>
      <span class="chat-bubble__time">${time}</span>
    </div>
    <div class="chat-bubble__text"></div>
  `;
  wrap.querySelector('.chat-bubble__text').textContent = text;
  el.chatMessages.appendChild(wrap);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function addChatSystemLine(text) {
  const line = document.createElement('div');
  line.className = 'chat-system';
  line.textContent = text;
  el.chatMessages.appendChild(line);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

el.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.chatInput.value.trim();
  if (!text) return;

  socket.emit('message:broadcast', { type: 'chat', data: { text } });
  addChatBubble({ author: state.myUsername || 'Moi', text, mine: true, time: timeNow() });
  el.chatInput.value = '';
  el.chatInput.focus();
});

// ------------------------------------------------------------------
// Journal technique (panneau avancé) — tout ce qui transite, brut
// ------------------------------------------------------------------
function logLine(text, kind = 'system') {
  const time = timeNow();
  const line = document.createElement('div');
  line.className = `console-line console-line--${kind}`;
  line.innerHTML = `<span class="console-line__time">${time}</span>${escapeHtml(text)}`;
  el.consoleEl.appendChild(line);
  el.consoleEl.scrollTop = el.consoleEl.scrollHeight;
}

el.btnClearConsole.addEventListener('click', () => {
  el.consoleEl.innerHTML = '';
  el.chatMessages.innerHTML = '';
});

// ------------------------------------------------------------------
// Statut de connexion (voyant + libellés)
// ------------------------------------------------------------------
function setConnectionStatus(kind) {
  el.statusDot.className = `dot dot--${kind}`; // off | on | warn
}

socket.on('connect', () => {
  setConnectionStatus('on');
  logLine(`Connecté au serveur (socket ${socket.id}).`, 'system');
});

socket.on('disconnect', (reason) => {
  setConnectionStatus('warn');
  logLine(`Connexion perdue (${reason}). Tentative de reconnexion...`, 'error');
  addChatSystemLine('Connexion perdue, tentative de reconnexion...');
});

socket.io.on('reconnect_attempt', (attempt) => {
  logLine(`Reconnexion en cours (essai ${attempt})...`, 'system');
});

socket.io.on('reconnect', () => {
  setConnectionStatus('on');
  logLine('Reconnecté au serveur.', 'system');
  // Si on était dans une salle, on retente de la rejoindre avec la même
  // identité pour restaurer la session sans action de l'utilisateur.
  if (state.roomCode) {
    socket.emit(
      'room:join',
      { roomCode: state.roomCode, username: el.usernameInput.value.trim() },
      handleJoinResponse
    );
  }
});

// ------------------------------------------------------------------
// Identité attribuée par le serveur
// ------------------------------------------------------------------
socket.on('identity', ({ userId, isNewIdentity }) => {
  state.myUserId = userId;
  sessionStorage.setItem(STORAGE_KEY, userId);
  el.myUserId.textContent = userId.replace('usr_', '').slice(0, 8);
  logLine(
    isNewIdentity
      ? `Identifiant attribué : ${userId}`
      : `Identité restaurée : ${userId}`,
    'system'
  );
});

// ------------------------------------------------------------------
// Écran d'accueil : créer / rejoindre une salle
// ------------------------------------------------------------------
el.btnCreateRoom.addEventListener('click', () => {
  el.homeError.textContent = '';
  const username = el.usernameInput.value.trim();
  socket.emit('room:create', { username }, (res) => {
    if (!res?.ok) {
      el.homeError.textContent = res?.error || 'Erreur lors de la création.';
      return;
    }
    state.myUsername = username || `Joueur-${res.userId.slice(4, 8)}`;
    enterRoom(res.roomCode, res.users);
    logLine(`Salle créée : ${res.roomCode}`, 'system');
  });
});

el.btnJoinRoom.addEventListener('click', () => attemptJoin());
el.roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptJoin();
});

function attemptJoin() {
  el.homeError.textContent = '';
  const roomCode = el.roomCodeInput.value.trim().toUpperCase();
  const username = el.usernameInput.value.trim();

  if (!roomCode) {
    el.homeError.textContent = 'Merci de saisir un code de salle.';
    return;
  }
  state.myUsername = username || state.myUsername;
  socket.emit('room:join', { roomCode, username }, handleJoinResponse);
}

function handleJoinResponse(res) {
  if (!res?.ok) {
    el.homeError.textContent = res?.error || 'Impossible de rejoindre la salle.';
    return;
  }
  const me = res.users.find((u) => u.id === res.userId);
  if (me) state.myUsername = me.username;
  enterRoom(res.roomCode, res.users);
  logLine(`Salle rejointe : ${res.roomCode}`, 'system');
}

function enterRoom(roomCode, users) {
  state.roomCode = roomCode;
  el.roomCodeDisplay.textContent = roomCode;
  el.screenHome.classList.add('screen--hidden');
  el.screenRoom.classList.remove('screen--hidden');
  el.chatMessages.innerHTML = '';
  addChatSystemLine(`Vous avez rejoint la salle ${roomCode}.`);
  renderUserList(users);
  startPingLoop();
  el.chatInput.focus();
}

el.btnLeaveRoom.addEventListener('click', () => {
  socket.emit('room:leave', {}, () => {
    state.roomCode = null;
    el.screenRoom.classList.add('screen--hidden');
    el.screenHome.classList.remove('screen--hidden');
    logLine('Vous avez quitté la salle.', 'system');
  });
});

// ------------------------------------------------------------------
// Liste des utilisateurs connectés dans la salle (pseudos + ping)
// ------------------------------------------------------------------
socket.on('room:users', (users) => {
  state.users = users;
  renderUserList(users);
});

function renderUserList(users) {
  el.userList.innerHTML = '';
  el.msgTarget.querySelectorAll('option[data-user]').forEach((o) => o.remove());

  users
    .slice()
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .forEach((u) => {
      const isMe = u.id === state.myUserId;

      const li = document.createElement('li');
      li.className = `user-list__item${isMe ? ' is-me' : ''}`;
      const dotKind = u.connected ? 'on' : 'warn';
      li.innerHTML = `
        <span class="dot dot--${dotKind}"></span>
        <span class="user-list__name">${escapeHtml(u.username)}${isMe ? ' (moi)' : ''}</span>
        <span class="user-list__ping">${u.ping != null ? u.ping + ' ms' : '—'}</span>
      `;
      if (!u.connected) {
        const status = document.createElement('span');
        status.className = 'user-list__status';
        status.textContent = 'reconnexion…';
        li.appendChild(status);
      }
      el.userList.appendChild(li);

      if (!isMe) {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.dataset.user = '1';
        opt.textContent = `👤 ${u.username}`;
        el.msgTarget.appendChild(opt);
      }
    });
}

socket.on('user:joined', (u) => {
  logLine(`${u.username} a rejoint la salle.`, 'system');
  addChatSystemLine(`${u.username} a rejoint la salle.`);
});
socket.on('user:left', (u) => {
  const name = getUsernameById(u.id);
  logLine(`${name} a quitté la salle.`, 'system');
  addChatSystemLine(`${name} a quitté la salle.`);
});
socket.on('user:reconnected', (u) => {
  logLine(`${u.username} s'est reconnecté.`, 'system');
  addChatSystemLine(`${u.username} s'est reconnecté.`);
});
socket.on('user:disconnected_temp', (u) => {
  const name = getUsernameById(u.id);
  logLine(`${name} déconnecté, en attente de reconnexion...`, 'error');
});

// ------------------------------------------------------------------
// Réception des messages diffusés à la salle
// ------------------------------------------------------------------
socket.on('message:broadcast', (envelope) => {
  const mine = envelope.from === state.myUserId;
  const author = getUsernameById(envelope.from);
  const time = new Date(envelope.timestamp).toLocaleTimeString('fr-FR', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });

  if (envelope.type === 'chat' && envelope.data && typeof envelope.data.text === 'string') {
    if (!mine) addChatBubble({ author, text: envelope.data.text, mine: false, time });
  } else {
    // Donnée personnalisée (mode avancé) : on l'affiche dans le journal
    // technique plutôt que dans le chat, pour ne pas polluer la conversation.
    if (!mine) {
      logLine(`← [broadcast de ${author}] ${envelope.type} ${JSON.stringify(envelope.data)}`, 'in');
    }
  }
});

socket.on('message:direct', (envelope) => {
  const author = getUsernameById(envelope.from);
  logLine(`← [privé de ${author}] ${envelope.type} ${JSON.stringify(envelope.data)}`, 'in');
});

// ------------------------------------------------------------------
// Panneau avancé : envoi de données JSON personnalisées (broadcast/direct)
// ------------------------------------------------------------------
el.sendForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const type = el.msgType.value.trim() || 'custom';
  const target = el.msgTarget.value;
  let data;

  try {
    data = el.msgPayload.value.trim() ? JSON.parse(el.msgPayload.value) : {};
  } catch (err) {
    logLine(`JSON invalide : ${err.message}`, 'error');
    return;
  }

  if (target === 'broadcast') {
    socket.emit('message:broadcast', { type, data });
    logLine(`→ [broadcast] ${type} ${JSON.stringify(data)}`, 'out');
  } else {
    socket.emit('message:direct', { targetUserId: target, type, data }, (res) => {
      if (!res?.ok) {
        logLine(`Échec de l'envoi privé : ${res?.error}`, 'error');
      } else {
        logLine(`→ [privé → ${getUsernameById(target)}] ${type} ${JSON.stringify(data)}`, 'out');
      }
    });
  }
});

// ------------------------------------------------------------------
// Mesure de ping (round-trip applicatif, indépendant du ping transport)
// ------------------------------------------------------------------
let pingIntervalId = null;

function startPingLoop() {
  if (pingIntervalId) return;
  measurePing();
  pingIntervalId = setInterval(measurePing, 4000);
}

function measurePing() {
  const sentAt = Date.now();
  socket.timeout(5000).emit('ping:measure', sentAt, (err, echoed) => {
    if (err) return; // pas de réponse à temps : on retentera au prochain tick
    const rtt = Date.now() - sentAt;
    el.myPing.textContent = `${rtt} ms`;
    socket.emit('ping:report', rtt);
  });
}

// Nettoyage propre si l'onglet est fermé pendant qu'on est dans une salle.
window.addEventListener('beforeunload', () => {
  if (state.roomCode) socket.emit('room:leave', {});
});
