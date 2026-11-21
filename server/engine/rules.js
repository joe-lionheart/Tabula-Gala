// Zahlen aus Kernmechanik v0.5 (Projektdatei 06). Eine Stelle für alle Konstanten.

export const STATS = ['kraft', 'agilitaet', 'wahrnehmung', 'verstand', 'wort'];
export const STAT_LABELS = {
  kraft: 'Kraft', agilitaet: 'Agilität', wahrnehmung: 'Wahrnehmung', verstand: 'Verstand', wort: 'Wort',
};

export const CREATION = { points: 12, min: 1, max: 4 };
export const STAT_CAP = { oneshot: 5, campaign: 7 };

export const lpMax = (kraft) => 80 + 5 * kraft;
export const markOf = (lpMaxValue) => lpMaxValue / 5; // eine Marke = LP_max/5 (≈20)

export const DC = { min: 5, max: 25, default: 12 };
export const WINDOW = { min: 3, max: 7, default: 5 }; // Fenster für „stark“
export const PRICE_BAND = 3; // DC−3 bis DC−1 = Erfolg mit Preis
export const PRICE_LP = 5;
export const DESCRIPTION_BONUS_MAX = 2;
export const SYNERGY = { two: 2, three: 3, max: 4 };

export const DAMAGE = {
  K: { leicht: '2W6', mittel: '3W6', schwer: '4W6+5' },   // Kampf
  F: { leicht: '5', mittel: '5', schwer: '5' },          // Fehlschlag mit Preis
  U: { leicht: '1W6+2', mittel: '2W6+4', schwer: '3W6+8' }, // Umgebung/Falle
  Z: { leicht: '3', mittel: '5', schwer: '8' },          // Zustand, pro Szene
};
export const SEVERITIES = ['leicht', 'mittel', 'schwer'];

export const ENEMY_TIERS = {
  1: { abwehr: 11, lp: 25, schaden: 'leicht' },
  2: { abwehr: 13, lp: 40, schaden: 'leicht' },
  3: { abwehr: 15, lp: 60, schaden: 'mittel' },
  4: { abwehr: 17, lp: 90, schaden: 'mittel' },
  5: { abwehr: 19, lp: 140, schaden: 'schwer' },
};

export const HEAL = { rest: 40, consume: 20, healer: 15, healerDc: 12 };
export const RESCUE_DC = 10;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
