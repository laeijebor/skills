# Handoff packets

Every delegated task is sent as a self-contained handoff packet. The delegate has none of
the orchestrator's conversation context — the packet must stand alone. Prompt Codex like an
operator, not a collaborator: compact, block-structured, one clear task per run, with an
explicit definition of done.

## Packet template (XML blocks)

```
<task>
The concrete job, with repository context: what to build/fix/review, in which files,
against which constraints. State what "done" looks like — do not assume the delegate
will infer the end state.
</task>

<scope>
Files/directories in scope. Files that must NOT be touched. Conventions to follow
(point at an exemplar file rather than describing style in prose).
</scope>

<context>
Relevant paths, key types/functions, gotchas the orchestrator already knows.
Keep it to what the delegate needs — the packet is not a memo.
</context>

<output_contract>
Exact return shape (see "Return contract" below). Brevity requirements.
</output_contract>

<follow_through>
What to do by default instead of asking routine questions (e.g. "if a helper is missing,
create it in <dir>"; "prefer editing existing files over new ones").
</follow_through>

<verification_loop>
Commands the delegate must run before reporting done (tests/build/lint), and the
requirement to include their real output.
</verification_loop>

<stop_conditions>
When to stop and report instead of pushing on — see below.
</stop_conditions>
```

Add per-task blocks as needed:

- Coding/debugging → `<verification_loop>` is mandatory; add `<action_safety>` ("stay
  narrow, no unrelated refactors, no dependency changes unless asked").
- Review → `<grounding_rules>` ("every finding cites file:line; mark inferences as
  inferences; no findings without evidence") and a severity-ordered output contract.
- Research/scan → `<citation_rules>` (quote the source line for every claim).

## Return contract

The delegate must report, in order:

1. **Summary** — what was done, in a few sentences.
2. **Changed files** — full paths.
3. **Commands run** — verification commands with their real (trimmed) output.
4. **Residual risks** — what wasn't verified, assumptions made, follow-ups.
5. **Stop condition** — if one triggered, which and why (instead of 1–4).

## Stop conditions (include in every write-capable packet)

Stop and report rather than improvising when:

- Live code contradicts the packet's assumptions (wrong paths, missing types, different API).
- Verification fails twice for the same underlying reason.
- The fix requires touching out-of-scope files.
- The task turns out to be ambiguous in a way that changes the design.

## Orchestrator-side rules

- One task per run. Split unrelated asks into separate delegations.
- Tighten the packet before raising reasoning effort or upgrading the model.
- Never forward the orchestrator's own uncertainty — resolve ambiguity first or make it a
  stop condition.
- On follow-up to the same Codex thread, resume (`codex exec resume --last`) and send only
  the delta instruction, not the whole packet again.
