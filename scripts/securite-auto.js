#!/usr/bin/env node
/* Matthieu — Audit sécurité automatique
   Analyse le diff du dernier commit avec Groq (Llama 3.3)
   et génère un rapport markdown */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RAPPORT_PATH = path.join(__dirname, '../.securite-rapport.md');

async function callGroq(prompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      max_tokens:  1024,
      temperature: 0.2,
      messages:    [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY manquant');

  let diff = '';
  try {
    diff = execSync('git diff HEAD~1 HEAD -- "*.js" "*.html" "*.json"', { encoding: 'utf8' });
  } catch {
    diff = execSync('git show HEAD -- "*.js" "*.html" "*.json"', { encoding: 'utf8' });
  }

  if (!diff.trim()) {
    fs.writeFileSync(RAPPORT_PATH, '# Rapport Matthieu\n\nAucune modification JS/HTML/JSON détectée.\n', 'utf8');
    console.log('[Matthieu] Aucune modification à analyser.');
    return;
  }

  const diffTronque = diff.slice(0, 6000);
  const date = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const prompt = `Tu es Matthieu, expert en cybersécurité pour un e-commerce français (Le Clam).
Analyse ce diff git et identifie UNIQUEMENT les vraies vulnérabilités de sécurité.
Ignore les changements cosmétiques ou fonctionnels sans impact sécurité.

Catégories à vérifier : XSS, injection SQL, secrets hardcodés, CSRF, auth bypass, exposition de données, dépendances vulnérables.

Pour chaque vulnérabilité trouvée : niveau (CRITIQUE/HAUT/MOYEN/BAS), description courte, ligne concernée, correction suggérée.
Si aucune vulnérabilité : écris "RAS - Aucune vulnérabilité détectée."

Réponds en français, format markdown concis.

DIFF :
${diffTronque}`;

  console.log('[Matthieu] Analyse du diff en cours…');
  const analyse = await callGroq(prompt);

  const rapport = `# Rapport Matthieu — ${date}

## Commit analysé
\`${execSync('git log -1 --oneline', { encoding: 'utf8' }).trim()}\`

## Analyse sécurité

${analyse}
`;

  fs.writeFileSync(RAPPORT_PATH, rapport, 'utf8');
  console.log('[Matthieu] Rapport généré :');
  console.log(analyse);
}

main().catch(err => {
  console.error('[Matthieu] Erreur :', err.message);
  process.exit(1);
});
