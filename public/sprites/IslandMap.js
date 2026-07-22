'use strict';

/**
 * sprites/IslandMap.js
 * ----------------------------------------------------------------------
 * La "carte" du mini-jeu : une île, dessinée comme une forme simple
 * (polygone rempli, pas de tuiles/textures) flottant sur un fond d'océan.
 *
 * Comme pour CircleSprite, ce module ne connaît ni le réseau ni les
 * entités joueur : il expose juste
 *   - une forme (calculée depuis une fonction radiusAt(angle), pour que
 *     le contour reste organique sans dépendre d'assets externes),
 *   - une méthode de collision (clampToIsland) pour empêcher un joueur
 *     de sortir en mer,
 *   - une méthode de dessin (draw) qui utilise l'IsoRenderer fourni.
 *
 * C'est le point d'extension prévu pour la "vraie" carte plus tard
 * (tuiles, obstacles, plusieurs zones...) : il suffira d'enrichir ou de
 * remplacer ce fichier, sans toucher au moteur de jeu.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};
window.Game.Sprites = window.Game.Sprites || {};

window.Game.Sprites.IslandMap = {
  // Rayon moyen de l'île, en unités monde (mêmes unités que les
  // positions des joueurs). Volontairement modeste : une île plus
  // petite qu'un monde ouvert, avec de l'eau bien visible tout autour.
  baseRadius: 260,

  // Marge de sécurité : un joueur ne peut pas s'approcher du bord à
  // moins de cette distance (évite qu'il ait "les pieds dans l'eau").
  margin: 20,

  // Taille d'une "case" (en unités monde) sur laquelle un joueur se
  // déplace. Sert à la fois de repère visuel (grille dessinée sur l'île)
  // et de futur point d'ancrage pour des mécaniques basées sur des
  // tuiles (obstacles, objets...).
  tileSize: 40,

  /**
   * Rayon de l'île à un angle donné (radians). Somme de quelques
   * sinusoïdes à fréquences différentes : ça donne un contour organique
   * (baies, avancées) tout en restant 100% déterministe, sans assets ni
   * génération aléatoire à charger. Amplitudes proportionnelles à
   * baseRadius pour garder la même silhouette quelle que soit la taille.
   */
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

  /**
   * Ramène (x, y) à l'intérieur de l'île si le point est en dehors —
   * la "collision" avec la côte : c'est la LIMITE dure de la carte, un
   * joueur ne peut jamais aller au-delà (donc jamais dans l'eau).
   * Conserve la direction du déplacement, coupe juste sa portée.
   */
  clampToIsland(x, y) {
    const dist = Math.hypot(x, y);
    if (dist === 0) return { x, y };
    const angle = Math.atan2(y, x);
    const allowed = this.radiusAt(angle) - this.margin;
    if (dist <= allowed) return { x, y };
    const scale = allowed / dist;
    return { x: x * scale, y: y * scale };
  },

  _shapePoints(segments = 72) {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = this.radiusAt(angle);
      pts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    return pts;
  },

  _traceIslandPath(ctx, screenPoints) {
    ctx.beginPath();
    screenPoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  },

  /**
   * Dessine la grille des cases sur lesquelles un joueur se déplace,
   * restreinte à l'intérieur de l'île (via un clip sur sa silhouette).
   * C'est un simple quadrillage en unités monde, projeté en iso comme
   * le reste : chaque case fait `tileSize` unités de côté.
   */
  _drawTileGrid(renderer, screenPoints) {
    const ctx = renderer.ctx;
    const extent = Math.ceil((this.baseRadius * 1.2) / this.tileSize);

    ctx.save();
    this._traceIslandPath(ctx, screenPoints);
    ctx.clip();

    ctx.strokeStyle = 'rgba(63, 46, 20, 0.28)';
    ctx.lineWidth = 1;
    for (let i = -extent; i <= extent; i++) {
      const a = renderer.worldToScreen(i * this.tileSize, -extent * this.tileSize);
      const b = renderer.worldToScreen(i * this.tileSize, extent * this.tileSize);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      const c = renderer.worldToScreen(-extent * this.tileSize, i * this.tileSize);
      const d = renderer.worldToScreen(extent * this.tileSize, i * this.tileSize);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    ctx.restore();
  },

  /**
   * Dessine l'océan (fond plein écran, bien visible autour de l'île),
   * puis l'île avec un dégradé sable -> herbe, sa côte, et enfin la
   * grille des cases par-dessus pour que les déplacements soient lisibles.
   * @param {InstanceType<typeof window.Game.IsoRenderer>} renderer
   */
  draw(renderer) {
    const ctx = renderer.ctx;

    // Océan : remplit tout le canvas visible, tout autour de l'île.
    ctx.save();
    ctx.fillStyle = '#0a3550';
    ctx.fillRect(0, 0, renderer.width, renderer.height);
    ctx.restore();

    const screenPoints = this._shapePoints().map((p) => renderer.worldToScreen(p.x, p.y));
    const center = renderer.worldToScreen(0, 0);
    const edge = renderer.worldToScreen(this.baseRadius, 0);
    const screenRadius = Math.hypot(edge.x - center.x, edge.y - center.y) * 1.35;

    ctx.save();
    this._traceIslandPath(ctx, screenPoints);

    const gradient = ctx.createRadialGradient(center.x, center.y, screenRadius * 0.08, center.x, center.y, screenRadius);
    gradient.addColorStop(0, '#e4d193');
    gradient.addColorStop(0.55, '#cdb46c');
    gradient.addColorStop(1, '#6f9c54');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    this._drawTileGrid(renderer, screenPoints);

    // Liseré de côte, redessiné par-dessus la grille pour un bord net.
    ctx.save();
    this._traceIslandPath(ctx, screenPoints);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 246, 214, 0.55)';
    ctx.stroke();
    ctx.restore();
  },
};
