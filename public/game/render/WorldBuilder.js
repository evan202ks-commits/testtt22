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
  // Sprites d'arbres (fournis par l'utilisateur — voir fiche des
  // arbres) : découpés en "vue avant" depuis la planche de référence,
  // fond violet détouré en transparence. Tailles naturelles figées en
  // dur (mesurées une fois pour toutes à la découpe) pour pouvoir
  // calculer worldW/worldH tout de suite, sans attendre le chargement
  // réseau de l'image — même principe que FRAME_W/FRAME_H pour l'atlas
  // du personnage dans WorldRenderer.js.
  // ------------------------------------------------------------------
  // ASSET_VERSION : à incrémenter à chaque fois qu'on remplace un fichier
  // sprite sur disque sous le même nom. Ajouté en "cache-buster" (?v=)
  // sur toutes les URLs d'assets ci-dessous : sans ça, un navigateur (ou
  // un CDN/hébergeur en amont) qui a déjà mis l'ancienne image en cache
  // continue de l'afficher indéfiniment après un déploiement, même si le
  // fichier a changé sur le serveur — symptôme typique : un sprite qui
  // semble "tronqué" ou périmé alors que le fichier source est correct.
  const ASSET_VERSION = 3;
  function withVersion(url) {
    return `${url}?v=${ASSET_VERSION}`;
  }

  // Sapins (pine.png / pine_big.png) retirés du tirage : silhouette
  // haute et étroite qui rendait ces sprites visuellement sensibles aux
  // problèmes de cache d'image (cime tronquée signalée par l'utilisateur,
  // non reproduite côté code mais persistante côté client malgré le
  // cache-busting). Les entrées restent définies ici uniquement pour ne
  // pas casser TREE_SPRITE_DEFS/getTreeSpriteImage si jamais réutilisées
  // plus tard, mais plus aucun pool ci-dessous n'y fait référence.
  const TREE_SPRITE_DEFS = {
    leafTree: { url: withVersion('/assets/sprites/trees/leaf_tree.png'), w: 156, h: 187 },
    leafTreeBig: { url: withVersion('/assets/sprites/trees/leaf_tree_big.png'), w: 168, h: 198 },
    pine: { url: withVersion('/assets/sprites/trees/pine.png'), w: 119, h: 194 },
    pineBig: { url: withVersion('/assets/sprites/trees/pine_big.png'), w: 147, h: 203 },
    fruitTree: { url: withVersion('/assets/sprites/trees/fruit_tree.png'), w: 145, h: 156 },
    deadTree: { url: withVersion('/assets/sprites/trees/dead_tree.png'), w: 122, h: 154 },
  };
  // type de décor (voir WORLD.decor / WORLD.landmarks) -> pioche parmi
  // plusieurs sprites (répétés pour pondérer les chances de tirage).
  // Le type "pine" (zones de forêt de conifères, voir WORLD.decor et le
  // landmark du plateau rocheux) pioche désormais dans le même pool que
  // "tree" (feuillage rond) : plus aucun sapin pointu n'est dessiné, sans
  // avoir à toucher à la disposition/aux emplacements de la forêt.
  const TREE_TYPE_POOLS = {
    tree: ['leafTree', 'leafTree', 'leafTree', 'leafTreeBig'],
    pine: ['leafTree', 'leafTree', 'leafTree', 'leafTreeBig'],
    appleTree: ['fruitTree'],
    deadTree: ['deadTree'],
  };

  const _treeSpriteImages = {};
  function getTreeSpriteImage(key) {
    if (!_treeSpriteImages[key]) {
      const img = new Image();
      img.src = TREE_SPRITE_DEFS[key].url;
      _treeSpriteImages[key] = img;
    }
    return _treeSpriteImages[key];
  }

  // ------------------------------------------------------------------
  // Textures de sol (fournies par l'utilisateur — voir fiche des textures
  // d'environnement) : 4 tons d'herbe, découpés depuis la planche de
  // référence (pas de texture de falaise : aplat de couleur, voir plus
  // bas). Utilisées en CanvasPattern (répétées) pour peindre l'herbe du
  // monde (voir buildGroundCanvas), à la place de l'aplat d'origine.
  // Chargées de façon asynchrone comme les sprites d'arbres ;
  // buildGroundCanvas retombe sur l'ancien dégradé tant qu'elles ne sont
  // pas prêtes, et onGroundTexturesReady permet à WorldRenderer.js de
  // redessiner le sol une fois le chargement terminé.
  // ------------------------------------------------------------------
  const GROUND_TEXTURE_DEFS = {
    grassClaire: { url: withVersion('/assets/sprites/textures/grass_claire.png') },
    grassMoyenne: { url: withVersion('/assets/sprites/textures/grass_moyenne.png') },
    grassSombre: { url: withVersion('/assets/sprites/textures/grass_sombre.png') },
    grassDense: { url: withVersion('/assets/sprites/textures/grass_dense.png') },
    // Eau — 3 tons d'eau profonde (large) + 2 d'eau peu profonde (côte),
    // découpés de la même planche. Remplacent le dégradé radial bleu.
    waterDeep1: { url: withVersion('/assets/sprites/textures/water_deep_1.png') },
    waterDeep2: { url: withVersion('/assets/sprites/textures/water_deep_2.png') },
    waterDeep3: { url: withVersion('/assets/sprites/textures/water_deep_3.png') },
    waterShallow1: { url: withVersion('/assets/sprites/textures/water_shallow_1.png') },
    waterShallow2: { url: withVersion('/assets/sprites/textures/water_shallow_2.png') },
    // Sable — clair/moyen pour le corps de la plage, humide pour la
    // rangée de cases qui touche l'eau.
    sandClair: { url: withVersion('/assets/sprites/textures/sand_clair.png') },
    sandMoyen: { url: withVersion('/assets/sprites/textures/sand_moyen.png') },
    sandHumide: { url: withVersion('/assets/sprites/textures/sand_humide.png') },
  };

  // ------------------------------------------------------------------
  // Détails (petits sprites détourés, fond transparent) semés par-dessus
  // le sol : galets/coquillages/touffes sur le sable, rochers, algues,
  // nénuphars et reflets sur l'eau. Dessinés à DECAL_SIZE px, posés sur
  // la même grille que le terrain (voir scatterDecals).
  // ------------------------------------------------------------------
  const DETAIL_SPRITE_DEFS = {
    sandPebbles1: '/assets/sprites/details/sand_pebbles_1.png',
    sandPebbles2: '/assets/sprites/details/sand_pebbles_2.png',
    sandShells: '/assets/sprites/details/sand_shells.png',
    sandTufts: '/assets/sprites/details/sand_tufts.png',
    waterRock1: '/assets/sprites/details/water_rock_1.png',
    waterRock2: '/assets/sprites/details/water_rock_2.png',
    waterRock3: '/assets/sprites/details/water_rock_3.png',
    waterAlgae1: '/assets/sprites/details/water_algae_1.png',
    waterAlgae2: '/assets/sprites/details/water_algae_2.png',
    waterLily1: '/assets/sprites/details/water_lily_1.png',
    waterLily2: '/assets/sprites/details/water_lily_2.png',
    waterSparkle1: '/assets/sprites/details/water_sparkle_1.png',
    waterSparkle2: '/assets/sprites/details/water_sparkle_2.png',
    waterSparkle3: '/assets/sprites/details/water_sparkle_3.png',
    waterFoamBits: '/assets/sprites/details/water_foam_bits.png',
  };
  const DECAL_SIZE = 52; // 2 cases de terrain

  const _groundTextureImages = {};
  const _detailImages = {};
  let _groundTexturesLoaded = false;
  const _groundTextureReadyCallbacks = [];

  // Un seul verrou pour TOUTES les images de sol (textures + détails) :
  // le canvas de sol n'est reconstruit qu'une fois, quand tout est là.
  (function loadGroundTextures() {
    const jobs = [];
    Object.keys(GROUND_TEXTURE_DEFS).forEach((key) => {
      jobs.push([_groundTextureImages, key, GROUND_TEXTURE_DEFS[key].url]);
    });
    Object.keys(DETAIL_SPRITE_DEFS).forEach((key) => {
      jobs.push([_detailImages, key, withVersion(DETAIL_SPRITE_DEFS[key])]);
    });
    let remaining = jobs.length;
    const done = () => {
      remaining--;
      if (remaining === 0) {
        _groundTexturesLoaded = true;
        _groundTextureReadyCallbacks.splice(0).forEach((cb) => cb());
      }
    };
    jobs.forEach(([store, key, url]) => {
      const img = new Image();
      img.onload = done;
      img.onerror = done; // une image manquante ne doit pas bloquer le sol
      img.src = url;
      store[key] = img;
    });
  })();

  /** Appelle `cb` dès que les textures et détails de sol sont chargés
   * (tout de suite s'ils le sont déjà). Utilisé par WorldRenderer.js pour
   * reconstruire le canvas de sol une fois les images prêtes. */
  function onGroundTexturesReady(cb) {
    if (_groundTexturesLoaded) cb();
    else _groundTextureReadyCallbacks.push(cb);
  }

  // ------------------------------------------------------------------
  // Mosaïques de terrain — version "tuiles" (RPG 16 bits).
  // ------------------------------------------------------------------
  // Un sol n'est plus un dégradé continu entre ses tons : il est découpé
  // en CASES carrées (TERRAIN_CELL) et CHAQUE case reçoit UNE SEULE
  // texture, choisie par un bruit lissé. Conséquence : les frontières
  // entre deux tons ne sont plus floues mais en marches d'escalier à
  // angles droits, alignées sur la grille — exactement la façon dont un
  // Pokémon DS raccorde herbe / sable / eau.
  //
  // La même grille (TERRAIN_CELL) sert aussi à découper l'eau, la
  // falaise, l'herbe, le sable et l'étang dans buildGroundCanvas (voir
  // cellRegionPath) pour que TOUTES les intersections de textures du
  // monde tombent sur les mêmes lignes.
  const GRASS_TILE = 104;   // taille normalisée d'une tuile de texture
  const TERRAIN_CELL = 26;  // côté d'une case de terrain (quart de tuile)

  // Les textures fournies ne font pas toutes exactement la même taille :
  // on les re-dessine une fois pour toutes dans une tuile carrée de
  // GRASS_TILE px pour que tout tombe pile sur la grille.
  const _normalizedTiles = {};
  function getNormalizedTile(key) {
    if (!_normalizedTiles[key]) {
      const c = document.createElement('canvas');
      c.width = GRASS_TILE;
      c.height = GRASS_TILE;
      const tctx = c.getContext('2d');
      tctx.imageSmoothingEnabled = false; // garde le grain pixel net
      tctx.drawImage(_groundTextureImages[key], 0, 0, GRASS_TILE, GRASS_TILE);
      _normalizedTiles[key] = c;
    }
    return _normalizedTiles[key];
  }

  // --- Bruit de valeur simple (Value Noise 2D), périodique ---
  // Grille de valeurs aléatoires interpolées bilinéairement : champ
  // continu [0,1]. Il ne sert PLUS à fondre les textures, seulement à
  // décider QUELLE texture reçoit chaque case → les taches restent
  // organiques, mais leurs bords sont crénelés sur la grille.
  function makeValueNoise(grid, seed) {
    const rng = mathUtils.mulberry32(seed);
    const g = [];
    for (let gy = 0; gy <= grid; gy++) {
      g[gy] = [];
      for (let gx = 0; gx <= grid; gx++) g[gy][gx] = rng();
    }
    const smooth = (t) => t * t * (3 - 2 * t);
    return function sample(nx, ny) {
      const ix = Math.floor(nx) % grid;
      const iy = Math.floor(ny) % grid;
      const fx = nx - Math.floor(nx);
      const fy = ny - Math.floor(ny);
      const ix1 = (ix + 1) % grid;
      const iy1 = (iy + 1) % grid;
      const sx = smooth(fx);
      const sy = smooth(fy);
      const v00 = g[iy][ix];
      const v10 = g[iy][ix1];
      const v01 = g[iy1][ix];
      const v11 = g[iy1][ix1];
      return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
    };
  }

  /**
   * Construit (et met en cache) une mosaïque de tuiles répétable.
   *
   * @param {string} id      clé de cache
   * @param {Array}  layers  [{ key, upTo }] du ton "bas" au ton "haut" ;
   *                         `upTo` = borne haute du bruit pour ce ton
   *                         (le dernier doit valoir 1).
   * @param {number} seed    graine (mêmes taches à chaque partie)
   * @param {number} cells   côté de la mosaïque en cases (défaut 48 →
   *                         1248 px, multiple entier de GRASS_TILE, donc
   *                         répétable sans raccord visible).
   */
  const _mosaicCache = {};
  function getMosaicCanvas(id, layers, seed, cells) {
    if (_mosaicCache[id]) return _mosaicCache[id];
    if (!_groundTexturesLoaded) return null;

    const CELLS = cells || 48;
    const W = CELLS * TERRAIN_CELL;
    const H = W;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const gctx = canvas.getContext('2d');

    // Bruit volontairement BASSE fréquence : une cellule de bruit couvre
    // plusieurs cases, sinon on obtient un damier au lieu de zones nettes.
    const GRID_COARSE = 5;
    const GRID_FINE = 10;
    const noiseA = makeValueNoise(GRID_COARSE, seed);
    const noiseB = makeValueNoise(GRID_FINE, seed + 1);
    const noiseC = makeValueNoise(GRID_COARSE, seed + 2);

    function noiseAt(px, py) {
      const n =
        noiseA((px / W) * GRID_COARSE, (py / H) * GRID_COARSE) * 0.88 +
        noiseB((px / W) * GRID_FINE, (py / H) * GRID_FINE) * 0.12;
      const m = noiseC((px / W) * GRID_COARSE, (py / H) * GRID_COARSE);
      return n * 0.78 + m * 0.22;
    }

    // Un CanvasPattern par ton, tous calés sur l'origine du canvas : deux
    // cases voisines du même ton restent parfaitement raccordées, seule
    // la frontière entre deux tons différents se voit.
    const patterns = {};
    layers.forEach((l) => {
      if (!patterns[l.key]) patterns[l.key] = gctx.createPattern(getNormalizedTile(l.key), 'repeat');
    });

    for (let py = 0; py < H; py += TERRAIN_CELL) {
      for (let px = 0; px < W; px += TERRAIN_CELL) {
        const t = noiseAt(px + TERRAIN_CELL / 2, py + TERRAIN_CELL / 2);
        let chosen = layers[layers.length - 1];
        for (const l of layers) {
          if (t < l.upTo) { chosen = l; break; }
        }
        gctx.fillStyle = patterns[chosen.key];
        gctx.fillRect(px, py, TERRAIN_CELL, TERRAIN_CELL);
      }
    }

    _mosaicCache[id] = canvas;
    return canvas;
  }

  // Mosaïques du monde. Seeds fixes : même découpe à chaque partie.
  // grassDense / waterDeep3 / sandHumide restent rares (seuil haut) →
  // petites taches isolées plutôt qu'un damier.
  const getGrassPatternCanvas = () => getMosaicCanvas('grass', [
    { key: 'grassSombre', upTo: 0.40 },
    { key: 'grassMoyenne', upTo: 0.58 },
    { key: 'grassClaire', upTo: 0.75 },
    { key: 'grassDense', upTo: 1 },
  ], 20260805);

  // Au large on ne mélange que les deux bleus sombres : la 3e tuile
  // (plus claire) ressortait en carrés isolés au milieu de l'eau. Les
  // éclats de lumière viennent des décals "reflets" à la place.
  const getDeepWaterPatternCanvas = () => getMosaicCanvas('waterDeep', [
    { key: 'waterDeep2', upTo: 0.5 },
    { key: 'waterDeep1', upTo: 1 },
  ], 20260810, 32);

  const getShallowWaterPatternCanvas = () => getMosaicCanvas('waterShallow', [
    { key: 'waterShallow2', upTo: 0.52 },
    { key: 'waterShallow1', upTo: 1 },
  ], 20260812, 24);

  // Plage sèche : clair + moyen seulement (le ton humide est réservé à
  // la rangée qui touche l'eau, sinon il fait des taches sombres au
  // milieu du sable).
  const getSandPatternCanvas = () => getMosaicCanvas('sand', [
    { key: 'sandMoyen', upTo: 0.45 },
    { key: 'sandClair', upTo: 1 },
  ], 20260814, 24);

  const getWetSandPatternCanvas = () => getMosaicCanvas('sandWet', [
    { key: 'sandHumide', upTo: 1 },
  ], 20260816, 12);

  /**
   * Construit un Path2D composé UNIQUEMENT de cases carrées de la grille
   * TERRAIN_CELL : une case est retenue si son centre satisfait
   * `inside(x, y)`. Sert à peindre falaise / herbe / sable / étang avec
   * des contours en marches d'escalier alignés sur la même grille que la
   * mosaïque d'herbe, au lieu des courbes lisses d'origine.
   * Utilisable aussi bien en ctx.fill(path) qu'en ctx.clip(path).
   */
  function cellRegionPath(w, h, inside, cell) {
    const c = cell || TERRAIN_CELL;
    const path = new Path2D();
    for (let py = 0; py < h; py += c) {
      for (let px = 0; px < w; px += c) {
        if (inside(px + c / 2, py + c / 2)) path.rect(px, py, c, c);
      }
    }
    return path;
  }

  function pickTreeSpriteKey(type, rng) {
    const pool = TREE_TYPE_POOLS[type];
    return pool[Math.floor(rng() * pool.length)];
  }

  /** Construit un prop "sprite d'arbre" (image, pas canvas peint) prêt à
   * être poussé dans `props` : même forme que les props procéduraux
   * (type/x/y/canvas/worldW/worldH[/rotation]), `canvas` pointant ici
   * vers une <img> — ctx.drawImage() accepte les deux indifféremment. */
  function makeTreeProp(type, x, y, rng, worldH, rotation) {
    const spriteKey = pickTreeSpriteKey(type, rng);
    const def = TREE_SPRITE_DEFS[spriteKey];
    const img = getTreeSpriteImage(spriteKey);
    const worldW = worldH * (def.w / def.h);
    return { type, x, y, canvas: img, worldW, worldH, rotation: rotation || 0 };
  }


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
      { type: 'pine', count: 15, angleRange: [deg(-150), deg(-25)], spreadRange: [0.3, 0.92] },
      { type: 'tree', count: 6, angleRange: [deg(-130), deg(-10)], spreadRange: [0.35, 0.85] },
      { type: 'deadTree', count: 2, angleRange: [deg(-150), deg(-25)], spreadRange: [0.4, 0.85] },
      { type: 'tree', count: 7, spreadRange: [0.2, 0.7] },
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
    tree: [90, 138], appleTree: [90, 138], pine: [66, 152], deadTree: [64, 134], bush: [44, 36],
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

    // Eau (fond) : mosaïque de tuiles d'eau profonde (voir
    // getDeepWaterPatternCanvas) au lieu de l'ancien dégradé radial. Le
    // dégradé sert encore de repli tant que les images ne sont pas
    // chargées, et repasse par-dessus en translucide pour garder la
    // sensation de profondeur au large.
    const deepWaterCanvas = getDeepWaterPatternCanvas();
    const waterGrad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.18, cx, cy, Math.max(w, h) * 0.72);
    waterGrad.addColorStop(0, hex(world.waterColor));
    waterGrad.addColorStop(1, hex(world.waterColor2));
    ctx.fillStyle = deepWaterCanvas ? ctx.createPattern(deepWaterCanvas, 'repeat') : waterGrad;
    ctx.fillRect(0, 0, w, h);
    if (deepWaterCanvas) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = waterGrad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // ------------------------------------------------------------------
    // Découpe du terrain en CASES (grille TERRAIN_CELL).
    // ------------------------------------------------------------------
    // Toutes les zones de sol (écume, falaise, herbe, sable, étang) sont
    // désormais peintes case par case au lieu d'être des polygones lisses :
    // leurs contours — et donc toutes les intersections entre textures —
    // tombent sur la même grille à angles droits que la mosaïque d'herbe.
    const steps = 160; // échantillonnage angulaire (strates de falaise)
    const angleAt = (px, py) => Math.atan2(py - cy, px - cx);
    const distAt = (px, py) => Math.hypot(px - cx, py - cy);
    // "à l'intérieur du rayon r(angle) (+ marge)"
    const insideRadius = (radiusFn, pad) => (px, py) =>
      distAt(px, py) <= radiusFn(angleAt(px, py)) + (pad || 0);
    // anneau d'une case d'épaisseur, collé au bord intérieur du rayon
    const rimOfRadius = (radiusFn, thickness) => (px, py) => {
      const r = radiusFn(angleAt(px, py));
      const d = distAt(px, py);
      return d <= r && d > r - (thickness || TERRAIN_CELL);
    };

    const foamPath = cellRegionPath(w, h, insideRadius(world.boundaryRadius, TERRAIN_CELL));
    const cliffPath = cellRegionPath(w, h, insideRadius(world.boundaryRadius));
    const cliffRimPath = cellRegionPath(w, h, rimOfRadius(world.boundaryRadius));
    const grassPath = cellRegionPath(w, h, insideRadius(world.grassRadius));
    const grassRimPath = cellRegionPath(w, h, rimOfRadius(world.grassRadius));

    // ------------------------------------------------------------------
    // Détails semés (galets, coquillages, rochers immergés, algues,
    // reflets — voir DETAIL_SPRITE_DEFS). Posés à DECAL_SIZE px sur la
    // demi-grille du terrain : ils restent alignés sur le damier, donc
    // cohérents avec les bords en marches d'escalier.
    // ------------------------------------------------------------------
    const HALF_CELL = TERRAIN_CELL / 2;
    function drawDecal(key, px, py) {
      const img = _detailImages[key];
      if (!img || !img.width) return;
      const gx = Math.round((px - DECAL_SIZE / 2) / HALF_CELL) * HALF_CELL;
      const gy = Math.round((py - DECAL_SIZE / 2) / HALF_CELL) * HALF_CELL;
      ctx.drawImage(img, gx, gy, DECAL_SIZE, DECAL_SIZE);
    }
    /** Sème `count` décals pris au hasard dans `keys`, aux endroits
     * acceptés par `accept(x, y)`. Tirage déterministe (seed du monde). */
    function scatterDecals(keys, count, seed, accept, alpha) {
      const rng = mathUtils.mulberry32(mathUtils.hashString(world.id) + seed);
      ctx.save();
      if (alpha) ctx.globalAlpha = alpha;
      let placed = 0;
      let guard = 0;
      while (placed < count && guard++ < count * 60) {
        const px = rng() * w;
        const py = rng() * h;
        if (!accept(px, py)) continue;
        drawDecal(keys[Math.floor(rng() * keys.length)], px, py);
        placed++;
      }
      ctx.restore();
    }

    // Eau peu profonde : bande de tuiles côtières (turquoise) sur
    // quelques cases autour de l'île, découpée à la case → la limite
    // large / haut-fond est franche, comme sur la fiche.
    const SHALLOW_BAND = TERRAIN_CELL * 5;
    const shallowCanvas = getShallowWaterPatternCanvas();
    const shallowPath = cellRegionPath(w, h, insideRadius(world.boundaryRadius, SHALLOW_BAND));
    if (shallowCanvas) {
      ctx.fillStyle = ctx.createPattern(shallowCanvas, 'repeat');
      ctx.fill(shallowPath);
    }

    // Écume : anneau blanc translucide d'une case, débordant sur l'eau.
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fill(foamPath);

    // Falaise (terre) : aplat de couleur + liseré sombre d'une case sur
    // le pourtour (l'ancien stroke ne marche plus : le path est fait de
    // rectangles indépendants, le contourner dessinerait la grille).
    ctx.fillStyle = hex(world.cliffColor);
    ctx.fill(cliffPath);
    ctx.fillStyle = shade(world.cliffColor, -0.30);
    ctx.fill(cliffRimPath);

    // Petites strates sur la bande de falaise (texture "terrasses").
    ctx.save();
    ctx.clip(cliffPath);
    ctx.strokeStyle = shade(world.cliffColor, -0.22);
    ctx.lineWidth = 3;
    for (let i = 0; i <= steps; i += 3) {
      const angle = (i / steps) * Math.PI * 2;
      const rc = world.boundaryRadius(angle);
      const rg = world.grassRadius(angle);
      const x1 = cx + Math.cos(angle) * rc, y1 = cy + Math.sin(angle) * rc;
      const x2 = cx + Math.cos(angle) * rg, y2 = cy + Math.sin(angle) * rg;
      ctx.beginPath();
      ctx.moveTo(mix(x1, x2, 0.3), mix(y1, y2, 0.3));
      ctx.lineTo(mix(x1, x2, 0.55), mix(y1, y2, 0.55));
      ctx.stroke();
    }
    ctx.restore();

    // Herbe (sommet de l'île) : mosaïque de tuiles (voir
    // getGrassPatternCanvas) en CanvasPattern — calée sur l'origine du
    // canvas, donc sur la même grille que les cases — avec par-dessus un
    // léger dégradé radial pour garder la profondeur d'avant. Tant que
    // les textures ne sont pas chargées, on retombe sur l'ancien dégradé.
    const grassPatternCanvas = getGrassPatternCanvas();
    const grassGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(world.halfWidth, world.halfHeight));
    grassGrad.addColorStop(0, hex(world.groundColor));
    grassGrad.addColorStop(1, hex(world.groundColor2));
    ctx.fillStyle = grassPatternCanvas ? ctx.createPattern(grassPatternCanvas, 'repeat') : grassGrad;
    ctx.fill(grassPath);
    // Liseré d'ombre d'une case là où l'herbe surplombe la falaise.
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = shade(world.groundColor2, -0.45);
    ctx.fill(grassRimPath);
    ctx.restore();
    if (grassPatternCanvas) {
      ctx.save();
      ctx.clip(grassPath);
      const shadeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(world.halfWidth, world.halfHeight));
      shadeGrad.addColorStop(0, 'rgba(255,255,255,0.10)');
      shadeGrad.addColorStop(0.6, 'rgba(0,0,0,0)');
      shadeGrad.addColorStop(1, 'rgba(0,0,0,0.30)');
      ctx.fillStyle = shadeGrad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // Plages de sable : bandes qui longent la côte sur certains secteurs
    // angulaires (voir world.sandZones), profondeur maximale au centre du
    // secteur et retombant à 0 sur ses bords — mais découpées à la case,
    // donc raccordées à l'herbe en marches d'escalier.
    if (world.sandZones && world.sandZones.length) {
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
      const sandPath = cellRegionPath(w, h, (px, py) => {
        const angle = angleAt(px, py);
        const d = distAt(px, py);
        const rGrass = world.grassRadius(angle);
        const depth = sandDepthAt(angle);
        return depth > 0 && d <= rGrass && d > rGrass - depth;
      });
      ctx.save();
      const sandCanvas = getSandPatternCanvas();
      const wetSandCanvas = getWetSandPatternCanvas();
      const sandGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(world.halfWidth, world.halfHeight));
      sandGrad.addColorStop(0, hex(world.sandColor));
      sandGrad.addColorStop(1, hex(world.sandColor2));
      ctx.fillStyle = sandCanvas ? ctx.createPattern(sandCanvas, 'repeat') : sandGrad;
      ctx.fill(sandPath);
      // Sable humide : les 2 cases qui touchent l'eau (ton foncé de la
      // fiche) — transition franche sable sec / sable mouillé.
      if (wetSandCanvas) {
        const wetPath = cellRegionPath(w, h, (px, py) => {
          const angle = angleAt(px, py);
          const d = distAt(px, py);
          const rGrass = world.grassRadius(angle);
          return sandDepthAt(angle) > 0 && d <= rGrass && d > rGrass - TERRAIN_CELL * 2;
        });
        ctx.fillStyle = ctx.createPattern(wetSandCanvas, 'repeat');
        ctx.fill(wetPath);
      }
      // Petits galets épars sur le sable, eux aussi calés sur la grille.
      const srng = mathUtils.mulberry32(mathUtils.hashString(world.id) + 11);
      ctx.clip(sandPath);
      const pebble = TERRAIN_CELL / 4;
      for (let i = 0; i < 220; i++) {
        const angle = srng() * Math.PI * 2;
        const depth = sandDepthAt(angle);
        if (depth < 10) continue;
        const rGrass = world.grassRadius(angle);
        const rr = rGrass - srng() * depth;
        const px = Math.round((cx + Math.cos(angle) * rr) / pebble) * pebble;
        const py = Math.round((cy + Math.sin(angle) * rr) / pebble) * pebble;
        ctx.globalAlpha = 0.12 + srng() * 0.14;
        ctx.fillStyle = srng() > 0.5 ? '#ffffff' : '#8a6339';
        ctx.fillRect(px, py, pebble, pebble);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // Galets, coquillages et touffes d'herbe sur la plage.
      const onSand = (px, py) => {
        const angle = angleAt(px, py);
        const d = distAt(px, py);
        const rGrass = world.grassRadius(angle);
        const depth = sandDepthAt(angle);
        return depth > 30 && d < rGrass - HALF_CELL && d > rGrass - depth + HALF_CELL;
      };
      scatterDecals(['sandPebbles1', 'sandPebbles2', 'sandShells'], 14, 31, onSand);
      scatterDecals(['sandTufts'], 8, 33, onSand);
    }

    // Variations d'usure sur l'herbe : anciennes taches rondes remplacées
    // par des cases éclaircies/assombries, pour ne pas casser la grille.
    ctx.save();
    ctx.clip(grassPath);
    const rng = mathUtils.mulberry32(mathUtils.hashString(world.id));
    const spots = Math.round((w * h) / 9000);
    for (let i = 0; i < spots; i++) {
      const px = Math.floor((rng() * w) / TERRAIN_CELL) * TERRAIN_CELL;
      const py = Math.floor((rng() * h) / TERRAIN_CELL) * TERRAIN_CELL;
      ctx.globalAlpha = 0.05 + rng() * 0.05;
      ctx.fillStyle = rng() > 0.5 ? '#ffffff' : '#000000';
      ctx.fillRect(px, py, TERRAIN_CELL, TERRAIN_CELL);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Petit étang niché dans l'herbe (voir world.pond) : rive de sable
    // clair puis eau, découpés à la case comme le reste.
    if (world.pond) {
      const pond = world.pond;
      const ox = cx + pond.x;
      const oy = cy + pond.y;
      const insideEllipse = (k) => (px, py) => {
        const dx = (px - ox) / (pond.rx * k);
        const dy = (py - oy) / (pond.ry * k);
        return dx * dx + dy * dy <= 1;
      };
      const shorePath = cellRegionPath(w, h, insideEllipse(1.14));
      const waterPath = cellRegionPath(w, h, insideEllipse(1));
      ctx.save();
      ctx.clip(grassPath);
      const pondShoreCanvas = getWetSandPatternCanvas();
      ctx.fillStyle = pondShoreCanvas ? ctx.createPattern(pondShoreCanvas, 'repeat') : hex(world.sandColor);
      ctx.fill(shorePath);
      const pondWaterCanvas = getShallowWaterPatternCanvas();
      const pondGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, Math.max(pond.rx, pond.ry));
      pondGrad.addColorStop(0, hex(world.waterColor));
      pondGrad.addColorStop(1, hex(world.waterColor2));
      ctx.fillStyle = pondWaterCanvas ? ctx.createPattern(pondWaterCanvas, 'repeat') : pondGrad;
      ctx.fill(waterPath);
      // Nénuphars et algues de l'étang (vrais sprites de la fiche).
      const prng = mathUtils.mulberry32(mathUtils.hashString(world.id) + 23);
      const lilyKeys = ['waterLily1', 'waterLily2', 'waterAlgae1', 'waterAlgae2'];
      for (let i = 0; i < 5; i++) {
        const a = prng() * Math.PI * 2;
        const rr = 0.15 + prng() * 0.5;
        drawDecal(
          lilyKeys[Math.floor(prng() * lilyKeys.length)],
          ox + Math.cos(a) * pond.rx * rr,
          oy + Math.sin(a) * pond.ry * rr
        );
      }
      ctx.restore();
    }

    // ------------------------------------------------------------------
    // Détails de l'eau : rochers immergés et algues sur les hauts-fonds,
    // éclats d'écume au ras de la côte, reflets épars au large.
    // ------------------------------------------------------------------
    const onShallowWater = (px, py) => {
      const d = distAt(px, py);
      const r = world.boundaryRadius(angleAt(px, py));
      return d > r + TERRAIN_CELL * 1.5 && d < r + SHALLOW_BAND - HALF_CELL;
    };
    const onDeepWater = (px, py) => {
      const d = distAt(px, py);
      const r = world.boundaryRadius(angleAt(px, py));
      return d > r + SHALLOW_BAND + TERRAIN_CELL;
    };
    scatterDecals(['waterRock1', 'waterRock2', 'waterRock3'], 16, 41, onShallowWater);
    scatterDecals(['waterAlgae1', 'waterAlgae2'], 12, 43, onShallowWater);
    scatterDecals(['waterFoamBits'], 18, 45, onShallowWater, 0.75);
    scatterDecals(['waterSparkle1', 'waterSparkle2', 'waterSparkle3'], 40, 47, onDeepWater, 0.55);

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
    // Positions déjà occupées par un élément "haut" (arbre/buisson),
    // consultées par tooCloseToPlacedTall pour espacer le tirage
    // aléatoire (voir minSpacing dans la boucle ci-dessous).
    const _placedTall = [];
    function tooCloseToPlacedTall(x, y, minDist) {
      for (const pt of _placedTall) {
        if (Math.hypot(x - pt.x, y - pt.y) < minDist) return true;
      }
      return false;
    }

    WORLD.decor.forEach(({ type, count, angleRange, spreadRange }) => {
      const size = DECOR_SIZE[type] || [40, 50];
      const [sMin, sMax] = spreadRange || [0.32, 0.94];
      // Écart minimal entre deux éléments "hauts" (arbres/buissons) pour
      // éviter que les cimes ne s'entassent les unes sur les autres —
      // sans ça, le tirage purement aléatoire produit des paquets
      // d'arbres agglutinés par endroits (voir _placedTall, partagé
      // entre toutes les entrées de WORLD.decor).
      const minSpacing = TREE_TYPE_POOLS[type] || type === 'bush' ? size[0] * 1.05 + 20 : 0;
      for (let i = 0; i < count; i++) {
        let x = 0, y = 0, tries = 0, placed = false;
        while (tries < 60) {
          const angle = angleRange
            ? angleRange[0] + rng() * (angleRange[1] - angleRange[0])
            : rng() * Math.PI * 2;
          const spread = sMin + rng() * (sMax - sMin);
          const maxR = Math.max(0, WORLD.grassRadius(angle) - 34);
          x = Math.cos(angle) * maxR * spread;
          y = Math.sin(angle) * maxR * spread;
          tries++;
          if (isBlocked(x, y, landmarkZones)) continue;
          if (minSpacing && tooCloseToPlacedTall(x, y, minSpacing)) continue;
          placed = true;
          break;
        }
        if (!placed) continue;
        if (minSpacing) _placedTall.push({ x, y });
        // Types "arbre" -> sprite fourni (voir TREE_TYPE_POOLS), reste ->
        // icône procédurale peinte sur canvas (comportement inchangé).
        if (TREE_TYPE_POOLS[type]) {
          const worldH = size[1] * (0.85 + rng() * 0.3);
          props.push(makeTreeProp(type, x, y, rng, worldH));
          continue;
        }
        const canvas = buildDecorCanvas(type, rng, WORLD.accentColor);
        if (!canvas) continue;
        const scale = 0.85 + rng() * 0.3;
        props.push({ type, x, y, canvas, worldW: size[0] * scale, worldH: size[1] * scale });
      }
    });

    WORLD.landmarks.forEach((l) => {
      const size = DECOR_SIZE[l.type] || [60, 60];
      const scale = l.scale || 1;
      if (TREE_TYPE_POOLS[l.type]) {
        props.push(makeTreeProp(l.type, l.x, l.y, rng, size[1] * scale, l.rotation));
        return;
      }
      const canvas = buildDecorCanvas(l.type, rng, WORLD.accentColor);
      if (!canvas) return;
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

  window.Game.WorldBuilder = { WORLD, buildWorld, clampToIsland, resolvePlayerMove, onGroundTexturesReady };
})();
