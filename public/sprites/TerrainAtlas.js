'use strict';

/**
 * sprites/TerrainAtlas.js
 * ----------------------------------------------------------------------
 * Génère et met en cache des textures de tuiles isométriques (losanges
 * 2:1) 100% procédurales — aucune image externe, aucun asset copié.
 * Chaque type de terrain (herbe, sable, eau, pierre, terre/chemin,
 * bois) a sa palette et sa texture (bruit + hachures), avec plusieurs
 * variantes pour casser la répétition visuelle sur la grille.
 *
 * Les tuiles sont dessinées une fois sur un canvas hors-écran puis
 * réutilisées via drawImage (perf), sauf l'eau qui reçoit un léger
 * reflet animé dessiné par-dessus à chaque frame.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};
window.Game.Sprites = window.Game.Sprites || {};

window.Game.Sprites.TerrainAtlas = (function () {
  const rand = window.Game.mathUtils.mulberry32;
  const cache = new Map();

  const PALETTES = {
    grass: { top: '#8fc65a', mid: '#6fae44', low: '#4f8a31', speck: '#3d7326', speck2: '#a9db73' },
    grassDeep: { top: '#7abf4e', mid: '#5f9e3c', low: '#43792a', speck: '#345f21', speck2: '#9ad066' },
    sand: { top: '#f0dcA0', mid: '#e2c581', low: '#c8a75f', speck: '#b5904a', speck2: '#fbeecb' },
    stone: { top: '#c9c3bd', mid: '#aba39c', low: '#8b8379', speck: '#6f695f', speck2: '#e2ddd6' },
    dirt: { top: '#c08a54', mid: '#a06f40', low: '#7c5530', speck: '#5f3f22', speck2: '#d9a970' },
    wood: { top: '#c99a5b', mid: '#a97941', low: '#8a5f30', speck: '#6b4620', speck2: '#e0b878' },
    water: { top: '#4fb3d9', mid: '#2f8fc0', low: '#1c6a99', speck: '#a6e6f5', speck2: '#0f4b70' },
  };

  function diamondPath(ctx, w, h, cx, cy, inset = 0) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2 + inset);
    ctx.lineTo(cx + w / 2 - inset, cy);
    ctx.lineTo(cx, cy + h / 2 - inset);
    ctx.lineTo(cx - w / 2 + inset, cy);
    ctx.closePath();
  }

  function bakeTile(type, variant, tileW, tileH) {
    const pal = PALETTES[type] || PALETTES.grass;
    const pad = 4;
    const canvas = document.createElement('canvas');
    canvas.width = tileW + pad * 2;
    canvas.height = tileH + pad * 2 + 6; // marge basse pour un léger relief
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2;
    const cy = pad + tileH / 2;
    const rng = rand(variant * 7919 + type.length * 101);

    // Base : dégradé diagonal clair (haut-gauche) -> sombre (bas-droit),
    // pour une lumière cohérente venant d'en haut sur toute la carte.
    diamondPath(ctx, tileW, tileH, cx, cy);
    const grad = ctx.createLinearGradient(cx - tileW / 2, cy - tileH / 2, cx + tileW / 2, cy + tileH / 2);
    grad.addColorStop(0, pal.top);
    grad.addColorStop(0.55, pal.mid);
    grad.addColorStop(1, pal.low);
    ctx.fillStyle = grad;
    ctx.fill();

    // Texture : petites touches façon peint-à-la-main (pas du bruit pixel
    // dur), donnant un rendu "dessiné" plutôt que photo-réaliste.
    ctx.save();
    diamondPath(ctx, tileW, tileH, cx, cy, 1);
    ctx.clip();

    if (type === 'water') {
      // Vaguelettes : quelques arcs clairs.
      for (let i = 0; i < 5; i++) {
        const wx = cx - tileW / 2 + rng() * tileW;
        const wy = cy - tileH / 2 + rng() * tileH;
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(wx, wy, 3 + rng() * 4, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
    } else {
      const speckCount = type === 'stone' ? 10 : type === 'sand' ? 14 : 18;
      for (let i = 0; i < speckCount; i++) {
        const sx = cx - tileW / 2 + rng() * tileW;
        const sy = cy - tileH / 2 + rng() * tileH;
        const r = 0.6 + rng() * (type === 'stone' ? 2.4 : 1.4);
        ctx.fillStyle = rng() > 0.5 ? pal.speck : pal.speck2;
        ctx.globalAlpha = 0.35 + rng() * 0.25;
        ctx.beginPath();
        if (type === 'grass' || type === 'grassDeep') {
          // Petits brins : traits plutôt que points.
          const ang = rng() * Math.PI;
          const len = 2 + rng() * 3;
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(ang) * len, sy - len);
          ctx.stroke();
        } else if (type === 'stone') {
          ctx.beginPath();
          ctx.ellipse(sx, sy, r * 1.4, r, rng() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    if (type === 'wood') {
      // Lattes de planches (chemin en bois).
      ctx.strokeStyle = 'rgba(60, 36, 14, 0.4)';
      ctx.lineWidth = 1.2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - tileW / 2 + 4, cy + i * (tileH / 6));
        ctx.lineTo(cx + tileW / 2 - 4, cy + i * (tileH / 6) + tileH / 10);
        ctx.stroke();
      }
    }

    ctx.restore();

    // Liseré léger pour bien lire la grille (subtil, pas une grille dure).
    diamondPath(ctx, tileW, tileH, cx, cy, 0.5);
    ctx.strokeStyle = 'rgba(20, 20, 15, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Reflet clair sur l'arête haute-gauche pour un effet "peint" en volume.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - tileW / 2 + 2, cy);
    ctx.lineTo(cx, cy - tileH / 2 + 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    return { canvas, cx, cy };
  }

  function getTile(type, variant, tileW, tileH) {
    const key = `${type}|${variant}|${tileW}x${tileH}`;
    let baked = cache.get(key);
    if (!baked) {
      baked = bakeTile(type, variant, tileW, tileH);
      cache.set(key, baked);
    }
    return baked;
  }

  return {
    PALETTES,
    diamondPath,

    /**
     * Dessine une tuile de sol au point écran donné (centre du losange).
     * @param {CanvasRenderingContext2D} ctx
     * @param {{x:number,y:number}} screen
     */
    drawTile(ctx, screen, type, variant, tileW, tileH, time = 0) {
      const baked = getTile(type, variant, tileW, tileH);
      ctx.drawImage(baked.canvas, screen.x - baked.cx, screen.y - baked.cy);

      if (type === 'water') {
        // Reflet animé, peu coûteux, dessiné par-dessus la texture figée.
        const shimmer = (Math.sin(time * 1.6 + variant) + 1) / 2;
        ctx.save();
        diamondPath(ctx, tileW, tileH, screen.x, screen.y, 2);
        ctx.clip();
        ctx.globalAlpha = 0.12 + shimmer * 0.10;
        ctx.fillStyle = '#eafcff';
        ctx.beginPath();
        ctx.ellipse(screen.x - tileW * 0.15, screen.y - tileH * 0.1, tileW * 0.22, tileH * 0.14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    },

    /**
     * Bordure de côte : liseré sable/écume légèrement surélevé, dessiné
     * au bord des tuiles d'herbe/sable adjacentes à l'eau.
     */
    drawShoreEdge(ctx, screen, tileW, tileH) {
      ctx.save();
      diamondPath(ctx, tileW, tileH, screen.x, screen.y - 1, -1);
      ctx.strokeStyle = 'rgba(255, 250, 230, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    },
  };
})();
