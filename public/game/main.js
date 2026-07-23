'use strict';

/**
 * game/main.js
 * ----------------------------------------------------------------------
 * Colle le mini-jeu à la page existante :
 *   - lit `socket` et `state`, deux variables globales déjà déclarées par
 *     public/client.js (const de plus haut niveau, partagées entre tous
 *     les <script> classiques de la page). On ne les modifie jamais,
 *     seulement lues.
 *   - détecte automatiquement l'entrée/sortie de salle en observant la
 *     classe CSS "screen--hidden" sur #screen-room (déjà gérée par
 *     client.js) via un MutationObserver — donc sans jamais appeler ni
 *     modifier client.js.
 *   - le mini-jeu est la vue PAR DÉFAUT dès qu'on est dans une salle ;
 *     la touche Tab ouvre/ferme le chat par-dessus, sans jamais stopper
 *     le jeu qui continue de tourner (et de recevoir les positions des
 *     autres joueurs) pendant que le chat est ouvert.
 * ----------------------------------------------------------------------
 */

(function initMiniGame() {
  function boot() {
    const gameOverlay = document.getElementById('gameOverlay');
    const chatOverlay = document.getElementById('chatOverlay');
    const screenRoom = document.getElementById('screen-room');
    const canvas = document.getElementById('gameCanvas');
    const hudCount = document.getElementById('gamePlayerCount');
    const hudPlayerName = document.getElementById('hudPlayerName');
    const hudHotbar = document.getElementById('hudHotbar');
    const hudInventory = document.getElementById('hudInventory');

    if (!gameOverlay || !chatOverlay || !screenRoom || !canvas || typeof socket === 'undefined' || typeof state === 'undefined') {
      // La page ne contient pas (encore) l'UI attendue, ou client.js n'a
      // pas pu s'initialiser : on abandonne proprement.
      return;
    }

    // ---------------------------------------------------------------
    // HUD RPG (portrait/vie/nom déjà dans le HTML) : on construit ici
    // juste les emplacements de la barre de raccourcis et du sac, et on
    // reflète le pseudo courant. Purement visuel — aucun inventaire ni
    // système de PA/PV réel n'existe côté serveur ; ceci est la coquille
    // graphique demandée, sans ajouter de fonctionnalité de jeu.
    // ---------------------------------------------------------------
    const HOTBAR_ICONS = ['⚔️', '🛡️', '🧪', '📜', '🏹', '✨', '🍞', '🔑', '💰'];
    const INVENTORY_ICONS = ['🧵', '🪵', '💎', '🍎', '🗝️', '🧴', '📦', '⚗️'];

    function buildSlots(container, icons, keyLabels) {
      if (!container || container.childElementCount > 0) return;
      icons.forEach((icon, i) => {
        const slot = document.createElement('div');
        slot.className = 'rpg-slot';
        slot.innerHTML = `<span class="rpg-slot__icon">${icon}</span>`;
        if (keyLabels) {
          const key = document.createElement('span');
          key.className = 'rpg-slot__key';
          key.textContent = keyLabels[i];
          slot.appendChild(key);
        }
        container.appendChild(slot);
      });
    }

    buildSlots(hudHotbar, HOTBAR_ICONS, ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    buildSlots(hudInventory, INVENTORY_ICONS, null);

    function refreshHudIdentity() {
      if (hudPlayerName) hudPlayerName.textContent = state.myUsername || 'Aventurier';
    }

    // Simple retour visuel : appuyer sur 1-9 met en surbrillance le
    // raccourci correspondant (aucune action de jeu déclenchée).
    document.addEventListener('keydown', (e) => {
      if (!hudHotbar || e.key < '1' || e.key > '9') return;
      const idx = Number(e.key) - 1;
      const slots = hudHotbar.querySelectorAll('.rpg-slot');
      slots.forEach((s, i) => s.classList.toggle('rpg-slot--active', i === idx));
      window.setTimeout(() => slots[idx]?.classList.remove('rpg-slot--active'), 220);
    });

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

    let inRoom = false;
    let chatOpen = false;

    function isCurrentlyInRoom() {
      return !screenRoom.classList.contains('screen--hidden');
    }

    function openChat() {
      if (!inRoom) return;
      chatOpen = true;
      chatOverlay.classList.add('chat-overlay--active');
    }

    function closeChat() {
      chatOpen = false;
      chatOverlay.classList.remove('chat-overlay--active');
    }

    function toggleChat() {
      if (chatOpen) closeChat();
      else openChat();
    }

    function enterRoomMode() {
      if (inRoom) return;
      inRoom = true;
      gameOverlay.classList.add('game-overlay--active');
      refreshHudIdentity();
      engine.start();
      closeChat(); // le jeu s'affiche en premier, le chat reste fermé par défaut
    }

    function leaveRoomMode() {
      if (!inRoom) return;
      inRoom = false;
      gameOverlay.classList.remove('game-overlay--active');
      closeChat();
      engine.stop();
      engine.players.clear();
    }

    // Observe les changements de classe de #screen-room (basculée par
    // client.js à chaque room:create / room:join / room:leave) pour
    // savoir quand entrer/sortir du mode jeu, sans jamais appeler ni
    // modifier client.js lui-même.
    const observer = new MutationObserver(() => {
      if (isCurrentlyInRoom()) enterRoomMode();
      else leaveRoomMode();
    });
    observer.observe(screenRoom, { attributes: true, attributeFilter: ['class'] });

    // Au cas où la page se charge alors qu'une salle est déjà active
    // (ex: hot-reload en développement).
    if (isCurrentlyInRoom()) enterRoomMode();

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !inRoom) return;
      e.preventDefault();
      toggleChat();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
