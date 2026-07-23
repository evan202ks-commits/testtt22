'use strict';

/**
 * sprites/IslandMap.js
 * ----------------------------------------------------------------------
 * La carte du mini-jeu : une île générée sur une grille de tuiles
 * isométriques (herbe, herbe profonde, sable, pierre, terre, bois/ponton)
 * entourée d'eau, avec du décor (arbres, rochers, buissons, une maison,
 * une barrière, un panneau, un coffre) placé dessus. Tout est généré une
 * seule fois de façon déterministe (même seed pour tout le monde, pas de
 * réseau nécessaire) puis mis en cache.
 *
 * Expose toujours la même API de collision qu'avant (containsPoint,
 * clampToIsland) : la logique de déplacement de GameEngine n'a pas à
 * changer. Expose en plus getDecor() pour que GameEngine puisse trier
 * les objets de décor avec les joueurs (tri peintre commun -> bonne
 * occlusion visuelle, ex: passer derrière un arbre).
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};
window.Game.Sprites = window.Game.Sprites || {};

window.Game.Sprites.IslandMap = {
  baseRadius: 260,
  margin: 20,
  tileSize: 40, // doit correspondre à IsoRenderer.worldUnitsPerTile
  seed: 1337,

  _built: false,
  _tiles: [],       // {i, j, x, y, type, variant}
  _decor: [],        // {x, y, type, seed, scale}
  _shoreTiles: [],   // tuiles terrestres au contact de l'eau (pour le liseré)

  radiusAt(angle) {
    return (
      this.baseRadius +
      this.baseRadius * 0.135 * Math.sin(angle * 3 + 0.6) +
      this.baseRadius * 0.077 * Math.sin(angle * 5 + 2.1) +
      this.baseRadius * 0.042 * Math.sin(angle * 7 + 4.0)
    );
  },

  containsPoint(x, y) {
    const angle = Math.atan2(y, x);
    const dist = Math.hypot(x, y);
    return dist <= this.radiusAt(angle) - this.margin;
  },

  clampToIsland(x, y) {
    const dist = Math.hypot(x, y);
    if (dist === 0) return { x, y };
    const angle = Math.atan2(y, x);
    const allowed = this.radiusAt(angle) - this.margin;
    if (dist <= allowed) return { x, y };
    const scale = allowed / dist;
    return { x: x * scale, y: y * scale };
  },

  // ------------------------------------------------------------------
  // Génération (une seule fois, mise en cache dans l'instance)
  // ------------------------------------------------------------------

  _isLand(dist, edge) {
    return dist <= edge;
  },

  _pathDistance(x, y) {
    // Distance point (x,y) au segment [centre -> point de village],
    // pour tracer un chemin de terre battue rectiligne jusqu'à la maison.
    const ax = 0, ay = 0;
    const bx = Math.cos(this._pathAngle) * this._pathLen;
    const by = Math.sin(this._pathAngle) * this._pathLen;
    const abx = bx - ax, aby = by - ay;
    const apx = x - ax, apy = y - ay;
    const abLen2 = abx * abx + aby * aby;
    let t = abLen2 > 0 ? (apx * abx + apy * aby) / abLen2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + abx * t, cy = ay + aby * t;
    return Math.hypot(x - cx, y - cy);
  },

  _build() {
    if (this._built) return;
    this._built = true;

    const rng = window.Game.mathUtils.rand2D;
    const ts = this.tileSize;
    const extent = Math.ceil((this.baseRadius + ts) / ts);

    this._pathAngle = 0.65; // direction du chemin/village depuis le centre
    this._pathLen = this.baseRadius * 0.62;

    // Quelques centres de "carrières" de pierre, fixes et déterministes.
    const stonePatches = [
      { x: -120, y: 90, r: 55 },
      { x: 140, y: -60, r: 45 },
    ];

    const tiles = [];
    const shoreTiles = [];

    for (let i = -extent; i <= extent; i++) {
      for (let j = -extent; j <= extent; j++) {
        const x = i * ts;
        const y = j * ts;
        const dist = Math.hypot(x, y);
        const angle = Math.atan2(y, x);
        const edge = this.radiusAt(angle);

        if (!this._isLand(dist, edge)) continue; // eau : rien à dessiner (fond océan)

        const coastDist = edge - dist;
        let type = 'grass';
        const n = rng(i, j, this.seed);

        if (coastDist < ts * 1.5) {
          type = 'sand';
        } else if (this._pathDistance(x, y) < ts * 0.75) {
          type = 'dirt';
        } else if (stonePatches.some((p) => Math.hypot(x - p.x, y - p.y) < p.r)) {
          type = 'stone';
        } else {
          type = n > 0.62 ? 'grassDeep' : 'grass';
        }

        tiles.push({ i, j, x, y, type, variant: Math.floor(n * 997) });

        if (type !== 'sand' && coastDist < ts * 2.4) {
          shoreTiles.push({ x, y });
        }
      }
    }

    // Petit ponton en bois : une rangée de tuiles depuis la côte,
    // perpendiculaire au rivage, à un angle fixe (façon quai de pêcheur).
    const dockAngle = 2.4;
    for (let k = 0; k < 4; k++) {
      const edge = this.radiusAt(dockAngle);
      const dist = edge - ts * 0.4 - k * ts;
      const x = Math.cos(dockAngle) * dist;
      const y = Math.sin(dockAngle) * dist;
      const gi = Math.round(x / ts);
      const gj = Math.round(y / ts);
      const existing = tiles.find((t) => t.i === gi && t.j === gj);
      if (existing) {
        existing.type = 'wood';
        existing.variant = 500 + k;
      } else {
        tiles.push({ i: gi, j: gj, x: gi * ts, y: gj * ts, type: 'wood', variant: 500 + k });
      }
    }

    this._tiles = tiles;
    this._shoreTiles = shoreTiles;
    this._buildDecor(tiles, rng);
  },

  _buildDecor(tiles, rng) {
    const decor = [];
    const villageX = Math.cos(this._pathAngle) * this._pathLen;
    const villageY = Math.sin(this._pathAngle) * this._pathLen;

    // Bâtiment principal + touches autour, positions fixes (composition
    // volontaire plutôt qu'aléatoire, pour un vrai petit hameau lisible).
    decor.push({ x: villageX - 55, y: villageY + 20, type: 'fence', seed: 2, scale: 1 });
    decor.push({ x: villageX - 30, y: villageY + 42, type: 'fence', seed: 3, scale: 1 });
    decor.push({ x: villageX + 50, y: villageY + 15, type: 'chest', seed: 4, scale: 1 });

    const typeWeights = [
      ['rock', 0.14], ['rockBig', 0.05],
      ['bush', 0.24], ['chest', 0.01], ['fence', 0.02],
    ];

    tiles.forEach((tile) => {
      if (tile.type !== 'grass' && tile.type !== 'grassDeep') return;
      if (Math.hypot(tile.x, tile.y) < 70) return; // clairière de spawn dégagée
      if (Math.hypot(tile.x - villageX, tile.y - villageY) < 75) return; // pas devant la maison

      const roll = rng(tile.i, tile.j, this.seed + 91);
      if (roll > 0.14) return; // ~14% des tuiles éligibles reçoivent un décor

      const pick = rng(tile.i, tile.j, this.seed + 173);
      let acc = 0;
      let chosen = 'bush';
      for (const [type, weight] of typeWeights) {
        acc += weight;
        if (pick <= acc) { chosen = type; break; }
      }
      const jitterX = (rng(tile.i, tile.j, this.seed + 5) - 0.5) * this.tileSize * 0.5;
      const jitterY = (rng(tile.i, tile.j, this.seed + 6) - 0.5) * this.tileSize * 0.5;
      decor.push({
        x: tile.x + jitterX,
        y: tile.y + jitterY,
        type: chosen,
        seed: Math.floor(rng(tile.i, tile.j, this.seed + 7) * 9999),
        scale: 0.9 + rng(tile.i, tile.j, this.seed + 8) * 0.3,
      });
    });

    this._decor = decor;
  },

  /** Liste des décors du monde (pour tri peintre commun avec les joueurs). */
  getDecor() {
    this._build();
    return this._decor;
  },

  // ------------------------------------------------------------------
  // Rendu
  // ------------------------------------------------------------------

  _shapePoints(segments = 96) {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = this.radiusAt(angle);
      pts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    return pts;
  },

  /**
   * Dessine uniquement le SOL (océan + tuiles). Le décor est dessiné à
   * part par GameEngine, mélangé aux joueurs dans le tri peintre, pour
   * une occlusion correcte (ex: personnage passant derrière un arbre).
   */
  draw(renderer) {
    this._build();
    const ctx = renderer.ctx;

    renderer.drawOcean('#0e3a58');

    // Tri peintre sur les tuiles aussi (cases "hautes" du losange isométrique
    // se chevauchent légèrement entre elles).
    const sorted = this._tiles.slice().sort((a, b) => (a.i + a.j) - (b.i + b.j));
    sorted.forEach((t) => renderer.drawTile(t.x, t.y, t.type, t.variant));

    // Liseré d'écume au contact terre/eau.
    const atlas = window.Game.Sprites.TerrainAtlas;
    this._shoreTiles.forEach((t) => {
      const screen = renderer.worldToScreen(t.x, t.y);
      atlas.drawShoreEdge(ctx, screen, renderer.tileWidth, renderer.tileHeight);
    });

    // Contour net de la côte, par-dessus tout, pour une silhouette lisible.
    const screenPoints = this._shapePoints().map((p) => renderer.worldToScreen(p.x, p.y));
    ctx.save();
    ctx.beginPath();
    screenPoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 246, 214, 0.35)';
    ctx.stroke();
    ctx.restore();
  },
};
