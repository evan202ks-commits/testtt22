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
// Compte — jeton de session persisté en localStorage.
//
// Contrairement à l'identifiant de socket (qui reste isolé par onglet),
// le compte est partagé entre tous les onglets d'un même navigateur :
// c'est le comportement attendu pour une identité de connexion (comme
// n'importe quel site avec "rester connecté").
// ------------------------------------------------------------------
const SESSION_STORAGE_KEY = 'realtime-infra:sessionToken';

// IMPORTANT : `socket` est créé tout de suite (comme avant l'ajout des
// comptes), avec `autoConnect: false` — il ne se connecte pas au serveur
// tant qu'on n'a pas de jeton de session valide. On garde volontairement
// le MÊME objet `socket` du début à la fin (au lieu d'en recréer un après
// connexion) car public/game/main.js capture cette référence globale dès
// le chargement de la page pour piloter le mini-jeu ; la recréer plus
// tard laisserait le jeu accroché à une socket obsolète.
const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
});

// ------------------------------------------------------------------
// Références DOM
// ------------------------------------------------------------------
const el = {
  statusDot: document.getElementById('statusDot'),
  myUsername: document.getElementById('myUsername'),
  myPing: document.getElementById('myPing'),
  btnLogout: document.getElementById('btnLogout'),

  screenAuth: document.getElementById('screen-auth'),
  authUsernameInput: document.getElementById('authUsernameInput'),
  authPasswordInput: document.getElementById('authPasswordInput'),
  btnLogin: document.getElementById('btnLogin'),
  btnRegister: document.getElementById('btnRegister'),
  authError: document.getElementById('authError'),

  screenHome: document.getElementById('screen-home'),
  screenRoom: document.getElementById('screen-room'),

  homeUsername: document.getElementById('homeUsername'),
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
  myUserId: null,
  myUsername: '',
  roomCode: null,
  users: [], // dernière liste connue des utilisateurs de la salle (avec pseudos)
};

// ------------------------------------------------------------------
// Écran de compte — inscription / connexion
// ------------------------------------------------------------------
function showAuthScreen(message) {
  el.screenAuth.classList.remove('screen--hidden');
  el.screenHome.classList.add('screen--hidden');
  el.screenRoom.classList.add('screen--hidden');
  el.authError.textContent = message || '';
}

async function callAuthApi(path, username, password) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: 'Impossible de contacter le serveur.' };
  }
}

el.btnRegister.addEventListener('click', async () => {
  el.authError.textContent = '';
  const username = el.authUsernameInput.value.trim();
  const password = el.authPasswordInput.value;
  const result = await callAuthApi('/api/register', username, password);
  if (!result.ok) {
    el.authError.textContent = result.error || "Impossible de créer le compte.";
    return;
  }
  onAuthenticated(result.token, result.account.username);
});

el.btnLogin.addEventListener('click', async () => {
  el.authError.textContent = '';
  const username = el.authUsernameInput.value.trim();
  const password = el.authPasswordInput.value;
  const result = await callAuthApi('/api/login', username, password);
  if (!result.ok) {
    el.authError.textContent = result.error || 'Connexion impossible.';
    return;
  }
  onAuthenticated(result.token, result.account.username);
});

el.authPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.btnLogin.click();
});

function onAuthenticated(token, username) {
  localStorage.setItem(SESSION_STORAGE_KEY, token);
  state.myUsername = username;
  el.myUsername.textContent = username;
  el.homeUsername.textContent = username;
  el.authPasswordInput.value = '';
  el.screenAuth.classList.add('screen--hidden');
  el.screenHome.classList.remove('screen--hidden');
  connectSocket(token);
}

el.btnLogout.addEventListener('click', async () => {
  const token = localStorage.getItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
  try {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    // Peu importe si l'appel échoue : on efface quand même la session locale.
  }
  if (socket) socket.disconnect();
  state.myUserId = null;
  state.myUsername = '';
  state.roomCode = null;
  el.myUsername.textContent = '—';
  showAuthScreen();
});

// ------------------------------------------------------------------
// Démarrage : jeton existant ? on tente de restaurer la session avant
// d'afficher quoi que ce soit d'autre que l'écran de compte.
// ------------------------------------------------------------------
(async function bootstrap() {
  const token = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!token) {
    showAuthScreen();
    return;
  }
  try {
    const res = await fetch('/api/me', { headers: { 'X-Session-Token': token } });
    const data = await res.json();
    if (data.ok) {
      onAuthenticated(token, data.account.username);
      return;
    }
  } catch (err) {
    // Erreur réseau : on retombe sur l'écran de connexion ci-dessous.
  }
  localStorage.removeItem(SESSION_STORAGE_KEY);
  showAuthScreen();
})();

// ------------------------------------------------------------------
// Connexion Socket.IO — la socket existe déjà (voir plus haut) ; on ne
// fait que lui fournir le jeton de session et déclencher la connexion.
// ------------------------------------------------------------------
function connectSocket(sessionToken) {
  socket.auth = { sessionToken };
  if (socket.connected) socket.disconnect();
  socket.connect();
}

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

// ------------------------------------------------------------------
// Abonnements aux évènements socket — appelé une fois la socket créée
// (voir connectSocket ci-dessus), puisque `socket` n'existe pas tant que
// le compte n'est pas authentifié.
// ------------------------------------------------------------------
function registerSocketHandlers() {
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
      socket.emit('room:join', { roomCode: state.roomCode }, handleJoinResponse);
    }
  });

  // Le serveur rejette la connexion si le jeton de session n'est plus
  // valide (session en mémoire perdue après un redémarrage, par exemple).
  socket.on('auth:required', () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    showAuthScreen('Votre session a expiré, merci de vous reconnecter.');
  });

  // ------------------------------------------------------------------
  // Identité confirmée par le serveur (dérivée du compte)
  // ------------------------------------------------------------------
  socket.on('identity', ({ userId, username }) => {
    state.myUserId = userId;
    state.myUsername = username;
    el.myUsername.textContent = username;
    el.homeUsername.textContent = username;
    logLine(`Identité confirmée : ${username} (${userId})`, 'system');
  });

  // ------------------------------------------------------------------
  // Liste des utilisateurs connectés dans la salle (pseudos + ping)
  // ------------------------------------------------------------------
  socket.on('room:users', (users) => {
    state.users = users;
    renderUserList(users);
  });

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
}

// La socket est créée une seule fois au chargement de la page (voir plus
// haut) : on attache donc les écouteurs tout de suite, une seule fois.
registerSocketHandlers();

// ------------------------------------------------------------------
// Écran d'accueil : créer / rejoindre une salle
// ------------------------------------------------------------------
el.btnCreateRoom.addEventListener('click', () => {
  el.homeError.textContent = '';
  socket.emit('room:create', {}, (res) => {
    if (!res?.ok) {
      el.homeError.textContent = res?.error || 'Erreur lors de la création.';
      return;
    }
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

  if (!roomCode) {
    el.homeError.textContent = 'Merci de saisir un code de salle.';
    return;
  }
  socket.emit('room:join', { roomCode }, handleJoinResponse);
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
