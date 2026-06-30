#!/usr/bin/env python3
"""
crop_products.py — Extraction automatique de produits depuis des captures d'écran.

Utilisation :
  python3 scripts/crop_products.py              # traite tous les screenshots du projet
  python3 scripts/crop_products.py --all        # idem (explicite)
  python3 scripts/crop_products.py <fichier.png> [...]
  python3 scripts/crop_products.py <dossier> [...]
  python3 scripts/crop_products.py --overwrite  # réécrit les crops existants
  python3 scripts/crop_products.py --dry-run    # simule sans écrire
"""

import os, sys, glob, argparse
import numpy as np
from PIL import Image

# ── Configuration ─────────────────────────────────────────────────────────────
MARGIN          = 0.15   # Marge ajoutée autour du produit détecté (15 %)
JPEG_QUALITY    = 92
WHITE_DIFF      = 25     # Seuil (0-255) : pixel considéré non-blanc si diff > seuil
ROW_BLANK_RATIO = 0.02   # Ligne considérée "blanche" si < 2 % pixels non-blancs
COL_BLANK_RATIO = 0.03   # Colonne considérée "blanche" si < 3 %
MIN_SPAN_PX     = 40     # Plage minimale pour être considérée comme du contenu
MIN_AREA_RATIO  = 0.02   # Candidat valide si ≥ 2 % de l'image
SMALL_IMG_PX    = 1000   # Image < 1000 px = produit déjà isolé


# ── Utilitaires image ─────────────────────────────────────────────────────────

def to_rgb_white_bg(arr):
    """Convertit RGBA ou RGB → RGB avec fond blanc pour les zones transparentes."""
    if arr.ndim == 3 and arr.shape[2] == 4:
        a = arr[:, :, 3:4].astype(np.float32) / 255.0
        return (arr[:, :, :3].astype(np.float32) * a + 255.0 * (1 - a)).clip(0, 255).astype(np.uint8)
    return arr[:, :, :3].copy()


def content_mask(rgb):
    """Masque booléen : True là où le pixel diffère du blanc."""
    return np.max(np.abs(rgb.astype(np.int32) - 255), axis=2) > WHITE_DIFF


def find_spans(profile, blank_thresh, min_span):
    """Trouve les plages consécutives non-blanches dans un profil 1D."""
    spans = []
    in_span = False
    start = 0
    for i, v in enumerate(profile):
        if v >= blank_thresh and not in_span:
            start = i
            in_span = True
        elif v < blank_thresh and in_span:
            if i - start >= min_span:
                spans.append((start, i - 1))
            in_span = False
    if in_span and len(profile) - start >= min_span:
        spans.append((start, len(profile) - 1))
    return spans


def tight_bbox(mask_2d):
    """Bounding-box serrée des pixels True dans un masque 2D."""
    rows = np.any(mask_2d, axis=1)
    cols = np.any(mask_2d, axis=0)
    if not rows.any() or not cols.any():
        return None
    row_idx = np.where(rows)[0]; r1, r2 = int(row_idx[0]), int(row_idx[-1])
    col_idx = np.where(cols)[0]; c1, c2 = int(col_idx[0]), int(col_idx[-1])
    return c1, r1, c2, r2


def add_margin(x1, y1, x2, y2, W, H, margin=MARGIN):
    """Ajoute une marge proportionnelle, clampée aux bords de l'image."""
    pw, ph = x2 - x1, y2 - y1
    # Marge basée sur la plus grande dimension pour rester cohérente
    m = int(max(pw, ph) * margin)
    return (
        max(0, x1 - m),
        max(0, y1 - m),
        min(W, x2 + m),
        min(H, y2 + m),
    )


# ── Détection ─────────────────────────────────────────────────────────────────

def detect_products(img_path, is_product_photo=False):
    """
    Détecte les bounding-boxes des produits dans une capture d'écran.

    is_product_photo=True : l'image est déjà une photo de produit isolée (img_01, etc.)
                            → on utilise directement le chemin "petite image".

    Retourne :
        (boxes, status)
        boxes  : liste de (x1, y1, x2, y2) en coordonnées pixels originales
        status : 'ok' | 'small_image' | 'uncertain' | 'no_detection'
    """
    img = Image.open(img_path)
    arr = np.array(img)
    H, W = arr.shape[:2]
    rgb  = to_rgb_white_bg(arr)
    mask = content_mask(rgb)

    # ── Cas simple : petite image OU photo produit déjà isolée ─────────────
    if is_product_photo or max(H, W) < SMALL_IMG_PX:
        bbox = tight_bbox(mask)
        if bbox:
            x1, y1, x2, y2 = bbox
        else:
            x1, y1, x2, y2 = 0, 0, W, H
        return [(x1, y1, x2, y2)], 'small_image'

    # ── Détection par séparateurs de blancs ────────────────────────────────
    row_profile = mask.mean(axis=1)
    row_spans   = find_spans(row_profile, ROW_BLANK_RATIO, MIN_SPAN_PX)

    candidates = []
    for r1, r2 in row_spans:
        zone_mask  = mask[r1:r2 + 1, :]
        col_profile = zone_mask.mean(axis=0)
        col_spans  = find_spans(col_profile, COL_BLANK_RATIO, MIN_SPAN_PX)

        for c1, c2 in col_spans:
            pw = c2 - c1
            ph = r2 - r1
            area_ratio = (pw * ph) / (W * H)
            if area_ratio < MIN_AREA_RATIO:
                continue
            # Rejeter les bandeaux trop aplatis (navbar, footer plein-écran)
            aspect = min(pw, ph) / max(pw, ph) if max(pw, ph) > 0 else 0
            if aspect < 0.18:
                continue
            # Rejeter les blocs qui couvrent presque toute la largeur (en-têtes)
            if pw > W * 0.82:
                continue

            density = float(zone_mask[:, c1:c2 + 1].mean())
            ratio   = min(pw, ph) / max(pw, ph) if max(pw, ph) > 0 else 0

            # Position : léger bonus pour les candidats dans le haut de la page
            center_y_norm = (r1 + r2) / 2 / H
            position_bonus = 1.0 - center_y_norm * 0.4

            score = area_ratio * density * (0.4 + 0.6 * ratio) * position_bonus

            candidates.append({
                'x1': c1, 'y1': r1, 'x2': c2, 'y2': r2,
                'pw': pw, 'ph': ph, 'density': density,
                'ratio': ratio, 'score': score,
            })

    if not candidates:
        return [], 'no_detection'

    candidates.sort(key=lambda c: -c['score'])
    top_score = candidates[0]['score']

    # ── Sélection des produits non-redondants ──────────────────────────────
    # Le 1er candidat est toujours retenu.
    # Les suivants ne sont acceptés que s'ils ressemblent à de vraies images de produit
    # (densité élevée = image photo, pas du texte) et ont un score comparable.
    MIN_DENSITY_EXTRA = 0.40   # densité min pour un produit supplémentaire
    MIN_SCORE_RATIO   = 0.35   # score min = 35 % du meilleur candidat
    MIN_SIZE_RATIO    = 0.55   # taille min = 55 % du produit principal (grilles similaires)

    top_area = candidates[0]['pw'] * candidates[0]['ph']

    selected = []
    for i, cand in enumerate(candidates):
        if i == 0:
            selected.append(cand)
            continue
        # Filtres pour les candidats supplémentaires
        if cand['density'] < MIN_DENSITY_EXTRA:
            continue
        if cand['score'] < top_score * MIN_SCORE_RATIO:
            continue
        # Les produits supplémentaires doivent être de taille comparable au principal
        cand_area = cand['pw'] * cand['ph']
        if cand_area < top_area * MIN_SIZE_RATIO:
            continue
        # Vérifier qu'il ne chevauche pas un candidat déjà sélectionné
        cx = (cand['x1'] + cand['x2']) / 2
        cy = (cand['y1'] + cand['y2']) / 2
        overlaps = False
        for sel in selected:
            sx = (sel['x1'] + sel['x2']) / 2
            sy = (sel['y1'] + sel['y2']) / 2
            dist = ((cx - sx) ** 2 + (cy - sy) ** 2) ** 0.5
            if dist < (cand['pw'] + sel['pw']) / 3:
                overlaps = True
                break
        if not overlaps:
            selected.append(cand)
        if len(selected) >= 4:
            break

    # ── Bounding-box serrée dans chaque région retenue ────────────────────
    boxes = []
    for cand in selected:
        sub = mask[cand['y1']:cand['y2'] + 1, cand['x1']:cand['x2'] + 1]
        t   = tight_bbox(sub)
        if t:
            tx1, ty1, tx2, ty2 = t
            box = (cand['x1'] + tx1, cand['y1'] + ty1,
                   cand['x1'] + tx2, cand['y1'] + ty2)
        else:
            box = (cand['x1'], cand['y1'], cand['x2'], cand['y2'])
        boxes.append(box)

    best   = candidates[0]
    status = 'ok' if best['density'] > 0.25 and best['ratio'] > 0.35 else 'uncertain'
    return boxes, status


# ── Traitement d'un fichier ────────────────────────────────────────────────────

def process(src_path, out_path=None, overwrite=False, dry_run=False, single=False, is_product_photo=False):
    """
    Détecte et enregistre le(s) crop(s) d'un screenshot.
    single=True : toujours un seul fichier de sortie (out_path), pas de numérotation.
    Retourne True (succès), False (échec détection) ou 'skip' (déjà traité).
    """
    if out_path is None:
        base = os.path.splitext(src_path)[0]
        out_path = base + '_crop.jpg'

    # Vérification skip (pour un seul produit attendu)
    if not overwrite and os.path.exists(out_path):
        name = os.path.relpath(out_path)
        print(f"  IGNORÉ (existe déjà) : {name}")
        return 'skip'

    try:
        boxes, status = detect_products(src_path, is_product_photo=is_product_photo)
    except Exception as e:
        print(f"  ERREUR LECTURE : {os.path.basename(src_path)} — {e}")
        return False

    if not boxes:
        print(f"  ⚠ AUCUN PRODUIT DÉTECTÉ : {os.path.basename(src_path)}")
        return False

    if status == 'uncertain':
        print(f"  ⚠ DÉTECTION INCERTAINE (crop large conservé) : {os.path.basename(src_path)}")

    # Charger l'image en RGB pour la sauvegarde
    img  = Image.open(src_path)
    arr  = np.array(img)
    H, W = arr.shape[:2]
    rgb  = to_rgb_white_bg(arr)
    img_rgb = Image.fromarray(rgb)

    saved_any = False
    for i, (x1, y1, x2, y2) in enumerate(boxes):
        x1m, y1m, x2m, y2m = add_margin(x1, y1, x2, y2, W, H)
        crop = img_rgb.crop((x1m, y1m, x2m, y2m))

        if len(boxes) > 1 and not single:
            stem, ext = os.path.splitext(out_path)
            dest = f"{stem}_{i + 1}{ext}"
        else:
            dest = out_path

        if not dry_run:
            crop.save(dest, 'JPEG', quality=JPEG_QUALITY)

        pw, ph = x2 - x1, y2 - y1
        m = int(max(pw, ph) * MARGIN)
        tag = 'DRY-RUN' if dry_run else 'ENREGISTRÉ'
        print(f"  {tag} : {os.path.basename(dest)}  "
              f"({crop.size[0]}×{crop.size[1]} px)  "
              f"[produit {pw}×{ph} px + marge ±{m} px, status={status}]")
        saved_any = True

    return saved_any


# ── Point d'entrée ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Extraction automatique de produits depuis des captures d'écran"
    )
    parser.add_argument('paths', nargs='*',
                        help='Fichiers .png ou dossiers à traiter (défaut : tout le projet)')
    parser.add_argument('--all', '-a', action='store_true',
                        help='Traiter tous les screenshots du projet')
    parser.add_argument('--overwrite', '-f', action='store_true',
                        help='Écraser les crops existants')
    parser.add_argument('--dry-run', '-n', action='store_true',
                        help='Simuler sans écrire de fichiers')
    args = parser.parse_args()

    # Résolution des fichiers sources
    script_dir = os.path.dirname(os.path.abspath(__file__))
    public_dir = os.path.join(script_dir, '..', 'public')

    # Construire la liste (src, out, single) à traiter
    # Convention 1 : Capture d'écran*.png  → *_crop.jpg       (multi-produit possible)
    # Convention 2 : product-1.png         → photo_produit.jpg (1 seule sortie)
    # Convention 3 : img_01.jpg/.webp      → photo_produit.jpg (1 seule sortie, photo isolée)
    # Tuple : (src, out, single, is_product_photo)

    def collect_tasks(root):
        t = []
        # Captures d'écran
        for f in glob.glob(os.path.join(root, '**', 'Capture*.png'), recursive=True):
            if '_crop' not in f:
                t.append((f, os.path.splitext(f)[0] + '_crop.jpg', False, False))
        # product-1.png  (screenshot de page, même traitement que Capture)
        for f in glob.glob(os.path.join(root, '**', 'product-1.png'), recursive=True):
            t.append((f, os.path.join(os.path.dirname(f), 'photo_produit.jpg'), True, False))
        # img_01.jpg / img_01.webp : déjà une photo produit isolée
        for pat in ('**/img_01.jpg', '**/img_01.webp', '**/img_01.jpeg'):
            for f in glob.glob(os.path.join(root, pat), recursive=True):
                t.append((f, os.path.join(os.path.dirname(f), 'photo_produit.jpg'), True, True))
        return t

    tasks = []  # liste de (src_path, out_path, single)

    if args.all or not args.paths:
        tasks = collect_tasks(public_dir)
        print(f"Projet : {len(tasks)} images sources trouvées\n")
    else:
        for p in args.paths:
            if os.path.isdir(p):
                tasks.extend(collect_tasks(p))
            elif os.path.isfile(p):
                name = os.path.basename(p)
                if name == 'product-1.png':
                    tasks.append((p, os.path.join(os.path.dirname(p), 'photo_produit.jpg'), True, False))
                elif name.startswith('img_01'):
                    tasks.append((p, os.path.join(os.path.dirname(p), 'photo_produit.jpg'), True, True))
                else:
                    tasks.append((p, None, False, False))
            else:
                print(f"Chemin introuvable : {p}", file=sys.stderr)

    if not tasks:
        print("Aucun fichier à traiter.")
        return

    n_ok = n_fail = n_skip = 0
    for src, out, single, is_pp in tasks:
        label = os.path.basename(os.path.dirname(src))
        print(f"{label}")
        result = process(src, out_path=out, overwrite=args.overwrite, dry_run=args.dry_run,
                         single=single, is_product_photo=is_pp)
        if result == 'skip':
            n_skip += 1
        elif result:
            n_ok += 1
        else:
            n_fail += 1
        print()

    print('─' * 60)
    print(f"Résultat : {n_ok} crop(s) enregistré(s)  "
          f"{n_fail} échec(s)  {n_skip} ignoré(s)")
    if n_fail:
        print("→ Vérifiez les captures signalées ⚠ et recadrez-les manuellement.")


if __name__ == '__main__':
    main()
