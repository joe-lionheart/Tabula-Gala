import { connect, $, esc, toast } from './net.js';

const code = location.pathname.split('/').pop().toUpperCase();
const app = $('#app');
const key = `tg_player_${code}`;
let token = localStorage.getItem(key);
let lastJson = '';
let state = null, net = null;
let draft = { name: '', concept: '', kerbe: '', kit: 0, stats: { kraft: 2, agilitaet: 2, wahrnehmung: 3, verstand: 3, wort: 2 } };
let selectedUid = null;
let attackTarget = null;
let attackWeapon = null;
let busy = false;            // Doppeltipp-Schutz beim Würfeln
let lastCheckId = null;
const seenLoot = new Set();     // um neuen Loot kurz aufleuchten zu lassen

// ---------- Signal: Vibration, Ton (iPhone kann nicht vibrieren), Aufleuchten ----------
let actx = null;
const unlockTone = () => {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch { /* ohne Ton */ }
};
document.addEventListener('pointerdown', unlockTone, { passive: true });
function signal(kind = 'check') {
  if (navigator.vibrate) navigator.vibrate(kind === 'combat' ? [200, 80, 200, 80, 200] : kind === 'loot' ? [60, 40, 60] : [120, 60, 120]);
  if (actx && actx.state === 'running') {
    const notes = kind === 'combat' ? [330, 247] : kind === 'loot' ? [988, 1319, 1568] : [660, 880];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.13;
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.2);
    });
  }
  document.body.classList.remove('flash'); void document.body.offsetWidth; document.body.classList.add('flash');
}

// ---------- Verbindungsanzeige ----------
let offlineTimer = null;
function netBanner(status) {
  let b = document.getElementById('netbanner');
  if (!b) { b = document.createElement('div'); b.id = 'netbanner'; b.className = 'hidden'; b.textContent = 'Verbindung weg – verbinde neu …'; b.onclick = () => net?.reconnect(true); document.body.append(b); }
  clearTimeout(offlineTimer);
  if (status === 'online') b.classList.add('hidden');
  else offlineTimer = setTimeout(() => b.classList.remove('hidden'), 1500);
}

if (!token) renderJoin(); else start();

function renderJoin(error = '') {
  app.innerHTML = `
    <h1>Tabula Gala</h1>
    <section class="card">
      <h2>Runde ${esc(code)}</h2>
      <p class="muted">Wie heißt du am Tisch?</p>
      <input id="name" placeholder="Dein Vorname" maxlength="24" autocomplete="given-name" value="${esc(localStorage.getItem('tg_name') || '')}">
      <p class="muted"><small>Warst du schon am Tisch? Gleicher Name = dein alter Platz.</small></p>
      ${error ? `<p style="color:var(--red)">${esc(error)}</p>` : ''}
      <p><button class="primary big" id="go">Platz nehmen</button></p>
    </section>`;
  $('#go').onclick = async () => {
    const name = $('#name').value.trim();
    let r;
    try { r = await fetch(`/api/sessions/${code}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then((x) => x.json()); }
    catch { return renderJoin('Der Tisch ist nicht erreichbar. Bist du im selben WLAN?'); }
    if (!r.ok) return renderJoin(r.error || 'Beitritt fehlgeschlagen');
    token = r.token; localStorage.setItem(key, token); localStorage.setItem('tg_name', name);
    start();
  };
}

function start() {
  net = connect({
    code, token,
    onState: (s) => { const j = JSON.stringify(s); if (j === lastJson) return; lastJson = j; state = s; render(); },
    onStatus: (s, err) => {
      if (err) { localStorage.removeItem(key); token = null; netBanner('online'); renderJoin(err === 'Unbekannter Zugang' ? 'Die Runde wurde neu gestartet. Gib deinen Namen wie vorher ein, dann bekommst du deinen Platz zurück.' : err); net?.close(); return; }
      netBanner(s);
    },
    onMessage: (m) => { if (m.type === 'buzz') signal(m.kind); },
  });
}

const act = async (action, payload) => {
  const r = await net.send(action, payload);
  if (!r.ok && r.error) toast(r.error, 'error');
  return r;
};

// Würfeln: einmal tippen zählt, bis der Server antwortet
async function rollOnce(action, payload) {
  if (busy) return;
  busy = true; render();
  try { await act(action, payload); } finally { busy = false; render(); }
}

function render() {
  // Eingaben und Fokus über Neuzeichnen hinweg behalten
  const saved = {};
  app.querySelectorAll('input[id]:not([type=radio]),select[id]').forEach((el) => { saved[el.id] = el.value; });
  const focus = document.activeElement?.id;
  draw();
  for (const [id, v] of Object.entries(saved)) { const el = document.getElementById(id); if (el && el.tagName === 'INPUT') el.value = v; }
  if (focus) document.getElementById(focus)?.focus();
}

function draw() {
  const s = state;
  const me = s.me;
  if (!me && s.phase !== 'ended') return renderCreation();
  if (s.phase === 'lobby' || s.phase === 'creation') return renderWaiting();
  if (s.phase === 'interlude') return renderInterlude();
  if (s.phase === 'ended') return renderEnd();
  renderPlay();
}

// ---------- Figur bauen ----------
function renderCreation() {
  const s = state;
  const used = Object.values(draft.stats).reduce((a, b) => a + b, 0);
  app.innerHTML = `
    <h1>Figur erstellen</h1>
    <section class="card">
      <input id="cname" placeholder="Name der Figur" maxlength="40" value="${esc(draft.name)}">
      <p><input id="concept" placeholder="In einem Satz: wer bist du? (z. B. „Diebin mit Herz“)" maxlength="140" value="${esc(draft.concept)}"></p>
      <input id="kerbe" placeholder="Deine Schwäche (der Moderator nutzt sie)" maxlength="140" value="${esc(draft.kerbe)}">
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between"><h3>Werte</h3><span class="pill ${used === 12 ? 'on' : 'gold'}">${used} / 12 Punkte</span></div>
      <p class="muted">Jeder Wert 1–4. Lücken sind gut: Dafür habt ihr einander.</p>
      <div class="stats">${s.stats.map((st) => `
        <div class="stat"><span>${st.label}<br><small class="muted">${hint(st.key)}</small></span>
          <button data-dec="${st.key}">−</button><span class="v">${draft.stats[st.key]}</span><button data-inc="${st.key}">+</button></div>`).join('')}
      </div>
    </section>
    <section class="card">
      <h3>Ausrüstung</h3>
      <p class="muted">Jede Figur hat einen Heiltrank. Dazu:</p>
      ${s.startKitChoices.map((label, i) => `<label class="row"><input type="radio" name="kit" value="${i}" ${draft.kit === i ? 'checked' : ''} style="width:auto"> ${esc(label)}</label>`).join('')}
    </section>
    <button class="primary big" id="done" ${used !== 12 ? 'disabled' : ''}>Fertig</button>
    ${s.phase === 'playing' || s.phase === 'interlude' ? '' : `<div style="margin-top:.9rem">${wishCard()}</div>`}`;
  bindWish();
  const keep = () => { draft.name = $('#cname').value; draft.concept = $('#concept').value; draft.kerbe = $('#kerbe').value; };
  app.onclick = (e) => {
    const inc = e.target.dataset.inc, dec = e.target.dataset.dec;
    if (inc && draft.stats[inc] < 4 && used < 12) { keep(); draft.stats[inc]++; renderCreation(); }
    if (dec && draft.stats[dec] > 1) { keep(); draft.stats[dec]--; renderCreation(); }
  };
  app.onchange = (e) => { if (e.target.name === 'kit') draft.kit = Number(e.target.value); };
  $('#done').onclick = async () => { keep(); app.onclick = null; await act('character', draft); };
}

const info = (itemId) => state.itemInfo?.[itemId] || {};
const icon = (itemId, cls = '') => { const n = info(itemId).icon; return n ? `<i class="ico ${cls}" style="--ico:url(/icons/${n}.svg)"></i>` : ''; };

const hint = (k) => ({ kraft: 'Nahkampf, heben, aushalten', agilitaet: 'ausweichen, klettern, schleichen, Bogen', wahrnehmung: 'entdecken, Fallen, Spuren', verstand: 'Rätsel, Wissen, Magie', wort: 'überzeugen, lügen, handeln' }[k]);

function renderWaiting() {
  const c = state.me.character;
  app.onclick = null;
  app.innerHTML = `
    <h1>${esc(c.name)}</h1>
    ${charCard()}
    ${wishCard()}
    <section class="card"><p>Gleich geht es los. Leg das Handy vor dich, Bildschirm nach oben.</p>
    <p class="muted">Am Tisch: ${state.players.map((p) => esc(p.name)).join(', ')}</p></section>`;
  bindWish();
}

// Was wollt ihr heute erleben? Der Moderator schreibt daraus das Abenteuer.
function wishCard() {
  const g = state.adventureGen;
  if (!g) return '';
  const status = g.status === 'writing' ? '<p class="thinking">Der Moderator schreibt euer Abenteuer …</p>'
    : g.status === 'ready' ? `<p class="pill on">Heute: ${esc(g.title)}</p>` : `<p class="muted">Heute: ${esc(g.title)}</p>`;
  return `<section class="card">
    <h3>Was wollt ihr heute erleben?</h3>
    ${status}
    ${g.wishes.length ? `<ul class="wishes">${g.wishes.map((w) => `<li><b>${esc(w.who)}:</b> ${esc(w.text)}</li>`).join('')}</ul>` : '<p class="muted">Zum Beispiel: „Piraten“, „lustig, mit einem sprechenden Esel“, „gruselig, aber nicht zu sehr“.</p>'}
    ${g.status === 'writing' ? '' : `<div class="row"><input id="wish" class="grow" maxlength="200" placeholder="Dein Wunsch"><button id="wishBtn">Dazu</button></div>`}
  </section>`;
}
function bindWish() {
  const btn = document.getElementById('wishBtn');
  if (btn) btn.onclick = async () => { const el = document.getElementById('wish'); const t = el.value.trim(); if (t && (await act('wish', { text: t })).ok) el.value = ''; };
}

function charCard() {
  const c = state.me.character;
  return `<section class="card">
    <div class="row" style="justify-content:space-between"><b>${esc(c.name)}</b><small class="muted">${esc(c.concept)}</small></div>
    <div class="lp" style="margin:.4rem 0"><i style="width:${(100 * c.lp) / c.lpMax}%"></i></div>
    <div class="row"><span class="pill ${c.down ? 'off' : ''}">${c.down ? 'AM BODEN' : `${c.lp} / ${c.lpMax} LP`}</span>
      ${state.stats.map((st) => `<span class="pill">${st.label.slice(0, 3)} ${c.stats[st.key]}</span>`).join('')}
      ${state.silver !== null && state.silver !== undefined ? `<span class="pill gold">${state.silver} Silber</span>` : ''}</div>
    ${c.conditions.length ? `<small style="color:var(--red)">${c.conditions.map((x) => esc(x.label)).join(', ')}</small>` : ''}
  </section>`;
}

// ---------- Spiel ----------
function renderPlay() {
  const s = state;
  const myId = s.me.character.playerId;
  const myCheck = s.pendingCheck && s.pendingCheck.playerId === myId ? s.pendingCheck : null;
  const speaking = s.activeSpeaker === myId;
  const inv = s.me.inventory;
  const weapons = inv.items.filter((i) => info(i.itemId).weapon).sort((x, y) => (y.inHand ? 1 : 0) - (x.inHand ? 1 : 0));
  const ammoLeft = (w) => { const a = info(w.itemId).ammo; return a ? inv.items.filter((i) => i.itemId === a).reduce((n, i) => n + i.qty, 0) : null; };

  app.innerHTML = `
    ${myCheck ? `<section class="card alert">
      <h2>Du würfelst</h2>
      <p>${esc(myCheck.reason)}<br><b>${esc(myCheck.statLabel)} ${myCheck.statValue}</b> · Ziel ${myCheck.dc}</p>
      ${diceHtml('roll')}
    </section>` : ''}

    ${charCard()}
    <button class="speak ${speaking ? 'active' : ''}" id="speak">${speaking ? 'Du hast das Wort' : 'Ich spreche'}</button>
    <p class="muted" style="text-align:center;margin:.3rem 0 .9rem">Kurz antippen, dann einfach reden. Nicht festhalten.</p>

    ${s.combat ? `<section class="card ${myCheck ? '' : 'alert'}">
      <h2>Kampf</h2>
      ${s.combat.enemies.map((e) => `<div class="enemy ${e.defeated ? 'dead' : ''}">
        <b class="grow">${esc(e.name)}</b><div class="lp" style="width:80px"><i style="width:${(100 * e.lp) / e.lpMax}%"></i></div>
        ${e.defeated ? '' : `<button data-target="${e.instanceId}" class="${attackTarget === e.instanceId ? 'primary' : ''}">Angreifen</button>`}</div>`).join('')}
      ${attackTarget ? `
        <label>Womit? <select id="weapon">${weapons.map((w) => { const n = ammoLeft(w); return `<option value="${w.uid}" ${attackWeapon === w.uid ? 'selected' : ''}>${esc(w.name)}${w.inHand ? ' (in der Hand)' : ''}${n !== null ? ` · ${n} Pfeile` : ''}</option>`; }).join('')}<option value="">Fäuste</option></select></label>
        ${diceHtml('attack')}` : ''}
    </section>` : ''}

    ${s.riddle ? `<section class="card riddle">
      <h3>Rätsel</h3>
      <p class="q">${esc(s.riddle.question)}</p>
      <p class="muted">Antwortet laut. Fehlversuche: ${s.riddle.attempts} von ${s.riddle.maxAttempts}. Jeder kostet 5 Minuten.</p>
    </section>` : ''}

    ${s.loot.length ? `<section class="card loot ${s.loot.some((l) => !seenLoot.has(l.lootId)) ? 'fresh' : ''}"><h3>Hier liegt – wer zuerst tippt</h3>
      ${s.loot.map((l) => `<div class="row" style="margin-bottom:.35rem"><span class="grow">${icon(l.itemId)}${esc(l.name)}${l.qty > 1 ? ` ×${l.qty}` : ''}</span><button class="primary" data-take="${l.lootId}">Nehmen</button></div>`).join('')}</section>` : ''}

    ${s.shop ? `<section class="card">
      <h3>${esc(s.shop.npcName)} verkauft</h3>
      ${s.shop.deal ? `<p class="pill ${s.shop.deal.tier === 'abgelehnt' ? 'off' : 'on'}">${esc(s.shop.deal.label)}${s.shop.deal.discount ? ` · −${Math.round(s.shop.deal.discount * 100)} %` : ''}</p>` : '<p class="muted">Verhandeln lohnt sich: einfach mit der Figur reden.</p>'}
      ${s.shop.items.map((i) => `<div class="row" style="margin-bottom:.3rem"><span class="grow">${icon(i.itemId)}${esc(i.name)}</span>
        <span class="${i.price !== null && i.price < i.list ? 'pill on' : 'muted'}">${i.price === null ? '–' : `${i.price} Silber`}${i.price !== null && i.price < i.list ? ` <s>${i.list}</s>` : ''}</span>
        <button data-buy="${i.itemId}" ${i.price === null || i.price > (s.silver ?? 0) ? 'disabled' : ''}>Kaufen</button></div>`).join('')}
    </section>` : ''}

    <section class="card">
      <h3>Rucksack</h3>
      ${bagHtml(inv)}
      ${selectedUid ? itemActions(inv) : '<p class="muted">Gegenstand antippen für Benutzen, Geben, Ablegen. Feld antippen zum Verschieben.</p>'}
    </section>

    <section class="card">
      <h3>Am Tisch</h3>
      <div class="feed" style="max-height:30vh">${s.feed.slice(-12).map((f) => `<div class="line ${f.kind}"><b>${esc(f.who)}</b>${esc(f.text)}</div>`).join('')}</div>
      <div class="row" style="margin-top:.5rem"><input id="say" class="grow" placeholder="Leise tippen statt sprechen"><button id="sayBtn">Senden</button></div>
    </section>`;

  const feed = app.querySelector('.feed'); if (feed) feed.scrollTop = feed.scrollHeight;
  $('#speak').onclick = () => { act('speak'); };
  $('#sayBtn').onclick = () => { const t = $('#say').value.trim(); if (t) { act('say', { text: t }); $('#say').value = ''; } };
  const wsel = $('#weapon'); if (wsel) wsel.onchange = (e) => { attackWeapon = e.target.value; };

  app.onclick = async (e) => {
    const d = e.target.dataset;
    if (d.take) { const r = await act('take', { lootId: d.take }); if (r.ok) toast('Deins!'); return; }
    if (d.buy) { const r = await act('buy', { itemId: d.buy }); if (r.ok) toast('Gekauft.'); return; }
    if (d.target) { attackTarget = d.target; attackWeapon = weapons.find((w) => w.inHand)?.uid ?? weapons[0]?.uid ?? ''; return render(); }
    if (d.die) {
      const natural = d.die === 'auto' ? undefined : Number(d.die);
      if (d.mode === 'roll') return rollOnce('roll', { natural });
      if (d.mode === 'attack') return rollOnce('attack', { enemyId: attackTarget, weaponUid: $('#weapon')?.value || attackWeapon, natural });
    }
    if (d.uid) { selectedUid = selectedUid === d.uid ? null : d.uid; return render(); }
    if (d.cell && selectedUid) { const [x, y] = d.cell.split(',').map(Number); await act('move', { uid: selectedUid, x, y }); selectedUid = null; return; }
    if (d.use) { await act('use', { uid: d.use, target: $('#useTarget')?.value }); selectedUid = null; return; }
    if (d.give) { const to = $('#giveTo').value; if (to) await act('give', { uid: d.give, to }); selectedUid = null; return; }
    if (d.drop) { await act('drop', { uid: d.drop }); selectedUid = null; }
    if (d.equip) { await act('equip', { uid: d.equip }); selectedUid = null; return; }
    if (d.unequip) { await act('unequip', { uid: d.unequip }); selectedUid = null; }
  };
  if (!s.combat) attackTarget = null;
  // Neue Probe: nach oben scrollen, damit niemand sie unter dem Rucksack sucht
  if (myCheck && myCheck.id !== lastCheckId) window.scrollTo({ top: 0, behavior: 'smooth' });
  lastCheckId = myCheck?.id ?? null;
  s.loot.forEach((l) => seenLoot.add(l.lootId));
}

function diceHtml(mode) {
  const off = busy ? 'disabled' : '';
  return `<p class="muted" style="margin:.2rem 0 .5rem">Echten W20 werfen und die Zahl tippen:</p>
    <div class="dice">${Array.from({ length: 20 }, (_, i) => i + 1).map((n) => `<button ${off} data-die="${n}" data-mode="${mode}" class="${n === 20 ? 'n20' : n === 1 ? 'n1' : ''}">${n}</button>`).join('')}</div>
    <p style="margin-top:.6rem"><button ${off} class="big primary" data-die="auto" data-mode="${mode}">${busy ? 'Würfel rollt …' : 'Oder: Handy würfeln lassen'}</button></p>`;
}

function bagHtml(inv) {
  const held = inv.items.find((i) => i.inHand);
  const hand = `<div class="hand row"><span class="muted">In der Hand</span>
    ${held ? `<div class="item ${selectedUid === held.uid ? 'sel' : ''}" data-uid="${held.uid}">${icon(held.itemId)}<span>${esc(held.name)}</span></div>` : '<span class="muted">nichts (Fäuste)</span>'}</div>`;
  const cells = [];
  for (let y = 0; y < inv.h; y++) for (let x = 0; x < inv.w; x++) cells.push(`<div class="cell" data-cell="${x},${y}" style="grid-column:${x + 1};grid-row:${y + 1}"></div>`);
  const items = inv.items.filter((i) => !i.inHand).map((i) => `<div class="item ${selectedUid === i.uid ? 'sel' : ''}" data-uid="${i.uid}" style="grid-column:${i.x + 1}/span ${i.w};grid-row:${i.y + 1}/span ${i.h}">${icon(i.itemId)}<span>${esc(i.name)}${i.qty > 1 ? ` ×${i.qty}` : ''}</span></div>`);
  return `${hand}<div class="bag" style="grid-template-columns:repeat(${inv.w},1fr)">${cells.join('')}${items.join('')}</div>`;
}

function itemActions(inv) {
  const it = inv.items.find((i) => i.uid === selectedUid);
  if (!it) { selectedUid = null; return ''; }
  const others = state.characters.filter((c) => c.playerId !== state.me.character.playerId);
  const usable = info(it.itemId).use;
  const weapon = info(it.itemId).weapon;
  return `<div class="card" style="margin-top:.6rem;background:var(--panel2)">
    <b>${icon(it.itemId)}${esc(it.name)}</b>${info(it.itemId).effect ? `<br><small class="muted">${esc(info(it.itemId).effect)}</small>` : ''}
    ${weapon ? `<div class="row" style="margin-top:.4rem">${it.inHand ? `<button data-unequip="${it.uid}">In den Rucksack</button>` : `<button class="primary" data-equip="${it.uid}">In die Hand</button>`}</div>` : ''}
    ${usable ? `<div class="row" style="margin-top:.4rem"><select id="useTarget" class="grow"><option value="">für mich</option>${others.map((c) => `<option value="${c.playerId}">für ${esc(c.name)}</option>`).join('')}</select><button class="primary" data-use="${it.uid}">Benutzen</button></div>` : ''}
    ${others.length ? `<div class="row" style="margin-top:.4rem"><select id="giveTo" class="grow">${others.map((c) => `<option value="${c.playerId}">an ${esc(c.name)}</option>`).join('')}</select><button data-give="${it.uid}">Geben</button></div>` : ''}
    <div class="row" style="margin-top:.4rem"><button class="danger" data-drop="${it.uid}">Ablegen</button><small class="muted">Oder ein freies Feld antippen zum Verschieben.</small></div>
  </div>`;
}

function renderEnd() {
  const s = state;
  app.onclick = null;
  if (!s.me) { app.innerHTML = '<h1>Ende</h1><p>Danke fürs Mitspielen.</p>'; return; }
  app.innerHTML = `<h1>Ende des Abends</h1>${charCard()}<section class="card"><p>Deine Figur ist gespeichert und darf beim nächsten Mal wiederkommen. Danke fürs Mitspielen.</p></section>`;
}

// Pause zwischen zwei Akten: Rast ist gebucht, jede Figur wählt ihren Meilenstein
function renderInterlude() {
  const s = state;
  const c = s.me.character;
  const next = s.nextScene ? `Als Nächstes: Akt ${s.nextScene.act}, „${esc(s.nextScene.title)}“` : '';
  if (!s.milestoneOpen) {
    app.onclick = null;
    app.innerHTML = `<h1>Pause</h1>${charCard()}<section class="card"><p>Gewählt. ${s.milestonesPending ? `Noch ${s.milestonesPending} am Tisch wählen.` : 'Gleich geht es weiter.'}</p><p class="muted">${next}</p></section>`;
    return;
  }
  app.innerHTML = `<h1>Deine Figur wächst</h1>${charCard()}
    <section class="card"><h3>+1 auf einen Wert</h3>
      <div class="row">${s.stats.map((st) => `<button data-ms-stat="${st.key}" ${c.stats[st.key] >= 5 ? 'disabled' : ''}>${st.label} ${c.stats[st.key]} → ${c.stats[st.key] + 1}</button>`).join('')}</div></section>
    <section class="card"><h3>oder eine Fähigkeit</h3>
      ${s.abilities.filter((a) => !c.abilities.includes(a)).map((a) => `<p><button data-ms-ability="${esc(a)}" style="text-align:left;width:100%">${esc(a)}</button></p>`).join('')}</section>
    <p class="muted">${next}</p>`;
  app.onclick = (e) => {
    if (e.target.dataset.msStat) act('milestone', { stat: e.target.dataset.msStat });
    if (e.target.dataset.msAbility) act('milestone', { ability: e.target.dataset.msAbility });
  };
}
