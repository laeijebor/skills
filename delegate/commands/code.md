---
description: Hand a coding task to the best-fit cheaper delegate (matrix-routed), verify the result, and present the delivered change
argument-hint: '[--wait|--background] [--model <model>] <coding task>'
---

Delegate a coding task so the orchestrator spends its own tokens only on judgment:
routing, packet-writing, verification, and presentation.

Raw arguments:
`$ARGUMENTS`

First read the shared references — they are the contract for everything below:

- `${CLAUDE_PLUGIN_ROOT}/references/capability-matrix.md` (who does what)
- `${CLAUDE_PLUGIN_ROOT}/references/handoff-packet.md` (how to brief a delegate)
- `${CLAUDE_PLUGIN_ROOT}/references/runtimes.md` (invocation, exec-mode, isolation, verification)

Flow:

1. **Scope the task.** If the task references code you haven't seen, gather context
   cheaply first — an Explore/haiku subagent for anything beyond a couple of targeted
   reads. Do not load large files into your own context when a delegate will do the work.
2. **Decompose only when obvious.** If the task splits into a few clearly independent
   slices, run them as parallel delegations; otherwise keep it as one task. Apply the
   isolation policy: reuse the current worktree unless parallel writers could collide.
3. **Route via the matrix.** Pick the delegate (and effort) whose dimensions match the
   task. `--model <model>` in the arguments overrides your choice. Remember: UI/visual
   work does not go to Codex models — the matrix marks who is trusted for it.
4. **Write the handoff packet** per the template: standalone, one task per run, explicit
   done-definition, verification loop, stop conditions.
5. **Execute** per the exec-mode policy (`--wait`/`--background` override). While a
   background run is out, do other useful work or end the turn — never poll.
6. **Verify** per the verification gate: check the return contract, re-run project checks
   yourself, skim the diff. Failed verification goes back to the delegate as a resumed
   delta, not a silent orchestrator rewrite.
7. **Present.** Report what was delivered: summary, changed files (absolute paths if in a
   non-obvious worktree), verification results, and any residual risks or triggered stop
   conditions — honestly, including failures.

Do not implement the task yourself. If delegation fails outright (CLI missing, repeated
stop conditions), report what happened and ask how to proceed rather than quietly doing
the work at frontier prices.
