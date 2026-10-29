# Prospects: local businesses without a website

**Open the tool:** https://sacha9214.github.io/prospects/

A small browser tool that lists independent French businesses around a town that have **no website listed in OpenStreetMap**, grouped by sector, with their public contact details. It helps you write **one personal email at a time**, and tracks who you've contacted.

The interface is in French. There's no account, no build step and no server of its own.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 4323 --directory prospects
```

## How it works

1. Pick a town (from [geo.api.gouv.fr](https://geo.api.gouv.fr)), a radius and sectors.
2. One [Overpass API](https://overpass-api.de) query fetches named shops, crafts, restaurants, etc. in that area.
3. Businesses with a `website` tag and chains (`brand` / `brand:wikidata`) are filtered out. The rest are sorted by how reachable they are: email first, then Facebook or Instagram, then phone.
4. **Vérifier** opens a Google search, because a missing tag in OpenStreetMap doesn't prove the business has no site.
5. **✍️ Générer** opens a ready-to-paste message right under the business, with copy buttons. The options depend on what the business has published:
   - email (with subject and address);
   - a short Facebook / Instagram message;
   - a phone script;
   - a walk-in script, for shopfronts only.

   The wording varies per business, and **🔄 Autre version** gives another. Emails state the source of the address (OpenStreetMap) in their first sentence. At the user's request they no longer include an explicit opt-out sentence. The in-tool rules point out that the CNIL expects one in every prospecting email. Nothing is sent automatically. **📨 Envoyer avec Gmail** opens Gmail's compose window pre-filled (address, subject, message, your latest edits), and you press Send there. **✉️ Autre messagerie** does the same with your default mail app, and you can also simply copy-paste.
6. Statuses and notes are saved in the browser (`localStorage`). CSV export uses semicolons and a BOM for French Excel.

Test run, Angers, 2 km, 29 Oct 2026:

| Measure | Count |
|---|---|
| Named businesses | 1,428 |
| Independent, no website listed | 988 |
| With an email | 26 |
| With a phone number | 116 |
| With Facebook or Instagram | 33 |

## Rules (also inside the tool, "Règles d'envoi")

- **Legal status first.** Prospecting is advertising. Without registration, French law presumes undeclared work (Code du travail L8221-4).
- **B2B email is allowed without prior consent (CNIL)** if the message concerns the recipient's trade, says where the address came from, and offers an easy opt-out. The templates already do this.
- **One message per business, no mass mailing.** Honour every "stop": the "Ne plus contacter" status removes the Write button.
- **Keep data no longer than 3 years** after the last contact.
- **Data attribution:** © OpenStreetMap contributors (ODbL).
