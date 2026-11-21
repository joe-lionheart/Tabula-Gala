// Ereignisse, Kampf, Heilung (Kernmechanik §3, §4)
import { rollDice, d20 } from './dice.js';
import { resolveCheck } from './check.js';
import { DAMAGE, SEVERITIES, ENEMY_TIERS, HEAL, RESCUE_DC, PRICE_LP } from './rules.js';
import { applyLp } from './character.js';

// Das LLM wählt Klasse + Stufe, der Server würfelt den Betrag (Grundsatz 2)
export function rollEventDamage(cls, severity, rng) {
  const table = DAMAGE[cls];
  if (!table) throw new Error(`Unbekannte Schadensklasse ${cls}`);
  const sev = SEVERITIES.includes(severity) ? severity : 'leicht';
  return { class: cls, severity: sev, ...rollDice(table[sev], rng) };
}

export function makeEnemy(template, instanceId) {
  const tier = ENEMY_TIERS[template.stufe] || ENEMY_TIERS[1];
  return {
    instanceId,
    id: template.id,
    name: template.name,
    stufe: template.stufe,
    abwehr: template.abwehr ?? tier.abwehr,
    lp: template.lp ?? tier.lp,
    lpMax: template.lp ?? tier.lp,
    schaden: template.schaden ?? tier.schaden,
    kompl: template.kompl || [],
    loot: template.loot || null,
    sound: template.sound || null,
    defeated: false,
  };
}

/**
 * Ein Schlagabtausch: ein Wurf pro Austausch, Gegner handeln über Fehlwürfe.
 * weapon: { name, damage: '2W6+2', kind: 'klinge'|'stumpf'|'bogen'|'faust' }
 */
export function combatExchange({ character, stat, enemy, weapon, natural, descriptionBonus }, rng) {
  const statKey = stat === 'agilitaet' ? 'agilitaet' : 'kraft';
  const check = resolveCheck({
    statValue: character.stats[statKey], dc: enemy.abwehr, natural, descriptionBonus,
  }, rng);
  const w = weapon || { name: 'Fäuste', damage: '1W6', kind: 'faust' };
  const result = { check, weapon: w, enemyDamage: null, playerDamage: null, complication: null, enemyDefeated: false };

  if (check.outcome === 'fumble') {
    result.complication = enemy.kompl.length ? enemy.kompl[rng.int(0, enemy.kompl.length - 1)] : 'waffe_faellt';
    return result;
  }
  if (check.succeeded) {
    const dmg = rollDice(w.damage, rng);
    let amount = dmg.total;
    if (check.outcome === 'crit') amount *= 2;
    if (check.outcome === 'strong') amount += rollDice('1W6', rng).total; // eine Stufe mehr Wirkung
    enemy.lp = Math.max(0, enemy.lp - amount);
    enemy.defeated = enemy.lp === 0;
    result.enemyDamage = { ...dmg, total: amount };
    result.enemyDefeated = enemy.defeated;
    if (check.outcome === 'price') {
      const hurt = rollEventDamage('K', 'leicht', rng);
      result.playerDamage = { ...hurt, lp: applyLp(character, -hurt.total) };
    }
    return result;
  }
  const hurt = rollEventDamage('K', enemy.schaden, rng);
  result.playerDamage = { ...hurt, lp: applyLp(character, -hurt.total) };
  return result;
}

// Erfolg mit Preis außerhalb des Kampfs: 5 LP
export function payPrice(character) {
  return applyLp(character, -PRICE_LP);
}

export function heal(character, way, rng, opts = {}) {
  if (way === 'rest') return { way, lp: applyLp(character, HEAL.rest) };
  if (way === 'consume') return { way, lp: applyLp(character, opts.amount ?? HEAL.consume) };
  if (way === 'healer') {
    const check = resolveCheck({ statValue: opts.healerStat ?? 0, dc: HEAL.healerDc, natural: opts.natural }, rng);
    const amount = check.succeeded ? HEAL.healer * (check.outcome === 'crit' ? 2 : 1) : 0;
    return { way, check, lp: applyLp(character, amount) };
  }
  throw new Error(`Unbekannter Heilweg ${way}`);
}

// Am Boden: pro Szene ein Rettungswurf W20 ≥ 10
export function rescueRoll(character, rng, natural) {
  const n = Number.isInteger(natural) ? natural : d20(rng);
  const ok = n >= RESCUE_DC;
  const lp = ok ? applyLp(character, 1) : null;
  return { natural: n, ok, lp };
}

// Zustände ticken pro Szene
export function tickConditions(character, rng) {
  const out = [];
  for (const c of character.conditions) {
    const dmg = rollEventDamage('Z', c.severity, rng);
    out.push({ condition: c, damage: dmg.total, lp: applyLp(character, -dmg.total) });
  }
  return out;
}
