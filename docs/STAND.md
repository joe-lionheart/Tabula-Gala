# Stand und Weg zur Januar-Version

Stand: 21.11.2026. Ziel: Die erste Runde mit dem KI-Moderator ist das fertige Produkt für Familie und Freunde (kein Testabend mit Ul als Moderator, Entscheidung Ul 21.11.).

## Fertig (v0.1, getestet)

- Regeln nach Kernmechanik v0.5: 5 Werte, Erschaffung 12 Punkte, Probe mit Fehlschlag, Erfolg mit Preis, Erfolg, stark, kritisch, Patzer; Beschreibungsbonus; Synergie (in der Engine); Schadensklassen K, F, U, Z; Kampf mit einem Wurf pro Austausch; 0 LP = am Boden; Rast, Trank, Verband; Meilenstein
- Rucksack 4×4 mit Verschieben, Stapeln, Geben, Ablegen, Benutzen (auch für andere)
- Runde eröffnen, QR-Code, Beitritt per Handy-Browser, Figurenbau, Live-Abgleich aller Geräte
- KI-Moderator über Claude (Tool-Use, Validierung, Token-Deckel, Latenzfüller) und ein Übungsmodus ohne Schlüssel
- Tisch-Mikro im Host-Laptop (Chrome/Edge), „Ich spreche“ antippen, Nachfrage bei unklarem Sprecher, Text als Ausweg
- Erzählstimme mit eigener Stimmfarbe je Nebenfigur; Mikro pausiert, solange der Moderator spricht
- **Sound-Automatik:** Szenen-Teppiche mit Überblendung, Kampf-Teppich, Würfel-, Schwung-, Treffer-, Paraden-, Krit-, Patzer-, Heil- und Loot-Klänge je nach Waffe und Ergebnis; Ducking unter der Stimme; synthetische Platzhalter, solange Dateien fehlen
- Abenteuer „Nachtstück 1: Das Licht im Moor“ (Klassische Fantasy): 3 Szenen mit je 3 Ausgängen, Wendepunkt, 4 Gegner, 15 Gegenstände, 8 Fähigkeiten
- Protokoll jeder Runde für die spätere Auswertung

## Bis Januar

| # | Was | Wer | Braucht |
|---|---|---|---|
| 1 | Claude-API-Schlüssel mit Ausgabedeckel anlegen, Moderator mit echter KI durchspielen, Prompt schärfen | Ul legt Konto an, Claude stimmt ab | GO (Kosten) |
| 2 | Echte Klänge: Geräusche aus Sonniss-Paketen zuordnen, lizenzfreie Tavernen-, Moor- und Kapellenmusik | Claude sucht, Ul lädt herunter, oder Freelancer | ggf. GO |
| 3 | Bessere Erzählstimme (Cloud-TTS, Deutsch) als Option neben der Browserstimme | Claude | GO (Kosten pro Abend) |
| 4 | Feinschliff Handy: größere Würfeltasten, Vibration, Wiederbeitritt nach Sperrbildschirm | Claude | – |
| 5 | Generalprobe: Ul und eine Person spielen eine Szene mit echter KI (kein Moderieren nötig) | Ul | – |
| 6 | Zweites Abenteuer oder längerer Akt II, damit ein ganzer Abend trägt | Claude entwirft, Ul gibt frei | – |
| 7 | Code-Durchsicht (Sicherheit, Stabilität) vor der ersten fremden Runde (21.02.2027) | Freelancer | GO |

## Wofür sich Freelancer lohnen

Den Kern (Server, Regeln, KI, Oberfläche) baut Claude. Einkaufen lohnt sich dort, wo Handwerk oder Rechte gefragt sind:

| Paket | Plattform | Wann |
|---|---|---|
| Musik und Klangteppiche (Wirtshaus, Moor, Kapelle, Kampf), mit schriftlicher Nutzungslizenz | Fiverr | jetzt, für Januar |
| Deutsche:r Sprecher:in für die häufigsten 50 Moderator-Sätze (Voicelines) | Fiverr | nach den ersten Runden, wenn das Protokoll zeigt, welche Sätze oft kommen |
| UI/UX-Feinschliff der Handy-Oberfläche (Figma) | Fiverr oder Upwork | nach der ersten Runde mit Familie |
| Code-Review Node/WebSocket (Sicherheit) | Upwork | vor dem 21.02.2027 |
| App-Store-Hülle (Capacitor) und Einreichung | Upwork | nach der Beta |
| Sprechertrennung am Tisch (Audio/ML) | Upwork | wenn die Grundversion trägt |
