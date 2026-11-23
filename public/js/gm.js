// Spielleiter-Modus: Ein Mensch leitet. Die App liefert Klang (Taste oder Stichwort) und auf Wunsch die Mechanik.
import { connect, $, esc, toast } from './net.js';
import { AudioEngine } from './audio.js';
import { TableMic } from './voice.js';
import { DEFAULT_TRIGGERS, SFX_LABELS, matchCues, sanitizeTriggers } from './cues.js';

const code = location.pathname.split('/').pop().toUpperCase();
const token = localStorage.getItem(`tg_host_${code}`);
if (!token) { document.body.innerHTML = '<main class="wrap"><h1>Kein Zugang</h1><p>Diese Runde wurde auf einem anderen Gerät eröffnet. <a href="/">Neue Runde</a></p></main>'; throw new Error('kein Host'); }

const audio = new AudioEngine();
let manifest = null;
let state = null;
let lastJson = '';
let triggers = DEFAULT_TRIGGERS;
const lastFired = new Map();      // Sperrzeit je Klang
let currentBed = null;
let lootDraft = [];
const heard = [];                 // {t, word, kind, id, played}

const label = (kind, id) => (kind === 'bed' ? manifest?.beds[id]?.label || id : SFX_LABELS[id] || id);

// ---------- Verbindung ----------
const net = connect({
  code, token,
  onStatus: (s, err) => { $('#net').textContent = s; $('#net').className = `pill ${s === 'online' ? 'on' : 'off'}`; if (err) toast(err, 'error'); },
  onState: (s) => { const j = JSON.stringify(s); if (j === lastJson) return; lastJson = j; state = s; render(); },
  onMessage: (m) => { if (m.type === 'cue') playCue(m.cue); },
});
const act = async (action, payload) => {
  const r = await net.send(action, payload);
  if (!r.ok && r.error) toast(r.error, 'error');
  return r;
};

// ---------- Klang ----------
async function playSound(kind, id, source = 'button', word) {
  await audio.init();
  $('#unlock').classList.add('hidden');
  if (kind === 'bed') { currentBed = id; audio.setBed(id); markBeds(); }
  else { audio.playSfx(id); flash(id); }
  net.send('gmCue', { kind, id, source, word });
}
function playCue(cue) { // Klänge, die das Spiel selbst auslöst (Würfel, Fund, Rast)
  audio.playCue(cue);
  if (cue.bed !== undefined) { currentBed = cue.bed; markBeds(); }
}
function flash(id) {
  const b = document.querySelector(`#sfx [data-sfx="${id}"]`);
  if (!b) return;
  b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 700);
}
function markBeds() { document.querySelectorAll('#beds button').forEach((b) => b.classList.toggle('active', b.dataset.bed === currentBed)); }

$('#unlock').onclick = async () => { await audio.init(); $('#unlock').classList.add('hidden'); };
$('#volBed').oninput = (e) => audio.ctx && audio.setVolume('bed', Number(e.target.value));
$('#volSfx').oninput = (e) => audio.ctx && audio.setVolume('sfx', Number(e.target.value));

// ---------- Eigene Klänge (bleiben in diesem Browser, IndexedDB) ----------
const DB = 'tg_custom_sounds';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sounds');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('sounds', mode); const st = tx.objectStore('sounds'); const out = fn(st); tx.oncomplete = () => res(out?.result ?? out); tx.onerror = () => rej(tx.error); });
}
async function loadCustomSounds() {
  try {
    const db = await idb();
    const keys = await new Promise((res) => { const r = db.transaction('sounds').objectStore('sounds').getAllKeys(); r.onsuccess = () => res(r.result); });
    for (const key of keys) {
      const blob = await new Promise((res) => { const r = db.transaction('sounds').objectStore('sounds').get(key); r.onsuccess = () => res(r.result); });
      const [kind, id] = String(key).split(':');
      if (blob) await audio.setCustom(kind, id, await blob.arrayBuffer());
    }
    drawBoard();
  } catch { /* ohne IndexedDB: nur Standardklänge */ }
}
let assignTarget = null;
$('#assign').onchange = (e) => $('#assignHint').classList.toggle('hidden', !e.target.checked);
$('#filePick').onchange = async (e) => {
  const f = e.target.files?.[0];
  const t = assignTarget; assignTarget = null; e.target.value = '';
  if (!t) return;
  const key = `${t.kind}:${t.id}`;
  if (!f) return;
  if (f.size > 25 * 1024 * 1024) return toast('Datei zu groß (höchstens 25 MB)', 'error');
  const ok = await audio.setCustom(t.kind, t.id, await f.arrayBuffer());
  if (!ok) return toast('Diese Datei kann der Browser nicht abspielen', 'error');
  await idbDo('readwrite', (st) => st.put(f, key));
  toast(`„${label(t.kind, t.id)}“ klingt jetzt nach ${f.name}`);
  drawBoard();
};
async function resetCustom(kind, id) {
  await audio.setCustom(kind, id, null);
  await idbDo('readwrite', (st) => st.delete(`${kind}:${id}`));
  drawBoard();
}

// ---------- Soundboard ----------
function drawBoard() {
  if (!manifest) return;
  const cls = (kind, id) => (audio.hasCustom(kind, id) ? 'custom' : '');
  $('#beds').innerHTML = Object.entries(manifest.beds).map(([id, b]) => `<button data-bed="${id}" class="${cls('bed', id)}">${esc(b.label)}</button>`).join('');
  $('#sfx').innerHTML = Object.keys(manifest.sfx).map((id) => `<button data-sfx="${id}" class="${cls('sfx', id)}">${esc(SFX_LABELS[id] || id)}</button>`).join('');
  markBeds();
}
function boardClick(kind) {
  return (e) => {
    const id = e.target.dataset[kind === 'bed' ? 'bed' : 'sfx'];
    if (!id) return;
    if ($('#assign').checked) {
      if (audio.hasCustom(kind, id) && confirm(`Eigenen Klang für „${label(kind, id)}“ entfernen?`)) return resetCustom(kind, id);
      assignTarget = { kind, id };
      return $('#filePick').click();
    }
    playSound(kind, id, 'button');
  };
}
$('#beds').onclick = boardClick('bed');
$('#sfx').onclick = boardClick('sfx');

// ---------- Stichworte ----------
function loadTriggers() {
  try {
    const saved = JSON.parse(localStorage.getItem('tg_triggers') || 'null');
    triggers = saved ? sanitizeTriggers(saved, { beds: Object.keys(manifest.beds), sfx: Object.keys(manifest.sfx) }) : DEFAULT_TRIGGERS;
  } catch { triggers = DEFAULT_TRIGGERS; }
}
function saveTriggers() { localStorage.setItem('tg_triggers', JSON.stringify(triggers)); drawTriggers(); }
function soundOptions(selected = '') {
  const beds = Object.keys(manifest.beds).map((id) => `<option value="bed:${id}" ${selected === `bed:${id}` ? 'selected' : ''}>Teppich: ${esc(label('bed', id))}</option>`);
  const sfx = Object.keys(manifest.sfx).map((id) => `<option value="sfx:${id}" ${selected === `sfx:${id}` ? 'selected' : ''}>${esc(label('sfx', id))}</option>`);
  return [...sfx, ...beds].join('');
}
function drawTriggers() {
  $('#triggers').innerHTML = triggers.map((t, i) => `<div class="trigger">
    <span class="snd pill ${t.bed ? 'gold' : ''}">${esc(label(t.bed ? 'bed' : 'sfx', t.bed || t.sfx))}</span>
    <input class="grow" data-i="${i}" value="${esc(t.words.join(', '))}">
    <button data-del="${i}" title="Löschen">×</button></div>`).join('');
}
$('#triggers').onchange = (e) => {
  const i = e.target.dataset.i;
  if (i === undefined) return;
  const words = e.target.value.split(',').map((w) => w.trim()).filter(Boolean);
  if (words.length) triggers[i].words = words; else triggers.splice(i, 1);
  saveTriggers();
};
$('#triggers').onclick = (e) => { const i = e.target.dataset.del; if (i !== undefined) { triggers.splice(Number(i), 1); saveTriggers(); } };
$('#btnAddTrigger').onclick = () => {
  const [kind, id] = $('#newSound').value.split(':');
  const words = $('#newWords').value.split(',').map((w) => w.trim()).filter(Boolean);
  if (!words.length) return;
  triggers.unshift(kind === 'bed' ? { bed: id, words } : { sfx: id, words });
  $('#newWords').value = '';
  saveTriggers();
};
$('#btnResetTriggers').onclick = () => { if (confirm('Alle eigenen Stichworte verwerfen?')) { localStorage.removeItem('tg_triggers'); triggers = DEFAULT_TRIGGERS; drawTriggers(); } };

// ---------- Zuhören ----------
function onSpeech(text, final) {
  const hits = matchCues(text, triggers, { last: lastFired });
  const auto = $('#auto').checked;
  for (const h of hits) {
    heard.unshift({ t: new Date(), word: h.word, kind: h.kind, id: h.id, played: auto });
    if (auto) playSound(h.kind, h.id, 'voice', h.word);
  }
  if (hits.length) drawHeard();
  if (final && state?.recording?.on) net.send('gmSpeech', { text, cues: hits });
}
window.tgHear = (text) => onSpeech(text, true); // zum Ausprobieren ohne Mikro (Konsole) und für Tests
const mic = new TableMic({
  onFinal: (t) => { $('#interim').textContent = ''; if (t) onSpeech(t, true); },
  onInterim: (t) => { $('#interim').textContent = t; if (t) onSpeech(t, false); },
  onState: (s) => { $('#micState').textContent = s; $('#btnMic').textContent = `Zuhören: ${mic.wanted ? 'an' : 'aus'}`; },
});
$('#btnMic').onclick = async () => {
  if (!mic.supported) return toast('Spracherkennung braucht Chrome oder Edge. Die Tasten gehen immer.', 'error');
  await audio.init(); $('#unlock').classList.add('hidden');
  mic.wanted ? mic.stop() : mic.start();
};
function drawHeard() {
  heard.splice(12);
  $('#heard').innerHTML = heard.map((h, i) => `<div class="h"><small class="muted">${h.t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</small>
    <span class="grow">»${esc(h.word)}« → ${esc(label(h.kind, h.id))}</span>
    <button data-play="${i}" title="${h.played ? 'Nochmal' : 'Abspielen'}">${h.played ? '↻' : '▶'}</button></div>`).join('') || '<p class="muted small">Noch nichts.</p>';
}
$('#heard').onclick = (e) => { const i = e.target.dataset.play; if (i === undefined) return; const h = heard[i]; h.played = true; playSound(h.kind, h.id, 'button'); drawHeard(); };

// ---------- Mitschnitt ----------
function drawRec() {
  const r = state.recording;
  $('#recPill').classList.toggle('hidden', !r.on);
  if (r.on) {
    $('#rec').innerHTML = `<p><span class="pill off">● läuft</span> seit ${new Date(r.since).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</p>
      <p class="muted small">Gespeichert wird, was die Erkennung von dir versteht, und welche Klänge laufen. Alle Handys zeigen den Hinweis.</p>
      <button class="danger" id="btnRecStop">Mitschnitt beenden</button>`;
    $('#btnRecStop').onclick = () => act('recording', { on: false });
  } else {
    $('#rec').innerHTML = `<p class="muted small">Aus. Nichts von dem, was am Tisch gesagt wird, wird gespeichert. Nur zum Verbessern des Spiels und nur, wenn alle zustimmen.</p>
      <label class="row small"><input type="checkbox" id="recConsent" style="width:auto"> Alle am Tisch wissen Bescheid und sind einverstanden.</label>
      <input id="recNote" placeholder="Notiz, z. B. Testtisch Shenanigans" maxlength="200" style="margin:.3rem 0">
      <button id="btnRecStart">Mitschnitt starten</button>`;
    $('#btnRecStart').onclick = () => {
      if (!$('#recConsent').checked) return toast('Erst alle fragen und das Häkchen setzen.', 'error');
      act('recording', { on: true, consent: true, note: $('#recNote').value });
    };
  }
}

// ---------- Handys & Mechanik ----------
fetch(`/api/sessions/${code}/qr`).then((r) => r.json()).then((q) => { $('#qr').innerHTML = q.svg; $('#url').textContent = q.url; });
$('#code').textContent = code;
$('#btnCreation').onclick = () => act('creation');
$('#btnStart').onclick = () => act('start');
$('#btnEnd').onclick = () => { if (confirm('Abend wirklich beenden?')) act('end'); };
$('#btnRest').onclick = () => act('rest');
$('#btnCheck').onclick = () => {
  const playerId = $('#ckWho').value;
  if (!playerId) return toast('Erst eine Figur wählen', 'error');
  act('check', { playerId, stat: $('#ckStat').value, dc: Number($('#ckDc').value) || 12, reason: $('#ckWhy').value.trim() || 'Probe' });
  $('#ckWhy').value = '';
};
$('#btnLootAdd').onclick = () => {
  const itemId = $('#lootItem').value;
  const qty = Math.max(1, Number($('#lootQty').value) || 1);
  if (!itemId || lootDraft.length >= 8) return;
  lootDraft.push({ itemId, qty });
  drawLootDraft();
};
function drawLootDraft() {
  const name = (id) => state?.catalog?.find((i) => i.id === id)?.name || id;
  $('#lootDraft').innerHTML = lootDraft.map((l, i) => `<span class="pill">${esc(name(l.itemId))}${l.qty > 1 ? ` ×${l.qty}` : ''} <a href="#" data-rm="${i}">×</a></span>`).join(' ');
}
$('#lootDraft').onclick = (e) => { const i = e.target.dataset.rm; if (i !== undefined) { e.preventDefault(); lootDraft.splice(Number(i), 1); drawLootDraft(); } };
$('#btnLoot').onclick = async () => {
  const items = lootDraft.length ? lootDraft : [{ itemId: $('#lootItem').value, qty: Number($('#lootQty').value) || 1 }];
  if ((await act('gmLoot', { items, label: $('#lootLabel').value.trim() })).ok) { lootDraft = []; drawLootDraft(); $('#lootLabel').value = ''; }
};
const lp = (sign) => () => {
  const playerId = $('#lpWho').value;
  if (!playerId) return toast('Erst eine Figur wählen', 'error');
  act('gmLp', { playerId, delta: sign * (Number($('#lpAmt').value) || 0) });
};
$('#btnHurt').onclick = lp(-1);
$('#btnHeal').onclick = lp(1);

function keepSelect(sel, html) { const v = sel.value; sel.innerHTML = html; if ([...sel.options].some((o) => o.value === v)) sel.value = v; }

function render() {
  const s = state;
  $('#clock').textContent = s.phase === 'playing' ? `${s.clock.elapsedMin} Min` : { lobby: 'Lobby', creation: 'Figuren', ended: 'Ende' }[s.phase] || s.phase;
  drawRec();
  const playing = s.phase === 'playing';
  $('#lobby').classList.toggle('hidden', s.phase === 'ended');
  $('#btnCreation').classList.toggle('hidden', s.phase !== 'lobby');
  $('#btnStart').classList.toggle('hidden', !['lobby', 'creation'].includes(s.phase));
  $('#btnEnd').classList.toggle('hidden', !playing);
  $('#mech').classList.toggle('hidden', !playing);

  $('#players').innerHTML = s.players.map((p) => {
    const c = s.characters.find((x) => x.playerId === p.id);
    const bar = c ? `<div class="lp"><i style="width:${(100 * c.lp) / c.lpMax}%"></i></div><small>${c.down ? 'AM BODEN' : `${c.lp}/${c.lpMax} LP`}</small>` : '<small class="muted">erstellt die Figur …</small>';
    return `<div style="margin:.4rem 0"><div class="row"><b>${esc(c?.name || p.name)}</b><small class="muted">${esc(p.name)}${c?.concept ? ` · ${esc(c.concept)}` : ''}</small><span class="pill ${p.connected ? 'on' : 'off'}">${p.connected ? 'da' : 'weg'}</span></div>${bar}</div>`;
  }).join('') || '<p class="muted small">Noch niemand mit Handy.</p>';

  const who = `<option value="">Figur …</option>${s.characters.map((c) => `<option value="${c.playerId}">${esc(c.name)}</option>`).join('')}`;
  keepSelect($('#ckWho'), who);
  keepSelect($('#lpWho'), who);
  keepSelect($('#ckStat'), s.stats.map((st) => `<option value="${st.key}">${esc(st.label)}</option>`).join(''));
  if (s.catalog && !$('#lootItem').options.length) $('#lootItem').innerHTML = s.catalog.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('');

  $('#checkCard').classList.toggle('hidden', !s.pendingCheck);
  if (s.pendingCheck) { const c = s.pendingCheck; $('#check').innerHTML = `${esc(c.characterName)} · ${esc(c.statLabel)} ${c.statValue} gegen ${c.dc}<br><small>${esc(c.reason)}</small>`; }
  $('#loot').innerHTML = s.loot.length ? `Liegt bereit: ${s.loot.map((l) => `${esc(l.name)}${l.qty > 1 ? ` ×${l.qty}` : ''}`).join(', ')}` : '';

  const feed = $('#feed');
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  feed.innerHTML = s.feed.map((f) => `<div class="line ${f.kind}"><b>${esc(f.who)}</b>${esc(f.text)}</div>`).join('') || '<p class="muted small">Hier erscheinen Würfe, Funde und was die Handys schreiben.</p>';
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

// ---------- Start ----------
fetch('/audio/manifest.json').then((r) => r.json()).then((m) => {
  manifest = m;
  loadTriggers();
  drawBoard();
  drawTriggers();
  $('#newSound').innerHTML = soundOptions();
  loadCustomSounds();
});
