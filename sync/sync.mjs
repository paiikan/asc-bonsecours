#!/usr/bin/env node
// Récupère les matchs, scores et classements d'ASC Bonsecours sur ffhandball.fr
// et met à jour site/data/ffhb.json. Lancé automatiquement par GitHub Actions.
//
//   node sync/sync.mjs              -> met à jour le fichier
//   node sync/sync.mjs --dry-run    -> affiche un résumé sans rien écrire
//
// Variables d'environnement facultatives :
//   FFHB_SEASON_ID  identifiant de saison FFHB (22 = 2026-2027), sinon calculé
//   FFHB_QUERY      texte de la recherche « Club » (défaut : bonsecours)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncClub } from './ffhb-core.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../site/data/ffhb.json');
// Copie en .js : le site la charge avec une simple balise <script>, ce qui marche
// aussi quand on ouvre index.html directement depuis son ordinateur.
const OUT_JS = OUT.replace(/\.json$/, '.js');
const dryRun = process.argv.includes('--dry-run');

const strip = (d) => JSON.stringify({ ...d, meta: { ...d.meta, majSite: undefined, instantane: undefined } });

let knownCompetitions = null;
try { knownCompetitions = JSON.parse(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), 'competitions.json'), 'utf8')); } catch { /* facultatif */ }

const data = await syncClub({
  knownCompetitions,
  seasonId: process.env.FFHB_SEASON_ID || undefined,
  query: process.env.FFHB_QUERY || undefined,
  log: (m) => console.log('·', m),
});

console.log(`→ ${data.equipes.length} équipes, ${data.matchs.length} matchs (saison ${data.meta.saison})`);

let previous = null;
try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* premier passage */ }

// Garde-fou : une réponse vide alors qu'on avait des données = site FFHB en panne
// ou modifié. On garde l'ancien fichier et on signale l'erreur.
if (!data.equipes.length || !data.matchs.length) {
  console.error('✗ Aucune donnée récupérée : fichier existant conservé.');
  process.exit(previous ? 1 : 0);
}

if (previous && strip(previous) === strip(data)) {
  console.log('✓ Rien de nouveau sur ffhandball.fr.');
  process.exit(0);
}

data.meta.majSite = new Date().toISOString();
if (dryRun) {
  for (const e of data.equipes) console.log(`  ${e.categorie.padEnd(12)} ${e.competition} — ${e.poule}${e.rang ? ` (${e.rang}e)` : ''}`);
  process.exit(0);
}
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');
await writeFile(OUT_JS, `window.FFHB = ${JSON.stringify(data)};\n`);
console.log(`✓ ${OUT} mis à jour.`);
