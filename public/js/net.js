// WebSocket-Verbindung mit automatischem Wiederverbinden und Anfrage/Antwort.
export function connect({ code, token, onState, onMessage, onStatus }) {
  let ws, reqId = 0, closed = false, retry = 500;
  const waiting = new Map();

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
    ws.onopen = () => { retry = 500; onStatus?.('online'); };
    ws.onclose = () => {
      onStatus?.('offline');
      if (!closed) setTimeout(open, retry = Math.min(retry * 2, 5000));
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'state') return onState?.(m.state);
      if (m.type === 'result' && waiting.has(m.reqId)) { waiting.get(m.reqId)(m); waiting.delete(m.reqId); return; }
      if (m.type === 'error') onStatus?.('error', m.error);
      onMessage?.(m);
    };
  }
  open();

  return {
    send(action, payload = {}) {
      return new Promise((resolve) => {
        if (ws.readyState !== 1) return resolve({ ok: false, error: 'Keine Verbindung' });
        const id = ++reqId;
        waiting.set(id, resolve);
        ws.send(JSON.stringify({ action, payload, reqId: id }));
        setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); resolve({ ok: false, error: 'Zeitüberschreitung' }); } }, 8000);
      });
    },
    close() { closed = true; ws.close(); },
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
