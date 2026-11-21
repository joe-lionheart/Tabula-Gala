// Klang im Host: Klangteppiche mit Überblendung, Effekte, Ducking unter der Erzählstimme.
// Echte Dateien aus public/audio/ haben Vorrang; fehlen sie, spielt ein synthetischer Platzhalter.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.manifest = null;
    this.buffers = new Map();
    this.missing = new Set();
    this.currentBed = null; // {id, gain, stop}
    this.ducked = false;
    this.volume = { bed: 1, sfx: 1 };
  }

  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.bedBus = this.ctx.createGain(); this.bedBus.connect(this.master);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
    this.manifest = await fetch('/audio/manifest.json').then((r) => r.json());
    const { files } = await fetch('/api/audio-files').then((r) => r.json()).catch(() => ({ files: [] }));
    this.available = new Set(files);
  }

  async load(path) {
    if (!path) return null;
    if (this.buffers.has(path)) return this.buffers.get(path);
    if (this.missing.has(path) || !this.available?.has(path)) return null;
    try {
      const res = await fetch(`/audio/${path}`);
      if (!res.ok) throw new Error(res.status);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(path, buf);
      return buf;
    } catch { this.missing.add(path); return null; }
  }

  duck(on) {
    if (!this.ctx) return;
    this.ducked = on;
    const t = this.ctx.currentTime;
    this.bedBus.gain.cancelScheduledValues(t);
    this.bedBus.gain.setTargetAtTime(on ? 0.3 : this.volume.bed, t, 0.25);
  }

  setVolume(kind, v) {
    this.volume[kind] = v;
    if (kind === 'sfx') this.sfxBus.gain.value = v;
    if (kind === 'bed' && !this.ducked) this.bedBus.gain.value = v;
  }

  async playCue(cue) {
    await this.init();
    if (cue.bed !== undefined) this.setBed(cue.bed);
    for (const s of cue.sfx || []) setTimeout(() => this.playSfx(s.id), s.delayMs || 0);
  }

  async setBed(id) {
    if (this.currentBed?.id === id) return;
    const def = this.manifest.beds[id];
    const old = this.currentBed;
    const t = this.ctx.currentTime;
    if (old) { old.gain.gain.setTargetAtTime(0, t, 0.8); setTimeout(() => old.stop(), 4000); }
    this.currentBed = null;
    if (!def || !def.volume) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.bedBus);
    const stops = [];
    for (const path of [def.file, def.music]) {
      const buf = await this.load(path);
      if (buf) {
        const src = this.ctx.createBufferSource();
        src.buffer = buf; src.loop = true; src.connect(gain); src.start();
        stops.push(() => src.stop());
      }
    }
    if (!stops.length && def.synth) stops.push(synthBed(this.ctx, gain, def.synth));
    gain.gain.setTargetAtTime(def.volume, this.ctx.currentTime, 1.0);
    this.currentBed = { id, gain, stop: () => stops.forEach((s) => { try { s(); } catch {} }) };
  }

  async playSfx(id) {
    await this.init();
    const def = this.manifest.sfx[id];
    if (!def) return;
    const gain = this.ctx.createGain();
    gain.gain.value = def.volume ?? 0.7;
    gain.connect(this.sfxBus);
    const buf = await this.load(def.file);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.connect(gain); src.start();
    } else if (def.synth) synthSfx(this.ctx, gain, def.synth);
  }
}

// ---------- Synthetische Platzhalter ----------
function noiseBuffer(ctx, seconds = 2, color = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

function noise(ctx, out, { dur = 0.3, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, a = 0.01, peak = 1, at = 0, color = 'white' }) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur + 0.1, color);
  const filt = ctx.createBiquadFilter();
  filt.type = type; filt.Q.value = q;
  filt.frequency.setValueAtTime(f0, t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(out);
  src.start(t); src.stop(t + dur + 0.1);
}

function tone(ctx, out, { f = 440, f1 = f, type = 'sine', dur = 0.3, a = 0.005, peak = 0.5, at = 0 }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f1 !== f) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}

const SFX = {
  whoosh: (c, o) => noise(c, o, { dur: 0.35, f0: 400, f1: 3000, q: 2, a: 0.15, peak: 0.8 }),
  whoosh_low: (c, o) => noise(c, o, { dur: 0.4, f0: 200, f1: 900, q: 2, a: 0.2, peak: 0.9 }),
  whoosh_short: (c, o) => noise(c, o, { dur: 0.18, f0: 600, f1: 2500, q: 2, a: 0.06, peak: 0.6 }),
  twang: (c, o) => { tone(c, o, { f: 220, f1: 110, type: 'triangle', dur: 0.3, peak: 0.6 }); noise(c, o, { dur: 0.25, f0: 2000, f1: 4000, at: 0.05, peak: 0.3 }); },
  slash: (c, o) => { noise(c, o, { dur: 0.15, type: 'highpass', f0: 3000, peak: 0.9 }); tone(c, o, { f: 1800, f1: 900, type: 'sawtooth', dur: 0.12, peak: 0.15 }); },
  thud: (c, o) => { tone(c, o, { f: 120, f1: 50, dur: 0.25, peak: 0.9 }); noise(c, o, { dur: 0.12, type: 'lowpass', f0: 600, peak: 0.6 }); },
  thud_short: (c, o) => { tone(c, o, { f: 150, f1: 70, dur: 0.15, peak: 0.8 }); },
  thunk: (c, o) => { tone(c, o, { f: 300, f1: 120, type: 'triangle', dur: 0.12, peak: 0.7 }); noise(c, o, { dur: 0.08, f0: 1500, peak: 0.4 }); },
  clang: (c, o) => { [523, 787, 1047, 1571].forEach((f, i) => tone(c, o, { f, type: 'square', dur: 0.6 - i * 0.1, peak: 0.12 })); noise(c, o, { dur: 0.1, type: 'highpass', f0: 4000, peak: 0.5 }); },
  grunt: (c, o) => tone(c, o, { f: 140, f1: 90, type: 'sawtooth', dur: 0.25, peak: 0.25 }),
  fall: (c, o) => { tone(c, o, { f: 300, f1: 60, type: 'triangle', dur: 0.5, peak: 0.5 }); noise(c, o, { dur: 0.3, type: 'lowpass', f0: 400, at: 0.45, peak: 0.8 }); },
  fanfare: (c, o) => [523, 659, 784, 1047].forEach((f, i) => tone(c, o, { f, type: 'triangle', dur: i === 3 ? 0.7 : 0.2, at: i * 0.12, peak: 0.35 })),
  wah: (c, o) => [392, 370, 349, 262].forEach((f, i) => tone(c, o, { f, f1: f * 0.97, type: 'sawtooth', dur: i === 3 ? 0.6 : 0.25, at: i * 0.25, peak: 0.15 })),
  chime: (c, o) => { tone(c, o, { f: 1319, dur: 0.6, peak: 0.25 }); tone(c, o, { f: 1760, dur: 0.6, at: 0.08, peak: 0.2 }); },
  low: (c, o) => tone(c, o, { f: 196, f1: 147, type: 'triangle', dur: 0.5, peak: 0.25 }),
  sparkle: (c, o) => [1568, 2093, 2637, 3136, 2637].forEach((f, i) => tone(c, o, { f, dur: 0.25, at: i * 0.06, peak: 0.12 })),
  pour: (c, o) => noise(c, o, { dur: 1.2, f0: 800, f1: 1600, q: 4, a: 0.2, peak: 0.4 }),
  pick: (c, o) => { tone(c, o, { f: 880, dur: 0.08, peak: 0.3 }); tone(c, o, { f: 1320, dur: 0.12, at: 0.06, peak: 0.25 }); },
  coins: (c, o) => [0, 0.05, 0.11, 0.18, 0.22].forEach((at, i) => tone(c, o, { f: 2400 + i * 300, dur: 0.15, at, peak: 0.15, type: 'square' })),
  creak: (c, o) => tone(c, o, { f: 90, f1: 140, type: 'sawtooth', dur: 0.9, a: 0.2, peak: 0.12 }),
  clink: (c, o) => { tone(c, o, { f: 3200, dur: 0.3, peak: 0.2 }); tone(c, o, { f: 4100, dur: 0.25, at: 0.02, peak: 0.12 }); },
  scrape: (c, o) => noise(c, o, { dur: 0.5, f0: 300, f1: 500, q: 6, a: 0.1, peak: 0.5 }),
  crowd: (c, o) => noise(c, o, { dur: 1.2, f0: 500, f1: 700, q: 1.5, a: 0.3, peak: 0.5, color: 'brown' }),
  howl: (c, o) => tone(c, o, { f: 400, f1: 700, type: 'sine', dur: 1.6, a: 0.5, peak: 0.25 }),
  growl: (c, o) => { tone(c, o, { f: 70, f1: 60, type: 'sawtooth', dur: 0.8, a: 0.1, peak: 0.2 }); noise(c, o, { dur: 0.8, type: 'lowpass', f0: 300, a: 0.1, peak: 0.4 }); },
  shout: (c, o) => tone(c, o, { f: 220, f1: 180, type: 'sawtooth', dur: 0.4, peak: 0.25 }),
  splash: (c, o) => noise(c, o, { dur: 0.6, type: 'lowpass', f0: 3000, f1: 400, a: 0.01, peak: 0.7 }),
  whisper: (c, o) => noise(c, o, { dur: 1.0, f0: 3000, f1: 5000, q: 3, a: 0.3, peak: 0.25 }),
  click: (c, o) => { tone(c, o, { f: 2000, dur: 0.03, peak: 0.6, type: 'square' }); tone(c, o, { f: 900, dur: 0.05, at: 0.05, peak: 0.4, type: 'square' }); },
  bell: (c, o) => [262, 524, 660, 785].forEach((f, i) => tone(c, o, { f, dur: 2.5 - i * 0.4, peak: 0.2 - i * 0.03 })),
  crackle: (c, o) => { for (let i = 0; i < 8; i++) noise(c, o, { dur: 0.03, type: 'highpass', f0: 2000, at: Math.random() * 0.8, peak: 0.4 }); },
  rattle: (c, o) => { for (let i = 0; i < 6; i++) tone(c, o, { f: 1200 + Math.random() * 800, dur: 0.03, at: i * 0.05 + Math.random() * 0.02, peak: 0.25, type: 'square' }); },
};

export function synthSfx(ctx, out, id) { (SFX[id] || SFX.pick)(ctx, out); }

// Klangteppiche: einfache Schleifen, bis echte Dateien da sind
export function synthBed(ctx, out, id) {
  const timers = [];
  const nodes = [];
  const loopNoise = (color, type, f, gain) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 4, color); src.loop = true;
    const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(filt).connect(g).connect(out); src.start();
    nodes.push(src);
  };
  const every = (ms, fn, jitter = true) => { const tick = () => { fn(); timers.push(setTimeout(tick, jitter ? ms * (0.6 + Math.random() * 0.8) : ms)); }; timers.push(setTimeout(tick, 300)); };

  if (id === 'tavern') {
    loopNoise('brown', 'bandpass', 600, 0.6); // Gemurmel
    const melody = [392, 440, 494, 523, 494, 440, 392, 330, 349, 392, 440, 392];
    let step = 0;
    every(420, () => { tone(ctx, out, { f: melody[step++ % melody.length], type: 'triangle', dur: 0.38, peak: 0.08 }); if (step % 3 === 0) tone(ctx, out, { f: 196, type: 'triangle', dur: 0.7, peak: 0.06 }); }, false);
    every(5000, () => SFX.clink(ctx, out));
  } else if (id === 'swamp') {
    loopNoise('brown', 'lowpass', 400, 0.5);
    every(1800, () => tone(ctx, out, { f: 300 + Math.random() * 200, f1: 200, type: 'square', dur: 0.08, peak: 0.05 }));
  } else if (id === 'wind') {
    loopNoise('white', 'bandpass', 500, 0.15);
  } else if (id === 'drone') {
    [110, 165].forEach((f) => { const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.05; o.connect(g).connect(out); o.start(); nodes.push(o); });
    loopNoise('brown', 'lowpass', 300, 0.3);
    every(2500, () => noise(ctx, out, { dur: 0.4, type: 'lowpass', f0: 2000, f1: 300, peak: 0.15 }));
  } else if (id === 'drums') {
    let n = 0;
    every(380, () => { tone(ctx, out, { f: n % 4 === 0 ? 80 : 110, f1: 50, dur: 0.25, peak: n % 4 === 0 ? 0.5 : 0.25 }); n++; }, false);
  }
  return () => { timers.forEach(clearTimeout); nodes.forEach((n) => { try { n.stop(); } catch {} }); };
}
