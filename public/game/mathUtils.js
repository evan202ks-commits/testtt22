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

  // Petit PRNG déterministe (mulberry32) : à partir d'une graine entière,
  // produit toujours la même séquence de nombres pseudo-aléatoires. Sert
  // à générer des textures/décors "aléatoires" mais identiques pour tout
  // le monde (aucune sauvegarde/réseau nécessaire pour la carte).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Hash 2D stable (grille -> entier), utilisé pour dériver le type de
  // tuile/décor à une case donnée sans stocker une grille en mémoire.
  function hash2D(x, y, seed = 0) {
    const h = hashString(`${x}|${y}|${seed}`);
    return h;
  }

  function rand2D(x, y, seed = 0) {
    return mulberry32(hash2D(x, y, seed))();
  }

  // Contraint un point (x, y) à l'intérieur d'un disque de rayon `radius`
  // centré sur l'origine. Sert de zone de collision pour chaque planète
  // (voir game/render/PlanetBuilder.js) — même principe que l'ancien
  // clampToIsland, généralisé pour un rayon variable par biome.
  function clampToDisc(x, y, radius) {
    const dist = Math.sqrt(x * x + y * y);
    if (dist <= radius || dist === 0) return { x, y };
    const scale = radius / dist;
    return { x: x * scale, y: y * scale };
  }

  // Hauteur du sol à une distance `r` du centre de la planète. Le jeu
  // est volontairement passé à une structure 2D plate façon vieux RPG :
  // le sol est un disque plat (0 partout, quel que soit r), et c'est la
  // caméra (angle fixe, légèrement en hauteur — voir PlanetRenderer)
  // qui donne l'impression de profondeur, pas un relief 3D. Fonction et
  // signature conservées telles quelles (et toujours utilisées partout :
  // sol, décor, portails, avatars, caméra — voir game/render/*.js) pour
  // que ce seul changement suffise à aplatir tout le monde d'un coup.
  function domeHeight(r, radius, bulgeFactor = 1.6) {
    return 0;
  }

  return {
    clamp, lerp, smoothTo, hashString, colorForUserId,
    mulberry32, hash2D, rand2D, clampToDisc, domeHeight,
  };
})();
