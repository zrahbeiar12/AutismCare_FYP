# Official questionnaire translations

AutismCare never machine-translates screening questions. A questionnaire is shown in Urdu or Roman Urdu
only when its **official, validated translation** is installed here. Otherwise parents see the English
items with a notice to ask staff for help.

- M-CHAT-R/F translations: https://mchatscreen.com (check the licence terms for electronic use).
- ASQ-3 translations are sold by Paul H. Brookes Publishing (https://agesandstages.com); an electronic
  licence is required.

## File names

| Instrument | File |
|---|---|
| M-CHAT-R | `mchat-ur.json`, `mchat-roman.json` |
| ASQ-3, one file per interval | `asq3-<months>-ur.json`, e.g. `asq3-24-ur.json` |

## Format

```json
{
  "source": "Official Urdu M-CHAT-R, version/date, licence reference",
  "items":   { "Q1": "…", "Q2": "…" },
  "options": { "yes": "…", "no": "…" }
}
```

Keys in `items` are the `questionId`s from `server/src/seeders/data/mchat.json` / `asq.json`.
Scoring is unchanged: it uses the question ids and answer values, never the text.
