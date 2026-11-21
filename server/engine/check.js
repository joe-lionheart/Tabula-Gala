// Die Probe: W20 + Wert ≥ DC (Kernmechanik §2)
import { d20 } from './dice.js';
import { DC, WINDOW, PRICE_BAND, DESCRIPTION_BONUS_MAX, SYNERGY, clamp } from './rules.js';

// Ergebnisstufen, aufsteigend
export const OUTCOMES = ['fumble', 'fail', 'price', 'success', 'strong', 'crit'];

export const OUTCOME_LABELS = {
  fumble: 'Patzer', fail: 'Fehlschlag', price: 'Erfolg mit Preis',
  success: 'Erfolg', strong: 'Starker Erfolg', crit: 'Kritischer Erfolg',
};

export function normalizeDc(dc, log) {
  const raw = Number.isFinite(Number(dc)) ? Number(dc) : DC.default;
  const v = clamp(Math.round(raw), DC.min, DC.max);
  if (log && v !== raw) log.push({ type: 'dc_clamped', requested: raw, used: v });
  return v;
}

export function normalizeWindow(w, log) {
  const raw = Number.isFinite(Number(w)) ? Number(w) : WINDOW.default;
  const v = clamp(Math.round(raw), WINDOW.min, WINDOW.max);
  if (log && v !== raw) log.push({ type: 'window_clamped', requested: raw, used: v });
  return v;
}

// Synergie: Anzahl Beteiligter mit verschiedenen Werten → DC-Senkung
export function synergyBonus(participants) {
  if (participants >= 3) return Math.min(SYNERGY.three + (participants - 3), SYNERGY.max);
  if (participants === 2) return SYNERGY.two;
  return 0;
}

/**
 * @param {object} p
 * @param {number} p.statValue    Wert der Figur (1–7)
 * @param {number} p.dc           vom Moderator gesetzt, wird geklemmt
 * @param {number} [p.window]     Fenster für „stark“ (3–7)
 * @param {number} [p.descriptionBonus] 0–2, nur für Einsatz von Vorhandenem
 * @param {number} [p.synergy]    Anzahl Beteiligter (1 = keine Synergie)
 * @param {number} [p.natural]    eingegebener W20 (vom Handy); sonst würfelt der Server
 */
export function resolveCheck(p, rng) {
  const log = [];
  const baseDc = normalizeDc(p.dc, log);
  const window = normalizeWindow(p.window, log);
  const descBonus = clamp(Number(p.descriptionBonus) || 0, 0, DESCRIPTION_BONUS_MAX);
  const syn = synergyBonus(Number(p.synergy) || 1);
  const dc = clamp(baseDc - descBonus - syn, DC.min, DC.max);

  let natural = Number(p.natural);
  const entered = Number.isInteger(natural) && natural >= 1 && natural <= 20;
  if (!entered) natural = d20(rng);

  const statValue = Number(p.statValue) || 0;
  const total = natural + statValue;

  let outcome;
  if (natural === 20) outcome = 'crit';
  else if (natural === 1) outcome = 'fumble';
  else if (total >= dc + window) outcome = 'strong';
  else if (total >= dc) outcome = 'success';
  else if (total >= dc - PRICE_BAND) outcome = 'price';
  else outcome = 'fail';

  return {
    natural, entered, statValue, total,
    baseDc, dc, window, descriptionBonus: descBonus, synergyBonus: syn,
    margin: total - dc,
    outcome, label: OUTCOME_LABELS[outcome],
    succeeded: ['price', 'success', 'strong', 'crit'].includes(outcome),
    log,
  };
}
