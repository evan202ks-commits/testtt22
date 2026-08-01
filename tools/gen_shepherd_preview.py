#!/usr/bin/env python3
"""
tools/gen_shepherd_preview.py
----------------------------------------------------------------------
Génère une planche de PRÉVISUALISATION du personnage "berger" (contours
noirs + ombrage à deux tons, façon la référence fournie par
l'utilisateur), dans les 4 directions utilisées par le jeu
(down/left/right/up). Ne touche à AUCUN fichier du jeu — juste une
image à valider avant intégration éventuelle.
"""
from PIL import Image, ImageDraw

OUTLINE = (26, 20, 18, 255)

PAL = {
    "skin": (241, 196, 158, 255),
    "skin_shade": (214, 165, 128, 255),
    "cheek": (232, 150, 128, 255),
    "hood": (163, 128, 84, 255),
    "hood_shade": (129, 99, 63, 255),
    "trim": (246, 239, 221, 255),
    "trim_shade": (219, 206, 178, 255),
    "vest": (231, 219, 194, 255),
    "vest_shade": (200, 184, 152, 255),
    "sleeve": (150, 116, 78, 255),
    "sleeve_shade": (119, 89, 58, 255),
    "pants": (104, 80, 58, 255),
    "pants_shade": (80, 60, 42, 255),
    "boot": (68, 50, 37, 255),
    "belt": (74, 54, 40, 255),
    "scarf": (191, 76, 66, 255),
    "scarf_shade": (156, 58, 50, 255),
    "staff": (146, 108, 68, 255),
    "staff_shade": (112, 80, 48, 255),
    "hair": (94, 63, 42, 255),
    "eye": (35, 26, 24, 255),
}

W, H = 64, 88


def opoly(d, pts, fill, width=2):
    d.polygon(pts, fill=fill, outline=OUTLINE, width=width)


def oellipse(d, bbox, fill, width=2):
    d.ellipse(bbox, fill=fill, outline=OUTLINE, width=width)


def orrect(d, bbox, fill, radius=4, width=2):
    d.rounded_rectangle(bbox, radius=radius, fill=fill, outline=OUTLINE, width=width)


def draw_staff(d, side, top_y=14, base_y=84):
    x = 50 if side == "right" else 14
    d.line([x, top_y + 6, x, base_y], fill=OUTLINE, width=6)
    d.line([x, top_y + 6, x, base_y], fill=PAL["staff"], width=4)
    d.line([x - 2, top_y + 26, x + 2, top_y + 50], fill=PAL["staff_shade"], width=1)
    hook_bbox = [x - 7, top_y - 3, x + 7, top_y + 11]
    d.arc(hook_bbox, 200, 430, fill=OUTLINE, width=6)
    d.arc([x - 6, top_y - 2, x + 6, top_y + 10], 200, 430, fill=PAL["staff"], width=3)


def draw_body(d, facing):
    cx = 32
    # --- jambes / bottes ---
    for dx in (-6, 6):
        orrect(d, [cx + dx - 5, 68, cx + dx + 5, 82], PAL["pants"])
        orrect(d, [cx + dx - 5, 76, cx + dx + 5, 84], PAL["boot"])

    # --- pantalon (bas de la tunique) ---
    opoly(d, [(cx - 14, 56), (cx + 14, 56), (cx + 12, 72), (cx - 12, 72)], PAL["pants"])
    d.polygon([(cx + 1, 58), (cx + 12, 58), (cx + 10, 72), (cx + 1, 72)], fill=PAL["pants_shade"])

    # --- manches (bras) ---
    if facing != "up":
        for side, dx in (("l", -18), ("r", 18)):
            orrect(d, [cx + dx - 6, 40, cx + dx + 6, 58], PAL["sleeve"], radius=5)
        d.rectangle([cx + 12, 42, cx + 18, 58], fill=PAL["sleeve_shade"])
        # mains
        for dx in (-18, 18):
            oellipse(d, [cx + dx - 5, 54, cx + dx + 5, 64], PAL["skin"])
    else:
        for side, dx in (("l", -17), ("r", 17)):
            orrect(d, [cx + dx - 6, 40, cx + dx + 6, 60], PAL["sleeve"], radius=5)

    # --- houppelande / veste de laine ---
    opoly(d, [(cx - 15, 34), (cx + 15, 34), (cx + 17, 58), (cx - 17, 58)], PAL["vest"])
    d.polygon([(cx + 2, 36), (cx + 15, 36), (cx + 17, 58), (cx + 2, 58)], fill=PAL["vest_shade"])
    # bord de laine (bas)
    d.line([(cx - 17, 58), (cx + 17, 58)], fill=PAL["trim"], width=3)
    # ceinture
    d.rectangle([cx - 15, 51, cx + 15, 54], fill=PAL["belt"])
    d.rectangle([cx - 3, 50, cx + 3, 55], fill=(94, 74, 50, 255), outline=OUTLINE)

    # --- foulard rouge ---
    if facing != "up":
        opoly(d, [(cx - 9, 32), (cx + 9, 32), (cx + 6, 40), (cx - 6, 40)], PAL["scarf"])
        d.polygon([(cx + 1, 33), (cx + 9, 33), (cx + 6, 40), (cx + 1, 40)], fill=PAL["scarf_shade"])
    else:
        d.rectangle([cx - 9, 32, cx + 9, 37], fill=PAL["scarf"], outline=OUTLINE)


def draw_head(d, facing):
    cx = 32
    cy = 22
    r = 16

    # tete
    oellipse(d, [cx - r, cy - r + 2, cx + r, cy + r + 6], PAL["skin"])
    if facing in ("left", "right"):
        side = -1 if facing == "left" else 1
        x0, x1 = sorted([cx + side * 4, cx + side * (r + 2)])
        d.ellipse([x0, cy - 4, x1, cy + 10], fill=PAL["skin_shade"])
    else:
        d.ellipse([cx + 4, cy - 6, cx + r, cy + 12], fill=PAL["skin_shade"])

    # capuche (housse de laine, couvre le dessus + cotes)
    hood_top = [
        (cx - r - 2, cy - 2), (cx - 10, cy - r - 6), (cx, cy - r - 10),
        (cx + 10, cy - r - 6), (cx + r + 2, cy - 2),
        (cx + r - 2, cy + 6), (cx - r + 2, cy + 6),
    ]
    opoly(d, hood_top, PAL["hood"])
    d.polygon([(cx + 2, cy - r - 8), (cx + r + 2, cy - 2), (cx + r - 2, cy + 6), (cx + 4, cy + 4)], fill=PAL["hood_shade"])
    # liseré de laine crème sur le bord de la capuche
    d.line([(cx - r - 1, cy - 2), (cx - r + 3, cy + 6)], fill=PAL["trim"], width=3)
    d.line([(cx + r + 1, cy - 2), (cx + r - 3, cy + 6)], fill=PAL["trim"], width=3)
    d.arc([cx - r - 2, cy - r - 6, cx + r + 2, cy + 10], 160, 380, fill=PAL["trim"], width=2)

    if facing == "down":
        d.ellipse([cx - 6, cy + 9, cx - 2, cy + 13], fill=PAL["eye"])
        d.ellipse([cx + 2, cy + 9, cx + 6, cy + 13], fill=PAL["eye"])
        d.ellipse([cx - 10, cy + 12, cx - 6, cy + 16], fill=PAL["cheek"])
        d.ellipse([cx + 6, cy + 12, cx + 10, cy + 16], fill=PAL["cheek"])
    elif facing in ("left", "right"):
        side = -1 if facing == "left" else 1
        d.ellipse([cx + side * 6 - 2, cy + 9, cx + side * 6 + 2, cy + 13], fill=PAL["eye"])
    # 'up' : pas de visage (on voit l'arriere de la capuche)


def build_frame(facing):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    staff_side = "right" if facing != "left" else "left"
    if facing == "right":
        staff_side = "right"
    elif facing == "left":
        staff_side = "left"
    draw_body(d, facing)
    draw_head(d, facing)
    draw_staff(d, staff_side)
    return img


def main():
    frames = {f: build_frame(f) for f in ["down", "left", "right", "up"]}

    scale = 4
    pad = 14
    label_h = 20
    cell_w, cell_h = W * scale, H * scale + label_h
    sheet = Image.new("RGBA", (cell_w * 4 + pad * 5, cell_h + pad * 2), (124, 92, 138, 255))
    d = ImageDraw.Draw(sheet)

    labels = {"down": "bas (face)", "left": "gauche", "right": "droite", "up": "haut (dos)"}
    for i, key in enumerate(["down", "left", "right", "up"]):
        frame = frames[key].resize((W * scale, H * scale), Image.NEAREST)
        x = pad + i * (cell_w + pad)
        y = pad
        sheet.paste(frame, (x, y), frame)
        tw = d.textlength(labels[key])
        d.text((x + (cell_w - tw) / 2, y + H * scale + 2), labels[key], fill=(255, 255, 255, 255))

    sheet.save("/mnt/user-data/outputs/berger-preview.png")
    print("saved /mnt/user-data/outputs/berger-preview.png", sheet.size)


if __name__ == "__main__":
    main()
