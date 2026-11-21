import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModerator } from '../server/llm/moderator.js';

test('Claude-Moderator: Anfrage mit Tool-Zwang, Antwort aus tool_use', async () => {
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
    assert.deepEqual(sent.body.tool_choice, { type: 'tool', name: 'moderate' });
    assert.equal(sent.body.model, 'claude-sonnet-5-5');
    assert.equal(r.raw.narration, 'Hallo');
    assert.equal(r.tokensIn, 1200);
    await assert.rejects(m.judge({ system: 'S', context: 'C', usage: { tokensIn: 2100000, tokensOut: 0 } }), /Deckel/);
  } finally { globalThis.fetch = orig; }
});

test('Ohne Schlüssel: Übungsmodus', () => {
  assert.equal(createModerator({}).kind, 'mock');
});
