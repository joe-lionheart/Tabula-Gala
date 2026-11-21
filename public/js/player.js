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
let speakTimer = null;

if (!token) renderJoin(); else start();

function renderJoin(error = '') {
  app.innerHTML = `
    <h1>Tabula Gala</h1>
    <section class="card">
      <h2>Runde ${esc(code)}</h2>
      <p class="muted">Wie heißt du am Tisch?</p>
      <input id="name" placeholder="Dein Vorname" maxlength="24" autocomplete="given-name">
      ${error ? `<p style="color:var(--red)">${esc(error)}</p>` : ''}
      <p><button class="primary big" id="go">Platz nehmen</button></p>
    </section>`;
  $('#go').onclick = async () => {
    const name = $('#name').value.trim();
    const r = await fetch(`/api/sessions/${code}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then((x) => x.json());
    if (!r.ok) return renderJoin(r.error || 'Beitritt fehlgeschlagen');
    token = r.token; localStorage.setItem(key, token);
    start();
  };
}

function start() {
  net = connect({
    code, token,
    onState: (s) => { const j = JSON.stringify(s); if (j === lastJson) return; lastJson = j; state = s; render(); },
    onStatus: (s, err) => {
      if (err) { localStorage.removeItem(key); token = null; renderJoin(err); net?.close(); }
    },
    onMessage: (m) => { if (m.type === 'buzz' && navigator.vibrate) navigator.vibrate([120, 60, 120]); },
  });
}

const act = async (action, payload) => {
  const r = await net.send(action, payload);
  if (!r.ok && r.error) toast(r.error, 'error');
  return r;
};

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
  if (s.phase === 'ended') return renderEnd();
  renderPlay();
}

// ---------- Figur bauen ----------
function renderCreation() {
  const s = state;
  const used = Object.values(draft.stats).reduce((a, b) => a + b, 0);
  app.innerHTML = `
    <h1>Deine Figur</h1>
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
    <button class="primary big" id="done" ${used !== 12 ? 'disabled' : ''}>Fertig</button>`;
  const keep = () => { draft.name = $('#cname').value; draft.concept = $('#concept').value; draft.kerbe = $('#kerbe').value; };
  app.onclick = (e) => {
    const inc = e.target.dataset.inc, dec = e.target.dataset.dec;
    if (inc && draft.stats[inc] < 4 && used < 12) { keep(); draft.stats[inc]++; renderCreation(); }
    if (dec && draft.stats[dec] > 1) { keep(); draft.stats[dec]--; renderCreation(); }
  };
  app.onchange = (e) => { if (e.target.name === 'kit') draft.kit = Number(e.target.value); };
  $('#done').onclick = async () => { keep(); app.onclick = null; await act('character', draft); };
}

const hint = (k) => ({ kraft: 'Nahkampf, heben, aushalten', agilitaet: 'ausweichen, klettern, schleichen, Bogen', wahrnehmung: 'entdecken, Fallen, Spuren', verstand: 'Rätsel, Wissen, Magie', wort: 'überzeugen, lügen, handeln' }[k]);

function renderWaiting() {
  const c = state.me.character;
  app.onclick = null;
  app.innerHTML = `
    <h1>${esc(c.name)}</h1>
    ${charCard()}
    <section class="card"><p>Gleich geht es los. Leg das Handy vor dich, Bildschirm nach oben.</p>
    <p class="muted">Am Tisch: ${state.players.map((p) => esc(p.name)).join(', ')}</p></section>`;
}

function charCard() {
  const c = state.me.character;
  return `<section class="card">
    <div class="row" style="justify-content:space-between"><b>${esc(c.name)}</b><small class="muted">${esc(c.concept)}</small></div>
    <div class="lp" style="margin:.4rem 0"><i style="width:${(100 * c.lp) / c.lpMax}%"></i></div>
    <div class="row"><span class="pill ${c.down ? 'off' : ''}">${c.down ? 'AM BODEN' : `${c.lp} / ${c.lpMax} LP`}</span>
      ${state.stats.map((st) => `<span class="pill">${st.label.slice(0, 3)} ${c.stats[st.key]}</span>`).join('')}</div>
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
  const weapons = inv.items.filter((i) => /schwert|kolben|dolch|bogen|knüppel/i.test(i.name));

  app.innerHTML = `
    ${charCard()}
    <button class="speak ${speaking ? 'active' : ''}" id="speak">${speaking ? 'Du hast das Wort' : 'Ich spreche'}</button>
    <p class="muted" style="text-align:center;margin:.3rem 0 .9rem">Kurz antippen, dann einfach reden. Nicht festhalten.</p>

    ${myCheck ? `<section class="card alert">
      <h2>Du würfelst</h2>
      <p>${esc(myCheck.reason)}<br><b>${esc(myCheck.statLabel)} ${myCheck.statValue}</b> · Ziel ${myCheck.dc}</p>
      ${diceHtml('roll')}
    </section>` : ''}

    ${s.combat ? `<section class="card ${myCheck ? '' : 'alert'}">
      <h2>Kampf</h2>
      ${s.combat.enemies.map((e) => `<div class="enemy ${e.defeated ? 'dead' : ''}">
        <b class="grow">${esc(e.name)}</b><div class="lp" style="width:80px"><i style="width:${(100 * e.lp) / e.lpMax}%"></i></div>
        ${e.defeated ? '' : `<button data-target="${e.instanceId}" class="${attackTarget === e.instanceId ? 'primary' : ''}">Angreifen</button>`}</div>`).join('')}
      ${attackTarget ? `
        <label>Womit? <select id="weapon">${weapons.map((w) => `<option value="${w.uid}" ${attackWeapon === w.uid ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}<option value="">Fäuste</option></select></label>
        <p class="muted">Würfle deinen W20 und tipp die Zahl, oder lass das Handy würfeln:</p>${diceHtml('attack')}` : ''}
    </section>` : ''}

    ${s.loot.length ? `<section class="card"><h3>Hier liegt</h3>
      ${s.loot.map((l) => `<div class="row" style="margin-bottom:.3rem"><span class="grow">${esc(l.name)}${l.qty > 1 ? ` ×${l.qty}` : ''}</span><button data-take="${l.lootId}">Nehmen</button></div>`).join('')}</section>` : ''}

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
    if (d.take) return act('take', { lootId: d.take });
    if (d.target) { attackTarget = d.target; attackWeapon = attackWeapon ?? weapons[0]?.uid ?? ''; return render(); }
    if (d.die) {
      const natural = d.die === 'auto' ? undefined : Number(d.die);
      if (d.mode === 'roll') return act('roll', { natural });
      if (d.mode === 'attack') { await act('attack', { enemyId: attackTarget, weaponUid: $('#weapon')?.value || attackWeapon, natural }); return; }
    }
    if (d.uid) { selectedUid = selectedUid === d.uid ? null : d.uid; return render(); }
    if (d.cell && selectedUid) { const [x, y] = d.cell.split(',').map(Number); await act('move', { uid: selectedUid, x, y }); selectedUid = null; return; }
    if (d.use) { await act('use', { uid: d.use, target: $('#useTarget')?.value }); selectedUid = null; return; }
    if (d.give) { const to = $('#giveTo').value; if (to) await act('give', { uid: d.give, to }); selectedUid = null; return; }
    if (d.drop) { await act('drop', { uid: d.drop }); selectedUid = null; }
  };
  if (!s.combat) attackTarget = null;
}

function diceHtml(mode) {
  return `<div class="dice">${Array.from({ length: 20 }, (_, i) => i + 1).map((n) => `<button data-die="${n}" data-mode="${mode}" class="${n === 20 ? 'n20' : n === 1 ? 'n1' : ''}">${n}</button>`).join('')}</div>
    <p><button class="big" data-die="auto" data-mode="${mode}">Handy würfeln lassen</button></p>`;
}

function bagHtml(inv) {
  const cells = [];
  for (let y = 0; y < inv.h; y++) for (let x = 0; x < inv.w; x++) cells.push(`<div class="cell" data-cell="${x},${y}" style="grid-column:${x + 1};grid-row:${y + 1}"></div>`);
  const items = inv.items.map((i) => `<div class="item ${selectedUid === i.uid ? 'sel' : ''}" data-uid="${i.uid}" style="grid-column:${i.x + 1}/span ${i.w};grid-row:${i.y + 1}/span ${i.h}">${esc(i.name)}${i.qty > 1 ? ` ×${i.qty}` : ''}</div>`);
  return `<div class="bag" style="grid-template-columns:repeat(${inv.w},1fr)">${cells.join('')}${items.join('')}</div>`;
}

function itemActions(inv) {
  const it = inv.items.find((i) => i.uid === selectedUid);
  if (!it) { selectedUid = null; return ''; }
  const others = state.characters.filter((c) => c.playerId !== state.me.character.playerId);
  const usable = /trank|verband/i.test(it.name);
  return `<div class="card" style="margin-top:.6rem;background:var(--panel2)">
    <b>${esc(it.name)}</b>
    ${usable ? `<div class="row" style="margin-top:.4rem"><select id="useTarget" class="grow"><option value="">für mich</option>${others.map((c) => `<option value="${c.playerId}">für ${esc(c.name)}</option>`).join('')}</select><button class="primary" data-use="${it.uid}">Benutzen</button></div>` : ''}
    ${others.length ? `<div class="row" style="margin-top:.4rem"><select id="giveTo" class="grow">${others.map((c) => `<option value="${c.playerId}">an ${esc(c.name)}</option>`).join('')}</select><button data-give="${it.uid}">Geben</button></div>` : ''}
    <div class="row" style="margin-top:.4rem"><button class="danger" data-drop="${it.uid}">Ablegen</button><small class="muted">Oder ein freies Feld antippen zum Verschieben.</small></div>
  </div>`;
}

function renderEnd() {
  const s = state;
  if (!s.me) { app.innerHTML = '<h1>Ende</h1><p>Danke fürs Mitspielen.</p>'; return; }
  const c = s.me.character;
  if (!s.milestoneOpen) {
    app.innerHTML = `<h1>Ende des Akts</h1>${charCard()}<section class="card"><p>Deine Figur ist gespeichert. Danke fürs Mitspielen.</p></section>`;
    return;
  }
  app.innerHTML = `<h1>Meilenstein</h1>${charCard()}
    <section class="card"><h3>+1 auf einen Wert</h3>
      <div class="row">${s.stats.map((st) => `<button data-ms-stat="${st.key}" ${c.stats[st.key] >= 5 ? 'disabled' : ''}>${st.label} ${c.stats[st.key]} → ${c.stats[st.key] + 1}</button>`).join('')}</div></section>
    <section class="card"><h3>oder eine Fähigkeit</h3>
      ${s.abilities.map((a) => `<p><button data-ms-ability="${esc(a)}" style="text-align:left;width:100%">${esc(a)}</button></p>`).join('')}</section>`;
  app.onclick = (e) => {
    if (e.target.dataset.msStat) act('milestone', { stat: e.target.dataset.msStat });
    if (e.target.dataset.msAbility) act('milestone', { ability: e.target.dataset.msAbility });
  };
}
