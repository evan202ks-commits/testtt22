#!/usr/bin/env python3
"""
tools/gen_world_textures.py
----------------------------------------------------------------------
Génère les textures PLACEHOLDER du monde : tilesets (herbe/chemin/eau/
sable/pierre, seamless), une planche de flore 2D (herbes/fleurs/buisson,
billboards) et des textures de particules (feuille, pluie, poussière).
Toutes tileables via un dessin "wrap" (chaque motif est aussi dessiné
décalé de ±largeur/±hauteur pour ne jamais laisser de coupure visible).
"""
import random
import math
from PIL import Image, ImageDraw, ImageFilter

random.seed(7)


def new_tileable(size, base_color):
    img = Image.new("RGBA", (size, size), base_color)
    return img, ImageDraw.Draw(img)


def wrapped(draw_fn, x, y, size):
    for dx in (-size, 0, size):
        for dy in (-size, 0, size):
            draw_fn(x + dx, y + dy)


def gen_grass(path, size=256, base=(110, 179, 92, 255), blade_dark=(84, 148, 68, 255), blade_light=(140, 201, 110, 255), flowers=None):
    img, d = new_tileable(size, base)
    # variation douce du fond (grandes taches légèrement plus sombres)
    for _ in range(26):
        x, y = random.uniform(0, size), random.uniform(0, size)
        r = random.uniform(14, 30)
        c = (blade_dark[0], blade_dark[1], blade_dark[2], 35)
        wrapped(lambda cx, cy: d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c), x, y, size)
    # brins d'herbe (petits traits)
    for _ in range(int(size * size / 340)):
        x, y = random.uniform(0, size), random.uniform(0, size)
        h = random.uniform(4, 8)
        lean = random.uniform(-2, 2)
        col = blade_dark if random.random() < 0.55 else blade_light
        wrapped(lambda cx, cy, h=h, lean=lean, col=col: d.line([cx, cy, cx + lean, cy - h], fill=col, width=2), x, y, size)
    if flowers:
        for _ in range(flowers[1]):
            x, y = random.uniform(0, size), random.uniform(0, size)
            col = random.choice(flowers[0])
            wrapped(lambda cx, cy, col=col: _flower_dot(d, cx, cy, col), x, y, size)
    img = img.filter(ImageFilter.SMOOTH_MORE)
    img.save(path)
    print(" ", path)


def _flower_dot(d, x, y, col):
    for a in range(5):
        ang = a / 5 * math.pi * 2
        px, py = x + math.cos(ang) * 3, y + math.sin(ang) * 3
        d.ellipse([px - 2, py - 2, px + 2, py + 2], fill=col)
    d.ellipse([x - 1.6, y - 1.6, x + 1.6, y + 1.6], fill=(255, 224, 120, 255))


def gen_path(path, size=256):
    img, d = new_tileable(size, (196, 164, 118, 255))
    for _ in range(int(size * size / 90)):
        x, y = random.uniform(0, size), random.uniform(0, size)
        r = random.uniform(1.4, 3.6)
        shade = random.uniform(-24, 20)
        col = tuple(max(0, min(255, c + int(shade))) for c in (176, 142, 96)) + (255,)
        wrapped(lambda cx, cy, r=r, col=col: d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col), x, y, size)
    img = img.filter(ImageFilter.SMOOTH)
    img.save(path)
    print(" ", path)


def gen_water(path, size=256, phase=0.0):
    img, d = new_tileable(size, (74, 148, 189, 255))
    for i in range(10):
        y0 = (i / 10) * size + math.sin(phase + i) * 6
        col = (150, 210, 232, 90) if i % 2 == 0 else (54, 118, 158, 90)
        wrapped(lambda cx, cy, col=col: d.line([cx - 40, cy, cx + 40, cy + 8], fill=col, width=5), size / 2, y0 % size, size)
    for _ in range(14):
        x, y = random.uniform(0, size), random.uniform(0, size)
        r = random.uniform(2, 5)
        wrapped(lambda cx, cy, r=r: d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 60)), x, y, size)
    img = img.filter(ImageFilter.SMOOTH_MORE)
    img.save(path)
    print(" ", path)


def gen_sand(path, size=256):
    img, d = new_tileable(size, (230, 205, 156, 255))
    for _ in range(int(size * size / 70)):
        x, y = random.uniform(0, size), random.uniform(0, size)
        r = random.uniform(1, 2.4)
        shade = random.choice([-18, -8, 10, 18])
        col = tuple(max(0, min(255, c + shade)) for c in (230, 205, 156)) + (255,)
        wrapped(lambda cx, cy, r=r, col=col: d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col), x, y, size)
    img.save(path)
    print(" ", path)


def gen_stone(path, size=256):
    img, d = new_tileable(size, (176, 172, 176, 255))
    for _ in range(30):
        x, y = random.uniform(0, size), random.uniform(0, size)
        w, h = random.uniform(18, 40), random.uniform(14, 30)
        shade = random.choice([-14, -6, 8])
        col = tuple(max(0, min(255, c + shade)) for c in (176, 172, 176)) + (255,)
        wrapped(lambda cx, cy, w=w, h=h, col=col: d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=6, outline=(150, 146, 150, 255), width=2, fill=col), x, y, size)
    img.save(path)
    print(" ", path)


def gen_flora_sheet(path, cell=48):
    names = ["grass-tuft", "flower-red", "flower-yellow", "flower-white", "bush"]
    img = Image.new("RGBA", (cell * len(names), cell), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, name in enumerate(names):
        ox = i * cell + cell / 2
        base_y = cell - 8
        if name == "grass-tuft":
            for k in range(5):
                a = (k - 2) * 0.28
                x0 = ox + a * 10
                d.line([x0, base_y, x0 + a * 6, base_y - 22 - abs(a) * 6], fill=(96, 168, 82, 255), width=4)
        elif name.startswith("flower-"):
            color = {"flower-red": (224, 90, 96, 255), "flower-yellow": (240, 196, 74, 255), "flower-white": (250, 248, 240, 255)}[name]
            d.line([ox, base_y, ox, base_y - 16], fill=(96, 158, 84, 255), width=3)
            for k in range(6):
                ang = k / 6 * math.pi * 2
                px, py = ox + math.cos(ang) * 6, base_y - 16 + math.sin(ang) * 6
                d.ellipse([px - 4, py - 4, px + 4, py + 4], fill=color)
            d.ellipse([ox - 3, base_y - 19, ox + 3, base_y - 13], fill=(240, 196, 74, 255))
        elif name == "bush":
            for k in range(4):
                a = (k - 1.5) * 8
                r = 12 - abs(a) * 0.3
                d.ellipse([ox + a - r, base_y - r * 1.3, ox + a + r, base_y - r * 1.3 + r * 2], fill=(88, 150, 78, 255))
    img.save(path)
    print(" ", path, "cells:", names)
    return names, cell


def gen_leaf(path, size=32, color=(214, 122, 58, 255)):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([6, 4, size - 6, size - 10], fill=color)
    d.line([size / 2, 4, size / 2, size - 10], fill=(120, 70, 34, 255), width=1)
    img.save(path)
    print(" ", path)


def gen_raindrop(path, w=6, h=26):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line([w / 2, 0, w / 2, h], fill=(190, 220, 240, 170), width=2)
    img.save(path)
    print(" ", path)


def gen_dust(path, size=32):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for r, a in [(size / 2, 40), (size / 3, 90), (size / 6, 180)]:
        d.ellipse([size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r], fill=(255, 246, 214, a))
    img = img.filter(ImageFilter.GaussianBlur(2))
    img.save(path)
    print(" ", path)


if __name__ == "__main__":
    import sys
    tilesets_dir = sys.argv[1] if len(sys.argv) > 1 else "public/assets/tilesets"
    vfx_dir = sys.argv[2] if len(sys.argv) > 2 else "public/assets/vfx"

    print("Tilesets:")
    gen_grass(f"{tilesets_dir}/grass.png")
    gen_grass(f"{tilesets_dir}/grass-meadow.png", base=(140, 196, 104, 255),
              flowers=([(224, 90, 96, 255), (240, 196, 74, 255), (250, 248, 240, 255)], 10))
    gen_grass(f"{tilesets_dir}/grass-forest.png", base=(84, 150, 96, 255), blade_dark=(58, 112, 70, 255), blade_light=(112, 168, 118, 255))
    gen_path(f"{tilesets_dir}/dirt-path.png")
    gen_sand(f"{tilesets_dir}/sand.png")
    gen_stone(f"{tilesets_dir}/stone.png")
    for i in range(3):
        gen_water(f"{tilesets_dir}/water-{i}.png", phase=i * 1.4)

    print("Flore (billboards) :")
    gen_flora_sheet(f"{tilesets_dir}/flora.png")

    print("VFX :")
    gen_leaf(f"{vfx_dir}/leaf.png")
    gen_raindrop(f"{vfx_dir}/raindrop.png")
    gen_dust(f"{vfx_dir}/dust.png")
