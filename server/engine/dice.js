// Würfelausdrücke im deutschen Format: "2W6", "4W6+5", "1W20", "5" (fix)
const EXPR = /^\s*(?:(\d+)\s*[WwDd]\s*(\d+))?\s*([+-]\s*\d+)?\s*$|^\s*(\d+)\s*$/;

export function parseDice(expr) {
  const m = EXPR.exec(String(expr));
  if (!m) throw new Error(`Ungültiger Würfelausdruck: ${expr}`);
  if (m[4] !== undefined) return { count: 0, sides: 0, bonus: Number(m[4]) };
  return {
    count: m[1] ? Number(m[1]) : 0,
    sides: m[2] ? Number(m[2]) : 0,
    bonus: m[3] ? Number(m[3].replace(/\s/g, '')) : 0,
  };
}

export function rollDice(expr, rng) {
  const { count, sides, bonus } = parseDice(expr);
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(rng.int(1, sides));
  const total = rolls.reduce((s, r) => s + r, 0) + bonus;
  return { expr: String(expr), rolls, bonus, total: Math.max(0, total) };
}

export const d20 = (rng) => rng.int(1, 20);
