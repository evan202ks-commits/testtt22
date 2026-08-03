'use strict';

/**
 * game/render/CharacterAvatar.js
 * ----------------------------------------------------------------------
 * Fabrique et anime un avatar joueur : un sprite 2D animé (billboard,
 * toujours face à la caméra) + une ombre douce au sol + un petit marqueur
 * de couleur (identité du joueur, dérivée de son userId — voir
 * mathUtils.colorForUserId) flottant au-dessus de la tête.
 *
 * Toute la logique d'animation "quel état / quelle direction" reste
 * dans game/Player.js (isMoving, isRunning, facingDirection,
 * actionState) ; ce module ne fait que la représentation visuelle, via
 * un SpriteAnimator par avatar (voir game/SpriteAnimator.js).
 * ----------------------------------------------------------------------
 */

import * as THREE from 'three';

function hexToThreeColor(cssColor) {
  const c = new THREE.Color();
  try {
    c.set(cssColor);
  } catch {
    c.set('#8fd3ff');
  }
  return c;
}

function makeGlowTexture(colorCss) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, colorCss);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const SPRITE_HEIGHT = 13; // hauteur monde du personnage (cohérent avec l'ancienne échelle)

/**
 * @param assets  instance de AssetManifest (voir game/render/AssetManifest.js)
 */
export function createCharacterAvatar({ assets, color, isLocal }) {
  const group = new THREE.Group();
  const baseColor = hexToThreeColor(color);

  const animManifest = assets.getAnimationManifest();
  const animator = new window.Game.SpriteAnimator(animManifest);
  const textures = assets.createCharacterTextureSet();
  const [frameW, frameH] = animManifest.frameSize || [64, 64];
  const aspect = frameW / frameH;

  const initialState = Object.keys(textures)[0] || 'idle';
  const spriteMat = new THREE.SpriteMaterial({
    map: textures[initialState] || null,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(SPRITE_HEIGHT * aspect, SPRITE_HEIGHT, 1);
  sprite.position.y = 0.4;
  sprite.center.set(0.5, 0);
  group.add(sprite);

  // Ombre douce au sol.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.7, 18),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.05;
  group.add(shadow);

  // Marqueur d'identité (couleur dérivée du userId) : utile pour
  // distinguer les joueurs d'un coup d'œil malgré un skin partagé.
  const marker = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: isLocal ? 0 : 0.85, // pas besoin de se pointer soi-même
    })
  );
  marker.scale.set(3.2, 3.2, 1);
  marker.position.y = SPRITE_HEIGHT + 2.6;
  group.add(marker);

  group.userData.animator = animator;
  group.userData.textures = textures;
  group.userData.sprite = sprite;
  group.userData.currentTextureState = initialState;
  group.userData.baseColor = baseColor;
  return group;
}

/**
 * Anime un avatar déjà créé à partir de l'état courant du Player (voir
 * game/Player.js) : suit sa position, choisit l'état d'animation
 * (action ponctuelle > course > marche > idle), avance le SpriteAnimator
 * et met à jour la texture/le rectangle UV affichés.
 */
export function updateCharacterAvatar(avatarGroup, player, groundY, dt) {
  avatarGroup.position.set(player.x, groundY, player.y);

  const { animator, textures, sprite } = avatarGroup.userData;
  if (!animator) return;

  const action = player.getActiveAction ? player.getActiveAction() : null;
  let state;
  if (action && textures[action]) state = action;
  else if (player.isMoving) state = player.isRunning ? 'run' : 'walk';
  else state = 'idle';

  animator.setState(state, player.facingDirection || 'down');
  animator.update(dt || 0);

  if (avatarGroup.userData.currentTextureState !== animator.state) {
    const tex = textures[animator.state];
    if (tex) {
      sprite.material.map = tex;
      sprite.material.needsUpdate = true;
      avatarGroup.userData.currentTextureState = animator.state;
    }
  }

  const uv = animator.getUV();
  const tex = sprite.material.map;
  if (tex) {
    tex.repeat.set(uv.repeatX, uv.repeatY);
    tex.offset.set(uv.offsetX, uv.offsetY);
  }
}
