'use strict';

/**
 * game/render/WorldRenderer.js
 * ----------------------------------------------------------------------
 * Rendu 2D vu de dessus (top-down), entièrement en Canvas 2D natif :
 * plus de Three.js, plus de WebGL, plus de planètes/portails. Un seul
 * monde (voir game/render/WorldBuilder.js), une caméra qui suit le
 * joueur local (translation simple, jamais de rotation ni de zoom), un
 * décor peint une fois puis "posé" (drawImage) à chaque frame, et les
 * personnages affichés à partir de la feuille de sprites fournie par le
 * joueur (public/assets/sprites/character_atlas.png, grille 5 colonnes
 * x 4 lignes : idle + 4 frames de marche, une ligne par direction).
 *
 * Expose la même API que l'ancien renderer (resize/setTime/ensureAvatar/
 * updateAvatar/followTarget/projectToScreen/render) pour que
 * game/GameEngine.js reste organisé de la même façon quelle que soit
 * l'implémentation interne du renderer.
 *
 * Chargé en <script> classique (voir index.html), après WorldBuilder.js
 * dont il dépend (window.Game.WorldBuilder) : aucun import ES, aucune
 * dépendance CDN, tout tourne avec ce que le navigateur fournit déjà.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

(function () {
  const ATLAS_URL = '/assets/sprites/character_atlas.png';
  const COLS = 5; // idle + 4 frames de marche
  const ROWS = 4; // bas / gauche / dos / droite
  const FRAME_W = 106;
  const FRAME_H = 152;

  // Lignes de la feuille de sprites.
  const ROW_DOWN = 0;
  const ROW_LEFT = 1;
  const ROW_UP = 2;
  const ROW_RIGHT = 3;

  // ------------------------------------------------------------------
  // Atlas alternatifs "personnage armé" : quand un objet de cette liste
  // est équipé, on n'affiche plus l'atlas de base + le sprite tenu en
  // main (EQUIP_SPRITES) mais une feuille de sprites dédiée où l'arme
  // est déjà intégrée au dessin du personnage dans chaque pose. Même
  // principe de grille (5 colonnes idle+marche), mais l'ordre des
  // lignes de celle du lance-cacahouète est FACE/CÔTÉ-droit/DOS/
  // CÔTÉ-gauche (voir génération de l'atlas), d'où un mapping de lignes
  // propre à cet atlas plutôt que ROW_LEFT/ROW_RIGHT habituels.
  // ------------------------------------------------------------------
  const EQUIPPED_ATLASES = {
    peanut_launcher: {
      url: '/assets/sprites/character_atlas_peanut_launcher.png',
      frameW: 260,
      frameH: 230,
      // Feuille "FACE / CÔTÉ / DOS / CÔTÉ (GAUCHE)" : la ligne "CÔTÉ" y
      // dessine en fait le personnage tourné vers la GAUCHE de l'écran, et
      // la ligne "CÔTÉ (GAUCHE)" le dessine tourné vers la DROITE — d'où ce
      // mapping qui ne suit pas l'ordre visuel des libellés (vérifié à
      // l'œil sur chaque ligne lors de la découpe de l'atlas).
      rowDown: 0,
      rowLeft: 1,
      rowUp: 2,
      rowRight: 3,
      // Ancre horizontale (0..1, fraction de frameW) : position des pieds
      // du personnage dans la cellule, calée une fois pour toutes lors de
      // la génération de l'atlas (voir script de découpe) sur *tous* les
      // frames — contrairement au centre géométrique de la cellule, qui
      // se déplaçait à chaque frame à cause de l'arme tenue en main
      // (bras/canon qui pivote et déborde plus ou moins d'un côté selon
      // la pose). Ancrer sur les pieds plutôt que sur la bbox visuelle
      // complète évite que le corps du personnage ne "saute"
      // horizontalement pendant l'animation de marche.
      anchorXFrac: 130 / 260,
      // Facteur d'échelle appliqué à la hauteur de dessin (en plus de
      // CHAR_HEIGHT). Nécessaire car dans CET atlas le personnage occupe
      // une part plus petite de la case (~79% de frameH, contre ~94% pour
      // character_atlas.png) : la case a été générée avec plus de marge
      // au-dessus de la tête pour laisser de la place à l'arme/aux bras
      // levés dans certaines poses. Sans ce facteur, dessiner à la même
      // hauteur de case (CHAR_HEIGHT) donne un personnage visuellement
      // plus petit une fois l'arme équipée. Valeur calibrée en mesurant
      // la hauteur du contenu opaque (tête→pieds, hors arme) sur les 5
      // frames de la ligne "bas" des deux atlas :
      //   normal  : ~143px de contenu / 152px de case = 0.941
      //   armé    : ~184px de contenu / 230px de case = 0.799
      //   scale = 0.941 / 0.799 ≈ 1.177
      sizeScale: 1.177,
    },
  };

  const _equippedAtlasImages = {};
  function getEquippedAtlasImage(equipId) {
    const def = EQUIPPED_ATLASES[equipId];
    if (!def) return null;
    if (!_equippedAtlasImages[equipId]) {
      const img = new Image();
      img.src = def.url;
      _equippedAtlasImages[equipId] = img;
    }
    return _equippedAtlasImages[equipId];
  }

  // Taille à l'écran du personnage (pixels), proche du gabarit relatif
  // qu'avait la créature dans l'ancienne version 3D par rapport aux arbres.
  const CHAR_HEIGHT = 88;
  const CHAR_WIDTH = CHAR_HEIGHT * (FRAME_W / FRAME_H);

  // ------------------------------------------------------------------
  // Objets tenus en main (voir game/Inventory.js `equipId` / GameEngine
  // .setLocalEquipped) : une seule image par objet, toujours affichée du
  // même côté (main droite à l'écran) quelle que soit la direction —
  // même parti pris que le bâton déjà peint dans l'atlas du personnage,
  // qui lui non plus ne change pas de côté. Ancrage calibré à l'œil pour
  // tomber à hauteur de hanche, par-dessus le personnage.
  // ------------------------------------------------------------------
  const EQUIP_SPRITES = {
    peanut_launcher: { url: '/assets/sprites/item_peanut_launcher_hand.png', w: 442, h: 252 },
  };
  const EQUIP_HEIGHT_FRAC = 0.36; // proportion de CHAR_HEIGHT
  const EQUIP_HAND_X_FRAC = 0.80; // proportion de CHAR_WIDTH depuis le bord gauche du personnage
  const EQUIP_HAND_Y_FRAC = 0.74; // proportion de CHAR_HEIGHT depuis le haut du personnage
  const EQUIP_GRIP_X_FRAC = 0.20; // point de "prise" sur le sprite de l'objet
  const EQUIP_GRIP_Y_FRAC = 0.52;

  const _equipImages = {};
  function getEquipImage(equipId) {
    const def = EQUIP_SPRITES[equipId];
    if (!def) return null;
    if (!_equipImages[equipId]) {
      const img = new Image();
      img.src = def.url;
      _equipImages[equipId] = img;
    }
    return _equipImages[equipId];
  }

  // ------------------------------------------------------------------
  // Sprite du projectile du lance-cacahuète (voir game/GameEngine.js :
  // this.projectiles). Fond violet d'origine détouré, recadré et orienté
  // à l'horizontale (grand axe le long de X) : la rotation appliquée au
  // dessin (voir _drawProjectiles) tourne donc librement autour de son
  // centre sans dépendre d'un axe de départ particulier.
  // ------------------------------------------------------------------
  const PROJECTILE_SPRITE = { url: '/assets/sprites/item_peanut_projectile.png', w: 220, h: 117 };
  const PROJECTILE_DISPLAY_H = 13; // hauteur à l'écran (px monde), largeur déduite du ratio du sprite
  const PROJECTILE_SPIN_SPEED = 12; // radians / seconde (vitesse de rotation en vol)

  let _projectileImg = null;
  function getProjectileImage() {
    if (!_projectileImg) {
      _projectileImg = new Image();
      _projectileImg.src = PROJECTILE_SPRITE.url;
    }
    return _projectileImg;
  }

  let sharedAtlas = null;
  function getSharedAtlas() {
    if (!sharedAtlas) {
      sharedAtlas = new Image();
      sharedAtlas.src = ATLAS_URL;
    }
    return sharedAtlas;
  }

  /**
   * Angle de déplacement (monde, atan2(dirX, dirY) — voir game/Player.js)
   * -> ligne de sprite à afficher. La caméra ne tourne jamais (vue du
   * dessus fixe), donc "est écran" = "est monde" et pas besoin de
   * projection comme dans l'ancienne version 3D à caméra 3/4.
   */
  function directionKey(facingAngle) {
    const deg = (facingAngle * 180) / Math.PI; // 0=bas,90=droite,180/-180=haut,-90=gauche
    if (deg > -45 && deg <= 45) return 'down';
    if (deg > 45 && deg <= 135) return 'right';
    if (deg > 135 || deg <= -135) return 'up';
    return 'left';
  }

  function directionRow(facingAngle) {
    const key = directionKey(facingAngle);
    if (key === 'down') return ROW_DOWN;
    if (key === 'right') return ROW_RIGHT;
    if (key === 'up') return ROW_UP;
    return ROW_LEFT;
  }

  class WorldRenderer {
    constructor(canvas, { bubbleLayerEl } = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.bubbleLayerEl = bubbleLayerEl || null;

      this.atlas = getSharedAtlas();

      const built = window.Game.WorldBuilder.buildWorld();
      this.world = built.world;
      this.ground = built.ground;
      this.props = built.props;

      this.time = 0;
      this.width = 0;
      this.height = 0;
      this._dpr = Math.min(window.devicePixelRatio || 1, 2);

      this._camX = this.world.spawn.x;
      this._camY = this.world.spawn.y;

      this._avatars = new Map(); // playerId -> { color, isLocal, frame: {col,row}, bobY }
      this._damageFlash = 0; // 0..1, décroît chaque frame (voir triggerDamageFlash)

      this.resize();
    }

    // ------------------------------------------------------------------
    // Cycle de vie / redimensionnement.
    // ------------------------------------------------------------------
    resize() {
      const parent = this.canvas.parentElement;
      let w = this.canvas.clientWidth || this.canvas.offsetWidth;
      let h = this.canvas.clientHeight || this.canvas.offsetHeight;
      if (!w && parent) w = parent.clientWidth || parent.offsetWidth;
      if (!h && parent) h = parent.clientHeight || parent.offsetHeight;
      if (!w) w = window.innerWidth;
      if (!h) h = window.innerHeight;

      this.width = w;
      this.height = h;
      this.canvas.width = Math.round(w * this._dpr);
      this.canvas.height = Math.round(h * this._dpr);
      this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    }

    setTime(t) {
      this.time = t;
    }

    // ------------------------------------------------------------------
    // Avatars joueurs
    // ------------------------------------------------------------------
    ensureAvatar(id, { color, isLocal }) {
      if (this._avatars.has(id)) return this._avatars.get(id);
      const avatar = {
        color, isLocal,
        frame: { col: 0, row: ROW_DOWN, dirKey: 'down' },
        bobY: 0, equippedItem: null,
      };
      this._avatars.set(id, avatar);
      return avatar;
    }

    removeAvatar(id) {
      this._avatars.delete(id);
    }

    // Un seul monde désormais : tous les joueurs y sont toujours visibles.
    setAvatarVisible() {}

    updateAvatar(id, player) {
      const avatar = this._avatars.get(id);
      if (!avatar) return;

      const t = player.animTime || 0;
      // speedFactor (~1 en marche, ~1.8 en course, voir game/Player.js)
      // amplifie et accélère le rebond du sprite pendant la course.
      const factor = player.isMoving ? (player.speedFactor || 1) : 0;
      const bobSpeed = player.isMoving ? 7.5 + factor * 3 : 2.4;
      const bobHeight = player.isMoving ? 2.6 + factor * 2 : 1.2;
      avatar.bobY = Math.abs(Math.sin(t * bobSpeed)) * bobHeight;

      const frame = avatar.frame;
      let row = frame.row;
      let dirKey = frame.dirKey;
      if (player.isMoving) {
        dirKey = directionKey(player.facingAngle);
        row = directionRow(player.facingAngle);
      }
      const col = player.isMoving ? 1 + Math.floor((t * 6) % 4) : 0;
      frame.col = col;
      frame.row = row;
      frame.dirKey = dirKey;

      avatar.equippedItem = player.equippedItem || null;
    }

    // ------------------------------------------------------------------
    // Caméra suiveuse (translation simple, jamais de rotation/zoom — la
    // vue reste toujours strictement du dessus, seul le déplacement au
    // clavier fait bouger la scène).
    // ------------------------------------------------------------------
    followTarget(x, y, dt) {
      const rate = 6;
      const t = 1 - Math.exp(-rate * dt);
      this._camX = window.Game.mathUtils.lerp(this._camX, x, t);
      this._camY = window.Game.mathUtils.lerp(this._camY, y, t);
    }

    worldToScreen(x, y) {
      return { x: x - this._camX + this.width / 2, y: y - this._camY + this.height / 2 };
    }

    /** Inverse de worldToScreen : coordonnées écran (ex. la souris,
     * relative au canvas) -> coordonnées monde. Sert à viser avec le
     * lance-cacahuète (voir game/GameEngine.js : _tryShoot). */
    screenToWorld(sx, sy) {
      return { x: sx - this.width / 2 + this._camX, y: sy - this.height / 2 + this._camY };
    }

    /** Déclenche un bref flash rouge plein écran (retour visuel quand le
     * joueur local encaisse un coup — voir GameEngine._handleRemoteHit). */
    triggerDamageFlash() {
      this._damageFlash = 1;
    }

    /** Projette un point monde vers des coordonnées écran en pixels, pour
     * positionner les bulles de chat HTML par-dessus le canvas. */
    projectToScreen(x, y, worldHeight = 0) {
      const p = this.worldToScreen(x, y);
      return { x: p.x, y: p.y - worldHeight, visible: true };
    }

    // ------------------------------------------------------------------
    // Rendu
    // ------------------------------------------------------------------
    _drawGround() {
      const topLeft = this.worldToScreen(-this.world.halfWidth, -this.world.halfHeight);
      this.ctx.drawImage(this.ground, topLeft.x, topLeft.y);
    }

    _drawShadow(screenX, screenY, radiusX) {
      this.ctx.save();
      this.ctx.globalAlpha = 0.22;
      this.ctx.fillStyle = '#000000';
      this.ctx.beginPath();
      this.ctx.ellipse(screenX, screenY, radiusX, radiusX * 0.4, 0, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    _drawProp(prop) {
      const p = this.worldToScreen(prop.x, prop.y);
      this._drawShadow(p.x, p.y, prop.worldW * 0.28);
      this.ctx.drawImage(
        prop.canvas,
        p.x - prop.worldW / 2,
        p.y - prop.worldH,
        prop.worldW,
        prop.worldH
      );
    }

    _drawAvatar(id, player) {
      const avatar = this._avatars.get(id);
      if (!avatar) return;
      const p = this.worldToScreen(player.x, player.y);

      this._drawShadow(p.x, p.y, CHAR_WIDTH * 0.32);

      // Anneau au sol coloré = identité du joueur.
      this.ctx.save();
      this.ctx.globalAlpha = avatar.isLocal ? 0.6 : 0.42;
      this.ctx.strokeStyle = avatar.isLocal ? '#ffffff' : avatar.color;
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.ellipse(p.x, p.y, CHAR_WIDTH * 0.34, CHAR_WIDTH * 0.16, 0, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();

      // Si l'objet équipé a sa propre feuille de sprites "personnage armé"
      // (voir EQUIPPED_ATLASES), on l'utilise à la place de l'atlas de
      // base : l'arme y est déjà dessinée intégrée à chaque pose, donc on
      // ne superpose plus le sprite tenu en main par-dessus (voir plus
      // bas, _drawEquippedItem n'agit que pour les objets sans atlas dédié).
      const equippedAtlasDef = avatar.equippedItem ? EQUIPPED_ATLASES[avatar.equippedItem] : null;
      const equippedAtlasImg = equippedAtlasDef ? getEquippedAtlasImage(avatar.equippedItem) : null;
      const useEquippedAtlas = !!(equippedAtlasDef && equippedAtlasImg && equippedAtlasImg.complete && equippedAtlasImg.naturalWidth > 0);

      if (useEquippedAtlas) {
        const { col, dirKey } = avatar.frame;
        const row = dirKey === 'down' ? equippedAtlasDef.rowDown
          : dirKey === 'right' ? equippedAtlasDef.rowRight
          : dirKey === 'up' ? equippedAtlasDef.rowUp
          : equippedAtlasDef.rowLeft;
        const fw = equippedAtlasDef.frameW;
        const fh = equippedAtlasDef.frameH;
        // La cellule de cet atlas inclut l'arme, donc son ratio largeur/
        // hauteur diffère de celui (plus étroit) de l'atlas de base : on
        // calcule une largeur d'affichage dédiée à partir de son propre
        // ratio, pour ne pas écraser/étirer le sprite horizontalement.
        // On applique aussi sizeScale à la hauteur : la case de cet atlas
        // a plus de marge vide au-dessus de la tête que celle de l'atlas
        // de base, donc dessiner à la même hauteur brute (CHAR_HEIGHT)
        // rendrait le personnage visiblement plus petit une fois armé
        // (voir commentaire sizeScale plus haut).
        const drawH = CHAR_HEIGHT * (equippedAtlasDef.sizeScale || 1);
        const drawW = drawH * (fw / fh);
        // Ancrage horizontal sur les pieds (anchorXFrac, voir plus haut) —
        // et non le centre de la cellule — pour que le corps reste fixe
        // pendant que l'arme et les bras/jambes bougent d'une frame à
        // l'autre de l'animation.
        const anchorXFrac = equippedAtlasDef.anchorXFrac != null ? equippedAtlasDef.anchorXFrac : 0.5;
        this.ctx.drawImage(
          equippedAtlasImg,
          col * fw, row * fh, fw, fh,
          p.x - drawW * anchorXFrac, p.y - drawH - avatar.bobY, drawW, drawH
        );
      } else if (this.atlas.complete && this.atlas.naturalWidth > 0) {
        const { col, row } = avatar.frame;
        this.ctx.drawImage(
          this.atlas,
          col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H,
          p.x - CHAR_WIDTH / 2, p.y - CHAR_HEIGHT - avatar.bobY, CHAR_WIDTH, CHAR_HEIGHT
        );
      } else {
        // Filet de sécurité pendant le chargement de l'image : un simple
        // disque de la couleur du joueur, pour que la scène reste lisible.
        this.ctx.fillStyle = avatar.color;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y - CHAR_HEIGHT / 2, CHAR_WIDTH * 0.32, 0, Math.PI * 2);
        this.ctx.fill();
      }

      if (!useEquippedAtlas) this._drawEquippedItem(avatar, p.x, p.y);
    }

    /**
     * Dessine, par-dessus le personnage, l'objet qu'il tient en main
     * (voir avatar.equippedItem, alimenté par player.equippedItem —
     * lui-même mis à jour par GameEngine.setLocalEquipped en local, ou
     * par le protocole réseau "game:equip" pour les autres joueurs).
     * Toujours affiché du même côté à hauteur de hanche (voir constantes
     * EQUIP_* en tête de fichier), quelle que soit la direction affichée.
     */
    _drawEquippedItem(avatar, screenX, screenY) {
      if (!avatar.equippedItem) return;
      const def = EQUIP_SPRITES[avatar.equippedItem];
      const img = getEquipImage(avatar.equippedItem);
      if (!def || !img || !img.complete || !img.naturalWidth) return;

      const h = CHAR_HEIGHT * EQUIP_HEIGHT_FRAC;
      const w = h * (def.w / def.h);
      const handX = screenX - CHAR_WIDTH / 2 + CHAR_WIDTH * EQUIP_HAND_X_FRAC;
      const handY = screenY - CHAR_HEIGHT - avatar.bobY + CHAR_HEIGHT * EQUIP_HAND_Y_FRAC;
      const drawX = handX - w * EQUIP_GRIP_X_FRAC;
      const drawY = handY - h * EQUIP_GRIP_Y_FRAC;

      this.ctx.drawImage(img, drawX, drawY, w, h);
    }

    /**
     * Dessine les projectiles actifs (voir game/GameEngine.js :
     * this.projectiles) : le sprite de la cacahuète, qui tourne sur
     * lui-même en vol (voir p.spinSpeed, fixé au tir dans
     * GameEngine._spawnProjectile) plutôt que de simplement s'orienter
     * vers la direction du tir — effet de "cacahuète lancée qui
     * tournoie". Pas de tri de profondeur avec le décor : les
     * projectiles sont rapides et minuscules, ils volent au-dessus de
     * tout.
     */
    _drawProjectiles(projectiles) {
      if (!projectiles || !projectiles.length) return;
      const ctx = this.ctx;
      const img = getProjectileImage();
      const imgReady = img.complete && img.naturalWidth > 0;
      const drawH = PROJECTILE_DISPLAY_H;
      const drawW = drawH * (PROJECTILE_SPRITE.w / PROJECTILE_SPRITE.h);

      for (const p of projectiles) {
        const s = this.worldToScreen(p.x, p.y);
        const rotation = (p.age || 0) * (p.spinSpeed != null ? p.spinSpeed : PROJECTILE_SPIN_SPEED);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(rotation);
        if (imgReady) {
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        } else {
          // Filet de sécurité pendant le chargement du sprite.
          ctx.fillStyle = '#d9ab63';
          ctx.strokeStyle = '#8a6a34';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(0, 0, 8, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    /** Flash rouge plein écran, décroissant, déclenché par
     * triggerDamageFlash() quand le joueur local encaisse un coup. */
    _drawDamageFlash(dt) {
      if (this._damageFlash <= 0) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = `rgba(255, 55, 90, ${Math.min(0.4, this._damageFlash * 0.4)})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
      this._damageFlash = Math.max(0, this._damageFlash - dt * 2.2);
    }

    render(dt, players, projectiles) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.fillStyle = '#3a2b52';
      ctx.fillRect(0, 0, this.width, this.height);

      this._drawGround();

      // Tri par profondeur (peintre) : décor (déjà trié par y à la
      // construction) fusionné avec les joueurs (dynamiques) triés eux
      // aussi par y, pour que chacun s'affiche devant/derrière le bon
      // arbre selon sa position verticale à l'écran.
      const dynamic = [];
      if (players) {
        for (const [id, player] of players) dynamic.push({ y: player.y, id, player });
      }
      dynamic.sort((a, b) => a.y - b.y);

      let pi = 0;
      let di = 0;
      while (pi < this.props.length || di < dynamic.length) {
        const prop = this.props[pi];
        const dyn = dynamic[di];
        if (prop && (!dyn || prop.y <= dyn.y)) {
          this._drawProp(prop);
          pi++;
        } else {
          this._drawAvatar(dyn.id, dyn.player);
          di++;
        }
      }

      this._drawProjectiles(projectiles);
      this._drawDamageFlash(dt);
    }
  }

  window.Game.WorldRenderer = WorldRenderer;
  window.Game.__worldRendererReady = true;
  window.dispatchEvent(new Event('game:worldrenderer-ready'));
})();
