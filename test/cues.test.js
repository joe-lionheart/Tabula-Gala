import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchCues, DEFAULT_TRIGGERS, SFX_LABELS, sanitizeTriggers, normalize } from '../public/js/cues.js';

const manifest = JSON.parse(readFileSync(new URL('../public/audio/manifest.json', import.meta.url), 'utf8'));

test('Standard-Zuordnungen zeigen nur auf Klänge, die es gibt; jeder Effekt hat einen deutschen Namen', () => {
  for (const t of DEFAULT_TRIGGERS) {
    if (t.bed) assert.ok(manifest.beds[t.bed], `Teppich fehlt: ${t.bed}`);
    if (t.sfx) assert.ok(manifest.sfx[t.sfx], `Effekt fehlt: ${t.sfx}`);
  }
  for (const id of Object.keys(manifest.sfx)) assert.ok(SFX_LABELS[id], `Name fehlt: ${id}`);
});

test('Stichworte im Satz: Wortanfang, Reihenfolge, Groß/Klein egal', () => {
  const r = matchCues('In der Ferne läuten die Glocken, und die Tür knarrt.', DEFAULT_TRIGGERS, { now: 1 });
  assert.deepEqual(r.map((h) => h.id), ['bell', 'door_creak']);
  assert.equal(r[0].word, 'läuten');
});

test('Kurze Wörter nur exakt: „Türkis“ ist keine Tür', () => {
  assert.deepEqual(matchCues('Ein türkisfarbener Stein', DEFAULT_TRIGGERS, { now: 1 }), []);
});

test('Ort wechselt den Teppich, höchstens ein Teppich pro Satz', () => {
  const r = matchCues('Ihr verlasst das Wirtshaus und geht in den Wald.', DEFAULT_TRIGGERS, { now: 1 });
  assert.deepEqual(r.map((h) => `${h.kind}:${h.id}`), ['bed:tavern']);
});

test('Mehrwortige Stichworte und Kampf', () => {
  const r = matchCues('Der Wegelagerer greift an!', DEFAULT_TRIGGERS, { now: 1 });
  assert.deepEqual(r.map((h) => h.id), ['combat']);
});

test('Sperrzeit: derselbe Klang nicht doppelt (Zwischenergebnisse der Erkennung)', () => {
  const last = new Map();
  assert.equal(matchCues('die Glocke', DEFAULT_TRIGGERS, { now: 1000, last }).length, 1);
  assert.equal(matchCues('die Glocke schlägt', DEFAULT_TRIGGERS, { now: 3000, last }).length, 0);
  assert.equal(matchCues('die Glocke schlägt', DEFAULT_TRIGGERS, { now: 10000, last }).length, 1);
});

test('Eigene Zuordnungen: Unbekanntes fliegt raus', () => {
  const t = sanitizeTriggers([{ sfx: 'bell', words: ['bimmel'] }, { sfx: 'kanone', words: ['bumm'] }, { bed: 'tavern', words: [] }], { beds: ['tavern'], sfx: ['bell'] });
  assert.deepEqual(t, [{ sfx: 'bell', words: ['bimmel'] }]);
  assert.equal(matchCues('es bimmelt', t, { now: 1 })[0].id, 'bell');
  assert.equal(normalize('Straße!'), 'strasse');
});
