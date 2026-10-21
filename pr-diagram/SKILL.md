---
name: pr-diagram
description: Draw a code change as an animated PR Lens architecture or data-flow diagram and put it in the pull request description. Use when writing or updating a PR description for a change whose structure is worth seeing (components, boundaries, a request path, a sequence, call sites moved onto a shared piece), or when asked to diagram or visualise a change. Uses the coding agent's own model; no API key, no GitHub App, no CI.
---

# PR diagram

A wrapper around the PR Lens CLI. You write one JSON document that describes
the change; PR Lens validates it and renders it as self-contained animated SVGs;
`gh` uploads them into the PR description. Nothing runs in CI, and nothing
leaves the machine except the upload to GitHub.

Always run the pinned CLI version, spelled out in every command:

```bash
npx -y @coldtea/pr-lens-cli@0.13.2 <command>
```

Its manual says `@latest`. Substitute `@0.13.2`. The schema version a document
declares must match the CLI, so a floating version breaks documents that passed
yesterday. Bump the pin on purpose, after reading the release notes.

## Draw it, or use show-me?

Draw when a reviewer would otherwise rebuild a picture in their head:

- two or more components or modules talk differently after the change
- a path is added, removed or rerouted (a request, a job, an event)
- a sequence matters (who calls whom, in what order)
- a boundary moves (client and server, process, package, service)
- several call sites move onto one shared helper, type or list (draw the fan-in)

Skip it, and use `show-me` (call tree, file tree, shape diff) instead, for:
copy, docs, config, tests only, a rename, or a fix inside one function. A diagram
of one box is noise.

The diagram is the PR's illustration. Add a `show-me` sketch next to it only
when the sketch says something the diagram can't, such as a type's shape.

## 1. Load the manual, once per session

```bash
npx -y @coldtea/pr-lens-cli@0.13.2 skill              # how to write a good document
npx -y @coldtea/pr-lens-cli@0.13.2 skill references   # every field, plus a full example that validates
```

Read the example document in `skill references` before writing your first one.
Follow the manual on *what goes in the document*: unchanged neighbours for
blast radius, lanes as the reader's mental model, one hero edge, a flow only
when there is a sequence. **This skill overrides the manual on everything
about where the diagram goes.** Ignore its "Attach" and canvas steps, its
"render light by default", its `<picture>` theme pairs and its `comment`
command. Follow steps 4 to 6 below instead.

## 2. Keep the repository clean

The CLI adds `.pr-lens/` to the repository's `.gitignore` the first time it
writes there, which leaves an unwanted change in the PR. Put the folder in
git's local exclude file first. The CLI then sees it is ignored and leaves
`.gitignore` alone:

```bash
EXCLUDE="$(git rev-parse --git-common-dir)/info/exclude"
grep -qxF '.pr-lens/' "$EXCLUDE" 2>/dev/null || echo '.pr-lens/' >> "$EXCLUDE"
```

In a linked worktree this writes the main clone's exclude file, so it covers
every worktree of the repository. That is intended. Check `git status --short`
afterwards. Never commit anything under `.pr-lens/`. The CLI also drops a
`.pr-lens/README.md` there; leave it.

## 3. Write the document

This is the SVG path, not the canvas path. The SVG draws lanes, nodes (label,
subtitle, kind icon, delta badge), edges (label, hero, animation) and flow
steps. It does **not** draw node summaries, file refs, stats, walkthroughs,
flow `note`s or `payload`s. Leave out walkthroughs, notes and payloads; they
cost time and nobody sees them. The document `summary` and view titles only
become the image's hidden accessible text.

1. Read the existing PR description, commit messages and linked issue first.
   They often state the behaviour (an error code, the bug) more exactly than
   the diff does.
2. Read the diff against the merge base, not the tip of the base branch:
   `git diff --find-renames "$(git merge-base origin/<base> HEAD)"...HEAD`.
   Then read enough surrounding code to know the unchanged neighbours.
3. Write `.pr-lens/graph.json`. Fill `provenance` yourself from git: the
   repository owner and name, `base.sha` as the **merge-base** SHA and
   `head.sha` as `HEAD`. Leave `pullRequest` out. Never invent SHAs.
4. Keep it readable. Aim for 6 to 12 nodes in the top view; past about 15 the
   edges tangle. Cards cut text with "…". A card alone on its row fits about
   45 characters of subtitle; two cards sharing a row fit only about 18 each.
   Keep labels and subtitles short, and check the screenshot in step 4.

## 4. Validate, render, look

1. Validate, and fix every failure until it passes. Never delete the element
   a failure names just to make it pass:

   ```bash
   npx -y @coldtea/pr-lens-cli@0.13.2 validate .pr-lens/graph.json
   ```

2. Render the single neutral theme. It has its own dark background, so one
   image reads well in both GitHub's light and dark modes:

   ```bash
   npx -y @coldtea/pr-lens-cli@0.13.2 render .pr-lens/graph.json --theme neutral
   ```

   It prints `✓ .pr-lens/<slug>/manifest.json — N SVGs across N diagrams`. The
   drawing folder is `.pr-lens/<slug>/`. Each manifest asset's `path` is a bare
   file name inside that folder. If the render warns that a correction in
   `.github/pr-lens.yml` matched nothing, fix that file rather than ignoring it.

3. Look at every image you will attach before attaching it. On macOS, take a
   full-size screenshot with headless Chrome (QuickLook crops to a square), at
   the asset's `width` and `height` from the manifest, then view the PNG:

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
     --hide-scrollbars --window-size=<width>,<height> \
     --screenshot=/tmp/<view>.png "file://$PWD/.pr-lens/<slug>/<file>.svg"
   ```

   Otherwise open the SVG in any browser. Fix cut-off labels, tangles and
   wrong names in `graph.json`, then validate and render again.

## 5. Put it in the PR description

Pick at most two images:

- the top architecture view: the view in `graph.json` with
  `defaultOpen: true` (usually `overview`), matched to the manifest asset
  with that `view`
- one data-flow view, only when the change has a sequence worth following

Use more only for a large feature or refactor where each extra image explains
something new.

Reference each image as a Markdown image. The path is
`.pr-lens/<slug>/<file>.svg`, written exactly the same in the body and in
`--attach`. `gh` uploads the file and rewrites that reference to the uploaded
asset, keeping your alt text. An HTML `<img>` or `<picture>` is not rewritten,
so use `![alt](path)` only. The alt text is the caption for readers without
images: one line on what the diagram shows.

```markdown
Moves bulk sends off the per-recipient trigger onto a batch endpoint.

![Architecture after this change: the queue route, the new bulk sender and the removed per-recipient path](.pr-lens/batch-sends/overview-neutral-859426a4.svg)
```

```bash
gh pr create --title "…" --body-file .pr-lens/body.md \
  --attach .pr-lens/batch-sends/overview-neutral-859426a4.svg
```

On an existing PR, start the body from the current one
(`gh pr view <number> --json body --jq .body`), so its Commando marker and
anything else already there survive. Then run
`gh pr edit <number> --body-file .pr-lens/body.md --attach <svg>`, which
replaces the description.

`--attach` needs GitHub CLI 2.99 or newer (`gh --version`). On an older `gh`,
or a forge other than GitHub, leave the diagram out and use `show-me`.

## 6. Order the description

1. One sentence on why the change exists.
2. The diagram(s).
3. Proof that it works: tests, a screenshot, a recording.
4. A "Where to look" section, as the PR rules require.
5. The Commando pane marker. When creating a PR from a Commando pane, get it
   from `node "$HOME/.commando/hooks/commando-pr-marker.mjs"` (see the
   `commando-prs` skill). When editing, keep the one already there.

When a later push changes the structure, re-render and replace the image with
`gh pr edit`. Skip the re-render for pushes that don't change what the diagram
shows.

## Hard rules

- **Never `canvas push`** unless the user asks for the interactive canvas.
  It uploads labels, file paths and sample payloads to prlens.dev, readable
  by anyone with the link. When asked, give them only the view link, never the
  edit link that ends in `#w=…`.
- **Never `analyze`.** It sends the diff to a third-party model with a key.
  You are the model; write the document yourself.
- **Never commit `.pr-lens/`**, and never edit the generated SVGs. If a name
  or lane is wrong, fix `.pr-lens/graph.json`, or `.github/pr-lens.yml` when
  the repository keeps corrections, then re-render.
- The diagram explains the change. Bugs and risks belong in review comments,
  and the schema rejects them anyway.
