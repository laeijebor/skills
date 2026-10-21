---
name: pr-diagram
description: Draw a code change as an animated PR Lens architecture or data-flow diagram and put it in the pull request description. Use when writing or updating a PR description for a change whose structure is worth seeing (components, boundaries, a request path, a sequence), or when asked to diagram or visualise a change. Uses the coding agent's own model; no API key, no GitHub App, no CI.
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

Skip it, and use `show-me` (call tree, file tree, shape diff) instead, for:
copy, docs, config, tests only, a rename, or a fix inside one function. A diagram
of one box is noise.

## 1. Load the manual, once per session

```bash
npx -y @coldtea/pr-lens-cli@0.13.2 skill              # how to write a good document
npx -y @coldtea/pr-lens-cli@0.13.2 skill references   # every field, plus a full example that validates
```

Read the example document in `skill references` before writing your first one.
Follow the manual on *what goes in the document*: unchanged neighbours for
blast radius, lanes as the reader's mental model, one hero edge, a flow only
when there is a sequence, file refs on nodes, and a walkthrough. **This skill
overrides the manual on where things go**: ignore its "Attach" and canvas
steps and follow steps 4 and 5 below.

## 2. Keep the repository clean

The CLI adds `.pr-lens/` to the repository's `.gitignore` the first time it
writes there, which leaves an unwanted change in the PR. Put the folder in
git's local exclude file first. The CLI then sees it is ignored and leaves
`.gitignore` alone:

```bash
EXCLUDE="$(git rev-parse --git-common-dir)/info/exclude"
grep -qxF '.pr-lens/' "$EXCLUDE" 2>/dev/null || echo '.pr-lens/' >> "$EXCLUDE"
```

Check `git status --short` afterwards. Never commit anything under `.pr-lens/`.

## 3. Write, validate, render

1. Read the diff against the merge base, not the tip of the base branch:
   `git diff --find-renames "$(git merge-base origin/<base> HEAD)"...HEAD`.
2. Write `.pr-lens/graph.json`. Fill `provenance` from git (repository
   owner and name, the real base and head SHAs). Never invent them.
3. Validate, and fix every failure until it passes. Never delete the element
   a failure names just to make it pass:

   ```bash
   npx -y @coldtea/pr-lens-cli@0.13.2 validate .pr-lens/graph.json
   ```

4. Render the single neutral theme. It has its own dark background, so one
   image reads well in both GitHub's light and dark modes:

   ```bash
   npx -y @coldtea/pr-lens-cli@0.13.2 render .pr-lens/graph.json --theme neutral
   ```

   It prints the drawing's folder, `.pr-lens/<title-slug>/`. Its
   `manifest.json` lists every SVG with its `lens`, `view` and `path`. If the
   render warns that a correction in `.github/pr-lens.yml` matched nothing,
   fix that file rather than ignoring the warning.

## 4. Put it in the PR description

Pick at most two images: the top architecture view (the view with
`defaultOpen: true`, usually `overview`), plus one data-flow view when the
change has a sequence worth following. Use more only for a large feature or
refactor where each extra image explains something new.

Reference each one as a Markdown image whose path is exactly the path you pass
to `--attach`. `gh` uploads the file and rewrites that reference to the
uploaded asset, keeping your alt text. An HTML `<img>` or `<picture>` is not
rewritten, so use `![alt](path)` only. The alt text is the caption for readers
without images: one line on what the diagram shows.

```markdown
Moves bulk sends off the per-recipient trigger onto a batch endpoint.

![Architecture after this change: the queue route, the new bulk sender and the removed per-recipient path](.pr-lens/batch-sends/overview-neutral-859426a4.svg)
```

```bash
gh pr create --title "…" --body-file .pr-lens/body.md \
  --attach .pr-lens/batch-sends/overview-neutral-859426a4.svg
```

On an existing PR, `gh pr edit <number> --body-file .pr-lens/body.md --attach <svg>`
replaces the description. Start the body from the current one
(`gh pr view <number> --json body --jq .body`) so its Commando marker and
anything else already there survive.

`--attach` needs GitHub CLI 2.99 or newer (`gh --version`). On an older `gh`,
or a forge other than GitHub, leave the diagram out and use `show-me`.

## 5. Order the description

1. One sentence on why the change exists.
2. The diagram(s).
3. Proof that it works: tests, a screenshot, a recording.
4. A "Where to look" section, as the PR rules require.
5. The Commando pane marker, when the pane provides one.

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
