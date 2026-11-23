// Erzählstimme (Browser-Vorlesestimme) und Tisch-Mikro (Browser-Spracherkennung, Chrome/Edge).

export class Narrator {
  constructor({ onStart, onEnd } = {}) {
    this.queue = [];
    this.speaking = false;
    this.onStart = onStart; this.onEnd = onEnd;
    this.voices = [];
    this.rate = 1.0;
    const load = () => { this.voices = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith('de')); };
    load();
    speechSynthesis.onvoiceschanged = load;
  }

  // Nebenfiguren bekommen eine eigene Stimmfarbe aus ihrem Namen
  voiceFor(key) {
    if (!this.voices.length) return { voice: null, pitch: 1, rate: this.rate };
    if (key === 'moderator') return { voice: this.pick('moderator'), pitch: 0.95, rate: this.rate * 0.97 };
    let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { voice: this.voices[h % this.voices.length], pitch: 0.75 + (h % 6) * 0.1, rate: this.rate * (0.9 + (h % 3) * 0.08) };
  }

  pick(pref) {
    const saved = localStorage.getItem('tg_voice');
    return this.voices.find((v) => v.name === saved) || this.voices.find((v) => /google|natural|online/i.test(v.name)) || this.voices[0];
  }

  say(text, key = 'moderator') {
    if (!text) return;
    this.queue.push({ text, key });
    if (!this.speaking) this.next();
  }

  next() {
    const item = this.queue.shift();
    if (!item) { this.speaking = false; this.onEnd?.(); return; }
    if (!this.speaking) this.onStart?.();
    this.speaking = true;
    const u = new SpeechSynthesisUtterance(item.text);
    const v = this.voiceFor(item.key);
    u.lang = 'de-DE'; if (v.voice) u.voice = v.voice; u.pitch = v.pitch; u.rate = v.rate;
    u.onend = u.onerror = () => this.next();
    speechSynthesis.speak(u);
  }

  stop() { this.queue = []; speechSynthesis.cancel(); this.speaking = false; this.onEnd?.(); }
}

export class TableMic {
  constructor({ onFinal, onInterim, onState }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(SR);
    this.wanted = false;
    this.paused = false;
    this.onFinal = onFinal; this.onInterim = onInterim; this.onState = onState;
    if (!SR) return;
    this.rec = new SR();
    this.rec.lang = 'de-DE';
    this.rec.continuous = true;
    this.rec.interimResults = true;
    // Satzbeginn merken: Wer zu Beginn das Wort hatte, hat gesprochen, auch wenn der Satz länger dauert
    this.segStart = null;
    this.rec.onresult = (ev) => {
      let interim = '';
      if (this.segStart === null) this.segStart = Date.now() - 600; // Erkennung meldet sich leicht verzögert
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) { this.onFinal?.(r[0].transcript.trim(), this.segStart); this.segStart = null; }
        else interim += r[0].transcript;
      }
      if (interim && this.segStart === null) this.segStart = Date.now() - 600;
      this.onInterim?.(interim);
    };
    this.rec.onend = () => { this.running = false; this.segStart = null; this.onState?.(this.state()); if (this.wanted && !this.paused) setTimeout(() => this.start(), 250); };
    // Fehler sichtbar machen statt verschlucken (z. B. Safari ohne Siri/Diktat: service-not-allowed)
    const errText = { 'not-allowed': 'verweigert (Mikro-Erlaubnis im Browser prüfen)', 'service-not-allowed': 'Spracherkennung gesperrt (Chrome nutzen oder Diktieren am Mac einschalten)', 'audio-capture': 'kein Mikro gefunden', network: 'Spracherkennung offline (Internet nötig)' };
    this.rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) this.wanted = false;
      this.onState?.(`Fehler: ${errText[e.error] || e.error}`);
    };
  }

  state() { return !this.supported ? 'nicht unterstützt' : this.paused ? 'pausiert (Moderator spricht)' : this.running ? 'hört zu' : this.wanted ? 'startet …' : 'aus'; }

  start() {
    if (!this.supported || this.running || this.paused) return;
    this.wanted = true;
    try { this.rec.start(); this.running = true; } catch {}
    this.onState?.(this.state());
  }

  stop() { this.wanted = false; try { this.rec.stop(); } catch {} this.onState?.(this.state()); }

  // Während der Moderator spricht, hört der Tisch nicht zu (sonst hört er sich selbst)
  pause(on) {
    this.paused = on;
    if (on && this.running) { try { this.rec.abort(); } catch {} }
    if (!on && this.wanted) setTimeout(() => this.start(), 300);
    this.onState?.(this.state());
  }
}
