---
name: pr-diagram
description: Draw a code change as an animated SVG diagram and put it in the pull request description. Eleven diagram types cover architecture, sequences, before/after refactors, decision flows, state machines, race timelines, data-model diffs, screen flows, measured before/after, pipelines and a change map. Use when writing or updating a PR description for a change whose structure, logic, data, screens, timing or numbers are worth seeing, or when asked to diagram or visualise a change. Runs locally with Node; no API key, no network, no CI.
---

# PR diagram

You write one small JSON document that describes the change. The renderer in
this skill validates it and draws a self-contained animated SVG; `gh` uploads
it into the PR description. Nothing leaves the machine except that upload.

`<skill>` below is the directory this file is in. Node 20 or newer; there is
nothing to install.

```bash
node <skill>/bin/pr-diagram.mjs <command>
```

## 1. Pick the type by the reviewer's question

Classify the PR first. Pick one primary diagram, and at most one more.

| The PR is mainly… | Type | It answers |
|---|---|---|
| a feature or change across several components | `architecture` | Which parts talk to each other differently? |
| about one component and what surrounds it | `architecture` with `"layout": "focus"` | What calls it, and what does it use? |
| a request, job or event path | `sequence` | Who calls whom, in what order? |
| a refactor, consolidation or moved boundary | `before-after` | What did it look like, and what does it look like now? |
| a fix in branching logic, guards or fallbacks | `decision-flow` | Which case went wrong, and where does it go now? |
| a lifecycle, status, workflow or retry change | `state-machine` | Which states and moves exist now? |
| a race, ordering, sync or locking fix | `timeline` | What ordering broke it, and what prevents it? |
| a migration, or changed types or payloads | `data-model` | Which fields and relations changed? |
| UI, navigation or mobile screens | `screen-flow` | Which screens changed, and how do you reach them? |
| a measured performance, size or cost change | `measure` | How much, and from which phase? |
| CI, deploy, build, cron or data jobs | `pipeline` | Which stage changed, and what gates it? |
| large, of any kind (as a second image) | `change-map` | Where do I start, and what can I skim? |

Do not force a change into `architecture`. A bug fix inside one function is a
`decision-flow`; a retry change is a `state-machine`; a migration is a
`data-model`.

Skip the diagram, and use `show-me` (call tree, file tree, shape diff) instead,
for copy, docs, config values, tests only, or a rename. A diagram of one box is
noise.

## 2. Write the document

1. Read the existing PR description, commit messages and linked issue. They
   often state the behaviour more exactly than the diff does.
2. Read the diff against the merge base: `git diff --find-renames
   origin/<base>...HEAD`. Then read enough surrounding code to know the
   unchanged neighbours.
3. Read `<skill>/references/document.md` once per session, then start from an
   example:

   ```bash
   node <skill>/bin/pr-diagram.mjs example <type> > .pr-diagram/<name>.json
   node <skill>/bin/pr-diagram.mjs fields <type>     # every field and its limits
   ```

Keep the working files out of the PR. Put `.pr-diagram/` in git's local
exclude file before writing there (in a linked worktree this covers every
worktree of the repository, which is intended):

```bash
EXCLUDE="$(git rev-parse --git-common-dir)/info/exclude"
mkdir -p "$(dirname "$EXCLUDE")" .pr-diagram
grep -qxF '.pr-diagram/' "$EXCLUDE" 2>/dev/null || echo '.pr-diagram/' >> "$EXCLUDE"
```

What makes a diagram good:

- It shows the change in its surroundings: a few unchanged neighbours, drawn
  plainly, with the changed things standing out.
- Removed things stay in the picture, struck out.
- 5 to 10 cards. Short names. The caption says the point in one or two
  sentences.
- A PR that adds a whole new area is mostly `added`. The renderer notices and
  marks what already existed instead of badging every card NEW; you do not
  need to do anything.

## 3. Render and look

```bash
node <skill>/bin/pr-diagram.mjs render .pr-diagram/<name>.json --png
```

It writes `.pr-diagram/<name>.svg` and a `.png` preview (the preview needs
Chrome or Chromium; set `PR_DIAGRAM_BROWSER` if it is somewhere unusual).
Errors name the field or the edge and say what to change. Fix every one in the
JSON; never edit the SVG. Add `--draft` to draw a document whose layout still
has errors, so you can see what the error is about.

Then view the PNG before attaching anything. Check that the picture answers
the question in the table above at a glance, and that no line takes a
confusing route. If the automatic placement hides the shape, give `col` and
`row` to the cards.

## 4. Put it in the PR description

Use at most two images. Reference each as a Markdown image with the same
relative path in the body and in `--attach`; `gh` uploads the file and
rewrites the reference. An HTML `<img>` is not rewritten, so use `![alt](path)`
only. The alt text is one line on what the diagram shows.

```markdown
Moves bulk sends off the per-recipient trigger onto a batch endpoint.

![Sequence after this change: the queue route, the new bulk sender, and one batch request per 500 recipients](.pr-diagram/batch-sends.svg)
```

```bash
gh pr create --title "…" --body-file .pr-diagram/body.md --attach .pr-diagram/batch-sends.svg
```

If `gh pr create` exits non-zero but prints a PR URL, the PR exists and an
upload failed. Do not run `create` again; repair it with
`gh pr edit <number> --body-file .pr-diagram/body.md --attach <svg>`.

On an existing PR, start the body from the current one (`gh pr view <number>
--json body --jq .body`) so its Commando marker and everything else survive.
An earlier diagram is an `![…](https://github.com/user-attachments/…)` line:
replace that line with the new `.pr-diagram/<name>.svg` reference rather than
adding a second image, then `gh pr edit <number> --body-file … --attach <svg>`.

`--attach` needs GitHub CLI 2.99 or newer. On an older `gh`, or a forge other
than GitHub, leave the diagram out and use `show-me`.

No PR yet, and none being opened? Stop after step 3 and give the user the SVG.

In a Commando chat (your instructions say "This is a Commando chat"), also
show the diagram in your reply, with or without a PR, as a Markdown image with
the SVG's absolute path: `![alt](/abs/path/.pr-diagram/<name>.svg)`. In a
terminal, give the path as text.

## 5. Order the description

1. One sentence on why the change exists.
2. The diagram(s).
3. Proof that it works: tests, a screenshot, a recording.
4. A "Where to look" section, as the PR rules require.
5. The Commando pane marker. When creating a PR from a Commando pane, get it
   from `node "$HOME/.commando/hooks/commando-pr-marker.mjs"` (see the
   `commando-prs` skill). When editing, keep the one already there.

When a later push changes what the diagram shows, re-render and replace the
image. Skip that for pushes that do not.

## Hard rules

- Never commit `.pr-diagram/`, and never edit a generated SVG.
- `measure` needs a real measurement with its source. Never estimate numbers.
- The diagram explains the change. Bugs and risks belong in review comments.
