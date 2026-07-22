'use strict';

/**
 * game/main.js
 * ----------------------------------------------------------------------
 * Colle le mini-jeu à la page existante :
 *   - lit `socket` et `state`, deux variables globales déjà déclarées par
 *     public/client.js (const de plus haut niveau, partagées entre tous
 *     les <script> classiques de la page). On ne les modifie jamais,
 *     seulement lues.
 *   - gère l'ouverture/fermeture du mini-jeu via la touche Tab
 *   - crée/démarre/arrête le GameEngine
 *
 * client.js n'est pas touché : ce fichier ajoute simplement SES PROPRES
 * écouteurs (socket.on peut avoir plusieurs abonnés par évènement), et
 * lit l'état de session déjà maintenu par client.js pour connaître mon
 * identité, mon pseudo et la liste des utilisateurs de la salle.
 * ----------------------------------------------------------------------
 */

(function initMiniGame() {
  function boot() {
    const overlay = document.getElementById('gameOverlay');
    const canvas = document.getElementById('gameCanvas');
    const hudCount = document.getElementById('gamePlayerCount');

    if (!overlay || !canvas || typeof socket === 'undefined' || typeof state === 'undefined') {
      // La page ne contient pas (encore) l'UI du mini-jeu, ou client.js
      // n'a pas pu s'initialiser : on abandonne proprement.
      return;
    }

    const engine = new window.Game.GameEngine({
      canvas,
      socket,
      getSessionState: () => ({
        myUserId: state.myUserId,
        myUsername: state.myUsername,
        users: state.users,
      }),
      onRosterChange: (count) => {
        if (hudCount) hudCount.textContent = String(count);
      },
    });

    let isOpen = false;

    function openGame() {
      if (!state.roomCode) return; // le jeu n'a de sens que dans une salle
      isOpen = true;
      overlay.classList.add('game-overlay--visible');
      engine.start();
    }

    function closeGame() {
      isOpen = false;
      overlay.classList.remove('game-overlay--visible');
      engine.stop();
    }

    function toggleGame() {
      if (isOpen) closeGame();
      else openGame();
    }

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      // On ignore Tab tant qu'on n'est pas dans une salle (écran d'accueil).
      if (!state.roomCode) return;
      e.preventDefault();
      toggleGame();
    });

    // Si l'utilisateur quitte la salle pendant que le jeu est ouvert, on
    // referme proprement (on observe juste l'écran existant, sans le
    // modifier).
    const btnLeaveRoom = document.getElementById('btnLeaveRoom');
    btnLeaveRoom?.addEventListener('click', () => {
      if (isOpen) closeGame();
      engine.players.clear();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
