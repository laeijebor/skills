# Writing a diagram document

A document is one JSON object. `type` picks the diagram; `title` names the
change; `caption` is one or two sentences saying the point in words. Everything
else depends on the type.

```bash
node <skill>/bin/pr-diagram.mjs types             # which type answers which question
node <skill>/bin/pr-diagram.mjs example <type>    # a complete document to adapt
node <skill>/bin/pr-diagram.mjs fields <type>     # every field and its limits
```

Start from `example <type>` and change it. The examples show the shape of a
document, not your change: replace every name, label and edge with what the
diff actually does. The validator is strict: an unknown
field, an id that is not declared, a label that would be cut off, an edge that
runs behind a card and a label with no free space are all errors. Each error
says what to change.

## Rules for every type

- **`delta`** is `added`, `changed`, `removed` or `unchanged` (the default).
  Include unchanged neighbours: they show where the change sits. Keep removed
  things in the picture; they are drawn struck out, and they are often the
  whole story of a bug fix.
- **A whole new area.** When most cards are `added`, the renderer stops
  marking each one NEW and instead marks the few that already existed. Only
  edges that connect to existing code are highlighted. Set `"emphasis":
  "changes"` to force the per-card badges, or `"emphasis": "new"` to force the
  quiet style.
- **Labels are short.** A card title is a name, a subtitle is three or four
  words. If the validator says a label is too long, shorten it; do not
  abbreviate it into something unreadable.
- **Placement.** Most types place cards automatically. To place them yourself,
  give `col` and `row` (from 0; halves such as `0.5` are allowed) to every item,
  or to none. Do this when the automatic layout hides the shape you want to show,
  or when the validator reports an edge behind a card.
- **Size.** Aim for 5 to 10 cards. Past about 14 the picture stops being
  readable at pull-request width; split it into two diagrams instead.
- **Ids** use letters, digits, `.`, `_` and `-`.
- **Edges.** List each edge once. Only `state-machine` and `sequence` draw an
  edge from a thing to itself; `data-model` draws one between two fields of
  the same table. Elsewhere, say it in a label or the caption.

## The types

### architecture

Components and how they talk. Two layouts.

`"layout": "zones"` (the default): `zones` are regions placed with `at`, one of
`top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`,
`bottom`, `bottom-right`. A zone stretches sideways into empty neighbours, so
three zones at `top-left`, `top` and `bottom` give two side by side over one
full-width band. Put entry points where a reader starts (top or left), the
core in the middle, stores and external systems at the bottom or right. Every
node names its `zone`. Inside a zone, cards are placed automatically, or by
`col` and `row`. Without `zones`, cards are placed on one open grid.

`"layout": "focus"`: for a change that is about one component. Give each node
a `role`: exactly one `focus`, plus `caller` (drawn above), `callee` (below)
and `sibling` (to the right). The focus node can list `parts`, drawn inside it;
an edge can end at a part with `"to": "node.part"`.

Edges: `label` is drawn on the edge and fits 30 characters. For a path with an
order, give `step` (1, 2, 3…) instead: the edge gets a numbered badge and the
label, up to 64 characters, moves to a legend under the diagram. Prefer steps
when more than three or four edges need words.

### sequence

`participants` left to right, `messages` in order. `kind` is `call` (default)
or `return`. A message from a participant to itself is drawn as a loop. Keep
it to the steps that changed plus the ones needed to follow them.

### before-after

Two panels with one shared grid, so a card that exists on both sides sits in
the same place on both. Write `before` and `after`, each with `nodes` and
`edges`. Do not write deltas: a node or edge only in `before` is drawn
removed, one only in `after` is drawn added, and a node whose `sub` differs is
drawn changed (or set `"delta": "changed"` on the `after` node). Positions
given on either side apply to both.

### decision-flow

`nodes` with `kind`: `start`, `decision`, `step` (default) or `end`; `edges`
labelled with the answer (`yes`, `no`, a condition). For a bug fix, keep the
old wrong branch as a `removed` edge to a `removed` node and add the new
branches as `added`.

### state-machine

`states` (mark one `initial`, any `final`) and `transitions`. A transition
from a state to itself is drawn as a loop.

### timeline

For races and ordering. `lanes` are the actors. Each of 1 to 3 `scenarios`
(usually "before" and "after") has `events` placed in a lane at a tick `at`
(0, 1, 2…), `links` between events, and an `outcome` with `tone` `good` or
`bad`. Use `removed` for the events that go wrong and `added` for the ones
that fix it.

### data-model

`entities` with `fields` (`name`, `type`, `delta`). `relations` join
`entity.field` to `entity.field` (or whole entities). `migration` lists the
steps in order, and `warning` is one line for anything irreversible or
order-sensitive. Also right for a changed API payload or TypeScript type.

### screen-flow

`screens`, each a wireframe built from `elements` (`row`, `button`, `text`,
`input`, `image`, `heading`), or a real screenshot via `image` (a .png, .jpg
or .webp path relative to the document, under 700 KB; it is embedded).
`"sheet": true` draws the elements as a sheet over the screen. `"device":
"desktop"` draws a wide frame. `links` go from a screen, or from an element
with an `id` (`"from": "screen.element"`), to a screen.

### measure

Only when the PR carries a real measurement. `metric`, `unit` and `source`
(how it was measured: runs, machine, script) are required. Each of 2 to 4
`bars` has `segments` with a `label` and `value`; the headline percentage
compares the first bar's total with the last. Mark the segment that went away
`removed` and one that shrank `changed`. Set `"lowerIsBetter": false` for
throughput-style metrics. Never estimate values.

### pipeline

`stages` left to right (up to 6), each with `jobs`; jobs in one stage are
drawn stacked and read as running side by side. Without `edges`, every job feeds
every job of the next stage; list `edges` when that is not true or when one
needs a `label` (a gate, a condition). An edge may also join two jobs in the
same stage. `notes` are up to 6 lines under the
diagram for what changes for someone who merges; `notesTitle` renames the box.

### change-map

For a large PR, as a second image. `groups` (folders or areas) hold `files`
with `added` and `removed` line counts; area is lines changed. Give the 2 to 4
files that matter most an `order` and a `why`; they get numbered badges and a
"Review order" list. Use a group such as "tests · skim" for what can be
skimmed.
