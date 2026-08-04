'use strict';

/**
 * game/render/WorldBuilder.js
 * ----------------------------------------------------------------------
 * Décrit LE monde 2D — désormais une petite île de départ cosy, cernée
 * d'eau (falaise + écume + herbe), plutôt qu'une simple prairie
 * rectangulaire — et sait générer son décor de façon entièrement
 * procédurale (aucune texture/asset externe à part le sprite du
 * personnage : tout est peint à la volée sur des <canvas> 2D). Chaque
 * élément de décor (arbre, buisson, rocher, cabane, ponton...) est peint
 * une fois sous forme de petite icône (canvas indépendant), puis
 * WorldRenderer.js se contente de le poser (drawImage) à sa position
 * dans le monde à chaque frame — même principe qu'un vieux RPG en pixel
 * art façon "props" plats vus de dessus.
 *
 * La forme de l'île est définie par une fonction radius(angle) (ellipse
 * modulée par quelques harmoniques sinusoïdales, seedée pour être
 * déterministe) : à la fois pour LA DESSINER (falaise/herbe) et pour
 * CONTRAINDRE le déplacement du joueur (voir clampToIsland, utilisée par
 * game/GameEngine.js à la place d'un simple rectangle).
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

  function mix(a, b, t) {
    return a + (b - a) * t;
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
  // Forme de l'île : ellipse (radiusX, radiusY) modulée par quelques
  // harmoniques sinusoïdales déterministes (même seed => même côte
  // "grignotée" à chaque partie, comme sur une vraie petite île).
  // radius(angle) donne la distance du centre jusqu'à la falaise pour un
  // angle donné (repère standard : x = cos(angle)*r, y = sin(angle)*r).
  // ------------------------------------------------------------------
  function makeIslandRadiusFn(seed, radiusX, radiusY) {
    const rng = mathUtils.mulberry32(seed);
    const harmonics = [2, 3, 5, 7].map((freq) => ({
      freq: freq + (rng() < 0.5 ? 0 : 1),
      amp: 0.05 + rng() * 0.09,
      phase: rng() * Math.PI * 2,
    }));
    return function islandRadius(angle) {
      const ellipseR = 1 / Math.sqrt(
        (Math.cos(angle) / radiusX) ** 2 + (Math.sin(angle) / radiusY) ** 2
      );
      let noise = 1;
      harmonics.forEach((hn) => {
        noise += hn.amp * Math.sin(hn.freq * angle + hn.phase);
      });
      return ellipseR * Math.max(0.72, noise);
    };
  }

  function measureBounds(radiusFn, steps = 160) {
    let maxAbsX = 0;
    let maxAbsY = 0;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const r = radiusFn(angle);
      maxAbsX = Math.max(maxAbsX, Math.abs(Math.cos(angle) * r));
      maxAbsY = Math.max(maxAbsY, Math.abs(Math.sin(angle) * r));
    }
    return { maxAbsX, maxAbsY };
  }

  const WORLD_ID = 'starter-island';
  const ISLAND_SEED = mathUtils.hashString(WORLD_ID);
  const RADIUS_X = 760;
  const RADIUS_Y = 480;
  const CLIFF_BAND = 58; // largeur (px monde) de la bande de falaise
  const WATER_MARGIN = 260; // marge d'eau visible au-delà de la côte

  const islandRadiusFn = makeIslandRadiusFn(ISLAND_SEED, RADIUS_X, RADIUS_Y);
  const bounds = measureBounds(islandRadiusFn);

  // ------------------------------------------------------------------
  // Config du monde. Une seule entrée : l'île de départ, un petit
  // campement cosy (cabane, jardin, feu de camp, ponton) où tous les
  // joueurs se retrouvent.
  // ------------------------------------------------------------------
  // Angle "monde" (atan2(y,x), y vers le bas) : 0 = est, +90° = sud,
  // ±180° = ouest, -90° = nord. Sert à placer les éléments fixes de
  // l'île de référence (ponton à l'est, forêt + affleurement rocheux au
  // nord, plages au sud/sud-ouest) à des angles précis plutôt qu'au
  // hasard.
  const deg = (d) => (d * Math.PI) / 180;

  const DOCK_ANGLE = deg(6); // ponton, légèrement sud-est (comme sur la référence)
  const DOCK_R = islandRadiusFn(DOCK_ANGLE) - CLIFF_BAND * 0.4;
  const DOCK_LEN = 300;
  const DOCK_X = Math.cos(DOCK_ANGLE) * DOCK_R;
  const DOCK_Y = Math.sin(DOCK_ANGLE) * DOCK_R;

  const WORLD = {
    id: WORLD_ID,
    name: 'Île de départ',
    subtitle: 'Petite île forestière',
    halfWidth: bounds.maxAbsX + WATER_MARGIN,
    halfHeight: bounds.maxAbsY + WATER_MARGIN,
    groundColor: 0x8fcf7a,
    groundColor2: 0x6fae5a,
    cliffColor: 0x8a5a34,
    waterColor: 0x2f7fbf,
    waterColor2: 0x0f3f66,
    sandColor: 0xe4c98a,
    sandColor2: 0xd4b06e,
    accentColor: 0xffd76a,
    // Petit étang niché au nord-ouest de l'île, comme sur la référence.
    pond: { x: -220, y: -60, rx: 118, ry: 92 },
    // Plages de sable : bandes qui grignotent la côte herbeuse sur des
    // secteurs angulaires précis (sud et sud-ouest), avec une profondeur
    // qui s'estompe en douceur vers les bords du secteur.
    sandZones: [
      { angle: deg(120), width: deg(70), depth: 150 },
      { angle: deg(200), width: deg(80), depth: 190 },
    ],
    // Point d'arrivée : juste au bout du ponton, comme un joueur qui
    // vient de débarquer sur l'île.
    spawn: { x: DOCK_X - 40, y: DOCK_Y - 6 },
    boundaryRadius: islandRadiusFn,
    grassRadius(angle) {
      return islandRadiusFn(angle) - CLIFF_BAND;
    },
    // Décor semé aléatoirement. angleRange/spreadRange (optionnels)
    // limitent respectivement le secteur angulaire et la distance au
    // centre (fraction du rayon) où le type peut apparaître — utilisé
    // pour concentrer les conifères au nord (forêt) et laisser le reste
    // de l'île plus clairsemé, comme sur la référence.
    decor: [
      { type: 'pine', count: 26, angleRange: [deg(-150), deg(-25)], spreadRange: [0.3, 0.92] },
      { type: 'tree', count: 10, angleRange: [deg(-130), deg(-10)], spreadRange: [0.35, 0.85] },
      { type: 'tree', count: 9, spreadRange: [0.2, 0.7] },
      { type: 'appleTree', count: 3, spreadRange: [0.3, 0.6] },
      { type: 'bush', count: 14, spreadRange: [0.2, 0.85] },
      { type: 'rock', count: 16, spreadRange: [0.3, 0.95] },
      { type: 'mushroom', count: 10, angleRange: [deg(-150), deg(-25)], spreadRange: [0.35, 0.85] },
      { type: 'flower', count: 16, spreadRange: [0.2, 0.9] },
      { type: 'stump', count: 5, angleRange: [deg(-150), deg(-25)], spreadRange: [0.35, 0.85] },
    ],
    landmarks: [
      // Affleurement rocheux boisé au sommet nord de l'île.
      { type: 'rockPlateau', x: 0, y: -300, scale: 1 },
      { type: 'pine', x: 40, y: -370, scale: 1.05 },
      // Ponton en bois vers l'est, tourné pour s'avancer sur l'eau.
      {
        type: 'dock', x: DOCK_X, y: DOCK_Y, scale: DOCK_LEN / 300,
        rotation: DOCK_ANGLE + Math.PI / 2,
      },
      {
        type: 'lamp',
        x: DOCK_X + Math.cos(DOCK_ANGLE) * DOCK_LEN,
        y: DOCK_Y + Math.sin(DOCK_ANGLE) * DOCK_LEN,
        scale: 1,
      },
    ],
  };

  /**
   * Contraint un point (x, y) à l'intérieur du tapis d'herbe de l'île
   * (jamais sur la falaise ni dans l'eau). Remplace l'ancien
   * clampToRect : la limite dépend de l'angle (côte irrégulière), pas
   * d'un simple rectangle.
   */
  function clampToIsland(x, y, margin = 0) {
    const angle = Math.atan2(y, x);
    const maxR = WORLD.grassRadius(angle) - margin;
    const dist = Math.hypot(x, y);
    if (maxR <= 0 || dist <= maxR) return { x, y };
    const scale = maxR / dist;
    return { x: x * scale, y: y * scale };
  }

  /**
   * Résout un déplacement (prevX, prevY) -> (nextX, nextY) en tenant
   * compte du contour de l'île (clampToIsland).
   */
  function resolvePlayerMove(prevX, prevY, nextX, nextY, margin = 0) {
    return clampToIsland(nextX, nextY, margin);
  }

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
    appleTree(ctx, w, h, rng) {
      ICONS.tree(ctx, w, h, rng);
      const cx = w / 2;
      const trunkH = h * 0.28;
      const topY = h - 6 - trunkH;
      const appleColors = ['#e2542f', '#f2712f'];
      for (let i = 0; i < 6; i++) {
        const tier = Math.floor(rng() * 3);
        const cy = topY - tier * (h * 0.19) + (rng() - 0.5) * h * 0.08;
        const r = w * 0.42 - tier * w * 0.09;
        const a = rng() * Math.PI * 2;
        const px = cx + Math.cos(a) * r * 0.7;
        const py = cy + Math.sin(a) * r * 0.45;
        fillPath(ctx, appleColors[i % 2], 'rgba(0,0,0,0.3)', 1.5, () => {
          ctx.arc(px, py, w * 0.045, 0, Math.PI * 2);
        });
      }
    },
    // Conifère (sapin) : silhouette triangulaire étagée, tronc fin — pour
    // peupler la forêt du nord de l'île de référence (voir fiche des
    // arbres, élément 3/4 "Conifère").
    pine(ctx, w, h, rng) {
      const cx = w / 2;
      const trunkH = h * 0.16;
      fillPath(ctx, '#6b4a30', shade('#6b4a30', -0.35), 4, () => {
        ctx.rect(cx - w * 0.05, h - 6 - trunkH, w * 0.1, trunkH);
      });
      const tiers = 4;
      const topY = h - 6 - trunkH;
      const colors = ['#2f6b45', '#397a4f', '#468c5c', '#55a06b'];
      for (let i = tiers - 1; i >= 0; i--) {
        const cy = topY - i * (h * 0.185);
        const r = w * 0.4 - i * w * 0.075;
        const tierH = h * 0.24;
        fillPath(ctx, colors[i], 'rgba(0,0,0,0.32)', 3, () => {
          ctx.moveTo(cx, cy - tierH);
          ctx.lineTo(cx - r, cy + tierH * 0.3);
          ctx.lineTo(cx + r, cy + tierH * 0.3);
        });
      }
    },
    // Petit affleurement rocheux surélevé (plateau) : bande de falaise
    // circulaire type "terrasse" avec un ou deux rochers au sommet —
    // reproduit le petit promontoire vu au nord de l'île de référence.
    rockPlateau(ctx, w, h, rng, accent, cliffColor = '#8a5a34') {
      const cx = w / 2, cy = h * 0.62;
      const rx = w * 0.46, ry = h * 0.34;
      fillPath(ctx, cliffColor, shade(cliffColor, -0.4), 4, () => {
        ctx.ellipse(cx, cy + ry * 0.4, rx, ry, 0, 0, Math.PI * 2);
      });
      ctx.save();
      ctx.strokeStyle = shade(cliffColor, -0.22);
      ctx.lineWidth = 3;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rx * 0.55, cy + ry * 0.4 + Math.sin(a) * ry * 0.55);
        ctx.lineTo(cx + Math.cos(a) * rx * 0.96, cy + ry * 0.4 + Math.sin(a) * ry * 0.96);
        ctx.stroke();
      }
      ctx.restore();
      fillPath(ctx, '#8fcf7a', shade('#8fcf7a', -0.3), 3, () => {
        ctx.ellipse(cx, cy, rx * 0.82, ry * 0.68, 0, 0, Math.PI * 2);
      });
      // Rochers au sommet.
      fillPath(ctx, '#8a8a92', 'rgba(0,0,0,0.32)', 3, () => {
        ctx.arc(cx - rx * 0.18, cy - ry * 0.22, rx * 0.26, 0, Math.PI * 2);
      });
      fillPath(ctx, '#9a9aa0', 'rgba(0,0,0,0.32)', 3, () => {
        ctx.arc(cx + rx * 0.32, cy - ry * 0.06, rx * 0.17, 0, Math.PI * 2);
      });
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
    flower(ctx, w, h, rng) {
      const cx = w / 2, base = h - 4;
      const stemH = h * 0.5;
      ctx.strokeStyle = '#4f8a44';
      ctx.lineWidth = Math.max(2, w * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, base - stemH);
      ctx.stroke();
      const palette = ['#ffffff', '#ffd76a', '#ff9ec4', '#ffb347'];
      const color = palette[Math.floor(rng() * palette.length)];
      const petalR = w * 0.24;
      const petals = 5;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2;
        const px = cx + Math.cos(a) * petalR * 0.9;
        const py = base - stemH + Math.sin(a) * petalR * 0.9;
        fillPath(ctx, color, 'rgba(0,0,0,0.2)', 1.5, () => {
          ctx.arc(px, py, petalR * 0.55, 0, Math.PI * 2);
        });
      }
      fillPath(ctx, '#ffd76a', null, 0, () => {
        ctx.arc(cx, base - stemH, petalR * 0.4, 0, Math.PI * 2);
      });
    },
    stump(ctx, w, h, rng) {
      const cx = w / 2, base = h - 6;
      const rw = w * 0.36, rh = h * 0.22;
      fillPath(ctx, '#8a6339', shade('#8a6339', -0.35), 3, () => {
        ctx.rect(cx - rw, base - rh * 1.6, rw * 2, rh * 1.6);
      });
      fillPath(ctx, '#c99a63', shade('#c99a63', -0.2), 3, () => {
        ctx.ellipse(cx, base - rh * 1.6, rw, rh, 0, 0, Math.PI * 2);
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      for (let r = rw * 0.25; r < rw; r += rw * 0.28) {
        ctx.beginPath();
        ctx.ellipse(cx, base - rh * 1.6, r, r * (rh / rw), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
    barrel(ctx, w, h, rng) {
      const cx = w / 2, base = h - 6;
      const bw = w * 0.5, bh = h * 0.6;
      fillPath(ctx, '#a9743f', shade('#a9743f', -0.3), 3, () => {
        ctx.roundRect(cx - bw / 2, base - bh, bw, bh, bw * 0.18);
      });
      ctx.strokeStyle = shade('#a9743f', -0.5);
      ctx.lineWidth = Math.max(2, w * 0.045);
      [0.22, 0.5, 0.78].forEach((f) => {
        ctx.beginPath();
        ctx.moveTo(cx - bw / 2, base - bh * f);
        ctx.lineTo(cx + bw / 2, base - bh * f);
        ctx.stroke();
      });
    },
    signpost(ctx, w, h, rng) {
      const cx = w / 2, base = h - 6;
      const postH = h * 0.7;
      fillPath(ctx, '#7a5232', shade('#7a5232', -0.3), 3, () => {
        ctx.rect(cx - w * 0.045, base - postH, w * 0.09, postH);
      });
      const signW = w * 0.62, signH = h * 0.16;
      [0, 1].forEach((i) => {
        const sy = base - postH * 0.85 + i * signH * 1.4;
        const dir = i === 0 ? 1 : -1;
        fillPath(ctx, '#c99a63', shade('#c99a63', -0.3), 3, () => {
          ctx.moveTo(cx, sy);
          ctx.lineTo(cx + dir * signW, sy - signH * 0.15);
          ctx.lineTo(cx + dir * signW, sy + signH);
          ctx.lineTo(cx, sy + signH * 0.85);
        });
      });
    },
    campfire(ctx, w, h, rng) {
      const cx = w / 2, base = h - 6;
      const stones = 8;
      for (let i = 0; i < stones; i++) {
        const a = (i / stones) * Math.PI * 2;
        const px = cx + Math.cos(a) * w * 0.36;
        const py = base - h * 0.06 + Math.sin(a) * h * 0.09;
        fillPath(ctx, '#9a9aa0', 'rgba(0,0,0,0.3)', 2, () => {
          ctx.arc(px, py, w * 0.06, 0, Math.PI * 2);
        });
      }
      [-0.35, 0.35].forEach((rot) => {
        ctx.save();
        ctx.translate(cx, base - h * 0.1);
        ctx.rotate(rot);
        fillPath(ctx, '#7a5232', shade('#7a5232', -0.3), 2, () => {
          ctx.roundRect(-w * 0.28, -w * 0.045, w * 0.56, w * 0.09, w * 0.04);
        });
        ctx.restore();
      });
      const glow = ctx.createRadialGradient(cx, base - h * 0.22, 0, cx, base - h * 0.22, w * 0.6);
      glow.addColorStop(0, 'rgba(255,190,90,0.55)');
      glow.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, base - h * 0.22, w * 0.6, 0, Math.PI * 2);
      ctx.fill();
      const flameGrad = ctx.createLinearGradient(0, base, 0, base - h * 0.4);
      flameGrad.addColorStop(0, '#ff5a2e');
      flameGrad.addColorStop(0.6, '#ffb23e');
      flameGrad.addColorStop(1, '#fff3b0');
      fillPath(ctx, flameGrad, null, 0, () => {
        ctx.moveTo(cx, base - h * 0.02);
        ctx.quadraticCurveTo(cx - w * 0.16, base - h * 0.2, cx - w * 0.05, base - h * 0.32);
        ctx.quadraticCurveTo(cx, base - h * 0.26, cx + w * 0.03, base - h * 0.38);
        ctx.quadraticCurveTo(cx + w * 0.1, base - h * 0.22, cx + w * 0.16, base - h * 0.2);
        ctx.quadraticCurveTo(cx + w * 0.06, base - h * 0.14, cx, base - h * 0.02);
      });
    },
    gardenPatch(ctx, w, h, rng) {
      const left = w * 0.06, top = h * 0.1, gw = w * 0.88, gh = h * 0.7;
      fillPath(ctx, '#6b4a30', shade('#6b4a30', -0.25), 3, () => {
        ctx.rect(left, top, gw, gh);
      });
      const rows = 4, plants = 6;
      for (let r = 0; r < rows; r++) {
        const ry = top + gh * ((r + 0.5) / rows);
        for (let p = 0; p < plants; p++) {
          const px = left + gw * ((p + 0.5) / plants);
          fillPath(ctx, '#5f9a4c', shade('#5f9a4c', -0.2), 1.5, () => {
            ctx.arc(px, ry, gw * 0.028, 0, Math.PI * 2);
          });
        }
      }
      ctx.strokeStyle = '#8a6339';
      ctx.lineWidth = Math.max(3, w * 0.02);
      ctx.strokeRect(left, top, gw, gh);
      const postGap = gw / 7;
      for (let i = 0; i <= 7; i++) {
        const px = left + i * postGap;
        fillPath(ctx, '#7a5232', null, 0, () => {
          ctx.rect(px - w * 0.012, top - h * 0.03, w * 0.024, h * 0.06);
        });
      }
    },
    dock(ctx, w, h, rng) {
      const cx = w / 2;
      const plankW = w * 0.78;
      const top = h * 0.04, bottom = h * 0.96;
      fillPath(ctx, '#a9743f', shade('#a9743f', -0.3), 3, () => {
        ctx.rect(cx - plankW / 2, top, plankW, bottom - top);
      });
      ctx.strokeStyle = shade('#a9743f', -0.45);
      ctx.lineWidth = Math.max(2, w * 0.03);
      const planks = 8;
      for (let i = 1; i < planks; i++) {
        const py = top + (bottom - top) * (i / planks);
        ctx.beginPath();
        ctx.moveTo(cx - plankW / 2, py);
        ctx.lineTo(cx + plankW / 2, py);
        ctx.stroke();
      }
      [-1, 1].forEach((side) => {
        for (let f = 0.08; f < 0.98; f += 0.32) {
          const py = top + (bottom - top) * f;
          fillPath(ctx, '#7a5232', shade('#7a5232', -0.3), 2, () => {
            ctx.rect(cx + side * plankW / 2 - w * 0.02, py, w * 0.045, h * 0.09);
          });
        }
      });
    },
    boat(ctx, w, h, rng) {
      const cx = w / 2, cy = h * 0.55;
      fillPath(ctx, '#8a5a34', shade('#8a5a34', -0.35), 3, () => {
        ctx.ellipse(cx, cy, w * 0.42, h * 0.32, 0, 0, Math.PI * 2);
      });
      fillPath(ctx, '#c99a63', shade('#c99a63', -0.2), 2, () => {
        ctx.ellipse(cx, cy, w * 0.3, h * 0.2, 0, 0, Math.PI * 2);
      });
      fillPath(ctx, '#6b4a30', null, 0, () => {
        ctx.rect(cx - w * 0.03, cy - h * 0.05, w * 0.06, h * 0.05);
      });
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
    cabin(ctx, w, h, rng) {
      const cx = w / 2, base = h - 6;
      const wallW = w * 0.62, wallH = h * 0.36;
      const wallTop = base - wallH;
      fillPath(ctx, '#a9743f', shade('#a9743f', -0.35), 4, () => {
        ctx.rect(cx - wallW / 2, wallTop, wallW, wallH);
      });
      const doorW = wallW * 0.22, doorH = wallH * 0.62;
      fillPath(ctx, '#3f7a4a', shade('#3f7a4a', -0.35), 3, () => {
        ctx.roundRect(cx - doorW / 2, base - doorH, doorW, doorH, doorW * 0.25);
      });
      [-1, 1].forEach((side) => {
        fillPath(ctx, '#bfe6f2', shade('#bfe6f2', -0.3), 3, () => {
          ctx.rect(cx + side * wallW * 0.3 - wallW * 0.08, wallTop + wallH * 0.28, wallW * 0.16, wallW * 0.16);
        });
      });
      const roofW = wallW * 1.18, roofH = h * 0.34;
      fillPath(ctx, '#4f8a5c', shade('#4f8a5c', -0.4), 4, () => {
        ctx.moveTo(cx, wallTop - roofH);
        ctx.lineTo(cx - roofW / 2, wallTop + roofH * 0.12);
        ctx.lineTo(cx + roofW / 2, wallTop + roofH * 0.12);
      });
      const chimW = wallW * 0.08;
      fillPath(ctx, '#8a6339', shade('#8a6339', -0.3), 2, () => {
        ctx.rect(cx + roofW * 0.22, wallTop - roofH * 0.55, chimW, roofH * 0.7);
      });
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      [0, 1, 2].forEach((i) => {
        ctx.beginPath();
        ctx.arc(cx + roofW * 0.22 + chimW / 2 + i * 3, wallTop - roofH * 0.55 - 10 - i * 14, 6 + i * 2, 0, Math.PI * 2);
        ctx.fill();
      });
    },
  };

  // Taille "monde" (largeur, hauteur) en pixels de chaque type de décor.
  const DECOR_SIZE = {
    tree: [96, 152], appleTree: [96, 152], pine: [76, 176], bush: [44, 36],
    rock: [36, 24], mushroom: [27, 32], flower: [22, 34], stump: [46, 30],
    barrel: [30, 40], signpost: [46, 92], campfire: [76, 56],
    gardenPatch: [200, 150], dock: [96, 300], boat: [70, 50],
    lamp: [29, 72], cabin: [230, 260], rockPlateau: [260, 210],
  };

  // Résolution du canvas de dessin de chaque icône = sa taille "monde"
  // multipliée par ce facteur (netteté), avec le même ratio largeur/
  // hauteur que le type concerné (évite l'écrasement d'un asset large et
  // bas, comme le ponton, dans un canvas pensé pour un objet haut et
  // étroit, comme un arbre).
  const ICON_RES_SCALE = 2.4;

  function buildDecorCanvas(type, rng, accentColor) {
    const draw = ICONS[type];
    if (!draw) return null;
    const size = DECOR_SIZE[type] || [40, 50];
    const w = Math.max(8, Math.round(size[0] * ICON_RES_SCALE));
    const h = Math.max(8, Math.round(size[1] * ICON_RES_SCALE));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    draw(ctx, w, h, rng, accentColor);
    return canvas;
  }

  // ------------------------------------------------------------------
  // Sol : eau tout autour + île (falaise + écume + herbe), peint une
  // seule fois sur un grand canvas, posé tel quel par WorldRenderer.
  // ------------------------------------------------------------------
  function buildGroundCanvas(world) {
    const w = world.halfWidth * 2;
    const h = world.halfHeight * 2;
    const cx = world.halfWidth;
    const cy = world.halfHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Eau (fond), dégradé profond -> clair vers l'île.
    const waterGrad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.18, cx, cy, Math.max(w, h) * 0.72);
    waterGrad.addColorStop(0, hex(world.waterColor));
    waterGrad.addColorStop(1, hex(world.waterColor2));
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, 0, w, h);

    // Petits reflets sur l'eau (traits clairs épars, purement décoratifs).
    const wrng = mathUtils.mulberry32(mathUtils.hashString(world.id) + 7);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    for (let i = 0; i < 70; i++) {
      const px = wrng() * w, py = wrng() * h, len = 14 + wrng() * 26;
      ctx.lineWidth = 1 + wrng() * 1.5;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + len, py);
      ctx.stroke();
    }

    // Contours de la côte (falaise) et de l'herbe, échantillonnés une
    // fois pour toutes (mêmes points réutilisés pour le dessin ET pour
    // la bande de texture de la falaise).
    const steps = 160;
    const cliffPts = [];
    const grassPts = [];
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const rc = world.boundaryRadius(angle);
      const rg = world.grassRadius(angle);
      cliffPts.push([cx + Math.cos(angle) * rc, cy + Math.sin(angle) * rc]);
      grassPts.push([cx + Math.cos(angle) * rg, cy + Math.sin(angle) * rg]);
    }
    const pathFrom = (pts) => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
    };

    // Écume : liseré blanc translucide tout le long de la côte.
    pathFrom(cliffPts);
    ctx.save();
    ctx.lineWidth = 16;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
    ctx.restore();

    // Falaise (terre).
    pathFrom(cliffPts);
    ctx.fillStyle = hex(world.cliffColor);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = shade(world.cliffColor, -0.35);
    ctx.stroke();

    // Petites strates sur la bande de falaise (texture "terrasses").
    ctx.save();
    pathFrom(cliffPts);
    ctx.clip();
    ctx.strokeStyle = shade(world.cliffColor, -0.22);
    ctx.lineWidth = 3;
    for (let i = 0; i < cliffPts.length; i += 3) {
      const [x1, y1] = cliffPts[i];
      const [x2, y2] = grassPts[i];
      ctx.beginPath();
      ctx.moveTo(mix(x1, x2, 0.3), mix(y1, y2, 0.3));
      ctx.lineTo(mix(x1, x2, 0.55), mix(y1, y2, 0.55));
      ctx.stroke();
    }
    ctx.restore();

    // Herbe (sommet de l'île).
    pathFrom(grassPts);
    const grassGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(world.halfWidth, world.halfHeight));
    grassGrad.addColorStop(0, hex(world.groundColor));
    grassGrad.addColorStop(1, hex(world.groundColor2));
    ctx.fillStyle = grassGrad;
    ctx.fill();

    // Plages de sable : bandes qui longent la côte sur certains secteurs
    // angulaires (voir world.sandZones), profondeur maximale au centre du
    // secteur, qui retombe à 0 sur ses bords (cosinus) pour une transition
    // douce avec l'herbe.
    if (world.sandZones && world.sandZones.length) {
      ctx.save();
      pathFrom(grassPts);
      ctx.clip();
      const sandDepthAt = (angle) => {
        let depth = 0;
        for (const zone of world.sandZones) {
          let diff = angle - zone.angle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // normalise dans [-π, π]
          const half = zone.width / 2;
          if (Math.abs(diff) < half) {
            depth = Math.max(depth, zone.depth * Math.cos((diff / half) * (Math.PI / 2)));
          }
        }
        return depth;
      };
      const outerPts = [];
      const innerPts = [];
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const rGrass = world.grassRadius(angle);
        const depth = sandDepthAt(angle);
        outerPts.push([cx + Math.cos(angle) * rGrass, cy + Math.sin(angle) * rGrass]);
        innerPts.push([cx + Math.cos(angle) * (rGrass - depth), cy + Math.sin(angle) * (rGrass - depth)]);
      }
      ctx.beginPath();
      outerPts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      for (let i = innerPts.length - 1; i >= 0; i--) ctx.lineTo(innerPts[i][0], innerPts[i][1]);
      ctx.closePath();
      const sandGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(world.halfWidth, world.halfHeight));
      sandGrad.addColorStop(0, hex(world.sandColor));
      sandGrad.addColorStop(1, hex(world.sandColor2));
      ctx.fillStyle = sandGrad;
      ctx.fill();
      // Petits points/galets épars sur le sable.
      const srng = mathUtils.mulberry32(mathUtils.hashString(world.id) + 11);
      ctx.save();
      ctx.clip();
      for (let i = 0; i < 220; i++) {
        const angle = srng() * Math.PI * 2;
        const depth = sandDepthAt(angle);
        if (depth < 10) continue;
        const rGrass = world.grassRadius(angle);
        const rr = rGrass - srng() * depth;
        const px = cx + Math.cos(angle) * rr;
        const py = cy + Math.sin(angle) * rr;
        ctx.globalAlpha = 0.12 + srng() * 0.14;
        ctx.fillStyle = srng() > 0.5 ? '#ffffff' : '#8a6339';
        ctx.beginPath();
        ctx.arc(px, py, 2 + srng() * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.restore();
    }

    // Tapis d'herbe peint à la main (pas une texture répétée), contenu
    // strictement dans l'île grâce au clip.
    ctx.save();
    pathFrom(grassPts);
    ctx.clip();
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
    ctx.restore();

    // Petit étang niché dans l'herbe (voir world.pond) : liseré de rive
    // (sable clair) puis eau, avec quelques nénuphars.
    if (world.pond) {
      const pond = world.pond;
      const px = cx + pond.x;
      const py = cy + pond.y;
      ctx.save();
      pathFrom(grassPts);
      ctx.clip();
      fillPath(ctx, hex(world.sandColor), shade(hex(world.sandColor), -0.15), 2, () => {
        ctx.ellipse(px, py, pond.rx * 1.14, pond.ry * 1.14, 0, 0, Math.PI * 2);
      });
      const pondGrad = ctx.createRadialGradient(px, py, 0, px, py, Math.max(pond.rx, pond.ry));
      pondGrad.addColorStop(0, hex(world.waterColor));
      pondGrad.addColorStop(1, hex(world.waterColor2));
      fillPath(ctx, pondGrad, shade(hex(world.waterColor2), -0.2), 3, () => {
        ctx.ellipse(px, py, pond.rx, pond.ry, 0, 0, Math.PI * 2);
      });
      const prng = mathUtils.mulberry32(mathUtils.hashString(world.id) + 23);
      for (let i = 0; i < 5; i++) {
        const a = prng() * Math.PI * 2;
        const rr = prng() * 0.6;
        const lx = px + Math.cos(a) * pond.rx * rr;
        const ly = py + Math.sin(a) * pond.ry * rr;
        fillPath(ctx, '#4f8a5c', 'rgba(0,0,0,0.25)', 1.5, () => {
          ctx.ellipse(lx, ly, 9, 6, 0, 0, Math.PI * 2);
        });
      }
      ctx.restore();
    }

    return canvas;
  }

  // Zones interdites au décor aléatoire : autour du point d'arrivée, le
  // long du chemin central, et autour de chaque élément fixe (pour ne
  // pas planter un arbre en plein milieu de la cabane).
  function isBlocked(x, y, landmarkZones) {
    const distToSpawn = Math.hypot(x - WORLD.spawn.x, y - WORLD.spawn.y);
    if (distToSpawn < 150) return true; // dégagement autour du débarcadère
    if (WORLD.pond) {
      const p = WORLD.pond;
      const dx = (x - (p.x)) / (p.rx * 1.5);
      const dy = (y - (p.y)) / (p.ry * 1.5);
      if (dx * dx + dy * dy < 1) return true; // pas de décor dans/sur la rive de l'étang
    }
    for (const zone of landmarkZones) {
      if (Math.hypot(x - zone.x, y - zone.y) < zone.r) return true;
    }
    return false;
  }

  function buildLandmarkZones() {
    return WORLD.landmarks.map((l) => {
      const size = DECOR_SIZE[l.type] || [60, 60];
      const r = Math.max(size[0], size[1]) * (l.scale || 1) * 0.62;
      return { x: l.x, y: l.y, r };
    });
  }

  /**
   * Construit le décor complet du monde : sol (canvas déjà peint) et
   * liste de props (arbres, buissons, cabane, ponton...) placés de façon
   * déterministe (même seed => même disposition à chaque chargement).
   */
  function buildWorld() {
    const ground = buildGroundCanvas(WORLD);
    const rng = mathUtils.mulberry32(mathUtils.hashString(WORLD.id) + 1);
    const landmarkZones = buildLandmarkZones();
    const props = [];

    WORLD.decor.forEach(({ type, count, angleRange, spreadRange }) => {
      const size = DECOR_SIZE[type] || [40, 50];
      const [sMin, sMax] = spreadRange || [0.32, 0.94];
      for (let i = 0; i < count; i++) {
        let x = 0, y = 0, tries = 0, placed = false;
        while (tries < 30) {
          const angle = angleRange
            ? angleRange[0] + rng() * (angleRange[1] - angleRange[0])
            : rng() * Math.PI * 2;
          const spread = sMin + rng() * (sMax - sMin);
          const maxR = Math.max(0, WORLD.grassRadius(angle) - 34);
          x = Math.cos(angle) * maxR * spread;
          y = Math.sin(angle) * maxR * spread;
          tries++;
          if (!isBlocked(x, y, landmarkZones)) {
            placed = true;
            break;
          }
        }
        if (!placed) continue;
        const canvas = buildDecorCanvas(type, rng, WORLD.accentColor);
        if (!canvas) continue;
        const scale = 0.85 + rng() * 0.4;
        props.push({ type, x, y, canvas, worldW: size[0] * scale, worldH: size[1] * scale });
      }
    });

    WORLD.landmarks.forEach((l) => {
      const size = DECOR_SIZE[l.type] || [60, 60];
      const canvas = buildDecorCanvas(l.type, rng, WORLD.accentColor);
      if (!canvas) return;
      const scale = l.scale || 1;
      props.push({
        type: l.type, x: l.x, y: l.y, canvas,
        worldW: size[0] * scale, worldH: size[1] * scale,
        rotation: l.rotation || 0,
      });
    });

    // Tri par profondeur (y croissant) une fois pour toutes : le sol ne
    // bouge jamais, donc l'ordre de dessin peut être précalculé ici.
    props.sort((a, b) => a.y - b.y);

    return { world: WORLD, ground, props };
  }

  window.Game.WorldBuilder = { WORLD, buildWorld, clampToIsland, resolvePlayerMove };
})();
