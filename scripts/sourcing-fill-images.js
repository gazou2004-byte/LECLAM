#!/usr/bin/env node
/* Remplit automatiquement les images manquantes dans sourcing-proposals.json
   Utilise Jina AI pour trouver les vraies images produits (sans clé API) */

const fs   = require('fs');
const path = require('path');

const SOURCING_PATH = path.join(__dirname, '../Le clam/data/sourcing-proposals.json');

async function findProductImage(nom, liens) {
  const sources = [];
  if (liens && liens.length) sources.push(...liens.map(l => l.url).filter(Boolean));
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
      const matches = [...text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)]
        .map(m => m[1])
        .filter(u => /\.(jpg|jpeg|png|webp|avif)/i.test(u))
        .filter(u => !u.includes('logo') && !u.includes('banner') && !u.includes('avatar')
                  && !u.includes('placeholder') && !u.includes('icon') && !u.includes('flag'));
      if (matches[0]) return matches[0];
    } catch { /* continue */ }
  }
  return null;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(SOURCING_PATH, 'utf8'));
  const missing = raw.proposals.filter(p => !p.images || !p.images.length || !p.images[0]);

  if (!missing.length) { console.log('[Antoine] Tous les produits ont déjà une image.'); return; }

  console.log(`[Antoine] ${missing.length} produits sans image à traiter…\n`);
  let found = 0, notFound = 0;

  for (const p of missing) {
    process.stdout.write(`  ${p.id} ${p.nom}… `);
    const url = await findProductImage(p.nom, p.liens);
    if (url) {
      p.images = [url];
      console.log(`✓ ${url.slice(0, 70)}`);
      found++;
    } else {
      console.log('✗ aucune image trouvée');
      notFound++;
    }
    // Petite pause pour ne pas surcharger Jina AI
    await new Promise(r => setTimeout(r, 500));
  }

  fs.writeFileSync(SOURCING_PATH, JSON.stringify(raw, null, 2), 'utf8');
  console.log(`\n[Antoine] ✓ ${found} images trouvées, ${notFound} introuvables.`);
}

main().catch(err => { console.error('[Antoine] Erreur :', err.message); process.exit(1); });
