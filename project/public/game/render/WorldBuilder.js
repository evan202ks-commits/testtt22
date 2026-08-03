'use strict';

/**
 * game/render/WorldBuilder.js
 * ----------------------------------------------------------------------
 * Décrit LE monde 2D (un seul, plus de planètes ni de portails) et sait
 * générer son décor de façon entièrement procédurale (aucune texture/
 * asset externe à part le sprite du personnage : tout est peint à la
 * volée sur des <canvas> 2D). Chaque élément de décor (arbre, buisson,
 * rocher, cristal...) est peint une fois sous forme de petite icône
 * (canvas indépendant), puis WorldRenderer.js se contente de le poser
 * (drawImage) à sa position dans le monde à chaque frame — même principe
 * qu'un vieux RPG en pixel art façon "props" plats vus de dessus.
 *
 * Ce module est un pur "atelier de construction" : il ne connaît rien du
 * joueur, du réseau ni de la boucle de jeu. WorldRenderer.js l'utilise
 * pour peupler la scène une seule fois au chargement (disposition
 * déterministe : même seed => même décor à chaque partie).
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

(function () {
  const mathUtils = window.Game.mathUtils;

  // ------------------------------------------------------------------
  // Petits utilitaires couleur (remplacent THREE.Color de l'ancienne
  // version 3D) : `shade` éclaircit (amount > 0) ou assombrit
  // (amount < 0) une couleur CSS hex ou un entier 0xRRGGBB ; `hex`
  // normalise un entier 0xRRGGBB en chaîne CSS "#rrggbb".
  // ------------------------------------------------------------------
  function parseColor(color) {
    if (typeof color === 'number') {
      return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
    }
    let s = String(color).replace('#', '');
    if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
    const num = parseInt(s, 16) || 0;
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function toHex([r, g, b]) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  }

  function hex(color) {
    return typeof color === 'number' ? toHex(parseColor(color)) : color;
  }

  function shade(color, amount) {
    const [r, g, b] = parseColor(color);
    const target = amount >= 0 ? 255 : 0;
    const t = Math.abs(amount);
    return toHex([r + (target - r) * t, g + (target - g) * t, b + (target - b) * t]);
  }

  function fillPath(ctx, fill, stroke, lw, build) {
    ctx.beginPath();
    build();
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.lineWidth = lw || 4;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------------
  // Config du monde. Une seule entrée : plus de biomes à débloquer par
  // portail, un unique village-prairie cosy où tout le monde se retrouve.
  // ------------------------------------------------------------------
  const WORLD = {
    id: 'world',
    name: 'Constellation',
    subtitle: 'Prairie commune',
    halfWidth: 900,
    halfHeight: 620,
    groundColor: 0x8fcf7a,
    groundColor2: 0x74b862,
    accentColor: 0xffd76a,
    decor: [
      { type: 'tree', count: 24 },
      { type: 'bush', count: 16 },
      { type: 'rock', count: 12 },
      { type: 'mushroom', count: 10 },
      { type: 'lamp', count: 8 },
      { type: 'crystalBush', count: 8 },
      { type: 'cactus', count: 5 },
    ],
    spawn: { x: 0, y: 0 },
  };

  // Icône = fonction(ctx, w, h, rng, accent) qui peint sur un canvas w×h
  // (origine en haut à gauche, base de l'objet posée près de y=h-6).
  const ICONS = {
    tree(ctx, w, h, rng) {
      const cx = w / 2;
      const trunkH = h * 0.28;
      fillPath(ctx, '#7a5232', shade('#7a5232', -0.35), 4, () => {
        ctx.rect(cx - w * 0.07, h - 6 - trunkH, w * 0.14, trunkH);
      });
      const leafColors = ['#5b9a49', '#6fae5a', '#7fc06a'];
      const tiers = 3;
      const topY = h - 6 - trunkH;
      for (let i = tiers - 1; i >= 0; i--) {
        const cy = topY - i * (h * 0.19);
        const r = w * 0.42 - i * w * 0.09;
        fillPath(ctx, leafColors[i % leafColors.length], 'rgba(0,0,0,0.3)', 4, () => {
          ctx.moveTo(cx, cy - r * 1.35);
          ctx.lineTo(cx - r, cy + r * 0.35);
          ctx.quadraticCurveTo(cx, cy + r * 0.6, cx + r, cy + r * 0.35);
        });
      }
    },
    bush(ctx, w, h, rng, accent, color = '#6fae5a') {
      const cx = w / 2, base = h - 6;
      const clumps = 4;
      for (let i = 0; i < clumps; i++) {
        const s = w * (0.22 + rng() * 0.08);
        const px = cx + (rng() - 0.5) * w * 0.5;
        const py = base - s * 0.7 - rng() * h * 0.08;
        fillPath(ctx, shade(color, (rng() - 0.5) * 0.15), 'rgba(0,0,0,0.28)', 3, () => {
          ctx.arc(px, py, s, 0, Math.PI * 2);
        });
      }
    },
    cactus(ctx, w, h, rng) {
      const cx = w / 2;
      const bodyW = w * 0.3;
      const bodyH = h * 0.62;
      const baseY = h - 6;
      const color = '#4f9a5c';
      const drawArm = (side) => {
        const armY = baseY - bodyH * (0.45 + rng() * 0.2);
        fillPath(ctx, color, 'rgba(0,0,0,0.3)', 4, () => {
          ctx.roundRect(cx + side * bodyW * 1.05, armY - bodyH * 0.32, bodyW * 0.6, bodyH * 0.32, bodyW * 0.3);
        });
      };
      if (rng() > 0.4) drawArm(1);
      if (rng() > 0.6) drawArm(-1);
      fillPath(ctx, color, shade(color, -0.3), 4, () => {
        ctx.roundRect(cx - bodyW / 2, baseY - bodyH, bodyW, bodyH, bodyW * 0.45);
      });
    },
    rock(ctx, w, h, rng) {
      const cx = w / 2, base = h - 6;
      const rw = w * 0.42, rh = h * 0.3;
      const pts = 7;
      fillPath(ctx, '#8a8a92', 'rgba(0,0,0,0.32)', 4, () => {
        for (let i = 0; i < pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const rr = 0.75 + rng() * 0.3;
          const px = cx + Math.cos(a) * rw * rr;
          const py = base - rh + Math.sin(a) * rh * rr * 0.7;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      });
      fillPath(ctx, 'rgba(255,255,255,0.18)', null, 0, () => {
        ctx.ellipse(cx - rw * 0.2, base - rh * 1.3, rw * 0.3, rh * 0.35, 0, 0, Math.PI * 2);
      });
    },
    mushroom(ctx, w, h, rng, accent, color = '#ff8a7a') {
      const cx = w / 2, base = h - 6;
      const stemH = h * 0.32;
      fillPath(ctx, '#f3e6d0', shade('#f3e6d0', -0.25), 3, () => {
        ctx.roundRect(cx - w * 0.09, base - stemH, w * 0.18, stemH, w * 0.06);
      });
      const capW = w * 0.4, capH = h * 0.28;
      fillPath(ctx, color, 'rgba(0,0,0,0.3)', 4, () => {
        ctx.ellipse(cx, base - stemH, capW, capH, 0, Math.PI, 0);
      });
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      [[-0.4, 0.35], [0.15, 0.15], [0.45, 0.4]].forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.arc(cx + dx * capW, base - stemH - dy * capH, capW * 0.09, 0, Math.PI * 2);
        ctx.fill();
      });
    },
    crystalBush(ctx, w, h, rng, accent) {
      const cx = w / 2, base = h - 6;
      const color = hex(accent || 0xc9a6ff);
      const glow = ctx.createRadialGradient(cx, base - h * 0.25, 0, cx, base - h * 0.25, w * 0.55);
      glow.addColorStop(0, 'rgba(255,255,255,0.35)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, base - h * 0.25, w * 0.55, 0, Math.PI * 2);
      ctx.fill();
      const shards = 4;
      for (let i = 0; i < shards; i++) {
        const sh = h * (0.3 + rng() * 0.35);
        const sw = w * 0.12;
        const px = cx + (rng() - 0.5) * w * 0.55;
        fillPath(ctx, shade(color, (rng() - 0.5) * 0.2), 'rgba(0,0,0,0.25)', 3, () => {
          ctx.moveTo(px, base - sh);
          ctx.lineTo(px - sw, base);
          ctx.lineTo(px + sw, base);
        });
      }
    },
    lamp(ctx, w, h, rng, accent) {
      const cx = w / 2, base = h - 6;
      const postH = h * 0.58;
      fillPath(ctx, '#6b5a45', shade('#6b5a45', -0.3), 3, () => {
        ctx.roundRect(cx - w * 0.05, base - postH, w * 0.1, postH, w * 0.04);
      });
      const color = hex(accent || 0xffd76a);
      const glow = ctx.createRadialGradient(cx, base - postH, 0, cx, base - postH, w * 0.5);
      glow.addColorStop(0, 'rgba(255,255,255,0.55)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, base - postH, w * 0.5, 0, Math.PI * 2);
      ctx.fill();
      fillPath(ctx, color, 'rgba(0,0,0,0.25)', 3, () => {
        ctx.arc(cx, base - postH, w * 0.16, 0, Math.PI * 2);
      });
    },
  };

  // Taille "monde" (largeur, hauteur) en pixels de chaque type de décor.
  const DECOR_SIZE = {
    tree: [96, 152], bush: [44, 36], cactus: [48, 72],
    rock: [36, 24], mushroom: [27, 32], crystalBush: [44, 52], lamp: [29, 72],
  };

  const CANVAS_W = 160;
  const CANVAS_H = 220;

  function buildDecorCanvas(type, rng, accentColor) {
    const draw = ICONS[type];
    if (!draw) return null;
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    draw(ctx, CANVAS_W, CANVAS_H, rng, accentColor);
    return canvas;
  }

  // ------------------------------------------------------------------
  // Sol : un grand rectangle peint une seule fois sur un canvas (dégradé
  // + petites variations picturales), posé tel quel par WorldRenderer.
  // ------------------------------------------------------------------
  function buildGroundCanvas(world) {
    const w = world.halfWidth * 2;
    const h = world.halfHeight * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    grad.addColorStop(0, hex(world.groundColor));
    grad.addColorStop(1, hex(world.groundColor2));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Tapis d'herbe peint à la main (pas une texture répétée) : quelques
    // taches plus claires/sombres, réparties de façon déterministe.
    const rng = mathUtils.mulberry32(mathUtils.hashString(world.id));
    const spots = Math.round((w * h) / 4200);
    for (let i = 0; i < spots; i++) {
      ctx.globalAlpha = 0.05 + rng() * 0.06;
      ctx.fillStyle = rng() > 0.5 ? '#ffffff' : '#000000';
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, 3 + rng() * 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    return canvas;
  }

  /**
   * Construit le décor complet du monde : sol (canvas déjà peint) et
   * liste de props (arbres, buissons...) placés de façon déterministe
   * (même seed => même disposition à chaque chargement).
   */
  function buildWorld() {
    const ground = buildGroundCanvas(WORLD);
    const rng = mathUtils.mulberry32(mathUtils.hashString(WORLD.id) + 1);
    const clearRadius = 130; // zone de spawn dégagée au centre
    const props = [];

    WORLD.decor.forEach(({ type, count }) => {
      const size = DECOR_SIZE[type] || [40, 50];
      for (let i = 0; i < count; i++) {
        let x, y;
        do {
          x = (rng() * 2 - 1) * WORLD.halfWidth * 0.92;
          y = (rng() * 2 - 1) * WORLD.halfHeight * 0.92;
        } while (Math.hypot(x, y) < clearRadius);
        const canvas = buildDecorCanvas(type, rng, WORLD.accentColor);
        if (!canvas) continue;
        const scale = 0.85 + rng() * 0.4;
        props.push({
          type,
          x,
          y,
          canvas,
          worldW: size[0] * scale,
          worldH: size[1] * scale,
        });
      }
    });

    // Tri par profondeur (y croissant) une fois pour toutes : le sol ne
    // bouge jamais, donc l'ordre de dessin peut être précalculé ici.
    props.sort((a, b) => a.y - b.y);

    return { world: WORLD, ground, props };
  }

  window.Game.WorldBuilder = { WORLD, buildWorld };
})();
