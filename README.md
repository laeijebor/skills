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

Draw a pull request as an animated architecture or data-flow diagram and put it
in the PR description. The agent writes a [PR Lens](https://github.com/coldteadotai/pr-lens)
graph document itself (no API key, no GitHub App, no CI). The pinned PR Lens CLI
validates it and renders a self-contained animated SVG, and `gh pr create --attach`
uploads it into the description. Nothing is sent to prlens.dev. See
`pr-diagram/SKILL.md`.

```bash
ln -s "<absolute-path-to-this-repo>/pr-diagram" ~/.claude/skills/pr-diagram
ln -s "<absolute-path-to-this-repo>/pr-diagram" ~/.codex/skills/pr-diagram
```

Needs Node 20.11+ and GitHub CLI 2.99+.
