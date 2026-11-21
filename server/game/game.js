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
import { RIDDLE, rateAnswer, scoreArgument, priceFor, ARGUMENT_LABELS } from '../engine/social.js';

const SPEAKER_WINDOW_MS = 12000;   // so lange gilt ein Antippen „Ich spreche“
const QUIET_MS = 1400;             // Pause, nach der der Moderator antwortet
const FEED_MAX = 60;

const token = () => randomBytes(16).toString('hex');
const roman = (n) => ['', 'I', 'II', 'III', 'IV', 'V'][n] || String(n);

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
      phase: 'lobby',             // lobby | creation | playing | interlude | ended
      nextSceneIndex: null,       // während der Pause zwischen zwei Akten
      path: [],                   // gewählte Ausgänge: {sceneId, exitId, label}
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
      riddle: null,               // {id, sceneId, attempts, hintGiven}
      solvedRiddles: [],          // Rätsel-IDs
      deals: {},                  // `${playerId}:${npc}` -> Ergebnis der Argumentationsprobe (gilt pro Szene)
      openedChests: [],           // Truhen-IDs
      penaltyMin: 0,              // Zeit, die falsche Rätselantworten gekostet haben
      adventureGen: { status: 'test', title: world.adventure.title, note: '', wishes: [] }, // test | writing | ready | failed
    };
    this.customWorld = false;
    this.quietTimer = null;
    this.actTimer = null;
    this.autoContinue = true;
    this.dirty = false;
  }

  // Nach Neustart des Servers: Runde aus state.json zurückholen. Handys und Host verbinden sich selbst neu.
  static restore(snap, opts) {
    const g = new Game({ ...opts, world: snap.world || opts.world, code: snap.code });
    g.customWorld = Boolean(snap.world);
    const fresh = g.state.ai;
    g.hostToken = snap.hostToken;
    g.state = { ...g.state, ...snap.state };
    g.state.ai = { ...fresh, ...snap.state.ai, kind: fresh.kind, model: fresh.model, busy: false, lastError: null };
    for (const p of g.state.players) { p.connected = false; p.sockets = 0; }
    g.state.activeSpeaker = null;
    if (g.state.phase === 'playing') {
      g.state.paused = true;
      g.feed('Tisch', 'Der Tisch war kurz weg und ist wieder da. Host: „Weiter“ drücken.', 'system');
    }
    g.log('restore', { phase: g.state.phase, sceneIndex: g.state.sceneIndex });
    return g;
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
  get elapsedMin() { return this.minutes(this.state.startedAt) + (this.state.penaltyMin || 0); }

  // ---------- Lobby & Figuren ----------
  join(name) {
    const clean = String(name || '').trim().slice(0, 24);
    if (!clean) return { ok: false, error: 'Bitte einen Namen eingeben' };
    // Wiederbeitritt: anderes Handy, Browser-Speicher gelöscht, Tab zu. Gleicher Name = gleicher Platz.
    const same = this.state.players.find((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (same) {
      if (same.connected) return { ok: false, error: `${same.name} sitzt schon am Tisch. Schließ das andere Fenster oder nimm einen anderen Namen.` };
      this.log('rejoin', { playerId: same.id });
      this.feed('Tisch', `${same.name} ist wieder da.`, 'system');
      this.changed();
      return { ok: true, playerId: same.id, token: same.token, rejoined: true };
    }
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
    if (this.state.phase === 'ended') return { ok: false, error: 'Der Abend ist vorbei' };
    if (this.state.characters[playerId]) return { ok: false, error: 'Du hast schon eine Figur' };
    const late = ['playing', 'interlude'].includes(this.state.phase);
    const res = createCharacter({ id: `c-${playerId}`, playerId, name, concept, kerbe, stats });
    if (!res.ok) return { ok: false, error: res.errors.join('; ') };
    const ch = res.character;
    this.state.characters[playerId] = ch;
    const inv = createInventory();
    this.state.inventories[ch.id] = inv;
    const choice = this.world.startKitChoices[Number(kit)] || this.world.startKitChoices[0];
    for (const id of [...choice, 'heiltrank']) this.giveItem(ch, id, 1);
    if (this.world.startSilver && this.itemDef('silberbeutel')) this.giveItem(ch, 'silberbeutel', this.world.startSilver);
    this.log('character', { playerId, character: ch, late });
    if (late) {
      this.say(`Die Tür geht auf. ${ch.name} stößt zu euch${ch.concept ? `: ${ch.concept}` : ''}.`);
      this.state.transcript.push({ ts: Date.now(), speakerId: 'system', speakerName: 'Tisch', text: `${ch.name} ist neu dazugekommen.`, source: 'system' });
    }
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
    if (this.state.adventureGen.status === 'writing') return { ok: false, error: 'Der Moderator schreibt noch am Abenteuer. Einen Moment.' };
    if (this.state.phase === 'playing') return { ok: false, error: 'Läuft schon' };
    this.state.phase = 'playing';
    this.state.startedAt = Date.now();
    this.say('Willkommen am Tisch. Ich bin euer Moderator heute Abend, eine künstliche Intelligenz. Ihr sprecht einfach, ich höre zu und erzähle.');
    this.say(`Heute: ${this.world.adventure.title}. ${this.world.adventure.pitch}`);
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
    this.state.riddle = null;
    this.state.deals = {};
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
    if (!s || this.state.phase !== 'playing') return { ok: false, error: 'Keine Szene' };
    const exit = s.exits.find((e) => e.id === exitId) || s.exits[0];
    this.log('exit', { sceneId: s.id, exit: exit.id });
    this.feed('Tisch', `Ausgang: ${exit.label}`, 'system');
    this.state.path.push({ sceneId: s.id, exitId: exit.id, label: exit.label });
    if (!exit.to) return this.endGame();
    let idx = this.world.scenes.findIndex((x) => x.id === exit.to);
    if (idx < 0) idx = this.state.sceneIndex + 1;
    const next = this.world.scenes[idx];
    if (next && next.act > s.act) return this.actBreak(s.act, idx);
    this.enterScene(idx);
    return { ok: true };
  }

  // Ende eines Akts (Kernmechanik §4, §5): Rast für alle, Meilenstein, dann weiter
  actBreak(act, nextIndex) {
    clearTimeout(this.quietTimer);
    this.state.phase = 'interlude';
    this.state.nextSceneIndex = nextIndex;
    this.state.combat = null;
    this.state.pendingCheck = null;
    for (const ch of this.characters) { ch.conditions = []; heal(ch, 'rest', this.rng); if (ch.lp > 0) ch.down = false; }
    this.state.milestonesOpen = this.characters.map((c) => c.playerId);
    this.cue({ reason: `Ende Akt ${act}`, sfx: [{ id: 'level_up', delayMs: 0 }], bed: 'silence' });
    this.feed('Tisch', `Ende von Akt ${act}. Rast: alle +40 LP.`, 'system');
    this.say(`Hier endet Akt ${roman(act)}. Atmet durch, vertretet euch die Beine. Jede Figur darf wachsen: Wählt auf dem Handy einen Wert oder eine Fähigkeit. Wenn alle gewählt haben, geht es weiter.`);
    this.log('act_break', { act, nextScene: this.world.scenes[nextIndex]?.id });
    this.changed();
    return { ok: true };
  }

  continueAct() {
    if (this.state.phase !== 'interlude') return { ok: false, error: 'Gerade keine Pause zwischen den Akten' };
    const idx = this.state.nextSceneIndex;
    this.state.phase = 'playing';
    this.state.nextSceneIndex = null;
    this.state.milestonesOpen = [];
    this.say(`Akt ${roman(this.world.scenes[idx]?.act ?? 2)}.`);
    this.enterScene(idx);
    return { ok: true };
  }

  endGame() {
    this.state.phase = 'ended';
    this.state.combat = null;
    this.state.pendingCheck = null;
    this.state.milestonesOpen = [];
    this.cue({ reason: 'Ende', sfx: [{ id: 'level_up', delayMs: 0 }], bed: 'silence' });
    const outro = this.scene?.exits.find((e) => e.id === this.state.path.at(-1)?.exitId)?.outro;
    if (outro) this.say(outro);
    this.say('Hier endet das Nachtstück. Eure Figuren sind gespeichert und dürfen beim nächsten Mal wiederkommen. Danke, dass ihr mitgespielt habt.');
    this.changed();
    return { ok: true };
  }

  // ---------- Abenteuer auf Zuruf ----------
  addWish(who, text) {
    const t = String(text || '').trim().slice(0, 200);
    if (!t) return { ok: false, error: 'Leerer Wunsch' };
    if (!['lobby', 'creation'].includes(this.state.phase)) return { ok: false, error: 'Wünsche gehen nur vor dem Spiel' };
    const name = who === 'host' ? 'Host' : this.player(who)?.name || '?';
    const list = this.state.adventureGen.wishes;
    if (list.filter((w) => w.by === who).length >= 3) return { ok: false, error: 'Höchstens 3 Wünsche pro Person' };
    list.push({ by: who, who: name, text: t });
    this.log('wish', { by: who, text: t });
    this.changed();
    return { ok: true };
  }

  async writeAdventure(author, base) {
    const gen = this.state.adventureGen;
    if (!['lobby', 'creation'].includes(this.state.phase)) return { ok: false, error: 'Nur vor dem Spiel' };
    if (gen.status === 'writing') return { ok: false, error: 'Schreibt schon' };
    gen.status = 'writing'; gen.note = 'Der Moderator schreibt euer Abenteuer …';
    this.changed();
    const started = Date.now();
    try {
      const res = await author.write({ wishes: gen.wishes, base, players: this.state.players.map((p) => p.name), durationMin: this.state.durationMin });
      this.state.ai.tokensIn += res.tokensIn; this.state.ai.tokensOut += res.tokensOut;
      if (this.state.phase !== 'lobby' && this.state.phase !== 'creation') return { ok: false };
      this.world = res.world;
      this.customWorld = !res.fallback;
      gen.status = res.fallback ? 'test' : 'ready';
      gen.title = this.world.adventure.title;
      gen.note = res.fallback ? 'Ohne API-Schlüssel gibt es nur das Testabenteuer.' : `Fertig nach ${Math.round((Date.now() - started) / 1000)} s.`;
      this.log('adventure', { generated: !res.fallback, rounds: res.rounds, fixes: res.fixes, tokensIn: res.tokensIn, tokensOut: res.tokensOut, ms: Date.now() - started, world: res.fallback ? undefined : this.world });
    } catch (err) {
      this.world = base; this.customWorld = false;
      gen.status = 'failed'; gen.title = base.adventure.title;
      gen.note = 'Das hat nicht geklappt. Ihr spielt das Testabenteuer.';
      if (err.tokensIn) { this.state.ai.tokensIn += err.tokensIn; this.state.ai.tokensOut += err.tokensOut; }
      this.log('adventure_error', { error: err.message, ms: Date.now() - started });
    }
    this.changed();
    return { ok: true };
  }

  useTestAdventure(base) {
    if (!['lobby', 'creation'].includes(this.state.phase) || this.state.adventureGen.status === 'writing') return { ok: false, error: 'Gerade nicht' };
    this.world = base; this.customWorld = false;
    Object.assign(this.state.adventureGen, { status: 'test', title: base.adventure.title, note: '' });
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
    this.feed('Tisch', `${ch.name} wächst: ${choice.stat ? `${STAT_LABELS[choice.stat]} +1` : choice.ability}`, 'system');
    // Alle haben gewählt: kurz durchatmen, dann beginnt der nächste Akt von selbst
    if (this.state.phase === 'interlude' && !this.state.milestonesOpen.length && this.autoContinue) {
      clearTimeout(this.actTimer);
      this.actTimer = setTimeout(() => { if (this.state.phase === 'interlude') this.continueAct(); }, 4000);
    }
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
      minutesLeft: Math.max(0, this.state.durationMin - this.elapsedMin),
      path: this.state.path,
      riddle: this.activeRiddle(),
      solvedRiddles: this.state.solvedRiddles,
      deals: this.state.deals,
      openedChests: this.state.openedChests,
      silver: Object.fromEntries(this.characters.map((c) => [c.playerId, this.silverOf(c)])),
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
    if (j.open_chest) this.openChest(j.open_chest);
    if (j.riddle_answer) this.answerRiddle(j.riddle_answer);
    if (j.riddle_start) this.startRiddle(j.riddle_start);
    if (j.argument) this.argue(j.argument);
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
      if (pc.open_chest_on_success) this.openChest(pc.open_chest_on_success, playerId);
      if (pc.riddle_id) this.solveRiddle(playerId, 'nachgedacht');
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
    this.emit({ type: 'buzz', all: true, kind: 'combat' });
    this.log('combat_start', { enemies: enemies.map((e) => e.id) });
    this.changed();
  }

  endCombat(text) {
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
    if (result.enemyDefeated) this.dropLoot(enemy);
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
    if (!ch || idx < 0) return { ok: false, error: 'Zu spät, schon weg.' };
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

  // ---------- Loot: Drops und Truhen. Alle sehen alles, schnellster Finger mit Platz gewinnt ----------
  dropLoot(enemy) {
    const table = enemy.loot ? this.world.lootTables[enemy.loot] || [] : [];
    if (!table.length) return;
    for (const entry of table) this.addLoot(entry.item, entry.qty, false);
    const names = table.map((e) => this.itemDef(e.item)?.name).filter(Boolean).join(', ');
    this.feed('Tisch', `${enemy.name} lässt fallen: ${names}. Wer zuerst tippt, hat es.`, 'system');
    this.cue({ reason: 'Drop', sfx: [{ id: 'loot_pickup', delayMs: 900 }] });
    this.emit({ type: 'buzz', all: true, kind: 'loot' });
  }

  chestDef(id) { return (this.scene?.chests || []).find((c) => c.id === id); }

  openChest(id, playerId) {
    const chest = this.chestDef(id);
    if (!chest || this.state.openedChests.includes(id)) return { ok: false, error: 'Keine solche Truhe' };
    this.state.openedChests.push(id);
    const table = this.world.lootTables[chest.loot] || [];
    for (const entry of table) this.addLoot(entry.item, entry.qty, false);
    const who = this.charOf(playerId)?.name;
    const names = table.map((e) => `${this.itemDef(e.item)?.name}${e.qty > 1 ? ` ×${e.qty}` : ''}`).join(', ');
    this.feed('Tisch', `${who ? `${who} öffnet` : 'Offen'}: ${chest.label}. Darin: ${names || 'nichts'}. Wer zuerst tippt, hat es.`, 'system');
    this.cue({ reason: 'Truhe', sfx: [{ id: 'wood_creak', delayMs: 0 }, { id: table.some((e) => this.itemDef(e.item)?.value) ? 'coins' : 'loot_pickup', delayMs: 700 }] });
    this.emit({ type: 'buzz', all: true, kind: 'loot' });
    this.log('chest', { id, playerId, items: table });
    this.changed();
    return { ok: true };
  }

  // ---------- Rätsel (Kernmechanik §3: falsch kostet Zeit, nicht LP) ----------
  riddleDef(id) { return (this.scene?.riddles || []).find((r) => r.id === id); }
  activeRiddle() {
    const r = this.state.riddle;
    const def = r && this.riddleDef(r.id);
    return def ? { ...def, attempts: r.attempts, hintGiven: r.hintGiven } : null;
  }

  startRiddle(id) {
    const def = this.riddleDef(id);
    if (!def || this.state.solvedRiddles.includes(id)) return { ok: false, error: 'Kein solches Rätsel' };
    this.state.riddle = { id, sceneId: this.scene.id, attempts: 0, hintGiven: false };
    const npc = (this.scene.npcs || []).find((n) => n.id === def.npc);
    this.say(def.question, npc ? { voice: `npc:${npc.id}`, who: npc.name } : {});
    this.cue({ reason: 'Rätsel', sfx: [{ id: 'magic', delayMs: 0 }] });
    this.log('riddle_start', { id });
    this.changed();
    return { ok: true };
  }

  answerRiddle({ player_id, answer, rating }) {
    const r = this.state.riddle;
    const def = r && this.riddleDef(r.id);
    const ch = this.charOf(player_id);
    if (!def || !ch) return { ok: false };
    const verdict = rateAnswer(def, answer, rating);
    this.log('riddle_answer', { id: def.id, playerId: player_id, answer, llmRating: rating, verdict });
    if (verdict === 'richtig') return this.solveRiddle(player_id, 'gelöst');
    if (verdict === 'nah') {
      // Nah dran: mit Verstand nachbessern (Würfel), statt einfach „falsch“
      this.feed('Tisch', `${ch.name} ist nah dran. Verstand-Probe zum Nachbessern.`, 'system');
      return this.requestCheck({
        player_id, stat: def.stat || 'verstand', dc: def.dc || RIDDLE.defaultDc,
        reason: 'Nah dran: den Gedanken zu Ende denken', riddle_id: def.id,
        on_success: def.solvedText || 'Der Groschen fällt. Das ist die Lösung.',
        on_fail: 'Der Gedanke entgleitet dir wieder. Versucht es weiter.',
      });
    }
    r.attempts += 1;
    this.state.penaltyMin += RIDDLE.wrongPenaltyMin;
    this.feed('Tisch', `Falsch. Das kostet ${RIDDLE.wrongPenaltyMin} Minuten.`, 'system');
    this.cue({ reason: 'Rätsel falsch', sfx: [{ id: 'fail_low', delayMs: 0 }] });
    if (r.attempts >= RIDDLE.maxAttempts) {
      this.state.riddle = null;
      this.say(def.failText || 'Die Antwort bleibt im Dunkeln. Ihr müsst einen anderen Weg finden.');
    } else if (r.attempts >= RIDDLE.hintAfter && !r.hintGiven && def.hint) {
      r.hintGiven = true;
      this.say(`Ein Hinweis: ${def.hint}`);
    }
    this.changed();
    return { ok: true, verdict };
  }

  solveRiddle(playerId, how) {
    const r = this.state.riddle;
    const def = r && this.riddleDef(r.id);
    if (!def) return { ok: false };
    this.state.riddle = null;
    this.state.solvedRiddles.push(def.id);
    const ch = this.charOf(playerId);
    if (how === 'gelöst') this.say(def.solvedText || 'Richtig.');
    this.feed('Tisch', `Rätsel ${how}${ch ? ` von ${ch.name}` : ''}.`, 'system');
    this.cue({ reason: 'Rätsel gelöst', sfx: [{ id: 'success_chime', delayMs: 0 }] });
    if (def.reward?.reveal?.length) this.revealLoot(def.reward.reveal);
    if (def.reward?.chest) this.openChest(def.reward.chest, playerId);
    this.state.transcript.push({ ts: Date.now(), speakerId: 'system', speakerName: 'Tisch', text: `Rätsel gelöst: ${def.id}`, source: 'system' });
    this.log('riddle_solved', { id: def.id, playerId, how });
    this.changed();
    return { ok: true, verdict: 'richtig' };
  }

  // ---------- Verhandeln und Kaufen ----------
  silverOf(ch) {
    return (this.state.inventories[ch.id]?.items || []).filter((i) => i.itemId === 'silberbeutel').reduce((a, i) => a + i.qty, 0);
  }

  argue({ player_id, npc, comment, ...scores }) {
    const ch = this.charOf(player_id);
    if (!ch) return { ok: false };
    const res = scoreArgument(scores, ch.stats.wort);
    this.state.deals[`${player_id}:${npc}`] = { npc, ...res };
    const parts = Object.entries(res.parts).map(([k, v]) => `${ARGUMENT_LABELS[k]} ${v}`).join(', ');
    this.feed('Würfel', `${ch.name} verhandelt: ${parts}${res.bonus ? ', Wort +1' : ''} = ${res.points} → ${res.label}${res.discount ? ` (−${Math.round(res.discount * 100)} %)` : ''}`, 'roll');
    this.cue({ reason: 'Verhandlung', sfx: [{ id: res.tier === 'abgelehnt' ? 'fail_low' : 'success_chime', delayMs: 0 }] });
    this.log('argument', { playerId: player_id, npc, scores, result: res, comment });
    this.changed();
    return { ok: true, result: res };
  }

  shopView(playerId) {
    const shop = this.scene?.shop;
    if (!shop) return null;
    const deal = playerId ? this.state.deals[`${playerId}:${shop.npc}`] : null;
    const npc = (this.scene.npcs || []).find((n) => n.id === shop.npc);
    return {
      npc: shop.npc, npcName: npc?.name || shop.npc,
      deal: deal ? { tier: deal.tier, label: deal.label, discount: deal.discount } : null,
      items: shop.items.map((e) => ({ itemId: e.item, name: this.itemDef(e.item)?.name || e.item, list: e.price, price: priceFor(e.price, deal) })),
    };
  }

  buy(playerId, itemId) {
    const ch = this.charOf(playerId);
    const shop = this.shopView(playerId);
    const offer = shop?.items.find((i) => i.itemId === itemId);
    if (!ch || !offer) return { ok: false, error: 'Gibt es hier nicht' };
    if (offer.price === null) return { ok: false, error: `${shop.npcName} will dir heute nichts verkaufen.` };
    if (this.silverOf(ch) < offer.price) return { ok: false, error: `Zu wenig Silber (${this.silverOf(ch)} von ${offer.price})` };
    const added = this.giveItem(ch, itemId, 1);
    if (!added.ok) return { ok: false, error: 'Kein Platz im Rucksack' };
    let rest = offer.price;
    const inv = this.state.inventories[ch.id];
    for (const pile of inv.items.filter((i) => i.itemId === 'silberbeutel')) {
      if (!rest) break;
      const take = Math.min(rest, pile.qty);
      removeItem(inv, pile.uid, take);
      rest -= take;
    }
    this.feed('Tisch', `${ch.name} kauft ${offer.name} für ${offer.price} Silber.`, 'system');
    this.cue({ reason: 'Kauf', sfx: [{ id: 'coins', delayMs: 0 }] });
    this.log('buy', { playerId, itemId, price: offer.price, list: offer.list });
    this.state.transcript.push({ ts: Date.now(), speakerId: playerId, speakerName: ch.name, text: `(kauft ${offer.name} für ${offer.price} Silber)`, source: 'system' });
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
      clock: { durationMin: s.durationMin, elapsedMin: this.elapsedMin, sceneMin: this.minutes(s.sceneStartedAt), penaltyMin: s.penaltyMin || 0 },
      world: { name: this.world.name, title: this.world.adventure.title, pitch: this.world.adventure.pitch },
      adventureGen: { status: s.adventureGen.status, title: s.adventureGen.title, note: s.adventureGen.note, wishes: s.adventureGen.wishes.map((w) => ({ who: w.who, text: w.text })) },
      scene: scene ? {
        id: scene.id, title: scene.title, act: scene.act, budgetMin: scene.budgetMin, ambience: scene.ambience,
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
      riddle: (() => {
        const r = this.activeRiddle();
        if (!r) return null;
        return { id: r.id, question: r.question, attempts: r.attempts, maxAttempts: RIDDLE.maxAttempts, ...(isHost ? { answers: r.answers, hint: r.hint } : {}) };
      })(),
      shop: s.phase === 'playing' ? this.shopView(isHost ? null : viewer) : null,
      silver: me ? this.silverOf(me) : null,
      chests: isHost && scene ? (scene.chests || []).map((c) => ({ id: c.id, label: c.label, opened: s.openedChests.includes(c.id) })) : undefined,
      activeSpeaker: s.activeSpeaker && s.activeSpeaker.until > Date.now() ? s.activeSpeaker.playerId : null,
      feed: s.feed.slice(-30),
      milestoneOpen: !isHost && s.milestonesOpen.includes(viewer),
      milestonesPending: s.milestonesOpen.length,
      nextScene: s.phase === 'interlude' ? { title: this.world.scenes[s.nextSceneIndex]?.title, act: this.world.scenes[s.nextSceneIndex]?.act } : null,
      abilities: this.world.abilities,
      startKitChoices: this.world.startKitChoices.map((c) => c.map((id) => this.itemDef(id)?.name).join(' + ')),
      stats: STATS.map((k) => ({ key: k, label: STAT_LABELS[k] })),
      ai: isHost ? { ...s.ai } : { enabled: s.ai.enabled, busy: s.ai.busy },
    };
  }

  snapshot() {
    return { code: this.code, hostToken: this.hostToken, state: this.state, ...(this.customWorld ? { world: this.world } : {}) };
  }
}
