'use strict';

/**
 * game/render/CharacterAvatar.js
 * ----------------------------------------------------------------------
 * Fabrique et anime le personnage joueur en pixel art (feuille de
 * sprites fournie par le joueur : public/assets/sprites/character_atlas.png)
 * affiché en 3D via un THREE.Sprite en "billboard" (toujours face à la
 * caméra), plutôt que l'ancienne créature procédurale low poly.
 *
 * La feuille est une grille 5 colonnes x 4 lignes :
 *   colonnes : 0 = idle, 1..4 = cycle de marche
 *   lignes   : 0 = face (bas), 1 = gauche, 2 = dos (haut), 3 = droite
 *
 * Comme la caméra suiveuse ne s'oriente jamais (angle 3/4 fixe, voir
 * PlanetRenderer._cameraOffset), on peut déduire une fois pour toutes
 * les vecteurs "écran" (droite / vers le joueur) à partir de cet offset,
 * puis choisir la bonne ligne de sprite en comparant la direction de
 * déplacement du joueur (monde) à ces vecteurs. C'est PlanetRenderer qui
 * calcule ces deux vecteurs (cameraRight / cameraSouth) et les transmet
 * à updateCharacterAvatar.
 *
 * Toute la logique réseau/mécaniques (position, direction, texte de la
 * bulle de chat...) reste dans game/Player.js ; ce module ne fait QUE de
 * la représentation visuelle, à partir des champs déjà exposés par
 * Player (x, y, isMoving, animTime, facingAngle, color, isLocal).
 * ----------------------------------------------------------------------
 */

import * as THREE from 'three';

const ATLAS_URL = '/assets/sprites/character_atlas.png';
const COLS = 5; // idle + 4 frames de marche
const ROWS = 4; // bas / gauche / dos / droite
const FRAME_W = 106;
const FRAME_H = 152;

// Hauteur "logique" du personnage dans le monde 3D, choisie pour rester
// proche du gabarit de l'ancienne créature procédurale (~10-11 unités).
const WORLD_HEIGHT = 11;
const WORLD_WIDTH = WORLD_HEIGHT * (FRAME_W / FRAME_H);

// Lignes de la feuille de sprites.
const ROW_DOWN = 0;
const ROW_LEFT = 1;
const ROW_UP = 2;
const ROW_RIGHT = 3;

let sharedTexture = null;
function getSharedTexture() {
  if (!sharedTexture) {
    sharedTexture = new THREE.TextureLoader().load(ATLAS_URL);
    sharedTexture.magFilter = THREE.NearestFilter; // net, style pixel art
    sharedTexture.minFilter = THREE.NearestFilter;
    sharedTexture.generateMipmaps = false;
    sharedTexture.wrapS = THREE.ClampToEdgeWrapping;
    sharedTexture.wrapT = THREE.ClampToEdgeWrapping;
    if ('colorSpace' in sharedTexture) sharedTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return sharedTexture;
}

function hexToThreeColor(cssColor) {
  // cssColor peut être 'hsl(210, 70%, 58%)' (voir mathUtils.colorForUserId).
  const c = new THREE.Color();
  try {
    c.set(cssColor);
  } catch {
    c.set('#8fd3ff');
  }
  return c;
}

function setFrame(texture, col, row) {
  texture.repeat.set(1 / COLS, 1 / ROWS);
  // Les images sont chargées avec flipY (par défaut) : la ligne 0 du
  // fichier (le haut) correspond à la fin de l'espace UV vertical.
  texture.offset.set(col / COLS, 1 - (row + 1) / ROWS);
}

/**
 * Crée le mesh d'un joueur : un sprite pixel art ancré au sol (pieds),
 * plus un anneau coloré au sol qui sert de repère d'identification par
 * joueur (le sprite lui-même garde toujours les mêmes couleurs, on ne
 * peut pas le reteinter comme l'ancienne créature).
 */
export function createCharacterAvatar({ color, isLocal }) {
  const group = new THREE.Group();
  const baseColor = hexToThreeColor(color);

  // Texture indépendante par avatar : même image partagée, mais offset/
  // repeat propres à chacun pour afficher sa frame courante.
  const texture = getSharedTexture().clone();
  texture.needsUpdate = true;
  setFrame(texture, 0, ROW_DOWN);

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0); // ancré en bas (pieds au sol), pas au centre
  sprite.scale.set(WORLD_WIDTH, WORLD_HEIGHT, 1);
  group.add(sprite);

  // Anneau au sol coloré = identité du joueur (foulard de couleur avant).
  const ringColor = isLocal ? baseColor.clone().lerp(new THREE.Color(0xffffff), 0.4) : baseColor;
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(isLocal ? 2.0 : 1.8, isLocal ? 2.5 : 2.2, 24),
    new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: isLocal ? 0.6 : 0.42, side: THREE.DoubleSide })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.06;
  group.add(halo);

  // Ombre de contact discrète sous les pieds.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  group.add(shadow);

  group.userData.sprite = sprite;
  group.userData.texture = texture;
  group.userData.frame = { col: 0, row: ROW_DOWN };
  group.userData.baseColor = baseColor;
  return group;
}

/**
 * Angle de déplacement (monde) -> ligne de sprite à afficher, en
 * comparant la direction de marche aux vecteurs "écran" de la caméra
 * fixe (voir PlanetRenderer). Retourne l'une des 4 constantes ROW_*.
 */
function directionRow(dirX, dirZ, cameraRight, cameraSouth) {
  const east = dirX * cameraRight.x + dirZ * cameraRight.z;
  const south = dirX * cameraSouth.x + dirZ * cameraSouth.z;
  const deg = (Math.atan2(east, south) * 180) / Math.PI; // 0=bas,90=droite,180=haut,-90=gauche
  if (deg > -45 && deg <= 45) return ROW_DOWN;
  if (deg > 45 && deg <= 135) return ROW_RIGHT;
  if (deg > 135 || deg <= -135) return ROW_UP;
  return ROW_LEFT;
}

/**
 * Anime un avatar déjà créé à partir de l'état courant du Player (voir
 * game/Player.js) : suit sa position, choisit la ligne de sprite selon
 * la direction de marche (relative à la caméra) et fait avancer le
 * cycle de marche / un léger rebond idle.
 *
 * cameraRight / cameraSouth : vecteurs unitaires (THREE.Vector3, y=0)
 * représentant "droite écran" et "vers le joueur (bas écran)" dans le
 * repère monde, calculés une fois par PlanetRenderer à partir de son
 * offset caméra fixe.
 */
export function updateCharacterAvatar(avatarGroup, player, groundY = 0, cameraRight, cameraSouth) {
  avatarGroup.position.set(player.x, groundY, player.y);

  const t = player.animTime || 0;
  const bobSpeed = player.isMoving ? 9 : 2.4;
  const bobHeight = player.isMoving ? 0.35 : 0.12;
  const bob = Math.abs(Math.sin(t * bobSpeed)) * bobHeight;
  avatarGroup.userData.sprite.position.y = bob;

  const frame = avatarGroup.userData.frame;
  let row = frame.row;
  if (player.isMoving && cameraRight && cameraSouth) {
    const dirX = Math.sin(player.facingAngle);
    const dirZ = Math.cos(player.facingAngle);
    row = directionRow(dirX, dirZ, cameraRight, cameraSouth);
  }

  // Colonne 0 = idle à l'arrêt, sinon cycle 1..4 cadencé par animTime.
  const col = player.isMoving ? 1 + Math.floor((t * 6) % 4) : 0;

  if (frame.col !== col || frame.row !== row) {
    setFrame(avatarGroup.userData.texture, col, row);
    frame.col = col;
    frame.row = row;
  }
}
