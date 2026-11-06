// Test hors ligne du module de synchro : on simule ffhandball.fr.
//   node --test sync/
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncClub, decodePayload, slugify, categoryOf } from './ffhb-core.mjs';

const KEY = 'AbCdEf0123456789xyzXYZ';
const encode = (obj) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach((b, i) => { bin += String.fromCharCode(b ^ KEY.charCodeAt(i % KEY.length)); });
  return btoa(bin);
};
const attr = (o) => JSON.stringify(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const searchHtml = `<html><body data-cfk="${KEY}"><smartfire-component name='competitions---search-results' attributes="${attr({
  type: 'structure',
  results: [
    { ext_competitionId: 32322, libelle: '+16ANS MASCULIN HONNEUR', type: 'REGIONAL', structure_libelle: 'LIGUE DE NORMANDIE', equipe_libelle: 'A.S.C. BONSECOURS', equipe_logo: 'logo-club.png' },
    { ext_competitionId: 32662, libelle: "COUPE DE FRANCE CAISSE D'EPARGNE REGIONALE MASCULINE 2026-2027", type: 'COUPE_DE_FRANCE', structure_libelle: 'FFHB', equipe_libelle: 'A.S.C. BONSECOURS', equipe_logo: 'logo-club.png' },
  ],
})}"></smartfire-component></body></html>`;

const pool = (team, phaseClassement = '1') => ({
  selected_equipe: { ext_equipeId: team, id: 'INT' + team, libelle: 'A.S.C. BONSECOURS' },
  selected_poule: { id: 'P1', libelle: 'POULE C', phaseId: 'PH1' },
  phases: [{ id: 'PH1', libelle: 'PHASE', classement: phaseClassement }],
  equipe_options: [{ ext_equipeId: team, libelle: 'A.S.C. BONSECOURS' }, { ext_equipeId: '9', libelle: 'AUTRE HB' }],
  poules: [{ ext_pouleId: 'X' }],
});
const matches = (team) => ({ rencontres: [
  { ext_rencontreId: 'M1', equipe1Id: 'INT' + team, equipe2Id: 'Z', equipe1Libelle: 'A.S.C. BONSECOURS', equipe2Libelle: 'AUTRE HB', equipe1Score: '30', equipe2Score: '25', date: '2026-10-10T21:15:00+02:00', journeeNumero: '4' },
  { ext_rencontreId: 'M2', equipe1Id: 'Z', equipe2Id: 'INT' + team, equipe1Libelle: 'AUTRE HB', equipe2Libelle: 'A.S.C. BONSECOURS', equipe1Score: 'FO', equipe2Score: '20', date: null, journeeNumero: '5' },
  { ext_rencontreId: 'M3', equipe1Id: 'INT' + team, equipe2Id: 'Z', equipe1Libelle: 'A.S.C. BONSECOURS', equipe2Libelle: 'AUTRE HB', equipe1Score: null, equipe2Score: null, date: '2026-11-07T21:00:00+01:00', journeeNumero: '6' },
  { ext_rencontreId: 'M4', equipe1Id: 'Q', equipe2Id: 'Z', equipe1Libelle: 'X', equipe2Libelle: 'Y', equipe1Score: '1', equipe2Score: '2' },
] });
const standings = (team) => ({ classements: [
  { place: '1', equipe_libelle: 'AUTRE HB', point: '12', joue: '4', gagne: '4', nul: '0', perdu: '0', butPlus: '100', butMoins: '80', diff: '20', equipeId: 'Z', pouleId: 'P1' },
  { place: '2', equipe_libelle: 'A.S.C. BONSECOURS', point: '10', joue: '4', gagne: '3', nul: '0', perdu: '1', butPlus: '90', butMoins: '85', diff: '5', equipeId: 'INT' + team, pouleId: 'P1' },
] });

const calls = [];
const fakeFetch = async (url) => {
  calls.push(url);
  const u = new URL(url, 'https://www.ffhandball.fr');
  const ok = (body, json = false) => ({ ok: true, status: 200, text: async () => body, json: async () => (json ? body : JSON.parse(body)) });
  if (u.pathname.endsWith('/recherche/')) return ok(searchHtml);
  if (u.pathname === '/competitions/') return ok(`<body data-cfk="${KEY}">`);
  if (u.pathname.includes('computeBlockAttributes')) {
    const p = Object.fromEntries(u.searchParams);
    const team = p.ext_equipe_id ?? (p.url_competition.endsWith('32322') ? '2118211' : '2220592');
    const coupe = p.url_competition.endsWith('32662');
    const body = { 'competitions---poule-selector': pool(team, coupe ? '0' : '1'), 'competitions---rencontre-list': matches(team), 'competitions---mini-classement-or-ads': standings(team) }[p.block];
    return ok(encode(body), true);
  }
  return { ok: false, status: 404 };
};

test('helpers', () => {
  assert.equal(slugify("COUPE DE FRANCE CAISSE D'EPARGNE REGIONALE MASCULINE 2026-2027", 32662), 'coupe-de-france-caisse-d-epargne-regionale-masculine-2026-2027-32662');
  assert.equal(slugify('+16ANS MASCULIN HONNEUR', 32322), '16ans-masculin-honneur-32322');
  assert.equal(categoryOf('+16 1ERE DIV MASCULINE 76', 'ASC BONSECOURS 2'), 'Seniors M 2');
  assert.equal(categoryOf('-15 MASCULINS CHAMPIONNAT 76', 'E BONSECOURS/BELBEUF (-15M DEP)'), '-15 M');
  assert.equal(categoryOf("COUPE DE FRANCE CAISSE D'EPARGNE REGIONALE MASCULINE", 'A.S.C. BONSECOURS'), 'Seniors M');
  assert.deepEqual(decodePayload(encode({ a: 'é' }), KEY), { a: 'é' });
});

test('syncClub de bout en bout (site simulé)', async () => {
  const d = await syncClub({ fetchImpl: fakeFetch, seasonId: 22, pauseMs: 0 });
  assert.equal(d.meta.clubLogo, 'logo-club');
  assert.equal(d.equipes.length, 2);
  const honneur = d.equipes.find((e) => e.id === '2118211');
  assert.equal(honneur.niveau, 'Régional');
  assert.equal(honneur.rang, 2);
  assert.equal(honneur.url, 'https://www.ffhandball.fr/competitions/saison-2026-2027-22/regional/16ans-masculin-honneur-32322/equipe-2118211/');
  const cdf = d.equipes.find((e) => e.id === '2220592');
  assert.equal(cdf.niveau, 'Coupe de France');
  assert.ok(cdf.url.includes('/coupe-de-france/'));
  assert.equal(cdf.classement.length, 0, 'pas de classement quand la phase n’en a pas');
  const m1 = d.matchs.find((m) => m.id === 'M1');
  assert.deepEqual(m1.score, [30, 25]);
  assert.equal(m1.dom, true);
  const m2 = d.matchs.find((m) => m.id === 'M2');
  assert.deepEqual(m2.forfait, { perdant: 'adv', code: 'FO' });
  assert.equal(m2.score, null);
  assert.equal(d.matchs.find((m) => m.id === 'M3').score, null);
  assert.ok(!d.matchs.some((m) => m.id === 'M4'), 'les matchs des autres équipes sont ignorés');
  assert.ok(calls.every((c) => c.startsWith('https://www.ffhandball.fr/')));
});

test('recherche vide : la liste enregistrée prend le relais', async () => {
  const emptySearch = async (url) => {
    const u = new URL(url, 'https://www.ffhandball.fr');
    if (u.pathname.endsWith('/recherche/')) return { ok: true, status: 200, text: async () => `<body data-cfk="${KEY}"><smartfire-component name='competitions---search-results' attributes="${attr({ results: [] })}">` };
    return fakeFetch(url);
  };
  const known = { saison: 22, clubLogo: 'logo-club', competitions: [{ id: '32322', libelle: '+16ANS MASCULIN HONNEUR', type: 'regional', organisateur: 'LIGUE DE NORMANDIE' }] };
  const d = await syncClub({ fetchImpl: emptySearch, seasonId: 22, pauseMs: 0, knownCompetitions: known });
  assert.equal(d.equipes.length, 1);
  assert.equal(d.equipes[0].competition, '+16ANS MASCULIN HONNEUR');
  assert.equal(d.meta.clubLogo, 'logo-club');
  const other = await syncClub({ fetchImpl: emptySearch, seasonId: 23, pauseMs: 0, knownCompetitions: known });
  assert.equal(other.equipes.length, 0, 'la liste d’une autre saison est ignorée');
});
