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

test('Aktwechsel: Rast, Meilenstein, weiter; am Ende nur speichern', () => {
  const w = structuredClone(world);
  w.scenes[2].act = 2;                     // Moorpfad testweise als Akt II
  for (const sc of w.scenes.slice(3)) sc.act = 3;
  w.scenes[2].exits.forEach((e) => { e.to = null; });
  const g = new Game({ code: 'AKT', world: w, moderator: mockModerator(), rng: seededRng(3) });
  g.autoContinue = false;
  const a = g.join('Anna');
  g.createCharacter(a.playerId, { name: 'Mira', stats, kit: 0 });
  g.startGame(); clearTimeout(g.quietTimer);
  const ch = g.charOf(a.playerId);
  g.nextScene('exit_1');
  assert.equal(g.scene.id, 's2-schmiede');
  ch.lp = 10;
  g.nextScene('exit_2');
  assert.equal(g.state.phase, 'interlude');
  assert.equal(ch.lp, 50);                  // Rast +40
  assert.equal(g.view(a.playerId).milestoneOpen, true);
  assert.ok(g.chooseMilestone(a.playerId, { stat: 'wort' }).ok);
  assert.equal(ch.stats.wort, 3);
  assert.ok(g.continueAct().ok);
  assert.equal(g.state.phase, 'playing');
  assert.equal(g.scene.id, 's3-moorpfad');
  assert.deepEqual(g.state.path.map((p) => p.exitId), ['exit_1', 'exit_2']);
  g.nextScene('exit_3');
  assert.equal(g.state.phase, 'ended');
  assert.equal(g.chooseMilestone(a.playerId, { stat: 'kraft' }).ok, false);
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

test('Wiederbeitritt: gleicher Name bekommt den alten Platz, nur wenn getrennt', () => {
  const { g, a } = setup();
  assert.equal(g.join('anna').ok, false);           // Anna ist noch verbunden
  g.player(a.playerId).connected = false;
  const r = g.join(' Anna ');
  assert.ok(r.ok && r.rejoined);
  assert.equal(r.playerId, a.playerId);
  assert.equal(r.token, a.token);
  assert.equal(g.state.players.length, 2);
});

test('Nachzügler baut während des Spiels eine Figur und wird angekündigt', () => {
  const { g, events } = setup();
  const c = g.join('Carla');
  const r = g.createCharacter(c.playerId, { name: 'Edda', concept: 'Kräuterfrau', stats, kit: 0 });
  assert.ok(r.ok);
  assert.match(events.filter((e) => e.type === 'say').at(-1).text, /Edda stößt zu euch/);
  assert.equal(g.createCharacter(c.playerId, { name: 'Edda', stats, kit: 0 }).ok, false);
});

test('Wiederherstellen nach Neustart: Zustand, Tokens, pausiert, alle getrennt', () => {
  const { g, a } = setup();
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const h = Game.restore(snap, { world, moderator: mockModerator(), rng: seededRng(1) });
  assert.equal(h.code, g.code);
  assert.ok(h.isHost(g.hostToken));
  assert.equal(h.authPlayer(a.token).id, a.playerId);
  assert.equal(h.scene.id, g.scene.id);
  assert.equal(h.state.paused, true);
  assert.ok(h.state.players.every((p) => !p.connected));
  assert.equal(h.state.ai.busy, false);
});

test('Kampfbeginn lässt alle Handys vibrieren', async () => {
  const { g, events } = setup();
  g.startCombat(['wegelagerer']);
  assert.ok(events.some((e) => e.type === 'buzz' && e.all && e.kind === 'combat'));
});

test('Sprecher: Antippen während der Moderator spricht verfällt nicht', () => {
  const { g, a } = setup();
  g.setNarrating(true);
  g.claimSpeaker(a.playerId);
  g.state.activeSpeaker.until = Date.now() - 1;    // Zeitfenster wäre ohne Erzählstimme abgelaufen
  g.setNarrating(false);
  g.state.activeSpeaker.until = Date.now() + 5000; // nach der Erzählung gibt es wieder volle Zeit
  g.utterance({ text: 'Ich frage den Wirt nach Lene' });
  clearTimeout(g.quietTimer);
  assert.equal(g.state.transcript.at(-1).speakerName, 'Mira');
});

test('Sprecher: zählt der Satzbeginn, nicht das Satzende; Folgesätze gehören dazu', () => {
  const { g, a } = setup();
  g.claimSpeaker(a.playerId);
  const claimedAt = Date.now();
  g.state.activeSpeaker.until = claimedAt - 100;          // Fenster beim Satzende schon vorbei …
  g.utterance({ text: 'Ich klettere auf das Dach', startedAt: claimedAt - 2000 }); // … aber Satz begann drin
  clearTimeout(g.quietTimer);
  assert.equal(g.state.transcript.at(-1).speakerName, 'Mira');
  assert.ok(g.state.activeSpeaker.until > Date.now());   // verlängert für den nächsten Satz
  g.utterance({ text: 'und schaue in den Hof' });
  clearTimeout(g.quietTimer);
  assert.equal(g.state.transcript.at(-1).speakerName, 'Mira');
  clearTimeout(g.speakerTimer);
});

test('Sprecher: abgelaufenes Wort wird an alle gemeldet', async () => {
  const { g, a, events } = setup();
  g.claimSpeaker(a.playerId);
  g.state.activeSpeaker.until = Date.now() + 30;
  g.armSpeakerExpiry();
  const before = events.length;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(g.state.activeSpeaker, null);
  assert.ok(events.slice(before).some((e) => e.type === 'state'));
});
