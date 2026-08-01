#!/usr/bin/env python3
"""
tools/gen_character_sheets.py
----------------------------------------------------------------------
Génère des feuilles de sprites PLACEHOLDER pour le personnage (silhouette
chibi simple, dessinée par code) — pas de l'art fait main, mais de vrais
fichiers PNG chargés par le moteur exactement comme le seraient de
futurs sprites professionnels (voir public/assets/manifest.json).

Convention : un fichier PNG par état d'animation, grille de
4 lignes (directions : down, left, right, up) x N colonnes (frames).
"""
import math
from PIL import Image, ImageDraw

FRAME_W, FRAME_H = 64, 64
DIRECTIONS = ["down", "left", "right", "up"]

# Palette par défaut du skin "hero-default" (chaude, cohérente avec
# l'ambiance cosy demandée). Une future skin = une nouvelle palette +
# un nouvel appel à render_sheet, déclaré dans le manifeste.
PALETTE = {
    "skin": (247, 200, 164, 255),
    "skin_shade": (222, 168, 132, 255),
    "hair": (109, 68, 45, 255),
    "tunic": (79, 158, 110, 255),
    "tunic_shade": (58, 122, 84, 255),
    "pants": (91, 74, 130, 255),
    "shoes": (63, 48, 40, 255),
    "outline": (43, 33, 40, 255),
}


def ellipse(draw, cx, cy, rx, ry, fill):
    draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill)


def draw_limb(draw, x, y, w, h, fill):
    draw.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], radius=w * 0.4, fill=fill)


def draw_character(direction, pose, palette=PALETTE):
    """pose: dict d'offsets (voir animations plus bas). Retourne une Image RGBA 64x64."""
    img = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    base_x, base_y = 32, 46
    body_dy = pose.get("body_dy", 0)
    head_dy = pose.get("head_dy", 0) + body_dy
    crouch = pose.get("crouch", 0)
    leg_l_dx = pose.get("leg_l_dx", 0)
    leg_r_dx = pose.get("leg_r_dx", 0)
    arm_l = pose.get("arm_l", (0, 0))
    arm_r = pose.get("arm_r", (0, 0))
    facing_dx = {"down": 0, "up": 0, "left": -1, "right": 1}[direction]

    hip_y = base_y - 10 + crouch * 6
    shoulder_y = base_y - 22 + body_dy + crouch * 4
    head_y = base_y - 30 + head_dy + crouch * 3

    # --- jambes ---
    draw_limb(d, base_x - 6 + leg_l_dx, hip_y + 9, 8, 14, palette["pants"])
    draw_limb(d, base_x + 6 + leg_r_dx, hip_y + 9, 8, 14, palette["pants"])
    ellipse(d, base_x - 6 + leg_l_dx, hip_y + 16, 5, 3.4, palette["shoes"])
    ellipse(d, base_x + 6 + leg_r_dx, hip_y + 16, 5, 3.4, palette["shoes"])

    # --- bras (dessinés avant le corps pour rester légèrement dessous) ---
    for side, (adx, ady) in (("l", arm_l), ("r", arm_r)):
        sx = base_x + (-11 if side == "l" else 11) + facing_dx * 2
        sy = shoulder_y + 2
        ex, ey = sx + adx, sy + ady + 10
        d.line([sx, sy, ex, ey], fill=palette["tunic_shade"], width=7)
        ellipse(d, ex, ey, 3.6, 3.6, palette["skin"])

    # --- torse ---
    torso_w = 17 if direction in ("down", "up") else 14
    d.rounded_rectangle(
        [base_x - torso_w / 2, shoulder_y - 2, base_x + torso_w / 2, hip_y + 8],
        radius=7, fill=palette["tunic"],
    )
    d.rounded_rectangle(
        [base_x - torso_w / 2, hip_y - 2, base_x + torso_w / 2, hip_y + 8],
        radius=6, fill=palette["tunic_shade"],
    )

    # --- tete ---
    head_r = 11
    hx = base_x + facing_dx * 1.5
    ellipse(d, hx, head_y, head_r, head_r, palette["skin"])

    # cheveux : calotte + mèche, plus couvrante de dos ("up")
    if direction == "up":
        ellipse(d, hx, head_y - 2, head_r + 1, head_r - 1, palette["hair"])
    else:
        d.pieslice([hx - head_r - 1, head_y - head_r - 3, hx + head_r + 1, head_y + head_r - 2],
                   180, 360, fill=palette["hair"])
        if direction in ("left", "right"):
            ellipse(d, hx + facing_dx * 6, head_y - 3, 4, 5, palette["hair"])

    # yeux (seulement quand on voit le visage)
    if direction == "down":
        ellipse(d, hx - 4, head_y + 1, 1.6, 2.0, palette["outline"])
        ellipse(d, hx + 4, head_y + 1, 1.6, 2.0, palette["outline"])
    elif direction in ("left", "right"):
        ellipse(d, hx + facing_dx * 5, head_y + 1, 1.6, 2.0, palette["outline"])

    return img


# ----------------------------------------------------------------------
# Poses -> séquences de frames par état d'animation. Chaque fonction
# reçoit l'index de frame (0..n-1) et le nombre total de frames, et
# retourne un dict de pose (voir draw_character).
# ----------------------------------------------------------------------

def anim_idle(i, n):
    t = i / n
    bob = math.sin(t * math.pi * 2) * 1.4
    return {"body_dy": bob, "head_dy": bob * 0.4, "arm_l": (-1, 2 + bob * 0.3), "arm_r": (1, 2 - bob * 0.3)}


def anim_walk(i, n, amp=4.5):
    t = i / n
    swing = math.sin(t * math.pi * 2)
    bob = abs(math.cos(t * math.pi * 2)) * 1.6
    return {
        "body_dy": -bob, "head_dy": -bob * 0.5,
        "leg_l_dx": swing * amp, "leg_r_dx": -swing * amp,
        "arm_l": (-swing * amp * 0.8, 3), "arm_r": (swing * amp * 0.8, 3),
    }


def anim_run(i, n):
    return anim_walk(i, n, amp=7.5)


def anim_interact(i, n):
    t = i / (n - 1) if n > 1 else 0
    raise_amt = math.sin(t * math.pi)  # 0 -> 1 -> 0
    return {"arm_r": (6, -6 * raise_amt + 3 * (1 - raise_amt)), "arm_l": (-2, 3), "body_dy": -raise_amt * 1.2}


def anim_harvest(i, n):
    t = i / (n - 1) if n > 1 else 0
    crouch = math.sin(t * math.pi)
    return {"crouch": crouch, "arm_r": (5, 6 * crouch), "arm_l": (-4, 5 * crouch), "body_dy": crouch * 2}


def anim_attack(i, n):
    t = i / (n - 1) if n > 1 else 0
    # wind-up (arrière) -> extension rapide -> retour
    swing = math.sin(t * math.pi) 
    ext = -1 + 2 * t
    return {"arm_r": (10 * ext, -4 * swing), "arm_l": (-3, 3), "body_dy": -swing * 1.5}


ANIMATIONS = {
    "idle": (anim_idle, 4, 6),
    "walk": (anim_walk, 6, 10),
    "run": (anim_run, 6, 14),
    "interact": (anim_interact, 4, 8),
    "harvest": (anim_harvest, 5, 8),
    "attack": (anim_attack, 4, 12),
}


def render_sheet(state_name, fn, frame_count, out_path, palette=PALETTE):
    sheet = Image.new("RGBA", (FRAME_W * frame_count, FRAME_H * len(DIRECTIONS)), (0, 0, 0, 0))
    for row, direction in enumerate(DIRECTIONS):
        for col in range(frame_count):
            pose = fn(col, frame_count)
            frame = draw_character(direction, pose, palette)
            sheet.paste(frame, (col * FRAME_W, row * FRAME_H), frame)
    sheet.save(out_path)
    print(f"  {out_path}  ({frame_count} frames x {len(DIRECTIONS)} directions)")


def generate_skin(skin_id, out_dir, palette=PALETTE):
    print(f"Skin '{skin_id}':")
    manifest_animations = {}
    for state_name, (fn, frame_count, fps) in ANIMATIONS.items():
        out_path = f"{out_dir}/{skin_id}-{state_name}.png"
        render_sheet(state_name, fn, frame_count, out_path, palette)
        manifest_animations[state_name] = {"frames": frame_count, "fps": fps, "loop": state_name not in ("interact", "harvest", "attack")}
    return manifest_animations


if __name__ == "__main__":
    import json, sys
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "public/assets/sprites/characters"
    anims = generate_skin("hero-default", out_dir)
    print(json.dumps({"frameSize": [FRAME_W, FRAME_H], "directions": DIRECTIONS, "animations": anims}, indent=2))
