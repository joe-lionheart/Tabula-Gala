import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModerator, readModeratorResponse } from '../server/llm/moderator.js';

test('Claude-Moderator: Anfrage mit tool_choice auto, Antwort aus tool_use', async () => {
  let sent;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ content: [{ type: 'tool_use', name: 'moderate', input: { narration: 'Hallo', scene_signal: 'continue' } }], usage: { input_tokens: 1200, output_tokens: 80 } }) };
  };
  try {
    const m = createModerator({ ANTHROPIC_API_KEY: 'test', TISCHLEITER_MODEL: 'claude-sonnet-5-5' });
    assert.equal(m.kind, 'claude');
    const r = await m.judge({ system: 'S', context: 'C', usage: { tokensIn: 0, tokensOut: 0 } });
    assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(sent.headers['x-api-key'], 'test');
    assert.deepEqual(sent.body.tool_choice, { type: 'auto' });
    assert.deepEqual(sent.body.output_config, { effort: 'low' });
    assert.ok(sent.body.max_tokens >= 4000);
    assert.match(sent.body.messages[0].content, /Werkzeug „moderate“/);
    assert.equal(sent.body.model, 'claude-sonnet-5-5');
    assert.equal(r.raw.narration, 'Hallo');
    assert.equal(r.tokensIn, 1200);
    await assert.rejects(m.judge({ system: 'S', context: 'C', usage: { tokensIn: 2100000, tokensOut: 0 } }), /Deckel/);
  } finally { globalThis.fetch = orig; }
});

test('Ohne Schlüssel: Übungsmodus', () => {
  assert.equal(createModerator({}).kind, 'mock');
});

test('Antwort ohne Werkzeug: Text wird Erzählung, gar nichts ist ein Fehler', () => {
  const r = readModeratorResponse({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Bertold hebt den Kopf.' }] });
  assert.equal(r.viaTool, false);
  assert.deepEqual(r.raw, { narration: 'Bertold hebt den Kopf.', scene_signal: 'continue' });
  assert.throws(() => readModeratorResponse({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens' }), /max_tokens/);
});

test('Denktiefe per .env einstellbar', async () => {
  let sent;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ content: [{ type: 'tool_use', name: 'moderate', input: { narration: 'x' } }], usage: {} }) }; };
  try {
    await createModerator({ ANTHROPIC_API_KEY: 't', TISCHLEITER_EFFORT: 'medium' }).judge({ system: 'S', context: 'C', usage: { tokensIn: 0, tokensOut: 0 } });
    assert.deepEqual(sent.output_config, { effort: 'medium' });
    await createModerator({ ANTHROPIC_API_KEY: 't', TISCHLEITER_EFFORT: 'default' }).judge({ system: 'S', context: 'C', usage: { tokensIn: 0, tokensOut: 0 } });
    assert.equal(sent.output_config, undefined);
  } finally { globalThis.fetch = orig; }
});
