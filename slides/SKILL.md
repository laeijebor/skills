---
name: slides
description: Make clear, visual slides, a deck, presentation or one-pager from code, evidence or a topic. Use for “make slides”, “explain this visually”, or a PDF/PowerPoint of a topic. Includes portable HTML templates and a Node CLI for checks and exports; works in Claude Code, Codex and OpenCode without Commando.
---

# Slides

Write a folder of plain HTML, CSS and local evidence. The bundled CLI renders,
checks and exports it. Node 20+ and a Chromium browser are needed for rendering.

## When to use

Use a deck when the argument unfolds over several findings or needs presenting.
Use an A4 one-pager for a brief someone should read without a presenter.
Use a single diagram when one relationship or sequence answers the question;
there is no need to build a deck around it.

Workflow: outline → pick layouts → gather evidence → write `deck.html` →
`slides check` → look at every PNG yourself → fix → export.

Start with the audience, the decision and a sequence of sentence headlines.
Scaffold with `new`, then edit the copied HTML. Keep evidence beside the deck.
After each material change, run the checker and inspect every resulting PNG.
Fix errors and review warnings before exporting. Automated checks cannot judge
whether the evidence supports the story.

## How to make good slides

Give each slide one idea.
Name the finding in a full sentence at the top.
Write “The daemon sent more than its own limit allowed”, not “Root cause”.
Reading only the headlines should tell the story.
Order findings so each slide answers the question raised by the previous one.
Start with the consequence for the audience, then explain why it happened.
Keep the opening short enough to reach the first evidence quickly.
End on takeaways and residual risk.
Make the next action or decision explicit when one is needed.

Choose the visual before writing the body.
Use a screenshot for visible product behaviour.
Use a stat for a change in scale.
Use a chart for a pattern across measurements.
Use a flow for a sequence, dependency or failure path.
Use two columns for a comparison on equal terms.
Use three cards for three distinct, parallel findings.
Use a statement slide for a transition that earns its space.
Leave empty space around the evidence that matters.
Do not fill a slide just because a template has room.

Prefer real screenshots over mockups.
Capture with the tools at hand: Playwright, simulator tooling or existing evidence folders.
Keep the original capture in the deck folder for provenance.
Crop to the part that proves the claim; retain enough context to recognise it.
Show before and after at comparable crops and scales.
Use numbered callouts, each tied to a caption with the same number.
Place callouts beside the evidence without covering it.
Explain what changed in the caption, rather than naming the screen.
Do not imply an interaction or state that the capture does not show.
When a real capture is impossible, build a high-fidelity HTML representation.
Derive it from the product's own typography, spacing, colours and components.
Label it “Representation” on the slide.
Explain the missing capture and the representation's limits in speaker notes.

Make important numbers large enough to read first.
Use the stat layout with a before → after comparison.
Include the unit, time window and sample size where they change interpretation.
Keep the comparison on the same denominator.
Label illustrative values as illustrative.
Do not add precision that the measurement cannot support.
Use a common scale when comparing bars or repeated charts.
Rebuild charts in HTML/SVG from the data so they follow the theme.
Keep the source image and the underlying data in the folder for provenance.
Label axes and series directly when possible.
Keep chart labels outside bars unless their contrast is sufficient inside them.
Avoid decorative charts that repeat a number without adding information.

Use the flow layout for ordered steps and sequences.
Keep node labels short and describe one action per node.
Mark a loop only when something really repeats.
Use one accent colour for emphasis.
Reserve good/bad colours for their actual meaning.
Do not make colour the only way to distinguish outcomes.
Use consistent spacing, alignment and corner styles across the deck.
Keep text contrast at least 4.5:1 against its background.
Keep body text to about 40 words per slide at most.
Use at least 18px text at 1280×720, including captions and chart labels.
Use the denser A4 type scale only for print-sized pages.
Break long labels or change the layout instead of shrinking the type.
Avoid paragraphs that force the audience to read while you speak.

Speaker notes carry the detail, caveats and supporting explanation.
Keep the visible slide understandable without reading those notes.
Cite sources such as a PR, file or dataset in a kicker or footer.
Use a precise file path, revision or measurement date when it matters.
Separate measured results from interpretation.
Mention what was not tested when it limits the claim.
Inspect all PNGs at their intended size yourself.
Check clipping, crowded labels, misleading emphasis and missing context.
Export only after the visual story and the checks agree.

## Themes

Default to `ink`; use `paper` for print-first work.
To match a brand, create `themes/<brand>.css` setting only the tokens in the
[contract](references/deck-format.md#theme-tokens-themesnamecss).
Derive values from real CSS variables, Tailwind config, design tokens or the
product website. Keep text contrast ≥4.5:1; then switch `<link id="theme">` to
the new file. Names use lowercase letters, digits and hyphens, up to 40 characters.
Layouts use tokens; keep brand styling out of the layout library.
Bundled Paper semantic text colours are slightly darker than the reference palette
so text remains readable on light surfaces.

## Deck format

Read [references/deck-format.md](references/deck-format.md) before authoring;
it is the shared source of truth for files, tokens and runtime messages.
Put slides in reading order as `section.slide` directly inside `main.deck`.
Give each a unique stable `id` of 1–64 letters, digits, underscores or hyphens.
Use `data-title` for a short title, otherwise the first h1/h2 supplies it.
Set `deck:title` and `deck:size` metadata (`16:9` or `a4`).
Include at most one hidden `aside.notes` per slide for speaker notes.
Use hidden `aside.ask` for reviewer questions with stable `data-key` values.
Optional `data-options` is a JSON array of 1–50 strings, each ≤256 characters;
put the recommended choice first, marked “(recommended)”. Questions are ≤256 characters.
Use `data-multiple` for multiple choices; write received answers in `data-answer`.
Add `data-canvas-label`, `data-canvas-group` or `data-canvas-id` where useful.
The runtime supports id/number hashes, keyboard navigation, themes and printing.

## Layout catalogue

[templates/deck/deck.html](templates/deck/deck.html) is the live 16:9 example;
[templates/onepager/onepager.html](templates/onepager/onepager.html) shows A4.
Classes come from [slides.css](templates/deck/slides.css).

| Layout / class | Use for |
|---|---|
| `.deck`, `.slide`, `.on` | Fixed-size pages and the runtime's current slide. |
| `[data-layout="title"]` | Opening finding with a large headline. |
| `[data-layout="statement"]` | A single transition or assertion. |
| `.body` | Main visual area below the headline. |
| `.cols.c2` | Two comparable panels; cards fit their content. |
| `.cols.c3` | Three parallel findings. |
| `.cols.split` | An uneven visual/text split, vertically centred. |
| `.card`, `.tag` | A bounded finding and its short category label. |
| `.stat` | A large number, unit and before → after change. |
| `.shots`, `.shot`, `.device` | Captures with frames and captions. |
| `.badge`, `.callout` | Before/after labels and numbered evidence markers. |
| `.representation` | A labelled HTML substitute for a missing real capture. |
| `.flow`, `.node`, `.n`, `.hot`, `.loop` | Ordered steps, a marked failure and a repeat path. |
| `.bars`, `.lbl`, `.row`, `.b.before`, `.b.after` | Comparable measurements on a shared scale. |
| `.checks`, `.ic` | Short takeaways with meaningful status icons. |
| `.meta-row`, `.pill`, `.dot` | Compact context and status. |
| `.kicker`, `.lede` | Source/context above, short explanation below. |
| `.accent`, `.muted`, `.good`, `.bad`, `.warn` | Token-based emphasis and semantic colour. |
| `.mono`, `code`, `.arrow-big` | Technical labels or a standalone comparison arrow. |
| `.pn`, `.mark` | Runtime page number and theme mark. |
| `.notes`, `.ask` | Hidden speaker detail and reviewer questions. |
| `.page`, `.page header` | A4 normal-flow page and brief header. |
| `.page .stats`, `.page .stat` | A4 summary numbers in a row. |
| `.page .two` | A4 two-column explanation. |
| `.page table` | Dense, readable evidence comparisons. |
| `.page .risk` | Residual risk or a material limitation. |

## CLI

Install dependencies once from the repository root:

```bash
npm install --prefix <skill>/slides
# Or: cd slides && npm install
```

Run `node <skill>/slides/bin/slides.mjs` in place of `slides` below; `<skill>` is
the repository containing this skill folder. No global install is required.

```text
slides new <dir> [--title "…"] [--theme ink|paper] [--onepager] [--force]
slides check <deck.html> [--theme name] [--out dir] [--json]
slides png <deck.html> [--out dir] [--theme name] [--scale 2] [--slide id] [--json]
slides pdf <deck.html> [--out file.pdf] [--theme name] [--json]
slides pptx <deck.html> [--out file.pptx] [--theme name] [--json]
slides html <deck.html> [--out file.html] [--theme name] [--json]
slides --help
slides <command> --help
```

`new` copies the assets and refuses to replace `deck.html` without `--force`.
`check` validates IDs, asks and notes, checks geometry, text size, failed assets
and approximate contrast, and writes 1× PNGs to `.slides/check/` by default.
It exits 1 for errors. Gradients/images and translucent backgrounds limit contrast checks.
Open every PNG yourself; the text-size floor (14px, or 9px A4) is a diagnostic,
not the presentation typography target.
`png` writes `png/NN-<id>.png` at 2× by default.
Use `--slide <id>` to render one slide, retaining its original slide number.
PNG and check outputs replace only existing `NN-*.png` files in their output folder.
`pdf` preserves text with one exact-size page per slide and backgrounds printed.
`pptx` embeds one full-bleed 2× image per slide plus speaker notes; text is not editable.
`html` bundles CSS, JS, images and fonts into one file for offline viewing elsewhere.
Use assets inside the deck folder and a classic `deck.js`; imported JS modules are not bundled.
Bundling rejects external hosts and files or symlinks that escape the deck folder.
HTML export rejects CSP meta tags; remove the tag or export PDF instead.
SVG images are bundled; embed external sprites in the deck and use `#fragment`
references because browsers block data URLs in SVG `use` elements.
Themes resolve relative to the deck file; bundles retain their default for unknown themes.
Existing files in the deck folder can be overwritten only if their extension matches the export.
Defaults beside the input are `<name>.pdf`, `<name>.pptx` and `<name>.bundle.html`.

Rendering accepts `--browser <path>` or `SLIDES_BROWSER`; otherwise it tries a
Playwright browser and usual macOS/Linux Chrome, Chromium, Edge and Brave paths.
Decks load via `file://`; remote asset requests fail rather than silently going online.
Export `--json` emits exactly one line: `{ "ok": true, "file": "<absolute path>" }`
(or `files` for PNG); failures emit `{ "ok": false, "error": "…" }` and exit 1.
The check JSON has `ok` and `slides`, each with `id`, `title`, `png` and `issues`.

## In Commando

If a `commando-slides` skill is available, use it to show the deck in a Commando
tab. Otherwise open the PDF/HTML with the tools available in your environment.
Publishing to an evidence gallery is v2 and is not part of this version.
