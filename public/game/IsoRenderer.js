'use strict';

/**
 * game/IsoRenderer.js
 * ----------------------------------------------------------------------
 * Responsable UNIQUEMENT du rendu : projection d'un monde cartésien
 * (x, y en unités "monde") vers un écran en vue 3/4 isométrique façon
 * Dofus, et primitives de dessin (formes simples pour l'instant).
 *
 * Ce module ne connaît ni le réseau, ni les entités "joueur", ni les
 * entrées clavier : il sait juste transformer des coordonnées et
 * dessiner. Ça permet de le remplacer ou de l'enrichir (sprites, carte,
 * tuiles, calques...) plus tard sans toucher au reste du jeu.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.IsoRenderer = class IsoRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{tileWidth?: number, tileHeight?: number}} [options]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Ratio 2:1 typique des vues isométriques façon Dofus/Diablo.
    this.tileWidth = options.tileWidth ?? 64;
    this.tileHeight = options.tileHeight ?? 32;

    // Position (en coordonnées monde) sur laquelle la caméra est centrée.
    this.cameraX = 0;
    this.cameraY = 0;

    this.resize();
  }

  resize() {
    const { clientWidth, clientHeight } = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(clientHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = clientWidth;
    this.height = clientHeight;
  }

  setCamera(x, y) {
    this.cameraX = x;
    this.cameraY = y;
  }

  /**
   * Projette une coordonnée monde (cartésienne) en coordonnée écran
   * isométrique, relative à la caméra et centrée dans le canvas.
   */
  worldToScreen(x, y) {
    const relX = x - this.cameraX;
    const relY = y - this.cameraY;
    const isoX = (relX - relY) * (this.tileWidth / 2);
    const isoY = (relX + relY) * (this.tileHeight / 2);
    return {
      x: this.width / 2 + isoX,
      y: this.height / 2 + isoY,
    };
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * Grille de sol purement décorative, pour donner un repère spatial en
   * attendant une vraie carte. Facile à retirer/remplacer plus tard.
   */
  drawGroundGrid({ extent = 12, spacing = 64 } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 178, 214, 0.10)';
    ctx.lineWidth = 1;

    for (let i = -extent; i <= extent; i++) {
      const a = this.worldToScreen(i * spacing, -extent * spacing);
      const b = this.worldToScreen(i * spacing, extent * spacing);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      const c = this.worldToScreen(-extent * spacing, i * spacing);
      const d = this.worldToScreen(extent * spacing, i * spacing);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Dessine un joueur comme une forme simple (cercle + ombre + étiquette
   * de pseudo). Volontairement minimal : c'est le point d'extension prévu
   * pour brancher plus tard un sprite/une animation à la place du cercle.
   */
  drawPlayerMarker({ x, y, radius = 16, color = '#33d6b6', isMe = false, label = '' }) {
    const ctx = this.ctx;
    const screen = this.worldToScreen(x, y);

    // Ombre elliptique au sol (renforce la lecture de la perspective iso).
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y + radius * 0.35, radius * 0.9, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    ctx.restore();

    // Corps : simple cercle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = isMe ? 3 : 1.5;
    ctx.strokeStyle = isMe ? '#ffffff' : 'rgba(0, 0, 0, 0.4)';
    ctx.stroke();
    ctx.restore();

    // Étiquette de pseudo (rectangle simple + texte).
    if (label) {
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
    }

    return screen;
  }
};
