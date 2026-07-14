---
status: pending
sprint: '004'
---

# Server-side postcard pipeline: content JSON -> HTML -> print PDF

Real replacement for the wireframe's print-window stand-in: postcard
content persisted as regions JSON (positions in inches, fonts, exact
text, QR overlay URL), rendered to HTML and to a print-ready PDF with
1/8in bleed and vendor rotation (predecessor parity; crop marks noted as
a predecessor gap worth closing). PDF endpoint feeds both the iterations
view PDF button (marked sides only) and the text editor's Generate PDF.

Refs: specification.md §11 + grounding; marketing repo postcard-content.json.
