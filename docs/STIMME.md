# Lebendigere Erzählstimme (Stand 23.11.2026)

Anlass: Ul fand die Moderatorstimme in der ersten Runde zu monoton. Heute spricht die Vorlesestimme des Browsers bzw. des Macs (Web Speech API, kostenlos, ohne Betonungssteuerung).

## Menge pro Abend (Schätzung)
Ein Abend mit 4 Spielern: 150–250 Moderator-Antworten à ca. 300 Zeichen ≈ 45.000–75.000 Zeichen ≈ 50–75 Minuten gesprochene Sprache (Deutsch ca. 1.000 Zeichen pro Minute).

## Optionen

| Option | Ausdruck | Kosten | Kosten pro Abend (Schätzung) | Haken |
|---|---|---|---|---|
| **Sofort, gratis:** bessere System-/Browserstimme | gering | 0 € | 0 € | In Chrome „Google Deutsch“ wählen oder am Mac eine Premium-Stimme laden (Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte → Systemstimme → Stimmen verwalten). Bleibt eher flach. |
| **OpenAI gpt-4o-mini-tts** | steuerbar per Anweisung („erzähle wie ein Hörspielsprecher, flüstere bei Spannung“) | 0,60 $/1 Mio. Text-Tokens + 12 $/1 Mio. Audio-Tokens, laut OpenAI-Community ca. 1,5 US-Cent pro Minute | ca. 0,75–1,15 $ | Eigenes OpenAI-Konto; Stimmen klingen auf Deutsch leicht englisch gefärbt (vorher testen) |
| **Google Gemini 3.8 Flash TTS** (Vorabversion) | steuerbar per Text-Prompt | bis 31.12.2026: 9 $/1 Mio. Audio-Tokens, ab 01.01.2027: 18 $/1 Mio.; 25 Audio-Tokens pro Sekunde ≈ 2,7 US-Cent pro Minute ab Januar | ca. 1,35–2 $ ab Januar | Google-Cloud-Konto; Vorabversion (kann sich ändern) |
| **ElevenLabs** (v3/v4) | am ausdrucksstärksten (Emotions-Tags), viele deutsche Stimmen, Stimmklon möglich | ca. 0,08–0,10 $ pro 1.000 Zeichen; Gratis-Stufe 10.000 Zeichen/Monat | ca. 3,60–7,50 $ | Teuerste Option; für Spielleiter-Editionen mit Stimmklon ohnehin der Kandidat |

Zum Vergleich: Der KI-Moderator selbst kostet ca. 3–5,50 $ pro Abend.

## Technik (für alle Cloud-Optionen gleich)
- Server erzeugt Audio pro Satz und streamt es an den Host; der Host spielt es über den Klang-Motor (Ducking bleibt).
- Satzweise vorrendern, während der nächste Satz entsteht, damit keine Pausen entstehen (Mehr-Latenz ca. 0,5–1,5 s pro erstem Satz).
- Häufige Sätze („Was tust du?“, Begrüßung, Akt-Pausen) einmal vorrendern und zwischenspeichern (Entscheidung 21.11.).
- Nebenfiguren bekommen eigene Stimmen oder eigene Stil-Anweisungen.
- Rückfall auf die Browserstimme, wenn der Dienst nicht antwortet oder das Budget erreicht ist.

## Vorschlag
1. **Heute, gratis:** In Chrome die Stimme „Google Deutsch“ ausprobieren (Auswahl links im Host unter „Stimme“).
2. **Hörprobe (GO, wenige Cent):** Dieselben 5 Sätze aus dem Moor mit gpt-4o-mini-tts, Gemini Flash TTS und ElevenLabs erzeugen und nebeneinander anhören. Dafür braucht es ein Konto bei mindestens einem Anbieter (ElevenLabs geht mit der Gratis-Stufe).
3. Danach die Gewinnerin einbauen (ca. 1 Arbeitstag), mit Rückfall auf die Browserstimme. Ziel: vor der Januar-Runde.

## Quellen (gelesen 23.11.2026)
- OpenAI gpt-4o-mini-tts: https://developers.openai.com/api/docs/models/gpt-4o-mini-tts · Minutenpreis: https://community.openai.com/t/gpt-4o-mini-tts-output-cost-has-exceeded-what-i-calculated/1312195
- Google Text-to-Speech-Preise: https://cloud.google.com/text-to-speech/pricing
- ElevenLabs: https://elevenlabs.io/pricing/api · https://modelslab.com/elevenlabs-api-pricing (Stand 23.09.2026)
