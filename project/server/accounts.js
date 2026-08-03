'use strict';

/**
 * accounts.js
 * ----------------------------------------------------------------------
 * Système de comptes SIMPLE : inscription / connexion par pseudo + mot de
 * passe, avec :
 *   - mots de passe jamais stockés en clair (hash + sel via scrypt, module
 *     natif de Node : aucune dépendance supplémentaire à installer),
 *   - persistance dans un simple fichier JSON sur disque (data/accounts.json),
 *     ce qui suffit largement pour un projet de cette taille et évite
 *     d'avoir à installer/configurer une vraie base de données,
 *   - des jetons de session opaques gardés en mémoire (perdus si le
 *     serveur redémarre : l'utilisateur devra alors se reconnecter).
 *
 * Ce module ne connaît rien de Socket.IO ni d'Express : il expose une API
 * simple utilisée par server/index.js.
 * ----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

const SCRYPT_KEYLEN = 64;
const SESSION_TOKEN_BYTES = 32;

const USERNAME_RE = /^[a-zA-Z0-9_\-]{3,20}$/;
const MIN_PASSWORD_LENGTH = 6;

class AccountManager {
  constructor() {
    /** @type {Map<string, {id: string, username: string, usernameLower: string, passwordHash: string, salt: string, createdAt: number}>} */
    this.accountsByUsernameLower = new Map();
    /** @type {Map<string, string>} token de session -> id de compte */
    this.sessions = new Map();

    this._load();
  }

  // ------------------------------------------------------------------
  // Persistance (fichier JSON)
  // ------------------------------------------------------------------

  _load() {
    try {
      if (!fs.existsSync(ACCOUNTS_FILE)) return;
      const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
      const list = JSON.parse(raw);
      for (const acc of list) {
        this.accountsByUsernameLower.set(acc.usernameLower, acc);
      }
    } catch (err) {
      console.error('[accounts] Impossible de charger data/accounts.json :', err.message);
    }
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const list = Array.from(this.accountsByUsernameLower.values());
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.error('[accounts] Impossible d\'écrire data/accounts.json :', err.message);
    }
  }

  // ------------------------------------------------------------------
  // Hash de mot de passe (scrypt + sel aléatoire, module natif Node)
  // ------------------------------------------------------------------

  _hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  }

  _verifyPassword(password, salt, expectedHash) {
    const candidate = this._hashPassword(password, salt);
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------

  validateUsername(username) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return 'Le pseudo doit contenir entre 3 et 20 caractères (lettres, chiffres, "_" ou "-").';
    }
    return null;
  }

  validatePassword(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Inscription / connexion
  // ------------------------------------------------------------------

  register(username, password) {
    const usernameError = this.validateUsername(username);
    if (usernameError) return { ok: false, error: usernameError };

    const passwordError = this.validatePassword(password);
    if (passwordError) return { ok: false, error: passwordError };

    const usernameLower = username.toLowerCase();
    if (this.accountsByUsernameLower.has(usernameLower)) {
      return { ok: false, error: 'Ce pseudo est déjà pris.' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const account = {
      id: `acc_${crypto.randomUUID()}`,
      username,
      usernameLower,
      passwordHash: this._hashPassword(password, salt),
      salt,
      createdAt: Date.now(),
    };

    this.accountsByUsernameLower.set(usernameLower, account);
    this._save();

    const token = this.createSession(account.id);
    return { ok: true, token, account: this._publicView(account) };
  }

  login(username, password) {
    const account = this.accountsByUsernameLower.get(String(username || '').toLowerCase());
    if (!account || !this._verifyPassword(password, account.salt, account.passwordHash)) {
      return { ok: false, error: 'Pseudo ou mot de passe incorrect.' };
    }

    const token = this.createSession(account.id);
    return { ok: true, token, account: this._publicView(account) };
  }

  _publicView(account) {
    return { id: account.id, username: account.username };
  }

  // ------------------------------------------------------------------
  // Sessions (jetons opaques en mémoire)
  // ------------------------------------------------------------------

  createSession(accountId) {
    const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString('hex');
    this.sessions.set(token, accountId);
    return token;
  }

  getAccountByToken(token) {
    if (!token) return null;
    const accountId = this.sessions.get(token);
    if (!accountId) return null;
    for (const account of this.accountsByUsernameLower.values()) {
      if (account.id === accountId) return this._publicView(account);
    }
    return null;
  }

  destroySession(token) {
    this.sessions.delete(token);
  }
}

module.exports = { AccountManager };
