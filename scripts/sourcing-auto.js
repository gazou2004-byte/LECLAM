#!/usr/bin/env node
/* Antoine — Sourcing automatique horaire
   1. Analyse du marché via Jina AI (lecture de pages tendances, sans clé API)
   2. Groq (Llama 3.3) sélectionne les 3 meilleurs produits pour Le Clam
   Sauvegarde dans sourcing-proposals.json */

const fs   = require('fs');
const path = require('path');

const SOURCING_PATH = path.join(__dirname, '../Le clam/data/sourcing-proposals.json');
const SUMMARY_PATH  = path.join(__dirname, '../.sourcing-summary');

/* ── Lecture d'une page web via Jina AI Reader (gratuit, sans clé) ── */
async function readPage(url) {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const text = await res.text();
    return text.slice(0, 4000);
  } catch {
    return '';
  }
}

const IMG_DIR = path.join(__dirname, '../Le clam/public/img/sourcing');
if (!require('fs').existsSync(IMG_DIR)) require('fs').mkdirSync(IMG_DIR, { recursive: true });

/* ── Trouve une URL d'image via Jina AI ── */
async function findImageUrl(nom, lien) {
  const sources = [];
  if (lien) sources.push(lien);
  sources.push(`https://s.jina.ai/${encodeURIComponent(nom + ' produit')}`);
  sources.push(`https://www.dsers.com/search/?q=${encodeURIComponent(nom)}`);
  sources.push(`https://fr.aliexpress.com/wholesale?SearchText=${encodeURIComponent(nom)}`);

  for (const src of sources) {
    try {
      const res = await fetch(`https://r.jina.ai/${src}`, {
        headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const matches = [...text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s"']+)\)/g)]
        .map(m => m[1])
        .filter(u => /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(u))
        .filter(u => !/logo|banner|avatar|placeholder|icon|flag|sprite|badge/i.test(u));
      if (matches[0]) return matches[0];
    } catch { /* continue */ }
  }
  return null;
}

/* ── Télécharge et sauvegarde localement ── */
async function downloadImage(url, id) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.google.com/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    const buf = Buffer.from(await r.arrayBuffer());
    const BAD_SIZES = new Set([12420, 10046, 14542]);
    if (buf.length < 5000 || BAD_SIZES.has(buf.length)) return null;
    const filePath = path.join(IMG_DIR, `${id}.${ext}`);
    fs.writeFileSync(filePath, buf);
    return `/img/sourcing/${id}.${ext}`;
  } catch { return null; }
}

async function findProductImage(nom, lien, id) {
  const url = await findImageUrl(nom, lien);
  if (!url) return null;
  const local = await downloadImage(url, id);
  if (local) { console.log(`  [image] ${nom} → ${local}`); return local; }
  console.log(`  [image] ${nom} → URL distante`);
  return url;
}

/* ── Recherche marché : lit plusieurs sources de tendances ── */
async function analyseMarche() {
  const mois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  console.log('[Antoine] Analyse du marché en cours…');

  const sources = await Promise.allSettled([
    readPage('https://www.aliexpress.com/gcp/300000512/wwplus-bestsellers'),
    readPage('https://trends.google.com/trending?geo=FR&hl=fr'),
    readPage('https://www.dsers.com/blog/best-dropshipping-products/'),
    readPage('https://www.tiktok.com/discover'),
  ]);

  const contenu = sources
    .filter(r => r.status === 'fulfilled' && r.value)
    .map((r, i) => {
      const labels = ['AliExpress bestsellers', 'Google Trends France', 'DSers tendances dropshipping', 'TikTok discover'];
      return `=== ${labels[i]} ===\n${r.value}`;
    })
    .join('\n\n');

  return contenu || `Données indisponibles — utilise tes connaissances des tendances ${mois} en France.`;
}

/* ── Appel Groq ── */
async function callGroq(prompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      max_tokens:  2048,
      temperature: 0.5,
      messages:    [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

function nextId(proposals, prefix) {
  const nums = proposals
    .filter(p => p.id && p.id.startsWith(prefix))
    .map(p => parseInt(p.id.replace(prefix, ''), 10))
    .filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return prefix + String(max + 1).padStart(2, '0');
}

function fixMarge(p) {
  const marge = Math.round((p.prixVente - p.prixFournisseur) / p.prixVente * 1000) / 10;
  return { ...p, marge };
}

function normaliseName(nom) {
  return nom.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY manquant');

  const raw       = JSON.parse(fs.readFileSync(SOURCING_PATH, 'utf8'));
  const proposals = raw.proposals;
  const now       = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const mois      = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const idP = nextId(proposals, 'src-p');
  const idM = nextId(proposals, 'src-m');
  const idB = nextId(proposals, 'src-b');

  const existingNames = proposals.map(p => p.nom).filter(Boolean).join(' | ');
  const existingNamesNorm = new Set(proposals.map(p => normaliseName(p.nom)));

  /* Analyse du marché */
  const marcheData = await analyseMarche();

  const prompt = `Tu es Antoine, responsable sourcing de Le Clam, e-commerce français (3 univers : Plaisir/bien-être intime, Malin/gadgets TikTok, Bébé/jouets seconde main).

DONNÉES MARCHÉ ACTUELLES (${mois}) :
${marcheData}

En te basant sur ces données de marché réelles, propose 3 produits à fort potentiel de vente en France maintenant (1 par univers).
Produits déjà au catalogue à NE PAS répéter : ${existingNames}

Critères :
- Marge ≥ 40% : (prixVente - prixFournisseur) / prixVente × 100
- Produit tendance visible dans les données ci-dessus OU viral TikTok France ${mois}
- Prix réaliste marché français
- Pour chaque produit : inclure une URL d'image réelle du produit (AliExpress, DSers, ou Google Images)

Réponds UNIQUEMENT avec un tableau JSON valide :
[
  {
    "id": "${idP}",
    "nom": "Nom commercial français accrocheur",
    "description": "Description bénéfice-first 1-2 phrases",
    "raisonVente": "Pourquoi ce produit se vend bien EN CE MOMENT (basé sur les données marché)",
    "prixVente": 0.00,
    "prixFournisseur": 0.00,
    "marge": 0.0,
    "categorie": "plaisir",
    "priorite": "A",
    "statut": "pending",
    "images": [],
    "liens": [{"label": "DSers", "url": "https://www.dsers.com/search/?q=nom+produit"}],
    "dateAjout": "${now}"
  },
  {
    "id": "${idM}",
    "nom": "...",
    "description": "...",
    "raisonVente": "...",
    "prixVente": 0.00,
    "prixFournisseur": 0.00,
    "marge": 0.0,
    "categorie": "malin",
    "priorite": "A",
    "statut": "pending",
    "images": [],
    "liens": [{"label": "AliExpress", "url": "https://fr.aliexpress.com/wholesale?SearchText=nom+produit"}],
    "dateAjout": "${now}"
  },
  {
    "id": "${idB}",
    "nom": "...",
    "description": "...",
    "raisonVente": "...",
    "prixVente": 0.00,
    "prixFournisseur": 0.00,
    "marge": 0.0,
    "categorie": "bebe",
    "priorite": "A",
    "statut": "pending",
    "images": [],
    "liens": [{"label": "Vinted", "url": "https://www.vinted.fr/catalog?search_text=nom+produit"}],
    "dateAjout": "${now}"
  }
]`;

  console.log(`[Antoine] Génération des propositions (IDs : ${idP}, ${idM}, ${idB})…`);
  const text = await callGroq(prompt);

  let newProducts;
  try {
    newProducts = JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Réponse non-JSON :\n' + text.slice(0, 400));
    newProducts = JSON.parse(match[0]);
  }

  if (!Array.isArray(newProducts) || newProducts.length === 0)
    throw new Error('Tableau vide reçu');

  newProducts = newProducts.map(fixMarge);

  /* ── Filtre les doublons que Groq aurait quand même proposés ── */
  const before = newProducts.length;
  newProducts = newProducts.filter(p => !existingNamesNorm.has(normaliseName(p.nom)));
  if (newProducts.length < before)
    console.log(`[Antoine] ${before - newProducts.length} doublon(s) ignoré(s).`);

  if (!newProducts.length) {
    console.log('[Antoine] Aucun nouveau produit unique — arrêt.');
    return;
  }

  /* ── Recherche d'images réelles pour chaque produit ── */
  console.log('[Antoine] Recherche des images produits…');
  await Promise.all(newProducts.map(async p => {
    const lienUrl = p.liens && p.liens[0] ? p.liens[0].url : null;
    const imgUrl = await findProductImage(p.nom, lienUrl, p.id);
    if (imgUrl) p.images = [imgUrl];
  }));

  raw.proposals.push(...newProducts);
  fs.writeFileSync(SOURCING_PATH, JSON.stringify(raw, null, 2), 'utf8');

  const summary = newProducts.map(p => `${p.id} ${p.nom}`).join(' | ');
  fs.writeFileSync(SUMMARY_PATH, summary, 'utf8');

  console.log(`[Antoine] ✓ ${newProducts.length} produits ajoutés :`);
  newProducts.forEach(p =>
    console.log(`  ${p.id} — ${p.nom} (${p.marge}% marge, ${p.prixVente}€) — ${p.raisonVente?.slice(0,60)}…`)
  );
}

main().catch(err => {
  console.error('[Antoine] Erreur :', err.message);
  process.exit(1);
});
