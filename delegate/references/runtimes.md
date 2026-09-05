# Runtimes: invocation mechanics and shared policies

## Codex runtime (`runtime: codex`)

Non-interactive runs via `codex exec`. Default to `gpt-6-astra` at high reasoning effort;
pin both explicitly rather than relying on the user's `~/.codex/config.toml`.

Write-capable coding task (in the current worktree):

```bash
codex exec -m gpt-6-astra -c model_reasoning_effort="high" --sandbox workspace-write -o /tmp/delegate-last-msg.md "<packet>"
```

Read-only review task:

```bash
codex exec -m gpt-6-astra -c model_reasoning_effort="high" --sandbox read-only -o /tmp/delegate-review-msg.md "<packet>"
```

Flag reference:

- `-m <model>` — override model (`gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.3-codex-spark`).
- `-c model_reasoning_effort="low"` — effort override (`minimal|low|medium|high|xhigh`);
  this is the cost dial for Astra without changing model.
- `-C <dir>` — run in another directory (an isolation worktree).
- `-o <file>` — write the final message to a file; read that instead of scraping stdout.
  Use a unique file per parallel run.
- `codex exec resume --last "<delta>"` — follow-up on the same thread; send only the delta.
- Long prompts: pass the packet via stdin (`codex exec ... - <<'PACKET' ... PACKET`)
  to avoid shell-quoting issues.
- Never use `--dangerously-bypass-approvals-and-sandbox` or `danger-full-access`.

## Agent runtime (`runtime: agent`)

Claude subagents via the native Agent tool — these bill to the Claude plan (see matrix).

- Search/exploration → `Explore` agent (or `general-purpose`), model `haiku`.
- Light coding in-harness → `general-purpose`, model `sonnet`.
- Visual/UI/architecture work → `general-purpose`, model `opus`.
- Context-sparing judgment fork → `subagent_type: "fork"` (inherits full conversation;
  model is always the orchestrator's own).
- Parallel independent subagents: send the Agent calls in one message.

## Shared policies

### Execution mode (never ask the user)

- Foreground: single small task where the next step depends on the result.
- Background (`run_in_background` on the Bash call): parallel tasks, or any run expected
  to take more than a couple of minutes. Completion re-invokes the orchestrator; do useful
  work meanwhile, never poll.
- `--wait` / `--background` in the command's arguments override this judgment.

### Isolation (orchestrator judges)

- Already working in a worktree → delegates run there. No new isolation by default.
- Spawn extra worktrees (`git worktree add <path> -b <branch>`) only when parallel
  write-capable delegates could touch overlapping files, or when an experiment should be
  disposable. Run codex there with `-C <path>`.
- After merging or abandoning: `git worktree remove <path>` (and delete the branch if
  abandoned). Never leave stray worktrees behind.
- Tell the user the absolute path of any worktree where deliverables live.

### Verification gate (before any delegated work counts as done)

1. Delegate's report must include changed files, commands run, and real output
   (the return contract in `handoff-packet.md`).
2. Independently re-run the project's verification commands (tests/build/lint) via Bash —
   never trust reported green.
3. Skim the diff (`git diff --stat` then targeted reads) for scope creep, deleted tests,
   or suspicious shortcuts. Full line-by-line review is the review commands' job, not the
   gate's.
4. On failure: send the delta back to the same delegate thread (resume) once or twice;
   if it keeps failing, a stop condition has effectively triggered — report honestly
   rather than silently fixing it with expensive orchestrator work.
