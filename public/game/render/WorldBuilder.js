'use strict';

/**
 * game/render/WorldBuilder.js
 * ----------------------------------------------------------------------
 * Décrit chaque zone (village + biomes nature), et sait construire le
 * groupe Three.js correspondant : sol texturé (tileset réel, voir
 * AssetManifest), relief doux, eau animée, décor 3D léger (arbres,
 * bâtiments, rochers — primitives géométriques, "2.5D") et flore en
 * sprites 2D (billboards, herbe/fleurs — le "mélange 2D/3D" demandé).
 *
 * Portails = mêmes mécaniques qu'avant (proximité -> changement de
 * zone), juste rethémés en chemins/arches plutôt qu'en anneaux cosmiques.
 * ----------------------------------------------------------------------
 */

import * as THREE from 'three';

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
// Config des zones. Chaque entrée = un lieu du monde. Ajouter une zone =
// ajouter une entrée ici (le rendu et le peuplement sont génériques).
// ----------------------------------------------------------------------

export const ZONES = [
  {
    id: 'village',
    name: 'Clairval',
    subtitle: 'Village',
    radius: 200,
    seed: 1,
    ground: 'grass-meadow',
    tileWorldSize: 44,
    groundTint: 0xffffff,
    fogColor: 0xdcefc9,
    fogDensity: 0.0011,
    sunColor: 0xfff2d6,
    ambientColor: 0xcfe6b0,
    buildings: [
      { x: -70, y: 40, w: 34, h: 26, roof: 0xb15c4a, wall: 0xf3e3c2 },
      { x: 60, y: 55, w: 28, h: 22, roof: 0x6a8f5c, wall: 0xf0e6d2 },
    ],
    decor: [
      { type: 'tree', count: 10 },
      { type: 'lamp', count: 6 },
      { type: 'bush', count: 8 },
    ],
    flora: [
      { type: 'flower-red', count: 14 },
      { type: 'flower-yellow', count: 14 },
      { type: 'grass-tuft', count: 40 },
    ],
    paths: [{ x: -70, y: 40 }, { x: 60, y: 55 }],
    spawn: { x: 0, y: 30 },
    portals: [
      { to: 'forest', pos: { x: -132, y: -84 } },
      { to: 'meadow', pos: { x: 132, y: -84 } },
      { to: 'lakeside', pos: { x: 0, y: 150 } },
    ],
  },
  {
    id: 'forest',
    name: 'Bois-Tranquille',
    subtitle: 'Forêt',
    radius: 185,
    seed: 2,
    ground: 'grass-forest',
    tileWorldSize: 40,
    groundTint: 0xe6f2df,
    fogColor: 0x9fc79a,
    fogDensity: 0.0026,
    sunColor: 0xdff0c8,
    ambientColor: 0x8fae7a,
    weather: 'leaves',
    decor: [
      { type: 'tree', count: 26 },
      { type: 'bush', count: 10 },
      { type: 'rock', count: 8 },
      { type: 'mushroom', count: 10 },
    ],
    flora: [
      { type: 'grass-tuft', count: 46 },
      { type: 'flower-white', count: 8 },
    ],
    spawn: { x: 0, y: 50 },
    portals: [{ to: 'village', pos: { x: 0, y: -128 } }],
  },
  {
    id: 'meadow',
    name: 'Prés-Fleuris',
    subtitle: 'Prairie',
    radius: 195,
    seed: 3,
    ground: 'grass-meadow',
    tileWorldSize: 46,
    groundTint: 0xffffff,
    fogColor: 0xe9f2c9,
    fogDensity: 0.0013,
    sunColor: 0xfff6d2,
    ambientColor: 0xd8e6a8,
    decor: [
      { type: 'tree', count: 8 },
      { type: 'bush', count: 6 },
      { type: 'scarecrow', count: 1 },
      { type: 'rock', count: 5 },
    ],
    flora: [
      { type: 'flower-red', count: 20 },
      { type: 'flower-yellow', count: 20 },
      { type: 'flower-white', count: 16 },
      { type: 'grass-tuft', count: 50 },
    ],
    spawn: { x: 0, y: 50 },
    portals: [{ to: 'village', pos: { x: 0, y: -128 } }],
  },
  {
    id: 'lakeside',
    name: 'Bord-de-l’Eau',
    subtitle: 'Lac',
    radius: 190,
    seed: 4,
    ground: 'grass',
    tileWorldSize: 42,
    groundTint: 0xffffff,
    fogColor: 0xcfe7e6,
    fogDensity: 0.0014,
    sunColor: 0xfdf3d2,
    ambientColor: 0xb9d6d2,
    water: { cx: 40, cy: 20, radius: 118 },
    decor: [
      { type: 'tree', count: 10 },
      { type: 'bush', count: 8 },
      { type: 'rock', count: 10 },
      { type: 'dock', count: 1 },
    ],
    flora: [
      { type: 'grass-tuft', count: 34 },
      { type: 'flower-white', count: 10 },
    ],
    spawn: { x: -70, y: 50 },
    portals: [{ to: 'village', pos: { x: -100, y: -100 } }],
  },
];

export function getZoneById(id) {
  return ZONES.find((z) => z.id === id) || ZONES[0];
}

function groundHeight(x, y, radius, seed) {
  return window.Game.mathUtils.zoneGroundHeight(x, y, radius, seed);
}

// ----------------------------------------------------------------------
// Sol : disque bas-poly texturé (UV = position monde / tileWorldSize),
// relief doux via zoneGroundHeight (une seule formule partagée avec
// décor/portails/avatar/caméra — voir game/mathUtils.js).
// ----------------------------------------------------------------------

function buildTerrainMesh({ radius, seed, texture, tileWorldSize, tint }) {
  const rings = 16;
  const segments = 44;
  const gh = (x, y) => groundHeight(x, y, radius, seed);

  const positions = [0, gh(0, 0), 0];
  const uvs = [0, 0];

  for (let ring = 1; ring <= rings; ring++) {
    const r = (ring / rings) * radius;
    for (let seg = 0; seg < segments; seg++) {
      const a = (seg / segments) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      positions.push(x, gh(x, z), z);
      uvs.push(x / tileWorldSize, z / tileWorldSize);
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
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: texture || null,
    color: tint ?? 0xffffff,
    flatShading: true,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

function buildPathPatch(x, y, gY, texture, r = 15) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(r, 16),
    new THREE.MeshStandardMaterial({ map: texture || null, flatShading: true, roughness: 0.95, transparent: true, opacity: 0.92 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, gY + 0.08, y);
  return mesh;
}

function buildWater(zone, assets) {
  const frames = assets.getTilesetTexture('water');
  const def = assets.getTilesetDef('water');
  const tileWorldSize = def?.tileWorldSize || 64;
  const { cx, cy, radius } = zone.water;
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    new THREE.MeshStandardMaterial({
      map: Array.isArray(frames) ? frames[0] : frames,
      transparent: true,
      opacity: 0.92,
      roughness: 0.25,
      metalness: 0.05,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  const gY = groundHeight(cx, cy, zone.radius, zone.seed);
  mesh.position.set(cx, gY - 0.6, cy);
  mesh.userData.isWater = true;
  mesh.userData.frames = Array.isArray(frames) ? frames : [frames];
  mesh.userData.fps = def?.fps || 2;
  // ré-échelle l'UV pour que la texture d'eau se répète à bonne taille
  const uvAttr = mesh.geometry.attributes.uv;
  const posAttr = mesh.geometry.attributes.position;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setXY(i, posAttr.getX(i) / tileWorldSize, posAttr.getY(i) / tileWorldSize);
  }
  uvAttr.needsUpdate = true;
  return mesh;
}

// ----------------------------------------------------------------------
// Décor 3D léger : primitives simples (peu de segments), esprit low
// poly peint à la main plutôt que du photoréalisme.
// ----------------------------------------------------------------------

function flatMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.04, ...opts });
}

function makeTree(rng) {
  const g = new THREE.Group();
  const trunkH = 6 + rng() * 3;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1, trunkH, 6), flatMat(0x8a6a45));
  trunk.position.y = trunkH / 2;
  g.add(trunk);
  const leafColors = [0x6fae5a, 0x7fc06a, 0x5b9a49];
  const tiers = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < tiers; i++) {
    const size = 5.4 - i * 1.2 + rng() * 0.6;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(size, 5.2, 7), flatMat(leafColors[i % leafColors.length]));
    cone.position.y = trunkH + i * 3.2 + 2.4;
    g.add(cone);
  }
  g.userData.canopy = g.children.slice(1);
  return g;
}

function makeBush(rng) {
  const g = new THREE.Group();
  const clumps = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < clumps; i++) {
    const s = 1.4 + rng() * 1;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), flatMat(0x6fae5a));
    m.position.set((rng() - 0.5) * 2.4, s * 0.7, (rng() - 0.5) * 2.4);
    g.add(m);
  }
  return g;
}

function makeRock(rng) {
  const s = 1.2 + rng() * 2.2;
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), flatMat(0x9a9a92, { roughness: 0.95 }));
  m.scale.y = 0.6 + rng() * 0.4;
  m.rotation.y = rng() * Math.PI;
  return m;
}

function makeMushroom(rng) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.8, 6), flatMat(0xf3e6d0));
  stem.position.y = 0.9;
  g.add(stem);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), flatMat(0xd0554a));
  cap.position.y = 1.8;
  g.add(cap);
  g.scale.setScalar(0.8 + rng() * 0.8);
  return g;
}

function makeLamp(rng) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 6.5, 6), flatMat(0x5a4a3a));
  post.position.y = 3.25;
  g.add(post);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe4a3, transparent: true, opacity: 0.95 }));
  globe.position.y = 6.8;
  g.add(globe);
  const light = new THREE.PointLight(0xffcf87, 1.1, 18);
  light.position.y = 6.8;
  g.add(light);
  return g;
}

function makeScarecrow(rng) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8, 5), flatMat(0x8a6a45));
  post.position.y = 4;
  g.add(post);
  const arms = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 5.5, 5), flatMat(0x8a6a45));
  arms.rotation.z = Math.PI / 2;
  arms.position.y = 6.2;
  g.add(arms);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 8), flatMat(0xd9c48a));
  body.position.y = 6.4;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), flatMat(0xe8d2a0));
  head.position.y = 8.2;
  g.add(head);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 8), flatMat(0x4a3a2e));
  hat.position.y = 8.9;
  g.add(hat);
  return g;
}

function makeDock() {
  const g = new THREE.Group();
  const plankMat = flatMat(0x9a7a52, { roughness: 0.9 });
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 2.6), plankMat);
    plank.position.set(0, 0.5, i * 2.7);
    g.add(plank);
  }
  return g;
}

function makeBuilding(cfg) {
  const g = new THREE.Group();
  const wallMat = flatMat(cfg.wall || 0xf0e6d2, { roughness: 0.9 });
  const roofMat = flatMat(cfg.roof || 0xb15c4a, { roughness: 0.8 });
  const h = 12;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(cfg.w, h, cfg.h), wallMat);
  wall.position.y = h / 2;
  g.add(wall);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(cfg.w, cfg.h) * 0.72, 8, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = h + 4;
  g.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(3, 5.4, 0.4), flatMat(0x5a3f2c));
  door.position.set(0, 2.7, cfg.h / 2 + 0.21);
  g.add(door);
  const winMat = flatMat(0xbfe6f2, { roughness: 0.4, metalness: 0.1 });
  [-1, 1].forEach((side) => {
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 0.3), winMat);
    win.position.set(side * cfg.w * 0.28, 6.6, cfg.h / 2 + 0.2);
    g.add(win);
  });
  g.position.set(cfg.x, 0, cfg.y);
  return g;
}

const DECOR_FACTORIES = {
  tree: makeTree,
  bush: makeBush,
  rock: makeRock,
  mushroom: makeMushroom,
  lamp: makeLamp,
  scarecrow: makeScarecrow,
  dock: makeDock,
};

// ----------------------------------------------------------------------
// Flore 2D (billboards) : petites cartes texturées avec le sous-rect
// correspondant de tilesets/flora.png (voir AssetManifest.getFlora()).
// C'est ici le "mélange sprites 2D / décor 3D léger" demandé.
// ----------------------------------------------------------------------

function makeFloraBillboard(kind, floraTex, floraDef) {
  const names = Object.keys(floraDef.cells);
  const idx = floraDef.cells[kind] ?? 0;
  const cols = names.length;

  const tex = floraTex.clone();
  tex.needsUpdate = true;
  tex.repeat.set(1 / cols, 1);
  tex.offset.set(idx / cols, 0);

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const size = kind === 'bush' ? 6 : 4.2;
  sprite.scale.set(size, size, 1);
  sprite.center.set(0.5, 0);
  return sprite;
}

// ----------------------------------------------------------------------

function buildPortal(portalConfig, zone) {
  const g = new THREE.Group();
  const gY = groundHeight(portalConfig.pos.x, portalConfig.pos.y, zone.radius, zone.seed);
  g.position.set(portalConfig.pos.x, gY, portalConfig.pos.y);

  // Arche de bois fleurie plutôt qu'un anneau cosmique — même mécanique
  // (proximité = voyage), habillage "sentier de campagne".
  const postMat = flatMat(0x8a6a45);
  [-3.4, 3.4].forEach((side) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 9, 6), postMat);
    post.position.set(side, 4.5, 0);
    g.add(post);
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1, 1), postMat);
  beam.position.y = 9;
  g.add(beam);
  [-2, 0, 2].forEach((dx) => {
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), flatMat(0xe07a86));
    bloom.position.set(dx, 9.6, 0);
    g.add(bloom);
  });
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 20),
    new THREE.MeshBasicMaterial({ color: 0xffe4a3, transparent: true, opacity: 0.28, side: THREE.DoubleSide })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.15;
  g.add(glow);
  const light = new THREE.PointLight(0xffe4a3, 1, 20);
  light.position.y = 6;
  g.add(light);

  return g;
}

/**
 * Construit le groupe complet d'une zone : sol, eau (si présente),
 * chemins, décor 3D + flore 2D placés de façon déterministe, bâtiments,
 * portails. Retourne aussi les listes utiles à la boucle de jeu
 * (portails pour la détection de proximité, éléments "balançables" pour
 * l'animation de vent, l'eau pour l'anim de cycle de frames).
 */
export function buildZoneGroup(zone, assets) {
  const group = new THREE.Group();
  group.name = `zone:${zone.id}`;

  const groundTex = assets.getTilesetTexture(zone.ground);
  group.add(buildTerrainMesh({ radius: zone.radius, seed: zone.seed, texture: groundTex, tileWorldSize: zone.tileWorldSize, tint: zone.groundTint }));

  const waterMeshes = [];
  if (zone.water) {
    const water = buildWater(zone, assets);
    group.add(water);
    waterMeshes.push(water);
  }

  const pathTex = assets.getTilesetTexture('dirt-path');
  (zone.paths || []).forEach((p) => {
    const gY = groundHeight(p.x, p.y, zone.radius, zone.seed);
    group.add(buildPathPatch(p.x, p.y, gY, pathTex, 17));
    const gY0 = groundHeight(zone.spawn.x, zone.spawn.y, zone.radius, zone.seed);
    group.add(buildPathPatch((p.x + zone.spawn.x) / 2, (p.y + zone.spawn.y) / 2, (gY + gY0) / 2, pathTex, 14));
  });

  const rng = mulberry32(hashString(zone.id) + 1);
  const swayItems = [];
  const decorMinRadius = 20;

  (zone.decor || []).forEach(({ type, count }) => {
    const factory = DECOR_FACTORIES[type];
    if (!factory) return;
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = decorMinRadius + rng() * (zone.radius * 0.86 - decorMinRadius);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      if (zone.water && Math.hypot(x - zone.water.cx, z - zone.water.cy) < zone.water.radius + 8) continue;
      const item = factory(rng);
      const gY = groundHeight(x, z, zone.radius, zone.seed);
      item.position.set(x, gY, z);
      item.rotation.y = rng() * Math.PI * 2;
      const scale = 0.85 + rng() * 0.35;
      item.scale.setScalar(scale);
      group.add(item);
      if (type === 'tree' || type === 'bush') {
        swayItems.push({ obj: item, phase: rng() * Math.PI * 2, speed: 0.7 + rng() * 0.4, amount: type === 'tree' ? 0.045 : 0.07 });
      }
    }
  });

  const { texture: floraTex, def: floraDef } = assets.getFlora();
  if (floraTex && floraDef) {
    (zone.flora || []).forEach(({ type, count }) => {
      for (let i = 0; i < count; i++) {
        const angle = rng() * Math.PI * 2;
        const dist = decorMinRadius * 0.6 + rng() * (zone.radius * 0.9 - decorMinRadius * 0.6);
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        if (zone.water && Math.hypot(x - zone.water.cx, z - zone.water.cy) < zone.water.radius + 4) continue;
        const sprite = makeFloraBillboard(type, floraTex, floraDef);
        const gY = groundHeight(x, z, zone.radius, zone.seed);
        sprite.position.set(x, gY, z);
        group.add(sprite);
        swayItems.push({ obj: sprite, phase: rng() * Math.PI * 2, speed: 1.4 + rng() * 0.6, amount: 0.12, isFlora: true });
      }
    });
  }

  (zone.buildings || []).forEach((cfg) => {
    const gY = groundHeight(cfg.x, cfg.y, zone.radius, zone.seed);
    const building = makeBuilding(cfg);
    building.position.y = gY;
    group.add(building);
  });

  const portalMeshes = [];
  (zone.portals || []).forEach((portalConfig) => {
    const portalGroup = buildPortal(portalConfig, zone);
    group.add(portalGroup);
    portalMeshes.push({ group: portalGroup, to: portalConfig.to, worldX: portalConfig.pos.x, worldY: portalConfig.pos.y });
  });

  return { group, portalMeshes, swayItems, waterMeshes };
}
