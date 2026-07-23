'use strict';

/**
 * game/IsoRenderer.js
 * ----------------------------------------------------------------------
 * Responsable UNIQUEMENT du rendu : projection d'un monde cartésien
 * (x, y en unités "monde") vers un écran en vue 3/4 isométrique façon
 * RPG tactique, et primitives de dessin (tuiles de terrain, décor,
 * personnages).
 *
 * `worldUnitsPerTile` sépare l'échelle des déplacements (unités "monde",
 * utilisées pour la vitesse/collision, inchangées) de la taille à
 * l'écran d'une case de la grille (tileWidth x tileHeight, en pixels).
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.IsoRenderer = class IsoRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.tileWidth = options.tileWidth ?? 64;
    this.tileHeight = options.tileHeight ?? 32;
    this.worldUnitsPerTile = options.worldUnitsPerTile ?? 40;

    this.cameraX = 0;
    this.cameraY = 0;
    this.time = 0;

    this.resize();
  }

  resize() {
    // clientWidth/clientHeight can be 0 if the canvas or its overlay is not yet
    // visible (display:none). Fall back to the parent element or window size so
    // the camera math (width/2, height/2) always has a valid reference.
    const parent = this.canvas.parentElement;
    let w = this.canvas.clientWidth || this.canvas.offsetWidth;
    let h = this.canvas.clientHeight || this.canvas.offsetHeight;
    if (!w && parent) w = parent.clientWidth || parent.offsetWidth;
    if (!h && parent) h = parent.clientHeight || parent.offsetHeight;
    if (!w) w = window.innerWidth;
    if (!h) h = window.innerHeight;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = w;
    this.height = h;
  }

  setCamera(x, y) {
    this.cameraX = x;
    this.cameraY = y;
  }

  setTime(t) {
    this.time = t;
  }

  worldToScreen(x, y) {
    const relX = (x - this.cameraX) / this.worldUnitsPerTile;
    const relY = (y - this.cameraY) / this.worldUnitsPerTile;
    const isoX = (relX - relY) * (this.tileWidth / 2);
    const isoY = (relX + relY) * (this.tileHeight / 2);
    return {
      x: this.width / 2 + isoX,
      y: this.height / 2 + isoY,
    };
  }

  worldToScreenVector(dx, dy) {
    return {
      x: (dx - dy) * (this.tileWidth / 2),
      y: (dx + dy) * (this.tileHeight / 2),
    };
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  drawOcean(color = '#0a3550') {
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.restore();
  }

  drawTile(x, y, type, variant = 0) {
    const atlas = window.Game.Sprites?.TerrainAtlas;
    if (!atlas) return;
    const screen = this.worldToScreen(x, y);
    atlas.drawTile(this.ctx, screen, type, variant, this.tileWidth, this.tileHeight, this.time);
  }

  drawDecor(x, y, type, seed = 0, scale = 1) {
    const decor = window.Game.Sprites?.DecorSprites;
    if (!decor) return;
    const screen = this.worldToScreen(x, y);
    decor.draw(this.ctx, screen, type, seed, scale);
    return screen;
  }

  drawGroundGrid({ extent = 12 } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 178, 214, 0.10)';
    ctx.lineWidth = 1;
    const spacing = this.worldUnitsPerTile;

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

  drawPlayerMarker(opts, spriteModule) {
    const sprite = spriteModule || window.Game.Sprites?.CharacterSprite;
    const screen = this.worldToScreen(opts.x, opts.y);
    sprite?.draw(this.ctx, screen, opts);
    return screen;
  }
};
