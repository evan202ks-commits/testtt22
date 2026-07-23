'use strict';

/**
 * sprites/DecorSprites.js
 * ----------------------------------------------------------------------
 * Objets de décor du monde (arbres, rochers, maisons, barrières,
 * panneaux, coffres), dessinés procéduralement (formes + dégradés),
 * mis en cache sur canvas hors-écran par (type, seed). Ancrés par leur
 * point de base (contact au sol), pour s'intégrer au tri peintre de
 * GameEngine comme n'importe quelle entité du monde.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};
window.Game.Sprites = window.Game.Sprites || {};

window.Game.Sprites.DecorSprites = (function () {
  const rand = window.Game.mathUtils.mulberry32;
  const cache = new Map();

  function shadow(ctx, w, h, x, y) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 15, 10, 0.32)';
    ctx.fill();
    ctx.restore();
  }

  function outlinePath(ctx, color = 'rgba(35, 25, 15, 0.55)', width = 1.4) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // -- Arbre : forme simple sans texture. --
  function drawTree(ctx, rng, big) {
    const scale = big ? 1.35 : 1;
    shadow(ctx, 22 * scale, 8 * scale, 0, -1);

    // Tronc simple
    ctx.save();
    ctx.fillStyle = '#6b4422';
    ctx.fillRect(-3 * scale, -32 * scale, 6 * scale, 32 * scale);
    ctx.restore();

    // Feuillage : un seul cercle plat
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, -46 * scale, 22 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#3a7a28';
    ctx.fill();
    ctx.restore();
  }

  // -- Rocher : polygone irrégulier + facettes ombrées. --
  function drawRock(ctx, rng, big) {
    const scale = big ? 1.3 : 1;
    shadow(ctx, 16 * scale, 6 * scale, 0, 0);
    const pts = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = (9 + rng() * 5) * scale;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6 - 8 * scale });
    }
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    const g = ctx.createLinearGradient(-10 * scale, -20 * scale, 10 * scale, 4 * scale);
    g.addColorStop(0, '#d8d3ca');
    g.addColorStop(0.6, '#aaa399');
    g.addColorStop(1, '#7c766c');
    ctx.fillStyle = g;
    ctx.fill();
    outlinePath(ctx, 'rgba(40, 36, 30, 0.55)');
    ctx.restore();

    // Facette sombre pour le volume.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[2].x, pts[2].y);
    ctx.lineTo(pts[3].x, pts[3].y);
    ctx.lineTo(pts[4].x, pts[4].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(40, 35, 30, 0.22)';
    ctx.fill();
    ctx.restore();
  }

  // -- Maison : base + toit à deux pans, style chalet fantasy. --
  function drawHouse(ctx, rng) {
    shadow(ctx, 46, 14, 4, 4);

    // Murs
    ctx.save();
    const wallGrad = ctx.createLinearGradient(-30, 0, 30, 0);
    wallGrad.addColorStop(0, '#e8d9b8');
    wallGrad.addColorStop(1, '#c9b389');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(-30, -46, 60, 46);
    outlinePath(ctx);
    ctx.strokeRect(-30, -46, 60, 46);
    ctx.restore();

    // Colombages (poutres apparentes) pour la touche "médiéval-fantasy".
    ctx.save();
    ctx.strokeStyle = 'rgba(90, 60, 30, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-30, -46); ctx.lineTo(-14, 0);
    ctx.moveTo(30, -46); ctx.lineTo(14, 0);
    ctx.moveTo(-30, -20); ctx.lineTo(30, -20);
    ctx.stroke();
    ctx.restore();

    // Porte
    ctx.save();
    ctx.fillStyle = '#5c3a1e';
    ctx.beginPath();
    ctx.moveTo(-9, 0); ctx.lineTo(-9, -22); ctx.quadraticCurveTo(0, -28, 9, -22); ctx.lineTo(9, 0);
    ctx.closePath();
    ctx.fill();
    outlinePath(ctx, 'rgba(30, 18, 8, 0.6)', 1.2);
    ctx.restore();

    // Fenêtre
    ctx.save();
    ctx.fillStyle = '#7fb8d6';
    ctx.fillRect(14, -38, 10, 10);
    ctx.strokeStyle = 'rgba(60, 40, 15, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(14, -38, 10, 10);
    ctx.beginPath();
    ctx.moveTo(19, -38); ctx.lineTo(19, -28);
    ctx.moveTo(14, -33); ctx.lineTo(24, -33);
    ctx.stroke();
    ctx.restore();

    // Toit à deux pans (vue iso simplifiée).
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-38, -46);
    ctx.lineTo(0, -78);
    ctx.lineTo(38, -46);
    ctx.lineTo(30, -46);
    ctx.lineTo(0, -68);
    ctx.lineTo(-30, -46);
    ctx.closePath();
    const roofGrad = ctx.createLinearGradient(0, -78, 0, -46);
    roofGrad.addColorStop(0, '#c1503b');
    roofGrad.addColorStop(1, '#8f3627');
    ctx.fillStyle = roofGrad;
    ctx.fill();
    outlinePath(ctx, 'rgba(40, 15, 10, 0.55)');
    ctx.restore();

    // Cheminée
    ctx.save();
    ctx.fillStyle = '#8a7c6d';
    ctx.fillRect(16, -70, 8, 16);
    outlinePath(ctx, 'rgba(40,35,30,0.5)', 1);
    ctx.restore();
  }

  // -- Barrière en bois. --
  function drawFence(ctx, rng) {
    shadow(ctx, 20, 5, 0, 1);
    ctx.save();
    ctx.strokeStyle = '#6b4a28';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-18, -6); ctx.lineTo(18, -6);
    ctx.moveTo(-18, -14); ctx.lineTo(18, -14);
    ctx.stroke();
    for (let i = -16; i <= 16; i += 8) {
      ctx.fillStyle = '#8a6238';
      ctx.fillRect(i - 2, -22, 4, 22);
      outlinePath(ctx, 'rgba(40, 25, 10, 0.5)', 1);
      ctx.strokeRect(i - 2, -22, 4, 22);
    }
    ctx.restore();
  }

  // -- Panneau indicateur en bois. --
  function drawSign(ctx, rng) {
    shadow(ctx, 10, 4, 0, 1);
    ctx.save();
    ctx.fillStyle = '#6b4a28';
    ctx.fillRect(-2, -30, 4, 30);
    ctx.save();
    ctx.translate(0, -34);
    ctx.rotate(-0.06);
    const g = ctx.createLinearGradient(-16, 0, 16, 0);
    g.addColorStop(0, '#d9b077');
    g.addColorStop(1, '#b98a54');
    ctx.fillStyle = g;
    ctx.fillRect(-16, -9, 32, 18);
    outlinePath(ctx, 'rgba(50, 32, 12, 0.6)');
    ctx.strokeRect(-16, -9, 32, 18);
    ctx.strokeStyle = 'rgba(60, 40, 15, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-10, -2); ctx.lineTo(10, -2);
    ctx.moveTo(-10, 3); ctx.lineTo(4, 3);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  // -- Coffre au trésor. --
  function drawChest(ctx, rng) {
    shadow(ctx, 14, 5, 0, 1);
    ctx.save();
    const bodyGrad = ctx.createLinearGradient(-14, -14, 14, 0);
    bodyGrad.addColorStop(0, '#9a6a35');
    bodyGrad.addColorStop(1, '#6e491f');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(-14, -14, 28, 14);
    outlinePath(ctx, 'rgba(40, 25, 10, 0.6)');
    ctx.strokeRect(-14, -14, 28, 14);

    ctx.beginPath();
    ctx.moveTo(-14, -14);
    ctx.quadraticCurveTo(0, -26, 14, -14);
    const lidGrad = ctx.createLinearGradient(-14, -26, 14, -14);
    lidGrad.addColorStop(0, '#c99a4f');
    lidGrad.addColorStop(1, '#916428');
    ctx.fillStyle = lidGrad;
    ctx.fill();
    outlinePath(ctx, 'rgba(40, 25, 10, 0.6)');

    ctx.fillStyle = '#e8c96a';
    ctx.fillRect(-2.5, -16, 5, 6);
    outlinePath(ctx, 'rgba(90, 65, 20, 0.7)', 1);
    ctx.strokeRect(-2.5, -16, 5, 6);
    ctx.restore();
  }

  // -- Buisson (petit décor de remplissage). --
  function drawBush(ctx, rng) {
    shadow(ctx, 10, 4, 0, 0);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 6;
      const r = 7 - Math.abs(i - 1) * 1.5;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, -r + 1, r, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(x - 2, -r - 1, 1, x, -r + 1, r);
      g.addColorStop(0, '#8fcf62');
      g.addColorStop(1, '#4f8a31');
      ctx.fillStyle = g;
      ctx.fill();
      outlinePath(ctx, 'rgba(25, 40, 15, 0.5)', 1);
      ctx.restore();
    }
  }

  const DRAWERS = {
    tree: (ctx, rng) => drawTree(ctx, rng, false),
    treeBig: (ctx, rng) => drawTree(ctx, rng, true),
    rock: (ctx, rng) => drawRock(ctx, rng, false),
    rockBig: (ctx, rng) => drawRock(ctx, rng, true),
    house: drawHouse,
    fence: drawFence,
    sign: drawSign,
    chest: drawChest,
    bush: drawBush,
  };

  // Empreinte approx. (demi-largeur, hauteur au-dessus du sol) par type,
  // utilisée pour dimensionner le canvas de cache.
  const BOUNDS = {
    tree: { w: 30, h: 92 }, treeBig: { w: 40, h: 118 },
    rock: { w: 24, h: 30 }, rockBig: { w: 30, h: 38 },
    house: { w: 46, h: 86 }, fence: { w: 24, h: 30 },
    sign: { w: 20, h: 46 }, chest: { w: 20, h: 30 }, bush: { w: 16, h: 18 },
  };

  function bake(type, seed) {
    const drawer = DRAWERS[type] || DRAWERS.rock;
    const bound = BOUNDS[type] || { w: 24, h: 40 };
    const pad = 6;
    const canvas = document.createElement('canvas');
    canvas.width = bound.w * 2 + pad * 2;
    canvas.height = bound.h + pad * 2;
    const ctx = canvas.getContext('2d');
    const baseX = canvas.width / 2;
    const baseY = canvas.height - pad;
    ctx.translate(baseX, baseY);
    drawer(ctx, rand(seed));
    return { canvas, baseX, baseY };
  }

  function getBaked(type, seed) {
    const key = `${type}|${seed}`;
    let baked = cache.get(key);
    if (!baked) {
      baked = bake(type, seed);
      cache.set(key, baked);
    }
    return baked;
  }

  return {
    types: Object.keys(DRAWERS),

    /**
     * Dessine un décor dont le point d'ancrage (bas) est `screen`.
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx, screen, type, seed = 0, scale = 1) {
      const baked = getBaked(type, seed);
      const w = baked.canvas.width * scale;
      const h = baked.canvas.height * scale;
      ctx.drawImage(baked.canvas, screen.x - (baked.baseX * scale), screen.y - (baked.baseY * scale), w, h);
    },

    /** Hauteur approx. (pour occlusion/collision simple si besoin plus tard). */
    boundsFor(type) {
      return BOUNDS[type] || { w: 24, h: 40 };
    },
  };
})();
