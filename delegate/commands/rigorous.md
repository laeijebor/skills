---
description: Delegate a build, then autonomously loop review → refine (cap 2 passes) before presenting the finished work with residual risks
argument-hint: '[--wait|--background] [--model <model>] <task>'
---

The full loop: delegate the implementation, then review and refine it autonomously —
fixes are applied WITHOUT asking the user mid-loop — and present only the finished
result. The user's decisions happen before (this task description) and after (reviewing
the deliverable), not during.

Raw arguments:
`$ARGUMENTS`

Read the shared references first:

- `${CLAUDE_PLUGIN_ROOT}/references/capability-matrix.md`
- `${CLAUDE_PLUGIN_ROOT}/references/handoff-packet.md`
- `${CLAUDE_PLUGIN_ROOT}/references/runtimes.md`

Flow:

1. **Build** — exactly as `/delegate:code`: scope, decompose if obvious, matrix-route,
   packet, execute, verification gate. Ambiguity that changes the design is resolved with
   the user NOW, before any delegation — not discovered mid-loop.
2. **Review** — exactly as `/delegate:review` steps 2–3: dual parallel passes (defect +
   adversarial, read-only) over the work produced, then merge, dedupe, verify claims, and
   triage. Here the triage question is: **blocking or not?**
   - Blocking: bugs, broken behavior, spec violations, security issues.
   - Non-blocking: style, nits, nice-to-haves, speculative design concerns.
3. **Refine** — if there are blocking findings, send them to the implementing delegate
   (resume its thread with the delta) or re-route via the matrix if it's the wrong
   specialist. Re-run the verification gate on the fixes.
4. **Loop** — after a refinement, review again (step 2). Hard cap: **2 refinement
   passes**. Non-blocking findings never trigger another pass.
5. **Present** the deliverable:
   - What was built: summary, changed files (absolute paths if in a non-obvious
     worktree), verification results.
   - What the reviews found and how it was resolved, in a few lines.
   - **Residual findings** — every unresolved finding (non-blocking ones, and anything
     still open at the pass cap) listed honestly with the reviewers' citations. If the
     cap was hit with blockers remaining, say so prominently; never present capped-out
     work as clean.

Throughout: the orchestrator writes no code. Its tokens go to routing, packets, triage,
verification, and this final presentation.
