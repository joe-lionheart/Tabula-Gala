// LLM-Vertrag (Dev-Roadmap §3, Kernmechanik Grundsatz 2):
// Das Modell wählt aus Katalogen, der Server würfelt und bucht. Alles wird validiert.
import { STATS, SEVERITIES } from '../engine/rules.js';

export const TOOL = {
  name: 'moderate',
  description: 'Deine Antwort als Moderator. Immer genau dieses Werkzeug benutzen.',
  input_schema: {
    type: 'object',
    properties: {
      narration: { type: 'string', description: 'Was der Moderator laut erzählt. Höchstens 3 kurze Sätze, gesprochene Sprache, endet auf einem Haken oder einer Frage an den Tisch.' },
      npc_lines: {
        type: 'array', maxItems: 2,
        items: { type: 'object', properties: { npc: { type: 'string' }, text: { type: 'string' } }, required: ['npc', 'text'] },
      },
      check: {
        type: ['object', 'null'],
        description: 'Nur wenn ein Ausgang wirklich ungewiss ist und etwas auf dem Spiel steht.',
        properties: {
          player_id: { type: 'string' },
          stat: { type: 'string', enum: STATS },
          dc: { type: 'integer', minimum: 5, maximum: 25 },
          window: { type: 'integer', minimum: 3, maximum: 7 },
          description_bonus: { type: 'integer', minimum: 0, maximum: 2, description: 'Nur wenn der Spieler etwas einsetzt, das in der Szene schon wahr ist.' },
          reason: { type: 'string', description: 'Kurz, wofür die Probe ist (wird angezeigt).' },
          on_success: { type: 'string', description: 'Ein bis zwei Sätze Erzählung bei Erfolg.' },
          on_strong: { type: 'string', description: 'Ein Satz zusätzliche Wirkung bei starkem Erfolg.' },
          on_fail: { type: 'string', description: 'Ein bis zwei Sätze Erzählung bei Fehlschlag.' },
          fail_event: {
            type: ['object', 'null'],
            properties: { class: { type: 'string', enum: ['K', 'U', 'F', 'Z'] }, severity: { type: 'string', enum: SEVERITIES } },
          },
          reveal_on_success: { type: 'array', items: { type: 'string' }, description: 'IDs verborgener Gegenstände, die bei Erfolg sichtbar werden.' },
        },
        required: ['player_id', 'stat', 'dc', 'reason', 'on_success', 'on_fail'],
      },
      event: {
        type: ['object', 'null'],
        description: 'Direkte Folge ohne Probe (selten). Der Server würfelt den Betrag.',
        properties: {
          player_id: { type: 'string' },
          class: { type: 'string', enum: ['K', 'U', 'F', 'Z'] },
          severity: { type: 'string', enum: SEVERITIES },
          reason: { type: 'string' },
        },
        required: ['player_id', 'class', 'severity', 'reason'],
      },
      combat: {
        type: ['object', 'null'],
        properties: {
          start: { type: 'array', items: { type: 'string' }, description: 'Gegner-IDs aus der Szene.' },
          end: { type: 'boolean' },
        },
      },
      reveal_loot: { type: 'array', items: { type: 'string' }, description: 'IDs verborgener Gegenstände, die jetzt im Loot sichtbar werden.' },
      audio: {
        type: 'object',
        properties: {
          bed: { type: 'string', description: 'Klangteppich, nur wenn sich der Ort hörbar ändert.' },
          sfx: { type: 'array', maxItems: 3, items: { type: 'string' } },
        },
      },
      ask_speaker: { type: 'boolean', description: 'true, wenn unklar ist, wer gesprochen hat. Dann in narration freundlich nachfragen.' },
      scene_signal: { type: 'string', enum: ['continue', 'exit_1', 'exit_2', 'exit_3', 'abort'] },
    },
    required: ['narration', 'scene_signal'],
  },
};

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Prüft und säubert die Modellantwort gegen den Spielzustand. Gibt { judgment, problems } zurück.
export function validateJudgment(raw, ctx) {
  const problems = [];
  const j = {
    narration: str(raw?.narration, 600),
    npc_lines: [],
    check: null, event: null, combat: null,
    reveal_loot: [], audio: null, ask_speaker: Boolean(raw?.ask_speaker),
    scene_signal: 'continue',
  };
  const playerIds = new Set(ctx.characters.map((c) => c.playerId));
  const sceneEnemies = new Set(ctx.scene?.enemies || []);
  const hidden = new Set(ctx.hiddenLoot || []);

  if (Array.isArray(raw?.npc_lines)) {
    j.npc_lines = raw.npc_lines.slice(0, 2).map((l) => ({ npc: str(l?.npc, 40), text: str(l?.text, 300) })).filter((l) => l.text);
  }

  const c = raw?.check;
  if (c && typeof c === 'object') {
    if (!playerIds.has(c.player_id)) problems.push(`check.player_id unbekannt: ${c.player_id}`);
    else if (!STATS.includes(c.stat)) problems.push(`check.stat unbekannt: ${c.stat}`);
    else {
      const fe = c.fail_event && ['K', 'U', 'F', 'Z'].includes(c.fail_event.class)
        ? { class: c.fail_event.class, severity: SEVERITIES.includes(c.fail_event.severity) ? c.fail_event.severity : 'leicht' } : null;
      j.check = {
        player_id: c.player_id, stat: c.stat, dc: Number(c.dc), window: c.window ?? undefined,
        description_bonus: Number(c.description_bonus) || 0,
        reason: str(c.reason, 120), on_success: str(c.on_success, 400), on_strong: str(c.on_strong, 200), on_fail: str(c.on_fail, 400),
        fail_event: fe,
        reveal_on_success: (c.reveal_on_success || []).filter((id) => hidden.has(id)),
      };
    }
  }

  const e = raw?.event;
  if (e && typeof e === 'object') {
    if (!playerIds.has(e.player_id)) problems.push(`event.player_id unbekannt: ${e.player_id}`);
    else if (!['K', 'U', 'F', 'Z'].includes(e.class)) problems.push(`event.class unbekannt: ${e.class}`);
    else j.event = { player_id: e.player_id, class: e.class, severity: SEVERITIES.includes(e.severity) ? e.severity : 'leicht', reason: str(e.reason, 120) };
  }

  const cb = raw?.combat;
  if (cb && typeof cb === 'object') {
    const start = (cb.start || []).filter((id) => sceneEnemies.has(id)).slice(0, 4);
    const dropped = (cb.start || []).filter((id) => !sceneEnemies.has(id));
    if (dropped.length) problems.push(`combat.start nicht in der Szene: ${dropped.join(', ')}`);
    if (start.length || cb.end) j.combat = { start, end: Boolean(cb.end) };
  }

  j.reveal_loot = (raw?.reveal_loot || []).filter((id) => hidden.has(id));
  if (raw?.audio && typeof raw.audio === 'object') j.audio = { bed: str(raw.audio.bed, 30) || undefined, sfx: (raw.audio.sfx || []).map((s) => str(s, 30)).filter(Boolean) };
  if (['continue', 'exit_1', 'exit_2', 'exit_3', 'abort'].includes(raw?.scene_signal)) j.scene_signal = raw.scene_signal;
  else problems.push(`scene_signal ungültig: ${raw?.scene_signal}`);

  if (!j.narration && !j.npc_lines.length) problems.push('keine Erzählung');
  return { judgment: j, problems };
}
