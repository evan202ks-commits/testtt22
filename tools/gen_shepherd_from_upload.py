#!/usr/bin/env python3
"""
tools/gen_shepherd_from_upload.py
----------------------------------------------------------------------
Prend le sprite "berger" fourni par l'utilisateur (planche de 7 poses,
fond violet plein), détoure le fond, choisit une pose par direction
(down/left/right/up), et génère les 6 feuilles d'animation attendues
par le moteur (idle/walk/run/interact/harvest/attack) en appliquant de
simples transformations (bob, lean) à l'image fournie — le dessin
lui-même N'EST PAS modifié, seulement placé/animé.
"""
import math
from PIL import Image

SRC = "/mnt/user-data/uploads/1785583176702_image.png"
OUT_DIR = "public/assets/sprites/characters"
BG = (112, 68, 128)

FRAME_W, FRAME_H = 96, 128
DIRECTIONS = ["down", "left", "right", "up"]

# Cellule (colonne, ligne) dans la planche 4x2 fournie, par direction
# choisie, + bbox de contenu détectée (x0,y0,x1,y1) DANS la cellule.
CELL_W, CELL_H = 384, 512
POSE_FOR_DIRECTION = {
    "down": (0, 0, (114, 72, 383, 449)),   # rangée 1, image 1 : face, bâton main gauche
    "left": (0, 1, (151, 30, 383, 409)),   # rangée 2, image 1 : 3/4 dos-gauche
    "right": (2, 1, (106, 38, 348, 414)),  # rangée 2, image 3 : 3/4 dos-droite
    "up": (1, 1, (0, 33, 363, 413)),       # rangée 2, image 2 : dos complet
}

ANIMATIONS = {
    "idle": {"frames": 4, "fps": 5, "loop": True},
    "walk": {"frames": 6, "fps": 8, "loop": True},
    "run": {"frames": 6, "fps": 12, "loop": True},
    "interact": {"frames": 4, "fps": 8, "loop": False},
    "harvest": {"frames": 5, "fps": 8, "loop": False},
    "attack": {"frames": 4, "fps": 10, "loop": False},
}


def remove_background(img):
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    bg = BG
    thresh_hard = 18
    thresh_soft = 60
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            d = ((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2) ** 0.5
            if d < thresh_hard:
                px[x, y] = (r, g, b, 0)
            elif d < thresh_soft:
                factor = (d - thresh_hard) / (thresh_soft - thresh_hard)
                px[x, y] = (r, g, b, int(255 * factor))
    return img


def extract_pose(col, row, bbox):
    im = Image.open(SRC).convert("RGB")
    x0, y0, x1, y1 = bbox
    pad = 10
    crop_box = (
        col * CELL_W + max(0, x0 - pad),
        row * CELL_H + max(0, y0 - pad),
        col * CELL_W + min(CELL_W, x1 + pad),
        row * CELL_H + min(CELL_H, y1 + pad),
    )
    cell = im.crop(crop_box)
    cell = remove_background(cell)
    return cell


def fit_to_frame(img, w=FRAME_W, h=FRAME_H, bottom_margin=6):
    # échelle pour tenir dans le cadre (marge), aligné bas + centré horizontalement
    scale = min((w - 8) / img.width, (h - bottom_margin - 6) / img.height)
    new_size = (max(1, int(img.width * scale)), max(1, int(img.height * scale)))
    resized = img.resize(new_size, Image.LANCZOS)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    x = (w - resized.width) // 2
    y = h - bottom_margin - resized.height
    canvas.paste(resized, (x, y), resized)
    return canvas


def make_motion_frame(base, t, kind):
    """Transforme légèrement l'image de base (déjà cadrée) pour donner un
    minimum de vie sans redessiner : bob vertical +/- léger, et un
    'squash' pour les cycles de marche/course, un lean pour les actions."""
    w, h = base.size
    if kind in ("idle",):
        bob = math.sin(t * math.pi * 2) * 2
        squash = 1 + math.sin(t * math.pi * 2) * 0.01
    elif kind in ("walk", "run"):
        amp = 3 if kind == "walk" else 5
        bob = abs(math.sin(t * math.pi * 2)) * amp
        squash = 1 - abs(math.sin(t * math.pi * 2)) * (0.02 if kind == "walk" else 0.035)
    else:
        bob = 0
        squash = 1

    frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sh = max(1, int(h * squash))
    scaled = base.resize((w, sh), Image.LANCZOS)
    frame.paste(scaled, (0, h - sh - int(bob)), scaled)

    if kind in ("interact", "harvest", "attack"):
        lean = math.sin(t * math.pi) * (6 if kind != "harvest" else 4)
        frame = frame.transform(
            (w, h), Image.AFFINE, (1, 0, -lean * 0.15, 0, 1, 0), resample=Image.BICUBIC
        )
        if kind == "harvest":
            crouch = math.sin(t * math.pi) * 8
            ch = max(1, int(h - crouch))
            tmp = frame.resize((w, ch), Image.LANCZOS)
            frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            frame.paste(tmp, (0, h - ch), tmp)
    return frame


def build_state_sheet(state, cfg, base_frames):
    n = cfg["frames"]
    sheet = Image.new("RGBA", (FRAME_W * n, FRAME_H * len(DIRECTIONS)), (0, 0, 0, 0))
    for row, direction in enumerate(DIRECTIONS):
        base = base_frames[direction]
        for col in range(n):
            t = col / n
            frame = make_motion_frame(base, t, state)
            sheet.paste(frame, (col * FRAME_W, row * FRAME_H), frame)
    path = f"{OUT_DIR}/shepherd-{state}.png"
    sheet.save(path, optimize=True)
    print(" ", path, f"{n} frames x {len(DIRECTIONS)} directions")


def main():
    base_frames = {}
    for direction, (col, row, bbox) in POSE_FOR_DIRECTION.items():
        pose = extract_pose(col, row, bbox)
        base_frames[direction] = fit_to_frame(pose)
        base_frames[direction].save(f"{OUT_DIR}/_debug_{direction}.png")

    for state, cfg in ANIMATIONS.items():
        build_state_sheet(state, cfg, base_frames)


if __name__ == "__main__":
    main()
