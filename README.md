# Tabula Gala – die Rollenspielleiter

Das Hörspiel, in dem ihr mitspielt. Ein KI-Moderator erzählt, führt die Nebenfiguren und spielt Klänge ein. Die Runde sitzt am Tisch, redet einfach und würfelt am Handy.

Interner Projektname: Tischleiter. Regeln: Kernmechanik v0.5 (Projektwissen, Datei 06).

## So läuft ein Abend

1. Der **Host-Laptop** steht in der Tischmitte. Er hört zu (Mikro), erzählt (Lautsprecher) und spielt die Klänge.
2. Alle anderen scannen den **QR-Code** mit dem Handy. Keine App, keine Installation.
3. Jede:r erstellt am Handy eine Figur (12 Punkte auf 5 Werte, Ausrüstung wählen).
4. Der Moderator eröffnet die Szene. Ihr sprecht einfach.
   Wer anfängt zu reden, tippt **einmal kurz „Ich spreche“** auf dem Handy, nicht festhalten. Ist unklar, wer gesprochen hat, fragt der Moderator nach.
5. Verlangt der Moderator eine Probe, vibriert das Handy der Person. Echten W20 werfen und die Zahl tippen, oder das Handy würfeln lassen.
6. Im Kampf: Gegner antippen, Waffe wählen, würfeln. Schwung, Treffer, Parade und Fanfare spielen automatisch.

## Starten (Host-Laptop)

Voraussetzung: [Node.js 22 oder neuer](https://nodejs.org) und Google Chrome oder Microsoft Edge.

```bash
npm install
npm start
```

Unter Windows geht auch ein Doppelklick auf `start.bat`, auf dem Mac auf `start.command`.

Dann im Browser auf dem Laptop **http://localhost:3000** öffnen und „Runde eröffnen“ wählen. Die Handys müssen im **selben WLAN** sein.

### KI-Moderator einschalten

Ohne Schlüssel läuft der **Übungsmodus**: ein einfacher Moderator, der auf Schlüsselwörter reagiert. Er reicht zum Testen der Abläufe.

Für den echten Moderator `.env.example` nach `.env` kopieren und den Claude-API-Schlüssel eintragen:

```
ANTHROPIC_API_KEY=sk-ant-...
TISCHLEITER_MODEL=claude-sonnet-5-5
TISCHLEITER_TOKEN_DECKEL=2000000
```

Der Token-Deckel gilt pro Runde. Ist er erreicht, schaltet die KI ab und der Host kann von Hand weitermachen. Verbrauch und Antwortzeit stehen links im Host-Fenster.

## Klänge

Die Klangliste steht in `public/audio/manifest.json`. Fehlt eine Datei, spielt der Host einen synthetischen Platzhalter. Das Spiel läuft also sofort, klingt mit echten Dateien aber viel besser.

Echte Dateien legst du unter `public/audio/` ab, zum Beispiel `public/audio/beds/tavern.ogg` oder `public/audio/sfx/sword_hit.ogg`. Die Namen stehen im Manifest.

| Was | Wann | Wer löst aus |
|---|---|---|
| Klangteppich (Wirtshaus, Moor, Kapelle, Kampf) | Szenenwechsel, Kampfbeginn und -ende | Spiel, automatisch |
| Würfel, Schwung, Treffer, Parade, Krit, Patzer, Heilung, Loot | jede Probe, jeder Angriff | Spiel, automatisch (0 ms) |
| freie Wechsel („wir gehen ins Wirtshaus“), Türen, Glocke | wenn die Geschichte es verlangt | KI-Moderator, nur aus der erlaubten Liste der Szene |

Beim Vorlesen wird der Teppich automatisch leiser (Ducking). Solange der Moderator spricht, hört das Mikro nicht zu, damit er sich nicht selbst hört.

## Aufbau

```
server/
  engine/     Regeln (Kernmechanik v0.5): Würfel, Probe, Schaden, Kampf, Heilung, Rucksack. Ohne KI, getestet.
  game/       Eine Runde: Zustand, Abläufe, Sichten für Host und Handys
  audio/      Sound-Regie: Spielereignis → Klang
  llm/        KI-Vertrag (Tool-Use), Validierung, Prompt, Claude + Übungsmodus
  index.js    Webserver, WebSocket, QR-Code
content/      Welten und Abenteuer (JSON). Erste Welt: Klassische Fantasy, „Nachtstück 1: Das Licht im Moor“
public/       Host-Oberfläche (host.html), Handy (join.html), Klang, Stimme
test/         npm test
data/         Protokolle jeder Runde (state.json, log.jsonl), nicht im Repo
```

Grundsätze (Dev-Roadmap):
- **Die KI entscheidet nichts mechanisch.** Sie wählt Probe, Schwierigkeit, Schadensklasse und Klang aus Katalogen. Der Server würfelt, prüft und bucht.
- **Der Spielzustand lebt im Server**, nie im Modell. Jede Antwort der KI wird validiert, unbekannte IDs werden verworfen und protokolliert.
- **Alles wird protokolliert** (`data/sessions/<datum>_<code>/log.jsonl`): jede Äußerung, jedes KI-Urteil, jeder Wurf, jeder Klang. Daraus entstehen später die Voicelines.

## Tests

```bash
npm test                 # Regeln, Spielablauf, KI-Vertrag
node scripts/smoke.mjs   # Server + Host + zwei Handys über WebSocket
```

## Bekannte Grenzen (Stand 21.11.2026)

- **Spracherkennung:** Chrome und Edge schicken das Audio zur Erkennung an den Browser-Hersteller (Google bzw. Microsoft). Für den Start reicht das. Später kommt eine eigene Erkennung (Deepgram oder lokal), dann bleibt das Audio im Haus.
- **Stimme:** Die Vorlesestimme des Browsers klingt brauchbar, aber nicht wie ein Hörspiel. Eine bessere Stimme folgt.
- **Sprechertrennung:** bewusst noch nicht drin. Bis dahin gilt: kurz antippen.
- Das Mikro funktioniert auf dem Host-Laptop ohne HTTPS, weil `localhost` als sicher gilt. Die Handys brauchen kein Mikro.
