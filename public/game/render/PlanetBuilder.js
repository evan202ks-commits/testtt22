'use strict';

/**
 * game/render/PlanetBuilder.js
 * ----------------------------------------------------------------------
 * Décrit chaque planète (biome, taille, palette, décor, portails) et sait
 * construire le groupe Three.js correspondant (sol + décor + portails),
 * de façon entièrement procédurale (aucune texture/asset externe : tout
 * est peint à la volée sur des canvas 2D). Structure volontairement
 * plate façon vieux RPG : le sol est un disque plat et le décor n'est
 * fait que de sprites (billboards) peints, pas de maillages 3D — voir
 * la section "Décor 2D plat" plus bas et CharacterAvatar.js pour le
 * même principe appliqué au personnage.
 *
 * Ce module est un pur "atelier de construction" : il ne connaît rien du
 * joueur, du réseau ni de la boucle de jeu. PlanetRenderer.js l'utilise
 * pour peupler la scène.
 * ----------------------------------------------------------------------
 */

import * as THREE from 'three';

// Petit PRNG déterministe (même algo que window.Game.mathUtils.mulberry32,
// dupliqué ici pour que ce module reste autonome et ne dépende pas de
// l'ordre de chargement des scripts classiques).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ----------------------------------------------------------------------
// Config des planètes. Chaque entrée = un biome. Ajouter une planète =
// ajouter une entrée ici (le rendu et le peuplement sont génériques).
// ----------------------------------------------------------------------

export const PLANETS = [
  {
    id: 'hub',
    name: 'Lueur-du-Port',
    subtitle: 'Place centrale',
    radius: 210,
    groundColor: 0xf2c9a0,
    groundColor2: 0xe8b587,
    accentColor: 0xffd76a,
    skyColor: 0x3a2b52,
    fogColor: 0x4a3560,
    fogDensity: 0.0018,
    sunColor: 0xffb37a,
    ambientColor: 0x6a5a8a,
    decor: [
      { type: 'lamp', count: 8 },
      { type: 'crystalBush', count: 10 },
      { type: 'rock', count: 6 },
    ],
    spawn: { x: 0, y: 40 },
    portals: [
      { to: 'forest', pos: { x: -140, y: -90 } },
      { to: 'desert', pos: { x: 140, y: -90 } },
      { to: 'snow', pos: { x: -140, y: 110 } },
      { to: 'crystal', pos: { x: 140, y: 110 } },
    ],
  },
  {
    id: 'forest',
    name: 'Bosquet-Mousseux',
    subtitle: 'Forêt',
    radius: 190,
    groundColor: 0x6fae5a,
    groundColor2: 0x5b9a49,
    accentColor: 0xbdf27a,
    skyColor: 0x2f4d3a,
    fogColor: 0x3a5c46,
    fogDensity: 0.0026,
    sunColor: 0xffd699,
    ambientColor: 0x4f7a58,
    decor: [
      { type: 'tree', count: 22 },
      { type: 'bush', count: 14 },
      { type: 'rock', count: 8 },
      { type: 'mushroom', count: 10 },
    ],
    spawn: { x: 0, y: 60 },
    portals: [{ to: 'hub', pos: { x: 0, y: -130 } }],
  },
  {
    id: 'desert',
    name: 'Dunes-Ambrées',
    subtitle: 'Désert',
    radius: 190,
    groundColor: 0xe8b866,
    groundColor2: 0xd9a24f,
    accentColor: 0xff9d5c,
    skyColor: 0x5a3a4a,
    fogColor: 0x6b4456,
    fogDensity: 0.0016,
    sunColor: 0xffab6b,
    ambientColor: 0x8a6050,
    decor: [
      { type: 'cactus', count: 16 },
      { type: 'rock', count: 12 },
      { type: 'duneBush', count: 8 },
    ],
    spawn: { x: 0, y: 60 },
    portals: [{ to: 'hub', pos: { x: 0, y: -130 } }],
  },
  {
    id: 'snow',
    name: 'Frimas-Argenté',
    subtitle: 'Neige',
    radius: 190,
    groundColor: 0xeef4fb,
    groundColor2: 0xd8e6f5,
    accentColor: 0x9fd8ff,
    skyColor: 0x33445e,
    fogColor: 0x44577a,
    fogDensity: 0.0026,
    sunColor: 0xffe1c2,
    ambientColor: 0x6a80a8,
    decor: [
      { type: 'snowPine', count: 18 },
      { type: 'iceCrystal', count: 10 },
      { type: 'rock', count: 6 },
    ],
    spawn: { x: 0, y: 60 },
    portals: [{ to: 'hub', pos: { x: 0, y: -130 } }],
  },
  {
    id: 'crystal',
    name: 'Prismes-Éveillés',
    subtitle: 'Cristaux',
    radius: 190,
    groundColor: 0x5d5a8f,
    groundColor2: 0x4a4778,
    accentColor: 0xc9a6ff,
    skyColor: 0x241a3d,
    fogColor: 0x342a54,
    fogDensity: 0.002,
    sunColor: 0xc9a6ff,
    ambientColor: 0x5a4a8a,
    decor: [
      { type: 'bigCrystal', count: 14 },
      { type: 'crystalBush', count: 14 },
      { type: 'rock', count: 6 },
    ],
    spawn: { x: 0, y: 60 },
    portals: [{ to: 'hub', pos: { x: 0, y: -130 } }],
  },
];

export function getPlanetById(id) {
  return PLANETS.find((p) => p.id === id) || PLANETS[0];
}

// ----------------------------------------------------------------------
// Décor 2D plat : chaque élément est une petite icône peinte sur un
// canvas (formes vectorielles simples + contour sombre, style "vieux
// RPG" / papier découpé) puis posée en billboard (THREE.Sprite, toujours
// face caméra — même technique que le personnage, voir
// CharacterAvatar.js) avec une ombre plate au sol. Rien de tout ça n'est
// un maillage 3D : c'est ce qui rend le monde "plat" tout en restant
// lisible depuis la caméra fixe légèrement en hauteur.
// ----------------------------------------------------------------------

function flatMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.05,
    ...opts,
  });
}

function hex(color) {
  return `#${new THREE.Color(color).getHexString()}`;
}

function shade(color, amount) {
  // amount > 0 éclaircit, < 0 assombrit — pour dériver un contour/une
  // ombre propre à partir d'une seule couleur de base.
  const c = new THREE.Color(color);
  if (amount >= 0) c.lerp(new THREE.Color(0xffffff), amount);
  else c.lerp(new THREE.Color(0x000000), -amount);
  return hex(c);
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
  snowPine(ctx, w, h, rng) {
    ICONS.tree(ctx, w, h, rng);
    // Chapeaux de neige par-dessus les frondaisons.
    const cx = w / 2;
    const trunkH = h * 0.28;
    const topY = h - 6 - trunkH;
    for (let i = 2; i >= 0; i--) {
      const cy = topY - i * (h * 0.19);
      const r = w * 0.42 - i * w * 0.09;
      fillPath(ctx, '#f3f8ff', 'rgba(0,0,0,0.15)', 3, () => {
        ctx.moveTo(cx, cy - r * 1.35);
        ctx.lineTo(cx - r * 0.55, cy - r * 0.15);
        ctx.lineTo(cx + r * 0.55, cy - r * 0.15);
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
  duneBush(ctx, w, h, rng) {
    ICONS.bush(ctx, w, h, rng, null, '#b98a4a');
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
  bigCrystal(ctx, w, h, rng, accent) {
    const cx = w / 2, base = h - 6;
    const color = hex(accent || 0xc9a6ff);
    const glow = ctx.createRadialGradient(cx, base - h * 0.4, 0, cx, base - h * 0.4, w * 0.65);
    glow.addColorStop(0, 'rgba(255,255,255,0.4)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, base - h * 0.4, w * 0.65, 0, Math.PI * 2);
    ctx.fill();
    const shards = 5;
    for (let i = 0; i < shards; i++) {
      const sh = h * (0.45 + rng() * 0.4);
      const sw = w * (0.09 + rng() * 0.04);
      const px = cx + (i / (shards - 1) - 0.5) * w * 0.7 + (rng() - 0.5) * w * 0.08;
      fillPath(ctx, shade(color, (rng() - 0.5) * 0.2), 'rgba(0,0,0,0.28)', 3, () => {
        ctx.moveTo(px, base - sh);
        ctx.lineTo(px - sw, base - sh * 0.12);
        ctx.lineTo(px - sw * 0.4, base);
        ctx.lineTo(px + sw * 0.4, base);
        ctx.lineTo(px + sw, base - sh * 0.12);
      });
    }
  },
  iceCrystal(ctx, w, h, rng) {
    ICONS.bigCrystal(ctx, w, h, rng, new THREE.Color(0x9fd8ff));
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

// Taille "monde" (largeur, hauteur) approximative de chaque type de
// décor — gabarits proches de l'ancienne version 3D pour garder la même
// lisibilité/échelle de jeu.
const DECOR_SIZE = {
  tree: [12, 19], snowPine: [12, 19], bush: [5.5, 4.5], duneBush: [5.5, 4.5],
  cactus: [6, 9], rock: [4.5, 3], mushroom: [3.4, 4], crystalBush: [5.5, 6.5],
  bigCrystal: [9.5, 16], iceCrystal: [9.5, 16], lamp: [3.6, 9],
};

const CANVAS_W = 160;
const CANVAS_H = 220;
const HAS_LIGHT = new Set(['crystalBush', 'bigCrystal', 'iceCrystal', 'lamp']);
const LIGHT_COLOR = { crystalBush: null, bigCrystal: null, iceCrystal: 0x9fd8ff, lamp: null };

function buildDecorSprite(type, rng, accentColor) {
  const draw = ICONS[type];
  if (!draw) return null;
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  draw(ctx, CANVAS_W, CANVAS_H, rng, accentColor);

  const texture = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.center.set(0.5, 0);
  const [ww, wh] = DECOR_SIZE[type] || [6, 8];
  sprite.scale.set(ww, wh, 1);

  const group = new THREE.Group();
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(ww * 0.32, 14),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  group.add(shadow);
  group.add(sprite);

  if (HAS_LIGHT.has(type)) {
    const lightColor = LIGHT_COLOR[type] || accentColor || 0xffd76a;
    const light = new THREE.PointLight(lightColor, 1.1, wh * 2.2);
    light.position.y = wh * 0.5;
    group.add(light);
  }

  return group;
}

const DECOR_FACTORIES = Object.fromEntries(
  Object.keys(ICONS).map((type) => [type, (rng, accent) => buildDecorSprite(type, rng, accent)])
);

// ----------------------------------------------------------------------
// Sol : structure 2D plate façon vieux RPG — un disque bien plat (posé
// sur une fine tranche pour lire comme une petite île/plateforme
// flottante), avec un dégradé peint centre → bord au lieu d'un relief
// 3D. Le déplacement du joueur reste entièrement dans ce plan (y = 0,
// voir domeHeight dans mathUtils.js).
// ----------------------------------------------------------------------

function buildGroundTexture(planet, seed) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size / 2;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, hex(planet.groundColor));
  grad.addColorStop(1, hex(planet.groundColor2));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Petites variations picturales (tapis d'herbe/sable peint à la main,
  // pas une texture répétée) : quelques taches plus claires/sombres.
  const rng = mulberry32(seed);
  for (let i = 0; i < 220; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * r * 0.96;
    ctx.globalAlpha = 0.05 + rng() * 0.06;
    ctx.fillStyle = rng() > 0.5 ? '#ffffff' : '#000000';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 3 + rng() * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildGround(planet) {
  const group = new THREE.Group();
  const radius = planet.radius;
  const segments = 56;

  const top = new THREE.Mesh(
    new THREE.CircleGeometry(radius, segments),
    new THREE.MeshStandardMaterial({
      map: buildGroundTexture(planet, hashString(planet.id)),
      roughness: 0.9,
      side: THREE.DoubleSide,
    })
  );
  top.rotation.x = -Math.PI / 2;
  group.add(top);

  // Fine tranche + dessous, juste assez pour lire un bord depuis la
  // caméra en angle — le dessus reste, lui, parfaitement plat.
  const rimH = Math.max(3, radius * 0.05);
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.96, rimH, segments, 1, true),
    flatMat(planet.groundColor2, { roughness: 1 })
  );
  rim.position.y = -rimH / 2;
  group.add(rim);

  const bottom = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.96, segments),
    flatMat(new THREE.Color(planet.groundColor2).multiplyScalar(0.55).getHex(), { roughness: 1 })
  );
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -rimH;
  group.add(bottom);

  return group;
}

function buildPortal(portalConfig, planet) {
  const g = new THREE.Group();
  g.position.set(portalConfig.pos.x, 0, portalConfig.pos.y);

  // Anneau plat peint au sol (décalque, pas un tore 3D).
  const ringCanvas = document.createElement('canvas');
  ringCanvas.width = 128;
  ringCanvas.height = 128;
  const rctx = ringCanvas.getContext('2d');
  const c = hex(planet.accentColor);
  rctx.translate(64, 64);
  const grad = rctx.createRadialGradient(0, 0, 30, 0, 0, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, c);
  grad.addColorStop(0.86, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  rctx.fillStyle = grad;
  rctx.beginPath();
  rctx.arc(0, 0, 62, 0, Math.PI * 2);
  rctx.fill();
  const ringTex = new THREE.CanvasTexture(ringCanvas);
  if ('colorSpace' in ringTex) ringTex.colorSpace = THREE.SRGBColorSpace;
  const decal = new THREE.Mesh(
    new THREE.CircleGeometry(4.6, 28),
    new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  decal.rotation.x = -Math.PI / 2;
  decal.position.y = 0.05;
  g.add(decal);

  // Repère vertical plat (billboard) pour rester visible de loin.
  const glyphCanvas = document.createElement('canvas');
  glyphCanvas.width = 96;
  glyphCanvas.height = 140;
  const gctx = glyphCanvas.getContext('2d');
  const glow = gctx.createRadialGradient(48, 70, 4, 48, 70, 60);
  glow.addColorStop(0, 'rgba(255,255,255,0.85)');
  glow.addColorStop(0.4, c);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  gctx.fillStyle = glow;
  gctx.beginPath();
  gctx.arc(48, 70, 60, 0, Math.PI * 2);
  gctx.fill();
  fillPath(gctx, c, 'rgba(255,255,255,0.8)', 3, () => {
    gctx.moveTo(48, 12);
    gctx.lineTo(74, 70);
    gctx.lineTo(48, 128);
    gctx.lineTo(22, 70);
  });
  const glyphTex = new THREE.CanvasTexture(glyphCanvas);
  if ('colorSpace' in glyphTex) glyphTex.colorSpace = THREE.SRGBColorSpace;
  const glyph = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTex, transparent: true }));
  glyph.center.set(0.5, 0.18);
  glyph.scale.set(6, 8.75, 1);
  g.add(glyph);

  const light = new THREE.PointLight(planet.accentColor, 1.5, 26);
  light.position.y = 4;
  g.add(light);

  g.userData.spin = 0;
  g.userData.glyph = glyph;
  return g;
}

/**
 * Construit le groupe complet d'une planète : sol, décor placé de façon
 * déterministe (même seed => même disposition à chaque chargement), et
 * portails. Retourne aussi la liste des portails avec leur position
 * monde (pour la détection de proximité côté GameEngine).
 */
export function buildPlanetGroup(planet) {
  const group = new THREE.Group();
  group.name = `planet:${planet.id}`;
  group.add(buildGround(planet));

  const rng = mulberry32(hashString(planet.id) + 1);
  const spinningPortals = [];
  const decorMinRadius = 22; // zone de spawn dégagée au centre

  planet.decor.forEach(({ type, count }) => {
    const factory = DECOR_FACTORIES[type];
    if (!factory) return;
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = decorMinRadius + rng() * (planet.radius * 0.88 - decorMinRadius);
      const item = factory(rng, planet.accentColor);
      if (!item) continue;
      // Note : les sprites (billboards) ignorent la rotation de leur
      // groupe parent — inutile d'en appliquer une, ils font toujours
      // face à la caméra. Seule l'échelle varie pour un peu de nature.
      item.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      const scale = 0.85 + rng() * 0.4;
      item.scale.setScalar(scale);
      group.add(item);
    }
  });

  const portalMeshes = [];
  planet.portals.forEach((portalConfig) => {
    const portalGroup = buildPortal(portalConfig, planet);
    group.add(portalGroup);
    spinningPortals.push(portalGroup);
    portalMeshes.push({
      group: portalGroup,
      to: portalConfig.to,
      worldX: portalConfig.pos.x,
      worldY: portalConfig.pos.y,
    });
  });

  return { group, portalMeshes, spinningPortals };
}
