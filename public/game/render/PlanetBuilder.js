'use strict';

/**
 * game/render/PlanetBuilder.js
 * ----------------------------------------------------------------------
 * Décrit chaque planète (biome, taille, palette, décor, portails) et sait
 * construire le groupe Three.js correspondant (sol + décor + portails),
 * de façon entièrement procédurale (aucune texture/asset externe : tout
 * est fait de primitives géométriques low poly + couleurs plates).
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
// Primitives de décor low poly. Chaque fonction reçoit un RNG (0..1) et
// une couleur d'accent, et retourne un THREE.Group prêt à être placé.
// Géométries volontairement simples (peu de segments) : lisibilité +
// performance avant tout, dans l'esprit "low poly peint à la main".
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

function glowMat(color) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
}

function makeTree(rng) {
  const g = new THREE.Group();
  const trunkH = 6 + rng() * 3;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1, trunkH, 6),
    flatMat(0x7a5232)
  );
  trunk.position.y = trunkH / 2;
  g.add(trunk);

  const leafColors = [0x6fae5a, 0x7fc06a, 0x5b9a49];
  const tiers = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < tiers; i++) {
    const size = 5.5 - i * 1.3 + rng() * 0.6;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(size, 5.5, 7),
      flatMat(leafColors[i % leafColors.length])
    );
    cone.position.y = trunkH + i * 3.4 + 2.5;
    g.add(cone);
  }
  return g;
}

function makeSnowPine(rng) {
  const g = makeTree(rng);
  g.traverse((child) => {
    if (child.isMesh && child.geometry.type === 'ConeGeometry') {
      child.material = flatMat(0xf3f8ff);
    }
  });
  return g;
}

function makeBush(rng, color = 0x6fae5a) {
  const g = new THREE.Group();
  const clumps = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < clumps; i++) {
    const s = 1.4 + rng() * 1;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), flatMat(color));
    m.position.set((rng() - 0.5) * 2.4, s * 0.7, (rng() - 0.5) * 2.4);
    g.add(m);
  }
  return g;
}

function makeCactus(rng) {
  const g = new THREE.Group();
  const mat = flatMat(0x4f9a5c);
  const h = 5 + rng() * 3;
  const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, h, 4, 6), mat);
  trunk.position.y = h / 2 + 1.1;
  g.add(trunk);
  const arms = Math.floor(rng() * 3);
  for (let i = 0; i < arms; i++) {
    const armH = 2.5 + rng() * 1.5;
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, armH, 4, 6), mat);
    const side = rng() > 0.5 ? 1 : -1;
    arm.position.set(side * 1.6, h * (0.4 + rng() * 0.3), 0);
    arm.rotation.z = side * 0.9;
    g.add(arm);
  }
  return g;
}

function makeRock(rng) {
  const s = 1.2 + rng() * 2.4;
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(s, 0),
    flatMat(0x8a8a92, { roughness: 0.95 })
  );
  m.scale.y = 0.6 + rng() * 0.4;
  m.rotation.y = rng() * Math.PI;
  return m;
}

function makeMushroom(rng, color = 0xff8a7a) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.8, 6), flatMat(0xf3e6d0));
  stem.position.y = 0.9;
  g.add(stem);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), flatMat(color));
  cap.position.y = 1.8;
  g.add(cap);
  g.scale.setScalar(0.8 + rng() * 0.8);
  return g;
}

function makeCrystalBush(rng, color) {
  const g = new THREE.Group();
  const shards = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < shards; i++) {
    const h = 2 + rng() * 3;
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.6, h, 5), glowMat(color));
    m.position.set((rng() - 0.5) * 1.6, h / 2, (rng() - 0.5) * 1.6);
    m.rotation.z = (rng() - 0.5) * 0.4;
    g.add(m);
  }
  const light = new THREE.PointLight(color, 1.2, 14);
  light.position.y = 2;
  g.add(light);
  return g;
}

function makeBigCrystal(rng, color) {
  const g = new THREE.Group();
  const shards = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < shards; i++) {
    const h = 6 + rng() * 8;
    const r = 1.1 + rng() * 0.8;
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), glowMat(color));
    m.position.set((rng() - 0.5) * 3.5, h / 2, (rng() - 0.5) * 3.5);
    m.rotation.z = (rng() - 0.5) * 0.5;
    m.rotation.x = (rng() - 0.5) * 0.3;
    g.add(m);
  }
  const light = new THREE.PointLight(color, 2, 26);
  light.position.y = 6;
  g.add(light);
  return g;
}

function makeIceCrystal(rng) {
  return makeBigCrystal(rng, 0x9fd8ff);
}

function makeLamp(rng, color) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 7, 6), flatMat(0x6b5a45));
  post.position.y = 3.5;
  g.add(post);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 8), glowMat(color));
  globe.position.y = 7.4;
  g.add(globe);
  const light = new THREE.PointLight(color, 1.4, 20);
  light.position.y = 7.4;
  g.add(light);
  return g;
}

const DECOR_FACTORIES = {
  tree: (rng) => makeTree(rng),
  snowPine: (rng) => makeSnowPine(rng),
  bush: (rng) => makeBush(rng, 0x6fae5a),
  duneBush: (rng) => makeBush(rng, 0xb98a4a),
  cactus: (rng) => makeCactus(rng),
  rock: (rng) => makeRock(rng),
  mushroom: (rng) => makeMushroom(rng),
  crystalBush: (rng, accent) => makeCrystalBush(rng, accent),
  bigCrystal: (rng, accent) => makeBigCrystal(rng, accent),
  iceCrystal: (rng) => makeIceCrystal(rng),
  lamp: (rng, accent) => makeLamp(rng, accent),
};

// ----------------------------------------------------------------------
// Sol : la planète est maintenant une vraie forme ronde — un dôme
// sphérique low poly (dégradé de couleur du centre vers le bord, via
// domeHeight — voir window.Game.mathUtils) posé sur un dessous arrondi,
// pour lire clairement comme "une petite planète", pas un plateau plat.
// ----------------------------------------------------------------------

function buildDomeGround(planet) {
  const radius = planet.radius;
  const rings = 14;
  const segments = 40;
  const domeHeight = (r) => window.Game.mathUtils.domeHeight(r, radius);

  const positions = [0, domeHeight(0), 0];
  const colorCenter = new THREE.Color(planet.groundColor);
  const colorEdge = new THREE.Color(planet.groundColor2);
  const colors = [colorCenter.r, colorCenter.g, colorCenter.b];

  for (let ring = 1; ring <= rings; ring++) {
    const t = ring / rings;
    const r = t * radius;
    const y = domeHeight(r);
    const c = colorCenter.clone().lerp(colorEdge, Math.min(1, t * 1.2));
    for (let seg = 0; seg < segments; seg++) {
      const a = (seg / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
      colors.push(c.r, c.g, c.b);
    }
  }

  const indices = [];
  for (let seg = 0; seg < segments; seg++) {
    indices.push(0, 1 + seg, 1 + ((seg + 1) % segments));
  }
  for (let ring = 1; ring < rings; ring++) {
    const ringStart = 1 + (ring - 1) * segments;
    const nextStart = 1 + ring * segments;
    for (let seg = 0; seg < segments; seg++) {
      const a = ringStart + seg;
      const b = ringStart + ((seg + 1) % segments);
      const c = nextStart + seg;
      const d = nextStart + ((seg + 1) % segments);
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    // Filet de sécurité : si jamais l'ordre des sommets se retrouve
    // inversé, le sol reste visible des deux côtés plutôt que d'être
    // invisible depuis la caméra.
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

function buildPlanetBelly(planet) {
  // Dessous arrondi (hémisphère) accroché au bord du dôme (léger
  // débord pour ne jamais laisser de vide visible à la jointure) :
  // c'est ce qui donne la silhouette "boule flottante" vue de loin.
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(planet.radius * 1.04, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    flatMat(planet.groundColor2, { roughness: 1 })
  );
  return belly;
}

function buildPortal(portalConfig, planet) {
  const g = new THREE.Group();
  const r = Math.hypot(portalConfig.pos.x, portalConfig.pos.y);
  const groundY = window.Game.mathUtils.domeHeight(r, planet.radius);
  g.position.set(portalConfig.pos.x, groundY, portalConfig.pos.y);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(4.2, 0.6, 10, 24),
    glowMat(planet.accentColor)
  );
  ring.position.y = 4.2;
  g.add(ring);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, 24),
    new THREE.MeshBasicMaterial({ color: planet.accentColor, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  disc.position.y = 4.2;
  g.add(disc);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5, 0.6, 20), flatMat(0x8a8a92));
  base.position.y = 0.3;
  g.add(base);

  const light = new THREE.PointLight(planet.accentColor, 1.6, 30);
  light.position.y = 5;
  g.add(light);

  g.userData.spin = 0;
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
  group.add(buildDomeGround(planet));
  group.add(buildPlanetBelly(planet));

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
      const groundY = window.Game.mathUtils.domeHeight(dist, planet.radius);
      item.position.set(Math.cos(angle) * dist, groundY, Math.sin(angle) * dist);
      item.rotation.y = rng() * Math.PI * 2;
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
