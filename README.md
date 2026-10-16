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
  two fingers pinch to zoom). Everything snaps to a 10px grid.
- **Multi-select** — Shift+click to add elements, Shift+drag on empty
  canvas to box-select, Ctrl/Cmd+A for everything. A group drags,
  nudges, deletes and duplicates together, and the side panel can align
  it (left/center/right, top/middle/bottom) or distribute it evenly.
- **Auto-layout** — the Layout button (or `L`) arranges whatever is on
  the canvas: strong entities in a row, weak entities fanned around
  their owner, relationships halfway between. One undo puts it back.
- **Text input** — there's a collapsible panel on the right where you
  can type ER definitions in a compact syntax and click *Render* to
  drop them onto the canvas. Lines it can't understand are reported
  instead of silently skipped.
- **DB Schema tab** — a `CREATE TABLE` script generated from the
  diagram as you edit it, with an optional SQL type per attribute.
- **Checks** — with nothing selected, the side panel lists what a
  grader would circle: an entity with no primary key, a weak entity
  with no discriminator or no identifying relationship, a relationship
  that doesn't join two entities, two entities that would become the
  same table.
- **Properties panel** — click any element to rename it, edit its
  attributes, mark primary keys, flag attributes as multivalued or
  derived, or change cardinality on connections.
- **Undo / redo** — every edit, including a whole Render or Layout, can
  be undone.
- **Export** — PNG, SVG, or the schema as a `.sql` file. Images come out
  light so they print well; tick *Use on-screen colors* in the Export
  menu to get the dark palette when the dark theme is showing.
- **Save / open** — download the diagram as `.json` and open it again
  later. It also auto-saves to localStorage so a refresh loses nothing.
  Anything opened is checked field by field, so a hand-edited file
  can't put odd shapes into the diagram.
- **Light and dark** — follows your system setting; the Theme button
  overrides it, and the choice is shared with the rest of j4den.com.
- **Examples** — three sample diagrams under File › Examples (the MLB
  one is my HW7, plus a university and an online store).

## Keyboard

Press `?` in the app for the same list.

| Key | Does |
|---|---|
| `V` `C` | select / connect tool |
| `E` `W` `R` `I` | entity / weak entity / relationship / identifying rel. |
| `Shift`+click, `Shift`+drag | add to the selection, box-select |
| `Ctrl/Cmd+A` | select everything |
| `[` `]` | step the selection through elements |
| arrows | move the selection (`Shift` for bigger steps) |
| `Delete` | delete the selection |
| `Ctrl/Cmd+D` | duplicate the selection |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` | undo, redo |
| `L` | auto-layout |
| `Space` | fit the diagram to the view |
| `+` `-` | zoom |
| `?` | shortcut sheet |
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
various stat tables. Load it from *File › Examples*, or copy-paste it
into the text panel. The other two examples live in `samples.js`.

## Files

```
index.html    layout, toolbar, side panel, shortcut sheet
theme.js      picks light/dark before the page paints
style.css     dark toolbar, light/dark workspace, SVG element styling
app.js        state, tools, selection, rendering, parsing, layout, undo, save/load, export
mlb.js        bundles the MLB example text
samples.js    the example picker's diagrams
mlb.txt       the MLB example on its own
```
