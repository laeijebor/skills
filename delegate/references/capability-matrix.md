# Capability matrix

The orchestrator consults this table to pick a delegate for each task. It encodes the
user's judgment — edit it freely; all `delegate:*` commands pick up changes immediately.
Scores are 1–5 (5 best), informed by Code Arena WebDev rankings (Aug 2026) and hand-tuned.
The "Use when / avoid when" column outranks the numbers when they disagree.

Cost columns describe *which budget is spent*, not just $/token:

- **ChatGPT quota** — Codex CLI runs bill to the OpenAI subscription. This is the budget
  the user *prefers* to burn. Delegating here offloads the Anthropic plan entirely.
- **Claude quota (cheap/mid/expensive)** — Agent-tool subagents bill to the Claude plan at
  that model's weighting. Cheap rows stretch the plan; expensive rows spend the budget the
  plugin exists to protect — use them only when the "Use when" column applies.

| Model | Runtime | Visual taste | Architecture | Code review | Frontend | Fullstack | Speed | Cost | Use when / avoid when |
|---|---|---|---|---|---|---|---|---|---|
| `gpt-5.6-sol` (high effort) | codex | 2 | 4 | 5 | 4 | 5 | 3 | ChatGPT quota | **Default delegate.** Non-UI coding, refactors, debugging, test writing, defect + adversarial reviews — the strongest reviewer in the matrix. Avoid: UI polish, visual/design judgment. |
| `gpt-5.6-sol` (low/minimal effort) | codex | 2 | 2 | 3 | 3 | 4 | 4 | ChatGPT quota | Trivial mechanical edits: renames, boilerplate, config changes, applying an already-specified fix. Same model, cheaper/faster via `model_reasoning_effort`. |
| `gpt-5.6-terra` | codex | 2 | 2 | 3 | 3 | 4 | 4 | ChatGPT quota (mid) | Bulk semi-mechanical work across many files where Sol-high is overkill but spark is under-powered. Avoid: architecture decisions. |
| `gpt-5.6-luna` | codex | 1 | 2 | 2 | 3 | 3 | 5 | ChatGPT quota (very cheap) | Large menial sweeps: log reduction, doc scans, inventory/summarization of big inputs that should spare BOTH Claude quota and Sol budget. Avoid: anything needing judgment. |
| `gpt-5.3-codex-spark` | codex | 1 | 1 | 1 | 2 | 2 | 5 | ChatGPT quota (cheapest) | Single-file trivial edits where latency matters. Avoid: multi-file or ambiguous tasks. |
| `claude-haiku` | agent | 1 | 2 | 2 | 2 | 2 | 5 | Claude quota (cheap) | Repo search, exploration, doc/log scans **when results must land structured in the orchestrator's session** (Explore/general-purpose subagents). |
| `claude-sonnet` | agent | 3 | 2 | 3 | 4 | 4 | 4 | Claude quota (mid) | Light coding or test-writing that needs Claude Code's native tools/harness; secondary reviewer when a non-OpenAI perspective is wanted. Avoid: architecture decisions. |
| `claude-opus` | agent | 5 | 5 | 4 | 5 | 5 | 2 | Claude quota (expensive) | UI design work, visual taste calls, visually reviewing another delegate's UI output (screenshots), parallel architecture exploration alongside the orchestrator. Only Opus/Fable are trusted for visual taste. Avoid: menial work of any kind. |
| `claude-fable` (fork) | agent | 5 | 5 | 4 | 5 | 5 | 2 | Claude quota (most expensive) | Context-sparing forks of judgment-heavy subtasks (a fork inherits the full conversation), and final-arbiter calls the orchestrator can't fit in its own context. Avoid: everything else. |

## Routing rules of thumb

- Prefer spending ChatGPT quota over Claude quota when quality is equivalent for the task.
- Match the task's dominant dimension to the column: UI/visual → visual-taste ≥ 4
  (Opus/Fable only); architecture decisions → architecture ≥ 4; mechanical → speed/cost.
- Expensive Claude rows are *allowed*, not forbidden — the trigger is need (context-sparing,
  visual review, UI design, parallel architecture), never convenience.
- When adding `opencode` runtime rows later (kimi-k3, glm-5.2, qwen3.6, deepseek), keep the
  same columns and add invocation notes to `runtimes.md`.
