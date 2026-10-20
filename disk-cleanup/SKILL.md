---
name: disk-cleanup
description: Audit and reclaim disk space from git worktrees, node_modules, Docker, and idle tmux/Commando sessions. Use when the user asks to clear down, prune, or clean up worktrees, node_modules, Docker, or disk space, or says the disk is full.
---

# Disk cleanup

Everything runs through `scripts/disk-cleanup.mjs` (Node, no dependencies). Run it with the absolute path to this skill directory. It works in two phases. `audit` writes a plan and changes nothing beyond `git fetch`. `apply` acts on items from that plan, re-checks each one against live state first, and skips any that changed.

## Rules the audit applies

| Bucket | Condition | Action |
|---|---|---|
| **Auto: delete** | Merged into origin's default branch (ancestor, merged PR at this HEAD, or all changes already in main after a squash or rebase), clean, no open PR, idle ≥ `--active-hours` (24h), no process outside tmux using it, and every tmux session in it lives only there. | `git worktree remove`, delete the local branch, kill those tmux (Commando) sessions |
| **Auto: prune** | Not auto-deletable (dirty, open PR, unmerged…), idle ≥ `--stale-days` (3d), no dev server or other program running in it. | Delete every `node_modules` in the worktree, then `pnpm store prune` |
| **Auto: housekeeping** | Registered worktrees whose folder is gone; Docker build cache, unused images and networks older than `--stale-days`. | `git worktree prune`; `docker builder/image/network prune` |
| **Needs approval** | Grouped so whole groups can be approved: `merged-untracked-only`, `merged-modified`, `merged-in-use` (recent activity, processes outside tmux, or a shared session), `stale-nothing-to-lose` and `stale-unsaved-work` (PR closed unmerged, or no PR and idle ≥ `--abandon-days`, 14d), `unregistered-folders` (inside `*worktrees` directories), `dead-sessions` (every folder gone), `docker-containers` (stopped), `docker-volumes` (unattached). | Proposed action per group; branches of unmerged work are kept |
| **Left alone** | Main checkouts, active or recently touched worktrees, locked worktrees, the worktree this agent runs in. | None |

Idle time is the latest of: HEAD commit time, mtimes of uncommitted files, tmux session activity, and Claude transcript writes (`~/.claude*/projects/<encoded path>`).

## Procedure

1. **Audit.** `node <skill>/scripts/disk-cleanup.mjs audit`. It scans `~` three levels deep for repositories, fetches each origin, lists PRs with `gh`, and sizes candidates. This takes a few minutes on a large machine, so run it in the background if the host allows. Useful flags: `--root DIR` (repeatable), `--stale-days N`, `--active-hours N`, `--abandon-days N`, `--no-fetch`, `--no-docker`, `--json`, and `--sizes`. `--sizes` is off by default: it adds one `du` per group, which can take 20+ minutes across hundreds of worktrees.
2. **Report.** Give the user a short summary (counts per group, sizes if measured, plan path), not the full listing.
3. **Apply the auto buckets straight away.** The user pre-approved them, so don't ask. Run `node <skill>/scripts/disk-cleanup.mjs apply --plan <plan> --auto`. Report what was applied, anything skipped with its reason, the change in free space, and the log path. The log holds restore commands for every removed worktree and branch.
4. **Ask about the approval groups.** For each group, give the user its count, what is at stake, and two or three representative items. Ask which groups to apply, and which individual ids to add or exclude. Use the host's question tool with multi-select where it has one (at most four options per question). Never apply these without an explicit yes. If the full listing would help, publish it as a page rather than pasting hundreds of lines.
5. **Apply approved items.** `apply --plan <plan> --groups stale-nothing-to-lose,dead-sessions --ids f12`. A plan expires after 6 hours; re-run the audit if it's older. To approve a group except a few items, pass the remaining ids with `--ids` rather than the whole group.
6. **Summarise** the space freed, what's left, and anything skipped.

Use `apply … --dry-run` to see exactly what would happen after re-validation without changing anything.

## Guardrails

- Act only through `apply`, so every item is re-checked. Don't hand-delete worktrees or kill sessions on the script's behalf.
- Never prune Docker volumes or stopped containers without approval; they can hold database state.
- Sessions are killed only on the default tmux server (`--tmux-socket NAME` targets another), and only when all their panes are inside the deleted worktree and nothing has happened in them since the audit.
- Sizes are `du` estimates. pnpm hard links and clones mean real savings from `node_modules` can be lower until `pnpm store prune` runs; the free-space change `apply` reports is the real figure.
