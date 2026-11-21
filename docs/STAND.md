# Stand und Weg zur Januar-Version

Stand: 21.11.2026, 16 Uhr. Ziel: Die erste Runde mit dem KI-Moderator ist das fertige Produkt für Familie und Freunde (kein Testabend mit Ul als Moderator, Entscheidung Ul 21.11.).

## Fertig (getestet: 39 Tests, Browser-Durchlauf Host + 2 Handys)

**Regeln** nach Kernmechanik v0.5: 5 Werte, 12 Punkte, Probe mit Fehlschlag, Preis, Erfolg, stark, kritisch, Patzer; Beschreibungsbonus; Synergie (Engine); Schadensklassen K, F, U, Z; Kampf mit einem Wurf pro Austausch; 0 LP = am Boden; Rast, Trank, Verband.

**Akte:** Zwischen zwei Akten rasten alle (+40 LP) und wählen am Handy +1 Wert oder eine Fähigkeit. Danach geht es von selbst weiter, oder der Host drückt „Weiter“. Am Ende wird die Figur nur gespeichert.

**Rätsel:** Der Moderator stellt sie, die Runde antwortet laut. Die KI wertet „richtig / nah / falsch“, aber das Lösungswort aus der Abenteuerdatei schlägt die KI immer. Bei „nah“ gibt es eine Verstand-Probe zum Nachbessern. Jede falsche Antwort kostet 5 Minuten (nicht LP), nach 2 Fehlversuchen kommt ein Hinweis, nach 5 verfällt das Rätsel.

**Verhandeln:** Argumentationsprobe mit Begründung, Bezug aufs Gegenüber und Ton, je 0–2 Punkte; Wort ab 4 gibt +1. Ab 5 Punkten −50 %, ab 3 Punkten −25 %, 1–2 Punkte Listenpreis, 0 Punkte keine Ware. Gekauft wird am Handy mit Silber aus dem Rucksack.

**Loot:** Gegner lassen ihre Beute fallen, sobald sie besiegt sind. Truhen sind offen, mit Probe verschlossen oder mit Schlüssel zu öffnen. Alle Handys melden sich (Ton und Vibration), alle sehen alles, wer zuerst tippt und Platz hat, bekommt es.

**Rucksack:** Raster 4×4 plus ein Platz in der Hand, der keinen Rucksackplatz belegt. Kurzwaffen belegen 1 Feld, Langwaffen 2. Der Bogen verbraucht Pfeile. Icons von game-icons.net.

**Abenteuer auf Zuruf:** Handys und Host schicken Wünsche, und der Moderator schreibt während der Figurenerstellung das Abenteuer, aristotelisch mit Rätseln, Laden und Truhen. Ein Prüfer kontrolliert jedes Feld, bei Fehlern gibt es eine Nachbesserungsrunde, sonst springt das Testabenteuer ein. Das geht nur mit API-Schlüssel.

**Testabenteuer** „Das Licht im Moor“, 3 Akte, 6 Szenen, ca. 140 Minuten:

| Akt | Szene | Bogen |
|---|---|---|
| I | Wirtshaus „Zum Krummen Kessel“ | Anfang |
| I | Grimbarts Schmiede: Laden, Glocken-Rätsel, Kiste | steigende Handlung |
| I | Moorpfad: Falle, Karrenkiste, Kampf | steigende Handlung |
| II | Versunkene Kapelle: Lene ist freiwillig fort | Wendepunkt |
| II | Weideninsel: Rätsel der Muhme, der gestohlene Klöppel | Erkenntnis |
| III | Glocke im Morgengrauen: Bertold war dabei, 3 Enden | Lösung |

Lehre: Verschwiegene Schuld steigt wie Moorwasser. Erst wer zurückgibt, was er genommen hat, wird frei.

**Handy:** Große Würfeltasten, die Probe steht oben, ein Tipp zählt nur einmal. Vibration plus Ton (auch fürs iPhone). Nach dem Sperrbildschirm verbindet es sofort neu, bei Verbindungsverlust erscheint ein Hinweis. Wer mit gleichem Namen beitritt, bekommt seinen alten Platz. Nachzügler können eine Figur erstellen.

**Server:** Ein Herzschlag erkennt tote Verbindungen. Nach einem Absturz kommen offene Runden aus `state.json` zurück, auch mit einem erzeugten Abenteuer.

**Klang:** Die Sound-Automatik spielt bei Szene, Kampf, Probe, Loot, Rätsel und Kauf. 9 echte CC0-Effekte sind drin, der Rest ist Platzhalter. Download-Liste: `docs/KLAENGE.md`.

## Entscheidungen 21.11. (nicht neu verhandeln)

- Keine Sprecher:in für Voicelines; häufige Sätze später mit der KI-Stimme vorrendern.
- Musik und Klänge werden heruntergeladen (CC0, notfalls CC BY), nicht gekauft. Tabletop Audio nicht ins Produkt (nur nichtkommerziell frei).
- **Trinkmodus (Glas) und Knetfiguren sind optionale Gimmicks**: standardmäßig aus, nicht in der Erklärung für Neulinge, nicht im Figurenerstellen.
- Feuerwaffen und Kugeln erst mit einer eigenen Edition.
- Icons: game-icons.net (CC BY 3.0, Nennung). Eigener Stil später ggf. durch Illustrator:in.

## Bis Januar

| # | Was | Wer | Braucht |
|---|---|---|---|
| 1 | Claude-API-Schlüssel mit Ausgabedeckel, echten Moderator und Abenteuer auf Zuruf durchspielen, Prompts schärfen | Ul legt Konto an, Claude stimmt ab | **GO (Kosten)** |
| 2 | Klänge herunterladen nach `docs/KLAENGE.md` (ca. 15 Min) | Ul | – |
| 3 | Bessere Erzählstimme (Cloud-TTS, Deutsch) als Option | Claude | GO (Kosten pro Abend) |
| 4 | Generalprobe: Ul und eine Person, ein Akt mit echter KI | Ul | nach #1 |
| 5 | Code-Durchsicht (Sicherheit) vor der ersten fremden Runde (21.02.2027) | Freelancer | GO |

## Wofür sich Freelancer lohnen

| Paket | Plattform | Wann |
|---|---|---|
| UI/UX-Feinschliff der Handy-Oberfläche, eigener Icon-Stil | Fiverr oder Upwork | nach der ersten Runde mit Familie |
| Code-Review Node/WebSocket (Sicherheit) | Upwork | vor dem 21.02.2027 |
| App-Store-Hülle (Capacitor) und Einreichung | Upwork | nach der Beta |
| Sprechertrennung am Tisch (Audio/ML) | Upwork | wenn die Grundversion trägt |
