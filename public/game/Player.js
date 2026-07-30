'use strict';

/**
 * game/Player.js
 * ----------------------------------------------------------------------
 * Représente un joueur dans le mini-jeu : identité + position dans le
 * monde + état d'animation (direction affichée, en mouvement ou non,
 * horloge d'animation locale). Ne sait rien du réseau ni du rendu : une
 * entité de données pure, mise à jour par GameEngine et lue par
 * IsoRenderer/CharacterSprite.
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

    // État d'animation : direction visuelle (8 sens, voir CharacterSprite),
    // marche en cours ou non, et horloge locale (avance seulement pendant
    // le mouvement pour un cycle de marche cohérent).
    this.direction = 'down';
    this.isMoving = false;
    this.animTime = 0;

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
   * MONDE (dx, dy) mesuré sur ce pas de temps. Convertit en vecteur
   * écran iso pour que la direction affichée corresponde à ce qui est
   * réellement vu (gauche/droite à l'écran), pas aux axes bruts du monde.
   */
  updateAnimation(dt, worldDX, worldDY, renderer) {
    const moveDistSq = worldDX * worldDX + worldDY * worldDY;
    const threshold = 0.02;
    this.isMoving = moveDistSq > threshold * threshold;

    if (this.isMoving) {
      const iso = renderer.worldToScreenVector(worldDX, worldDY);
      const dir = window.Game.Sprites.CharacterSprite.directionFromIsoVector(iso.x, iso.y);
      if (dir) this.direction = dir;
      this.animTime += dt;
    } else {
      this.animTime += dt * 0.5; // continue doucement pour l'animation idle
    }
  }
};
