// Zufall: im Spiel kryptografisch, in Tests reproduzierbar (Seed).
import { randomInt } from 'node:crypto';

export function cryptoRng() {
  return { int: (min, max) => randomInt(min, max + 1) };
}

// mulberry32, nur für Tests und Wiederholungen
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (min, max) => min + Math.floor(next() * (max - min + 1)) };
}

// Fester Würfelvorrat für Tests: gibt die Werte der Reihe nach zurück
export function scriptedRng(values) {
  const queue = [...values];
  return {
    int: (min, max) => {
      if (!queue.length) throw new Error('scriptedRng: keine Werte mehr');
      const v = queue.shift();
      if (v < min || v > max) throw new Error(`scriptedRng: ${v} nicht in ${min}–${max}`);
      return v;
    },
  };
}
