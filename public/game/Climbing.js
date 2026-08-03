'use strict';

/**
 * game/Climbing.js
 * ----------------------------------------------------------------------
 * Mécanique d'escalade des échelles de montagne (voir
 * game/render/WorldBuilder.js : findLadderInteraction, mountain.ladders).
 * Principe : le joueur s'approche d'un bout d'échelle (base = côté
 * herbe, sommet = côté plateau) et MAINTIENT une touche de déplacement
 * (n'importe laquelle — ZQSD/flèches, les mêmes que pour marcher) pour
 * grimper. Tant que la touche est maintenue, la progression avance et le
 * joueur est déplacé le long de l'échelle (voir getPosition) ; s'il
 * relâche, il redescend/reglisse vers le point de départ au lieu de
 * s'arrêter net, pour donner une vraie sensation d'effort — jusqu'à
 * annulation si la progression retombe à 0.
 *
 * Ce module ne connaît ni le rendu ni le réseau : GameEngine.js pilote
 * la boucle (update à chaque frame) et applique la position résultante
 * au joueur local ; game/render/WorldRenderer.js lit seulement
 * getProgress() pour afficher l'anneau de progression au-dessus de la
 * tête du joueur pendant qu'il grimpe.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

// Temps (secondes) pour grimper une échelle en maintenant la touche.
const CLIMB_SECONDS = 1.35;
// Temps (secondes) pour retomber entièrement si on relâche en cours de
// route — plus rapide que la montée, pour que lâcher soit pénalisant
// sans pour autant renvoyer le joueur en arrière instantanément.
const RELEASE_SECONDS = 0.7;

window.Game.ClimbController = class ClimbController {
  constructor() {
    this.state = null; // { mode: 'up'|'down', from:{x,y}, to:{x,y}, progress }
    this._lastCompletedPosition = null;
  }

  get isClimbing() {
    return !!this.state;
  }

  reset() {
    this.state = null;
    this._lastCompletedPosition = null;
  }

  /**
   * Position monde courante le long de l'échelle, interpolée selon la
   * progression actuelle. Retourne null si aucune escalade en cours.
   */
  getPosition() {
    if (!this.state) return null;
    const { from, to, progress } = this.state;
    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
  }

  /** Progression 0..1 courante, ou null si pas d'escalade en cours (lu
   * par le renderer pour dessiner l'anneau de progression). */
  getProgress() {
    return this.state ? window.Game.mathUtils.clamp(this.state.progress, 0, 1) : null;
  }

  /**
   * À appeler une fois par frame avec la position actuelle du joueur
   * local (utile seulement pour détecter le DÉBUT d'une escalade) et si
   * une touche de déplacement est actuellement maintenue.
   * @returns {'started'|'progress'|'completed'|'cancelled'|null}
   */
  update(dt, playerX, playerY, holdingMove) {
    if (!this.state) {
      if (!holdingMove) return null;
      const hit = window.Game.WorldBuilder.findLadderInteraction(playerX, playerY);
      if (!hit) return null;
      this.state = { mode: hit.mode, from: hit.from, to: hit.to, progress: 0 };
      return 'started';
    }

    this.state.progress += holdingMove ? dt / CLIMB_SECONDS : -dt / RELEASE_SECONDS;

    if (this.state.progress >= 1) {
      this._lastCompletedPosition = { x: this.state.to.x, y: this.state.to.y };
      this.state = null;
      return 'completed';
    }
    if (this.state.progress <= 0) {
      this.state = null;
      return 'cancelled';
    }
    return 'progress';
  }

  /** Position finale à appliquer au joueur juste après un évènement
   * 'completed' (consomme la valeur : ne la retourne qu'une fois). */
  consumeCompletedPosition() {
    const p = this._lastCompletedPosition;
    this._lastCompletedPosition = null;
    return p;
  }
};
