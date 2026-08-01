'use strict';

/**
 * game/InputManager.js
 * ----------------------------------------------------------------------
 * Traduit les touches clavier actuellement enfoncées en un vecteur de
 * direction normalisé (8 directions : haut/bas/gauche/droite + diagonales).
 * Supporte ZQSD (clavier FR) et les flèches directionnelles.
 *
 * Le module s'active/se désactive explicitement (enable/disable) : quand
 * le mini-jeu est fermé, ou quand le focus est dans un champ texte (ex:
 * le chat), les touches ne doivent pas déplacer le personnage.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.InputManager = class InputManager {
  constructor() {
    this.pressed = new Set();
    this.active = false;
    this.shiftHeld = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
  }

  enable() {
    if (this.active) return;
    this.active = true;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.pressed.clear();
    this.shiftHeld = false;
  }

  /** Touche Shift maintenue -> déplacement en course plutôt qu'en marche. */
  isRunning() {
    return this.shiftHeld;
  }

  _isTypingTarget(target) {
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
  }

  _onKeyDown(e) {
    if (this._isTypingTarget(e.target)) return;
    if (e.key === 'Shift') this.shiftHeld = true;
    if (MOVE_KEYS.has(e.key)) {
      this.pressed.add(e.key);
      e.preventDefault();
    }
  }

  _onKeyUp(e) {
    if (e.key === 'Shift') this.shiftHeld = false;
    if (MOVE_KEYS.has(e.key)) {
      this.pressed.delete(e.key);
    }
  }

  _onBlur() {
    this.pressed.clear();
    this.shiftHeld = false;
  }

  /**
   * @returns {{x: number, y: number}} vecteur de direction normalisé
   * (magnitude <= 1), en coordonnées monde (x: droite+, y: bas+).
   */
  getDirection() {
    let x = 0;
    let y = 0;

    if (this.pressed.has('ArrowUp') || this.pressed.has('z') || this.pressed.has('Z')) y -= 1;
    if (this.pressed.has('ArrowDown') || this.pressed.has('s') || this.pressed.has('S')) y += 1;
    if (this.pressed.has('ArrowLeft') || this.pressed.has('q') || this.pressed.has('Q')) x -= 1;
    if (this.pressed.has('ArrowRight') || this.pressed.has('d') || this.pressed.has('D')) x += 1;

    if (x !== 0 && y !== 0) {
      const norm = Math.SQRT1_2;
      x *= norm;
      y *= norm;
    }

    return { x, y };
  }
};

const MOVE_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'z', 'Z', 'q', 'Q', 's', 'S', 'd', 'D',
]);
