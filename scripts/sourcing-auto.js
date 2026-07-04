#!/usr/bin/env node
/* Antoine — Sourcing automatique horaire
   Appelle Groq (gratuit, Llama 3.3) pour générer 3 nouveaux produits (1 par univers)
   et les ajoute directement dans sourcing-proposals.json */

const fs   = require('fs');
const path = require('path');

const SOURCING_PATH = path.join(__dirname, '../Le clam/data/sourcing-proposals.json');
const SUMMARY_PATH  = path.join(__dirname, '../.sourcing-summary');

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
      temperature: 0.7,
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

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY manquant');

  const raw  = JSON.parse(fs.readFileSync(SOURCING_PATH, 'utf8'));
  const proposals = raw.proposals;
  const today = new Date().toISOString().split('T')[0];

  const idP = nextId(proposals, 'src-p');
  const idM = nextId(proposals, 'src-m');
  const idB = nextId(proposals, 'src-b');

  const existingNames = proposals.map(p => p.nom).filter(Boolean).join(' | ');

  const prompt = `Tu es Antoine, responsable sourcing de Le Clam, un e-commerce français avec 3 univers :
- Plaisir : sextoys, bien-être intime, produits Made in France
- Malin : gadgets tendance TikTok/Instagram, high-tech nomade
- Bébé : jouets d'éveil, vêtements seconde main, accessoires

Propose exactement 3 nouveaux produits à sourcer aujourd'hui (1 par univers).
Ces produits sont déjà au catalogue, ne les répète PAS : ${existingNames.slice(0, 800)}

Critères obligatoires :
- Marge ≥ 40% : formule (prixVente - prixFournisseur) / prixVente × 100
- Produit tendance, viral sur TikTok ou très vendu en dropshipping EU
- Disponible sur DSers EU, Vinted, Leboncoin ou grossiste direct
- Prix de vente réaliste pour le marché français (pas trop cher, pas bradé)

Réponds UNIQUEMENT avec un tableau JSON valide (pas d'explication, pas de markdown, juste le JSON brut) :
[
  {
    "id": "${idP}",
    "nom": "Nom commercial français accrocheur",
    "description": "Description bénéfice-first en 1-2 phrases, style Le Clam",
    "prixVente": 0.00,
    "prixFournisseur": 0.00,
    "marge": 0.0,
    "categorie": "plaisir",
    "priorite": 2,
    "statut": "pending",
    "liens": [{"label": "DSers", "url": "https://www.dsers.com"}],
    "dateAjout": "${today}"
  },
  {
    "id": "${idM}",
    "nom": "...",
    "description": "...",
    "prixVente": 0.00,
    "prixFournisseur": 0.00,
    "marge": 0.0,
    "categorie": "malin",
    "priorite": 2,
    "statut": "pending",
    "liens": [{"label": "DSers", "url": "https://www.dsers.com"}],
    "dateAjout": "${today}"
  },
  {
    "id": "${idB}",
    "nom": "...",
    "description": "...",
    "prixVente": 0.00,
    "prixFournisseur": 0.00,
    "marge": 0.0,
    "categorie": "bebe",
    "priorite": 2,
    "statut": "pending",
    "liens": [{"label": "Vinted", "url": "https://www.vinted.fr"}],
    "dateAjout": "${today}"
  }
]`;

  console.log(`[Antoine] Recherche de nouveaux produits (IDs : ${idP}, ${idM}, ${idB})…`);
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

  raw.proposals.push(...newProducts);
  fs.writeFileSync(SOURCING_PATH, JSON.stringify(raw, null, 2), 'utf8');

  const summary = newProducts.map(p => `${p.id} ${p.nom}`).join(' | ');
  fs.writeFileSync(SUMMARY_PATH, summary, 'utf8');

  console.log(`[Antoine] ✓ ${newProducts.length} produits ajoutés :`);
  newProducts.forEach(p =>
    console.log(`  ${p.id} — ${p.nom} (${p.marge}% marge, ${p.prixVente}€)`)
  );
}

main().catch(err => {
  console.error('[Antoine] Erreur :', err.message);
  process.exit(1);
});
