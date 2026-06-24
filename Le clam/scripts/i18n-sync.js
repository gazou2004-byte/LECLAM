#!/usr/bin/env node
/**
 * i18n-sync.js — Traduit automatiquement les clés manquantes dans en/es/de/it
 *
 * Usage :
 *   node scripts/i18n-sync.js
 *   npm run i18n:sync
 *
 * Nécessite ANTHROPIC_API_KEY dans .env ou en variable d'environnement.
 * Ajoute uniquement les clés absentes — ne touche jamais aux traductions existantes.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'public', 'locales');
const SOURCE_LANG = 'fr';
const TARGET_LANGS = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'de', name: 'German'  },
  { code: 'it', name: 'Italian' },
];
const MODEL      = 'claude-haiku-4-5-20251001';
const BATCH_SIZE = 60;

/* ── Chargement de .env ── */
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const idx = line.indexOf('=');
      if (idx < 1) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  }
} catch {}

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('\n❌  ANTHROPIC_API_KEY manquant.');
  console.error('   Ajoutez  ANTHROPIC_API_KEY=sk-ant-...  dans le fichier .env\n');
  process.exit(1);
}

/* ── Helpers JSON ── */
function flatKeys(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatKeys(v, full));
    else out[full] = v;
  }
  return out;
}

function setKey(obj, dotPath, value) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null)
      cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/* ── Appel API Claude ── */
async function translateBatch(pairs, targetName) {
  const lines = pairs.map(([k, v]) => `"${k}": "${v.replace(/"/g, '\\"')}"`).join('\n');

  const prompt = `You are a professional e-commerce translator. Translate these French UI strings to ${targetName}.

Rules:
- Friendly, commercial tone
- Keep {{placeholders}} exactly as written
- Keep HTML tags, arrows (→ ←), emoji, special chars unchanged
- One "key": "translated value" per line — no extra text, no explanations

French strings:
${lines}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':    'application/json',
      'x-api-key':       API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content[0].text;

  const result = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^"([^"]+)":\s*"(.*)"$/);
    if (m) result[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return result;
}

/* ── Main ── */
async function main() {
  const frData = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${SOURCE_LANG}.json`), 'utf8'));
  const frFlat = flatKeys(frData);
  const frTotal = Object.keys(frFlat).length;

  console.log(`\n🌐  i18n-sync — ${frTotal} clés en fr.json\n`);

  let grandTotal = 0;

  for (const { code, name } of TARGET_LANGS) {
    const filePath = path.join(LOCALES_DIR, `${code}.json`);
    const langData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const langFlat = flatKeys(langData);

    const missing = Object.keys(frFlat).filter(k => !(k in langFlat));

    if (missing.length === 0) {
      console.log(`  ✅  ${code}.json  — complet (${frTotal} clés)`);
      continue;
    }

    console.log(`  🔄  ${code}.json  — ${missing.length} clés manquantes…`);

    const translations = {};

    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE);
      const pairs = batch.map(k => [k, frFlat[k]]);
      process.stdout.write(`       lot ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(missing.length / BATCH_SIZE)}… `);
      try {
        const res = await translateBatch(pairs, name);
        Object.assign(translations, res);
        console.log(`✓ (${Object.keys(res).length}/${batch.length})`);
      } catch (err) {
        console.log(`⚠️  erreur — ${err.message}`);
      }
    }

    let added = 0;
    for (const key of missing) {
      const val = translations[key] ?? frFlat[key]; // fallback français si traduction échouée
      setKey(langData, key, val);
      added++;
    }

    fs.writeFileSync(filePath, JSON.stringify(langData, null, 2) + '\n', 'utf8');
    console.log(`       → ${added} traductions ajoutées ✓\n`);
    grandTotal += added;
  }

  if (grandTotal === 0) {
    console.log('✅  Toutes les langues sont déjà synchronisées !\n');
  } else {
    console.log(`✅  Terminé — ${grandTotal} traductions ajoutées au total.\n`);
  }
}

main().catch(err => {
  console.error('\n❌  Erreur :', err.message);
  process.exit(1);
});
