# realtime-comm-infra

Infrastructure de communication temps réel entre navigateurs, basée sur
**Node.js + Express + Socket.IO**. Ce projet est volontairement **neutre :
il ne contient aucune règle de jeu**. C'est un socle réseau destiné à
servir de fondation à un futur jeu multijoueur (ou toute autre application
temps réel).

## Ce que fournit l'infrastructure

- Système de comptes simple : inscription/connexion par pseudo + mot de
  passe, mots de passe hashés (scrypt + sel), persistés dans
  `data/accounts.json`. Le pseudo est garanti par le compte (impossible de
  se faire passer pour quelqu'un d'autre dans une salle).
- Connexion simultanée de plusieurs utilisateurs.
- Création de salles privées avec code unique (6 caractères, sans
  ambiguïté visuelle : pas de `0/O` ni `1/I/l`).
- Rejoindre une salle existante via son code.
- Liste des utilisateurs connectés dans la salle, mise à jour en temps réel.
- Identifiant unique et **persistant** par utilisateur (stocké côté client
  en `localStorage`, indépendant du `socket.id` qui change à chaque
  reconnexion).
- Envoi/réception de messages JSON personnalisés (`type` + `data` libres).
- Diffusion à toute une salle (`message:broadcast`).
- Envoi ciblé à un utilisateur précis (`message:direct`).
- Détection des connexions, déconnexions et reconnexions.
- Mesure du ping applicatif (round-trip) par utilisateur.
- Tolérance aux coupures réseau : fenêtre de grâce de 25s avant de retirer
  réellement un utilisateur déconnecté, pour absorber les micro-coupures.
- Réglages de transport Socket.IO (`pingInterval`/`pingTimeout`) pour
  détecter rapidement les sockets zombies.

## Structure du projet

```
realtime-comm-app/
├── package.json
├── data/
│   └── accounts.json      # Comptes persistés (créé automatiquement)
├── server/
│   ├── index.js           # Serveur Express + Socket.IO (couche réseau)
│   ├── accounts.js        # Comptes : inscription/connexion, hash, sessions
│   └── roomManager.js     # Gestion des salles/utilisateurs (couche métier)
└── public/
    ├── index.html          # Écran de compte + accueil + salle + overlay 3D
    ├── style.css           # Interface — univers cosy/lofi (voir plus bas)
    ├── client.js            # Logique client (compte + Socket.IO)
    └── game/
        ├── mathUtils.js      # Fonctions pures (interpolation, hash, collisions)
        ├── InputManager.js   # Clavier -> vecteur de direction (ZQSD/flèches)
        ├── Player.js          # Données d'un joueur (position, chat)
        ├── Inventory.js        # Sac à dos client-only (localStorage)
        ├── GameNetwork.js       # Pont vers l'infra réseau EXISTANTE
        ├── GameEngine.js         # Boucle de jeu, roster, déplacement
        ├── main.js                # Colle le mini-jeu à la page existante
        └── render/                # Rendu 2D (Canvas natif, voir plus bas)
            ├── WorldBuilder.js     # Config du monde + décor procédural
            └── WorldRenderer.js    # Caméra suiveuse, sprites, dessin

```

## Direction artistique — île de départ cosy

Le mini-jeu est un petit monde 2D vu de dessus (top-down), dessiné en
Canvas natif du navigateur : **aucune dépendance externe** (plus de
Three.js, plus de WebGL, plus de CDN à charger). Un seul monde — une
petite **île de départ** cernée d'eau, avec sa cabane, son jardin
clôturé, son feu de camp et son ponton — où tous les joueurs se
retrouvent : plus de planètes séparées, plus de portails à emprunter. Le
littoral (falaise + écume + herbe) suit un contour irrégulier, pas un
simple rectangle : voir `islandRadiusFn`/`clampToIsland` dans
`public/game/render/WorldBuilder.js`. Le décor (arbres, arbres à pommes,
buissons, rochers, champignons, fleurs, souches...) est généré par code
(formes vectorielles simples peintes sur des `<canvas>` au chargement) :
aucun asset externe à télécharger en dehors du sprite du personnage
(`public/assets/sprites/character_atlas.png`).

Ajouter un élément de décor dispersé aléatoirement = ajouter une entrée
dans `WORLD.decor` (type + nombre d'occurrences). Ajouter un élément fixe
(bâtiment, ponton, feu de camp...) = ajouter une entrée dans
`WORLD.landmarks` (type + position `x, y`). Le placement, le rendu et
l'ombre portée restent génériques (voir `public/game/render/WorldBuilder.js`).

**Course** : maintenir `Shift` fait courir le personnage (vitesse et
cycle de marche accélérés) tant qu'une direction est demandée. Aucun
champ réseau supplémentaire n'a été nécessaire : la vitesse de course se
déduit de la distance réellement parcourue par frame (voir
`speedFactor` dans `public/game/Player.js`), donc les autres joueurs
voient aussi l'animation de course sans changement de protocole.

**Ce qui n'a pas changé** : le protocole réseau (voir plus bas), les
comptes, le chat, le ping, la reconnexion, le sac à dos (localStorage par
joueur), les touches ZQSD/flèches, `Tab` (chat) et `E` (sac). Le payload
de position réseau reste `{x, y}`, inchangé.

## Installation et lancement

### Windows

Double-cliquez sur **`lancer.bat`**. Le script installe automatiquement
les dépendances au premier lancement (nécessite [Node.js](https://nodejs.org/)
installé), démarre le serveur, puis ouvre `http://localhost:3000` dans
votre navigateur. Laissez la fenêtre noire ouverte : c'est le serveur ;
la fermer l'arrête. Relancez `lancer.bat` (dans un second dossier, ou
ouvrez un second onglet sur la même adresse) pour simuler un deuxième
utilisateur.

### macOS / Linux / ligne de commande

```bash
npm install
npm start
```

Le serveur démarre sur `http://localhost:3000` (configurable via la
variable d'environnement `PORT`). Ouvrez plusieurs onglets/navigateurs
sur cette adresse pour simuler plusieurs utilisateurs.

## Comptes (API REST)

Un compte simple protège le pseudo : indépendant de Socket.IO, avant toute
connexion temps réel.

| Route | Payload | Réponse |
|---|---|---|
| `POST /api/register` | `{ username, password }` | `{ ok, token, account }` ou `{ ok:false, error }` |
| `POST /api/login` | `{ username, password }` | `{ ok, token, account }` ou `{ ok:false, error }` |
| `POST /api/logout` | `{ token }` | `{ ok:true }` |
| `GET /api/me` | en-tête `X-Session-Token` | `{ ok, account }` ou `401` |

Le `token` reçu est stocké côté client en `localStorage` et fourni à la
connexion Socket.IO via `socket.handshake.auth.sessionToken`. Sans jeton
valide, le serveur refuse la connexion socket (`auth:required` puis
déconnexion).

## Protocole (évènements Socket.IO)

### Client → Serveur

| Évènement | Payload | Réponse (callback) |
|---|---|---|
| `room:create` | `{}` | `{ ok, roomCode, userId, users }` |
| `room:join` | `{ roomCode }` | `{ ok, roomCode, userId, users }` ou `{ ok:false, error }` |
| `room:leave` | `{}` | `{ ok:true }` |
| `message:broadcast` | `{ type, data }` | — (diffusé à toute la salle, y compris l'émetteur) |
| `message:direct` | `{ targetUserId, type, data }` | `{ ok, envelope }` ou `{ ok:false, error }` |
| `ping:measure` | `timestamp` (nombre) | renvoie le même timestamp (calcul du RTT côté client) |
| `ping:report` | `rtt` (ms) | — (stocké et diffusé dans `room:users`) |

### Serveur → Client

| Évènement | Description |
|---|---|
| `identity` | `{ userId, username }` à la connexion (dérivés du compte) |
| `auth:required` | Jeton de session absent/invalide : le client doit se reconnecter |
| `room:users` | Liste complète des utilisateurs de la salle |
| `user:joined` / `user:left` | Un utilisateur a rejoint / quitté définitivement |
| `user:reconnected` | Un utilisateur revenu dans la fenêtre de grâce |
| `user:disconnected_temp` | Déconnexion détectée, en attente de reconnexion |
| `message:broadcast` | `{ from, type, data, timestamp }` |
| `message:direct` | `{ from, to, type, data, timestamp }` |

## Chat en temps réel

L'écran de salle propose maintenant un vrai chat : champ de saisie, bouton
Envoyer (ou touche Entrée), messages affichés en bulles avec le pseudo de
l'expéditeur. Un panneau **"Mode avancé"** repliable permet toujours
d'envoyer des données JSON personnalisées (broadcast ou message direct
ciblé), utile pour préparer les futurs échanges d'état de jeu.

### ⚠️ Piège classique en test local : deux onglets du même navigateur

Le compte (et donc l'identité `userId`/pseudo) est maintenant lié au
navigateur via `localStorage`, **partagé entre tous les onglets**. Deux
onglets du même navigateur connectés avec le même compte seront donc vus
comme **un seul et même utilisateur** par le serveur (même `userId`) — ce
qui est le comportement attendu pour un vrai système de comptes.

Pour tester avec plusieurs utilisateurs distincts, deux options fiables :
- créer plusieurs comptes et se connecter avec un compte différent dans
  une fenêtre de navigation privée par utilisateur (les fenêtres privées
  ne partagent pas leur `localStorage`) ;
- ou plusieurs navigateurs différents.

## Identifiants et reconnexion

- Chaque compte (`server/accounts.js`) a un `id` stable. Le `userId` utilisé
  côté salles/chat en est dérivé (`usr_<id-de-compte>`), donc stable tant
  que le compte existe, quel que soit l'onglet ou la reconnexion.
- Le jeton de session (obtenu via `/api/register` ou `/api/login`) est
  stocké en `localStorage` et fourni à chaque connexion Socket.IO ; il ne
  survit pas à un redémarrage du serveur (les sessions vivent en mémoire),
  auquel cas l'utilisateur devra simplement se reconnecter.
- Si une coupure réseau survient pendant qu'un utilisateur est dans une
  salle, il dispose de 25 secondes pour revenir (`room:join` avec le même
  code) avant d'être retiré définitivement de la liste des utilisateurs.

## Prochaine étape suggérée

Ce socle est prêt à recevoir une couche applicative (jeu, tableau blanc
collaboratif, etc.) en s'appuyant sur `message:broadcast` /
`message:direct` pour transporter des données métier arbitraires (état de
jeu, positions, actions...) sans avoir à toucher à la couche réseau.
