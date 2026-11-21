// Sound-Regie: übersetzt Spielereignisse in Klang-Cues (Schicht 1, 0 ms, ohne KI).
// Ein Cue: { bed?: id, sfx: [{ id, delayMs }], reason }
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../public/audio/manifest.json', import.meta.url), 'utf8'));

export const knownBed = (id) => Object.hasOwn(manifest.beds, id);
export const knownSfx = (id) => Object.hasOwn(manifest.sfx, id);
export const allSfx = () => Object.keys(manifest.sfx);
export const allBeds = () => Object.keys(manifest.beds);

const cue = (reason, sfx = [], bed) => ({ reason, sfx: sfx.filter((s) => knownSfx(s.id)), ...(bed ? { bed } : {}) });
const at = (id, delayMs = 0) => ({ id, delayMs });

export function sceneCue(scene) {
  return cue(`Szene: ${scene.title}`, [], knownBed(scene.ambience) ? scene.ambience : 'silence');
}

export function combatStartCue(enemies) {
  const sfx = [at('draw_weapons')];
  enemies.forEach((e, i) => e.sound && sfx.push(at(e.sound, 400 + i * 300)));
  return cue('Kampf beginnt', sfx, 'combat');
}

export function combatEndCue(scene) {
  return cue('Kampf vorbei', [], knownBed(scene.ambience) ? scene.ambience : 'silence');
}

// Schlagabtausch: Schwung → Treffer/Parade → Folgen
export function exchangeCue(result) {
  const kind = result.weapon?.kind && manifest.weaponSounds[result.weapon.kind] ? result.weapon.kind : 'faust';
  const ws = manifest.weaponSounds[kind];
  const o = result.check.outcome;
  const sfx = [at('dice_roll'), at(ws.swing, 350)];
  if (o === 'fumble') sfx.push(at('fumble', 750));
  else if (o === 'fail') { sfx.push(at('parry', 700)); sfx.push(at('player_hurt', 1100)); }
  else {
    if (o === 'crit') sfx.push(at('crit_fanfare', 650));
    sfx.push(at(ws.hit, 700));
    if (o === 'price') sfx.push(at('player_hurt', 1100));
    if (result.enemyDefeated) sfx.push(at('enemy_down', 1300));
  }
  if (result.playerDamage?.lp?.wentDown) sfx.push(at('player_down', 1500));
  return cue(`Angriff: ${result.check.label}`, sfx);
}

export function checkCue(result) {
  const sfx = [at('dice_roll')];
  const tail = { crit: 'crit_fanfare', fumble: 'fumble', strong: 'success_chime', success: 'success_chime', fail: 'fail_low' }[result.outcome];
  if (tail) sfx.push(at(tail, 600));
  return cue(`Probe: ${result.label}`, sfx);
}

export const healCue = (way) => cue('Heilung', [at(way === 'pour' ? 'pour' : 'heal')]);
export const lootCue = (item) => cue('Loot', [at(item?.value ? 'coins' : 'loot_pickup')]);
export const downCue = () => cue('Figur am Boden', [at('player_down')]);
export const milestoneCue = () => cue('Meilenstein', [at('level_up')]);
export const trapCue = (hurt) => cue('Falle', [at('trap_click'), ...(hurt ? [at('player_hurt', 400)] : [])]);

// Vom KI-Moderator gewünschte Klänge: nur, was die Szene erlaubt (Dev-Roadmap §3)
export function moderatorCue(audio, scene) {
  if (!audio) return null;
  const allowed = new Set([...(scene?.allowedSfx || []), 'door_creak', 'coins', 'magic', 'bell']);
  const sfx = (audio.sfx || []).filter((id) => allowed.has(id) && knownSfx(id)).slice(0, 3).map((id, i) => at(id, i * 400));
  const bed = audio.bed && knownBed(audio.bed) ? audio.bed : undefined;
  if (!sfx.length && !bed) return null;
  return cue('Moderator', sfx, bed);
}
