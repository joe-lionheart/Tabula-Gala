// Eine Spielsitzung: Zustand, Regeln, Moderator, Sound-Regie. Clients sind dumm (Dev-Roadmap §0).
import { randomUUID, randomBytes } from 'node:crypto';
import { cryptoRng } from '../engine/rng.js';
import { resolveCheck } from '../engine/check.js';
import { createCharacter, applyLp, applyMilestone } from '../engine/character.js';
import { combatExchange, makeEnemy, heal, rollEventDamage, payPrice, tickConditions, rescueRoll } from '../engine/events.js';
import { createInventory, addItem, moveItem, removeItem } from '../engine/inventory.js';
import { STATS, STAT_LABELS } from '../engine/rules.js';
import * as sound from '../audio/director.js';
import { validateJudgment } from '../llm/contract.js';
import { systemPrompt, contextMessage } from '../llm/prompt.js';

const SPEAKER_WINDOW_MS = 12000;   // so lange gilt ein Antippen „Ich spreche“
const QUIET_MS = 1400;             // Pause, nach der der Moderator antwortet
const FEED_MAX = 60;

const token = () => randomBytes(16).toString('hex');

export class Game {
  constructor({ code, world, moderator, durationMin = 90, rng = cryptoRng(), persist = () => {}, log = () => {} }) {
    this.code = code;
    this.world = world;
    this.moderator = moderator;
    this.rng = rng;
    this.persist = persist;
    this.writeLog = log;
    this.listeners = new Set();
    this.hostToken = token();
    this.state = {
      phase: 'lobby',             // lobby | creation | playing | ended
      paused: false,
      durationMin,
      startedAt: null,
      sceneIndex: -1,
      sceneStartedAt: null,
      players: [],                // {id, name, token, connected}
      characters: {},             // playerId -> character
      inventories: {},            // characterId -> inventory
      loot: [],                   // sichtbar: {lootId, itemId, name, qty}
      hiddenLoot: [],             // {lootId, itemId, name, qty}
      combat: null,               // {enemies: []}
      pendingCheck: null,
      feed: [],                   // {ts, who, text, kind}
      transcript: [],             // {ts, speakerId, speakerName, text, source}
      activeSpeaker: null,        // {playerId, until}
      ai: { enabled: true, kind: moderator.kind, model: moderator.model, busy: false, tokensIn: 0, tokensOut: 0, calls: 0, lastLatencyMs: null, lastError: null },
      milestonesOpen: [],
    };
    this.quietTimer = null;
    this.dirty = false;
  }

  // ---------- Infrastruktur ----------
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(msg) { for (const fn of this.listeners) fn(msg); }
  changed() { this.persist(this); this.emit({ type: 'state' }); }
  log(type, data) { this.writeLog({ ts: new Date().toISOString(), type, ...data }); }

  get scene() { return this.world.scenes[this.state.sceneIndex] || null; }
  itemDef(id) { return this.world.items.find((i) => i.id === id); }
  player(id) { return this.state.players.find((p) => p.id === id); }
  charOf(playerId) { return this.state.characters[playerId]; }
  get characters() { return Object.values(this.state.characters); }

  authPlayer(tok) { return this.state.players.find((p) => p.token === tok) || null; }
  isHost(tok) { return tok === this.hostToken; }

  feed(who, text, kind = 'narration') {
    if (!text) return;
    this.state.feed.push({ ts: Date.now(), who, text, kind });
    if (this.state.feed.length > FEED_MAX) this.state.feed.shift();
  }

  // Sprechen lassen (Host liest vor) und im Verlauf festhalten
  say(text, { voice = 'moderator', who = 'Moderator' } = {}) {
    if (!text) return;
    this.feed(who, text, voice === 'moderator' ? 'narration' : 'npc');
    this.state.transcript.push({ ts: Date.now(), speakerId: voice, speakerName: who, text, source: 'moderator' });
    this.emit({ type: 'say', text, voice, who });
  }

  cue(c) {
    if (!c) return;
    this.emit({ type: 'cue', cue: c });
    this.log('cue', { cue: c });
  }

  minutes(since) { return since ? Math.floor((Date.now() - since) / 60000) : 0; }

  // ---------- Lobby & Figuren ----------
  join(name) {
    const clean = String(name || '').trim().slice(0, 24);
    if (!clean) return { ok: false, error: 'Bitte einen Namen eingeben' };
    if (this.state.players.length >= 6) return { ok: false, error: 'Die Runde ist voll (6)' };
    const p = { id: randomUUID().slice(0, 8), name: clean, token: token(), connected: true };
    this.state.players.push(p);
    this.log('join', { playerId: p.id, name: clean });
    this.feed('Tisch', `${clean} setzt sich an den Tisch.`, 'system');
    this.changed();
    return { ok: true, playerId: p.id, token: p.token };
  }

  startCreation() {
    if (this.state.phase !== 'lobby') return { ok: false, error: 'Nicht in der Lobby' };
    this.state.phase = 'creation';
    this.changed();
    return { ok: true };
  }

  createCharacter(playerId, { name, concept, kerbe, stats, kit }) {
    if (!['lobby', 'creation'].includes(this.state.phase)) return { ok: false, error: 'Figuren entstehen vor dem Spiel' };
    const res = createCharacter({ id: `c-${playerId}`, playerId, name, concept, kerbe, stats });
    if (!res.ok) return { ok: false, error: res.errors.join('; ') };
    const ch = res.character;
    this.state.characters[playerId] = ch;
    const inv = createInventory();
    this.state.inventories[ch.id] = inv;
    const choice = this.world.startKitChoices[Number(kit)] || this.world.startKitChoices[0];
    for (const id of [...choice, 'heiltrank']) this.giveItem(ch, id, 1);
    this.log('character', { playerId, character: ch });
    this.changed();
    return { ok: true };
  }

  giveItem(ch, itemId, qty = 1) {
    const def = this.itemDef(itemId);
    if (!def) return { ok: false, error: 'Unbekannter Gegenstand' };
    return addItem(this.state.inventories[ch.id], { ...def, qty }, randomUUID().slice(0, 8));
  }

  // ---------- Ablauf ----------
  startGame() {
    if (!this.characters.length) return { ok: false, error: 'Noch keine Figur am Tisch' };
    this.state.phase = 'playing';
    this.state.startedAt = Date.now();
    this.say('Willkommen am Tisch. Ich bin euer Moderator heute Abend, eine künstliche Intelligenz. Ihr sprecht einfach, ich höre zu und erzähle.');
    this.enterScene(0);
    return { ok: true };
  }

  enterScene(index) {
    const prev = this.scene;
    this.state.sceneIndex = index;
    const s = this.scene;
    if (!s) return this.endGame();
    this.state.sceneStartedAt = Date.now();
    this.state.combat = null;
    this.state.pendingCheck = null;
    this.buildLoot(s.loot);
    // Zustände ticken beim Szenenwechsel
    if (prev) for (const ch of this.characters) {
      tickConditions(ch, this.rng);
      if (ch.down) { const r = rescueRoll(ch, this.rng); if (r.ok) this.feed('Tisch', `${ch.name} kommt wieder auf die Beine.`, 'system'); }
    }
    this.cue(sound.sceneCue(s));
    this.log('scene', { sceneId: s.id });
    this.say(s.intro);
    const first = this.characters[Math.floor(this.rng.int(0, this.characters.length - 1))];
    this.say(`${first.name}, was tust du?`);
    this.changed();
  }

  buildLoot(tableId) {
    const table = this.world.lootTables[tableId] || [];
    this.state.loot = [];
    this.state.hiddenLoot = [];
    for (const entry of table) this.addLoot(entry.item, entry.qty, entry.hidden);
  }

  addLoot(itemId, qty = 1, hidden = false) {
    const def = this.itemDef(itemId);
    if (!def) return;
    const l = { lootId: randomUUID().slice(0, 8), itemId, name: def.name, qty };
    (hidden ? this.state.hiddenLoot : this.state.loot).push(l);
  }

  revealLoot(itemIds) {
    for (const id of itemIds) {
      const idx = this.state.hiddenLoot.findIndex((l) => l.itemId === id);
      if (idx >= 0) {
        const [l] = this.state.hiddenLoot.splice(idx, 1);
        this.state.loot.push(l);
        this.feed('Tisch', `Entdeckt: ${l.name}`, 'system');
      }
    }
  }

  nextScene(exitId) {
    const s = this.scene;
    if (!s) return { ok: false, error: 'Keine Szene' };
    const exit = s.exits.find((e) => e.id === exitId) || s.exits[0];
    this.log('exit', { sceneId: s.id, exit: exit.id });
    this.feed('Tisch', `Ausgang: ${exit.label}`, 'system');
    if (!exit.to) return this.endGame();
    const idx = this.world.scenes.findIndex((x) => x.id === exit.to);
    this.enterScene(idx >= 0 ? idx : this.state.sceneIndex + 1);
    return { ok: true };
  }

  endGame() {
    this.state.phase = 'ended';
    this.state.combat = null;
    this.state.pendingCheck = null;
    this.state.milestonesOpen = this.characters.map((c) => c.playerId);
    this.cue({ reason: 'Ende', sfx: [{ id: 'level_up', delayMs: 0 }], bed: 'silence' });
    this.say('Hier endet der erste Akt. Jede Figur darf wachsen: Wählt auf dem Handy einen Wert oder eine Fähigkeit.');
    this.changed();
    return { ok: true };
  }

  setPaused(p) { this.state.paused = Boolean(p); this.changed(); return { ok: true }; }

  chooseMilestone(playerId, choice) {
    if (!this.state.milestonesOpen.includes(playerId)) return { ok: false, error: 'Kein Meilenstein offen' };
    const ch = this.charOf(playerId);
    const r = applyMilestone(ch, choice);
    if (!r.ok) return r;
    this.state.milestonesOpen = this.state.milestonesOpen.filter((id) => id !== playerId);
    this.cue(sound.milestoneCue());
    this.log('milestone', { playerId, choice });
    this.changed();
    return { ok: true };
  }

  // ---------- Sprache am Tisch ----------
  claimSpeaker(playerId) {
    this.state.activeSpeaker = { playerId, until: Date.now() + SPEAKER_WINDOW_MS };
    this.emit({ type: 'state' });
    return { ok: true };
  }

  resolveSpeaker(explicitId) {
    if (explicitId && this.charOf(explicitId)) return explicitId;
    const a = this.state.activeSpeaker;
    if (a && a.until > Date.now() && this.charOf(a.playerId)) return a.playerId;
    if (this.characters.length === 1) return this.characters[0].playerId;
    return 'unklar';
  }

  // Ein gesprochener oder getippter Beitrag vom Tisch
  utterance({ text, speakerId, source = 'mic' }) {
    const t = String(text || '').trim().slice(0, 500);
    if (!t || this.state.phase !== 'playing') return { ok: false };
    const id = this.resolveSpeaker(speakerId);
    const ch = this.charOf(id);
    const entry = { ts: Date.now(), speakerId: id, speakerName: ch ? ch.name : 'unklar', text: t, source };
    this.state.transcript.push(entry);
    this.feed(entry.speakerName, t, 'player');
    this.log('utterance', entry);
    this.scheduleModerator();
    this.emit({ type: 'state' });
    return { ok: true };
  }

  scheduleModerator(delay = QUIET_MS) {
    if (!this.state.ai.enabled || this.state.paused) return;
    clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => this.runModerator(), delay);
  }

  setAi(enabled) { this.state.ai.enabled = Boolean(enabled); this.changed(); return { ok: true }; }

  transcriptText(n = 24) {
    return this.state.transcript.slice(-n).map((u) => `[${u.speakerName}] ${u.text}`).join('\n') || '(noch nichts gesagt)';
  }

  async runModerator() {
    const ai = this.state.ai;
    if (ai.busy) { this.dirty = true; return; }
    if (this.state.phase !== 'playing' || !this.scene) return;
    ai.busy = true;
    this.dirty = false;
    this.emit({ type: 'thinking', on: true });
    const scene = this.scene;
    const ctx = {
      world: this.world, scene,
      characters: this.characters,
      inventories: this.state.inventories,
      loot: this.state.loot,
      hiddenLoot: this.state.hiddenLoot.map((l) => l.itemId),
      enemiesInFight: this.state.combat?.enemies || [],
      inFight: Boolean(this.state.combat),
      transcript: this.transcriptText(),
      lastUtterance: [...this.state.transcript].reverse().find((u) => u.source !== 'moderator'),
      minutesLeft: Math.max(0, this.state.durationMin - this.minutes(this.state.startedAt)),
      sceneMinutes: this.minutes(this.state.sceneStartedAt),
      beds: sound.allBeds(),
      sfx: [...new Set([...(scene.allowedSfx || []), 'door_creak', 'coins', 'magic', 'bell'])],
    };
    try {
      const res = await this.moderator.judge({
        system: systemPrompt(this.world), context: contextMessage(ctx), ctx,
        usage: { tokensIn: ai.tokensIn, tokensOut: ai.tokensOut },
      });
      ai.calls += 1; ai.tokensIn += res.tokensIn; ai.tokensOut += res.tokensOut; ai.lastLatencyMs = res.latencyMs; ai.lastError = null;
      const { judgment, problems } = validateJudgment(res.raw, ctx);
      this.log('judgment', { raw: res.raw, judgment, problems, latencyMs: res.latencyMs, tokensIn: res.tokensIn, tokensOut: res.tokensOut });
      this.applyJudgment(judgment);
    } catch (err) {
      ai.lastError = err.message;
      this.log('moderator_error', { error: err.message });
      if (err.code === 'BUDGET') { ai.enabled = false; this.feed('Tisch', 'Token-Deckel erreicht: Der Host moderiert jetzt von Hand weiter.', 'system'); }
      else this.say('Einen Moment, ich habe den Faden verloren. Erzählt mir nochmal, was ihr vorhabt.');
    } finally {
      ai.busy = false;
      this.emit({ type: 'thinking', on: false });
      this.changed();
      if (this.dirty) this.scheduleModerator(200);
    }
  }

  applyJudgment(j) {
    const scene = this.scene;
    if (j.audio) this.cue(sound.moderatorCue(j.audio, scene));
    if (j.narration) this.say(j.narration);
    for (const l of j.npc_lines) this.say(l.text, { voice: `npc:${l.npc}`, who: l.npc });
    if (j.reveal_loot.length) this.revealLoot(j.reveal_loot);
    if (j.event) this.applyEvent(j.event);
    if (j.combat?.start?.length && !this.state.combat) this.startCombat(j.combat.start);
    if (j.combat?.end && this.state.combat) this.endCombat('Der Kampf ist vorbei.');
    if (j.check) this.requestCheck(j.check);
    if (j.scene_signal !== 'continue') {
      const exitId = j.scene_signal === 'abort' ? scene.exits[0].id : j.scene_signal;
      setTimeout(() => { if (this.scene === scene) this.nextScene(exitId); }, 2500);
    }
  }

  applyEvent(ev) {
    const ch = this.charOf(ev.player_id);
    if (!ch) return;
    const dmg = rollEventDamage(ev.class, ev.severity, this.rng);
    if (ev.class === 'Z') ch.conditions.push({ class: 'Z', severity: ev.severity, label: ev.reason || 'Zustand' });
    const lp = applyLp(ch, -dmg.total);
    this.feed('Tisch', `${ch.name}: −${dmg.total} LP (${ev.reason})`, 'system');
    this.cue(lp.wentDown ? sound.downCue() : sound.trapCue(true));
    this.log('event', { playerId: ev.player_id, event: ev, damage: dmg, lp });
  }

  // ---------- Proben ----------
  requestCheck(c, by = 'moderator') {
    const ch = this.charOf(c.player_id);
    if (!ch) return { ok: false, error: 'Figur unbekannt' };
    this.state.pendingCheck = { id: randomUUID().slice(0, 8), ...c, by, characterName: ch.name, statLabel: STAT_LABELS[c.stat], statValue: ch.stats[c.stat] };
    this.feed('Tisch', `${ch.name} würfelt auf ${STAT_LABELS[c.stat]}: ${c.reason}`, 'system');
    this.emit({ type: 'check_request', playerId: c.player_id });
    this.changed();
    return { ok: true };
  }

  rollCheck(playerId, natural) {
    const pc = this.state.pendingCheck;
    if (!pc || pc.player_id !== playerId) return { ok: false, error: 'Gerade keine Probe für dich' };
    const ch = this.charOf(playerId);
    const result = resolveCheck({ statValue: ch.stats[pc.stat], dc: pc.dc, window: pc.window, descriptionBonus: pc.description_bonus, natural }, this.rng);
    this.state.pendingCheck = null;
    this.cue(sound.checkCue(result));
    this.feed('Würfel', `${ch.name}: ${result.natural} + ${result.statValue} = ${result.total} gegen ${result.dc} → ${result.label}`, 'roll');
    this.log('roll', { playerId, check: pc, result });
    this.state.transcript.push({ ts: Date.now(), speakerId: 'system', speakerName: 'Würfel', text: `${ch.name} ${pc.reason}: ${result.label}`, source: 'system' });

    if (result.succeeded) {
      this.say(pc.on_success);
      if (result.outcome === 'strong' || result.outcome === 'crit') this.say(pc.on_strong);
      if (pc.reveal_on_success?.length) this.revealLoot(pc.reveal_on_success);
      if (result.outcome === 'price') { const lp = payPrice(ch); this.feed('Tisch', `Erfolg mit Preis: ${ch.name} −5 LP`, 'system'); if (lp.wentDown) this.cue(sound.downCue()); }
    } else {
      this.say(pc.on_fail);
      if (result.outcome === 'fumble') this.say('Und als wäre das nicht genug, geht dabei noch etwas schief.');
      if (pc.fail_event) this.applyEvent({ player_id: playerId, ...pc.fail_event, reason: pc.reason });
    }
    this.changed();
    return { ok: true, result };
  }

  // ---------- Kampf ----------
  startCombat(enemyIds) {
    const enemies = enemyIds.map((id, i) => {
      const t = this.world.enemies.find((e) => e.id === id);
      return t ? makeEnemy(t, `${id}-${i + 1}`) : null;
    }).filter(Boolean);
    if (!enemies.length) return;
    this.state.combat = { enemies };
    this.cue(sound.combatStartCue(enemies));
    this.log('combat_start', { enemies: enemies.map((e) => e.id) });
    this.changed();
  }

  endCombat(text) {
    const enemies = this.state.combat?.enemies || [];
    for (const e of enemies) if (e.defeated && e.loot) {
      for (const entry of this.world.lootTables[e.loot] || []) this.addLoot(entry.item, entry.qty, false);
    }
    this.state.combat = null;
    this.cue(sound.combatEndCue(this.scene));
    this.say(text);
    this.log('combat_end', {});
    this.state.transcript.push({ ts: Date.now(), speakerId: 'system', speakerName: 'Tisch', text: 'Der Kampf ist vorbei.', source: 'system' });
    this.changed();
    this.scheduleModerator(1500);
  }

  attack(playerId, { enemyId, weaponUid, natural }) {
    const combat = this.state.combat;
    if (!combat) return { ok: false, error: 'Gerade kein Kampf' };
    const ch = this.charOf(playerId);
    if (!ch || ch.down) return { ok: false, error: 'Deine Figur kann gerade nicht kämpfen' };
    const enemy = combat.enemies.find((e) => e.instanceId === enemyId && !e.defeated) || combat.enemies.find((e) => !e.defeated);
    if (!enemy) return { ok: false, error: 'Kein Gegner mehr' };
    const invItem = this.state.inventories[ch.id].items.find((i) => i.uid === weaponUid);
    const def = invItem ? this.itemDef(invItem.itemId) : null;
    const weapon = def?.weapon ? { name: def.name, ...def.weapon } : { name: 'Fäuste', damage: '1W6', kind: 'faust', stat: 'kraft' };
    const result = combatExchange({ character: ch, stat: weapon.stat, enemy, weapon, natural }, this.rng);
    this.cue(sound.exchangeCue(result));
    this.log('attack', { playerId, enemy: enemy.instanceId, weapon, result });
    this.feed('Würfel', `${ch.name} → ${enemy.name}: ${result.check.natural} + ${result.check.statValue} = ${result.check.total} gegen ${enemy.abwehr} → ${result.check.label}`, 'roll');
    this.say(this.combatLine(ch, enemy, weapon, result));
    if (combat.enemies.every((e) => e.defeated)) {
      setTimeout(() => { if (this.state.combat === combat) this.endCombat('Stille. Nur noch euer Atem. Der Kampf ist vorbei.'); }, 1800);
    }
    this.changed();
    return { ok: true, result };
  }

  // Kurze Kampfsätze ohne KI (0 ms). Später durch Voicelines ersetzbar (S2.5).
  combatLine(ch, enemy, weapon, r) {
    const pick = (arr) => arr[this.rng.int(0, arr.length - 1)];
    const o = r.check.outcome;
    if (o === 'fumble') return pick([`${ch.name} rutscht aus. ${enemy.name} nutzt den Moment: ${r.complication}.`, `Ein Patzer! ${enemy.name}: ${r.complication}.`]);
    if (o === 'fail') return pick([`${enemy.name} pariert und schlägt zurück. Das tut weh, ${ch.name}.`, `Daneben, ${ch.name}. ${enemy.name} erwischt dich.`]);
    const hit = o === 'crit' ? `Ein Treffer wie aus dem Lied! ${ch.name} trifft ${enemy.name} mit voller Wucht.`
      : o === 'strong' ? `${ch.name} trifft sauber, ${enemy.name} wankt.`
      : o === 'price' ? `${ch.name} trifft, fängt sich dabei aber selbst einen Schlag ein.`
      : pick([`${ch.name} trifft ${enemy.name} mit ${weapon.name === 'Fäuste' ? 'der Faust' : `dem ${weapon.name}`}.`, `Treffer, ${ch.name}!`]);
    return r.enemyDefeated ? `${hit} ${enemy.name} geht zu Boden.` : hit;
  }

  // ---------- Rucksack & Loot ----------
  takeLoot(playerId, lootId) {
    const ch = this.charOf(playerId);
    const idx = this.state.loot.findIndex((l) => l.lootId === lootId);
    if (!ch || idx < 0) return { ok: false, error: 'Nicht mehr da' };
    const l = this.state.loot[idx];
    const r = this.giveItem(ch, l.itemId, l.qty);
    if (!r.ok) return r;
    this.state.loot.splice(idx, 1);
    this.cue(sound.lootCue(this.itemDef(l.itemId)));
    this.feed('Tisch', `${ch.name} nimmt ${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}.`, 'system');
    this.log('loot', { playerId, item: l });
    this.changed();
    return { ok: true };
  }

  moveItem(playerId, uid, x, y) {
    const ch = this.charOf(playerId);
    const r = moveItem(this.state.inventories[ch.id], uid, Number(x), Number(y));
    if (r.ok) this.changed();
    return r;
  }

  dropItem(playerId, uid) {
    const ch = this.charOf(playerId);
    const r = removeItem(this.state.inventories[ch.id], uid, Infinity);
    if (!r.ok) return r;
    this.state.loot.push({ lootId: randomUUID().slice(0, 8), itemId: r.item.itemId, name: r.item.name, qty: r.item.qty });
    this.changed();
    return { ok: true };
  }

  giveTo(playerId, uid, targetPlayerId) {
    const ch = this.charOf(playerId), target = this.charOf(targetPlayerId);
    if (!ch || !target) return { ok: false, error: 'Unbekannt' };
    const inv = this.state.inventories[ch.id];
    const it = inv.items.find((i) => i.uid === uid);
    if (!it) return { ok: false, error: 'Gegenstand nicht gefunden' };
    const r = this.giveItem(target, it.itemId, 1);
    if (!r.ok) return { ok: false, error: `${target.name} hat keinen Platz` };
    removeItem(inv, uid, 1);
    this.feed('Tisch', `${ch.name} reicht ${target.name}: ${it.name}.`, 'system');
    this.changed();
    return { ok: true };
  }

  useItem(playerId, uid, targetPlayerId) {
    const ch = this.charOf(playerId);
    const inv = this.state.inventories[ch.id];
    const it = inv.items.find((i) => i.uid === uid);
    const def = it && this.itemDef(it.itemId);
    if (!def?.use) return { ok: false, error: 'Lässt sich nicht benutzen' };
    const target = this.charOf(targetPlayerId) || ch;
    const r = heal(target, 'consume', this.rng, { amount: def.use.heal });
    if (def.use.cures) target.conditions = target.conditions.filter((c) => c.label !== def.use.cures);
    removeItem(inv, uid, 1);
    this.cue(sound.healCue());
    this.feed('Tisch', `${target.name} +${r.lp.delta} LP (${def.name})`, 'system');
    this.log('use', { playerId, item: def.id, target: target.playerId, lp: r.lp });
    this.changed();
    return { ok: true };
  }

  rest() {
    for (const ch of this.characters) heal(ch, 'rest', this.rng);
    this.cue(sound.healCue());
    this.feed('Tisch', 'Rast: alle +40 LP.', 'system');
    this.changed();
    return { ok: true };
  }

  // ---------- Host-Eingriffe ----------
  hostSfx(id) { this.cue({ reason: 'Host', sfx: [{ id, delayMs: 0 }] }); return { ok: true }; }
  hostBed(id) { this.cue({ reason: 'Host', sfx: [], bed: id }); return { ok: true }; }
  hostSay(text) { this.say(String(text).slice(0, 400)); this.changed(); return { ok: true }; }

  // ---------- Sichten ----------
  view(viewer) {
    const s = this.state;
    const scene = this.scene;
    const isHost = viewer === 'host';
    const me = !isHost ? this.charOf(viewer) : null;
    return {
      code: this.code,
      phase: s.phase, paused: s.paused,
      clock: { durationMin: s.durationMin, elapsedMin: this.minutes(s.startedAt), sceneMin: this.minutes(s.sceneStartedAt) },
      world: { name: this.world.name, title: this.world.adventure.title, pitch: this.world.adventure.pitch },
      scene: scene ? {
        id: scene.id, title: scene.title, act: scene.act, budgetMin: scene.budgetMin,
        ...(isHost ? { exits: scene.exits, abortSignal: scene.abortSignal, allowedSfx: scene.allowedSfx } : {}),
      } : null,
      players: s.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, hasCharacter: Boolean(s.characters[p.id]) })),
      characters: this.characters.map((c) => ({ playerId: c.playerId, name: c.name, concept: c.concept, lp: c.lp, lpMax: c.lpMax, down: c.down, conditions: c.conditions.map((x) => x.label) })),
      me: me ? { character: me, inventory: s.inventories[me.id] } : null,
      loot: s.loot,
      hiddenLootCount: s.hiddenLoot.length,
      combat: s.combat ? { enemies: s.combat.enemies.map((e) => ({ instanceId: e.instanceId, name: e.name, lp: e.lp, lpMax: e.lpMax, defeated: e.defeated, abwehr: isHost ? e.abwehr : undefined })) } : null,
      pendingCheck: s.pendingCheck ? {
        id: s.pendingCheck.id, playerId: s.pendingCheck.player_id, characterName: s.pendingCheck.characterName,
        stat: s.pendingCheck.stat, statLabel: s.pendingCheck.statLabel, reason: s.pendingCheck.reason,
        ...(isHost || s.pendingCheck.player_id === viewer ? { dc: s.pendingCheck.dc, statValue: s.pendingCheck.statValue } : {}),
      } : null,
      activeSpeaker: s.activeSpeaker && s.activeSpeaker.until > Date.now() ? s.activeSpeaker.playerId : null,
      feed: s.feed.slice(-30),
      milestoneOpen: !isHost && s.milestonesOpen.includes(viewer),
      abilities: this.world.abilities,
      startKitChoices: this.world.startKitChoices.map((c) => c.map((id) => this.itemDef(id)?.name).join(' + ')),
      stats: STATS.map((k) => ({ key: k, label: STAT_LABELS[k] })),
      ai: isHost ? { ...s.ai } : { enabled: s.ai.enabled, busy: s.ai.busy },
    };
  }

  snapshot() {
    return { code: this.code, hostToken: this.hostToken, state: this.state };
  }
}
