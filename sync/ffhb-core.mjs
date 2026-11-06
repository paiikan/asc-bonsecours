// =============================================================================
// Synchronisation ffhandball.fr -> data/ffhb.json
//
// La FFHandball ne publie pas d'API publique. Son site affiche chaque bloc
// « compétition » à partir d'une route WordPress publique
// (wp-json/competitions/v1/computeBlockAttributes) dont les réponses sont
// simplement brouillées : base64 puis XOR avec une clé écrite en clair sur
// chaque page (attribut data-cfk de <body>). On les décode exactement comme le
// JavaScript du site le fait. Uniquement des requêtes GET publiques, sans compte.
//
// Ce module n'utilise que fetch, atob et TextDecoder : il tourne tel quel dans
// Node 18+ (GitHub Actions) comme dans un navigateur.
// =============================================================================

export const DEFAULTS = {
  base: 'https://www.ffhandball.fr',
  query: 'bonsecours',                         // recherche « Club » sur ffhandball.fr
  clubLabel: /^A\.?\s?S\.?\s?C\.?\s+BONSECOURS$/i, // libellé exact du club dans les résultats
  teamMatch: /BONSECOURS/i,                    // nos équipes (ententes comprises)
  concurrency: 4,
  pauseMs: 300,
  userAgent: 'site-asc-bonsecours (synchro calendrier, 1 passage / 3 h)',
};

const BLOCKS = {
  POOL: 'competitions---poule-selector',
  MATCHES: 'competitions---rencontre-list',
  STANDINGS: 'competitions---mini-classement-or-ads',
};

/** Saison sportive en cours (bascule au 1er juillet) et son identifiant FFHB. */
export function currentSeason(date = new Date()) {
  const start = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return { start, id: start - 2004, label: `${start}-${start + 1}` };
}

export function slugify(libelle, id) {
  const s = String(libelle)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${s}-${id}`;
}

export function unescapeHtml(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

export function decodePayload(payload, key) {
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i) ^ key.charCodeAt(i % key.length);
  }
  return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

export function keyFromPage(html) {
  return String(html).match(/data-cfk="([^"]+)"/)?.[1] ?? null;
}

/** Les résultats de la recherche « Club » sont écrits dans la page, en JSON. */
export function searchResultsFromPage(html) {
  const m = String(html).match(/name='competitions---search-results'\s+attributes="([^"]*)"/);
  if (!m) return null;
  return JSON.parse(unescapeHtml(m[1])).results ?? [];
}

const toInt = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const logoStem = (file, show = '1') => {
  if (!file || String(show) === '0') return '';
  const stem = String(file).split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  return /^[A-Za-z0-9._-]+$/.test(stem) ? stem : '';
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Catégorie lisible à partir du libellé de compétition et de celui de l'équipe. */
export function categoryOf(compLibelle, teamLibelle) {
  const m = String(compLibelle).match(/^\s*([+-])\s?(\d+)/);
  const sexe = /FEMININ|FILLES|\bF\b/i.test(compLibelle) ? 'F' : /MIXTE/i.test(compLibelle) ? 'Mixte' : 'M';
  const num = String(teamLibelle).match(/\s(\d)\s*(\(|$)/)?.[1];
  if (!m || m[1] === '+') return `Seniors ${sexe}${num ? ' ' + num : ''}`;
  return `-${m[2]} ${sexe}${num ? ' ' + num : ''}`;
}

export function levelOf(type) {
  return { REGIONAL: 'Régional', DEPARTEMENTAL: 'Départemental', NATIONAL: 'National', 'COUPE-DE-FRANCE': 'Coupe de France' }[String(type).toUpperCase().replace(/_/g, '-')] ?? type;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export class FfhbClient {
  constructor({ base = DEFAULTS.base, fetchImpl = globalThis.fetch, userAgent = DEFAULTS.userAgent, pauseMs = DEFAULTS.pauseMs } = {}) {
    this.base = base; this.fetch = (...a) => fetchImpl.apply(globalThis, a); this.ua = userAgent; this.pauseMs = pauseMs; this.key = null;
  }

  async get(path, accept = 'text/html') {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const headers = { accept };
        if (typeof window === 'undefined') headers['user-agent'] = this.ua; // un navigateur refuse ce header
        const res = await this.fetch(this.base + path, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path}`);
        if (this.pauseMs) await sleep(this.pauseMs);
        return res;
      } catch (err) { lastErr = err; await sleep(1000 * (attempt + 1)); }
    }
    throw lastErr;
  }

  async getKey(refresh = false) {
    if (this.key && !refresh) return this.key;
    const html = await (await this.get('/competitions/')).text();
    const key = keyFromPage(html);
    if (!key) throw new Error('ffhandball.fr a changé : clé de décodage introuvable');
    this.key = key;
    return key;
  }

  async block(block, params) {
    const q = new URLSearchParams({ block, ...params });
    const body = await (await this.get(`/wp-json/competitions/v1/computeBlockAttributes?${q}`, 'application/json')).json();
    if (typeof body !== 'string') {
      if (body?.code && body?.message) throw new Error(`ffhandball.fr a refusé ${block} : ${body.message}`);
      return body;
    }
    try { return decodePayload(body, await this.getKey()); }
    catch { return decodePayload(body, await this.getKey(true)); } // clé changée : on la relit une fois
  }
}

/**
 * Récupère tout le club : compétitions, équipes, matchs et classements.
 * @returns {Promise<object>} le contenu de data/ffhb.json
 */
export async function syncClub(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const season = opts.seasonId ? { id: Number(opts.seasonId), start: Number(opts.seasonId) + 2004 } : currentSeason(opts.now);
  season.label = `${season.start}-${season.start + 1}`;
  const seasonPath = `/competitions/saison-${season.label}-${season.id}`;
  const client = new FfhbClient({ base: o.base, fetchImpl: o.fetchImpl, userAgent: o.userAgent, pauseMs: o.pauseMs });
  const log = o.log ?? (() => {});

  // 1. Compétitions du club, via la recherche « Club » (la page porte aussi la clé).
  const html = await (await client.get(`${seasonPath}/recherche/?type=structure&q=${encodeURIComponent(o.query)}`)).text();
  client.key = keyFromPage(html) ?? client.key;
  let results = searchResultsFromPage(html) ?? [];
  const ours = results.filter((r) => o.clubLabel.test(String(r.equipe_libelle).trim()));
  if (ours.length) results = ours;
  let clubLogo = logoStem(results[0]?.equipe_logo);
  let comps = results.map((r) => ({
    id: String(r.ext_competitionId), libelle: r.libelle, type: String(r.type).toLowerCase().replace(/_/g, '-'),
    organisateur: r.structure_libelle,
  }));
  // Liste de secours : la recherche de ffhandball.fr revient vide depuis certains
  // serveurs (dont ceux de GitHub). On complète avec les compétitions connues.
  const known = o.knownCompetitions;
  if (known && Number(known.saison) === season.id) {
    if (!comps.length) log('recherche ffhandball.fr vide : liste de compétitions enregistrée utilisée');
    comps = [...comps, ...known.competitions];
    clubLogo ||= known.clubLogo ?? '';
  } else if (!comps.length) {
    log('recherche ffhandball.fr vide et aucune liste enregistrée pour cette saison (voir sync/competitions.json)');
  }
  comps = [...new Map(comps.map((c) => [String(c.id), { ...c, slug: slugify(c.libelle, c.id) }])).values()];
  log(`${comps.length} compétitions`);

  // 2. Nos équipes dans chaque compétition (toutes phases et poules).
  const found = await pool(comps, o.concurrency, async (c) => {
    const base = { ext_saison_id: String(season.id), url_competition_type: c.type, url_competition: c.slug };
    try {
      const first = await client.block(BLOCKS.POOL, base);
      const others = await pool((first.poules ?? []).slice(1), 2,
        (p) => client.block(BLOCKS.POOL, { ...base, ext_poule_id: p.ext_pouleId }).catch(() => null));
      const ids = new Set();
      for (const a of [first, ...others]) for (const t of a?.equipe_options ?? []) if (o.teamMatch.test(t.libelle)) ids.add(String(t.ext_equipeId));
      return [...ids].map((teamId) => ({ comp: c, teamId }));
    } catch (err) { log(`! ${c.libelle} : ${err.message}`); return []; }
  });
  const refs = found.flat();
  log(`${refs.length} équipes trouvées`);

  // 3. Matchs et classement de chaque équipe.
  const teams = (await pool(refs, o.concurrency, async ({ comp, teamId }) => {
    const p = { ext_saison_id: String(season.id), url_competition_type: comp.type, url_competition: comp.slug, ext_equipe_id: teamId };
    try {
      const [poolB, matchesB, standB] = await Promise.all([BLOCKS.POOL, BLOCKS.MATCHES, BLOCKS.STANDINGS].map((b) => client.block(b, p)));
      return buildTeam({ comp, teamId, season, seasonPath, base: o.base }, poolB, matchesB, standB);
    } catch (err) { log(`! équipe ${teamId} (${comp.libelle}) : ${err.message}`); return null; }
  })).filter(Boolean);

  const matchs = [...new Map(teams.flatMap((t) => t.matchs).map((m) => [m.id, m])).values()]
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.journee - b.journee);

  return {
    meta: {
      source: 'ffhandball.fr', saison: season.label, club: 'A.S.C. BONSECOURS', clubLogo,
      equipes: teams.length, matchs: matchs.length,
    },
    equipes: teams.map(({ matchs: _m, ...t }) => t),
    matchs,
  };
}

/** Une équipe, vue de notre côté, à partir des trois blocs du site. */
export function buildTeam(ref, poolB, matchesB, standB) {
  const sel = poolB?.selected_equipe;
  if (!sel) throw new Error('équipe introuvable (saison terminée ?)');
  const internal = String(sel.id);
  const isUs = (id, libelle) => String(id) === internal || (!!libelle && String(libelle).trim() === String(sel.libelle).trim());
  const poule = poolB.selected_poule ?? {};
  const phase = (poolB.phases ?? []).find((ph) => ph.id === poule.phaseId) ?? poolB.phases?.[0] ?? {};
  const categorie = categoryOf(ref.comp.libelle, sel.libelle);
  const coupe = /COUPE/i.test(ref.comp.libelle) || ref.comp.type === 'coupe-de-france';
  const url = `${ref.base}${ref.seasonPath}/${ref.comp.type}/${ref.comp.slug}/equipe-${ref.teamId}/`;

  const matchs = (matchesB?.rencontres ?? [])
    // Notre équipe par son identifiant, ou par son libellé exact : d'un tour de coupe
    // à l'autre, la FFHB lui donne parfois un nouvel identifiant interne.
    .filter((r) => isUs(r.equipe1Id, r.equipe1Libelle) || isUs(r.equipe2Id, r.equipe2Libelle))
    .map((r) => {
      const dom = isUs(r.equipe1Id, r.equipe1Libelle);
      const s1 = r.equipe1Score ?? null, s2 = r.equipe2Score ?? null;
      const joue = s1 !== null && s1 !== '' && s2 !== null && s2 !== '';
      const n1 = toInt(s1), n2 = toInt(s2);
      // Score non numérique d'un côté : « FO » = forfait, « PE » = pénalité…
      const special = joue && (n1 === null || n2 === null);
      const perdant1 = n1 === null;
      return {
        id: String(r.ext_rencontreId ?? r.id),
        equipe: ref.teamId,
        journee: toInt(r.journeeNumero) ?? 0,
        date: r.date || null,
        dom,
        adv: (dom ? r.equipe2Libelle : r.equipe1Libelle) ?? '',
        advLogo: dom ? logoStem(r.structure2Logo, r.equipe2ShowLogo) : logoStem(r.structure1Logo, r.equipe1ShowLogo),
        score: joue && !special ? [dom ? n1 : n2, dom ? n2 : n1] : null,
        forfait: special ? { perdant: perdant1 === dom ? 'nous' : 'adv', code: String(perdant1 ? s1 : s2).trim().toUpperCase() } : null,
      };
    });

  const classement = String(phase.classement ?? '1') === '0' ? [] : (standB?.classements ?? [])
    .filter((c) => !c.pouleId || String(c.pouleId) === String(poule.id))
    .map((c) => ({
      place: toInt(c.place), equipe: c.equipe_libelle ?? '', points: toInt(c.point), joue: toInt(c.joue),
      gagne: toInt(c.gagne), nul: toInt(c.nul), perdu: toInt(c.perdu), bp: toInt(c.butPlus), bc: toInt(c.butMoins),
      diff: toInt(c.diff), logo: logoStem(c.structure_logo, c.equipe_logoActif), nous: String(c.equipeId) === internal,
    }))
    .sort((a, b) => (a.place ?? 99) - (b.place ?? 99));

  return {
    id: ref.teamId,
    nom: sel.libelle,
    categorie,
    competition: ref.comp.libelle,
    niveau: levelOf(ref.comp.type),
    organisateur: ref.comp.organisateur,
    coupe,
    phase: phase.libelle ?? '',
    poule: poule.libelle ?? '',
    majFFHB: phase.dateDernierUpdateEnfants ?? null,
    url,
    rang: classement.find((c) => c.nous)?.place ?? null,
    classement,
    matchs,
  };
}
