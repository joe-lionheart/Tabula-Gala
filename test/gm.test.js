import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../server/game/game.js';
import { mockModerator } from '../server/llm/moderator.js';
import { seededRng } from '../server/engine/rng.js';

const base = JSON.parse(readFileSync(new URL('../content/klassische-fantasy/world.json', import.meta.url), 'utf8'));
const stats = { kraft: 3, agilitaet: 3, wahrnehmung: 2, verstand: 2, wort: 2 };

function gmGame() {
  const logs = [];
  const msgs = [];
  const g = new Game({ code: 'SPLT', world: base, mode: 'gm', moderator: mockModerator(), rng: seededRng(7), log: (e) => logs.push(e) });
  g.subscribe((m) => msgs.push(m));
  const a = g.join('Anna');
  g.createCharacter(a.playerId, { name: 'Mira', stats, kit: 0 });
  return { g, a: a.playerId, logs, msgs };
}

test('GMSB: keine KI, freie Szene, keine Erzählstimme, kein Szenenklang', () => {
  const { g, msgs } = gmGame();
  assert.equal(g.state.mode, 'gm');
  assert.equal(g.state.ai.enabled, false);
  assert.equal(g.setAi(true).ok, false);
  assert.ok(g.startGame().ok);
  assert.equal(g.scene.title, 'Freies Spiel');
  assert.equal(msgs.filter((m) => m.type === 'say').length, 0);
  assert.equal(msgs.filter((m) => m.type === 'cue').length, 0);
  const v = g.view('host');
  assert.equal(v.mode, 'gm');
  assert.ok(v.catalog.some((i) => i.id === 'heiltrank'));
  assert.equal(g.view(g.state.players[0].id).catalog, undefined); // Katalog nur für die Spielleitung
});

test('Gesprochenes wird ohne Mitschnitt verworfen, mit Mitschnitt gespeichert', () => {
  const { g, logs } = gmGame();
  g.startGame();
  assert.equal(g.gmSpeech({ text: 'Die Glocke läutet.' }).stored, false);
  assert.equal(g.gmCue({ kind: 'sfx', id: 'bell', source: 'voice', word: 'läutet' }).ok, true);
  assert.equal(logs.find((l) => l.type === 'gm_cue').word, undefined); // ohne Mitschnitt kein Wortlaut
  assert.equal(g.setRecording(true).ok, false); // ohne Einwilligung kein Mitschnitt
  assert.ok(g.setRecording(true, { consent: true, note: 'Testtisch' }).ok);
  assert.equal(g.view(g.state.players[0].id).recording.on, true); // Handys sehen, dass mitgeschnitten wird
  assert.equal(g.gmSpeech({ text: 'Die Glocke läutet.', cues: [{ kind: 'sfx', id: 'bell', word: 'läutet' }] }).stored, true);
  g.gmCue({ kind: 'sfx', id: 'bell', source: 'voice', word: 'läutet' });
  assert.equal(logs.filter((l) => l.type === 'gm_speech').length, 1);
  assert.equal(logs.filter((l) => l.type === 'gm_cue').at(-1).word, 'läutet');
  g.endGame();
  assert.equal(g.state.recording.on, false); // Ende des Abends beendet den Mitschnitt
});

test('Unbekannte Klänge werden abgelehnt', () => {
  const { g } = gmGame();
  assert.equal(g.gmCue({ kind: 'sfx', id: 'kanone' }).ok, false);
  assert.equal(g.gmCue({ kind: 'bed', id: 'tavern' }).ok, true);
});

test('Fund von Hand landet auf allen Handys, Handy nimmt ihn', () => {
  const { g, a, msgs } = gmGame();
  assert.equal(g.gmLoot({ items: [{ itemId: 'heiltrank' }] }).ok, false); // erst nach Spielstart
  g.startGame();
  assert.equal(g.gmLoot({ items: [{ itemId: 'gibtsnicht' }] }).ok, false);
  assert.ok(g.gmLoot({ items: [{ itemId: 'heiltrank', qty: 2 }, { itemId: 'dolch' }], label: 'Truhe im Keller' }).ok);
  assert.equal(g.state.loot.length, 2);
  assert.ok(msgs.some((m) => m.type === 'buzz' && m.all));
  assert.match(g.state.feed.at(-1).text, /Truhe im Keller: Heiltrank ×2, Dolch/);
  assert.ok(g.takeLoot(a, g.state.loot[1].lootId).ok);
});

test('Probe, Schaden und Heilung von Hand', () => {
  const { g, a } = gmGame();
  g.startGame();
  assert.ok(g.requestCheck({ player_id: a, stat: 'kraft', dc: 12, reason: 'Tor aufstemmen', on_success: '', on_fail: '' }, 'host').ok);
  assert.ok(g.rollCheck(a, 15).ok);
  const ch = g.charOf(a);
  const before = ch.lp;
  assert.ok(g.gmLp({ playerId: a, delta: -10, reason: 'Pfeil' }).ok);
  assert.equal(ch.lp, before - 10);
  assert.ok(g.gmLp({ playerId: a, delta: 5 }).ok);
  assert.equal(g.gmLp({ playerId: a, delta: 0 }).ok, false);
  assert.equal(g.gmLp({ playerId: 'x', delta: 3 }).ok, false);
});

test('Spielleiter-Runde übersteht einen Neustart', () => {
  const { g } = gmGame();
  g.startGame();
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const h = Game.restore(snap, { world: base, moderator: mockModerator() });
  assert.equal(h.state.mode, 'gm');
  assert.equal(h.scene.title, 'Freies Spiel');
  assert.equal(h.state.ai.enabled, false);
});
