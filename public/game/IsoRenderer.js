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
   * Projette la position monde d'un joueur en écran, puis délègue le
   * dessin lui-même au sprite actif (aujourd'hui un simple rond, défini
   * dans public/sprites/CircleSprite.js). Le renderer n'a donc plus à
   * connaître "à quoi ressemble" un personnage : demain, remplacer
   * `spriteModule` par un sprite animé/à image ne touchera pas ce fichier.
   */
  drawPlayerMarker({ x, y, radius = 16, color = '#33d6b6', isMe = false, label = '' }, spriteModule) {
    const sprite = spriteModule || window.Game.Sprites?.CircleSprite;
    const screen = this.worldToScreen(x, y);
    sprite?.draw(this.ctx, screen, { radius, color, isMe, label });
    return screen;
  }
};
