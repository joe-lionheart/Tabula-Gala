import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../server/game/game.js';
import { mockModerator } from '../server/llm/moderator.js';
import { seededRng } from '../server/engine/rng.js';
import { validateWorld } from '../server/content/validate.js';
import { rateAnswer, scoreArgument, priceFor } from '../server/engine/social.js';

const load = () => JSON.parse(readFileSync(new URL('../content/klassische-fantasy/world.json', import.meta.url), 'utf8'));
const stats = { kraft: 3, agilitaet: 3, wahrnehmung: 2, verstand: 2, wort: 2 };

function table() {
  const g = new Game({ code: 'MOOR', world: load(), moderator: mockModerator(), rng: seededRng(11) });
  g.autoContinue = false;
  const events = [];
  g.subscribe((m) => events.push(m));
  const a = g.join('Anna'), b = g.join('Ben');
  g.createCharacter(a.playerId, { name: 'Mira', concept: 'Diebin', stats, kit: 2 });
  g.createCharacter(b.playerId, { name: 'Bruno', concept: 'Schmied', stats, kit: 1 });
  g.startGame();
  clearTimeout(g.quietTimer);
  // Sprechen + Moderator sofort, ohne Wartezeit
  const talk = async (pid, text) => { g.utterance({ text, speakerId: pid }); clearTimeout(g.quietTimer); await g.runModerator(); };
  return { g, a: a.playerId, b: b.playerId, events, talk };
}

test('Abenteuerdatei besteht die Prüfung, 3 Akte, aristotelischer Bogen', () => {
  const w = load();
  const r = validateWorld(w);
  assert.deepEqual(r.errors, []);
  assert.deepEqual([...new Set(w.scenes.map((s) => s.act))], [1, 2, 3]);
  assert.deepEqual(w.scenes.map((s) => s.arc), ['exposition', 'steigerung', 'steigerung', 'peripetie', 'erkenntnis', 'loesung']);
  assert.ok(w.adventure.lesson);
});

test('Prüfung findet kaputte Abenteuer', () => {
  const w = load();
  w.scenes[1].exits[0].to = 'nirgendwo';
  w.scenes[1].riddles[0].answers = [];
  w.scenes[1].shop.items.push({ item: 'drachenei', price: 2 });
  const r = validateWorld(w);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /ins Leere/.test(e)));
  assert.ok(r.errors.some((e) => /Rätsel/.test(e)));
  assert.ok(r.errors.some((e) => /Ladenartikel drachenei/.test(e)));
});

test('Regeln: Rätselwertung, Argument, Preis', () => {
  const riddle = { answers: ['glocke'], near: ['kessel'] };
  assert.equal(rateAnswer(riddle, 'Ich glaube, eine Glocke!', 'falsch'), 'richtig');   // Lösungswort schlägt KI
  assert.equal(rateAnswer(riddle, 'ein Kessel?', 'falsch'), 'nah');
  assert.equal(rateAnswer(riddle, 'ein Hund', 'falsch'), 'falsch');
  assert.equal(rateAnswer(riddle, 'das Ding im Kirchturm, das bimmelt', 'richtig'), 'richtig');
  assert.equal(scoreArgument({ begruendung: 2, bezug: 2, ton: 1 }, 2).tier, 'stark');
  assert.equal(scoreArgument({ begruendung: 1, bezug: 1, ton: 0 }, 4).tier, 'erfolg');   // Wort 4 gibt +1
  assert.equal(scoreArgument({ begruendung: 0, bezug: 0, ton: 0 }, 2).tier, 'abgelehnt');
  assert.equal(priceFor(4, { discount: 0.5 }), 2);
  assert.equal(priceFor(4, { discount: null }), null);
});

test('Schmiede: verhandeln, billiger kaufen, Rätsel nah dran, nachbessern, Kiste, schnellster Finger', async () => {
  const { g, a, b, events, talk } = table();
  g.nextScene('exit_1');
  assert.equal(g.scene.id, 's2-schmiede');
  const mira = g.charOf(a);
  assert.equal(g.silverOf(mira), 3);

  await talk(a, 'Meister Grimbart, gib uns einen besseren Preis, weil wir dein Dorf vor dem Moor retten. Bitte.');
  const deal = g.state.deals[`${a}:grimbart`];
  assert.ok(['stark', 'erfolg'].includes(deal.tier));
  const bow = g.shopView(a).items.find((i) => i.itemId === 'kurzbogen');
  assert.ok(bow.price < bow.list);
  assert.ok(g.buy(a, 'kurzbogen').ok);
  assert.equal(g.silverOf(mira), 3 - bow.price);
  assert.equal(g.shopView(b).items.find((i) => i.itemId === 'kurzbogen').price, 3);   // Ben hat nicht verhandelt

  await talk(a, 'Grimbart, stell uns das Rätsel über der Tür');
  assert.equal(g.state.riddle.id, 'glocke');
  assert.match(events.filter((e) => e.type === 'say').at(-1).text, /Bauch/);
  await talk(b, 'Ein Kessel?');
  assert.equal(g.state.pendingCheck.riddle_id, 'glocke');                 // nah dran → Verstand-Probe
  assert.ok(g.rollCheck(b, 20).ok);
  assert.ok(g.state.solvedRiddles.includes('glocke'));
  assert.ok(g.state.openedChests.includes('grimbarts_kiste'));
  assert.ok(events.some((e) => e.type === 'buzz' && e.kind === 'loot'));

  const panzer = g.state.loot.find((l) => l.itemId === 'lederpanzer');
  assert.ok(g.takeLoot(b, panzer.lootId).ok);
  assert.equal(g.takeLoot(a, panzer.lootId).ok, false);                    // zu spät
});

test('Falsche Antworten kosten Zeit, Hinweis nach zwei Fehlversuchen', async () => {
  const { g, a, talk } = table();
  g.nextScene('exit_1');
  g.startRiddle('glocke');
  await talk(a, 'Ein Hund');
  await talk(a, 'Ein Fisch');
  assert.equal(g.state.penaltyMin, 10);
  assert.equal(g.state.riddle.hintGiven, true);
  assert.equal(g.view(a).clock.elapsedMin, 10);
  await talk(a, 'Eine Glocke');
  assert.ok(g.state.solvedRiddles.includes('glocke'));
});

test('Moorpfad: verklemmte Kiste per Probe, Gegner lässt sofort etwas fallen', async () => {
  const { g, a, b, events, talk } = table();
  g.nextScene('exit_1'); g.nextScene('exit_1');
  assert.equal(g.scene.id, 's3-moorpfad');
  await talk(b, 'Ich öffne die Kiste im Karren');
  assert.equal(g.state.pendingCheck.open_chest_on_success, 'karrenkiste');
  g.rollCheck(b, 20);
  assert.ok(g.state.loot.some((l) => l.itemId === 'seil' || l.itemId === 'heiltrank'));

  g.startCombat(['wegelagerer']);
  const before = g.state.loot.length;
  const enemy = g.state.combat.enemies[0];
  for (let i = 0; i < 10 && !enemy.defeated; i++) g.attack(a, { enemyId: enemy.instanceId, natural: 20 });
  assert.ok(enemy.defeated);
  assert.ok(g.state.loot.length > before, 'Drop liegt sofort da, nicht erst nach dem Kampf');
  assert.ok(g.state.loot.some((l) => l.itemId === 'dolch'));
  assert.ok(events.filter((e) => e.type === 'buzz' && e.kind === 'loot').length >= 2);
});

test('Ganzer Bogen: zwei Aktpausen, Schlüssel öffnet Quasts Kiste, Ende mit Ausklang', async () => {
  const { g, a, b, events, talk } = table();
  g.nextScene('exit_1'); g.nextScene('exit_3'); g.nextScene('exit_1');
  assert.equal(g.state.phase, 'interlude');                               // Ende Akt I
  g.chooseMilestone(a, { stat: 'verstand' }); g.chooseMilestone(b, { ability: g.world.abilities[0] });
  g.continueAct();
  assert.equal(g.scene.id, 's4-kapelle');
  g.nextScene('exit_2');
  assert.equal(g.scene.id, 's5-weideninsel');
  await talk(a, 'Wir hören, stell uns die Frage');
  await talk(a, 'Ein Loch!');
  assert.ok(g.state.loot.some((l) => l.itemId === 'weidenzweig'));
  g.revealLoot(['jorins_schluessel']);
  const key = g.state.loot.find((l) => l.itemId === 'jorins_schluessel');
  assert.ok(g.takeLoot(b, key.lootId).ok);
  g.nextScene('exit_3');
  assert.equal(g.state.phase, 'interlude');                               // Ende Akt II
  g.continueAct();
  assert.equal(g.scene.id, 's6-morgengrauen');
  const ctx = (await import('../server/llm/prompt.js')).contextMessage({
    world: g.world, scene: g.scene, characters: g.characters, inventories: g.state.inventories, loot: g.state.loot,
    hiddenLoot: [], enemiesInFight: [], transcript: '', minutesLeft: 30, sceneMinutes: 0, beds: [], sfx: [], path: g.state.path,
  });
  assert.match(ctx, /Jorin ist auf eurer Seite/);                         // Vorgeschichte kommt an
  assert.match(ctx, /Lehre des Abenteuers/);
  await talk(b, 'Ich öffne die Truhe auf dem Wagen mit Jorins Schlüssel');
  assert.ok(g.state.loot.some((l) => l.itemId === 'silberkloeppel'));
  g.nextScene('exit_1');
  assert.equal(g.state.phase, 'ended');
  assert.ok(events.filter((e) => e.type === 'say').some((e) => /Glocke, diesmal richtig/.test(e.text)));
});
