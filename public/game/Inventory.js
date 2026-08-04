'use strict';

/**
 * game/Inventory.js
 * ----------------------------------------------------------------------
 * Sac à dos du joueur : une grille de cases, ouverte/fermée avec la
 * touche "e". Purement côté client — aucune synchronisation réseau —
 * mais propre à CHAQUE joueur : la sauvegarde est faite dans
 * localStorage sous une clé qui inclut l'id du joueur courant
 * (`rpg-inventory:<userId>`), donc deux joueurs (deux onglets, deux
 * comptes) ne partagent jamais le même contenu, et chacun retrouve le
 * sien s'il revient plus tard.
 *
 * Hotbar (barre d'objets rapide, façon Minecraft) : reflète les N
 * premières cases du sac (`hotbarSize`, 9 par défaut) et reste
 * affichée en permanence pendant le jeu, sac ouvert ou non. La case
 * sélectionnée se change avec les touches 1-9, la molette de la
 * souris, ou un clic direct sur une case — et est elle aussi
 * sauvegardée par joueur (`rpg-hotbar-selection:<userId>`).
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.Inventory = class Inventory {
  constructor({ overlayEl, gridEl, closeBtn, hotbarEl, slotCount = 24, hotbarSize = 9 }) {
    this.overlayEl = overlayEl;
    this.gridEl = gridEl;
    this.closeBtn = closeBtn;
    this.hotbarEl = hotbarEl;
    this.slotCount = slotCount;
    this.hotbarSize = Math.min(hotbarSize, slotCount);

    this.userId = null;
    this.slots = [];
    this.open = false;
    this.selectedIndex = 0;

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }
    if (this.overlayEl) {
      // Clic sur le fond (hors panneau) = fermer.
      this.overlayEl.addEventListener('click', (e) => {
        if (e.target === this.overlayEl) this.close();
      });
    }
  }

  _storageKey(userId) {
    return `rpg-inventory:${userId}`;
  }

  _selectionStorageKey(userId) {
    return `rpg-hotbar-selection:${userId}`;
  }

  _defaultSlots() {
    const slots = new Array(this.slotCount).fill(null);
    // Petit fond de sac de départ, purement illustratif — chaque joueur
    // part avec ceci puis évolue indépendamment des autres.
    slots[0] = { icon: '🗡️', name: 'Épée courte', qty: 1 };
    slots[1] = { icon: '🧪', name: 'Potion de soin', qty: 2 };
    slots[2] = { icon: '🪵', name: 'Bois', qty: 3 };
    slots[3] = { icon: '🍞', name: 'Pain', qty: 1 };
    return slots;
  }

  _load(userId) {
    try {
      const raw = localStorage.getItem(this._storageKey(userId));
      if (!raw) return this._defaultSlots();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return this._defaultSlots();
      // Toujours caler sur slotCount courant (au cas où il change un jour).
      const fixed = new Array(this.slotCount).fill(null);
      for (let i = 0; i < Math.min(this.slotCount, parsed.length); i++) {
        fixed[i] = parsed[i];
      }
      return fixed;
    } catch {
      return this._defaultSlots();
    }
  }

  _save() {
    if (!this.userId) return;
    try {
      localStorage.setItem(this._storageKey(this.userId), JSON.stringify(this.slots));
    } catch {
      // Stockage indisponible (navigation privée, quota...) : on ignore,
      // l'inventaire reste utilisable pour la session en cours.
    }
  }

  _loadSelection(userId) {
    try {
      const raw = localStorage.getItem(this._selectionStorageKey(userId));
      const idx = raw === null ? 0 : parseInt(raw, 10);
      return Number.isInteger(idx) && idx >= 0 && idx < this.hotbarSize ? idx : 0;
    } catch {
      return 0;
    }
  }

  _saveSelection() {
    if (!this.userId) return;
    try {
      localStorage.setItem(this._selectionStorageKey(this.userId), String(this.selectedIndex));
    } catch {
      // Idem : on continue sans persister si le stockage est indisponible.
    }
  }

  _render() {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';
    this.slots.forEach((item, index) => {
      const slot = document.createElement('div');
      slot.className = 'inventory-slot rpg-slot';
      if (item) {
        slot.title = item.qty > 1 ? `${item.name} ×${item.qty}` : item.name;
        const icon = document.createElement('span');
        icon.className = 'inventory-slot__icon';
        icon.textContent = item.icon;
        slot.appendChild(icon);
        if (item.qty > 1) {
          const qty = document.createElement('span');
          qty.className = 'inventory-slot__qty';
          qty.textContent = String(item.qty);
          slot.appendChild(qty);
        }
      } else {
        slot.classList.add('inventory-slot--empty');
      }
      // La case du sac qui correspond à la sélection courante de la
      // hotbar est surlignée, comme dans Minecraft.
      if (index === this.selectedIndex && index < this.hotbarSize) {
        slot.classList.add('inventory-slot--hotbar-selected');
      }
      this.gridEl.appendChild(slot);
    });
  }

  _renderHotbar() {
    if (!this.hotbarEl) return;
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < this.hotbarSize; i++) {
      const item = this.slots[i];
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'hotbar-slot rpg-slot';
      if (i === this.selectedIndex) slot.classList.add('hotbar-slot--selected');

      const key = document.createElement('span');
      key.className = 'hotbar-slot__key';
      key.textContent = String((i + 1) % 10); // 1..9 puis 0 pour une 10e case éventuelle
      slot.appendChild(key);

      if (item) {
        slot.title = item.qty > 1 ? `${item.name} ×${item.qty}` : item.name;
        const icon = document.createElement('span');
        icon.className = 'hotbar-slot__icon';
        icon.textContent = item.icon;
        slot.appendChild(icon);
        if (item.qty > 1) {
          const qty = document.createElement('span');
          qty.className = 'hotbar-slot__qty';
          qty.textContent = String(item.qty);
          slot.appendChild(qty);
        }
      } else {
        slot.classList.add('hotbar-slot--empty');
        slot.title = 'Case vide';
      }

      slot.addEventListener('click', () => this.selectSlot(i));
      this.hotbarEl.appendChild(slot);
    }
  }

  _ensureLoadedFor(userId) {
    if (!userId || this.userId === userId) return;
    this.userId = userId;
    this.slots = this._load(userId);
    this.selectedIndex = this._loadSelection(userId);
  }

  /**
   * Charge (si besoin) le sac du joueur et affiche la hotbar tout de
   * suite, sans ouvrir le panneau du sac. À appeler dès l'entrée en
   * jeu, pour que la barre d'objets soit visible immédiatement.
   */
  initFor(userId) {
    this._ensureLoadedFor(userId);
    this._renderHotbar();
  }

  /** Sélectionne une case de la hotbar par son index (0-based). */
  selectSlot(index) {
    if (index < 0 || index >= this.hotbarSize) return;
    this.selectedIndex = index;
    this._saveSelection();
    this._renderHotbar();
    if (this.open) this._render();
  }

  /** Fait défiler la sélection de la hotbar (molette de souris, +1/-1). */
  selectRelative(direction) {
    const size = this.hotbarSize;
    const next = ((this.selectedIndex + direction) % size + size) % size;
    this.selectSlot(next);
  }

  /** Objet actuellement sélectionné dans la hotbar (ou null si case vide). */
  getSelectedItem() {
    return this.slots[this.selectedIndex] || null;
  }

  /** (Ré)initialise le sac pour un joueur donné et l'affiche. */
  openFor(userId) {
    if (!userId) return;
    this._ensureLoadedFor(userId);
    this._render();
    this.open = true;
    this.overlayEl?.classList.add('inventory-overlay--active');
  }

  close() {
    this.open = false;
    this.overlayEl?.classList.remove('inventory-overlay--active');
  }

  toggleFor(userId) {
    if (this.open) this.close();
    else this.openFor(userId);
  }
};
