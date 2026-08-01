'use strict';

/**
 * game/render/AssetManifest.js
 * ----------------------------------------------------------------------
 * Charge la configuration graphique modulaire (public/assets/manifest.json
 * + sous-manifestes) et construit les textures Three.js correspondantes.
 * C'est le SEUL endroit du moteur qui connaît des chemins de fichiers —
 * tout le reste du rendu lit ses données via cette classe, jamais un
 * chemin en dur. Ajouter/remplacer un asset = éditer les JSON dans
 * public/assets/ (voir le README de ce dossier), zéro changement ici.
 *
 * Best-effort : si un fichier manque ou que le réseau a un problème, on
 * retombe sur un manifeste d'animation par défaut plutôt que de casser
 * le jeu (voir FALLBACK_ANIMATION_MANIFEST).
 * ----------------------------------------------------------------------
 */

import * as THREE from 'three';

const ASSET_ROOT = 'assets/';

const FALLBACK_ANIMATION_MANIFEST = {
  frameSize: [64, 64],
  directions: ['down', 'left', 'right', 'up'],
  animations: {
    idle: { frames: 4, fps: 6, loop: true },
    walk: { frames: 6, fps: 10, loop: true },
    run: { frames: 6, fps: 14, loop: true },
    interact: { frames: 4, fps: 8, loop: false },
    harvest: { frames: 5, fps: 8, loop: false },
    attack: { frames: 4, fps: 12, loop: false },
  },
};

const textureLoader = new THREE.TextureLoader();

function loadTexture(path, { repeat = false } = {}) {
  const tex = textureLoader.load(ASSET_ROOT + path);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

// Variante "attendue" : résout une fois l'image réellement décodée.
// Utilisée pour tout ce qui peut être CLONÉ ensuite (flore) — un clone
// pris avant la fin du chargement ne recevrait jamais l'image (le
// callback du loader ne met à jour que l'objet Texture d'origine).
function loadTexturePromise(path, { repeat = false } = {}) {
  return new Promise((resolve) => {
    const tex = textureLoader.load(
      ASSET_ROOT + path,
      () => resolve(tex),
      undefined,
      () => resolve(tex) // best-effort : on continue même en cas d'échec réseau
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }
  });
}

async function fetchJSON(path) {
  const res = await fetch(ASSET_ROOT + path);
  if (!res.ok) throw new Error(`manifeste introuvable : ${path} (${res.status})`);
  return res.json();
}

export class AssetManifest {
  constructor() {
    this.activeSkinId = 'hero-default';
    this.characterAnimationManifests = new Map(); // skinId -> manifeste
    this.characterSkinDefs = new Map(); // skinId -> { spriteDir, prefix }
    this.tilesetDefs = {};
    this.tilesetTextures = new Map(); // nom -> THREE.Texture | THREE.Texture[]
    this.floraTexture = null;
    this.floraDef = null;
    this.vfxTextures = new Map();

    this.ready = this._load();
  }

  async _load() {
    let root;
    try {
      root = await fetchJSON('manifest.json');
    } catch (err) {
      console.warn('[AssetManifest] manifest.json indisponible, personnage de secours utilisé.', err);
      this.characterAnimationManifests.set('hero-default', FALLBACK_ANIMATION_MANIFEST);
      return;
    }

    this.activeSkinId = root.activeCharacterSkin || 'hero-default';

    await Promise.all(
      Object.entries(root.characters || {}).map(([skinId, def]) => this._loadCharacterSkin(skinId, def))
    );
    if (!this.characterAnimationManifests.has(this.activeSkinId)) {
      this.characterAnimationManifests.set(this.activeSkinId, FALLBACK_ANIMATION_MANIFEST);
    }

    if (root.tilesets) {
      try {
        this.tilesetDefs = await fetchJSON(root.tilesets);
        await this._loadTilesets(this.tilesetDefs);
      } catch (err) {
        console.warn('[AssetManifest] tilesets indisponibles.', err);
      }
    }

    if (root.vfx) {
      try {
        const vfxDef = await fetchJSON(root.vfx);
        for (const [name, def] of Object.entries(vfxDef)) {
          this.vfxTextures.set(name, loadTexture(`vfx/${def.file}`));
        }
      } catch (err) {
        console.warn('[AssetManifest] vfx indisponibles.', err);
      }
    }
  }

  async _loadCharacterSkin(skinId, def) {
    this.characterSkinDefs.set(skinId, def);
    let animManifest;
    try {
      animManifest = await fetchJSON(def.animationManifest);
    } catch (err) {
      console.warn(`[AssetManifest] animations du skin "${skinId}" indisponibles, secours utilisé.`, err);
      animManifest = FALLBACK_ANIMATION_MANIFEST;
    }
    this.characterAnimationManifests.set(skinId, animManifest);
  }

  async _loadTilesets(defs) {
    const pending = [];
    for (const [name, def] of Object.entries(defs)) {
      if (name === 'flora') {
        this.floraDef = def;
        pending.push(loadTexturePromise(`tilesets/${def.file}`).then((tex) => { this.floraTexture = tex; }));
        continue;
      }
      if (Array.isArray(def.frames)) {
        this.tilesetTextures.set(
          name,
          def.frames.map((f) => loadTexture(`tilesets/${f}`, { repeat: true }))
        );
      } else if (def.file) {
        this.tilesetTextures.set(name, loadTexture(`tilesets/${def.file}`, { repeat: true }));
      }
    }
    await Promise.all(pending);
  }

  getAnimationManifest(skinId = this.activeSkinId) {
    return this.characterAnimationManifests.get(skinId) || FALLBACK_ANIMATION_MANIFEST;
  }

  /**
   * Un jeu de textures FRAIS (une par état d'animation) pour un avatar.
   * Volontairement pas de cache/partage ici : chaque avatar mute le
   * offset/repeat de sa propre texture pour choisir sa frame courante
   * (voir game/render/CharacterAvatar.js) — partager une même instance
   * de Texture entre deux joueurs les ferait s'animer en miroir l'un de
   * l'autre. Les fichiers PNG sources, eux, restent mis en cache par le
   * navigateur (aucune requête réseau répétée).
   */
  createCharacterTextureSet(skinId = this.activeSkinId) {
    const def = this.characterSkinDefs.get(skinId);
    const manifest = this.getAnimationManifest(skinId);
    const textures = {};
    if (!def) return textures;
    for (const state of Object.keys(manifest.animations)) {
      textures[state] = loadTexture(`${def.spriteDir}/${def.prefix}-${state}.png`);
    }
    return textures;
  }

  /** THREE.Texture pour un tileset statique, ou THREE.Texture[] pour un
   * tileset animé (ex: "water") — voir tilesets/tilesets.json. */
  getTilesetTexture(name) {
    return this.tilesetTextures.get(name) || null;
  }

  getTilesetDef(name) {
    return this.tilesetDefs[name] || null;
  }

  getFlora() {
    return { texture: this.floraTexture, def: this.floraDef };
  }

  getVfxTexture(name) {
    return this.vfxTextures.get(name) || null;
  }
}
