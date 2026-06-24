# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Installer les dépendances (express, cors)
npm start            # Démarrer le serveur (http://localhost:3000)
npm run dev          # Démarrer avec auto-reload (node --watch, Node.js ≥18 intégré, pas de nodemon)
```

Ouvrir directement `index.html` dans le navigateur fonctionne aussi (sans backend — le cart et les filtres fonctionnent, les API `/api/*` non).

## Variables d'environnement

| Variable | Défaut | Usage |
|----------|--------|-------|
| `PORT` | `3000` | Port du serveur Express |
| `ADMIN_KEY` | `changeme` | Clé pour `POST /api/admin/products` et `GET /api/orders` — à changer en prod |
| `STRIPE_SECRET_KEY` | — | Requis pour activer `POST /api/checkout` (voir TODO dans `server.js`) |
| `DOMAIN` | — | URL de base pour les redirect Stripe (`success_url`, `cancel_url`) |

## Architecture

**Frontend only** — Vanilla HTML5 / CSS3 / JS (pas de framework). Chaque page est un fichier `.html` autonome qui inclut la navbar, le drawer panier, et `<script src="js/app.js">`.

```
index.html          ← Page d'accueil : carousel hero + 3 slides catégorie
plaisir.html        ← Catégorie Plaisir (Made in France + Bon affaire)
malin.html          ← Catégorie Malin (gadgets TikTok)
bebe.html           ← Catégorie Bébé (Vinted + Leboncoin)
css/style.css       ← Toutes les règles CSS (global + 3 thèmes)
js/app.js           ← Carousel, Cart (localStorage), Filters, Navbar
server.js           ← Express : fichiers statiques + /api/*
```

## Thèmes visuels (CSS custom properties dans style.css)

| Catégorie | Variable principale | Couleurs |
|-----------|--------------------|----|
| Plaisir | `--plaisir-1/2/g` | Bleu tricolore, rouge, or |
| Malin | `--malin-1/2/3` | Neon pink, cyan, violet |
| Bébé | `--bebe-1/2/3` | Rose pastel, bleu bébé, menthe |

Les pages catégorie se thèment via `<body class="page-plaisir|malin|bebe">`. Les classes CSS `.page-X` s'appliquent automatiquement aux couleurs des prix, boutons et filtres actifs.

## Panier

Stocké dans `localStorage` sous la clé `leclam_cart`. L'objet `Cart` est exposé globalement (`window.Cart`). Les boutons "Ajouter" appellent `addToCart(this)` (également global) qui lit `data-id`, `data-price` et l'emoji depuis le DOM de la `.p-card`.

## Ajouter un produit

Les produits sont définis à **deux endroits** qui doivent rester synchronisés :
1. **HTML** (`plaisir.html`, `malin.html`, etc.) — copier une `.p-card` existante et ajuster `data-id`, `data-price`, `data-filter`
2. **`server.js → PRODUCTS[category]`** — ajouter l'objet produit correspondant pour l'API

Attributs `.p-card` :
- `data-id` — unique (ex: `plaisir-7`)
- `data-price` — prix en décimal (ex: `19.90`)
- `data-filter` — tags séparés par virgule correspondant aux `data-filter` des `.f-btn`

## Ajouter un filtre

Dans le HTML de la page catégorie, ajouter un `<button class="f-btn" data-filter="mon-filtre">`. Sur chaque `.p-card` filtrée, ajouter `mon-filtre` dans `data-filter` (liste séparée par virgules).

## Intégrations dropshipping (TODO)

- **Plaisir / Malin** → DSers (successeur d'Oberlo) : voir les commentaires `// TODO DROPSHIPPING` dans `server.js`. Endpoint DSers : `GET https://openapi.dsers.com/openapi/v1/product/list`.
- **Bébé** → Vinted et Leboncoin n'ont pas d'API publique. Import manuel via `POST /api/admin/products` (protégé par `adminKey`). Voir le commentaire dans `server.js` et `bebe.html`.
- **Paiement** → Stripe : voir le commentaire `// TODO: Intégration Stripe` dans `server.js → POST /api/checkout`.
