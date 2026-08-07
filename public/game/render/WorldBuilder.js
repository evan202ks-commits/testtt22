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
    // --- Reliefs (fiche des textures : falaises, rochers) ---
    cliffHigh: { url: withVersion('/assets/sprites/reliefs/cliff_high.png'), w: 129, h: 117 },
    cliffMid: { url: withVersion('/assets/sprites/reliefs/cliff_mid.png'), w: 129, h: 103 },
    cliffLow: { url: withVersion('/assets/sprites/reliefs/cliff_low.png'), w: 129, h: 105 },
    plateauBlock: { url: withVersion('/assets/sprites/reliefs/plateau.png'), w: 129, h: 105 },
    cornerOuter: { url: withVersion('/assets/sprites/reliefs/corner_outer.png'), w: 93, h: 104 },
    cornerInner: { url: withVersion('/assets/sprites/reliefs/corner_inner.png'), w: 93, h: 104 },
    slopeBlock: { url: withVersion('/assets/sprites/reliefs/slope.png'), w: 98, h: 104 },
    rockBig: { url: withVersion('/assets/sprites/reliefs/rock_big.png'), w: 109, h: 79 },
    rockSmall: { url: withVersion('/assets/sprites/reliefs/rock_small.png'), w: 62, h: 45 },
    // --- Plantes (fiche des textures : herbe / végétation) ---
    bushSprite: { url: withVersion('/assets/sprites/plants/bush.png'), w: 87, h: 72 },
    tuftSprite: { url: withVersion('/assets/sprites/plants/tuft.png'), w: 58, h: 58 },
    flowersBlue: { url: withVersion('/assets/sprites/plants/flowers_blue.png'), w: 46, h: 49 },
    flowersRed: { url: withVersion('/assets/sprites/plants/flowers_red.png'), w: 67, h: 60 },
    flowersWhite: { url: withVersion('/assets/sprites/plants/flowers_white.png'), w: 66, h: 63 },
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
    // Plantes et rochers : sprites de la fiche des textures, à la place
    // des icônes peintes à la main (voir ICONS, conservées comme repli).
    bush: ['bushSprite'],
    flower: ['flowersBlue', 'flowersRed', 'flowersWhite'],
    tuft: ['tuftSprite'],
    rock: ['rockSmall', 'rockSmall', 'rockBig'],
    // Blocs de relief (voir MASSIF / buildMassifLandmarks) : falaises
    // vues de trois-quarts, avec le pan rocheux tourné vers le joueur.
    cliffHigh: ['cliffHigh'],
    cliffMid: ['cliffMid'],
    cliffLow: ['cliffLow'],
    cliffPlateau: ['plateauBlock'],
    cliffCornerOuter: ['cornerOuter'],
    cliffCornerInner: ['cornerInner'],
    cliffSlope: ['slopeBlock'],
  };

  // Types dessinés à l'échelle native du sprite (voir
  // makeScaledSpriteProp) : les blocs de relief gardent leurs
  // proportions d'origine pour rester jointifs et empilables.
  // Décors "hauts" : seuls ceux-là s'espacent entre eux (voir minSpacing).
  const TALL_DECOR_TYPES = new Set(['tree', 'pine', 'appleTree', 'deadTree', 'bush']);

  const SCALED_SPRITE_TYPES = new Set([
    'cliffHigh', 'cliffMid', 'cliffLow', 'cliffPlateau',
    'cliffCornerOuter', 'cliffCornerInner', 'cliffSlope',
  ]);

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
    // Pan rocheux du massif : bande tuilable horizontalement (104×90),
    // frange d'herbe comprise en haut — voir drawMassif.
    cliffFace: '/assets/sprites/reliefs/cliff_face.png',
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

  /** Prop dessiné à l'échelle NATIVE du sprite (× scale) : utilisé pour
   * les blocs de relief, dont les proportions relatives (un bloc haut est
   * plus haut qu'un bloc bas, un coin est plus étroit) portent justement
   * l'effet de relief — les redimensionner à hauteur constante l'aplatit. */
  function makeScaledSpriteProp(type, x, y, rng, scale) {
    const spriteKey = pickTreeSpriteKey(type, rng);
    const def = TREE_SPRITE_DEFS[spriteKey];
    return {
      type, x, y,
      canvas: getTreeSpriteImage(spriteKey),
      worldW: def.w * scale,
      worldH: def.h * scale,
      rotation: 0,
    };
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
  // L'ÎLE : relevée case par case sur l'image de référence.
  // ------------------------------------------------------------------
  // Le contour n'est plus généré (ellipse + harmoniques) : il est LU
  // dans game/render/IslandData.js, une grille de cases de 26 px où
  // chaque caractère décrit un type de terrain ('~' eau, '.' herbe,
  // 's' sable, 'd' chemin, 'o' étang, '^' plateau). Tout le reste —
  // rendu du sol, collisions, placement des décors — dérive de cette
  // grille, ce qui reproduit la côte, les plages, l'étang, les chemins
  // et le massif nord exactement comme sur la référence.
  // ------------------------------------------------------------------
  const ISLAND = (window.Game && window.Game.IslandData) || { cell: 26, rows: [], props: [] };
  const MAP_ROWS = ISLAND.rows;
  const MAP_H = MAP_ROWS.length;
  const MAP_W = MAP_H ? MAP_ROWS[0].length : 0;
  const MAP_OX = (MAP_W * TERRAIN_CELL) / 2; // décalage grille -> monde
  const MAP_OY = (MAP_H * TERRAIN_CELL) / 2;
  const WATER_MARGIN = 260; // marge d'eau visible au-delà de la côte

  const LAND_CHARS = '.sd^';   // cases où l'on marche
  const GROUND_CHARS = '.sd^o'; // cases d'île (l'étang compris)

  /** Caractère de la case (col, row) — '~' hors carte. */
  function cellChar(col, row) {
    if (col < 0 || row < 0 || row >= MAP_H || col >= MAP_W) return '~';
    return MAP_ROWS[row][col];
  }
  const colOf = (x) => Math.floor((x + MAP_OX) / TERRAIN_CELL);
  const rowOf = (y) => Math.floor((y + MAP_OY) / TERRAIN_CELL);
  /** Type de terrain sous un point du monde. */
  function terrainAt(x, y) {
    return cellChar(colOf(x), rowOf(y));
  }
  const isLandChar = (ch) => LAND_CHARS.indexOf(ch) >= 0;
  const isGroundChar = (ch) => GROUND_CHARS.indexOf(ch) >= 0;
  /** Point marchable ? (terre ferme, ni eau ni étang) */
  function isWalkable(x, y) {
    return isLandChar(terrainAt(x, y));
  }

  // Distance (en cases) de chaque case d'eau à la terre la plus proche —
  // parcours en largeur depuis toutes les cases de sol. Sert à peindre
  // les hauts-fonds et l'écume, et à semer les rochers immergés.
  const WATER_DIST = (function computeWaterDistance() {
    const dist = new Int16Array(MAP_W * MAP_H).fill(999);
    const queue = [];
    for (let row = 0; row < MAP_H; row++) {
      for (let col = 0; col < MAP_W; col++) {
        if (isGroundChar(cellChar(col, row))) {
          dist[row * MAP_W + col] = 0;
          queue.push(row * MAP_W + col);
        }
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head];
      const col = idx % MAP_W;
      const row = (idx - col) / MAP_W;
      const d = dist[idx] + 1;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dc, dr]) => {
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= MAP_W || nr >= MAP_H) return;
        const ni = nr * MAP_W + nc;
        if (dist[ni] > d) {
          dist[ni] = d;
          queue.push(ni);
        }
      });
    }
    return dist;
  })();
  function waterDist(col, row) {
    if (col < 0 || row < 0 || col >= MAP_W || row >= MAP_H) return 999;
    return WATER_DIST[row * MAP_W + col];
  }

  // Rayon de terre par angle (720 échantillons) : uniquement pour les
  // rares appels qui raisonnent encore en polaire. Le rendu et les
  // collisions, eux, lisent directement la grille.
  const RADIUS_TABLE = (function buildRadiusTable() {
    const STEPS = 720;
    const maxR = Math.hypot(MAP_OX, MAP_OY);
    const table = new Float32Array(STEPS);
    for (let i = 0; i < STEPS; i++) {
      const angle = (i / STEPS) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let last = 0;
      for (let r = 0; r < maxR; r += TERRAIN_CELL / 2) {
        if (isLandChar(terrainAt(cos * r, sin * r))) last = r;
      }
      table[i] = last;
    }
    return table;
  })();
  function landRadius(angle) {
    const STEPS = RADIUS_TABLE.length;
    let i = Math.round(((angle / (Math.PI * 2)) % 1) * STEPS);
    i = ((i % STEPS) + STEPS) % STEPS;
    return RADIUS_TABLE[i];
  }

  const WORLD_ID = 'starter-island';
  const CLIFF_WALL_H = 46;    // hauteur du pan rocheux de la côte
  const PLATEAU_WALL_H = 58;  // hauteur du pan rocheux du plateau nord
  const FACE_OVERHANG = 10;   // débord de la frange d'herbe sur le dessus

  // Ponton : relevé à l'est sur la référence, il s'avance sur l'eau.
  const DOCK_X = 640;
  const DOCK_Y = 148;
  const DOCK_LEN = 180;

  const WORLD = {
    id: WORLD_ID,
    name: 'Île du campement',
    halfWidth: MAP_OX + WATER_MARGIN,
    halfHeight: MAP_OY + WATER_MARGIN,
    spawn: { x: DOCK_X - 150, y: DOCK_Y },
    waterColor: 0x11487a,
    waterColor2: 0x0a2f56,
    groundColor: 0x6fae5a,
    groundColor2: 0x4d8a44,
    sandColor: 0xdcc08a,
    sandColor2: 0xc2a06a,
    cliffColor: 0x8a5a34,
    accentColor: 0xe8b45c,
    // Conservés pour les quelques appels polaires restants.
    boundaryRadius: landRadius,
    grassRadius: landRadius,
    landmarks: [
      { type: 'dock', x: DOCK_X, y: DOCK_Y, scale: DOCK_LEN / 300, rotation: Math.PI / 2 },
      { type: 'lamp', x: DOCK_X + DOCK_LEN, y: DOCK_Y - 10, scale: 1 },
      // Gros rocher posé sur le plateau nord, comme sur la référence.
      { type: 'rock', x: -8, y: -496, scale: 1.6 },
    ],
  };

  /** Ramène un point sur la terre ferme : si la case visée n'est pas
   * marchable, on tente le glissement sur un seul axe (le joueur longe la
   * côte au lieu de se bloquer net), sinon on garde la position d'avant. */
  function clampToIsland(x, y, margin = 0) {
    if (isWalkable(x, y) && isWalkable(x + margin, y) && isWalkable(x - margin, y)
      && isWalkable(x, y + margin) && isWalkable(x, y - margin)) {
      return { x, y };
    }
    // Recherche du point marchable le plus proche sur une petite spirale.
    for (let r = TERRAIN_CELL / 2; r <= TERRAIN_CELL * 4; r += TERRAIN_CELL / 2) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (isWalkable(px, py) && isWalkable(px + margin, py) && isWalkable(px, py + margin)) {
          return { x: px, y: py };
        }
      }
    }
    return { x, y };
  }

  function isInsideRelief() { return false; } // plus de murs pleins depuis la refonte

  function resolvePlayerMove(prevX, prevY, nextX, nextY, margin = 0) {
    const ok = (px, py) => isWalkable(px, py)
      && isWalkable(px + margin, py) && isWalkable(px - margin, py)
      && isWalkable(px, py + margin) && isWalkable(px, py - margin);
    if (ok(nextX, nextY)) return { x: nextX, y: nextY };
    if (ok(nextX, prevY)) return { x: nextX, y: prevY };  // glissement horizontal
    if (ok(prevX, nextY)) return { x: prevX, y: nextY };  // glissement vertical
    return { x: prevX, y: prevY };
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
    tree: [90, 138], appleTree: [90, 138], pine: [66, 152], deadTree: [64, 134], bush: [70, 58],
    rock: [46, 33], mushroom: [27, 32], flower: [36, 34], tuft: [44, 44], stump: [46, 30],
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
  /**
   * Peint tout le sol de l'île à partir de la grille relevée (ISLAND).
   * Une passe par couche, case par case :
   *   1. eau profonde partout, hauts-fonds puis écume selon la distance
   *      à la terre (WATER_DIST),
   *   2. pan rocheux sous chaque case de terre dont le voisin sud est de
   *      l'eau — c'est lui qui donne l'île "posée en hauteur",
   *   3. les cases de terre : herbe / sable / chemin / étang,
   *   4. le liseré sombre sur tout le reste du pourtour,
   *   5. le plateau nord (cases '^') : herbe éclaircie + son propre pan,
   *   6. les décals (rochers immergés, algues, reflets, galets).
   */
  function buildGroundCanvas(world) {
    const w = Math.round(world.halfWidth * 2);
    const h = Math.round(world.halfHeight * 2);
    const cx = world.halfWidth;
    const cy = world.halfHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const CELL = TERRAIN_CELL;
    // Coin haut-gauche (canvas) de la case (col,row).
    const px = (col) => cx - MAP_OX + col * CELL;
    const py = (row) => cy - MAP_OY + row * CELL;

    // --- 1. l'eau ---------------------------------------------------
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

    const shallowCanvas = getShallowWaterPatternCanvas();
    const shallowPattern = shallowCanvas ? ctx.createPattern(shallowCanvas, 'repeat') : null;
    const SHALLOW_CELLS = 4; // largeur du haut-fond autour de l'île
    if (shallowPattern) {
      ctx.fillStyle = shallowPattern;
      for (let row = 0; row < MAP_H; row++) {
        for (let col = 0; col < MAP_W; col++) {
          const d = waterDist(col, row);
          if (d > 0 && d <= SHALLOW_CELLS) ctx.fillRect(px(col), py(row), CELL, CELL);
        }
      }
    }
    // Écume : la première case d'eau au contact de la terre.
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    for (let row = 0; row < MAP_H; row++) {
      for (let col = 0; col < MAP_W; col++) {
        if (waterDist(col, row) === 1) ctx.fillRect(px(col), py(row), CELL, CELL);
      }
    }

    // --- 2. pan rocheux de la côte ----------------------------------
    // Dessiné AVANT les cases de terre pour que la frange d'herbe du
    // haut du pan se glisse sous elles.
    const faceImg = _detailImages.cliffFace;
    const facePattern = faceImg && faceImg.width ? ctx.createPattern(faceImg, 'repeat') : null;
    function drawWallUnder(col, row, wallH) {
      const x = px(col);
      const top = py(row) + CELL - FACE_OVERHANG;
      if (facePattern) {
        ctx.save();
        ctx.translate(x, top);
        ctx.scale(1, (wallH + FACE_OVERHANG) / 90); // la tuile fait 90 px de haut
        ctx.fillStyle = facePattern;
        ctx.fillRect(0, 0, CELL, 90);
        ctx.restore();
      } else {
        ctx.fillStyle = hex(world.cliffColor);
        ctx.fillRect(x, top, CELL, wallH + FACE_OVERHANG);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(x, top + wallH + FACE_OVERHANG - 5, CELL, 5);
    }
    for (let row = 0; row < MAP_H; row++) {
      for (let col = 0; col < MAP_W; col++) {
        if (!isLandChar(cellChar(col, row))) continue;
        if (!isLandChar(cellChar(col, row + 1))) drawWallUnder(col, row, CLIFF_WALL_H);
      }
    }

    // --- 3. les cases de terre --------------------------------------
    const grassPatternCanvas = getGrassPatternCanvas();
    const grassGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(world.halfWidth, world.halfHeight));
    grassGrad.addColorStop(0, hex(world.groundColor));
    grassGrad.addColorStop(1, hex(world.groundColor2));
    const grassPattern = grassPatternCanvas ? ctx.createPattern(grassPatternCanvas, 'repeat') : grassGrad;
    const sandCanvas = getSandPatternCanvas();
    const sandGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(world.halfWidth, world.halfHeight));
    sandGrad.addColorStop(0, hex(world.sandColor));
    sandGrad.addColorStop(1, hex(world.sandColor2));
    const sandPattern = sandCanvas ? ctx.createPattern(sandCanvas, 'repeat') : sandGrad;
    const wetCanvas = getWetSandPatternCanvas();
    const wetPattern = wetCanvas ? ctx.createPattern(wetCanvas, 'repeat') : sandGrad;

    const fillFor = (ch, col, row) => {
      if (ch === 's') {
        // Sable mouillé sur la rangée qui touche l'eau.
        const wet = !isLandChar(cellChar(col + 1, row)) || !isLandChar(cellChar(col - 1, row))
          || !isLandChar(cellChar(col, row + 1)) || !isLandChar(cellChar(col, row - 1));
        return wet ? wetPattern : sandPattern;
      }
      if (ch === 'd') return wetPattern; // chemin de terre battue
      if (ch === 'o') return shallowPattern || waterGrad; // étang
      return grassPattern;
    };
    for (let row = 0; row < MAP_H; row++) {
      for (let col = 0; col < MAP_W; col++) {
        const ch = cellChar(col, row);
        if (!isGroundChar(ch)) continue;
        ctx.fillStyle = fillFor(ch, col, row);
        ctx.fillRect(px(col), py(row), CELL, CELL);
      }
    }
    // Rive de sable mouillé autour de l'étang.
    ctx.fillStyle = wetPattern;
    for (let row = 0; row < MAP_H; row++) {
      for (let col = 0; col < MAP_W; col++) {
        if (cellChar(col, row) !== '.') continue;
        const nearPond = cellChar(col + 1, row) === 'o' || cellChar(col - 1, row) === 'o'
          || cellChar(col, row + 1) === 'o' || cellChar(col, row - 1) === 'o';
        if (nearPond) ctx.fillRect(px(col), py(row), CELL, CELL);
      }
    }

    // Ombrage général : léger halo clair au centre, coins assombris.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const shadeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.55);
    shadeGrad.addColorStop(0, 'rgba(255,255,255,0.06)');
    shadeGrad.addColorStop(0.65, 'rgba(0,0,0,0)');
    shadeGrad.addColorStop(1, 'rgba(0,0,0,0.20)');
    ctx.fillStyle = shadeGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // --- 4. tranche de terre sur le reste du pourtour ----------------
    // Côté nord/est/ouest on ne voit pas le pan rocheux (il n'est visible
    // que de face, au sud) : on peint à la place une tranche de terre de
    // 8 px, bordée d'un trait sombre — c'est ce liseré brun continu qui
    // fait lire l'île comme un plateau posé sur l'eau, comme sur la
    // référence.
    const RIM = 8;
    const rimFill = shade(world.cliffColor, -0.05);
    const rimEdge = shade(world.cliffColor, -0.55);
    function drawRim(x, y, bw, bh, side) {
      ctx.fillStyle = rimFill;
      ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = rimEdge;
      if (side === 'n') ctx.fillRect(x, y, bw, 3);
      if (side === 'w') ctx.fillRect(x, y, 3, bh);
      if (side === 'e') ctx.fillRect(x + bw - 3, y, 3, bh);
    }
    for (let row = 0; row < MAP_H; row++) {
      for (let col = 0; col < MAP_W; col++) {
        if (!isLandChar(cellChar(col, row))) continue;
        const x = px(col);
        const y = py(row);
        if (!isLandChar(cellChar(col, row - 1))) drawRim(x, y, CELL, RIM, 'n');
        if (!isLandChar(cellChar(col - 1, row))) drawRim(x, y, RIM, CELL, 'w');
        if (!isLandChar(cellChar(col + 1, row))) drawRim(x + CELL - RIM, y, RIM, CELL, 'e');
      }
    }

    // --- 5. plateau nord (cases '^') --------------------------------
    // Même principe que la côte, un cran plus haut : surface éclaircie,
    // pan rocheux sous son bord sud, liseré tout autour.
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let row = 0; row < MAP_H; row++) {
      for (let col = 0; col < MAP_W; col++) {
        if (cellChar(col, row) === '^') ctx.fillRect(px(col), py(row), CELL, CELL);
      }
    }
    for (let row = 0; row < MAP_H; row++) {
      for (let col = 0; col < MAP_W; col++) {
        if (cellChar(col, row) !== '^') continue;
        if (cellChar(col, row + 1) !== '^') drawWallUnder(col, row, PLATEAU_WALL_H);
      }
    }
    for (let row = 0; row < MAP_H; row++) {
      for (let col = 0; col < MAP_W; col++) {
        if (cellChar(col, row) !== '^') continue;
        const x = px(col);
        const y = py(row);
        if (cellChar(col, row - 1) !== '^') drawRim(x, y, CELL, RIM, 'n');
        if (cellChar(col - 1, row) !== '^') drawRim(x, y, RIM, CELL, 'w');
        if (cellChar(col + 1, row) !== '^') drawRim(x + CELL - RIM, y, RIM, CELL, 'e');
      }
    }

    // --- 6. décals ---------------------------------------------------
    const HALF_CELL = CELL / 2;
    function drawDecal(key, wx, wy) {
      const img = _detailImages[key];
      if (!img || !img.width) return;
      const gx = Math.round((cx + wx - DECAL_SIZE / 2) / HALF_CELL) * HALF_CELL;
      const gy = Math.round((cy + wy - DECAL_SIZE / 2) / HALF_CELL) * HALF_CELL;
      ctx.drawImage(img, gx, gy, DECAL_SIZE, DECAL_SIZE);
    }
    function scatterCells(keys, seed, accept, chance, alpha) {
      const rng = mathUtils.mulberry32(mathUtils.hashString(world.id) + seed);
      ctx.save();
      if (alpha) ctx.globalAlpha = alpha;
      for (let row = 0; row < MAP_H; row++) {
        for (let col = 0; col < MAP_W; col++) {
          if (!accept(col, row)) continue;
          if (rng() > chance) continue;
          const wx = (col + 0.5) * CELL - MAP_OX;
          const wy = (row + 0.5) * CELL - MAP_OY;
          drawDecal(keys[Math.floor(rng() * keys.length)], wx, wy);
        }
      }
      ctx.restore();
    }
    const isShallow = (col, row) => {
      const d = waterDist(col, row);
      return d >= 2 && d <= SHALLOW_CELLS;
    };
    const isDeep = (col, row) => waterDist(col, row) > SHALLOW_CELLS + 1;
    const isSand = (col, row) => cellChar(col, row) === 's';
    const isPondCell = (col, row) => cellChar(col, row) === 'o';
    scatterCells(['waterRock1', 'waterRock2', 'waterRock3'], 41, isShallow, 0.07);
    scatterCells(['waterAlgae1', 'waterAlgae2'], 43, isShallow, 0.05);
    scatterCells(['waterFoamBits'], 45, isShallow, 0.08, 0.75);
    scatterCells(['waterSparkle1', 'waterSparkle2', 'waterSparkle3'], 47, isDeep, 0.05, 0.55);
    scatterCells(['sandPebbles1', 'sandPebbles2', 'sandShells'], 31, isSand, 0.18);
    scatterCells(['waterLily1', 'waterLily2', 'waterAlgae1'], 51, isPondCell, 0.22);

    return canvas;
  }

  /** Sprite dessiné à sa taille native × scale (arbres relevés sur la
   * référence : la planche fournit déjà les bonnes proportions entre
   * feuillus, conifères et grands arbres, il suffit de les réduire). */
  const TREE_WORLD_SCALE = 0.74;
  function makeTreeFromKey(key, x, y, scale) {
    const def = TREE_SPRITE_DEFS[key];
    if (!def) return null;
    const s = TREE_WORLD_SCALE * (scale || 1);
    return {
      type: 'tree', x, y,
      canvas: getTreeSpriteImage(key),
      worldW: def.w * s,
      worldH: def.h * s,
      rotation: 0,
    };
  }

  /**
   * Construit le décor complet du monde : sol (canvas déjà peint) et
   * liste de props. Les arbres, buissons, fleurs et rochers ne sont plus
   * tirés au hasard : ils viennent du relevé de l'île de référence
   * (ISLAND.props), donc la répartition — forêt dense au nord, clairières
   * au sud, bosquets autour de l'étang — est celle de l'image.
   */
  function buildWorld() {
    const ground = buildGroundCanvas(WORLD);
    const rng = mathUtils.mulberry32(mathUtils.hashString(WORLD.id) + 1);
    const props = [];

    (ISLAND.props || []).forEach((p) => {
      if (p.t === 'tree') {
        const prop = makeTreeFromKey(p.s, p.x, p.y, 0.9 + rng() * 0.22);
        if (prop) props.push(prop);
        return;
      }
      if (TREE_TYPE_POOLS[p.t]) {
        const size = DECOR_SIZE[p.t] || [40, 50];
        props.push(makeTreeProp(p.t, p.x, p.y, rng, size[1] * (0.85 + rng() * 0.3)));
        return;
      }
      const size = DECOR_SIZE[p.t] || [40, 50];
      const canvas = buildDecorCanvas(p.t, rng, WORLD.accentColor);
      if (!canvas) return;
      const scale = 0.85 + rng() * 0.3;
      props.push({ type: p.t, x: p.x, y: p.y, canvas, worldW: size[0] * scale, worldH: size[1] * scale });
    });

    WORLD.landmarks.forEach((l) => {
      const size = DECOR_SIZE[l.type] || [60, 60];
      const scale = l.scale || 1;
      if (SCALED_SPRITE_TYPES.has(l.type)) {
        props.push(makeScaledSpriteProp(l.type, l.x, l.y, rng, scale));
        return;
      }
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
