import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../server/game/game.js';
import { mockModerator } from '../server/llm/moderator.js';
import { validateJudgment } from '../server/llm/contract.js';
import { seededRng } from '../server/engine/rng.js';

const world = JSON.parse(readFileSync(new URL('../content/klassische-fantasy/world.json', import.meta.url), 'utf8'));
const stats = { kraft: 3, agilitaet: 3, wahrnehmung: 2, verstand: 2, wort: 2 };

function setup() {
  const events = [];
  const g = new Game({ code: 'TEST', world, moderator: mockModerator(), rng: seededRng(7) });
  g.subscribe((m) => events.push(m));
  const a = g.join('Anna'), b = g.join('Ben');
  assert.ok(g.createCharacter(a.playerId, { name: 'Mira', concept: 'Diebin mit Herz', stats, kit: 2 }).ok);
  assert.ok(g.createCharacter(b.playerId, { name: 'Bruno', concept: 'Schmied', stats, kit: 1 }).ok);
  g.startGame();
  clearTimeout(g.quietTimer);
  return { g, a, b, events };
}

test('Start: KI-Hinweis, Szene 1, Wirtshaus-Klang', () => {
  const { g, events } = setup();
  assert.equal(g.state.phase, 'playing');
  assert.equal(g.scene.id, 's1-wirtshaus');
  assert.match(events.find((e) => e.type === 'say').text, /künstliche Intelligenz/);
  assert.equal(events.find((e) => e.type === 'cue').cue.bed, 'tavern');
  assert.equal(g.state.loot.length, 3);
  assert.equal(g.state.hiddenLoot.length, 1);
});

test('Sprecher: Antippen ordnet zu, sonst „unklar“ und Nachfrage', async () => {
  const { g, a, events } = setup();
  g.utterance({ text: 'Wer war das?' });
  clearTimeout(g.quietTimer);
  assert.equal(g.state.transcript.at(-1).speakerId, 'unklar');
  await g.runModerator();
  assert.match(events.filter((e) => e.type === 'say').at(-1).text, /wer von euch/i);
  g.claimSpeaker(a.playerId);
  g.utterance({ text: 'Ich untersuche den Kamin' });
  clearTimeout(g.quietTimer);
  assert.equal(g.state.transcript.at(-1).speakerName, 'Mira');
});

test('Probe vom Moderator → Würfel am Handy → Erzählung + verborgener Loot', async () => {
  const { g, a } = setup();
  g.utterance({ text: 'Ich untersuche den Kamin genau', speakerId: a.playerId });
  clearTimeout(g.quietTimer);
  await g.runModerator();
  assert.equal(g.state.pendingCheck.player_id, a.playerId);
  const r = g.rollCheck(a.playerId, 18);
  assert.ok(r.ok);
  assert.ok(r.result.succeeded);
  assert.ok(g.state.loot.some((l) => l.itemId === 'quasts_brief'));
  assert.equal(g.state.pendingCheck, null);
});

test('Kampf: Moderator startet, Angriff mit Waffe, Treffer-Sound, Kampfende', async () => {
  const { g, b, events } = setup();
  g.utterance({ text: 'Ich greife den Typen an der Tür an', speakerId: b.playerId });
  clearTimeout(g.quietTimer);
  await g.runModerator();
  assert.ok(g.state.combat);
  const combatCue = events.filter((e) => e.type === 'cue').at(-1).cue;
  assert.equal(combatCue.bed, 'combat');
  const inv = g.state.inventories[g.charOf(b.playerId).id];
  const weapon = inv.items.find((i) => i.itemId === 'streitkolben');
  const res = g.attack(b.playerId, { weaponUid: weapon.uid, natural: 19 });
  assert.ok(res.ok);
  const hitCue = events.filter((e) => e.type === 'cue').at(-1).cue;
  assert.deepEqual(hitCue.sfx.map((s) => s.id).slice(0, 3), ['dice_roll', 'club_swing', 'club_hit']);
  const enemy = g.state.combat.enemies[0];
  while (!enemy.defeated) g.attack(b.playerId, { weaponUid: weapon.uid, natural: 19 });
  g.endCombat('Vorbei.');
  clearTimeout(g.quietTimer);
  assert.equal(g.state.combat, null);
  assert.equal(events.filter((e) => e.type === 'cue').at(-1).cue.bed, 'tavern');
  assert.ok(g.state.loot.some((l) => l.itemId === 'dolch'));
});

test('Parade: Fehlwurf spielt Parade und Schmerz', async () => {
  const { g, b, events } = setup();
  g.startCombat(['wegelagerer']);
  g.attack(b.playerId, { natural: 2 });
  const ids = events.filter((e) => e.type === 'cue').at(-1).cue.sfx.map((s) => s.id);
  assert.ok(ids.includes('parry') && ids.includes('player_hurt'));
});

test('Loot nehmen, Heiltrank benutzen', () => {
  const { g, a } = setup();
  const ch = g.charOf(a.playerId);
  g.takeLoot(a.playerId, g.state.loot.find((l) => l.itemId === 'laterne').lootId);
  assert.ok(g.state.inventories[ch.id].items.some((i) => i.itemId === 'laterne'));
  ch.lp = 50;
  const trank = g.state.inventories[ch.id].items.find((i) => i.itemId === 'heiltrank');
  g.useItem(a.playerId, trank.uid);
  assert.equal(ch.lp, 70);
});

test('Szenenwechsel über Ausgang bis zum Ende, Meilenstein', () => {
  const { g, a } = setup();
  g.nextScene('exit_1');
  assert.equal(g.scene.id, 's2-moorpfad');
  g.nextScene('exit_2');
  assert.equal(g.scene.id, 's3-kapelle');
  g.nextScene('exit_2');
  assert.equal(g.state.phase, 'ended');
  assert.ok(g.chooseMilestone(a.playerId, { stat: 'wort' }).ok);
  assert.equal(g.charOf(a.playerId).stats.wort, 3);
});

test('Vertrag: unbekannte IDs werden verworfen, DC wird später geklemmt', () => {
  const { g, a } = setup();
  const ctx = { characters: g.characters, scene: g.scene, hiddenLoot: ['quasts_brief'] };
  const { judgment, problems } = validateJudgment({
    narration: 'Test', scene_signal: 'weiter',
    check: { player_id: 'fremd', stat: 'wort', dc: 12, reason: 'x', on_success: 'a', on_fail: 'b' },
    combat: { start: ['drache'] }, reveal_loot: ['quasts_brief', 'krone'],
  }, ctx);
  assert.equal(judgment.check, null);
  assert.equal(judgment.combat, null);
  assert.deepEqual(judgment.reveal_loot, ['quasts_brief']);
  assert.equal(judgment.scene_signal, 'continue');
  assert.ok(problems.length >= 3);
  const ok = validateJudgment({ narration: 'x', scene_signal: 'continue', check: { player_id: a.playerId, stat: 'kraft', dc: 99, reason: 'x', on_success: 'a', on_fail: 'b' } }, ctx);
  g.requestCheck(ok.judgment.check);
  assert.equal(g.rollCheck(a.playerId, 10).result.dc, 25);
});
