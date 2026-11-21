# HANDOFF — Tabula Gala (Tischleiter), Stand 21.11.2026, 16:00

> Neue Session: zuerst diese Datei, dann `docs/STAND.md`, dann `README.md`. Projektwissen claude.ai: Datei 08 (Handoff), 06 (Kernmechanik), 07 (Dev-Roadmap). Entscheidungen hier nicht neu diskutieren.

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
MacBook, macOS, Apple Silicon (laut Desktop-App, 21.11.). Kein Ordner verbunden. Vault: `~/Documents/ClaudeProjektbucket`.

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
