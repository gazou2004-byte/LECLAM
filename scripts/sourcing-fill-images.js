#!/usr/bin/env node
/* Remplit automatiquement les images manquantes dans sourcing-proposals.json
   Pipeline : AliExpress search → item ID → product page → vraie photo produit */

const fs   = require('fs');
const path = require('path');

const SOURCING_PATH    = path.join(__dirname, '../Le clam/data/sourcing-proposals.json');
const IMG_DIR          = path.join(__dirname, '../Le clam/public/img/sourcing');
const BAD_SIZES = new Set([12420, 10046, 14542]); // placeholder AliExpress, logo AliExpress, image 404

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

async function jina(url, timeout = 15000) {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return '';
    return await res.text();
  } catch { return ''; }
}

/* ── Étape 1 : trouve l'ID d'un vrai produit AliExpress ── */
async function findAliexpressItemId(nom) {
  const query = encodeURIComponent(nom.replace(/[éèêë]/g,'e').replace(/[àâ]/g,'a').replace(/[ùû]/g,'u').replace(/[îï]/g,'i').replace(/[ôö]/g,'o').replace(/ç/g,'c'));
  const text = await jina(`https://fr.aliexpress.com/wholesale?SearchText=${query}`);
  const ids = [...text.matchAll(/\/item\/(\d{10,})/g)].map(m => m[1]);
  return ids[0] || null;
}

/* ── Étape 2 : visite la page produit et extrait la vraie image principale ── */
async function getProductImageUrl(itemId) {
  const text = await jina(`https://www.aliexpress.com/item/${itemId}.html`, 18000);
  const urls = [...text.matchAll(/https?:\/\/[^\s)"']+\.(jpg|jpeg|png|webp|avif)/gi)]
    .map(m => m[0])
    .filter(u => u.includes('aliexpress-media.com') || u.includes('alicdn.com'))
    .filter(u => !/\/\d+x\d+\./i.test(u))          // exclut les thumbnails (ex: /48x48.jpg)
    .filter(u => !/logo|banner|icon|avatar/i.test(u))
    // Hashes connus d'images génériques/logo AliExpress — pas des photos produits
    .filter(u => !u.includes('Sa976459fb7724bf1bca6e153a42'))
    .filter(u => !u.includes('O1CN01xDFBpV1GnX56f7OFF'));
  return urls[0] || null;
}

/* ── Étape 3 : télécharge via proxy (contourne hotlink protection) ── */
async function downloadImage(url, id) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.aliexpress.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('avif') ? 'avif' : 'jpg';
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 5000 || BAD_SIZES.has(buf.length)) return null;
    const filePath = path.join(IMG_DIR, `${id}.${ext}`);
    fs.writeFileSync(filePath, buf);
    return `/img/sourcing/${id}.${ext}`;
  } catch { return null; }
}

/* ── Amazon France : images produit fiables ── */
async function findAmazonImage(nom) {
  // Traduit les termes courants pour une meilleure recherche
  const en = nom
    .replace(/bougie/gi, 'candle').replace(/aphrodisiaque/gi, 'romantic')
    .replace(/aromatique/gi, 'scented').replace(/relaxante/gi, 'relaxing')
    .replace(/montre connectée/gi, 'smartwatch').replace(/fitness/gi, 'fitness tracker')
    .replace(/chargeur sans fil/gi, 'wireless charger').replace(/support/gi, 'stand')
    .replace(/caméra/gi, 'camera').replace(/surveillance/gi, 'security')
    .replace(/tapis de yoga/gi, 'yoga mat').replace(/écologique/gi, 'eco')
    .replace(/contrôleur/gi, 'game controller').replace(/portable/gi, 'portable')
    .replace(/kit d'art/gi, 'art craft kit').replace(/création/gi, 'creative');
  const q = encodeURIComponent(en);
  const text = await jina(`https://www.amazon.fr/s?k=${q}`);
  const urls = [...text.matchAll(/https?:\/\/m\.media-amazon\.com\/images\/I\/([A-Za-z0-9]+)\.[^"'\s)]+/g)]
    .map(m => m[0])
    .filter(u => /\.(jpg|jpeg|png)/i.test(u))
    .filter(u => !/sprite|nav-|branding|logo/i.test(u))
    // Préfère les images plus grandes
    .map(u => u.replace(/_AC_[^.]+/, '_AC_SL500_'));
  return urls[0] || null;
}

async function findAndDownload(p) {
  // 1. Essai AliExpress (vrai produit fournisseur)
  const itemId = await findAliexpressItemId(p.nom);
  if (itemId) {
    const imgUrl = await getProductImageUrl(itemId);
    if (imgUrl) {
      const local = await downloadImage(imgUrl, p.id);
      if (local) return local;
      // Ne pas sauvegarder l'URL distante si le download a échoué — image probablement corrompue
    }
  }

  // 2. Fallback Amazon France
  const amazonUrl = await findAmazonImage(p.nom);
  if (amazonUrl) {
    const local = await downloadImage(amazonUrl, p.id);
    if (local) return local;
  }

  return null;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(SOURCING_PATH, 'utf8'));
  const missing = raw.proposals.filter(p => !p.images || !p.images.length || !p.images[0]);

  if (!missing.length) { console.log('[Antoine] Tous les produits ont une image.'); return; }

  console.log(`[Antoine] ${missing.length} produits sans image…\n`);
  let found = 0, notFound = 0;

  for (const p of missing) {
    process.stdout.write(`  ${p.id} — ${p.nom}… `);
    const result = await findAndDownload(p);
    if (result) {
      p.images = [result];
      console.log(`✓ ${result.slice(0, 70)}`);
      found++;
    } else {
      console.log('✗ introuvable');
      notFound++;
    }
    await new Promise(r => setTimeout(r, 800));
  }

  fs.writeFileSync(SOURCING_PATH, JSON.stringify(raw, null, 2), 'utf8');
  console.log(`\n[Antoine] ✓ ${found} images trouvées, ${notFound} introuvables.`);
}

main().catch(err => { console.error('[Antoine] Erreur :', err.message); process.exit(1); });
