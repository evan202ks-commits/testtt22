'use strict';

/**
 * game/Player.js
 * ----------------------------------------------------------------------
 * Représente un joueur dans le mini-jeu : identité + position dans le
 * monde + état d'animation (direction affichée, marche/course, en
 * mouvement ou non, horloge d'animation locale). Ne sait rien du réseau
 * ni du rendu : une entité de données pure, mise à jour par GameEngine
 * et lue par game/render/CharacterAvatar.js pour choisir quelle ligne/
 * colonne du sprite-sheet afficher (voir game/render/SpriteAnimator.js).
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

    // État d'animation : direction affichée (4 sens — voir
    // game/render/SpriteAnimator.js), marche/course en cours, et horloge
    // locale (avance seulement pendant le mouvement pour un cycle
    // cohérent).
    this.facingDirection = 'down';
    this.isMoving = false;
    this.isRunning = false;
    this.animTime = 0;

    // Point d'accroche pour de futures mécaniques (récolte, interaction,
    // attaque) : purement cosmétique tant que rien ne l'appelle — voir
    // triggerAction() plus bas. N'affecte aucune mécanique existante.
    this.actionState = null;
    this._actionExpiresAt = 0;

    // Zone courante (voir game/render/WorldBuilder.js). Purement
    // informatif pour l'affichage/collision ; ne change rien au protocole
    // réseau existant (juste un champ de plus dans le payload générique
    // {x, y, zone} — voir game/GameNetwork.js).
    this.zone = 'village';

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

  /**
   * Déclenche une animation d'action ponctuelle (ex: 'harvest',
   * 'interact', 'attack') pendant durationMs, puis retombe toute seule
   * sur idle/walk. Rien n'appelle cette méthode aujourd'hui — c'est un
   * point d'accroche prêt pour une future mécanique (récolte, etc.) sans
   * avoir à retoucher le moteur de rendu.
   */
  triggerAction(name, durationMs = 500) {
    this.actionState = name;
    this._actionExpiresAt = Date.now() + durationMs;
  }

  /** Action encore active à l'instant `now` (ms), sinon null. */
  getActiveAction(now = Date.now()) {
    if (!this.actionState || now >= this._actionExpiresAt) return null;
    return this.actionState;
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
   * MONDE (dx, dy) mesuré sur ce pas de temps, et de l'état "course".
   * La direction est réduite aux 4 sens d'un sprite top-down classique
   * (bas/gauche/droite/haut) plutôt qu'un angle continu.
   */
  updateAnimation(dt, worldDX, worldDY, running = false) {
    const moveDistSq = worldDX * worldDX + worldDY * worldDY;
    const threshold = 0.02;
    this.isMoving = moveDistSq > threshold * threshold;
    this.isRunning = this.isMoving && running;

    if (this.isMoving) {
      this.facingDirection =
        Math.abs(worldDX) > Math.abs(worldDY)
          ? (worldDX > 0 ? 'right' : 'left')
          : (worldDY > 0 ? 'down' : 'up');
      this.animTime += dt;
    } else {
      this.animTime += dt * 0.5; // continue doucement pour l'animation idle
    }
  }
};
