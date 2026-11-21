import { connect, $, esc, toast } from './net.js';
import { AudioEngine } from './audio.js';
import { Narrator, TableMic } from './voice.js';

const code = location.pathname.split('/').pop().toUpperCase();
const token = localStorage.getItem(`tg_host_${code}`);
if (!token) { document.body.innerHTML = '<main class="wrap"><h1>Kein Host-Zugang</h1><p>Diese Runde wurde auf einem anderen Gerät eröffnet. <a href="/">Neue Runde</a></p></main>'; throw new Error('kein Host'); }

const audio = new AudioEngine();
let lastJson = '';
let state = null;
let thinkingTimer = null;

const narrator = new Narrator({
  onStart: () => { audio.duck(true); mic.pause(true); },
  onEnd: () => { audio.duck(false); mic.pause(false); },
});
const mic = new TableMic({
  onFinal: (text) => { if (text) net.send('utterance', { text }); $('#interim').textContent = ''; },
  onInterim: (t) => { $('#interim').textContent = t; },
  onState: (s) => { $('#micState').textContent = s; $('#btnMic').textContent = `Tisch hört zu: ${mic.wanted ? 'an' : 'aus'}`; },
});

const FILLERS = ['Hm.', 'Mal sehen …', 'Einen Augenblick.', 'Soso.'];

const net = connect({
  code, token,
  onStatus: (s, err) => { $('#net').textContent = s; $('#net').className = `pill ${s === 'online' ? 'on' : 'off'}`; if (err) toast(err, 'error'); },
  onState: (s) => { const j = JSON.stringify(s); if (j === lastJson) return; lastJson = j; state = s; render(); },
  onMessage: (m) => {
    if (m.type === 'say') narrator.say(m.text, m.voice);
    if (m.type === 'cue') audio.playCue(m.cue);
    if (m.type === 'thinking') {
      $('#thinking').classList.toggle('hidden', !m.on);
      clearTimeout(thinkingTimer);
      // Latenzfüller: dauert es länger, sagt der Moderator kurz etwas (Dev-Roadmap §4)
      if (m.on) thinkingTimer = setTimeout(() => { if (!narrator.speaking) narrator.say(FILLERS[Math.floor(Math.random() * FILLERS.length)]); }, 1200);
    }
  },
});

const act = async (action, payload) => {
  const r = await net.send(action, payload);
  if (!r.ok && r.error) toast(r.error, 'error');
  return r;
};

// ---------- Einmalige Einrichtung ----------
fetch(`/api/sessions/${code}/qr`).then((r) => r.json()).then((q) => { $('#qr').innerHTML = q.svg; $('#url').textContent = q.url; });
$('#code').textContent = code;

$('#unlock').onclick = async () => {
  await audio.init();
  narrator.say('Ton und Stimme sind an.');
  $('#unlock').classList.add('hidden');
  if (state?.scene) audio.playCue({ bed: currentBedGuess(), sfx: [] });
};
function currentBedGuess() { return state?.phase === 'playing' ? state.scene?.ambience || 'silence' : 'silence'; }

$('#btnMic').onclick = () => {
  if (!mic.supported) return toast('Spracherkennung braucht Chrome oder Edge. Sonst unten tippen.', 'error');
  mic.wanted ? mic.stop() : mic.start();
};
$('#btnCreation').onclick = () => act('creation');
$('#btnStart').onclick = async () => { await audio.init(); $('#unlock').classList.add('hidden'); act('start'); };
$('#btnPause').onclick = () => act('pause', { paused: !state.paused });
$('#btnRest').onclick = () => act('rest');
$('#btnWish').onclick = async () => { const t = $('#hostWish').value.trim(); if (t && (await act('wish', { text: t })).ok) $('#hostWish').value = ''; };
$('#btnWrite').onclick = () => act('write');
$('#btnTest').onclick = () => act('useTest');
$('#btnContinue').onclick = () => act('continue');
$('#btnEnd').onclick = () => { if (confirm('Abend wirklich beenden?')) act('end'); };
$('#btnAi').onclick = () => act('ai', { enabled: !state.ai.enabled });
$('#btnModerate').onclick = () => act('moderate');
$('#btnEndCombat').onclick = () => act('endCombat');
$('#btnUtter').onclick = () => { const t = $('#utter').value.trim(); if (!t) return; act('utterance', { text: t, speakerId: $('#utterWho').value || undefined, source: 'host_text' }); $('#utter').value = ''; };
$('#utter').onkeydown = (e) => { if (e.key === 'Enter') $('#btnUtter').click(); };
$('#btnSay').onclick = () => { const t = $('#hostSay').value.trim(); if (t) act('say', { text: t }); $('#hostSay').value = ''; };
$('#volBed').oninput = (e) => audio.ctx && audio.setVolume('bed', Number(e.target.value));
$('#volSfx').oninput = (e) => audio.ctx && audio.setVolume('sfx', Number(e.target.value));
$('#rate').oninput = (e) => { narrator.rate = Number(e.target.value); };

function fillVoices() {
  const sel = $('#voice');
  const saved = localStorage.getItem('tg_voice');
  sel.innerHTML = narrator.voices.map((v) => `<option ${v.name === saved ? 'selected' : ''}>${esc(v.name)}</option>`).join('') || '<option>Standard</option>';
}
setTimeout(fillVoices, 500);
speechSynthesis.addEventListener?.('voiceschanged', fillVoices);
$('#voice').onchange = (e) => { localStorage.setItem('tg_voice', e.target.value); narrator.say('So klinge ich jetzt.'); };

fetch('/audio/manifest.json').then((r) => r.json()).then((m) => {
  $('#beds').innerHTML = Object.entries(m.beds).map(([id, b]) => `<button data-bed="${id}">${esc(b.label)}</button>`).join('');
  $('#sfx').innerHTML = Object.keys(m.sfx).map((id) => `<button data-sfx="${id}">${id}</button>`).join('');
  $('#beds').onclick = (e) => { const id = e.target.dataset.bed; if (id) act('bed', { id }); };
  $('#sfx').onclick = (e) => { const id = e.target.dataset.sfx; if (id) audio.playSfx(id); };
});

// ---------- Anzeige ----------
function render() {
  const s = state;
  $('#title').textContent = s.world.title;
  $('#clock').textContent = s.phase === 'playing' ? `${s.clock.elapsedMin} / ${s.clock.durationMin} Min · Szene ${s.clock.sceneMin} Min` : s.phase;
  $('#lobby').classList.toggle('hidden', s.phase === 'playing' || s.phase === 'ended');
  const pre = ['lobby', 'creation'].includes(s.phase);
  $('#advCard').classList.toggle('hidden', !pre);
  if (pre) {
    const g = s.adventureGen;
    const label = { test: 'Testabenteuer', writing: 'wird geschrieben …', ready: 'auf Zuruf geschrieben', failed: 'Schreiben fehlgeschlagen, Testabenteuer' }[g.status];
    $('#adv').innerHTML = `<b>${esc(g.title)}</b> <span class="pill ${g.status === 'ready' ? 'on' : g.status === 'failed' ? 'off' : g.status === 'writing' ? 'gold' : ''}">${label}</span>
      ${g.note ? `<br><small class="muted">${esc(g.note)}</small>` : ''}
      <ul class="wishes">${g.wishes.map((w) => `<li><b>${esc(w.who)}:</b> ${esc(w.text)}</li>`).join('') || '<li class="muted">Noch keine Wünsche. Die Handys können welche schicken.</li>'}</ul>
      ${s.ai.kind !== 'claude' ? '<small class="muted">Ohne API-Schlüssel spielt ihr das Testabenteuer.</small>' : ''}`;
    $('#btnWrite').disabled = g.status === 'writing' || s.ai.kind !== 'claude';
    $('#btnStart').disabled = g.status === 'writing';
  }
  $('#btnCreation').classList.toggle('hidden', s.phase !== 'lobby');
  $('#btnStart').classList.toggle('hidden', !['lobby', 'creation'].includes(s.phase));

  $('#players').innerHTML = s.players.map((p) => {
    const c = s.characters.find((x) => x.playerId === p.id);
    const lp = c ? `<div class="lp"><i style="width:${(100 * c.lp) / c.lpMax}%"></i></div><small>${c.down ? 'AM BODEN' : `${c.lp}/${c.lpMax} LP`}${c.conditions.length ? ` · ${esc(c.conditions.join(', '))}` : ''}</small>` : '<small class="muted">baut noch …</small>';
    return `<div style="margin-bottom:.55rem"><div class="row"><b>${esc(c?.name || p.name)}</b><small class="muted">${esc(p.name)}${c?.concept ? ` · ${esc(c.concept)}` : ''}</small><span class="pill ${p.connected ? 'on' : 'off'}">${p.connected ? 'da' : 'weg'}</span></div>${lp}</div>`;
  }).join('') || '<p class="muted">Noch niemand. QR-Code scannen lassen.</p>';

  $('#utterWho').innerHTML = `<option value="">wer? (Antippen)</option>${s.characters.map((c) => `<option value="${c.playerId}">${esc(c.name)}</option>`).join('')}`;
  const speaker = s.characters.find((c) => c.playerId === s.activeSpeaker);
  $('#speaker').textContent = speaker ? `spricht: ${speaker.name}` : 'niemand angetippt';

  const ai = s.ai;
  $('#ai').innerHTML = `<div class="row"><span class="pill ${ai.enabled ? 'on' : 'off'}">${ai.enabled ? 'KI moderiert' : 'Host moderiert'}</span><span class="pill gold">${ai.kind === 'claude' ? esc(ai.model) : 'Übungsmodus'}</span></div>
    <small class="muted">${ai.calls} Antworten · ${ai.tokensIn + ai.tokensOut} Tokens${ai.lastLatencyMs ? ` · zuletzt ${(ai.lastLatencyMs / 1000).toFixed(1)} s` : ''}</small>
    ${ai.lastError ? `<div><small style="color:var(--red)">${esc(ai.lastError)}</small></div>` : ''}`;

  $('#sceneTitle').textContent = s.phase === 'interlude' ? `Pause · gleich Akt ${s.nextScene?.act}` : s.phase === 'ended' ? 'Ende des Abends' : s.scene ? s.scene.title : 'Lobby';
  $('#btnContinue').classList.toggle('hidden', s.phase !== 'interlude');
  $('#btnContinue').textContent = s.milestonesPending ? `Weiter, ohne zu warten (${s.milestonesPending} wählen noch)` : `Akt ${s.nextScene?.act ?? ''} beginnen`;
  $('#scene').innerHTML = s.scene ? `Akt ${s.scene.act} · Budget ${s.scene.budgetMin} Min<br><small>${esc(s.scene.abortSignal)}</small>` : '–';
  $('#exits').innerHTML = s.scene && s.phase === 'playing' ? s.scene.exits.map((e) => `<button data-exit="${e.id}" title="${esc(e.label)}">→ ${esc(e.label)}</button>`).join('') : '';
  $('#exits').onclick = (e) => { const id = e.target.dataset.exit; if (id && confirm(`Szene beenden: ${e.target.title}?`)) act('next', { exitId: id }); };
  $('#btnPause').textContent = s.paused ? 'Weiter' : 'Pause';

  $('#checkCard').classList.toggle('hidden', !s.pendingCheck);
  if (s.pendingCheck) { const c = s.pendingCheck; $('#check').innerHTML = `<b>${esc(c.characterName)}</b> · ${esc(c.statLabel)} ${c.statValue} gegen DC ${c.dc}<br><small>${esc(c.reason)}</small>`; }

  $('#combatCard').classList.toggle('hidden', !s.combat);
  if (s.combat) $('#combat').innerHTML = s.combat.enemies.map((e) => `<div class="enemy ${e.defeated ? 'dead' : ''}"><b class="grow">${esc(e.name)}</b><small>Abwehr ${e.abwehr}</small><div class="lp" style="width:90px"><i style="width:${(100 * e.lp) / e.lpMax}%"></i></div></div>`).join('');

  $('#riddleCard').classList.toggle('hidden', !s.riddle);
  if (s.riddle) $('#riddle').innerHTML = `<p>${esc(s.riddle.question)}</p><small>Lösung: <b>${esc((s.riddle.answers || []).join(' / '))}</b> · ${s.riddle.attempts} Fehlversuche${s.riddle.hint ? `<br>Hinweis: ${esc(s.riddle.hint)}` : ''}</small>`;
  $('#chests').innerHTML = (s.chests || []).filter((c) => !c.opened).map((c) => `<button data-chest="${c.id}" title="Truhe von Hand öffnen">Öffnen: ${esc(c.label)}</button>`).join('');
  $('#chests').onclick = (e) => { const id = e.target.dataset.chest; if (id) act('chest', { id }); };
  $('#loot').innerHTML = s.loot.length ? s.loot.map((l) => `<span class="pill">${esc(l.name)}${l.qty > 1 ? ` ×${l.qty}` : ''}</span>`).join(' ') : '–';
  if (s.hiddenLootCount) $('#loot').innerHTML += ` <small class="muted">(+${s.hiddenLootCount} verborgen)</small>`;

  const feed = $('#feed');
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  feed.innerHTML = s.feed.map((f) => `<div class="line ${f.kind}"><b>${esc(f.who)}</b>${esc(f.text)}</div>`).join('');
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

setInterval(() => state && state.phase === 'playing' && render(), 30000);
