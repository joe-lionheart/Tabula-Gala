// Figuren: Erschaffung Modus A, LP, Zustände, Meilenstein (Kernmechanik §1, §3, §5)
import { STATS, CREATION, STAT_CAP, lpMax, clamp } from './rules.js';

export function validateStats(stats) {
  const errors = [];
  let sum = 0;
  for (const s of STATS) {
    const v = Number(stats?.[s]);
    if (!Number.isInteger(v)) { errors.push(`${s} fehlt`); continue; }
    if (v < CREATION.min || v > CREATION.max) errors.push(`${s} muss ${CREATION.min}–${CREATION.max} sein`);
    sum += v;
  }
  if (sum !== CREATION.points) errors.push(`Summe ist ${sum}, erlaubt sind genau ${CREATION.points}`);
  return errors;
}

export function createCharacter({ id, playerId, name, concept, stats, kerbe = '' }) {
  const errors = validateStats(stats);
  if (!String(name || '').trim()) errors.push('Name fehlt');
  if (errors.length) return { ok: false, errors };
  const clean = Object.fromEntries(STATS.map((s) => [s, Number(stats[s])]));
  const max = lpMax(clean.kraft);
  return {
    ok: true,
    character: {
      id, playerId,
      name: String(name).trim().slice(0, 40),
      concept: String(concept || '').trim().slice(0, 140),
      kerbe: String(kerbe || '').trim().slice(0, 140),
      stats: clean,
      lp: max, lpMax: max,
      down: false,
      conditions: [],        // [{class:'Z', severity:'leicht', label:'Blutung'}]
      abilities: [],
      milestones: 0,
    },
  };
}

// LP ändern; 0 LP = am Boden, nicht tot
export function applyLp(ch, amount) {
  const before = ch.lp;
  ch.lp = clamp(ch.lp + amount, 0, ch.lpMax);
  const wasDown = ch.down;
  ch.down = ch.lp === 0;
  return { before, after: ch.lp, delta: ch.lp - before, wentDown: !wasDown && ch.down, gotUp: wasDown && !ch.down };
}

export function applyMilestone(ch, choice, mode = 'oneshot') {
  if (choice?.stat) {
    const cap = STAT_CAP[mode] ?? STAT_CAP.oneshot;
    if (!STATS.includes(choice.stat)) return { ok: false, error: 'Unbekannter Wert' };
    if (ch.stats[choice.stat] >= cap) return { ok: false, error: `Maximum ${cap} erreicht` };
    ch.stats[choice.stat] += 1;
    if (choice.stat === 'kraft') {
      const newMax = lpMax(ch.stats.kraft);
      ch.lp += newMax - ch.lpMax;
      ch.lpMax = newMax;
    }
  } else if (choice?.ability) {
    ch.abilities.push(String(choice.ability).slice(0, 80));
  } else return { ok: false, error: 'Wert oder Fähigkeit wählen' };
  ch.milestones += 1;
  return { ok: true };
}
