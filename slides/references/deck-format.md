# Deck format v1 (contract shared by the `slides` skill/CLI and Commando's Slides tab)

A deck is a folder. The agent writes it; tools read it. Everything is plain files, no build step.

```
my-deck/
  deck.html        the deck (required; other names allowed, e.g. onepager.html)
  slides.css       layout library (copied from the skill)
  deck.js          runtime (copied from the skill)
  themes/ink.css   one CSS file of tokens per theme (ink + paper copied by default)
  img/…            screenshots and other assets, referenced relatively
```

## deck.html

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Reconnect loop fix</title>
<meta name="deck:title" content="Companion app · reconnect loop fix · PR #156">
<meta name="deck:size" content="16:9">            <!-- "16:9" (1280×720, default) or "a4" (794×1123 portrait, one-pagers) -->
<link rel="stylesheet" href="slides.css">
<link rel="stylesheet" href="themes/ink.css" id="theme">
</head>
<body>
<main class="deck">
  <section class="slide" id="title" data-layout="title" data-title="Title">
    <p class="kicker">Ship review · 24 Oct 2026</p>
    <h1 data-canvas-label="Headline">The phone stopped throwing away what you type</h1>
    <aside class="notes">Speaker notes, plain text or simple inline HTML.</aside>
    <aside class="ask" data-key="lead" data-options='["The symptom (recommended)","The fix"]'>Lead with what the user saw, or with the fix?</aside>
  </section>
  …
</main>
<script src="deck.js"></script>
</body>
</html>
```

Rules:

- Slides are `<section class="slide">` elements directly inside `<main class="deck">`, in reading order.
- Every slide has an `id` matching `^[A-Za-z0-9_-]{1,64}$`, unique in the deck. Tools may fall back to `slide-<n>` (1-based) for a missing id but report it as a warning.
- Slide title: `data-title` if present, else the text of the first `h1`/`h2` in the slide, else `Slide <n>`.
- `<aside class="notes">` — speaker notes (at most one per slide). Never shown on the slide.
- `<aside class="ask">` — a question for the reviewer, attached to that slide. Never shown on the slide.
  - Text: the question, at most 256 characters.
  - `data-key`: stable answer key, `^[A-Za-z0-9_-]{1,64}$`; defaults to `<slideId>-ask-<n>`.
  - `data-options`: optional JSON array of 1–50 strings (≤256 chars each). Without options the question takes free text. Put the recommended option first and mark it "(recommended)".
  - `data-multiple`: present → several options can be picked.
  - `data-answer`: the agent writes the received answer here; the question then shows as answered.
- `data-canvas-label` / `data-canvas-group` / `data-canvas-id` on elements a reviewer would talk about (same meaning as Commando canvas frames).
- `<meta name="deck:title">` is shown in each slide's footer; falls back to `<title>`.
- `<link id="theme">` names the default theme. Themes live in `themes/<name>.css`, name `^[a-z0-9-]{1,40}$`.

## Runtime (`deck.js`)

- Shows one slide at a time, scaled to fit the window, letterboxed, preserving the deck size.
- Location hash selects the slide: `#<slideId>` or `#<n>` (1-based). Defaults to the first slide. Reacts to `hashchange`.
- Keys: → / Space / PageDown next, ← / PageUp previous, Home first, End last (updates the hash).
- `?theme=<name>` swaps the `#theme` stylesheet to `themes/<name>.css` (resolved relative to deck.js).
- `?thumb` hides nothing extra but disables key handling (used for thumbnails).
- Adds a footer to every slide: deck title left, `<n> / <total>` right, theme mark top-right (`--mark` token).
- Print (`@media print` or `?print`): every slide visible, one per page, page size = deck size, no scaling. `@page` size must follow `deck:size`.
- Messages: posts `{ source: 'commando-deck', type: 'slide', id, index, count }` to `parent` (when framed) whenever the visible slide changes. Accepts `{ source: 'commando-deck', type: 'go', id }` or `{ …, index }` from the parent.
- Never navigates away; no network requests of its own.

## Theme tokens (`themes/<name>.css`)

A theme sets only these custom properties on `:root` (layouts must never use raw colours):

`--theme-name` (string), `--bg`, `--bg-2`, `--surface`, `--line`, `--ink`, `--ink-soft`, `--muted`, `--accent`, `--accent-ink`, `--accent-2`, `--good`, `--warn`, `--bad`, `--font-display`, `--font-body`, `--font-mono`, `--display-weight`, `--display-tracking`, `--radius`, `--glow` (background image or `none`), `--mark` (string shown top-right, may be empty `""`).

Bundled themes: `ink` (default; dark, Commando palette) and `paper` (light, print-first).

## Export expectations

- PDF: one page per slide at deck size, backgrounds printed, text stays text.
- PPTX (v1): one full-bleed picture per slide (rendered at 2×) plus the slide's notes as speaker notes. Text is not editable.
- PNG: one file per slide, `NN-<slideId>.png`, 2× by default.
- HTML: one self-contained file (CSS, JS, images and fonts inlined as data URIs) that behaves like the folder.
