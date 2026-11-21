// KI-Moderator: Claude über die Messages API (Tool-Use) oder ein einfacher Übungs-Moderator ohne Schlüssel.
import { TOOL } from './contract.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

export function createModerator(env = process.env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return mockModerator();
  return claudeModerator({
    key,
    model: env.TISCHLEITER_MODEL || 'claude-sonnet-5-5',
    maxTokensPerSession: Number(env.TISCHLEITER_TOKEN_DECKEL || 2000000),
  });
}

function claudeModerator({ key, model, maxTokensPerSession }) {
  return {
    kind: 'claude', model,
    async judge({ system, context, usage }) {
      if (usage.tokensIn + usage.tokensOut > maxTokensPerSession) {
        throw Object.assign(new Error('Token-Deckel erreicht'), { code: 'BUDGET' });
      }
      const started = Date.now();
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 900, system,
          tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
          messages: [{ role: 'user', content: context }],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL.name);
      if (!block) throw new Error('Keine Moderator-Antwort im Tool-Format');
      return {
        raw: block.input,
        latencyMs: Date.now() - started,
        tokensIn: data.usage?.input_tokens || 0,
        tokensOut: data.usage?.output_tokens || 0,
      };
    },
  };
}

// Übungs-Moderator: reagiert auf Schlüsselwörter. Für Tests und für Abende ohne API-Schlüssel.
export function mockModerator() {
  const has = (t, re) => re.test(t.toLowerCase());
  return {
    kind: 'mock', model: 'übungsmodus',
    async judge({ ctx }) {
      const last = ctx.lastUtterance;
      const text = last?.text || '';
      const target = ctx.characters.find((c) => c.playerId === last?.speakerId) || ctx.characters[0];
      const name = target?.name || 'ihr';
      const pid = target?.playerId;
      const out = { narration: '', scene_signal: 'continue' };

      const riddleOpen = (ctx.scene.riddles || []).find((r) => !(ctx.solvedRiddles || []).includes(r.id));
      const chest = (ctx.scene.chests || []).find((c) => !(ctx.openedChests || []).includes(c.id));
      const shopNpc = ctx.scene.shop?.npc;
      if (last && last.speakerId !== 'unklar' && ctx.riddle) {
        // Antwort auf das laufende Rätsel: der Server prüft gegen die Lösungswörter
        out.riddle_answer = { player_id: pid, answer: text, rating: 'falsch' };
        out.narration = `Hm, ${name}. Mal sehen, ob das stimmt.`;
      } else if (last && riddleOpen && has(text, /rätsel|frage|stell uns|wir hören/)) {
        out.riddle_start = riddleOpen.id;
        out.narration = 'Es wird still. Alle Augen richten sich auf euch.';
      } else if (last && chest && has(text, /truhe|kiste|öffne|aufmach|deckel/)) {
        const hasKey = chest.lock?.key && Object.values(ctx.inventories || {}).some((inv) => inv.items.some((i) => i.itemId === chest.lock.key));
        if (chest.lock && !hasKey) {
          out.narration = `Verschlossen, ${name}. Aber das Schloss ist alt.`;
          out.check = { player_id: pid, stat: chest.lock.stat, dc: chest.lock.dc, reason: chest.lock.text || 'Truhe aufbekommen',
            on_success: 'Es knackt. Der Deckel springt auf.', on_fail: 'Das Schloss hält. Noch.', open_chest_on_success: chest.id };
        } else {
          out.narration = `Der Deckel knarrt, ${name}. Schaut auf eure Handys.`;
          out.open_chest = chest.id;
        }
      } else if (last && shopNpc && has(text, /preis|billiger|rabatt|handel|verhandel|kauf|angebot/)) {
        const s2 = { begruendung: has(text, /weil|denn|damit/) ? 2 : 0, bezug: has(text, /du |dein|ihr |euer|dir /) ? 1 : 0, ton: has(text, /bitte|danke|ehre|meister/) ? 2 : 1 };
        out.argument = { player_id: pid, npc: shopNpc, ...s2, comment: 'Übungsmodus: Schlüsselwörter' };
        out.narration = 'Die Nebenfigur wiegt den Kopf und überlegt.';
      } else if (!last || last.speakerId === 'unklar') {
        out.narration = 'Das habe ich gehört, aber nicht, wer es war. Wer von euch spricht da?';
        out.ask_speaker = true;
      } else if (has(text, /wirtshaus|taverne|kneipe|schenke|gasthaus/)) {
        out.narration = `Warme Luft, Gelächter und der Geruch von Braten schlagen euch entgegen. Der Wirt hebt den Kopf. Was bestellst du, ${name}?`;
        out.audio = { bed: 'tavern', sfx: ['door_creak'] };
      } else if (has(text, /angreif|greif\w* .*\ban\b|kämpf|schlag|attack|zieh\w* (mein|das) schwert/) && ctx.scene.enemies?.length && !ctx.inFight) {
        const foe = ctx.world.enemies.find((e) => e.id === ctx.scene.enemies[0]);
        out.narration = `${foe?.name || 'Ein Gegner'} springt aus dem Schatten. Waffen frei! ${name}, du bist zuerst dran: Wähl dein Ziel auf dem Handy.`;
        out.combat = { start: [ctx.scene.enemies[0]] };
      } else if (has(text, /such|untersuch|schau|blick|horch|spur/)) {
        out.narration = `Du lässt den Blick wandern, ${name}. Irgendetwas stimmt hier nicht.`;
        out.check = { player_id: pid, stat: 'wahrnehmung', dc: 12, reason: 'Etwas Verborgenes entdecken',
          on_success: 'Da! Zwischen den Dingen liegt etwas, das vorher keiner gesehen hat.', on_fail: 'Nichts. Nur Schatten und das eigene Herzklopfen.',
          reveal_on_success: ctx.hiddenLoot.slice(0, 1) };
      } else if (has(text, /überzeug|frag|rede|verhandel|lüg|bitte/)) {
        out.narration = `Dein Gegenüber verschränkt die Arme, ${name}. Überzeug mich.`;
        out.check = { player_id: pid, stat: 'wort', dc: 13, reason: 'Überzeugen',
          on_success: 'Ein Seufzen, dann ein Nicken. Ihr bekommt, was ihr wollt.', on_fail: 'Ein kaltes Lächeln. Damit kommt ihr hier nicht weiter.' };
      } else if (has(text, /kletter|spring|schleich|renn|balancier/)) {
        out.narration = `Riskant, ${name}. Aber versuch es.`;
        out.check = { player_id: pid, stat: 'agilitaet', dc: 12, reason: 'Geschickt durchkommen',
          on_success: 'Leichtfüßig, als hättest du nie etwas anderes getan.', on_fail: 'Der Halt gibt nach, du schlägst hart auf.',
          fail_event: { class: 'U', severity: 'leicht' } };
      } else if (has(text, /weiter|gehen wir|aufbruch|los geht/)) {
        out.narration = 'Ihr brecht auf. Hinter euch schließt sich die Tür.';
        out.scene_signal = 'exit_1';
      } else {
        const anchor = ctx.scene.anchors[Math.floor(Math.random() * ctx.scene.anchors.length)];
        out.narration = `Gut. Dein Blick fällt dabei auf ${anchor}. Was machst du damit, ${name}?`;
      }
      return { raw: out, latencyMs: 5, tokensIn: 0, tokensOut: 0 };
    },
  };
}
