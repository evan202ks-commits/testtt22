'use strict';

/**
 * game/render/PlanetRenderer.js
 * ----------------------------------------------------------------------
 * Remplace l'ancien rendu 2D isométrique (canvas 2D, game/IsoRenderer.js
 * + sprites/*) par un rendu 3D low poly avec Three.js. Expose une API
 * volontairement proche de l'ancien renderer (resize/clear-render/
 * setCamera-like/setTime) pour que game/GameEngine.js reste organisé de
 * la même façon, même si l'implémentation interne est entièrement neuve.
 *
 * Chargé en <script type="module"> (voir index.html) : s'attache lui-même
 * à window.Game.PlanetRenderer une fois prêt, exactement comme les autres
 * briques du jeu (chargées en script classique) s'attachent à
 * window.Game.*. GameEngine.js (classique) ne le lit que plus tard, une
 * fois la page chargée, donc l'ordre de chargement n'a pas d'importance.
 * ----------------------------------------------------------------------
 */

import * as THREE from 'three';
import { PLANETS, getPlanetById, buildPlanetGroup } from './PlanetBuilder.js';
import { createCharacterAvatar, updateCharacterAvatar } from './CharacterAvatar.js';

// ------------------------------------------------------------------
// Petits utilitaires de texture procédurale (aucun asset externe) :
// dégradés radiaux utilisés pour le soleil, les rayons volumétriques
// stylisés, la nébuleuse de fond et le halo des portails.
// ------------------------------------------------------------------

function makeRadialTexture({ inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeGlowSprite(colorCss, size, opacity = 0.85) {
  const tex = makeRadialTexture({ inner: colorCss, outer: 'rgba(0,0,0,0)' });
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

function starfieldPoints(count = 900, radius = 1400) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Distribution sur une coquille sphérique, au-dessus de l'horizon
    // surtout (le sol n'a pas besoin d'étoiles sous ses pieds).
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - Math.random() * 1.1); // légèrement resserré vers le haut
    const r = radius * (0.75 + Math.random() * 0.25);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.6 + 60;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const tex = makeRadialTexture({ inner: 'rgba(255,255,255,1)', outer: 'rgba(255,255,255,0)' });
  const mat = new THREE.PointsMaterial({
    size: 5.5,
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}

function dustPoints(count = 70) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 160;
    positions[i * 3 + 1] = Math.random() * 26;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 160;
    speeds[i] = 2 + Math.random() * 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const tex = makeRadialTexture({ inner: 'rgba(255,246,214,0.9)', outer: 'rgba(255,246,214,0)' });
  const mat = new THREE.PointsMaterial({
    size: 1.6,
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.75,
  });
  const points = new THREE.Points(geo, mat);
  points.userData.speeds = speeds;
  return points;
}

// ------------------------------------------------------------------

class PlanetRenderer {
  constructor(canvas, { bubbleLayerEl, bannerEl } = {}) {
    this.canvas = canvas;
    this.bubbleLayerEl = bubbleLayerEl || null;
    this.bannerEl = bannerEl || null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 3000);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.time = 0;
    this._camPos = new THREE.Vector3(0, 60, 70);
    this._camLookAt = new THREE.Vector3(0, 6, 0);
    this._cameraOffset = new THREE.Vector3(26, 46, 52);

    this._planetGroups = new Map(); // id -> { group, portalMeshes, spinningPortals }
    this._activePlanetId = null;
    this._avatars = new Map(); // playerId -> THREE.Group

    this._buildPersistentScene();
    this._composer = null;
    this._setupPostFX(); // async, tolère l'échec (voir méthode)

    this.resize();
  }

  // ------------------------------------------------------------------
  // Décor permanent (indépendant de la planète active) : le fond
  // spatial — étoiles, nébuleuses, éclairage de base.
  // ------------------------------------------------------------------
  _buildPersistentScene() {
    this.scene.background = new THREE.Color(0x241a3d);

    this.stars = starfieldPoints();
    this.scene.add(this.stars);

    // Nébuleuses lointaines : quelques grands sprites pastel, très
    // discrets, qui ne bougent presque pas (juste une lente rotation).
    this.nebulaGroup = new THREE.Group();
    const nebulaColors = ['rgba(255,183,122,0.16)', 'rgba(159,216,255,0.14)', 'rgba(201,166,255,0.16)'];
    nebulaColors.forEach((c, i) => {
      const s = makeGlowSprite(c, 900 + i * 200, 1);
      const angle = (i / nebulaColors.length) * Math.PI * 2;
      s.position.set(Math.cos(angle) * 700, 260 + i * 60, Math.sin(angle) * 700);
      this.nebulaGroup.add(s);
    });
    this.scene.add(this.nebulaGroup);

    // "Soleil" permanent, bas sur l'horizon (ambiance coucher de soleil
    // qui ne bouge jamais) + quelques rayons volumétriques stylisés.
    this.sunDirection = new THREE.Vector3(-0.55, 0.35, -0.75).normalize();
    this.sunSprite = makeGlowSprite('rgba(255,205,150,0.9)', 340, 1);
    this.sunSprite.position.copy(this.sunDirection).multiplyScalar(900);
    this.scene.add(this.sunSprite);

    this.rayGroup = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const ray = makeGlowSprite('rgba(255,214,168,0.5)', 1, 1);
      ray.material.opacity = 0.12;
      ray.scale.set(26, 420, 1);
      ray.position.set((i - 2) * 30, 120, -260 - i * 8);
      this.rayGroup.add(ray);
    }
    this.scene.add(this.rayGroup);

    this.dust = dustPoints();
    this.scene.add(this.dust);

    // Éclairage : hémisphère (ciel/sol) + directionnelle chaude (soleil)
    // + un léger fill ambiant. Les couleurs sont réajustées par planète
    // dans _applyAtmosphere().
    this.hemiLight = new THREE.HemisphereLight(0xffe1c2, 0x2a2040, 0.65);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffb37a, 1.1);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(200);
    this.scene.add(this.sunLight);

    this.ambientLight = new THREE.AmbientLight(0x6a5a8a, 0.55);
    this.scene.add(this.ambientLight);
  }

  async _setupPostFX() {
    // Le bloom est un plus purement cosmétique (halo neon sur cristaux/
    // portails). On l'importe dynamiquement et on continue sans lui si
    // le chargement échoue pour une raison quelconque : le jeu doit
    // toujours fonctionner même sans post-traitement.
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
      ]);
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(this.width || window.innerWidth, this.height || window.innerHeight),
        0.55,
        0.6,
        0.72
      );
      composer.addPass(bloom);
      this._composer = composer;
      this._bloomPass = bloom;
      this._resizeComposer();
    } catch (err) {
      // Pas de post-traitement disponible (ex : réseau bloqué côté
      // utilisateur) : rendu standard, toujours fonctionnel.
      this._composer = null;
      console.warn('[PlanetRenderer] Bloom indisponible, rendu standard utilisé.', err);
    }
  }

  // ------------------------------------------------------------------
  // Cycle de vie / redimensionnement (même filet de sécurité que
  // l'ancien IsoRenderer si le canvas est encore caché à cet instant).
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
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this._resizeComposer();
  }

  _resizeComposer() {
    if (this._composer) this._composer.setSize(this.width, this.height);
  }

  setTime(t) {
    this.time = t;
  }

  // ------------------------------------------------------------------
  // Planètes
  // ------------------------------------------------------------------
  _ensurePlanetGroup(planetId) {
    if (this._planetGroups.has(planetId)) return this._planetGroups.get(planetId);
    const planet = getPlanetById(planetId);
    const built = buildPlanetGroup(planet);
    built.group.visible = false;
    this.scene.add(built.group);
    this._planetGroups.set(planetId, built);
    return built;
  }

  /** Change la planète active : construit son décor si besoin (mise en
   * cache), masque les autres, ajuste l'ambiance (ciel/brume/lumière). */
  setActivePlanet(planetId) {
    const planet = getPlanetById(planetId);
    if (this._activePlanetId && this._planetGroups.has(this._activePlanetId)) {
      this._planetGroups.get(this._activePlanetId).group.visible = false;
    }
    const built = this._ensurePlanetGroup(planetId);
    built.group.visible = true;
    this._activePlanetId = planetId;
    this._applyAtmosphere(planet);
    if (this.bannerEl) {
      this.bannerEl.textContent = `${planet.name} — ${planet.subtitle}`;
      this.bannerEl.classList.remove('planet-banner--show');
      // reflow pour rejouer l'animation même si on revisite la même planète
      void this.bannerEl.offsetWidth;
      this.bannerEl.classList.add('planet-banner--show');
    }
    return { planet, portalMeshes: built.portalMeshes };
  }

  _applyAtmosphere(planet) {
    const sky = new THREE.Color(planet.skyColor);
    const fog = new THREE.Color(planet.fogColor);
    this.scene.background = sky;
    this.scene.fog = new THREE.FogExp2(fog, planet.fogDensity);
    this.hemiLight.color.set(planet.sunColor);
    this.hemiLight.groundColor.set(planet.ambientColor);
    this.sunLight.color.set(planet.sunColor);
    this.ambientLight.color.set(planet.ambientColor);
  }

  // ------------------------------------------------------------------
  // Avatars joueurs
  // ------------------------------------------------------------------
  ensureAvatar(id, { color, isLocal }) {
    if (this._avatars.has(id)) return this._avatars.get(id);
    const avatar = createCharacterAvatar({ color, isLocal });
    this.scene.add(avatar);
    this._avatars.set(id, avatar);
    return avatar;
  }

  removeAvatar(id) {
    const avatar = this._avatars.get(id);
    if (!avatar) return;
    this.scene.remove(avatar);
    this._avatars.delete(id);
  }

  setAvatarVisible(id, visible) {
    const avatar = this._avatars.get(id);
    if (avatar) avatar.visible = visible;
  }

  updateAvatar(id, player) {
    const avatar = this._avatars.get(id);
    if (!avatar) return;
    updateCharacterAvatar(avatar, player);
  }

  // ------------------------------------------------------------------
  // Caméra suiveuse (angle fixe façon 3/4, jamais pilotée à la souris —
  // on garde le même schéma de contrôle que l'ancienne vue isométrique :
  // uniquement le déplacement au clavier).
  // ------------------------------------------------------------------
  followTarget(x, y, dt) {
    const targetPos = new THREE.Vector3(x + this._cameraOffset.x, this._cameraOffset.y, y + this._cameraOffset.z);
    const targetLookAt = new THREE.Vector3(x, 6, y);
    const rate = 4.5;
    const t = 1 - Math.exp(-rate * dt);
    this._camPos.lerp(targetPos, t);
    this._camLookAt.lerp(targetLookAt, t);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camLookAt);
  }

  /** Projette un point monde (x, y monde + hauteur) vers des coordonnées
   * écran en pixels, pour positionner les bulles de chat HTML par-dessus
   * le canvas 3D. Retourne aussi si le point est visible (devant la caméra). */
  projectToScreen(x, y, worldHeight = 11) {
    const v = new THREE.Vector3(x, worldHeight, y).project(this.camera);
    const visible = v.z < 1;
    return {
      x: (v.x * 0.5 + 0.5) * this.width,
      y: (-v.y * 0.5 + 0.5) * this.height,
      visible,
    };
  }

  // ------------------------------------------------------------------
  // Rendu
  // ------------------------------------------------------------------
  render(dt) {
    // Rotation lente des portails + halo du soleil scintillant doucement.
    for (const built of this._planetGroups.values()) {
      if (!built.group.visible) continue;
      built.spinningPortals.forEach((p) => {
        p.rotation.y += dt * 0.6;
        p.children[0].rotation.z += dt * 0.4;
      });
    }
    this.nebulaGroup.rotation.y += dt * 0.004;
    this.sunSprite.material.opacity = 0.85 + Math.sin(this.time * 0.5) * 0.05;

    const dustPos = this.dust.geometry.attributes.position;
    const speeds = this.dust.userData.speeds;
    for (let i = 0; i < speeds.length; i++) {
      let y = dustPos.getY(i) + speeds[i] * dt;
      if (y > 26) y = 0;
      dustPos.setY(i, y);
    }
    dustPos.needsUpdate = true;

    if (this._composer) this._composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

window.Game = window.Game || {};
window.Game.PlanetRenderer = PlanetRenderer;
window.Game.Planets = PLANETS;
window.Game.__planetRendererReady = true;
window.dispatchEvent(new Event('game:planetrenderer-ready'));
