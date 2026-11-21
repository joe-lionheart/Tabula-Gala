// Abenteuer auf Zuruf: Die Runde sagt in der Lobby, was sie erleben will, der Moderator schreibt
// das Abenteuer, während die Figuren entstehen. Der Server prüft es (validateWorld) und fällt
// bei Fehlern auf das Testabenteuer zurück. Nie wird ein ungeprüftes Abenteuer gespielt.
import { validateWorld } from '../content/validate.js';
import { allBeds, allSfx } from '../audio/director.js';
import { knownIcons } from '../content/validate.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

export const AUTHOR_TOOL = {
  name: 'write_adventure',
  description: 'Das fertige Abenteuer als Daten. Immer genau dieses Werkzeug benutzen.',
  input_schema: {
    type: 'object',
    properties: {
      adventure: {
        type: 'object',
        properties: {
          title: { type: 'string' }, pitch: { type: 'string', description: 'Zwei Sätze, die neugierig machen.' },
          tone: { type: 'string' }, durationMin: { type: 'integer', minimum: 90, maximum: 180 },
          lesson: { type: 'string', description: 'Was die Runde am Ende verstanden hat. Ein Satz.' },
          structure: { type: 'string' },
        },
        required: ['title', 'pitch', 'tone', 'durationMin', 'lesson'],
      },
      scenes: { type: 'array', minItems: 5, maxItems: 7, items: { type: 'object' } },
      items: { type: 'array', items: { type: 'object' }, description: 'Nur neue Gegenstände; der Grundkatalog bleibt.' },
      enemies: { type: 'array', items: { type: 'object' }, description: 'Nur neue Gegner.' },
      lootTables: { type: 'object', description: 'Neue Loot-Tabellen: id → [{item, qty, hidden?}]' },
    },
    required: ['adventure', 'scenes', 'lootTables'],
  },
};

export function authorPrompt(base) {
  const catalog = base.items.map((i) => `${i.id} (${i.name})`).join(', ');
  const foes = base.enemies.map((e) => `${e.id} (${e.name}, Stufe ${e.stufe})`).join(', ');
  const example = JSON.stringify(base.scenes.find((s) => s.shop) || base.scenes[1]);
  return `Du schreibst Abenteuer für „Tabula Gala“, ein Hörspiel, in dem eine Runde von 2–6 Leuten am Tisch mitspielt. Ein KI-Moderator erzählt; der Server würfelt und bucht nach festen Regeln.

Aufbau (aristotelisch, verbindlich):
- 5–7 Szenen in genau 3 Akten. Akt I = Anfang, Akt II = Mitte, Akt III = Ende.
- Jede Szene hat arc: exposition | steigerung | peripetie | erkenntnis | loesung. Reihenfolge: exposition zuerst, dann steigerung, eine peripetie (Wendepunkt: das Gegenteil dessen, was die Runde glaubte), eine erkenntnis (Anagnorisis: wer was getan hat und warum), am Ende loesung.
- Eine Lehre (adventure.lesson), die die Runde erlebt statt gepredigt bekommt.
- Jede Szene: genau 3 Ausgänge exit_1, exit_2, exit_3 mit unterschiedlichen Wegen. „to“ ist die id der nächsten Szene, in der letzten Szene null, und dort hat jeder Ausgang ein „outro“ (2–3 Sätze Ausklang).
- pathNotes in späteren Szenen: was ein früher gewählter Ausgang hier bedeutet. Schlüssel "szenenid:exit_x".

Pflicht-Inhalte:
- Mindestens 2 Rätsel (riddles) in verschiedenen Szenen: fair, ohne Spezialwissen lösbar, eine kurze Lösung. Felder: id, npc (id einer Nebenfigur der Szene), when, question, answers (Lösungswörter, klein), near (Wörter für „nah dran“), hint, stat (meist verstand), dc (12–15), solvedText, reward ({chest: id} oder {reveal: [verborgene Gegenstands-ids der Szenen-Loot-Tabelle]}).
- Genau ein Laden (shop) bei einer Nebenfigur, mit der man verhandeln will (z. B. Schmied, Händlerin): {npc, items: [{item, price}]}, Preise 1–5 Silber. Die Figur braucht klare wants, damit Argumente greifen.
- 2–4 Truhen (chests) über das Abenteuer verteilt: {id, label, loot (Tabelle), lock?: {stat, dc, text, key?}}. Mindestens eine verschlossen.
- Gegner mit Loot-Tabellen, damit Kämpfe etwas fallen lassen.

Szenenfelder (Beispiel einer echten Szene folgt): id, act, arc, title, ambience, budgetMin (10–35), intro (3–5 Sätze zum Vorlesen, mit Sinneseindrücken), anchors (3 Raumanker, die man benutzen kann), npcs ({id, name, voice, wants, secret}), exits, abortSignal, enemies (ids), loot (Tabellen-id), allowedSfx, optional riddles, shop, chests, pathNotes, peripetie.

Katalog, der schon da ist (nicht neu anlegen, gern benutzen): ${catalog}
Gegner, die schon da sind: ${foes}
Neue Gegenstände: {id, name, w, h (1–3), icon, effect} oder Waffe {weapon: {damage wie "1W8+1", kind: klinge|stumpf|bogen|faust, stat: kraft|agilitaet, ammo?: "pfeile"}} (Kurzwaffen 1 Feld, Langwaffen 2 Felder, nie mehr) oder Heilmittel {use: {heal: 10–30}, stack: true}. Bögen verbrauchen Pfeile; legt Pfeile in Loot und Laden ({item: "pfeile", price, qty}). Keine Feuerwaffen.
Icons (Feld icon, nur aus dieser Liste): ${knownIcons().join(', ')}.
Neue Gegner: {id, name, stufe 1–4, kompl: [2 Komplikationen], loot, sound}.
Klangteppiche (ambience): ${allBeds().join(', ')}. Erlaubte Klänge: ${allSfx().join(', ')}.

Beispielszene:
${example}

Regeln für den Ton: Deutsch, warm, für Familie und Freunde, mit Humor. Keine Gewaltverherrlichung, keine realen Personen, nichts Sexuelles, keine Trinkaufforderung. Die Wünsche der Runde haben Vorrang; was sie offen lässt, entscheidest du.
Antworte nur über das Werkzeug „write_adventure“.`;
}

// Erzeugtes Abenteuer mit dem Grundkatalog verbinden: Basis-Gegenstände, -Gegner, Fähigkeiten und Startausrüstung bleiben
export function mergeAdventure(base, gen) {
  const byId = (arr) => new Map((arr || []).map((x) => [x.id, x]));
  const items = byId(base.items); for (const i of gen.items || []) if (i?.id && !items.has(i.id)) items.set(i.id, i);
  const enemies = byId(base.enemies); for (const e of gen.enemies || []) if (e?.id && !enemies.has(e.id)) enemies.set(e.id, e);
  return {
    ...structuredClone(base),
    adventure: { ...base.adventure, ...gen.adventure, id: `zuruf-${Date.now().toString(36)}`, generated: true },
    scenes: gen.scenes,
    items: [...items.values()],
    enemies: [...enemies.values()],
    lootTables: { ...base.lootTables, ...(gen.lootTables || {}) },
  };
}

export function createAuthor(env = process.env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return mockAuthor();
  return claudeAuthor({ key, model: env.TISCHLEITER_AUTOR_MODEL || env.TISCHLEITER_MODEL || 'claude-sonnet-5-5' });
}

function claudeAuthor({ key, model }) {
  async function call(messages, system) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 16000, system, tools: [AUTHOR_TOOL], tool_choice: { type: 'tool', name: AUTHOR_TOOL.name }, messages }),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === 'tool_use');
    if (!block) throw new Error('Kein Abenteuer im Werkzeug-Format');
    return { block, usage: data.usage || {} };
  }
  return {
    kind: 'claude', model,
    async write({ wishes, base, players, durationMin = 150 }) {
      const system = authorPrompt(base);
      const ask = `Die Runde (${players.length} Leute: ${players.join(', ') || 'noch unbekannt'}) wünscht sich:\n${wishes.map((w) => `- ${w.who}: ${w.text}`).join('\n') || '- (keine Wünsche: überrasch uns)'}\nGeplante Spieldauer: ${durationMin} Minuten ohne Pausen; verteile die Szenenbudgets entsprechend.\nSchreib das Abenteuer.`;
      const messages = [{ role: 'user', content: ask }];
      let tokensIn = 0, tokensOut = 0;
      for (let round = 0; round < 2; round++) {
        const { block, usage } = await call(messages, system);
        tokensIn += usage.input_tokens || 0; tokensOut += usage.output_tokens || 0;
        const world = mergeAdventure(base, block.input);
        const check = validateWorld(world);
        if (check.ok) return { world, fixes: check.fixes, tokensIn, tokensOut, rounds: round + 1 };
        // Eine Nachbesserungsrunde mit den konkreten Fehlern
        messages.push({ role: 'assistant', content: [block] });
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `Das Abenteuer hat Fehler. Bitte vollständig korrigiert neu senden:\n- ${check.errors.slice(0, 30).join('\n- ')}` }] });
        if (round === 1) throw Object.assign(new Error(`Abenteuer ungültig: ${check.errors.slice(0, 5).join('; ')}`), { tokensIn, tokensOut });
      }
      throw new Error('unerreichbar');
    },
  };
}

// Ohne Schlüssel: das Testabenteuer, damit der Ablauf in der Lobby trotzdem durchläuft
export function mockAuthor() {
  return {
    kind: 'mock', model: 'testabenteuer',
    async write({ base }) {
      const world = structuredClone(base);
      return { world, fixes: [], tokensIn: 0, tokensOut: 0, rounds: 0, fallback: true };
    },
  };
}
