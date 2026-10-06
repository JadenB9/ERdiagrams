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
  Works with a mouse, a pen or a touchscreen (one finger pans or drags,
  two fingers pinch to zoom).
- **Text input** — there's a collapsible panel on the right where you
  can type ER definitions in a compact syntax and click *Render* to
  drop them onto the canvas. Lines it can't understand are reported
  instead of silently skipped.
- **DB Schema tab** — a `CREATE TABLE` script generated from the
  diagram as you edit it, with an optional SQL type per attribute.
- **Properties panel** — click any element to rename it, edit its
  attributes, mark primary keys, flag attributes as multivalued or
  derived, or change cardinality on connections.
- **Undo / redo** — every edit, including a whole Render, can be undone.
- **Export** — PNG, SVG, or the schema as a `.sql` file.
- **Save / open** — download the diagram as `.json` and open it again
  later. It also auto-saves to localStorage so a refresh loses nothing.
- **Light and dark** — follows your system setting; the Theme button
  overrides it. Exports always come out light.

## Keyboard

| Key | Does |
|---|---|
| `V` `C` | select / connect tool |
| `E` `W` `R` `I` | entity / weak entity / relationship / identifying rel. |
| `Space` | fit the diagram to the view |
| `+` `-` | zoom |
| `[` `]` | step the selection through elements |
| arrows | move the selected element (`Shift` for bigger steps) |
| `Delete` | delete the selection |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` | undo, redo |
| `Esc` | deselect and go back to the select tool |

## Text format

The text panel understands this syntax:

```text
ENTITY Name: *pk_attr, attr, {multivalued}, derived(), typed:DATE
WEAK Name: ~discriminator, attr1, attr2
REL name (Entity1, Entity2) cardinality participation [attr1, attr2]
IDENT name (Entity1, Entity2) cardinality participation
```

- `*` marks a primary key
- `~` marks a weak entity discriminator
- `{}` wraps multivalued attributes
- `()` marks derived attributes
- `:TYPE` after a name sets its SQL type (otherwise it's guessed from the name)
- Cardinality: `M:N`, `1:N`, `N:1`, `1:1`
- Participation: `partial/partial`, `partial/total`, `total/partial`, `total/total`

## Example

`mlb.txt` is the example I used for HW7, modeling an MLB baseball
database with players, teams, team-seasons (weak entity), and the
various stat tables. Load it from *File > Load MLB example*, or
copy-paste it into the text panel.

## Files

```
index.html    layout + toolbar + side panel
theme.js      picks light/dark before the page paints
style.css     dark toolbar, light/dark workspace, SVG element styling
app.js        state, tools, rendering, parsing, undo, save/load, export
mlb.js        bundles the MLB example text
mlb.txt       the MLB example on its own
```
