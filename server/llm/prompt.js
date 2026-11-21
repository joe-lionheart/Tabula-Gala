// System-Prompt und Kontext für den KI-Moderator. Zustand lebt im Server, nie im Modell.
import { STAT_LABELS } from '../engine/rules.js';

// Aristotelischer Bogen: Anfang, Mitte, Ende
const ARC = {
  exposition: 'Anfang: Welt, Figuren und Auftrag zeigen. Fragen wecken, noch nichts auflösen.',
  steigerung: 'Steigende Handlung: Hindernisse wachsen, ein erster Preis wird gezahlt.',
  peripetie: 'Wendepunkt: Was die Runde zu wissen glaubte, kippt ins Gegenteil.',
  erkenntnis: 'Erkenntnis (Anagnorisis): Wer was getan hat und warum, wird klar. Die Spieler sollen selbst draufkommen.',
  loesung: 'Lösung: Die Entscheidung der Runde trägt Folgen. Ende mit Gefühl, ohne Moralpredigt.',
};

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
- Rätsel: Stelle ein Rätsel der Szene mit riddle_start, wenn die Runde an seiner Stelle ankommt (der Server lässt die Figur die Frage wörtlich stellen, du wiederholst sie nicht). Jede Antwort auf ein laufendes Rätsel wertest du mit riddle_answer: richtig, nah (richtige Richtung) oder falsch. Nenne die Lösung nie selbst. Bei „nah“ würfelt der Server eine Verstand-Probe zum Nachbessern, du verlangst keine eigene.
- Verhandeln: Will jemand etwas von einer Nebenfigur (Preis, Gefallen, Auskunft gegen Widerstand), werte das Gesagte als argument: begruendung, bezug (auf das, was die Figur will) und ton je 0–2. Streng, aber fair: Wer nur „bitte“ sagt, bekommt 0–1. Danach antwortet die Nebenfigur passend zum Ergebnis. Preise und Rabatte rechnet der Server.
- Loot: Öffnen die Spieler eine Truhe der Szene, nutze open_chest. Ist sie verschlossen, verlange eine Probe mit open_chest_on_success. Was Gegner fallen lassen, verteilt der Server von selbst. Wer zuerst am Handy tippt, bekommt es; du musst nichts verteilen.
- Erzählbogen: Halte dich an die Rolle der Szene im Ganzen (Anfang, Wendepunkt, Erkenntnis, Lösung). Am Ende soll die Runde etwas verstanden haben, ohne dass du es predigst.
- Klänge: Wechsle audio.bed nur, wenn sich der Ort hörbar ändert (z. B. „tavern“ beim Betreten eines Wirtshauses). sfx nur aus der erlaubten Liste.
- Niemals: Gewalt verherrlichen, reale Personen, Sexualisierung, Trinkaufforderungen.
Antworte immer über das Werkzeug „moderate“.`;
}

export function contextMessage({ world, scene, characters, inventories, loot, hiddenLoot, enemiesInFight, transcript, minutesLeft, sceneMinutes, beds, sfx, path = [], riddle = null, solvedRiddles = [], deals = {}, openedChests = [], silver = {} }) {
  // Vorgeschichte: welche Ausgänge die Runde gewählt hat, und was das für diese Szene heißt
  const history = path.map((p) => `- ${p.label}`).join('\n');
  const notes = path.map((p) => scene.pathNotes?.[`${p.sceneId}:${p.exitId}`]).filter(Boolean).join(' ');
  const chars = characters.map((c) => {
    const stats = Object.entries(c.stats).map(([k, v]) => `${STAT_LABELS[k]} ${v}`).join(', ');
    const inv = (inventories[c.id]?.items || []).map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ') || 'leer';
    const state = c.down ? 'AM BODEN' : `LP ${c.lp}/${c.lpMax}`;
    return `- ${c.name} (player_id: ${c.playerId}, Silber ${silver[c.playerId] ?? 0}) – ${c.concept || 'ohne Konzept'}; ${stats}; ${state}; Rucksack: ${inv}${c.abilities.length ? `; Fähigkeiten: ${c.abilities.join(' | ')}` : ''}`;
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

  const riddles = (scene.riddles || []).filter((r) => !solvedRiddles.includes(r.id))
    .map((r) => `- ${r.id} (stellt: ${r.npc || 'Erzähler'}; wann: ${r.when || 'wenn es passt'}): „${r.question}“ Lösung: ${(r.answers || []).join(' / ')}${r.near?.length ? `; nah dran: ${r.near.join(', ')}` : ''}`).join('\n');
  const running = riddle ? `RÄTSEL LÄUFT: ${riddle.id}, ${riddle.attempts} Fehlversuche${riddle.hintGiven ? ', Hinweis gegeben' : ''}. Jede Antwort darauf mit riddle_answer werten.` : '';
  const chests = (scene.chests || []).filter((c) => !openedChests.includes(c.id))
    .map((c) => `- ${c.id}: ${c.label}${c.lock ? ` (verschlossen: ${c.lock.text || ''} Probe ${c.lock.stat} DC ${c.lock.dc}${c.lock.key ? `, oder ohne Probe mit Gegenstand ${c.lock.key}` : ''})` : ''}`).join('\n');
  const shop = scene.shop ? `LADEN von ${scene.shop.npc}: ${scene.shop.items.map((e) => `${world.items.find((i) => i.id === e.item)?.name || e.item} ${e.price} Silber`).join(', ')}. Die Spieler kaufen am Handy.` : '';
  const dealLines = Object.values(deals).map((d) => `${d.npc}: ${d.label}`).join('; ');
  const lesson = world.adventure.lesson && scene.arc === 'loesung' ? `Lehre des Abenteuers (nicht aussprechen, erleben lassen): ${world.adventure.lesson}\n` : '';
  return `${history ? `BISHER GEWÄHLT:\n${history}\n${notes ? `Das heißt für diese Szene: ${notes}\n` : ''}\n` : ''}SZENE: ${scene.title} (Akt ${scene.act})
Einstieg: ${scene.intro}
Raumanker: ${scene.anchors.join(' | ')}
Nebenfiguren:
${npcs || '- keine'}
${scene.peripetie ? `Wendepunkt dieser Szene: ${scene.peripetie}\n` : ''}Ausgänge:
${exits}
Abbruchsignal: ${scene.abortSignal}
${scene.arc ? `Rolle im Erzählbogen: ${ARC[scene.arc] || scene.arc}\n` : ''}${lesson}${riddles ? `Rätsel dieser Szene:\n${riddles}\n` : ''}${running ? `${running}\n` : ''}${chests ? `Truhen:\n${chests}\n` : ''}${shop ? `${shop}\n` : ''}${dealLines ? `Verhandelt: ${dealLines}\n` : ''}
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
