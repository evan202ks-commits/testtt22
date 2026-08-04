'use strict';

/**
 * game/render/WorldRenderer.js
 * ----------------------------------------------------------------------
 * Remplace l'ancien rendu "planètes flottantes dans l'espace" par un
 * univers nature chaleureux (2.5D : sprites 2D animés + décor 3D léger).
 * Expose une API volontairement proche de l'ancien renderer (resize /
 * render / setActiveZone / followTarget / projectToScreen / avatars)
 * pour que game/GameEngine.js reste organisé de la même façon.
 *
 * Chargé en <script type="module"> (voir index.html) : s'attache lui-même
 * à window.Game.WorldRenderer une fois prêt, exactement comme les autres
 * briques du jeu (chargées en script classique) s'attachent à
 * window.Game.*.
 * ----------------------------------------------------------------------
 */

import * as THREE from 'three';
import { ZONES, getZoneById, buildZoneGroup } from './WorldBuilder.js';
import { createCharacterAvatar, updateCharacterAvatar } from './CharacterAvatar.js';
import { AssetManifest } from './AssetManifest.js';

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
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

function makeSkyDome(radius = 1400) {
  const geo = new THREE.SphereGeometry(radius, 20, 14);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x8ec6ea);
  const horizon = new THREE.Color(0xfff2d6);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius; // -1..1
    const t = Math.max(0, Math.min(1, (y + 0.15) / 0.9));
    const c = horizon.clone().lerp(top, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

function makeCloud(rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xfffaf0, transparent: true, opacity: 0.9 });
  const puffs = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < puffs; i++) {
    const s = 10 + rng() * 9;
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 7, 6), mat);
    m.position.set((i - puffs / 2) * 11 + rng() * 4, rng() * 4, rng() * 6);
    m.scale.y = 0.55;
    g.add(m);
  }
  return g;
}

function makeParticleField(texture, count, color) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const sway = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 220;
    positions[i * 3 + 1] = Math.random() * 60;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 220;
    speeds[i] = 3 + Math.random() * 4;
    sway[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.4,
    map: texture || makeRadialTexture({ inner: 'rgba(255,246,214,0.9)', outer: 'rgba(255,246,214,0)' }),
    transparent: true,
    depthWrite: false,
    color: color ?? 0xffffff,
    opacity: 0.85,
  });
  const points = new THREE.Points(geo, mat);
  points.userData.speeds = speeds;
  points.userData.sway = sway;
  return points;
}

class WorldRenderer {
  constructor(canvas, { bubbleLayerEl, bannerEl } = {}) {
    this.canvas = canvas;
    this.bubbleLayerEl = bubbleLayerEl || null;
    this.bannerEl = bannerEl || null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 1, 3000);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.time = 0;
    this._camPos = new THREE.Vector3(0, 70, 46);
    this._camLookAt = new THREE.Vector3(0, 6, 0);
    this._cameraOffset = new THREE.Vector3(2, 62, 44);

    this.assets = new AssetManifest();
    this._zoneGroups = new Map(); // id -> { group, portalMeshes, swayItems, waterMeshes }
    this._activeZoneId = null;
    this._activeZoneRadius = 200;
    this._activeZoneSeed = 0;
    this._avatars = new Map(); // playerId -> THREE.Group

    this._buildPersistentScene();

    this.ready = this.assets.ready;
    this.resize();
  }

  _buildPersistentScene() {
    this.scene.background = new THREE.Color(0xdcefc9);
    this.scene.add(makeSkyDome());

    this.sunDirection = new THREE.Vector3(-0.4, 0.7, -0.55).normalize();
    this.sunSprite = makeGlowSprite('rgba(255,235,190,0.95)', 260, 1);
    this.sunSprite.position.copy(this.sunDirection).multiplyScalar(850);
    this.scene.add(this.sunSprite);

    this.cloudsGroup = new THREE.Group();
    const rng = (() => {
      let a = 42;
      return () => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return a / 4294967296;
      };
    })();
    for (let i = 0; i < 6; i++) {
      const cloud = makeCloud(rng);
      cloud.position.set((rng() - 0.5) * 700, 160 + rng() * 60, (rng() - 0.5) * 700 - 200);
      cloud.userData.driftSpeed = 1.4 + rng() * 1.6;
      this.cloudsGroup.add(cloud);
    }
    this.scene.add(this.cloudsGroup);

    this.dust = makeParticleField(null, 55, 0xfff6d6);
    this.scene.add(this.dust);
    this.leaves = null; // construit à la demande si la zone active a weather:'leaves'

    this.hemiLight = new THREE.HemisphereLight(0xfff2d6, 0xcfe6b0, 0.75);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff2d6, 1.05);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(200);
    this.scene.add(this.sunLight);

    this.ambientLight = new THREE.AmbientLight(0xcfe6b0, 0.5);
    this.scene.add(this.ambientLight);
  }

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
  }

  setTime(t) {
    this.time = t;
  }

  // ------------------------------------------------------------------
  // Zones
  // ------------------------------------------------------------------
  _ensureZoneGroup(zoneId) {
    if (this._zoneGroups.has(zoneId)) return this._zoneGroups.get(zoneId);
    const zone = getZoneById(zoneId);
    const built = buildZoneGroup(zone, this.assets);
    built.group.visible = false;
    this.scene.add(built.group);
    this._zoneGroups.set(zoneId, built);
    return built;
  }

  /** Change la zone active : construit son décor si besoin (mise en
   * cache), masque les autres, ajuste l'ambiance (fond/brume/lumière). */
  setActiveZone(zoneId) {
    const zone = getZoneById(zoneId);
    if (this._activeZoneId && this._zoneGroups.has(this._activeZoneId)) {
      this._zoneGroups.get(this._activeZoneId).group.visible = false;
    }
    const built = this._ensureZoneGroup(zoneId);
    built.group.visible = true;
    this._activeZoneId = zoneId;
    this._activeZoneRadius = zone.radius;
    this._activeZoneSeed = zone.seed || 0;
    this._applyAtmosphere(zone);

    if (zone.weather === 'leaves' && !this.leaves) {
      this.leaves = makeParticleField(this.assets.getVfxTexture('leaf'), 40, 0xffffff);
      this.leaves.material.size = 4.2;
      this.scene.add(this.leaves);
    }
    if (this.leaves) this.leaves.visible = zone.weather === 'leaves';

    if (this.bannerEl) {
      this.bannerEl.textContent = `${zone.name} — ${zone.subtitle}`;
      this.bannerEl.classList.remove('zone-banner--show');
      void this.bannerEl.offsetWidth;
      this.bannerEl.classList.add('zone-banner--show');
    }
    return { zone, portalMeshes: built.portalMeshes };
  }

  _applyAtmosphere(zone) {
    this.scene.fog = new THREE.FogExp2(new THREE.Color(zone.fogColor), zone.fogDensity);
    this.hemiLight.color.set(zone.sunColor);
    this.hemiLight.groundColor.set(zone.ambientColor);
    this.sunLight.color.set(zone.sunColor);
    this.ambientLight.color.set(zone.ambientColor);
  }

  // ------------------------------------------------------------------
  // Avatars joueurs
  // ------------------------------------------------------------------
  ensureAvatar(id, { color, isLocal }) {
    if (this._avatars.has(id)) return this._avatars.get(id);
    const avatar = createCharacterAvatar({ assets: this.assets, color, isLocal });
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

  updateAvatar(id, player, dt) {
    const avatar = this._avatars.get(id);
    if (!avatar) return;
    const groundY = window.Game.mathUtils.zoneGroundHeight(player.x, player.y, this._activeZoneRadius, this._activeZoneSeed);
    updateCharacterAvatar(avatar, player, groundY, dt);
  }

  // ------------------------------------------------------------------
  // Caméra suiveuse — vue élevée façon "jeu de simulation/exploration",
  // pas de contrôle souris (uniquement le clavier, comme avant).
  // ------------------------------------------------------------------
  followTarget(x, y, dt) {
    const groundY = window.Game.mathUtils.zoneGroundHeight(x, y, this._activeZoneRadius, this._activeZoneSeed);
    const targetPos = new THREE.Vector3(x + this._cameraOffset.x, groundY + this._cameraOffset.y, y + this._cameraOffset.z);
    const targetLookAt = new THREE.Vector3(x, groundY + 4, y);
    const rate = 4.5;
    const t = 1 - Math.exp(-rate * dt);
    this._camPos.lerp(targetPos, t);
    this._camLookAt.lerp(targetLookAt, t);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camLookAt);
  }

  projectToScreen(x, y, worldHeight = 15) {
    const groundY = window.Game.mathUtils.zoneGroundHeight(x, y, this._activeZoneRadius, this._activeZoneSeed);
    const v = new THREE.Vector3(x, groundY + worldHeight, y).project(this.camera);
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
    this.time += dt;

    // Vent : décor 3D (arbres/buissons tournent doucement) + flore 2D
    // (rotation dans le plan du sprite) — "herbe qui bouge, arbres qui
    // oscillent".
    const active = this._activeZoneId && this._zoneGroups.get(this._activeZoneId);
    if (active) {
      for (const item of active.swayItems) {
        const a = Math.sin(this.time * item.speed + item.phase) * item.amount;
        if (item.isFlora) item.obj.material.rotation = a;
        else item.obj.rotation.z = a;
      }
      for (const water of active.waterMeshes) {
        const frames = water.userData.frames;
        if (frames && frames.length > 1) {
          const idx = Math.floor(this.time * water.userData.fps) % frames.length;
          if (frames[idx] && water.material.map !== frames[idx]) {
            water.material.map = frames[idx];
            water.material.needsUpdate = true;
          }
        }
      }
    }

    // Nuages : dérive lente, boucle horizontale.
    for (const cloud of this.cloudsGroup.children) {
      cloud.position.x += cloud.userData.driftSpeed * dt;
      if (cloud.position.x > 420) cloud.position.x = -420;
    }

    // Poussière ambiante : montée lente + boucle.
    this._advanceParticles(this.dust, dt, 60, true);
    if (this.leaves && this.leaves.visible) this._advanceParticles(this.leaves, dt, 55, false);

    this.sunSprite.material.opacity = 0.9 + Math.sin(this.time * 0.4) * 0.06;

    this.renderer.render(this.scene, this.camera);
  }

  _advanceParticles(points, dt, ceilingY, rising) {
    const pos = points.geometry.attributes.position;
    const speeds = points.userData.speeds;
    const sway = points.userData.sway;
    for (let i = 0; i < speeds.length; i++) {
      let y = pos.getY(i) + (rising ? 1 : -1) * speeds[i] * dt;
      let x = pos.getX(i) + Math.sin(this.time * 1.2 + sway[i]) * dt * 2.2;
      if (rising && y > ceilingY) y = 0;
      if (!rising && y < 0) y = ceilingY;
      pos.setY(i, y);
      pos.setX(i, x);
    }
    pos.needsUpdate = true;
  }
}

window.Game = window.Game || {};
window.Game.WorldRenderer = WorldRenderer;
window.Game.Zones = ZONES;
