import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptedRng, seededRng } from '../server/engine/rng.js';
import { rollDice, parseDice } from '../server/engine/dice.js';
import { resolveCheck } from '../server/engine/check.js';
import { createCharacter, applyLp, applyMilestone } from '../server/engine/character.js';
import { combatExchange, makeEnemy, heal, rollEventDamage } from '../server/engine/events.js';
import { createInventory, addItem, moveItem, removeItem } from '../server/engine/inventory.js';

const stats = { kraft: 3, agilitaet: 3, wahrnehmung: 2, verstand: 2, wort: 2 };

test('Würfelausdrücke', () => {
  assert.deepEqual(parseDice('4W6+5'), { count: 4, sides: 6, bonus: 5 });
  assert.deepEqual(parseDice('5'), { count: 0, sides: 0, bonus: 5 });
  assert.equal(rollDice('2W6+1', scriptedRng([3, 4])).total, 8);
});

test('Probe: Stufen nach Kernmechanik §2', () => {
  const r = (nat, dc = 12, statValue = 3) => resolveCheck({ statValue, dc, natural: nat }).outcome;
  assert.equal(r(20), 'crit');
  assert.equal(r(1), 'fumble');
  assert.equal(r(9), 'success');   // 12 ≥ 12
  assert.equal(r(14), 'strong');   // 17 ≥ 12+5
  assert.equal(r(8), 'price');     // 11 = DC−1
  assert.equal(r(6), 'price');     // 9 = DC−3
  assert.equal(r(5), 'fail');      // 8 = DC−4
});

test('Probe: DC und Fenster werden geklemmt und geloggt', () => {
  const res = resolveCheck({ statValue: 0, dc: 40, window: 12, natural: 10 });
  assert.equal(res.dc, 25);
  assert.equal(res.window, 7);
  assert.equal(res.log.length, 2);
});

test('Probe: Beschreibungsbonus und Synergie senken den DC', () => {
  const res = resolveCheck({ statValue: 2, dc: 15, descriptionBonus: 2, synergy: 2, natural: 9 });
  assert.equal(res.dc, 11);
  assert.equal(res.outcome, 'success');
});

test('Charakter: 12 Punkte, 1–4, LP = 80 + 5×Kraft', () => {
  const ok = createCharacter({ id: 'c', playerId: 'p', name: 'Mira', stats });
  assert.ok(ok.ok);
  assert.equal(ok.character.lpMax, 95);
  assert.ok(!createCharacter({ name: 'X', stats: { ...stats, kraft: 5 } }).ok);
  assert.ok(!createCharacter({ name: 'X', stats: { ...stats, kraft: 4 } }).ok); // Summe 13
});

test('LP: 0 = am Boden, Meilenstein Kraft hebt LP_max', () => {
  const ch = createCharacter({ id: 'c', playerId: 'p', name: 'Mira', stats }).character;
  assert.ok(applyLp(ch, -200).wentDown);
  assert.equal(ch.lp, 0);
  applyLp(ch, 50);
  assert.equal(ch.down, false);
  applyMilestone(ch, { stat: 'kraft' });
  assert.equal(ch.lpMax, 100);
  assert.equal(ch.lp, 55);
});

test('Kampf: Fehlwurf kostet Spieler-LP, Treffer kostet Gegner-LP', () => {
  const ch = createCharacter({ id: 'c', playerId: 'p', name: 'Mira', stats }).character;
  const enemy = makeEnemy({ id: 'wolf', name: 'Wolf', stufe: 1 }, 'e1');
  const hit = combatExchange({ character: ch, enemy, weapon: { damage: '1W8', kind: 'klinge' }, natural: 10 }, scriptedRng([6]));
  assert.equal(hit.check.outcome, 'success');
  assert.equal(enemy.lp, 19);
  const miss = combatExchange({ character: ch, enemy, natural: 3 }, scriptedRng([2, 3]));
  assert.equal(miss.check.outcome, 'fail');
  assert.equal(miss.playerDamage.total, 5);
  assert.equal(ch.lp, 90);
});

test('Kampf: Krit verdoppelt den Schaden', () => {
  const ch = createCharacter({ id: 'c', playerId: 'p', name: 'Mira', stats }).character;
  const enemy = makeEnemy({ id: 'wolf', name: 'Wolf', stufe: 1 }, 'e1');
  const r = combatExchange({ character: ch, enemy, weapon: { damage: '1W6' }, natural: 20 }, scriptedRng([5]));
  assert.equal(r.enemyDamage.total, 10);
});

test('Ereignisschaden: Klasse U schwer = 3W6+8', () => {
  assert.equal(rollEventDamage('U', 'schwer', scriptedRng([1, 1, 1])).total, 11);
});

test('Heilung: Rast +40, nicht über LP_max', () => {
  const ch = createCharacter({ id: 'c', playerId: 'p', name: 'Mira', stats }).character;
  applyLp(ch, -10);
  heal(ch, 'rest', seededRng(1));
  assert.equal(ch.lp, ch.lpMax);
});

test('Rucksack 4×4: Platz finden, stapeln, verschieben', () => {
  const inv = createInventory();
  assert.ok(addItem(inv, { id: 'schwert', name: 'Schwert', w: 1, h: 3 }, 'u1').ok);
  assert.ok(addItem(inv, { id: 'trank', name: 'Heiltrank', stack: true }, 'u2').ok);
  assert.ok(addItem(inv, { id: 'trank', name: 'Heiltrank', stack: true }, 'u3').stacked);
  assert.equal(inv.items.find((i) => i.itemId === 'trank').qty, 2);
  assert.ok(!moveItem(inv, 'u2', 0, 0).ok); // Schwert liegt da
  assert.ok(moveItem(inv, 'u2', 3, 3).ok);
  assert.ok(!addItem(inv, { id: 'schild', name: 'Schild', w: 4, h: 4 }, 'u4').ok);
  removeItem(inv, 'u2');
  assert.equal(inv.items.find((i) => i.itemId === 'trank').qty, 1);
});
