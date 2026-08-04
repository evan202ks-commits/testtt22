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
 *     le bouton "👥 Salle" (HUD) ouvre/ferme le panneau complet par-
 *     dessus, sans jamais stopper le jeu qui continue de tourner (et de
 *     recevoir les positions des autres joueurs) pendant qu'il est ouvert.
 * ----------------------------------------------------------------------
 */

(function initMiniGame() {
  function boot() {
    const gameOverlay = document.getElementById('gameOverlay');
    const chatOverlay = document.getElementById('chatOverlay');
    const screenRoom = document.getElementById('screen-room');
    const canvas = document.getElementById('gameCanvas');
    const hudCount = document.getElementById('gamePlayerCount');
    const inventoryOverlay = document.getElementById('inventoryOverlay');
    const inventoryGrid = document.getElementById('inventoryGrid');
    const inventoryOwnerName = document.getElementById('inventoryOwnerName');
    const btnCloseInventory = document.getElementById('btnCloseInventory');
    const hotbarEl = document.getElementById('hotbar');
    const healthBarFill = document.getElementById('healthBarFill');
    const healthBarText = document.getElementById('healthBarText');
    const healthBarEl = document.getElementById('healthBar');
    const chatBubblesToggle = document.getElementById('chatBubblesToggle');
    const worldBubbleLayer = document.getElementById('worldBubbleLayer');
    const gameChatInput = document.getElementById('gameChatInput');
    const btnToggleRoomPanel = document.getElementById('btnToggleRoomPanel');
    const btnCloseRoomPanel = document.getElementById('btnCloseRoomPanel');
    const CHAT_BUBBLES_STORAGE_KEY = 'realtime-infra:chatBubblesEnabled';

    if (!gameOverlay || !chatOverlay || !screenRoom || !canvas || typeof socket === 'undefined' || typeof state === 'undefined') {
      // La page ne contient pas (encore) l'UI attendue, ou client.js n'a
      // pas pu s'initialiser : on abandonne proprement.
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
      onHealthChange: (health, maxHealth) => {
        if (healthBarFill) {
          const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
          healthBarFill.style.width = `${ratio * 100}%`;
        }
        if (healthBarText) healthBarText.textContent = `${Math.round(health)} / ${maxHealth}`;
        if (healthBarEl) healthBarEl.setAttribute('aria-valuenow', String(Math.round(health)));
      },
      bubbleLayerEl: worldBubbleLayer,
    });

    const inventory = new window.Game.Inventory({
      overlayEl: inventoryOverlay,
      gridEl: inventoryGrid,
      closeBtn: btnCloseInventory,
      hotbarEl,
      onSelectionChange: (item) => engine.setLocalEquipped(item?.equipId || null),
    });

    // ---------------------------------------------------------------
    // Paramètre : bulles de chat au-dessus des personnages. Préférence
    // propre à ce navigateur (localStorage), activée par défaut.
    // ---------------------------------------------------------------
    if (chatBubblesToggle) {
      const stored = localStorage.getItem(CHAT_BUBBLES_STORAGE_KEY);
      const initiallyEnabled = stored === null ? true : stored === '1';
      chatBubblesToggle.checked = initiallyEnabled;
      engine.setChatBubblesEnabled(initiallyEnabled);

      chatBubblesToggle.addEventListener('change', () => {
        engine.setChatBubblesEnabled(chatBubblesToggle.checked);
        localStorage.setItem(CHAT_BUBBLES_STORAGE_KEY, chatBubblesToggle.checked ? '1' : '0');
      });
    }

    let inRoom = false;
    let chatOpen = false;

    function isCurrentlyInRoom() {
      return !screenRoom.classList.contains('screen--hidden');
    }

    function isTypingTarget(target) {
      const tag = target?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
    }

    function toggleInventory() {
      if (!inRoom) return;
      if (inventoryOwnerName) inventoryOwnerName.textContent = state.myUsername || 'Voyageur';
      inventory.toggleFor(state.myUserId);
    }

    function closeInventory() {
      inventory.close();
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

    if (btnToggleRoomPanel) {
      btnToggleRoomPanel.addEventListener('click', () => toggleChat());
    }
    if (btnCloseRoomPanel) {
      btnCloseRoomPanel.addEventListener('click', () => closeChat());
    }

    function enterRoomMode() {
      if (inRoom) return;
      inRoom = true;
      gameOverlay.classList.add('game-overlay--active');
      engine.start();
      inventory.initFor(state.myUserId); // affiche la hotbar dès l'entrée en jeu
      closeChat(); // le jeu s'affiche en premier, le chat reste fermé par défaut
    }

    function leaveRoomMode() {
      if (!inRoom) return;
      inRoom = false;
      gameOverlay.classList.remove('game-overlay--active');
      closeChat();
      closeInventory();
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
      if ((e.key === 'e' || e.key === 'E') && inRoom && !isTypingTarget(e.target)) {
        e.preventDefault();
        toggleInventory();
        return;
      }

      // Entrée place directement le curseur dans le chat en jeu (bas à
      // gauche), sans avoir besoin d'ouvrir le panneau complet (bouton
      // "👥 Salle") — comme dans la plupart des MMO. Sans effet si on
      // tape déjà quelque part (un autre champ, ou le chat en jeu
      // lui-même).
      if (e.key === 'Enter' && inRoom && gameChatInput && !isTypingTarget(e.target)) {
        e.preventDefault();
        gameChatInput.focus();
        return;
      }

      if (e.key === 'Escape') {
        if (inventory.open) closeInventory();
        if (gameChatInput && document.activeElement === gameChatInput) gameChatInput.blur();
        if (chatOpen) closeChat();
      }

      // Touches 1-9 : sélection directe d'une case de la hotbar, comme
      // dans Minecraft. "0" sélectionne la 10e case si elle existe.
      if (inRoom && !isTypingTarget(e.target) && e.key >= '0' && e.key <= '9') {
        const pressed = Number(e.key);
        const index = pressed === 0 ? 9 : pressed - 1;
        if (index < inventory.hotbarSize) {
          e.preventDefault();
          inventory.selectSlot(index);
        }
      }
    });

    // Molette de la souris au-dessus du jeu : fait défiler la sélection
    // de la hotbar (comme dans Minecraft). On ignore la molette si elle
    // est utilisée pour faire défiler autre chose (ex: panneau du sac,
    // chat complet) en ne l'écoutant que sur le viewport du jeu.
    const gameViewport = document.querySelector('.game-overlay__viewport');
    if (gameViewport) {
      gameViewport.addEventListener(
        'wheel',
        (e) => {
          if (!inRoom || inventory.hotbarSize <= 0) return;
          e.preventDefault();
          inventory.selectRelative(e.deltaY > 0 ? 1 : -1);
        },
        { passive: false }
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
