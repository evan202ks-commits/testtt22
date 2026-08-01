# Assets — architecture modulaire

Toute la couche graphique se pilote depuis **`manifest.json`** (ce
dossier). Le moteur ne connaît aucun nom de fichier ni aucune valeur en
dur : il lit ce manifeste au démarrage, puis les manifestes de second
niveau qu'il référence (`animations/*.json`, `tilesets/tilesets.json`,
`vfx/vfx.json`, `icons/icons.json`). **Ajouter une ressource = déposer
le(s) fichier(s) ici + éditer le JSON correspondant.** Aucune ligne de
moteur à modifier.

Les assets actuellement livrés sont des **placeholders générés par
code** (voir `/tools/gen_character_sheets.py` et
`/tools/gen_world_textures.py`, à la racine du projet) — pas de l'art
fait main. L'architecture est faite pour qu'un vrai pack (acheté,
commandé, ou dessiné) les remplace directement.

## Ajouter un nouveau personnage (skin)

1. Fournir 6 feuilles de sprites PNG, une par animation
   (`idle`, `walk`, `run`, `interact`, `harvest`, `attack`), au format
   `<prefix>-<animation>.png`. Grille : 4 lignes (`down`, `left`,
   `right`, `up`) × N colonnes (une par frame), toutes les frames à la
   même taille (voir `frameSize` dans le manifeste d'animation).
2. Les déposer dans `sprites/characters/`.
3. Créer `animations/<prefix>.json` (copier `animations/hero-default.json`
   et ajuster `frames`/`fps`/`loop` par état si besoin).
4. Ajouter une entrée dans `manifest.json` → `characters`, et changer
   `activeCharacterSkin` pour l'utiliser (ou l'exposer plus tard dans un
   sélecteur de personnage côté UI).

## Ajouter/remplacer un tileset

Déposer le PNG (idéalement *seamless*/tileable) dans `tilesets/`, puis
ajouter une entrée dans `tilesets/tilesets.json` (`file` + `tileWorldSize`
= taille en unités monde à laquelle la texture se répète). Pour une
texture animée (comme l'eau), utiliser `frames: [...]` + `fps` au lieu
de `file`.

## Ajouter un effet visuel (vfx)

Déposer le PNG (texture de particule, fond transparent) dans `vfx/`,
l'ajouter dans `vfx.json`.

## Icônes d'inventaire

Le sac utilise des emoji par défaut (aucune dépendance à un fichier,
et ça n'a aucun impact sur les données sauvegardées du joueur). Pour un
pack d'icônes personnalisé, voir `icons/icons.json`.

## Plusieurs thèmes graphiques

`manifest.json` a un champ `theme` : rien n'empêche de dupliquer ce
dossier (`assets-theme-hiver/`, etc.) et de pointer le moteur vers l'un
ou l'autre au démarrage pour changer complètement d'ambiance sans
toucher au code.
