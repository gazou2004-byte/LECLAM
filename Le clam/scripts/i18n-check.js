#!/usr/bin/env node
/**
 * i18n-check.js — Vérifie que toutes les langues ont les mêmes clés que fr.json
 *
 * Usage :
 *   node scripts/i18n-check.js
 *   npm run i18n:check
 *
 * Aucune clé API requise. Retourne exit code 1 si des clés manquent.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const LOCALES_DIR  = path.join(__dirname, '..', 'public', 'locales');
const SOURCE_LANG  = 'fr';
const TARGET_LANGS = ['en', 'es', 'de', 'it'];

function flatKeys(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatKeys(v, full));
    else out[full] = v;
  }
  return out;
}

const frData = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${SOURCE_LANG}.json`), 'utf8'));
const frFlat = flatKeys(frData);
const total  = Object.keys(frFlat).length;

console.log(`\n🔍  i18n-check — référence : ${total} clés dans fr.json\n`);

let hasErrors = false;

for (const lang of TARGET_LANGS) {
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  const langFlat = flatKeys(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  const missing  = Object.keys(frFlat).filter(k => !(k in langFlat));
  const extra    = Object.keys(langFlat).filter(k => !(k in frFlat));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`  ✅  ${lang}.json  — ${total} clés, tout est synchronisé`);
  } else {
    hasErrors = true;
    if (missing.length) {
      console.log(`  ❌  ${lang}.json  — ${missing.length} clé(s) MANQUANTE(S) :`);
      missing.forEach(k => console.log(`       - ${k}  (fr: "${frFlat[k]}")`));
    }
    if (extra.length) {
      console.log(`  ⚠️   ${lang}.json  — ${extra.length} clé(s) en trop (absentes de fr.json) :`);
      extra.forEach(k => console.log(`       + ${k}`));
    }
  }
}

console.log('');
if (hasErrors) {
  console.log('💡  Lancez  npm run i18n:sync  pour corriger automatiquement.\n');
  process.exit(1);
} else {
  console.log('✅  Toutes les langues sont synchronisées.\n');
}
