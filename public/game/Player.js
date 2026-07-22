'use strict';

/**
 * game/Player.js
 * ----------------------------------------------------------------------
 * Représente un joueur dans le mini-jeu : identité + position dans le
 * monde. Ne sait rien du réseau ni du rendu : c'est une entité de données
 * pure, ce qui la rend facile à faire évoluer plus tard (inventaire,
 * points de vie, direction du regard, animation en cours, etc.).
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.Player = class Player {
  constructor({ id, username, x = 0, y = 0, color, isLocal = false }) {
    this.id = id;
    this.username = username || 'Joueur';
    this.isLocal = isLocal;
    this.color = color || window.Game.mathUtils.colorForUserId(id);

    // Position affichée (interpolée pour les joueurs distants).
    this.x = x;
    this.y = y;

    // Position réseau la plus récente reçue pour ce joueur (cible vers
    // laquelle on interpole). Pour le joueur local, x/y == targetX/targetY
    // en permanence puisqu'il est piloté directement par les entrées.
    this.targetX = x;
    this.targetY = y;
  }

  setTarget(x, y) {
    this.targetX = x;
    this.targetY = y;
  }

  // Rapproche progressivement la position affichée de la dernière
  // position réseau connue. Purement cosmétique : masque la latence et
  // la fréquence d'échantillonnage des messages réseau.
  interpolate(dt, rate = 12) {
    if (this.isLocal) return;
    this.x = window.Game.mathUtils.smoothTo(this.x, this.targetX, rate, dt);
    this.y = window.Game.mathUtils.smoothTo(this.y, this.targetY, rate, dt);
  }
};
