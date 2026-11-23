// Klang auf Zuruf (GMSB (Gamemaster Soundboard)): erkennt Stichworte in dem, was die Spielleitung sagt,
// und schlägt passende Klänge vor. Läuft komplett im Browser, ohne KI und ohne Server.
// Reines Modul ohne DOM, damit es auch in Node getestet werden kann.

// Standard-Zuordnungen. words: Stichworte (Wortanfang genügt ab 4 Buchstaben, z. B. „glocke“ trifft „Glocken“).
// Mehrwortige Einträge („greift an“) müssen genau so im Satz stehen.
export const DEFAULT_TRIGGERS = [
  // Orte → Klangteppich
  { bed: 'tavern', words: ['wirtshaus', 'taverne', 'schenke', 'gasthaus', 'kneipe'] },
  { bed: 'forest_day', words: ['wald', 'lichtung', 'waldweg'] },
  { bed: 'swamp_night', words: ['moor', 'sumpf', 'morast'] },
  { bed: 'chapel', words: ['kapelle', 'kirche', 'gruft', 'krypta', 'tempel'] },
  { bed: 'smithy', words: ['schmiede', 'esse'] },
  { bed: 'dawn_yard', words: ['morgengrauen', 'sonnenaufgang', 'morgendämmerung'] },
  { bed: 'combat', words: ['initiative', 'zum kampf', 'greift an', 'greifen an', 'angriff'] },
  { bed: 'silence', words: ['totenstille', 'stille'] },
  // Effekte
  { sfx: 'door_creak', words: ['tür', 'türe', 'pforte', 'tor öffnet', 'tor knarrt'] },
  { sfx: 'bell', words: ['glocke', 'läutet', 'läuten', 'gong'] },
  { sfx: 'coins', words: ['münze', 'goldstück', 'silberling', 'geldbeutel', 'bezahlt'] },
  { sfx: 'wolf_howl', words: ['heult', 'geheul', 'wolf', 'wölfe'] },
  { sfx: 'wolf_growl', words: ['knurrt', 'knurren', 'fletscht'] },
  { sfx: 'magic', words: ['zauber', 'magie', 'magisch', 'funkelt', 'schimmert'] },
  { sfx: 'torch', words: ['fackel', 'entzündet', 'flamme'] },
  { sfx: 'whisper', words: ['flüstert', 'flüstern', 'wispert', 'raunt'] },
  { sfx: 'water_splash', words: ['platscht', 'spritzt', 'ins wasser', 'tümpel'] },
  { sfx: 'anvil', words: ['amboss', 'hämmert'] },
  { sfx: 'trap_click', words: ['falle', 'klickt', 'schnappt zu'] },
  { sfx: 'draw_weapons', words: ['zieht sein schwert', 'zieht ihr schwert', 'ziehen die waffen', 'waffen gezogen'] },
  { sfx: 'laugh_crowd', words: ['gelächter', 'lachen alle', 'lacht laut'] },
  { sfx: 'crowd_gasp', words: ['raunen', 'aufschrei', 'erschrocken'] },
  { sfx: 'glass_clink', words: ['prost', 'anstoßen', 'stoßen an', 'krüge'] },
  { sfx: 'wood_creak', words: ['knarrt', 'dielen', 'planken'] },
  { sfx: 'chair_scrape', words: ['stuhl', 'schemel', 'bank rückt'] },
  { sfx: 'heal', words: ['heiltrank', 'heilt', 'geheilt'] },
  { sfx: 'enemy_shout', words: ['brüllt', 'schreit', 'kampfschrei'] },
  { sfx: 'level_up', words: ['stufe aufgestiegen', 'level up', 'aufgestiegen'] },
];

// Deutsche Anzeigenamen der Effekte
export const SFX_LABELS = {
  dice_roll: 'Würfel', sword_swing: 'Schwert schwingt', club_swing: 'Keule schwingt', punch_swing: 'Faustschlag',
  bow_shot: 'Bogenschuss', sword_hit: 'Schwerttreffer', club_hit: 'Keulentreffer', arrow_hit: 'Pfeil trifft',
  punch_hit: 'Fausttreffer', parry: 'Parade', miss: 'Verfehlt', player_hurt: 'Verletzt', player_down: 'Am Boden',
  enemy_down: 'Gegner fällt', crit_fanfare: 'Kritisch!', fumble: 'Patzer', success_chime: 'Erfolg', fail_low: 'Misserfolg',
  heal: 'Heilung', pour: 'Einschenken', loot_pickup: 'Fund', coins: 'Münzen', level_up: 'Aufstieg',
  door_creak: 'Tür knarrt', glass_clink: 'Krüge', chair_scrape: 'Stuhl', laugh_crowd: 'Gelächter',
  wolf_howl: 'Wolfsgeheul', wolf_growl: 'Knurren', enemy_grunt: 'Gegner ächzt', enemy_shout: 'Kampfschrei',
  water_splash: 'Wasser', wood_creak: 'Holz knarrt', whisper: 'Flüstern', trap_click: 'Falle', magic: 'Magie',
  bell: 'Glocke', torch: 'Fackel', crowd_gasp: 'Raunen', anvil: 'Amboss', draw_weapons: 'Waffen ziehen',
};

export function normalize(text) {
  return String(text || '').toLowerCase().replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function wordHits(word, norm, tokens) {
  const w = normalize(word);
  if (!w) return -1;
  if (w.includes(' ')) { const i = ` ${norm} `.indexOf(` ${w} `); return i < 0 ? -1 : i; }
  // ab 4 Buchstaben genügt der Wortanfang (Glocke → Glocken, Tür → nur exakt)
  let pos = 0;
  for (const t of tokens) {
    if (t === w || (w.length >= 4 && t.startsWith(w))) return pos;
    pos += t.length + 1;
  }
  return -1;
}

// Findet Klänge in einem Satz. Gibt [{kind: 'bed'|'sfx', id, word, pos}] in der Reihenfolge des Satzes zurück.
// state.last: Map id -> Zeitpunkt (Sperrzeit gegen Wiederholung, auch bei Zwischenergebnissen der Erkennung)
export function matchCues(text, triggers = DEFAULT_TRIGGERS, { now = Date.now(), last = new Map(), cooldownMs = 8000, maxSfx = 2 } = {}) {
  const norm = normalize(text);
  if (!norm) return [];
  const tokens = norm.split(' ');
  const hits = [];
  for (const t of triggers) {
    const kind = t.bed ? 'bed' : 'sfx';
    const id = t.bed || t.sfx;
    if (!id) continue;
    let best = null;
    for (const word of t.words || []) {
      const pos = wordHits(word, norm, tokens);
      if (pos >= 0 && (!best || pos < best.pos)) best = { kind, id, word, pos };
    }
    if (best) hits.push(best);
  }
  hits.sort((a, b) => a.pos - b.pos);
  const out = [];
  let beds = 0, sfx = 0;
  for (const h of hits) {
    const key = `${h.kind}:${h.id}`;
    if (last.has(key) && now - last.get(key) < cooldownMs) continue;
    if (h.kind === 'bed' && beds >= 1) continue;
    if (h.kind === 'sfx' && sfx >= maxSfx) continue;
    if (h.kind === 'bed') beds++; else sfx++;
    last.set(key, now);
    out.push(h);
  }
  return out;
}

// Eigene Zuordnungen prüfen (aus dem Browser-Speicher): nur bekannte Klänge, nur Text
export function sanitizeTriggers(list, { beds = [], sfx = [] } = {}) {
  if (!Array.isArray(list)) return DEFAULT_TRIGGERS;
  const okBed = new Set(beds), okSfx = new Set(sfx);
  return list.map((t) => {
    const words = (Array.isArray(t?.words) ? t.words : []).map((w) => String(w).trim().slice(0, 40)).filter(Boolean).slice(0, 12);
    if (t?.bed && okBed.has(t.bed)) return { bed: t.bed, words };
    if (t?.sfx && okSfx.has(t.sfx)) return { sfx: t.sfx, words };
    return null;
  }).filter((t) => t && t.words.length);
}
