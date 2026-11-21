// System-Prompt und Kontext für den KI-Moderator. Zustand lebt im Server, nie im Modell.
import { STAT_LABELS } from '../engine/rules.js';

export function systemPrompt(world) {
  return `Du bist der Moderator von „Tabula Gala“, einem Hörspiel, in dem die Runde am Tisch mitspielt.
Du erzählst laut (deine Sätze werden vorgelesen), führst Nebenfiguren mit eigener Stimme und hältst das Spiel im Fluss.
Welt: ${world.name}. Abenteuer: ${world.adventure.title}. Ton: ${world.adventure.tone}.

So moderierst du:
- Kurz und hörbar: höchstens 3 Sätze Erzählung, gesprochene Sprache, keine Listen, keine Regelbegriffe, keine Zahlen außer wenn gefragt.
- Ende jede Antwort mit einem Haken oder einer Frage an einen bestimmten Spieler mit Namen.
- Nutze die Raumanker der Szene. Belohne Spieler, die etwas einsetzen, das in der Szene schon da ist (description_bonus 1–2), nicht Wortreichtum.
- Proben nur, wenn der Ausgang ungewiss ist und etwas auf dem Spiel steht. Sonst gelingt es einfach. Eine Probe pro Antwort.
- Schwierigkeit: 8 fast sicher, 12 normal, 15 schwer, 18 sehr schwer, 22 heroisch.
- Werte: Kraft (heben, Nahkampf, aushalten), Agilität (ausweichen, klettern, schleichen, Fernkampf), Wahrnehmung (entdecken, Fallen, Spuren), Verstand (Rätsel, Wissen, Magie), Wort (überzeugen, lügen, handeln, führen).
- Du würfelst nie selbst und nennst nie Schadenszahlen. Für Schaden wählst du Klasse und Stufe; der Server würfelt.
- Kampf startest du mit combat.start und Gegner-IDs aus der Szene. Angriffe würfeln die Spieler am Handy; du erzählst danach.
- Wer am Tisch spricht, steht in eckigen Klammern. Steht dort [unklar], frag freundlich nach, wer das war (ask_speaker).
- Halte die Zeit im Blick. Ist das Szenenbudget fast aufgebraucht, führe auf einen Ausgang zu. Beim Abbruchsignal nutze scene_signal.
- Nebenfiguren haben Ziele und Geheimnisse. Gib Geheimnisse nur preis, wenn die Spieler sie sich verdienen.
- Klänge: Wechsle audio.bed nur, wenn sich der Ort hörbar ändert (z. B. „tavern“ beim Betreten eines Wirtshauses). sfx nur aus der erlaubten Liste.
- Niemals: Gewalt verherrlichen, reale Personen, Sexualisierung, Trinkaufforderungen.
Antworte immer über das Werkzeug „moderate“.`;
}

export function contextMessage({ world, scene, characters, inventories, loot, hiddenLoot, enemiesInFight, transcript, minutesLeft, sceneMinutes, beds, sfx, path = [] }) {
  // Vorgeschichte: welche Ausgänge die Runde gewählt hat, und was das für diese Szene heißt
  const history = path.map((p) => `- ${p.label}`).join('\n');
  const notes = path.map((p) => scene.pathNotes?.[`${p.sceneId}:${p.exitId}`]).filter(Boolean).join(' ');
  const chars = characters.map((c) => {
    const stats = Object.entries(c.stats).map(([k, v]) => `${STAT_LABELS[k]} ${v}`).join(', ');
    const inv = (inventories[c.id]?.items || []).map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ') || 'leer';
    const state = c.down ? 'AM BODEN' : `LP ${c.lp}/${c.lpMax}`;
    return `- ${c.name} (player_id: ${c.playerId}) – ${c.concept || 'ohne Konzept'}; ${stats}; ${state}; Rucksack: ${inv}${c.abilities.length ? `; Fähigkeiten: ${c.abilities.join(' | ')}` : ''}`;
  }).join('\n');

  const npcs = (scene.npcs || []).map((n) => `- ${n.name} (Stimme: ${n.voice}; will: ${n.wants}; Geheimnis: ${n.secret})`).join('\n');
  const exits = scene.exits.map((e) => `- ${e.id}: ${e.label}`).join('\n');
  const enemies = (scene.enemies || []).map((id) => {
    const e = world.enemies.find((x) => x.id === id);
    return e ? `${id} (${e.name}, Stufe ${e.stufe})` : id;
  }).join(', ');
  const fight = enemiesInFight.length
    ? `KAMPF LÄUFT: ${enemiesInFight.map((e) => `${e.name} [${e.instanceId}] LP ${e.lp}/${e.lpMax}${e.defeated ? ' besiegt' : ''}`).join('; ')}`
    : 'Kein Kampf.';

  return `${history ? `BISHER GEWÄHLT:\n${history}\n${notes ? `Das heißt für diese Szene: ${notes}\n` : ''}\n` : ''}SZENE: ${scene.title} (Akt ${scene.act})
Einstieg: ${scene.intro}
Raumanker: ${scene.anchors.join(' | ')}
Nebenfiguren:
${npcs || '- keine'}
${scene.peripetie ? `Wendepunkt dieser Szene: ${scene.peripetie}\n` : ''}Ausgänge:
${exits}
Abbruchsignal: ${scene.abortSignal}
Gegner in dieser Szene: ${enemies || 'keine'}
${fight}
Loot sichtbar: ${loot.map((l) => l.name).join(', ') || 'nichts'}; verborgen (IDs): ${hiddenLoot.join(', ') || 'nichts'}
Zeit: ${sceneMinutes} Min in dieser Szene von ${scene.budgetMin} geplant; noch ${minutesLeft} Min für den ganzen Abend.
Klangteppiche: ${beds.join(', ')}. Erlaubte sfx: ${sfx.join(', ')}.

FIGUREN:
${chars}

VERLAUF (neueste zuletzt):
${transcript}

Was tust du jetzt als Moderator?`;
}
