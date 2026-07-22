# realtime-comm-infra

Infrastructure de communication temps réel entre navigateurs, basée sur
**Node.js + Express + Socket.IO**. Ce projet est volontairement **neutre :
il ne contient aucune règle de jeu**. C'est un socle réseau destiné à
servir de fondation à un futur jeu multijoueur (ou toute autre application
temps réel).

## Ce que fournit l'infrastructure

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
├── server/
│   ├── index.js         # Serveur Express + Socket.IO (couche réseau)
│   └── roomManager.js    # Gestion des salles/utilisateurs (couche métier)
└── public/
    ├── index.html        # Accueil + écran de salle
    ├── style.css          # Interface (thème "console d'exploitation réseau")
    └── client.js           # Logique client Socket.IO
```

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

## Protocole (évènements Socket.IO)

### Client → Serveur

| Évènement | Payload | Réponse (callback) |
|---|---|---|
| `room:create` | `{ username }` | `{ ok, roomCode, userId, users }` |
| `room:join` | `{ roomCode, username }` | `{ ok, roomCode, userId, users }` ou `{ ok:false, error }` |
| `room:leave` | `{}` | `{ ok:true }` |
| `message:broadcast` | `{ type, data }` | — (diffusé à toute la salle, y compris l'émetteur) |
| `message:direct` | `{ targetUserId, type, data }` | `{ ok, envelope }` ou `{ ok:false, error }` |
| `ping:measure` | `timestamp` (nombre) | renvoie le même timestamp (calcul du RTT côté client) |
| `ping:report` | `rtt` (ms) | — (stocké et diffusé dans `room:users`) |

### Serveur → Client

| Évènement | Description |
|---|---|
| `identity` | `{ userId, isNewIdentity }` à la connexion |
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

Si vous testez avec deux onglets du **même** navigateur, gardez à l'esprit
que l'identifiant utilisateur est stocké en `sessionStorage` (propre à
chaque onglet), pas en `localStorage` (qui serait partagé entre onglets).
Cette distinction est volontaire : avec `localStorage`, deux onglets du
même navigateur auraient partagé le même `userId`, et le serveur les
aurait confondus pour un seul et même utilisateur — ce qui explique un
symptôme classique de "les messages n'arrivent pas en temps réel entre mes
deux fenêtres". Avec `sessionStorage`, chaque onglet garde sa propre
identité (qui survit à un F5), sans se mélanger avec les autres onglets.

Pour tester avec plusieurs utilisateurs, deux options fiables :
- plusieurs onglets du même navigateur (fonctionne grâce à `sessionStorage`) ;
- ou plusieurs navigateurs / fenêtres de navigation privée, pour un test
  encore plus proche de la réalité (utilisateurs sur des machines différentes).

## Identifiants et reconnexion

- Le serveur attribue un `userId` stable (`usr_<uuid>`), transmis au
  client via l'évènement `identity` et stocké en `localStorage`.
- À chaque connexion, ce `userId` est renvoyé au serveur via
  `socket.handshake.auth.userId`, ce qui permet de retrouver la bonne
  identité même après un rechargement de page ou une coupure réseau.
- Si une coupure survient pendant qu'un utilisateur est dans une salle, il
  dispose de 25 secondes pour revenir (`room:join` avec le même code) avant
  d'être retiré définitivement de la liste des utilisateurs.

## Prochaine étape suggérée

Ce socle est prêt à recevoir une couche applicative (jeu, tableau blanc
collaboratif, etc.) en s'appuyant sur `message:broadcast` /
`message:direct` pour transporter des données métier arbitraires (état de
jeu, positions, actions...) sans avoir à toucher à la couche réseau.
