// Rätsel, Argumentationsprobe, Preise (Kernmechanik §2, §3). Reine Regeln, ohne KI, ohne Zufall.

export const RIDDLE = {
  wrongPenaltyMin: 5,   // falsche Antwort kostet Zeit, keine LP (§3)
  hintAfter: 2,         // nach so vielen Fehlversuchen kommt der Hinweis von selbst
  maxAttempts: 5,       // danach verfällt das Rätsel
  defaultDc: 13,        // Verstand-Probe zum Nachbessern bei „nah dran“
};

export const RATINGS = ['richtig', 'nah', 'falsch'];

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // ä → a usw.
  .replace(/ß/g, 'ss').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Server-Wertung einer Antwort. Die Lösungswörter aus der Abenteuerdatei schlagen das Urteil der KI:
// Wer die Lösung sagt, hat recht, auch wenn die KI „falsch“ meint. Sonst gilt das Urteil der KI.
export function rateAnswer(riddle, text, llmRating) {
  const t = ` ${norm(text)} `;
  if (!t.trim()) return 'falsch';
  if ((riddle.answers || []).some((a) => t.includes(` ${norm(a)} `))) return 'richtig';
  if (llmRating === 'richtig') return 'richtig';
  if (llmRating === 'nah' || (riddle.near || []).some((a) => t.includes(` ${norm(a)} `))) return 'nah';
  return 'falsch';
}

// Argumentationsprobe: drei Kriterien à 0–2, Wort 4–5 gibt +1 (Kernmechanik §2)
export const ARGUMENT_CRITERIA = ['begruendung', 'bezug', 'ton'];
export const ARGUMENT_LABELS = { begruendung: 'Begründung', bezug: 'Bezug aufs Gegenüber', ton: 'Ton' };

export function scoreArgument(scores, wort) {
  const parts = Object.fromEntries(ARGUMENT_CRITERIA.map((k) => [k, Math.max(0, Math.min(2, Math.round(Number(scores?.[k]) || 0)))]));
  const bonus = wort >= 4 ? 1 : 0;
  const points = Object.values(parts).reduce((a, b) => a + b, 0) + bonus;
  const tier = points >= 5 ? 'stark' : points >= 3 ? 'erfolg' : points >= 1 ? 'knapp' : 'abgelehnt';
  return { parts, bonus, points, tier, discount: DISCOUNT[tier], label: TIER_LABELS[tier] };
}

// Was eine Verhandlung am Preis ändert. „abgelehnt“: Diese Figur bekommt in dieser Szene nichts.
export const DISCOUNT = { stark: 0.5, erfolg: 0.25, knapp: 0, abgelehnt: null };
export const TIER_LABELS = { stark: 'Glänzend verhandelt', erfolg: 'Gut verhandelt', knapp: 'Zum Listenpreis', abgelehnt: 'Abgelehnt' };

export function priceFor(listPrice, deal) {
  if (!deal) return listPrice;
  if (deal.discount === null) return null;
  return Math.max(0, Math.round(listPrice * (1 - deal.discount)));
}
