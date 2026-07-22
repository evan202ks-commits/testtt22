'use strict';

/**
 * game/mathUtils.js
 * ----------------------------------------------------------------------
 * Petites fonctions mathématiques pures et sans dépendance, réutilisées
 * par tout le module de jeu (rendu, interpolation réseau, déplacements).
 * Regroupées ici pour ne pas les dupliquer d'un fichier à l'autre.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.mathUtils = (function () {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Interpolation exponentielle indépendante du framerate : `rate` est la
  // "vitesse de rattrapage" par seconde (plus il est grand, plus ça colle
  // vite à la cible). Sert à lisser les positions des joueurs distants
  // reçues par le réseau (qui arrivent par sauts, pas en continu).
  function smoothTo(current, target, rate, dt) {
    const t = 1 - Math.exp(-rate * dt);
    return lerp(current, target, t);
  }

  // Hash simple et stable d'une chaîne -> entier 32 bits. Utilisé pour
  // dériver une couleur déterministe à partir d'un userId, afin que
  // chaque joueur ait toujours la même couleur pour tout le monde sans
  // avoir besoin que le serveur en attribue une.
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function colorForUserId(userId) {
    const hue = hashString(String(userId)) % 360;
    return `hsl(${hue}, 70%, 58%)`;
  }

  return { clamp, lerp, smoothTo, hashString, colorForUserId };
})();
