// Tabula Gala – Server. Start: npm start. Läuft auf dem Host-Laptop im WLAN.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import QRCode from 'qrcode';
import { networkInterfaces } from 'node:os';
import { readFileSync, mkdirSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from './game/game.js';
import { createModerator } from './llm/moderator.js';
import { loadEnv } from './env.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(join(root, '.env'));
const PORT = Number(process.env.PORT || 3000);
const DATA = join(root, 'data', 'sessions');
mkdirSync(DATA, { recursive: true });

const world = JSON.parse(readFileSync(join(root, 'content', 'klassische-fantasy', 'world.json'), 'utf8'));
const games = new Map();

export function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); } while (games.has(c));
  return c;
}

function createGame(durationMin) {
  const code = newCode();
  const dir = join(DATA, `${new Date().toISOString().slice(0, 10)}_${code}`);
  mkdirSync(dir, { recursive: true });
  let saveTimer = null;
  const game = new Game({
    code, world, durationMin,
    moderator: createModerator(),
    persist: (g) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => writeFileSync(join(dir, 'state.json'), JSON.stringify(g.snapshot(), null, 1)), 500);
    },
    log: (entry) => appendFileSync(join(dir, 'log.jsonl'), `${JSON.stringify(entry)}\n`),
  });
  games.set(code, game);
  return game;
}

export function buildServer() {
  const app = Fastify({ logger: false });
  app.register(fastifyStatic, { root: join(root, 'public') });
  app.register(fastifyWebsocket);

  app.get('/join/:code', (req, reply) => reply.sendFile('join.html'));
  app.get('/host/:code', (req, reply) => reply.sendFile('host.html'));

  // Welche Klangdateien wirklich da sind (der Host lädt nur diese, sonst Platzhalter)
  app.get('/api/audio-files', async () => {
    const base = join(root, 'public', 'audio');
    try {
      return { files: readdirSync(base, { recursive: true }).map((f) => String(f).replaceAll('\\', '/')).filter((f) => /\.(ogg|mp3|wav|m4a|webm)$/i.test(f)) };
    } catch { return { files: [] }; }
  });

  app.post('/api/sessions', async (req) => {
    const g = createGame(Number(req.body?.durationMin) || world.adventure.durationMin);
    return { code: g.code, hostToken: g.hostToken, ai: { kind: g.moderator.kind, model: g.moderator.model } };
  });

  app.get('/api/sessions/:code', async (req, reply) => {
    const g = games.get(String(req.params.code).toUpperCase());
    if (!g) return reply.code(404).send({ error: 'Keine Runde mit diesem Code' });
    return { code: g.code, phase: g.state.phase, title: world.adventure.title };
  });

  app.post('/api/sessions/:code/join', async (req, reply) => {
    const g = games.get(String(req.params.code).toUpperCase());
    if (!g) return reply.code(404).send({ error: 'Keine Runde mit diesem Code' });
    const r = g.join(req.body?.name);
    if (!r.ok) return reply.code(400).send(r);
    return r;
  });

  app.get('/api/sessions/:code/qr', async (req, reply) => {
    const url = `http://${lanAddress()}:${PORT}/join/${req.params.code}`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 320 });
    return { url, svg };
  });

  app.register(async (scope) => {
    scope.get('/ws', { websocket: true }, (socket, req) => {
      const code = String(req.query.code || '').toUpperCase();
      const tok = String(req.query.token || '');
      const g = games.get(code);
      if (!g) { socket.send(JSON.stringify({ type: 'error', error: 'Keine Runde mit diesem Code' })); return socket.close(); }
      const host = g.isHost(tok);
      const player = host ? null : g.authPlayer(tok);
      if (!host && !player) { socket.send(JSON.stringify({ type: 'error', error: 'Unbekannter Zugang' })); return socket.close(); }
      const viewer = host ? 'host' : player.id;
      if (player) { player.connected = true; g.changed(); }

      let pending = null;
      const sendState = () => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; safeSend({ type: 'state', state: g.view(viewer) }); }, 30);
      };
      const safeSend = (m) => { if (socket.readyState === 1) socket.send(JSON.stringify(m)); };

      const off = g.subscribe((msg) => {
        if (msg.type === 'state') return sendState();
        if (msg.type === 'say' || msg.type === 'cue' || msg.type === 'thinking') { if (host) safeSend(msg); if (msg.type === 'say' && !host) sendState(); return; }
        if (msg.type === 'check_request' && msg.playerId === viewer) safeSend({ type: 'buzz' });
      });
      sendState();

      socket.on('message', (buf) => {
        let m;
        try { m = JSON.parse(buf.toString()); } catch { return; }
        const r = handle(g, viewer, host, m);
        Promise.resolve(r).then((res) => safeSend({ type: 'result', reqId: m.reqId, ...(res || { ok: true }) }));
      });
      socket.on('close', () => { off(); if (player) { player.connected = false; g.changed(); } });
    });
  });

  return app;
}

// Erlaubte Aktionen je Rolle
function handle(g, viewer, host, m) {
  const p = m.payload || {};
  const playerActions = {
    character: () => g.createCharacter(viewer, p),
    roll: () => g.rollCheck(viewer, p.natural),
    attack: () => g.attack(viewer, p),
    take: () => g.takeLoot(viewer, p.lootId),
    move: () => g.moveItem(viewer, p.uid, p.x, p.y),
    drop: () => g.dropItem(viewer, p.uid),
    give: () => g.giveTo(viewer, p.uid, p.to),
    use: () => g.useItem(viewer, p.uid, p.target),
    speak: () => g.claimSpeaker(viewer),
    say: () => g.utterance({ text: p.text, speakerId: viewer, source: 'text' }),
    milestone: () => g.chooseMilestone(viewer, p),
  };
  const hostActions = {
    creation: () => g.startCreation(),
    start: () => g.startGame(),
    next: () => g.nextScene(p.exitId),
    pause: () => g.setPaused(p.paused),
    end: () => g.endGame(),
    rest: () => g.rest(),
    utterance: () => g.utterance({ text: p.text, speakerId: p.speakerId, source: p.source || 'mic' }),
    ai: () => g.setAi(p.enabled),
    sfx: () => g.hostSfx(p.id),
    bed: () => g.hostBed(p.id),
    say: () => g.hostSay(p.text),
    check: () => g.requestCheck({ player_id: p.playerId, stat: p.stat, dc: Number(p.dc), reason: p.reason || 'Probe', on_success: p.on_success || '', on_fail: p.on_fail || '' }, 'host'),
    combat: () => { g.startCombat(p.enemies || []); return { ok: true }; },
    endCombat: () => { g.endCombat('Der Kampf ist vorbei.'); return { ok: true }; },
    moderate: () => { g.runModerator(); return { ok: true }; },
  };
  const fn = host ? hostActions[m.action] : playerActions[m.action];
  if (!fn) return { ok: false, error: `Unbekannte Aktion ${m.action}` };
  try { return fn(); } catch (err) { return { ok: false, error: err.message }; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = buildServer();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  const ai = createModerator();
  console.log(`\n  Tabula Gala läuft.`);
  console.log(`  Host (dieser Laptop):  http://localhost:${PORT}`);
  console.log(`  Handys im WLAN:        http://${lanAddress()}:${PORT}`);
  console.log(`  Moderator:             ${ai.kind === 'claude' ? `Claude (${ai.model})` : 'Übungsmodus (kein ANTHROPIC_API_KEY in .env)'}\n`);
}
