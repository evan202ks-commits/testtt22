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

  // Taille à l'écran du personnage (pixels), proche du gabarit relatif
  // qu'avait la créature dans l'ancienne version 3D par rapport aux arbres.
  const CHAR_HEIGHT = 88;
  const CHAR_WIDTH = CHAR_HEIGHT * (FRAME_W / FRAME_H);

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
  function directionRow(facingAngle) {
    const deg = (facingAngle * 180) / Math.PI; // 0=bas,90=droite,180/-180=haut,-90=gauche
    if (deg > -45 && deg <= 45) return ROW_DOWN;
    if (deg > 45 && deg <= 135) return ROW_RIGHT;
    if (deg > 135 || deg <= -135) return ROW_UP;
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
      this._climb = { userId: null, progress: null };

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

    /** Mémorise la progression d'escalade en cours (0..1, ou null) pour
     * l'afficher en anneau au-dessus de la tête du joueur concerné — voir
     * game/Climbing.js (lecture) et game/GameEngine.js (appel par frame). */
    setClimbProgress(userId, progress) {
      this._climb.userId = userId;
      this._climb.progress = progress;
    }

    // ------------------------------------------------------------------
    // Avatars joueurs
    // ------------------------------------------------------------------
    ensureAvatar(id, { color, isLocal }) {
      if (this._avatars.has(id)) return this._avatars.get(id);
      const avatar = { color, isLocal, frame: { col: 0, row: ROW_DOWN }, bobY: 0 };
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
      if (player.isMoving) row = directionRow(player.facingAngle);
      const col = player.isMoving ? 1 + Math.floor((t * 6) % 4) : 0;
      frame.col = col;
      frame.row = row;
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

      if (this.atlas.complete && this.atlas.naturalWidth > 0) {
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

      if (id === this._climb.userId && this._climb.progress !== null) {
        this._drawClimbRing(p.x, p.y - CHAR_HEIGHT - avatar.bobY, this._climb.progress);
      }
    }

    /** Anneau de progression d'escalade (fond sombre + arc qui se remplit
     * dans le sens horaire depuis midi), affiché au-dessus de la tête du
     * joueur qui grimpe une échelle — voir game/Climbing.js. */
    _drawClimbRing(cx, cy, progress) {
      const ctx = this.ctx;
      const y = cy - 14;
      const radius = CHAR_WIDTH * 0.3;
      ctx.save();
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(20,20,20,0.45)';
      ctx.beginPath();
      ctx.arc(cx, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#6fd84a';
      ctx.beginPath();
      ctx.arc(cx, y, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    render(dt, players) {
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
    }
  }

  window.Game.WorldRenderer = WorldRenderer;
  window.Game.__worldRendererReady = true;
  window.dispatchEvent(new Event('game:worldrenderer-ready'));
})();
