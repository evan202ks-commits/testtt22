'use strict';

/**
 * game/InputManager.js
 * ----------------------------------------------------------------------
 * Traduit les touches clavier actuellement enfoncées en un vecteur de
 * direction normalisé (8 directions : haut/bas/gauche/droite + diagonales).
 * Supporte ZQSD (clavier FR) et les flèches directionnelles.
 *
 * Course : la touche Shift (gauche ou droite) est suivie séparément
 * (isRunning()) et fait passer le personnage en vitesse de course tant
 * qu'elle est maintenue en même temps qu'une direction — voir
 * game/GameEngine.js, qui choisit la vitesse à appliquer à chaque frame.
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
    this.shiftPressed = false;
    this.active = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
  }

  enable() {
    if (this.active) return;
    this.active = true;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    this.pressed.clear();
    this.shiftPressed = false;
  }

  _isTypingTarget(target) {
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
  }

  _onKeyDown(e) {
    if (this._isTypingTarget(e.target)) return;
    if (e.key === 'Shift') {
      this.shiftPressed = true;
      return;
    }
    if (MOVE_KEYS.has(e.key)) {
      this.pressed.add(e.key);
      e.preventDefault();
    }
  }

  _onKeyUp(e) {
    // Toujours traiter le relâchement de Shift, quelle que soit la cible,
    // pour éviter que shiftPressed reste bloqué à true si le focus a changé
    // entre le keydown et le keyup (ex : ouverture du chat en courant).
    if (e.key === 'Shift') {
      this.shiftPressed = false;
      // Sur certains OS, maintenir Shift absorbe les keyup des touches de
      // direction : on vide pressed au relâchement pour éviter qu'une
      // direction reste bloquée après avoir couru.
      this.pressed.clear();
      return;
    }
    if (this._isTypingTarget(e.target)) return;
    if (MOVE_KEYS.has(e.key)) {
      this.pressed.delete(e.key);
    }
  }

  _onBlur() {
    this.pressed.clear();
    this.shiftPressed = false;
  }

  _onVisibilityChange() {
    // L'onglet passe en arrière-plan : les keyup ne sont plus reçus,
    // on réinitialise tout pour éviter un personnage bloqué en course.
    if (document.hidden) {
      this.pressed.clear();
      this.shiftPressed = false;
    }
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

  /** @returns {boolean} vrai tant que Shift est maintenu (course). */
  isRunning() {
    return this.shiftPressed;
  }
};

const MOVE_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'z', 'Z', 'q', 'Q', 's', 'S', 'd', 'D',
]);
