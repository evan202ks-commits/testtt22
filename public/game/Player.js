'use strict';

/**
 * game/Player.js
 * ----------------------------------------------------------------------
 * Représente un joueur dans le mini-jeu : identité + position dans le
 * monde + état d'animation (direction affichée, en mouvement ou non,
 * horloge d'animation locale). Ne sait rien du réseau ni du rendu : une
 * entité de données pure, mise à jour par GameEngine et lue par
 * game/render/WorldRenderer.js pour l'affichage 2D (sprite orienté selon
 * la direction de marche).
 *
 * Course : aucun champ réseau dédié n'est nécessaire. updateAnimation
 * mesure la vitesse réelle du déplacement (dx, dy sur ce pas de temps) et
 * la compare à la vitesse de marche de référence pour en déduire
 * `speedFactor` (~1 en marche, ~1.8 en course) : plus ce facteur est
 * grand, plus le cycle de marche avance vite. Ça marche aussi bien pour
 * le joueur local (déplacement direct) que pour les joueurs distants
 * (dont on ne connaît que les positions successives reçues par le
 * réseau) : un joueur qui court franchit plus de distance par seconde,
 * donc son animTime avance plus vite, sans rien transporter en plus.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

// Vitesse de marche de référence (voir game/GameEngine.js : speedWalk).
// Sert uniquement à convertir une vitesse mesurée en facteur d'animation
// relatif ; ce n'est pas ce module qui déplace le joueur.
const WALK_REFERENCE_SPEED = 165;

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

    // État d'animation : angle de direction (radians — le rendu 2D choisit
    // la ligne de sprite bas/gauche/haut/droite la plus proche de cet
    // angle, voir game/render/WorldRenderer.js), marche en cours ou non,
    // et horloge locale (avance seulement pendant le mouvement pour un
    // cycle de marche cohérent).
    this.facingAngle = 0;
    this.isMoving = false;
    this.animTime = 0;
    // Facteur de vitesse courant (0 = immobile, ~1 = marche, ~1.8 = course).
    // Lu par game/render/WorldRenderer.js pour accélérer/amplifier le
    // rebond du sprite quand le joueur court.
    this.speedFactor = 0;

    // Bulle de chat au-dessus de la tête : dernier message envoyé par ce
    // joueur, affiché temporairement puis effacé tout seul (voir
    // showChatBubble / getVisibleChatText).
    this.chatText = '';
    this.chatExpiresAt = 0;
  }

  setTarget(x, y) {
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Affiche `text` dans une bulle au-dessus du joueur pendant `durationMs`.
   * Un nouveau message remplace immédiatement le précédent et relance le
   * minuteur d'affichage.
   */
  showChatBubble(text, durationMs = 6000) {
    this.chatText = text;
    this.chatExpiresAt = Date.now() + durationMs;
  }

  /** Texte de bulle encore valide à l'instant `now` (ms), sinon chaîne vide. */
  getVisibleChatText(now = Date.now()) {
    if (!this.chatText || now >= this.chatExpiresAt) return '';
    return this.chatText;
  }

  // Rapproche progressivement la position affichée de la dernière
  // position réseau connue. Purement cosmétique : masque la latence et
  // la fréquence d'échantillonnage des messages réseau.
  interpolate(dt, rate = 12) {
    if (this.isLocal) return;
    this.x = window.Game.mathUtils.smoothTo(this.x, this.targetX, rate, dt);
    this.y = window.Game.mathUtils.smoothTo(this.y, this.targetY, rate, dt);
  }

  /**
   * Met à jour l'état d'animation à partir d'un vecteur de déplacement
   * MONDE (dx, dy) mesuré sur ce pas de temps. L'angle de direction se
   * calcule directement dans l'espace monde (atan2), et c'est le
   * renderer qui décide comment l'afficher (choix de la ligne de sprite).
   */
  updateAnimation(dt, worldDX, worldDY) {
    const moveDist = Math.hypot(worldDX, worldDY);
    const threshold = 0.02;
    this.isMoving = moveDist > threshold;

    if (this.isMoving) {
      this.facingAngle = Math.atan2(worldDX, worldDY);
      const measuredSpeed = dt > 0 ? moveDist / dt : 0;
      this.speedFactor = window.Game.mathUtils.clamp(
        measuredSpeed / WALK_REFERENCE_SPEED, 0.6, 2.2
      );
      this.animTime += dt * this.speedFactor;
    } else {
      this.speedFactor = 0;
      this.animTime += dt * 0.5; // continue doucement pour l'animation idle
    }
  }
};
