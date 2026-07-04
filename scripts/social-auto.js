#!/usr/bin/env node
/* Laura — Génération automatique de posts TikTok/Instagram
   Génère 3 idées de posts par jour (1 par univers)
   et les ajoute dans social-posts.json */

const fs   = require('fs');
const path = require('path');

const POSTS_PATH   = path.join(__dirname, '../Le clam/data/social-posts.json');
const SUMMARY_PATH = path.join(__dirname, '../.social-summary');

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
      temperature: 0.8,
      messages:    [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

function nextId(posts, prefix) {
  const nums = posts
    .filter(p => p.id && p.id.startsWith(prefix))
    .map(p => parseInt(p.id.replace(prefix, ''), 10))
    .filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return prefix + String(max + 1).padStart(2, '0');
}

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY manquant');

  if (!fs.existsSync(POSTS_PATH)) {
    fs.writeFileSync(POSTS_PATH, JSON.stringify({ posts: [] }, null, 2), 'utf8');
  }

  const raw   = JSON.parse(fs.readFileSync(POSTS_PATH, 'utf8'));
  const posts = raw.posts;
  const now   = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const idP = nextId(posts, 'post-p');
  const idM = nextId(posts, 'post-m');
  const idB = nextId(posts, 'post-b');

  const recentTitles = posts.slice(-20).map(p => p.titre).filter(Boolean).join(' | ');

  const prompt = `Tu es Laura, responsable marketing de Le Clam (@leclam.fr sur TikTok et Instagram).
Le Clam a 3 univers :
- Plaisir : bien-être intime, accessoires de soin, produits Made in France
- Malin : gadgets tendance TikTok/Instagram, high-tech nomade
- Bébé : jouets d'éveil, vêtements seconde main, accessoires

RÈGLE CRITIQUE univers Plaisir : Ne jamais écrire "sextoy", "vibromasseur", "gode" — utiliser "masseur personnel", "accessoire de bien-être intime", "soin intime".

Posts récents à ne pas répéter : ${recentTitles.slice(0, 500)}

Génère exactement 3 idées de posts (1 par univers) pour aujourd'hui.
Réponds UNIQUEMENT avec un tableau JSON valide, pas de markdown :
[
  {
    "id": "${idP}",
    "univers": "plaisir",
    "plateforme": "TikTok ou Instagram ou Les deux",
    "titre": "Titre accrocheur du post",
    "concept": "Description de ce qu'on filme/photographie en 1-2 phrases",
    "legende": "Légende complète avec emojis et hashtags prête à copier-coller",
    "cta": "Call-to-action (ex: Lien en bio, Commenter ❤️, etc.)",
    "dateCreation": "${now}"
  },
  {
    "id": "${idM}",
    "univers": "malin",
    "plateforme": "TikTok ou Instagram ou Les deux",
    "titre": "...",
    "concept": "...",
    "legende": "...",
    "cta": "...",
    "dateCreation": "${now}"
  },
  {
    "id": "${idB}",
    "univers": "bebe",
    "plateforme": "TikTok ou Instagram ou Les deux",
    "titre": "...",
    "concept": "...",
    "legende": "...",
    "cta": "...",
    "dateCreation": "${now}"
  }
]`;

  console.log(`[Laura] Génération de posts (IDs : ${idP}, ${idM}, ${idB})…`);
  const text = await callGroq(prompt);

  let newPosts;
  try {
    newPosts = JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Réponse non-JSON :\n' + text.slice(0, 400));
    newPosts = JSON.parse(match[0]);
  }

  if (!Array.isArray(newPosts) || newPosts.length === 0)
    throw new Error('Tableau vide reçu');

  raw.posts.push(...newPosts);
  fs.writeFileSync(POSTS_PATH, JSON.stringify(raw, null, 2), 'utf8');

  const summary = newPosts.map(p => `${p.id} ${p.titre}`).join(' | ');
  fs.writeFileSync(SUMMARY_PATH, summary, 'utf8');

  console.log(`[Laura] ✓ ${newPosts.length} posts générés :`);
  newPosts.forEach(p =>
    console.log(`  ${p.id} — ${p.titre} (${p.plateforme})`)
  );
}

main().catch(err => {
  console.error('[Laura] Erreur :', err.message);
  process.exit(1);
});
