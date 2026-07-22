'use strict';

/**
 * sprites/CircleSprite.js
 * ----------------------------------------------------------------------
 * Représentation visuelle actuelle d'un personnage : un simple rond
 * (+ ombre au sol + étiquette de pseudo), en attendant de vrais sprites
 * (image, spritesheet animée...).
 *
 * Ce module ne connaît NI le réseau NI la logique de jeu : il sait juste
 * dessiner un personnage à une position écran donnée, sur un contexte
 * canvas 2D. C'est le seul endroit du projet qui décrit "à quoi ressemble
 * un joueur" — pour ajouter de vrais sprites plus tard, il suffira
 * d'ajouter un autre fichier ici (ex: ImageSprite.js) et de le brancher
 * dans IsoRenderer à la place de CircleSprite, sans toucher au moteur.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};
window.Game.Sprites = window.Game.Sprites || {};

window.Game.Sprites.CircleSprite = {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x: number, y: number}} screen position écran (déjà projetée)
   * @param {{radius?: number, color?: string, isMe?: boolean, label?: string}} [options]
   */
  draw(ctx, screen, { radius = 16, color = '#33d6b6', isMe = false, label = '' } = {}) {
    // Ombre elliptique au sol : renforce la lecture de la perspective iso.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y + radius * 0.35, radius * 0.9, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    ctx.restore();

    // Corps du personnage : une boule (dégradé + reflet), forme simple
    // sans sprite/animation, mais avec un peu de volume.
    ctx.save();
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    const bodyGradient = ctx.createRadialGradient(
      screen.x - radius * 0.35, screen.y - radius * 0.4, radius * 0.1,
      screen.x, screen.y, radius
    );
    bodyGradient.addColorStop(0, '#ffffff');
    bodyGradient.addColorStop(0.18, color);
    bodyGradient.addColorStop(1, color);
    ctx.fillStyle = bodyGradient;
    ctx.fill();
    ctx.lineWidth = isMe ? 3 : 1.5;
    ctx.strokeStyle = isMe ? '#ffffff' : 'rgba(0, 0, 0, 0.4)';
    ctx.stroke();
    ctx.restore();

    // Petit reflet elliptique en plus, pour accentuer l'effet "boule".
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(
      screen.x - radius * 0.35, screen.y - radius * 0.4,
      radius * 0.3, radius * 0.18,
      -0.6, 0, Math.PI * 2
    );
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fill();
    ctx.restore();

    if (label) {
      this._drawLabel(ctx, screen, radius, label, isMe);
    }
  },

  _drawLabel(ctx, screen, radius, label, isMe) {
    ctx.save();
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    const padding = 6;
    const textWidth = ctx.measureText(label).width;
    const boxWidth = textWidth + padding * 2;
    const boxHeight = 18;
    const boxX = screen.x - boxWidth / 2;
    const boxY = screen.y - radius - boxHeight - 8;

    ctx.fillStyle = 'rgba(10, 15, 26, 0.75)';
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    ctx.fillStyle = isMe ? '#8fb8ff' : '#dfe6f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, screen.x, boxY + boxHeight / 2 + 1);
    ctx.restore();
  },
};
