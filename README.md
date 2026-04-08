# ER Diagram Builder

A small browser tool I built for my database class (CS3610). It lets you
draw entity-relationship diagrams interactively on an SVG canvas —
entities, weak entities, relationships, identifying relationships — and
also parse a compact text format so you can paste a diagram in and have
it render automatically.

I wrote it because all the free online ER tools I found either didn't
support weak entities and identifying relationships properly, or made
you sign up for an account to export anything.

## Running it

It's plain HTML/CSS/JavaScript, no build step. Just open `index.html`
in a browser. Or serve the folder with any static server if you prefer:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## What's here

- **Visual canvas** — click to place entities, relationships, or weak
  entities; drag to move; click two items to connect them with a line.
- **Text input** — there's a collapsible panel on the right where you
  can type ER definitions in a compact syntax and click *Render* to
  drop them onto the canvas.
- **Properties panel** — click any element to rename it, edit its
  attributes, mark primary keys, flag attributes as multivalued or
  derived, or change cardinality on connections.
- **PNG export** — dumps the current canvas to a file for turning in.
- **Persistence** — it auto-saves to localStorage so you don't lose
  work if you refresh.

## Text format

The text panel understands this syntax:

```text
ENTITY Name: *pk_attr, attr, {multivalued}, derived()
WEAK Name: ~discriminator, attr1, attr2
REL name (Entity1, Entity2) cardinality participation [attr1, attr2]
IDENT name (Entity1, Entity2) cardinality participation
```

- `*` marks a primary key
- `~` marks a weak entity discriminator
- `{}` wraps multivalued attributes
- `()` marks derived attributes
- Cardinality: `M:N`, `1:N`, `N:1`, `1:1`
- Participation: `partial/partial`, `partial/total`, `total/partial`, `total/total`

## Example

`mlb.txt` is the example I used for HW7, modeling an MLB baseball
database with players, teams, team-seasons (weak entity), and the
various stat tables. Load it via the text panel or copy-paste it in.

## Files

```
index.html    layout + toolbar + side panel
style.css     dark toolbar, light workspace, SVG element styling
app.js        state, tools, rendering, parsing, export
mlb.js        bundles the MLB example text
mlb.txt       the MLB example on its own
```
