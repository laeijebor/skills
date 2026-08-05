---
description: Thorough dual-pass delegate review (defect + adversarial) with orchestrator triage — you choose which findings to apply
argument-hint: '[--wait|--background] [--base <ref>] [focus ...]'
---

Run a thorough review of local changes using cheap reviewer passes, then apply frontier
judgment only to triage. The orchestrator never reviews line-by-line itself.

Raw arguments:
`$ARGUMENTS`

Read the shared references first:

- `${CLAUDE_PLUGIN_ROOT}/references/capability-matrix.md`
- `${CLAUDE_PLUGIN_ROOT}/references/handoff-packet.md`
- `${CLAUDE_PLUGIN_ROOT}/references/runtimes.md`

Flow:

1. **Select scope.** Auto by default: if the working tree is dirty (including untracked
   files), review the working tree; otherwise review the branch against `--base <ref>` if
   given, else the merge-base with the default branch. Only conclude there is nothing to
   review when the scope is genuinely empty. Any focus text in the arguments narrows what
   reviewers emphasize — preserve it verbatim in the packets.
2. **Run two reviewer passes in parallel**, read-only sandbox, per the matrix (default
   `gpt-5.6-sol` high effort for both; if the diff is dominated by UI/visual changes, add
   or substitute a high visual-taste reviewer per the matrix):
   - **Defect pass** — bugs, correctness, security, error handling, test gaps. Grounding
     rules: every finding cites file:line with evidence, ordered by severity.
   - **Adversarial pass** — challenge the approach itself: design choices, tradeoffs,
     assumptions that could fail under real-world conditions. Not just a stricter defect
     pass.
3. **Triage.** Merge and dedupe the findings. For each, verify the load-bearing claims
   cheaply (targeted reads — reviewers fabricate line references sometimes) and assign a
   verdict:
   - **Adopt** — real and worth fixing, with the fix sketched in one line.
   - **Reject** — wrong, out of scope, or not worth it, with a one-line why.
   - **Your call** — a genuine judgment tradeoff the user should decide.
4. **Present the triaged findings** grouped by verdict, severity-ordered, keeping the
   reviewers' file:line citations and their inference/evidence distinctions. Then ask
   (AskUserQuestion, multiSelect) which findings to apply. Do not apply anything —
   even an obvious one-liner — without the user's selection.
5. **Apply the chosen fixes** as a normal delegated coding task: matrix-routed delegate,
   handoff packet, verification gate. Report what was applied with verification results.

This command never modifies code before step 5, and step 5 only touches what the user
selected.
