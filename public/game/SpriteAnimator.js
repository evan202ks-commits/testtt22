'use strict';

/**
 * game/render/SpriteAnimator.js
 * ----------------------------------------------------------------------
 * Petite machine à états qui pilote la lecture d'un sprite-sheet : à
 * partir d'un manifeste d'animation (frameSize, directions, {état:
 * {frames, fps, loop}}), avance l'index de frame au bon rythme et
 * calcule le rectangle UV (offset/repeat) correspondant.
 *
 * Convention de la grille (voir public/assets/README.md) : chaque état
 * d'animation est sa PROPRE image, avec une ligne par direction (dans
 * l'ordre `manifest.directions`) et une colonne par frame.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.SpriteAnimator = class SpriteAnimator {
  constructor(animationManifest) {
    this.manifest = animationManifest;
    this.state = 'idle';
    this.direction = 'down';
    this.frameIndex = 0;
    this.elapsed = 0;
    this.finished = false;
  }

  /** Change l'état/direction affichés. Remet l'animation à zéro
   * uniquement si l'état change (pas à chaque frame). */
  setState(state, direction) {
    const anim = this.manifest.animations[state] ? state : 'idle';
    if (anim !== this.state) {
      this.state = anim;
      this.frameIndex = 0;
      this.elapsed = 0;
      this.finished = false;
    }
    if (direction && direction !== this.direction) {
      this.direction = direction;
    }
  }

  update(dt) {
    const anim = this.manifest.animations[this.state];
    if (!anim || anim.frames <= 1) return;
    if (!anim.loop && this.finished) return;

    this.elapsed += dt;
    const frameDur = 1 / Math.max(1, anim.fps);
    while (this.elapsed >= frameDur) {
      this.elapsed -= frameDur;
      this.frameIndex += 1;
      if (this.frameIndex >= anim.frames) {
        if (anim.loop) {
          this.frameIndex = 0;
        } else {
          this.frameIndex = anim.frames - 1;
          this.finished = true;
          break;
        }
      }
    }
  }

  /** true une fois qu'une animation non-bouclée (interact/harvest/attack)
   * est arrivée à sa dernière frame — pratique pour revenir à idle/walk. */
  isFinished() {
    const anim = this.manifest.animations[this.state];
    return !!anim && !anim.loop && this.finished;
  }

  getUV() {
    const anim = this.manifest.animations[this.state] || this.manifest.animations.idle;
    const cols = Math.max(1, anim.frames);
    const rows = Math.max(1, this.manifest.directions.length);
    const row = Math.max(0, this.manifest.directions.indexOf(this.direction));
    return {
      repeatX: 1 / cols,
      repeatY: 1 / rows,
      offsetX: this.frameIndex / cols,
      offsetY: 1 - (row + 1) / rows,
    };
  }
};
