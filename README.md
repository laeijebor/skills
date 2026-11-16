# leo-skills

Personal Claude Code plugin marketplace.

## Install

```
/plugin marketplace add /Users/leoijebor/dev/skills
/plugin install delegate@leo-skills
```

## Plugins

### delegate

Hand off coding, review, and refinement work to cheaper delegate agents so the frontier
orchestrator (Fable/Opus) keeps its context light and its tokens reserved for judgment.
Codex CLI runs spend ChatGPT quota; Claude subagents spend Claude plan quota at their
model's weighting. Routing is steered by a hand-tunable capability matrix
(`delegate/references/capability-matrix.md`).

| Command | What it does |
|---|---|
| `/delegate:code` | Route one coding task to the best-fit delegate, verify, present. |
| `/delegate:review` | Dual-pass review (defect + adversarial), orchestrator triage (adopt / reject / your call), you pick what gets applied. |
| `/delegate:rigorous` | Delegated build → autonomous review→refine loop (cap 2 passes) → deliverable with residual risks. |

Prior art: OpenAI's codex plugin (CLI mechanics, verbatim-pipe philosophy) and
BuilderIO's efficient-frontier/efficient-fable (handoff-packet orchestration discipline).
This plugin combines the two and adds matrix-based routing, a verification gate
(never trust reported green), and orchestrator-judged worktree isolation.

## Skills

### pr-diagram

Draw a pull request as an animated SVG and put it in the PR description. The
agent picks one of eleven diagram types by the question a reviewer has
(architecture, sequence, before/after, decision flow, state machine, race
timeline, data-model diff, screen flow, measured before/after, pipeline,
change map), writes a small JSON document, and the renderer in
`pr-diagram/` validates and draws it. `gh pr create --attach` uploads it into
the description. No dependencies, no network. See `pr-diagram/SKILL.md`.

```bash
node pr-diagram/bin/pr-diagram.mjs types
node pr-diagram/bin/pr-diagram.mjs render pr-diagram/examples/*.json --out /tmp/diagrams --png
npm test --prefix pr-diagram
```

```bash
ln -s "<absolute-path-to-this-repo>/pr-diagram" ~/.claude/skills/pr-diagram
ln -s "<absolute-path-to-this-repo>/pr-diagram" ~/.codex/skills/pr-diagram
ln -s "<absolute-path-to-this-repo>/pr-diagram" ~/.config/opencode/skills/pr-diagram
```

Needs Node 20+ and GitHub CLI 2.99+. The PNG preview needs Chrome or Chromium.

### slides

Make visual slide decks and A4 one-pagers from code, evidence or a topic.
Includes HTML layouts, Ink and Paper themes, and a small Node CLI to scaffold,
check and export PDF, PowerPoint, PNG and self-contained HTML. Works without
Commando. See `slides/SKILL.md`.

```bash
ln -s "<absolute-path-to-this-repo>/slides" ~/.claude/skills/slides
ln -s "<absolute-path-to-this-repo>/slides" ~/.codex/skills/slides
ln -s "<absolute-path-to-this-repo>/slides" ~/.config/opencode/skills/slides
npm install --prefix "<absolute-path-to-this-repo>/slides"
```

Needs Node 20+ and Chromium/Chrome for rendering. Install the CLI dependencies once,
then run `node <absolute-path-to-this-repo>/slides/bin/slides.mjs --help`.
