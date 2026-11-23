# HANDOFF — Tabula Gala (Tischleiter), Stand 21.11.2026, 16:00

> Neue Session: zuerst diese Datei, dann `docs/STAND.md`, dann `README.md`. Projektwissen claude.ai: Datei 08 (Handoff), 06 (Kernmechanik), 07 (Dev-Roadmap). Entscheidungen hier nicht neu diskutieren.

## Nachtrag 23.11.2026, 14:30: GMSB und „Ich spreche“
- **Name und Abgrenzung (Ul, 23.11.):** Die Spielleiter-Version heißt **GMSB · Gamemaster Soundboard** und ist eine eigenständige Version neben Tabula Gala (KI-Moderator). Tabelle in `docs/GMSB.md` (vorher `docs/SPIELLEITER.md`). Startseite „GMSB öffnen“, Route bleibt `/gm/<Code>`.
- **„Ich spreche“ repariert (KI-Modus):** (1) Tippen ging verloren, weil das Handy bei jeder Zustandsänderung neu zeichnet (im KI-Modus ständig) → Knopf reagiert jetzt auf Finger-runter/-hoch, auch über Neuzeichnen hinweg, mit sofortiger Anzeige und kurzer Vibration. (2) Wer tippte, während der Moderator sprach, verlor das Wort nach 12 s, obwohl das Mikro stumm war → Host meldet „Erzählstimme an/aus“, das Fenster läuft erst danach. (3) Lange Sätze: zählt jetzt der Satzbeginn, nicht das Satzende; Folgesätze bleiben 8 s beim selben Sprecher. (4) Abgelaufenes Wort wird an alle Handys gemeldet. 58 Tests grün.

## Nachtrag 23.11.2026: Spielleiter-Version, Schutz, Stimme
- **Spielleiter-Modus gebaut** (`/gm/<Code>`, Startseite „Spielleiter-Modus öffnen“): Klang auf Zuruf (Stichworte → Klang, lokal im Browser, Sperrzeit, „nur vorschlagen“), Soundboard mit eigenen Klängen (IndexedDB), Stichworte editierbar, optional Handys mit Probe, Fund/Truhe, LP, Rast; Mitschnitt nur mit Einwilligungs-Häkchen, rote Hinweise auf allen Handys, ohne Mitschnitt kein Wortlaut im Protokoll. Anleitung `docs/SPIELLEITER.md` (heute `docs/GMSB.md`). 55 Tests grün, Browser-Durchlauf Spielleitung + Handy ohne Fehler.
- **Wettbewerb (23.11.):** Effexiq (Browser, KI-Zuordnung, Preise geplant), Dungeon Cue (Windows, Stichworte, braucht Syrinscape, 4,99 $), Syrinscape (fertig vertonte Szenen). Unser Vorsprung: Deutsch, alles in einem System, Weg zum KI-Moderator und zu Editionen.
- **Schutz:** `LICENSE` (alle Rechte vorbehalten; Inhabername eintragen), `docs/SCHUTZ.md`, Entwurf `docs/TESTTISCH-VEREINBARUNG.md` (vor fremden Tischen anwaltlich prüfen, GO).
- **Stimme:** Optionen und Kosten in `docs/STIMME.md`. Gratis sofort: Chrome-Stimme „Google Deutsch“. Hörprobe gpt-4o-mini-tts / Gemini Flash TTS / ElevenLabs braucht Konto (GO).
- **Testtische:** zuerst Shenanigans, dann Stadtbibliothek Köln (Ul, 23.11.); E-Mails „bei Gelegenheit“.

## Nachtrag 21.11., 16:30: Übernahme erledigt
- Code liegt auf dem Mac in `~/Documents/tabula-gala`, `start.command` ausführbar, `.env` aus der Vorlage angelegt (Schlüssel leer). `start.command` meldet jetzt klar, wenn Node.js fehlt.
- Vault gepflegt: Dateien 08–11 in `02_PROJEKTE/tischleiter/` (alter Handoff → `HANDOFF_2026-11-20.md`), Rückverweise, INDEX. Master2do #236–242.
- Übernahme-Check: #1 (Claude-Teil), #3, #7 erledigt. Offen bei Ul: Node.js installieren und einmal starten, dann GO API-Konto und Schlüssel selbst in `.env`.

## Ziel
Januar-Version mit KI-Moderator für die erste Runde mit Familie und Freunden. Kein Testabend mit Ul als Moderator, vorher nur eine Generalprobe mit einer Person.

## Stand
- main, 39 Tests grün, Browser-Durchlauf Host + 2 Handys ohne Fehler (Übungsmoderator). Echte Claude-API noch nie angesprochen.
- Testabenteuer „Das Licht im Moor“: 3 Akte, 6 Szenen, aristotelisch, Rätsel, Schmied-Laden, Truhen, Drops. Geschichte = Claude-Entwurf, Ul darf ändern.
- Abenteuer auf Zuruf gebaut (Wünsche in der Lobby → Claude schreibt → Prüfer → Rückfall Testabenteuer), nur mit API-Schlüssel, nur gegen simulierte API getestet.
- Handplatz, Pfeile, Icons (game-icons.net, CC BY 3.0), 9 CC0-Klänge.

## Entscheidungen 21.11. (Ul)
- Keine Sprecher:in für Voicelines; die KI-Stimme übernimmt.
- Klänge herunterladen statt kaufen (CC0, notfalls CC BY). Tabletop Audio nicht ins Produkt.
- Trinkmodus (Glas) und Knetfiguren sind optionale Gimmicks: aus, nie Teil der Einführung.
- Feuerwaffen erst mit eigener Edition. Wort in der App: „Figur erstellen“.

## Host-Rechner
MacBook, macOS, Apple Silicon (laut Desktop-App, 21.11.). Spielordner `~/Documents/tabula-gala`. Vault: `~/Documents/ClaudeProjektbucket`.

## Übernahme-Check: wer macht was
| # | Aufgabe | Claude | Ul |
|---|---|---|---|
| 1 | Spiel auf den Mac | Code in einen freigegebenen Ordner legen (z. B. `~/Documents/tabula-gala`), Startdatei ausführbar machen | Node.js installieren (Installer von nodejs.org), Ordner freigeben, `start.command` doppelklicken (macOS fragt evtl. nach Erlaubnis) |
| 2 | API-Konto (GO, Geld) | `.env` vorbereiten, Seiten im Browser öffnen | Konto, Guthaben kaufen, Auto-Reload aus, Schlüssel erstellen und **selbst** in `.env` einfügen (Claude fasst echte Schlüssel nicht an) |
| 3 | Ordner freigeben | Freigabe anfragen (Vault + Spielordner) | Freigabe bestätigen |
| 4 | Klänge | über den eingebauten Browser herunterladen und einsortieren; jeder Download nur mit Uls OK | Freesound-Konto nur, falls Stimmengewirr gewünscht |
| 5 | Hardware | erledigt: Mac | Bluetooth-Box vorhanden? |
| 6 | Generalprobe | vorher KI-Probelauf mit simulierten Spielern gegen die echte API (kostet wenig Guthaben), Protokolle auswerten, Prompts schärfen | spielt mit einer Person Akt I |
| 7 | Master2do | Einträge selbst setzen, sobald der Vault freigegeben ist | – |

## Nächster Schritt
1. Ul gibt `~/Documents/ClaudeProjektbucket` und einen Spielordner frei. Claude legt den Code ab, pflegt die Master2do, legt Dateien 09–11 und diesen Handoff in `02_PROJEKTE/tischleiter/`.
2. Ul installiert Node.js und startet das Spiel einmal.
3. GO API-Konto → Ul fügt den Schlüssel ein → Claude macht den KI-Probelauf und stimmt ab.

## Offen
- Abenteuer-Autor und Moderator-Prompts gegen die echte API prüfen (Latenz, Kosten pro Abend messen und in STAND.md eintragen).
- `start.command` auf dem Mac ungetestet (Gatekeeper).
- Klänge `beds/tavern`, `beds/smithy`, `beds/dawn_yard` fehlen (Platzhalter laufen).
