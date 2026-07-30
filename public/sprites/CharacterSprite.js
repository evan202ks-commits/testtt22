'use strict';

/**
 * sprites/CharacterSprite.js
 * ----------------------------------------------------------------------
 * Remplace CircleSprite : un vrai petit personnage RPG tactique "chibi"
 * (grande tête, silhouette lisible en vue iso), 100% dessiné au canvas
 * (aucun asset externe), avec :
 *   - 8 directions visuelles (bas, haut, gauche, droite, 4 diagonales),
 *     obtenues via 4 poses de base (avant / arrière / profil / diagonale)
 *     + un miroir horizontal pour la moitié gauche.
 *   - une animation idle (respiration) et une animation de marche
 *     (balancement des jambes/bras) pilotées par un simple sinus.
 *   - une teinte de tunique dérivée de l'identifiant joueur, une coiffe
 *     et une cape tirées d'une petite palette cohérente, pour que
 *     chaque joueur soit visuellement distinct sans casser le style.
 * ----------------------------------------------------------------------
 */

window.Game = window.Game || {};
window.Game.Sprites = window.Game.Sprites || {};

window.Game.Sprites.CharacterSprite = (function () {
  const HAIR_COLORS = ['#3b2415', '#6b4423', '#caa24a', '#8c2f1c', '#4a4a4a', '#d8d8d8'];
  const SKIN_TONES = ['#f2c9a0', '#e0ac7a', '#c98a5b', '#a86a42'];
  const HOOD_COLORS = ['#5b3a86', '#2f5f8a', '#7a2f3a', '#2f6b4a', '#8a5a2f', '#3a3a5f'];

  function pick(list, hash) {
    return list[hash % list.length];
  }

  // Assombrit une couleur hex (#rrggbb) d'un facteur [0..1] sans dépendre
  // de color-mix() (support navigateur inégal) ni d'un espace couleur HSL.
  function darkenHex(hex, factor = 0.3) {
    const h = hex.replace('#', '');
    const r = Math.round(parseInt(h.substring(0, 2), 16) * (1 - factor));
    const g = Math.round(parseInt(h.substring(2, 4), 16) * (1 - factor));
    const b = Math.round(parseInt(h.substring(4, 6), 16) * (1 - factor));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function bodyPalette(userId) {
    const hash = window.Game.mathUtils.hashString(String(userId));
    return {
      hue: hash % 360,
      hair: pick(HAIR_COLORS, Math.floor(hash / 7)),
      skin: pick(SKIN_TONES, Math.floor(hash / 13)),
      hood: pick(HOOD_COLORS, Math.floor(hash / 19)),
      hasHood: hash % 3 === 0,
      hasCape: hash % 2 === 0,
    };
  }

  // 8 directions -> { group: 'front'|'back'|'side', flip: bool }
  const DIRECTION_MAP = {
    down: { group: 'front', flip: false },
    'down-right': { group: 'frontDiag', flip: false },
    right: { group: 'side', flip: false },
    'up-right': { group: 'backDiag', flip: false },
    up: { group: 'back', flip: false },
    'up-left': { group: 'backDiag', flip: true },
    left: { group: 'side', flip: true },
    'down-left': { group: 'frontDiag', flip: true },
  };

  /**
   * Détermine une direction (8 secteurs) à partir d'un vecteur de
   * déplacement en coordonnées ÉCRAN isométrique (donc déjà x - y / x + y),
   * pour que "gauche" à l'écran corresponde bien à un mouvement vers la
   * gauche à l'écran, quel que soit le sens des axes du monde.
   */
  function directionFromIsoVector(isoDX, isoDY) {
    if (isoDX === 0 && isoDY === 0) return null;
    const angle = Math.atan2(isoDY, isoDX); // -PI..PI, 0 = droite, PI/2 = bas
    const sector = Math.round(angle / (Math.PI / 4)) & 7; // 0..7
    const order = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
    return order[sector];
  }

  function limb(ctx, x1, y1, x2, y2, width, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function outline(ctx, color = 'rgba(30, 20, 15, 0.55)', width = 1.3) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  /**
   * Dessine le personnage centré en (0,0) = point au sol entre les pieds,
   * l'axe Y négatif pointant vers le haut. `swing` in [-1, 1] : phase de
   * marche (0 = jambes jointes). `bob` : léger décalage vertical du corps.
   */
  function drawFigure(ctx, { group, tunicColor, pal, swing, bob, isMe }) {
    const legSwing = swing * 6;
    const armSwing = swing * 7;
    const legColor = '#4a3624';
    const bootColor = '#33241a';

    ctx.save();
    ctx.translate(0, bob);

    // --- Jambes ---
    const legY0 = -20;
    const legY1 = -2;
    limb(ctx, -4, legY0, -4 + legSwing * 0.4, legY1, 5, legColor);
    limb(ctx, 4, legY0, 4 - legSwing * 0.4, legY1, 5, legColor);
    // Bottes
    ctx.save();
    ctx.fillStyle = bootColor;
    ctx.beginPath();
    ctx.ellipse(-4 + legSwing * 0.4, legY1 + 1, 4, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(4 - legSwing * 0.4, legY1 + 1, 4, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- Cape (dessinée avant le torse pour les vues arrière/profil) ---
    if (pal.hasCape && group !== 'front') {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-7, -40);
      ctx.quadraticCurveTo(-12 + legSwing * 0.2, -18, -6, -4);
      ctx.lineTo(2, -6);
      ctx.quadraticCurveTo(-2, -22, 3, -40);
      ctx.closePath();
      const capeGrad = ctx.createLinearGradient(-10, -40, 0, -4);
      capeGrad.addColorStop(0, `hsl(${pal.hue}, 45%, 38%)`);
      capeGrad.addColorStop(1, `hsl(${pal.hue}, 45%, 22%)`);
      ctx.fillStyle = capeGrad;
      ctx.fill();
      outline(ctx, 'rgba(15,10,10,0.5)', 1);
      ctx.restore();
    }

    // --- Bras (arrière du torse) ---
    const armY0 = -37;
    const armY1 = -18;
    limb(ctx, -8, armY0, -8 - armSwing * 0.3, armY1, 4.2, pal.skin);
    limb(ctx, 8, armY0, 8 + armSwing * 0.3, armY1, 4.2, pal.skin);

    // --- Torse / tunique ---
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-9, -14);
    ctx.quadraticCurveTo(-11, -30, -8, -40);
    ctx.lineTo(8, -40);
    ctx.quadraticCurveTo(11, -30, 9, -14);
    ctx.quadraticCurveTo(0, -10, -9, -14);
    ctx.closePath();
    const tunicGrad = ctx.createLinearGradient(-9, -40, 9, -12);
    tunicGrad.addColorStop(0, tunicColor.light);
    tunicGrad.addColorStop(1, tunicColor.dark);
    ctx.fillStyle = tunicGrad;
    ctx.fill();
    outline(ctx);
    // Ceinture
    ctx.beginPath();
    ctx.moveTo(-9.5, -18);
    ctx.lineTo(9.5, -18);
    ctx.strokeStyle = 'rgba(50, 30, 10, 0.55)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();

    // --- Arme dans le dos (profil / dos), petite touche tactique-RPG ---
    if (group === 'side' || group === 'back' || group === 'backDiag') {
      ctx.save();
      ctx.translate(6, -34);
      ctx.rotate(0.5);
      ctx.fillStyle = '#9c9c9c';
      ctx.fillRect(-1.4, -14, 2.8, 16);
      ctx.fillStyle = '#6b4a28';
      ctx.fillRect(-2.2, 1, 4.4, 4);
      outline(ctx, 'rgba(20,20,20,0.5)', 1);
      ctx.restore();
    }

    // --- Tête ---
    const headY = -46;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, headY, 8.6, 0, Math.PI * 2);
    const skinGrad = ctx.createRadialGradient(-2.5, headY - 2.5, 1, 0, headY, 9);
    skinGrad.addColorStop(0, '#ffffff');
    skinGrad.addColorStop(0.15, pal.skin);
    skinGrad.addColorStop(1, pal.skin);
    ctx.fillStyle = skinGrad;
    ctx.fill();
    outline(ctx, 'rgba(30,20,15,0.45)', 1);
    ctx.restore();

    // --- Coiffe / capuche / cheveux ---
    ctx.save();
    if (pal.hasHood) {
      ctx.beginPath();
      ctx.arc(0, headY - 1, 9.4, Math.PI, Math.PI * 2.15);
      ctx.lineTo(8.5, headY + 4);
      ctx.quadraticCurveTo(0, headY + 8, -8.5, headY + 4);
      ctx.closePath();
      const hoodGrad = ctx.createLinearGradient(0, headY - 10, 0, headY + 6);
      hoodGrad.addColorStop(0, pal.hood);
      hoodGrad.addColorStop(1, darkenHex(pal.hood, 0.35));
      ctx.fillStyle = hoodGrad;
      ctx.fill();
      outline(ctx, 'rgba(15,10,10,0.5)', 1);
    } else {
      ctx.beginPath();
      ctx.arc(0, headY - 1, 9, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fillStyle = pal.hair;
      ctx.fill();
      outline(ctx, 'rgba(20,15,10,0.4)', 1);
    }
    ctx.restore();

    // --- Visage (uniquement de face / diagonale avant) ---
    if (group === 'front' || group === 'frontDiag') {
      ctx.save();
      const eyeDx = group === 'frontDiag' ? 2 : 0;
      ctx.fillStyle = '#2a2016';
      ctx.beginPath();
      ctx.arc(-3 + eyeDx, headY, 1.1, 0, Math.PI * 2);
      ctx.arc(3 + eyeDx, headY, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 70, 50, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(eyeDx, headY + 3.4, 1.6, 0.15, Math.PI - 0.15);
      ctx.stroke();
      ctx.restore();
    } else if (group === 'side') {
      ctx.save();
      ctx.fillStyle = '#2a2016';
      ctx.beginPath();
      ctx.arc(5.5, headY, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Halo doré discret pour se repérer soi-même, sans dénaturer le style.
    if (isMe) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, headY - 1, 11.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 221, 128, 0.85)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawShadow(ctx, radius) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 2, radius, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.fill();
    ctx.restore();
  }

  function drawNameplate(ctx, x, y, label, isMe) {
    ctx.save();
    ctx.font = '600 11px "Trebuchet MS", Inter, system-ui, sans-serif';
    const padding = 7;
    const textWidth = ctx.measureText(label).width;
    const boxWidth = textWidth + padding * 2;
    const boxHeight = 16;
    const boxX = x - boxWidth / 2;
    const boxY = y - boxHeight / 2;

    ctx.fillStyle = isMe ? 'rgba(74, 46, 18, 0.88)' : 'rgba(20, 16, 12, 0.78)';
    ctx.strokeStyle = isMe ? 'rgba(255, 221, 128, 0.9)' : 'rgba(220, 200, 160, 0.35)';
    ctx.lineWidth = 1;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 4);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
      ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
    }

    ctx.fillStyle = '#f4e9d0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, boxY + boxHeight / 2 + 1);
    ctx.restore();
  }

  // Découpe `text` en lignes d'au plus `maxWidth` px (mesuré avec la
  // police déjà réglée sur ctx), avec un plafond de lignes pour qu'un
  // message trop long ne prenne jamais tout l'écran.
  function wrapText(ctx, text, maxWidth, maxLines = 4) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';

    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word;
      if (ctx.measureText(attempt).width > maxWidth && current) {
        lines.push(current);
        current = word;
        if (lines.length === maxLines - 1) break;
      } else {
        current = attempt;
      }
    }
    if (current) lines.push(current);

    // S'il reste du texte non consommé (message très long), on tronque
    // la dernière ligne affichée avec une ellipse plutôt que de déborder.
    const consumed = lines.join(' ').length;
    if (consumed < text.length) {
      let last = lines[lines.length - 1] || '';
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = `${last}…`;
    }
    return lines;
  }

  // Bulle de dialogue façon bande dessinée : rectangle arrondi + petite
  // pointe vers le bas, centrée au-dessus de `x`, base en `y`.
  function drawChatBubble(ctx, x, y, text, isMe) {
    ctx.save();
    ctx.font = '600 12px "Trebuchet MS", Inter, system-ui, sans-serif';

    const paddingX = 10;
    const paddingY = 7;
    const lineHeight = 15;
    const maxTextWidth = 170;
    const lines = wrapText(ctx, text, maxTextWidth);

    const textWidth = Math.min(maxTextWidth, Math.max(...lines.map((l) => ctx.measureText(l).width)));
    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = lines.length * lineHeight + paddingY * 2;
    const boxX = x - boxWidth / 2;
    const boxY = y - boxHeight;
    const tailSize = 6;

    ctx.fillStyle = isMe ? 'rgba(255, 248, 232, 0.96)' : 'rgba(255, 255, 255, 0.96)';
    ctx.strokeStyle = isMe ? 'rgba(255, 221, 128, 0.9)' : 'rgba(40, 32, 24, 0.35)';
    ctx.lineWidth = 1.4;

    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
    } else {
      ctx.rect(boxX, boxY, boxWidth, boxHeight);
    }
    ctx.fill();
    ctx.stroke();

    // Pointe de la bulle, vers le bas (côté personnage).
    ctx.beginPath();
    ctx.moveTo(x - tailSize, boxY + boxHeight - 1);
    ctx.lineTo(x + tailSize, boxY + boxHeight - 1);
    ctx.lineTo(x, boxY + boxHeight + tailSize);
    ctx.closePath();
    ctx.fillStyle = isMe ? 'rgba(255, 248, 232, 0.96)' : 'rgba(255, 255, 255, 0.96)';
    ctx.fill();

    ctx.fillStyle = '#241a10';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const ly = boxY + paddingY + lineHeight * i + lineHeight / 2;
      ctx.fillText(line, x, ly);
    });

    ctx.restore();
    return boxHeight + tailSize;
  }

  function drawHpBar(ctx, x, y, width, ratio) {
    const h = 4;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 10, 8, 0.7)';
    ctx.fillRect(x - width / 2, y, width, h);
    const g = ctx.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
    g.addColorStop(0, '#7fe06a');
    g.addColorStop(1, '#3fae3a');
    ctx.fillStyle = g;
    ctx.fillRect(x - width / 2, y, width * window.Game.mathUtils.clamp(ratio, 0, 1), h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - width / 2, y, width, h);
    ctx.restore();
  }

  return {
    directionFromIsoVector,

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {{x:number,y:number}} screen point au sol (pieds)
     * @param {Object} opts
     * @param {string} [opts.direction] une des 8 clés de DIRECTION_MAP
     * @param {boolean} [opts.moving]
     * @param {number} [opts.animTime] secondes écoulées (accumulateur libre)
     * @param {string} [opts.userId] pour dériver couleur/coiffe/peau
     * @param {string} [opts.color] couleur de tunique (hsl(...)) — cohérente avec l'ancien système
     * @param {boolean} [opts.isMe]
     * @param {string} [opts.label]
     * @param {number} [opts.hpRatio] 0..1, vie affichée (par défaut pleine)
     * @param {string} [opts.chatText] dernier message de chat à afficher
     *   en bulle au-dessus du personnage (vide/absent = pas de bulle)
     */
    draw(ctx, screen, opts = {}) {
      const {
        direction = 'down',
        moving = false,
        animTime = 0,
        userId = 'anon',
        color,
        isMe = false,
        label = '',
        hpRatio = 1,
        chatText = '',
      } = opts;

      const pal = bodyPalette(userId);
      const hue = color ? null : pal.hue;
      const baseColor = color || `hsl(${pal.hue}, 62%, 52%)`;
      const tunicColor = {
        light: color ? color : `hsl(${hue}, 60%, 60%)`,
        dark: color ? color : `hsl(${hue}, 55%, 34%)`,
      };
      if (color) {
        // Si une couleur explicite est fournie (compat ancien système),
        // on dérive juste une variante plus sombre pour le dégradé.
        tunicColor.light = color;
        tunicColor.dark = color;
      }

      const mapEntry = DIRECTION_MAP[direction] || DIRECTION_MAP.down;
      const walkSpeed = 8;
      const swing = moving ? Math.sin(animTime * walkSpeed) : 0;
      const bob = moving
        ? Math.abs(Math.sin(animTime * walkSpeed)) * -1.4
        : Math.sin(animTime * 2) * -0.6;

      const radius = 12;

      ctx.save();
      ctx.translate(screen.x, screen.y);
      drawShadow(ctx, radius);

      if (mapEntry.flip) ctx.scale(-1, 1);
      drawFigure(ctx, {
        group: mapEntry.group,
        tunicColor,
        pal,
        swing,
        bob,
        isMe,
      });
      ctx.restore();

      const headScreenY = screen.y - 46 - 12;
      if (label) {
        drawNameplate(ctx, screen.x, headScreenY - 8, label, isMe);
        drawHpBar(ctx, screen.x, headScreenY + 2, 26, hpRatio);
      }
      if (chatText) {
        // Posée juste au-dessus du nameplate (lui-même au-dessus de la tête).
        drawChatBubble(ctx, screen.x, headScreenY - 20, chatText, isMe);
      }
    },
  };
})();
