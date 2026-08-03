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
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};

window.Game.Inventory = class Inventory {
  constructor({ overlayEl, gridEl, closeBtn, slotCount = 24 }) {
    this.overlayEl = overlayEl;
    this.gridEl = gridEl;
    this.closeBtn = closeBtn;
    this.slotCount = slotCount;

    this.userId = null;
    this.slots = [];
    this.open = false;

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
      this.gridEl.appendChild(slot);
    });
  }

  /** (Ré)initialise le sac pour un joueur donné et l'affiche. */
  openFor(userId) {
    if (!userId) return;
    if (this.userId !== userId) {
      this.userId = userId;
      this.slots = this._load(userId);
    }
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
