// Prüft eine Welt-/Abenteuerdatei, bevor sie gespielt wird. Gilt für handgeschriebene
// und für vom Moderator erzeugte Abenteuer. Harte Fehler blockieren, Kleinigkeiten werden repariert.
import { STATS } from '../engine/rules.js';
import { knownBed, knownSfx } from '../audio/director.js';

const WEAPON_KINDS = ['klinge', 'stumpf', 'bogen', 'faust'];
const EXIT_IDS = ['exit_1', 'exit_2', 'exit_3'];
const ARCS = ['exposition', 'steigerung', 'peripetie', 'erkenntnis', 'loesung'];
const isStr = (v, min = 1) => typeof v === 'string' && v.trim().length >= min;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export function validateWorld(world) {
  const errors = [];
  const fixes = [];
  const err = (m) => errors.push(m);
  if (!world || typeof world !== 'object') return { ok: false, errors: ['keine Welt'], fixes };

  const adv = world.adventure || {};
  if (!isStr(adv.title)) err('adventure.title fehlt');
  if (!isStr(adv.pitch)) err('adventure.pitch fehlt');
  if (!isInt(adv.durationMin, 30, 300)) err('adventure.durationMin muss 30–300 sein');

  const items = new Map((world.items || []).map((i) => [i.id, i]));
  if (!Array.isArray(world.items) || !world.items.length) err('items fehlen');
  for (const it of world.items || []) {
    if (!isStr(it.id) || !isStr(it.name)) err(`Gegenstand ohne id/name: ${JSON.stringify(it).slice(0, 60)}`);
    if (!isInt(it.w ?? 1, 1, 4) || !isInt(it.h ?? 1, 1, 4)) err(`${it.id}: Größe 1–4`);
    if (it.weapon) {
      if (!STATS.includes(it.weapon.stat)) err(`${it.id}: Waffenwert unbekannt`);
      if (!WEAPON_KINDS.includes(it.weapon.kind)) err(`${it.id}: Waffenart unbekannt`);
      if (!/^\d+W\d+(\+\d+)?$/.test(it.weapon.damage || '')) err(`${it.id}: Schaden wie 1W8+1 angeben`);
    }
    if (it.use && !isInt(it.use.heal, 1, 60)) err(`${it.id}: Heilung 1–60`);
  }
  if (!items.has('silberbeutel') && world.startSilver) err('startSilver braucht den Gegenstand silberbeutel');

  const tables = world.lootTables || {};
  for (const [id, rows] of Object.entries(tables)) {
    for (const r of rows) if (!items.has(r.item)) err(`Loot-Tabelle ${id}: Gegenstand ${r.item} unbekannt`);
  }
  const enemies = new Map((world.enemies || []).map((e) => [e.id, e]));
  for (const e of world.enemies || []) {
    if (!isStr(e.id) || !isStr(e.name)) err('Gegner ohne id/name');
    if (!isInt(e.stufe, 1, 5)) err(`${e.id}: Stufe 1–5`);
    if (e.loot && !tables[e.loot]) err(`${e.id}: Loot-Tabelle ${e.loot} fehlt`);
    if (e.sound && !knownSfx(e.sound)) { fixes.push(`${e.id}: Klang ${e.sound} unbekannt, entfernt`); delete e.sound; }
  }
  for (const choice of world.startKitChoices || []) for (const id of choice) if (!items.has(id)) err(`Startausrüstung: ${id} unbekannt`);
  if (!Array.isArray(world.startKitChoices) || !world.startKitChoices.length) err('startKitChoices fehlen');
  if (!Array.isArray(world.abilities) || world.abilities.length < 4) err('mindestens 4 Fähigkeiten');

  const scenes = world.scenes || [];
  if (scenes.length < 3 || scenes.length > 8) err('3–8 Szenen');
  const ids = new Set();
  for (const s of scenes) {
    const at = `Szene ${s.id || '?'}`;
    if (!isStr(s.id) || ids.has(s.id)) err(`${at}: id fehlt oder doppelt`);
    ids.add(s.id);
    if (!isInt(s.act, 1, 3)) err(`${at}: Akt 1–3`);
    if (s.arc && !ARCS.includes(s.arc)) { fixes.push(`${at}: Bogen ${s.arc} unbekannt, entfernt`); delete s.arc; }
    if (!isStr(s.title) || !isStr(s.intro, 40)) err(`${at}: Titel oder Einstieg fehlt`);
    if (!Array.isArray(s.anchors) || s.anchors.length < 2) err(`${at}: mindestens 2 Raumanker`);
    if (!isStr(s.abortSignal)) err(`${at}: Abbruchsignal fehlt`);
    if (!isInt(s.budgetMin, 5, 60)) err(`${at}: Budget 5–60 Min`);
    if (!Array.isArray(s.exits) || s.exits.length !== 3 || s.exits.some((e, i) => e.id !== EXIT_IDS[i] || !isStr(e.label))) err(`${at}: genau 3 Ausgänge exit_1..exit_3 mit Text`);
    if (!knownBed(s.ambience)) { fixes.push(`${at}: Klangteppich ${s.ambience} unbekannt, Stille`); s.ambience = 'silence'; }
    const sfx = (s.allowedSfx || []).filter(knownSfx);
    if (sfx.length !== (s.allowedSfx || []).length) fixes.push(`${at}: unbekannte Klänge entfernt`);
    s.allowedSfx = sfx;
    for (const id of s.enemies || []) if (!enemies.has(id)) err(`${at}: Gegner ${id} unbekannt`);
    if (s.loot && !tables[s.loot]) err(`${at}: Loot-Tabelle ${s.loot} fehlt`);
    const npcIds = new Set((s.npcs || []).map((n) => n.id));
    for (const n of s.npcs || []) if (!isStr(n.id) || !isStr(n.name) || !isStr(n.wants)) err(`${at}: Nebenfigur braucht id, name, wants`);
    for (const c of s.chests || []) {
      if (!isStr(c.id) || !isStr(c.label) || !tables[c.loot]) err(`${at}: Truhe ${c.id} braucht label und Loot-Tabelle`);
      if (c.lock && (!STATS.includes(c.lock.stat) || !isInt(c.lock.dc, 5, 25))) err(`${at}: Truhe ${c.id}: Schloss braucht Wert und DC 5–25`);
      if (c.lock?.key && !items.has(c.lock.key)) err(`${at}: Truhe ${c.id}: Schlüssel ${c.lock.key} unbekannt`);
    }
    for (const r of s.riddles || []) {
      if (!isStr(r.id) || !isStr(r.question, 10) || !Array.isArray(r.answers) || !r.answers.length) err(`${at}: Rätsel braucht id, Frage, Lösungen`);
      if (r.npc && !npcIds.has(r.npc)) err(`${at}: Rätsel ${r.id}: Nebenfigur ${r.npc} nicht in der Szene`);
      if (r.stat && !STATS.includes(r.stat)) err(`${at}: Rätsel ${r.id}: Wert unbekannt`);
      if (r.reward?.chest && !(s.chests || []).some((c) => c.id === r.reward.chest)) err(`${at}: Rätsel ${r.id}: Truhe ${r.reward.chest} fehlt`);
      for (const id of r.reward?.reveal || []) if (!(tables[s.loot] || []).some((e) => e.item === id && e.hidden)) err(`${at}: Rätsel ${r.id}: ${id} ist kein verborgener Loot der Szene`);
    }
    if (s.shop) {
      if (!npcIds.has(s.shop.npc)) err(`${at}: Laden gehört keiner Nebenfigur der Szene`);
      for (const e of s.shop.items || []) if (!items.has(e.item) || !isInt(e.price, 0, 50)) err(`${at}: Ladenartikel ${e.item} unbekannt oder Preis ungültig`);
    }
  }
  // Wege: jede Szene erreichbar, Ziele existieren, Akte laufen nicht rückwärts, es gibt ein Ende
  const byId = new Map(scenes.map((s) => [s.id, s]));
  let hasEnd = false;
  for (const s of scenes) for (const e of s.exits || []) {
    if (e.to === null || e.to === undefined) { hasEnd = true; continue; }
    const t = byId.get(e.to);
    if (!t) err(`Szene ${s.id}: Ausgang ${e.id} führt ins Leere (${e.to})`);
    else if (t.act < s.act) err(`Szene ${s.id}: Ausgang ${e.id} springt in einen früheren Akt`);
  }
  if (!hasEnd) err('kein Ende: mindestens ein Ausgang braucht to: null');
  if (scenes.length) {
    const seen = new Set([scenes[0].id]);
    const queue = [scenes[0]];
    while (queue.length) for (const e of queue.shift().exits || []) if (e.to && byId.has(e.to) && !seen.has(e.to)) { seen.add(e.to); queue.push(byId.get(e.to)); }
    for (const s of scenes) if (!seen.has(s.id)) err(`Szene ${s.id} ist nicht erreichbar`);
  }
  return { ok: errors.length === 0, errors, fixes };
}
