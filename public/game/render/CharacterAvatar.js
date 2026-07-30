'use strict';

/**
 * game/render/CharacterAvatar.js
 * ----------------------------------------------------------------------
 * Fabrique et anime une petite créature low poly "cosy" pour représenter
 * un joueur dans le monde 3D. Couleur dérivée du hash de son userId
 * (voir window.Game.mathUtils.colorForUserId — même dérivation qu'avant,
 * juste appliquée à un mesh 3D plutôt qu'à un sprite 2D).
 *
 * Toute la logique réseau/mécaniques (position, direction, texte de la
 * bulle de chat...) reste dans game/Player.js ; ce module ne fait QUE de
 * la représentation visuelle, à partir des champs déjà exposés par
 * Player (x, y, isMoving, animTime, facingAngle, color, isLocal).
 * ----------------------------------------------------------------------
 */

import * as THREE from 'three';

function hexToThreeColor(cssColor) {
  // cssColor peut être 'hsl(210, 70%, 58%)' (voir mathUtils.colorForUserId).
  // On passe par un élément DOM invisible pour laisser le navigateur
  // convertir n'importe quel format CSS valide en couleur exploitable.
  const c = new THREE.Color();
  try {
    c.set(cssColor);
  } catch {
    c.set('#8fd3ff');
  }
  return c;
}

/**
 * Crée le mesh d'un joueur : petit corps arrondi + tête + oreilles/antenne
 * + un foulard de couleur (couleur du joueur), le tout en primitives
 * simples pour rester léger et lisible à distance.
 */
export function createCharacterAvatar({ color, isLocal }) {
  const group = new THREE.Group();
  const baseColor = hexToThreeColor(color);
  const bodyColor = isLocal ? baseColor.clone().lerp(new THREE.Color(0xffffff), 0.12) : baseColor;

  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, flatShading: true, roughness: 0.7 });
  const trimMat = new THREE.MeshStandardMaterial({ color: baseColor, flatShading: true, roughness: 0.5, metalness: 0.1 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xfff3e2, flatShading: true, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2436, flatShading: true, roughness: 0.6 });

  // Corps : capsule douce.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(2.6, 2.6, 4, 10), bodyMat);
  body.position.y = 4.6;
  group.add(body);

  // Bedaine claire.
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1.9, 8, 8), creamMat);
  belly.position.set(0, 3.6, 1.5);
  belly.scale.set(1, 1.1, 0.7);
  group.add(belly);

  // Tête.
  const head = new THREE.Mesh(new THREE.SphereGeometry(2.1, 10, 8), bodyMat);
  head.position.y = 8.4;
  group.add(head);

  // Oreilles / antennes rondes.
  [-1, 1].forEach((side) => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 6), bodyMat);
    ear.position.set(side * 1.5, 9.9, 0.2);
    group.add(ear);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 6), trimMat);
    tip.position.set(side * 1.6, 10.5, 0.2);
    group.add(tip);
  });

  // Yeux.
  const eyeGeo = new THREE.SphereGeometry(0.34, 6, 6);
  [-0.75, 0.75].forEach((side) => {
    const eye = new THREE.Mesh(eyeGeo, darkMat);
    eye.position.set(side, 8.5, 1.9);
    group.add(eye);
  });

  // Foulard = couleur d'identification du joueur, bien visible.
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.45, 8, 16), trimMat);
  scarf.position.y = 6.6;
  scarf.rotation.x = Math.PI / 2.4;
  group.add(scarf);

  // Petits pieds.
  const footGeo = new THREE.SphereGeometry(0.85, 8, 6);
  const feet = [-1.2, 1.2].map((side) => {
    const foot = new THREE.Mesh(footGeo, trimMat);
    foot.position.set(side, 1.4, 0.3);
    group.add(foot);
    return foot;
  });

  // Halo doux sous les pieds (contact-shadow stylisé, pas de vraies ombres
  // portées nécessaires pour rester performant).
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.05;
  group.add(shadow);

  group.userData.parts = { body, head, feet, scarf };
  group.userData.baseColor = baseColor;
  return group;
}

/**
 * Anime une créature déjà créée à partir de l'état courant du Player
 * (voir game/Player.js) : suit sa position, tourne doucement vers sa
 * direction de déplacement, et fait un léger rebond idle/marche.
 */
export function updateCharacterAvatar(avatarGroup, player, groundY = 0) {
  avatarGroup.position.set(player.x, groundY, player.y);

  // Rotation douce vers la direction de déplacement plutôt qu'un
  // alignement instantané, pour un rendu plus organique.
  const targetAngle = player.facingAngle ?? avatarGroup.rotation.y;
  let delta = targetAngle - avatarGroup.rotation.y;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  avatarGroup.rotation.y += delta * 0.18;

  const t = player.animTime || 0;
  const bobSpeed = player.isMoving ? 9 : 2.4;
  const bobHeight = player.isMoving ? 0.55 : 0.22;
  const bob = Math.abs(Math.sin(t * bobSpeed)) * bobHeight;

  const { body, head, feet, scarf } = avatarGroup.userData.parts;
  body.position.y = 4.6 + bob;
  head.position.y = 8.4 + bob * 1.1;
  scarf.position.y = 6.6 + bob;
  if (player.isMoving) {
    feet[0].position.y = 1.4 + Math.max(0, Math.sin(t * bobSpeed)) * 0.9;
    feet[1].position.y = 1.4 + Math.max(0, -Math.sin(t * bobSpeed)) * 0.9;
  } else {
    feet[0].position.y = 1.4;
    feet[1].position.y = 1.4;
  }
}
