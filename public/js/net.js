// WebSocket-Verbindung mit automatischem Wiederverbinden und Anfrage/Antwort.
// Handys sperren den Bildschirm: Beim Zurückkommen wird sofort neu verbunden,
// nach längerer Pause frisch aufgebaut (die alte Verbindung kann halb tot sein).
const STALE_AFTER_MS = 4000;

export function connect({ code, token, onState, onMessage, onStatus }) {
  let ws = null, reqId = 0, closed = false, retry = 500, retryTimer = null, hiddenAt = null;
  const waiting = new Map();

  function open() {
    clearTimeout(retryTimer);
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
    ws = sock;
    sock.onopen = () => { retry = 500; onStatus?.('online'); };
    sock.onclose = () => {
      if (sock !== ws) return;           // ersetzt, nichts tun
      onStatus?.('offline');
      if (!closed) retryTimer = setTimeout(open, retry = Math.min(retry * 2, 5000));
    };
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'state') return onState?.(m.state);
      if (m.type === 'result' && waiting.has(m.reqId)) { waiting.get(m.reqId)(m); waiting.delete(m.reqId); return; }
      if (m.type === 'error') onStatus?.('error', m.error);
      onMessage?.(m);
    };
  }

  // Sofort neu verbinden; bei fresh=true auch eine scheinbar offene Verbindung ersetzen
  function reconnect(fresh = false) {
    if (closed) return;
    const st = ws?.readyState;
    if (!fresh && (st === WebSocket.OPEN || st === WebSocket.CONNECTING)) return;
    const old = ws;
    ws = null;
    if (old) { old.onclose = null; try { old.close(); } catch { /* egal */ } }
    onStatus?.('offline');
    retry = 500;
    open();
  }

  const onVisibility = () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    reconnect(away > STALE_AFTER_MS);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', () => reconnect(true));
  window.addEventListener('pageshow', (e) => { if (e.persisted) reconnect(true); });

  open();

  return {
    send(action, payload = {}) {
      return new Promise((resolve) => {
        if (!ws || ws.readyState !== 1) { reconnect(); return resolve({ ok: false, error: 'Keine Verbindung, verbinde neu …' }); }
        const id = ++reqId;
        waiting.set(id, resolve);
        ws.send(JSON.stringify({ action, payload, reqId: id }));
        setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); resolve({ ok: false, error: 'Zeitüberschreitung' }); } }, 8000);
      });
    },
    reconnect,
    close() {
      closed = true;
      clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      ws?.close();
    },
  };
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(text, kind = 'info') {
  let box = document.getElementById('toast');
  if (!box) { box = document.createElement('div'); box.id = 'toast'; document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  box.append(el);
  setTimeout(() => el.remove(), 3500);
}
