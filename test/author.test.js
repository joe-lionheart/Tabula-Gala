import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../server/game/game.js';
import { mockModerator } from '../server/llm/moderator.js';
import { createAuthor, mergeAdventure } from '../server/llm/author.js';
import { validateWorld } from '../server/content/validate.js';
import { seededRng } from '../server/engine/rng.js';

const base = JSON.parse(readFileSync(new URL('../content/klassische-fantasy/world.json', import.meta.url), 'utf8'));
const stats = { kraft: 3, agilitaet: 3, wahrnehmung: 2, verstand: 2, wort: 2 };

// Ein „erzeugtes“ Abenteuer: neue Geschichte, eigener Gegenstand, Szenengerüst aus dem Testabenteuer
function generated() {
  const scenes = structuredClone(base.scenes);
  scenes[0].title = 'Die Piratenbucht';
  scenes[1].shop.items.push({ item: 'entermesser', price: 2 });
  return {
    adventure: { title: 'Der Schatz der Möwe', pitch: 'Eine Möwe stiehlt die Schatzkarte.', tone: 'lustig', durationMin: 120, lesson: 'Teilen macht reich.' },
    scenes,
    items: [{ id: 'entermesser', name: 'Entermesser', w: 1, h: 2, weapon: { damage: '1W8', kind: 'klinge', stat: 'kraft' } }],
    enemies: [], lootTables: {},
  };
}

// Claude-API simulieren: gibt nacheinander die vorbereiteten Antworten zurück
function stubFetch(answers) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const input = answers[Math.min(calls.length - 1, answers.length - 1)];
    return { ok: true, json: async () => ({ content: [{ type: 'tool_use', id: `t${calls.length}`, name: 'write_adventure', input }], usage: { input_tokens: 5000, output_tokens: 6000 } }) };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

function lobby() {
  const g = new Game({ code: 'WISH', world: base, moderator: mockModerator(), rng: seededRng(5) });
  const a = g.join('Anna');
  g.createCharacter(a.playerId, { name: 'Mira', stats, kit: 0 });
  return { g, a: a.playerId };
}

test('Erzeugtes Abenteuer + Grundkatalog besteht die Prüfung', () => {
  const w = mergeAdventure(base, generated());
  assert.deepEqual(validateWorld(w).errors, []);
  assert.ok(w.items.some((i) => i.id === 'heiltrank') && w.items.some((i) => i.id === 'entermesser'));
  assert.equal(w.adventure.generated, true);
});

test('Wünsche: pro Person höchstens 3, nur vor dem Spiel', () => {
  const { g, a } = lobby();
  for (const t of ['Piraten', 'lustig', 'mit Esel']) assert.ok(g.addWish(a, t).ok);
  assert.equal(g.addWish(a, 'noch was').ok, false);
  assert.ok(g.addWish('host', 'nicht zu gruselig').ok);
  assert.equal(g.view(a).adventureGen.wishes.length, 4);
});

test('Ohne Schlüssel: Testabenteuer, Ablauf läuft trotzdem durch', async () => {
  const { g } = lobby();
  await g.writeAdventure(createAuthor({}), base);
  assert.equal(g.state.adventureGen.status, 'test');
  assert.equal(g.world.adventure.title, base.adventure.title);
});

test('Mit Schlüssel: kaputter Entwurf → Nachbesserung → fertiges Abenteuer wird gespielt und gesichert', async () => {
  const { g, a } = lobby();
  g.addWish(a, 'Piraten und eine freche Möwe');
  const broken = generated(); broken.scenes[2].exits = [];
  const stub = stubFetch([broken, generated()]);
  try {
    const p = g.writeAdventure(createAuthor({ ANTHROPIC_API_KEY: 'test' }), base);
    assert.equal(g.state.adventureGen.status, 'writing');
    assert.equal(g.startGame().ok, false);                       // nicht starten, solange geschrieben wird
    await p;
  } finally { stub.restore(); }
  assert.equal(stub.calls.length, 2);
  assert.match(JSON.stringify(stub.calls[0].messages), /Möwe/);  // Wünsche kommen an
  assert.match(JSON.stringify(stub.calls[1].messages), /Fehler/); // zweite Runde bekommt die Fehler
  assert.equal(g.state.adventureGen.status, 'ready');
  assert.equal(g.world.adventure.title, 'Der Schatz der Möwe');
  assert.equal(g.state.ai.tokensIn, 10000);
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  assert.equal(snap.world.adventure.title, 'Der Schatz der Möwe');
  const h = Game.restore(snap, { world: base, moderator: mockModerator() });
  assert.equal(h.world.adventure.title, 'Der Schatz der Möwe');
  assert.ok(g.startGame().ok);
  assert.equal(g.scene.title, 'Die Piratenbucht');
});

test('Zweimal kaputt: Rückfall aufs Testabenteuer', async () => {
  const { g } = lobby();
  const broken = generated(); broken.scenes = broken.scenes.slice(0, 1);
  const stub = stubFetch([broken]);
  try { await g.writeAdventure(createAuthor({ ANTHROPIC_API_KEY: 'test' }), base); } finally { stub.restore(); }
  assert.equal(g.state.adventureGen.status, 'failed');
  assert.equal(g.world, base);
  assert.ok(g.startGame().ok);
});
