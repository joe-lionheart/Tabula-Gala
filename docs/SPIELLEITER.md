# Spielleiter-Modus

Ein Mensch leitet wie immer, in jedem Rollenspielsystem. Die App liefert den Klang und auf Wunsch die Mechanik über die Handys. Keine KI, keine API-Kosten.

## Starten
1. `start.command` doppelklicken, Chrome öffnet `http://localhost:3000`.
2. **„Spielleiter-Modus öffnen“** wählen.
3. **„Ton einschalten“** antippen (Browser-Regel: Ton erst nach einem Klick).

## Klang auf Zuruf
- **„Zuhören: an“**: Die App hört über das Laptop-Mikro mit und erkennt Stichworte. „Die Glocke schlägt“ spielt die Glocke, „ihr betretet das Wirtshaus“ wechselt den Teppich.
- **Sofort abspielen** aus: Die App schlägt nur vor („»Wolf« → Wolfsgeheul ▶“), du entscheidest per Tipp.
- **Sperrzeit:** Derselbe Klang kommt höchstens alle 8 Sekunden, pro Satz höchstens ein Teppichwechsel und zwei Effekte.
- **Stichworte bearbeiten:** Pro Klang eigene Wörter (Komma getrennt). Ab 4 Buchstaben genügt der Wortanfang. Gespeichert in diesem Browser.
- Spracherkennung: Chrome oder Edge. Chrome schickt das Audio dafür an Google-Server. Die App selbst speichert nichts davon, außer der Mitschnitt ist an.
- Zum Ausprobieren ohne Mikro: in der Browser-Konsole `tgHear('Die Tür knarrt')`.

## Soundboard
- Teppiche (Orte, Stimmung) und Effekte per Taste.
- **Eigene Klänge:** Häkchen „eigene Klänge zuordnen“, Taste antippen, Audiodatei wählen. Die Datei bleibt im Browser dieses Rechners (IndexedDB), nichts wird hochgeladen. Gestrichelte Taste = eigener Klang. Nochmal antippen = zurück zum Standard.

## Handys und Mechanik (optional)
- QR-Code scannen lassen, „Figuren erstellen“, „Spiel starten“.
- **Probe:** Figur, Wert, Schwierigkeit (5–25), wofür. Das Handy würfelt oder nimmt den echten W20.
- **Fund oder Truhe:** Gegenstände aus dem Katalog sammeln, Beschriftung („Truhe im Keller“), „Auf die Handys“. Wer zuerst tippt und Platz hat, bekommt es.
- **Lebenspunkte:** Schaden oder Heilung, Betrag bestimmst du. **Rast:** alle +40 LP.

## Mitschnitt (nur mit Einwilligung)
- Standard: aus. Dann werden nur Spielereignisse protokolliert (welcher Klang, welcher Wurf), kein Wortlaut.
- Einschalten nur, wenn **alle am Tisch** Bescheid wissen und zustimmen (Häkchen ist Pflicht). Alle Handys zeigen dann einen roten Hinweis.
- Gespeichert werden dann: was die Erkennung von der Spielleitung verstanden hat und welche Klänge dazu liefen, in `data/sessions/<Datum>_<Code>/log.jsonl` auf diesem Rechner.
- „Abend beenden“ schaltet den Mitschnitt automatisch ab.
- Zweck: Der KI-Moderator lernt aus echten Spielleitungen (Beispiele und Prüffälle), wann welcher Klang passt.
