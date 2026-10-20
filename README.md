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

### disk-cleanup

Audit, then reclaim disk from git worktrees, `node_modules`, Docker, and idle
tmux/Commando sessions. Merged, clean, idle worktrees are deleted, along with their
branch and sessions. Ageing unmerged worktrees lose their `node_modules`. Docker
build cache and unused images are pruned. Anything riskier is listed for approval.
See `disk-cleanup/SKILL.md` for the rules.

```bash
ln -s "<absolute-path-to-this-repo>/disk-cleanup" ~/.claude/skills/disk-cleanup
ln -s "<absolute-path-to-this-repo>/disk-cleanup" ~/.codex/skills/disk-cleanup
ln -s "<absolute-path-to-this-repo>/disk-cleanup" ~/.config/opencode/skills/disk-cleanup
```
