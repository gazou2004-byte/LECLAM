#!/usr/bin/env node
/* Remplit automatiquement les images manquantes dans sourcing-proposals.json
   Trouve l'image via Jina AI et la TÉLÉCHARGE localement → /img/sourcing/
   Plus de dépendance externe, plus d'URL à coller à la main */

const fs   = require('fs');
const path = require('path');

const SOURCING_PATH = path.join(__dirname, '../Le clam/data/sourcing-proposals.json');
const IMG_DIR       = path.join(__dirname, '../Le clam/public/img/sourcing');

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

/* ── Trouve une URL d'image via Jina AI ── */
async function findImageUrl(nom, liens) {
  const sources = [];
  if (liens && liens.length) sources.push(...liens.map(l => l.url).filter(Boolean));
  // Recherche Jina (moteur de recherche Jina, gratuit)
  sources.push(`https://s.jina.ai/${encodeURIComponent(nom + ' produit')}`);
  sources.push(`https://www.dsers.com/search/?q=${encodeURIComponent(nom)}`);
  sources.push(`https://fr.aliexpress.com/wholesale?SearchText=${encodeURIComponent(nom)}`);

  for (const src of sources) {
    try {
      const res = await fetch(`https://r.jina.ai/${src}`, {
        headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
        signal: AbortSignal.timeout(14000),
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

/* ── Télécharge l'image et la sauvegarde localement ── */
async function downloadImage(url, id) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.google.com/',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    const filename = `${id}.${ext}`;
    const filePath = path.join(IMG_DIR, filename);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null; // image vide/erreur
    fs.writeFileSync(filePath, buf);
    return `/img/sourcing/${filename}`;
  } catch {
    return null;
  }
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(SOURCING_PATH, 'utf8'));
  const missing = raw.proposals.filter(p => !p.images || !p.images.length || !p.images[0]);

  if (!missing.length) { console.log('[Antoine] Tous les produits ont déjà une image.'); return; }

  console.log(`[Antoine] ${missing.length} produits sans image à traiter…\n`);
  let found = 0, notFound = 0;

  for (const p of missing) {
    process.stdout.write(`  ${p.id} — ${p.nom}… `);
    const url = await findImageUrl(p.nom, p.liens);
    if (!url) { console.log('✗ URL introuvable'); notFound++; continue; }

    const localPath = await downloadImage(url, p.id);
    if (localPath) {
      p.images = [localPath];
      console.log(`✓ sauvegardée → ${localPath}`);
      found++;
    } else {
      // Garde l'URL distante si le téléchargement échoue
      p.images = [url];
      console.log(`~ URL distante (dl échoué) → ${url.slice(0, 60)}`);
      found++;
    }
    await new Promise(r => setTimeout(r, 600));
  }

  fs.writeFileSync(SOURCING_PATH, JSON.stringify(raw, null, 2), 'utf8');
  console.log(`\n[Antoine] ✓ ${found} images traitées, ${notFound} introuvables.`);
}

main().catch(err => { console.error('[Antoine] Erreur :', err.message); process.exit(1); });
