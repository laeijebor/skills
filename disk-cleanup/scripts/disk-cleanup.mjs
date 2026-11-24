#!/usr/bin/env node
// Audit, then reclaim disk from git worktrees, node_modules, Docker and idle tmux (Commando) sessions.
// Sessions are never killed: they are archived through Commando, which keeps their chats restorable.
//
//   disk-cleanup.mjs audit [--root DIR]... [--stale-days 3] [--active-hours 24] [--abandon-days 14]
//                          [--no-fetch] [--no-docker] [--no-sizes] [--tmux-socket NAME]
//   disk-cleanup.mjs apply --plan FILE (--auto | --ids f1,f2 | --auto --ids f1) [--dry-run]
//
// audit writes a plan to ~/.local/state/disk-cleanup/ and prints a report. apply re-checks every
// selected item against live state before acting and writes a log with what it removed.
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

const HOME = homedir()
const STATE_DIR = process.env.DISK_CLEANUP_STATE_DIR ?? join(HOME, '.local/state/disk-cleanup')
const HOUR = 3_600_000, DAY = 24 * HOUR
const PLAN_MAX_AGE = 2 * HOUR
const LIVE_MAX_AGE = 30_000
const SKIP_SCAN = new Set(['node_modules', 'Library', 'Pods', 'Applications', 'Movies', 'Music', 'Pictures', 'Downloads'])
const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', 'login', 'tmux'])
const AGENT_RE = /(^|[\s/])(claude\w*|codex|opencode|cursor-agent|muse)(\s|$)|@anthropic-ai\/claude-code|@openai\/codex/
const CLAUDE_PROJECT_DIRS = ['.claude', '.claudew', '.claudep'].map((dir) => join(HOME, dir, 'projects'))

// ---------- helpers ----------

function run(cmd, args, { cwd, timeout = 120_000 } = {}) {
  return new Promise((done) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 512 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
      done({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; out[index] = await fn(items[index], index) }
  }))
  return out
}

const inside = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
const tilde = (path) => (path && inside(path, HOME) ? '~' + path.slice(HOME.length) : path)
const log = (...parts) => process.stderr.write(parts.join(' ') + '\n')

function ago(ms) {
  if (!ms) return 'never'
  const diff = Date.now() - ms
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / 60_000))}m`
  if (diff < 2 * DAY) return `${Math.round(diff / HOUR)}h`
  return `${Math.round(diff / DAY)}d`
}

// Decimal units, matching Finder and Docker.
function human(kb) {
  if (kb == null) return '?'
  const units = ['KB', 'MB', 'GB', 'TB']
  const sign = kb < 0 ? '-' : ''
  let value = Math.abs(kb) * 1.024, unit = 0
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++ }
  return `${sign}${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function mtime(path) { try { return lstatSync(path).mtimeMs } catch { return 0 } }
// Like existsSync, but a symlink counts even when its target is missing.
function onDisk(path) { try { lstatSync(path); return true } catch { return false } }

async function diskFreeKB() {
  const { stdout } = await run('df', ['-k', HOME])
  return Number(stdout.trim().split('\n').pop().trim().split(/\s+/)[3])
}

async function sizeKB(paths) {
  if (!paths.length) return 0
  const { stdout } = await run('du', ['-skc', ...paths], { timeout: 600_000 })
  const total = stdout.trim().split('\n').pop()
  return total ? Number(total.split(/\s+/)[0]) : null
}

// ---------- live state: tmux, processes, activity ----------

// Panes of the audited tmux server. No server is fine; any other failure must stop us, since an
// empty list would read as "no sessions are using anything".
async function tmuxPanes(socket) {
  const format = ['#{pid}', '#{session_id}', '#{session_name}', '#{session_activity}', '#{pane_pid}', '#{pane_current_path}'].join('\t')
  const { code, stdout, stderr } = await run('tmux', [...(socket ? ['-L', socket] : []), 'list-panes', '-a', '-F', format])
  if (code) {
    if (/no server running|error connecting/i.test(stderr)) return { serverPid: null, panes: [] }
    throw new Error(`tmux list-panes failed: ${stderr.trim()}`)
  }
  const panes = stdout.split('\n').filter(Boolean).map((line) => {
    const [serverPid, sessionId, sessionName, activity, pid, path] = line.split('\t')
    return { serverPid: Number(serverPid), sessionId, sessionName, activity: Number(activity) * 1000, pid: Number(pid), path }
  })
  return { serverPid: panes[0]?.serverPid ?? null, panes }
}

async function processTable() {
  const procs = new Map()
  const ps = await run('ps', ['-axo', 'pid=,ppid=,args='])
  for (const line of ps.stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
    if (match) procs.set(Number(match[1]), { pid: Number(match[1]), ppid: Number(match[2]), args: match[3] })
  }
  const lsof = await run('lsof', ['-nP', '-d', 'cwd', '-F', 'pn'])
  let pid
  for (const line of lsof.stdout.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    else if (line[0] === 'n' && procs.has(pid)) procs.get(pid).cwd = line.slice(1)
  }
  return procs
}

async function liveState(socket) {
  const [{ serverPid, panes }, procs] = await Promise.all([tmuxPanes(socket), processTable()])
  const sessions = new Map()
  for (const pane of panes) {
    const session = sessions.get(pane.sessionId) ?? { id: pane.sessionId, name: pane.sessionName, activity: pane.activity, panes: [] }
    session.panes.push(pane)
    sessions.set(pane.sessionId, session)
  }
  const paneByPid = new Map(panes.map((pane) => [pane.pid, pane]))
  const self = new Set()
  for (let pid = process.pid; pid > 1 && !self.has(pid); pid = procs.get(pid)?.ppid ?? 0) self.add(pid)
  for (const proc of procs.values()) {
    for (let pid = proc.pid, hops = 0; pid > 1 && hops < 64; pid = procs.get(pid)?.ppid ?? 0, hops++) {
      if (paneByPid.has(pid)) { proc.pane = paneByPid.get(pid); break }
      if (pid === serverPid) { proc.tmuxHook = true; break } // run-shell / hook children of the audited server
    }
    const command = basename(proc.args.split(' ')[0]).replace(/^-/, '')
    proc.kind = self.has(proc.pid) ? 'self' : SHELLS.has(command) || command.startsWith('gitstatusd') ? 'shell' : AGENT_RE.test(proc.args) ? 'agent' : 'program'
  }
  // An agent's MCP servers belong to it. Anything it started through a shell (a dev server or
  // watcher from its Bash tool) stays a 'program', so it still blocks pruning node_modules.
  for (const proc of procs.values()) {
    if (proc.kind !== 'program') continue
    for (let pid = proc.ppid, hops = 0; pid > 1 && hops < 64; pid = procs.get(pid)?.ppid ?? 0, hops++) {
      const ancestor = procs.get(pid)
      if (!ancestor || ancestor.kind === 'shell') break
      if (ancestor.kind === 'agent') { proc.kind = 'agent'; break }
    }
  }
  return { at: Date.now(), panes, sessions, procs: [...procs.values()] }
}

function transcriptActivity(path) {
  const encoded = path.replace(/[^a-zA-Z0-9]/g, '-')
  let latest = 0
  for (const root of CLAUDE_PROJECT_DIRS) {
    let names
    try { names = readdirSync(join(root, encoded)) } catch { continue }
    for (const name of names) if (name.endsWith('.jsonl')) latest = Math.max(latest, mtime(join(root, encoded, name)))
  }
  return latest
}

// Time of the newest reflog entry. Not the file's mtime: gc and reflog expiry rewrite these files.
function lastReflogTime(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { return 0 }
  const line = text.trimEnd().split('\n').pop() ?? ''
  const seconds = Number(line.split('\t')[0].split(' ').at(-2))
  return Number.isFinite(seconds) ? seconds * 1000 : 0
}

function parseStatus(text) {
  const entries = text.split('\0').filter(Boolean)
  const files = []
  for (let i = 0; i < entries.length; i++) {
    const code = entries[i].slice(0, 2)
    files.push({ code, path: entries[i].slice(3) })
    if (code[0] === 'R' || code[0] === 'C') i++
  }
  return files
}

// What is touching this worktree right now, and when was it last touched.
async function worktreeState(path, live) {
  const status = await run('git', ['-C', path, 'status', '--porcelain=v1', '-z', '--untracked-files=normal'])
  const dirty = status.code === 0 ? parseStatus(status.stdout) : null
  const head = await run('git', ['-C', path, 'log', '-1', '--format=%ct'])
  const gitDir = (await run('git', ['-C', path, 'rev-parse', '--absolute-git-dir'])).stdout.trim()
  const sessions = [...live.sessions.values()].filter((session) => session.panes.some((pane) => inside(pane.path, path)))
  const procs = live.procs.filter((proc) => proc.cwd && inside(proc.cwd, path) && proc.kind !== 'self')
  const sources = {
    commit: Number(head.stdout.trim()) * 1000 || 0,
    checkout: gitDir ? lastReflogTime(join(gitDir, 'logs', 'HEAD')) : 0, // creation, commits, checkouts, resets
    created: (() => { try { return statSync(path).birthtimeMs } catch { return 0 } })(),
    files: Math.max(0, ...(dirty ?? []).slice(0, 500).map((file) => mtime(join(path, file.path)))),
    tmux: Math.max(0, ...sessions.map((session) => session.activity)),
    chat: transcriptActivity(path),
  }
  return {
    dirty,
    sources,
    lastActivity: Math.max(...Object.values(sources)),
    sessions: sessions.map((session) => ({
      id: session.id,
      name: session.name,
      activity: session.activity,
      exclusive: session.panes.every((pane) => inside(pane.path, path)),
    })),
    external: procs.filter((proc) => !proc.pane && !proc.tmuxHook && proc.kind !== 'shell').map((proc) => ({ pid: proc.pid, args: proc.args.slice(0, 120) })),
    running: procs.filter((proc) => proc.kind === 'program').map((proc) => ({ pid: proc.pid, args: proc.args.slice(0, 120) })),
  }
}

// ---------- discovery ----------

function findRepos(roots, maxDepth = 3) {
  const repos = new Set()
  const walk = (dir, depth) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (entries.some((entry) => entry.name === '.git' && entry.isDirectory())) repos.add(realpathSync(dir))
    if (depth >= maxDepth) return
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIP_SCAN.has(entry.name)) walk(join(dir, entry.name), depth + 1)
    }
  }
  for (const root of roots) walk(root, 0)
  return [...repos].sort()
}

function parseWorktrees(text) {
  return text.trim().split('\n\n').filter(Boolean).map((block) => {
    const worktree = {}
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ')
      const value = rest.join(' ')
      if (key === 'worktree') worktree.path = value
      else if (key === 'HEAD') worktree.head = value
      else if (key === 'branch') worktree.branch = value.replace(/^refs\/heads\//, '')
      else if (['detached', 'bare', 'locked', 'prunable'].includes(key)) worktree[key] = value || true
    }
    return worktree
  })
}

async function baseRef(repo) {
  const symbolic = await run('git', ['-C', repo, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
  if (symbolic.code === 0) return symbolic.stdout.trim().replace(/^refs\/remotes\//, '')
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if ((await run('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', ref])).code === 0) return ref
  }
  return null
}

async function loadRepo(path, opts) {
  const origin = (await run('git', ['-C', path, 'remote', 'get-url', 'origin'])).stdout.trim()
  if (origin && opts.fetch) {
    const fetched = await run('git', ['-C', path, 'fetch', '--prune', '--quiet', 'origin'], { timeout: 180_000 })
    if (fetched.code) log(`warn: fetch failed for ${tilde(path)}: ${fetched.stderr.trim().split('\n')[0]}`)
  }
  const base = await baseRef(path)
  const baseTree = base ? (await run('git', ['-C', path, 'rev-parse', `${base}^{tree}`])).stdout.trim() : null
  const slug = origin.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1]
  let prs = null
  if (slug) {
    const list = await run('gh', ['pr', 'list', '-R', slug, '--state', 'all', '--limit', '1000', '--json', 'number,state,headRefName,headRefOid,baseRefName,url,updatedAt'])
    if (list.code === 0) prs = JSON.parse(list.stdout)
    else log(`warn: gh pr list failed for ${slug}; merge detection falls back to git only`)
  }
  const worktrees = parseWorktrees((await run('git', ['-C', path, 'worktree', 'list', '--porcelain'])).stdout)
  return { path, base, baseTree, slug, prs, worktrees }
}

async function mergedReason(repo, worktree, prs) {
  if (!repo.base || !worktree.head) return null
  if ((await run('git', ['-C', repo.path, 'merge-base', '--is-ancestor', worktree.head, repo.base])).code === 0) return `in ${repo.base}`
  const defaultBranch = repo.base.replace(/^origin\//, '')
  const pr = prs.find((candidate) => candidate.state === 'MERGED' && candidate.headRefOid === worktree.head && candidate.baseRefName === defaultBranch)
  if (pr) return `PR #${pr.number} merged`
  const merge = await run('git', ['-C', repo.path, 'merge-tree', '--write-tree', '--no-messages', repo.base, worktree.head])
  if (merge.code === 0 && merge.stdout.trim().split('\n')[0] === repo.baseTree) return `changes already in ${repo.base}`
  return null
}

async function findNodeModules(path, nested) {
  const { stdout } = await run('find', [path, '(', '-name', '.git', '-o', '-name', 'Pods', ')', '-prune', '-o', '-name', 'node_modules', '-type', 'd', '-print', '-prune'], { timeout: 300_000 })
  return stdout.split('\n').filter((dir) => dir && !nested.some((inner) => inside(dir, inner)))
}

// Registered worktrees inside this one. `git worktree remove` deletes them with it, even when
// they hold uncommitted work (e.g. Claude Code's .claude/worktrees, which is usually ignored).
const nestedIn = (path, registered) => [...registered].filter((other) => other !== path && inside(other, path))

async function registeredWorktrees(repoPaths) {
  const lists = await Promise.all(repoPaths.map((repo) => run('git', ['-C', repo, 'worktree', 'list', '--porcelain'])))
  return new Set(lists.flatMap((list) => parseWorktrees(list.stdout).map((worktree) => worktree.path)))
}

// ---------- audit ----------

async function audit(opts) {
  const startedAt = Date.now()
  const roots = opts.roots.length ? opts.roots : [HOME]
  const activeCutoff = startedAt - opts.activeHours * HOUR
  const staleCutoff = startedAt - opts.staleDays * DAY
  const abandonCutoff = startedAt - opts.abandonDays * DAY
  const items = [], left = []
  const counters = {}
  const add = (prefix, item) => { counters[prefix] = (counters[prefix] ?? 0) + 1; items.push({ id: prefix + counters[prefix], ...item }) }
  const here = realpathSync(process.cwd())

  log(`scanning ${roots.map(tilde).join(', ')} for git repositories…`)
  const repoPaths = findRepos(roots)
  log(`found ${repoPaths.length} repositories; fetching and listing PRs…`)
  const repos = await mapLimit(repoPaths, 4, (path) => loadRepo(path, opts))
  const live = await liveState(opts.tmuxSocket)

  const registered = new Set(repos.flatMap((repo) => repo.worktrees.map((worktree) => worktree.path)))
  const candidates = repos.flatMap((repo) => repo.worktrees.slice(1).map((worktree) => ({ repo, worktree })))
  log(`inspecting ${candidates.length} worktrees…`)

  for (const repo of repos) {
    const missing = repo.worktrees.filter((worktree) => worktree.prunable)
    if (missing.length) add('g', { action: 'git-worktree-prune', group: 'housekeeping', auto: true, repo: repo.path, title: `git worktree prune in ${tilde(repo.path)}`, detail: `${missing.length} registered worktree(s) whose folder is gone` })
  }

  const inspected = await mapLimit(candidates, 8, async ({ repo, worktree }) => {
    if (worktree.prunable || worktree.bare || !existsSync(worktree.path)) return null
    const prs = repo.prs?.filter((pr) => worktree.branch && pr.headRefName === worktree.branch) ?? []
    const [state, merged] = await Promise.all([worktreeState(worktree.path, live), mergedReason(repo, worktree, prs)])
    return { repo, worktree, prs, state, merged }
  })

  for (const entry of inspected.filter(Boolean)) {
    const { repo, worktree, prs, state, merged } = entry
    const open = prs.find((pr) => pr.state === 'OPEN')
    const latest = prs[0]
    const pr = open ?? latest
    const base = {
      repo: repo.path, path: worktree.path, branch: worktree.branch ?? null, head: worktree.head,
      pr: pr ? { number: pr.number, state: pr.state, url: pr.url } : null,
      lastActivity: state.lastActivity, activitySources: state.sources,
      sessions: state.sessions, dirtyCount: state.dirty?.length ?? null,
    }
    const facts = [
      merged ?? (pr ? `PR #${pr.number} ${pr.state.toLowerCase()}` : 'no PR'),
      state.dirty === null ? 'git status failed' : state.dirty.length ? `${state.dirty.length} uncommitted` : 'clean',
      `idle ${ago(state.lastActivity)}`,
      ...(state.sessions.length ? [`session ${state.sessions.map((session) => `"${session.name}"`).join(', ')}`] : []),
    ].join(' · ')
    const describe = { ...base, facts }

    if (inside(here, worktree.path)) { left.push({ ...describe, why: 'this agent is running here' }); continue }
    if (worktree.locked) { left.push({ ...describe, why: 'locked' }); continue }
    if (state.dirty === null) { left.push({ ...describe, why: 'git status failed' }); continue }

    const recent = state.lastActivity > activeCutoff
    const stale = state.lastActivity < staleCutoff
    const clean = state.dirty?.length === 0
    const sharedSessions = state.sessions.filter((session) => !session.exclusive)
    const nested = nestedIn(worktree.path, registered)
    let added = null
    const flag = (prefix, item) => { add(prefix, item); added = items.at(-1) }

    if (merged && !open && clean) {
      const blockers = [
        ...(nested.length ? [`contains ${nested.length} nested worktree(s), e.g. ${tilde(nested[0])} — remove those first`] : []),
        ...(repo.slug && !repo.prs ? ['PR status unknown (gh failed)'] : []),
        ...(recent ? [`active ${ago(state.lastActivity)} ago`] : []),
        ...(state.external.length ? [`${state.external.length} process(es) outside tmux: ${state.external.map((proc) => proc.args.split(' ')[0]).join(', ')}`] : []),
        ...(sharedSessions.length ? [`session(s) ${sharedSessions.map((session) => `"${session.name}"`).join(', ')} also use other folders`] : []),
      ]
      const item = { ...describe, action: 'remove-worktree', deleteBranch: Boolean(worktree.branch), force: false }
      if (blockers.length) flag('f', { ...item, group: 'merged-in-use', auto: false, title: `delete merged worktree ${tilde(worktree.path)}`, detail: blockers.join('; ') })
      else flag('d', { ...item, group: 'merged', auto: true, title: tilde(worktree.path) })
    } else if (merged && !open && !recent && !nested.length) {
      flag('f', { ...describe, action: 'remove-worktree', deleteBranch: Boolean(worktree.branch), force: true, auto: false,
        group: state.dirty.every((file) => file.code === '??') ? 'merged-untracked-only' : 'merged-modified',
        title: `force-delete merged worktree ${tilde(worktree.path)}`,
        detail: `merged, but has uncommitted changes: ${state.dirty.slice(0, 5).map((file) => `${file.code.trim()} ${file.path}`).join(', ')}${state.dirty.length > 5 ? ', …' : ''}` })
    } else if (!merged && !open && stale && !nested.length) {
      const closed = latest?.state === 'CLOSED'
      if (closed || state.lastActivity < abandonCutoff) {
        const count = await run('git', ['-C', repo.path, 'rev-list', '--count', worktree.head, '--not', '--remotes'])
        const unpushed = count.code === 0 ? Number(count.stdout.trim()) : null
        // On a branch nothing is lost: uncommitted work becomes a WIP commit and the branch is kept.
        const onBranch = Boolean(worktree.branch)
        const blockers = [
          ...(repo.slug && !repo.prs ? ['PR status unknown (gh failed)'] : []),
          ...(!onBranch && (!clean || unpushed !== 0) ? ['detached HEAD, so its uncommitted work and unpushed commits would be lost'] : []),
          ...(state.external.length ? [`${state.external.length} process(es) outside tmux: ${state.external.map((proc) => proc.args.split(' ')[0]).join(', ')}`] : []),
          ...(sharedSessions.length ? [`session(s) ${sharedSessions.map((session) => `"${session.name}"`).join(', ')} also use other folders`] : []),
        ]
        const kept = [
          clean ? 'clean' : onBranch ? `${state.dirty.length} uncommitted change(s) saved as a WIP commit` : `${state.dirty.length} uncommitted change(s) would be lost`,
          unpushed === null ? 'could not count unpushed commits' : unpushed ? `${unpushed} commit(s) not on any remote (${onBranch ? 'kept on the local branch' : 'on no branch either'})` : 'all commits pushed',
        ]
        // wip: check for hidden edits and save any work before removing; only an approved detached worktree with work is forced.
        const item = { ...describe, action: 'remove-worktree', deleteBranch: false, wip: onBranch || clean, force: !onBranch && !clean }
        const why = closed ? `PR #${latest.number} closed without merge` : latest ? `PR #${latest.number} merged, but later commits are not` : 'no PR'
        if (blockers.length) {
          flag('f', { ...item, group: 'stale-needs-review', auto: false, title: `delete ${closed ? 'closed-PR' : 'abandoned'} worktree ${tilde(worktree.path)}${onBranch ? ' (branch kept)' : ''}`,
            detail: [...blockers, why, ...kept].join('; ') })
        } else {
          flag('s', { ...item, group: 'stale', auto: true, title: `${tilde(worktree.path)} (${onBranch ? `branch ${worktree.branch} kept` : 'detached, nothing unsaved'}${clean ? '' : `; ${state.dirty.length} uncommitted saved as a WIP commit`})`, detail: [why, ...kept].join('; ') })
        }
      }
    }

    if (added?.action === 'remove-worktree' && state.sessions.length) {
      // apply archives these through Commando, which removes the worktree and keeps the branch for Restore.
      added.title += ` → archive session ${state.sessions.filter((session) => !/^(native_app|tilt)-/.test(session.name)).map((session) => `"${session.name}"`).join(', ') || '(helpers only)'} (branch kept)`
      added.deleteBranch = false
    }

    let pruned = false
    if (!added?.auto && stale && !state.running.length) {
      const nodeModules = await findNodeModules(worktree.path, nested)
      if (nodeModules.length) {
        add('p', { ...describe, group: 'ageing-node-modules', action: 'prune-node-modules', auto: true, title: tilde(worktree.path), nodeModules })
        pruned = true
      }
    }
    if (!added && !pruned) {
      left.push({ ...describe, why: nested.length ? 'contains nested worktrees' : recent ? 'active recently' : !stale ? `ageing (<${opts.staleDays}d)` : state.running.length ? `process running: ${state.running[0].args.split(' ')[0]}` : open ? 'open PR, nothing to prune' : 'nothing to prune' })
    }
  }

  // Folders inside *worktrees directories that git no longer knows about.
  const containers = new Set([...registered].map(dirname).filter((dir) => /worktrees$/i.test(basename(dir))))
  for (const container of containers) {
    let entries
    try { entries = readdirSync(container, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const path = join(container, entry.name)
      if (!entry.isDirectory() || entry.name.startsWith('.') || registered.has(path)) continue
      if ([...registered].some((known) => inside(known, path))) continue
      const top = await run('git', ['-C', path, 'rev-parse', '--show-toplevel'])
      const isOwnRepo = top.code === 0 && top.stdout.trim() === path && existsSync(join(path, '.git')) && statSync(join(path, '.git')).isDirectory()
      if (top.code === 0 && top.stdout.trim() === path && !isOwnRepo) continue // a worktree of a repo outside the scan roots
      add('f', { action: 'remove-dir', group: 'unregistered-folders', auto: false, path, lastActivity: mtime(path), title: `delete unregistered folder ${tilde(path)}`,
        detail: isOwnRepo ? 'standalone git clone (not a worktree) — check for unpushed work first' : `not a registered git worktree; modified ${ago(mtime(path))} ago` })
    }
  }

  // tmux sessions whose every pane points at a folder that no longer exists.
  for (const session of live.sessions.values()) {
    if (session.panes.every((pane) => !existsSync(pane.path)) && session.activity < activeCutoff) {
      add('f', { action: 'archive-session', group: 'dead-sessions', auto: false, sessions: [{ id: session.id, name: session.name, activity: session.activity, exclusive: true }], lastActivity: session.activity,
        title: `archive session "${session.name}"`, detail: `every pane is in a deleted folder (${tilde(session.panes[0].path)}); idle ${ago(session.activity)}` })
    }
  }

  if (opts.docker) await auditDocker(opts, add)
  if (items.some((item) => item.auto && ['remove-worktree', 'prune-node-modules'].includes(item.action)) && (await run('pnpm', ['--version'])).code === 0) {
    add('k', { action: 'pnpm-store-prune', group: 'housekeeping', auto: true, title: 'pnpm store prune', detail: 'after node_modules go, drop store packages no project references (runs last, only if something was removed)' })
  }

  // One du per group, so files hard-linked between worktrees (pnpm) are counted once.
  const groupSizes = {}
  if (opts.sizes) {
    const groups = Object.groupBy(items, (item) => item.group)
    log(`measuring ${Object.keys(groups).length} groups (slow on large trees)…`)
    await mapLimit(Object.entries(groups), 4, async ([group, list]) => {
      const paths = list.flatMap((item) => item.nodeModules ?? (item.action === 'remove-worktree' || item.action === 'remove-dir' ? [item.path] : []))
      if (paths.length) groupSizes[group] = await sizeKB(paths)
    })
  }

  const plan = { version: 1, createdAt: startedAt, opts, repos: repoPaths, freeKB: await diskFreeKB(), groupSizes, items, left }
  mkdirSync(STATE_DIR, { recursive: true })
  const planPath = join(STATE_DIR, `plan-${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(planPath, JSON.stringify(plan, null, 2))
  if (opts.json) console.log(JSON.stringify({ planPath, ...plan }, null, 2))
  else console.log(report(plan, planPath))
}

async function auditDocker(opts, add) {
  const info = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15_000 })
  if (info.code) { log('docker: daemon not reachable, skipping'); return }
  const df = (await run('docker', ['system', 'df', '--format', '{{json .}}'])).stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const byType = Object.fromEntries(df.map((row) => [row.Type, row]))
  const until = `until=${opts.staleDays * 24}h`
  add('k', { action: 'docker-cache', group: 'housekeeping', auto: true, title: `Docker build cache, unused images and networks older than ${opts.staleDays}d`,
    detail: `build cache ${byType['Build Cache']?.Size ?? '?'} (reclaimable ${byType['Build Cache']?.Reclaimable ?? '?'}), images reclaimable ${byType.Images?.Reclaimable ?? '?'}`,
    commands: [['builder', 'prune', '--all', '--force', '--filter', until], ['image', 'prune', '--all', '--force', '--filter', until], ['network', 'prune', '--force', '--filter', until]] })

  const stopped = (await run('docker', ['ps', '-a', '--filter', 'status=exited', '--filter', 'status=created', '--format', '{{json .}}'])).stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  if (stopped.length) {
    add('f', { action: 'docker-rm', group: 'docker-containers', auto: false, ids: stopped.map((container) => container.ID), title: `remove ${stopped.length} stopped Docker container(s)`,
      detail: stopped.slice(0, 8).map((container) => `${container.Names} (${container.Image}, ${container.Status})`).join('; ') + (stopped.length > 8 ? '; …' : '') + ' — their writable layers are lost; named volumes are kept' })
  }
  const volumes = (await run('docker', ['volume', 'ls', '-q', '-f', 'dangling=true'])).stdout.split('\n').filter(Boolean)
  if (volumes.length) {
    const named = volumes.filter((name) => !/^[0-9a-f]{64}$/.test(name))
    add('f', { action: 'docker-volume-rm', group: 'docker-volumes', auto: false, ids: volumes, title: `remove ${volumes.length} Docker volume(s) not used by any container`,
      detail: `${byType['Local Volumes']?.Reclaimable ?? '?'} reclaimable; ${named.length} named (may hold database data): ${named.slice(0, 8).join(', ')}${named.length > 8 ? ', …' : ''}` })
  }
}

const GROUPS = {
  merged: 'AUTO · delete merged worktrees (+ local branch); one with a session is archived in Commando instead, branch kept',
  stale: 'AUTO · delete stale unmerged worktrees, branch kept; uncommitted work is saved first as a WIP commit on the branch',
  'ageing-node-modules': 'AUTO · prune node_modules from ageing worktrees',
  housekeeping: 'AUTO · housekeeping',
  'merged-untracked-only': 'merged, only untracked files would be lost → force-delete worktree + branch',
  'merged-modified': 'merged, but tracked files modified → force-delete worktree + branch',
  'merged-in-use': 'merged and clean, but in use → delete worktree + branch, or archive its session',
  'stale-needs-review': 'unmerged and stale, but PR status unknown, in use outside tmux, sharing a session, or detached with work on no branch → delete worktree (WIP commit first when on a branch)',
  'unregistered-folders': 'folders in *worktrees dirs that git does not know → delete folder',
  'dead-sessions': 'tmux sessions whose folders are all gone → archive session (chats stay restorable)',
  'docker-containers': 'stopped Docker containers → docker rm',
  'docker-volumes': 'Docker volumes not attached to any container → docker volume rm',
}

function report(plan, planPath) {
  const lines = [
    `Disk cleanup audit — ${new Date(plan.createdAt).toLocaleString()} — ${human(plan.freeKB)} free`,
    `plan: ${planPath}`,
    `rules: delete = merged into origin + clean + no open PR + idle ≥${plan.opts.activeHours}h; prune node_modules = idle ≥${plan.opts.staleDays}d`,
  ]
  const groups = Object.groupBy(plan.items, (item) => item.group)
  for (const [group, title] of Object.entries(GROUPS)) {
    const list = groups[group]
    if (!list) continue
    const size = plan.groupSizes?.[group] ? `, ~${human(plan.groupSizes[group])}` : ''
    lines.push('', list[0].auto ? `${title} (${list.length}${size})` : `NEEDS APPROVAL · ${group} (${list.length}${size}) — ${title}`)
    for (const item of list) {
      const note = item.auto ? item.facts ?? item.detail : [item.detail, item.facts].filter(Boolean).join(' · ')
      lines.push(`  ${item.id.padEnd(5)} ${item.title}${note ? `  — ${note}` : ''}`)
    }
  }
  if (plan.left.length) {
    const reasons = {}
    for (const item of plan.left) reasons[item.why] = (reasons[item.why] ?? 0) + 1
    lines.push('', `LEFT ALONE (${plan.left.length}): ${Object.entries(reasons).map(([why, count]) => `${count} ${why}`).join(', ')}`)
  }
  lines.push('', plan.opts.sizes
    ? 'Sizes are du estimates (APFS clones still count in full); apply reports the real change in free space.'
    : 'Sizes not measured (pass --sizes; slow). apply reports the real change in free space.')
  return lines.join('\n')
}

// ---------- apply ----------

// Commando archives a session the way its own Archive button does: panes and agent chats are kept for
// Restore, uncommitted work is committed, and the worktree is removed with its branch kept. Killing a
// session would lose its chats, so when Commando can't archive one the item is skipped instead.
async function archiveInCommando(session, socket) {
  // Commando runs on the default tmux server unless COMMANDO_TMUX_SOCKET_NAME names another.
  if ((socket ?? '') !== (process.env.COMMANDO_TMUX_SOCKET_NAME ?? '')) throw new Error(`session "${session.name}" is on tmux server "${socket ?? 'default'}", which this Commando does not manage; it was kept`)
  const pane = process.env.TMUX_PANE
  if (!pane) throw new Error(`run apply from a Commando pane so it can archive session "${session.name}"; it was kept`)
  let token
  try { token = readFileSync(process.env.COMMANDO_AGENT_HOOK_TOKEN_PATH ?? join(HOME, '.commando/agent-hook-token'), 'utf8').trim() }
  catch { throw new Error(`no Commando agent token, so session "${session.name}" could not be archived; it was kept`) }
  const port = Number(process.env.COMMANDO_PORT ?? 4310)
  let response
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/agent-sessions/archive`, {
      method: 'POST', signal: AbortSignal.timeout(300_000),
      headers: { Authorization: `Bearer ${token}`, 'X-Commando-Pane': pane, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, sessionName: session.name }),
    })
  } catch (error) { throw new Error(`Commando is not reachable on port ${port} (${error.message}); session "${session.name}" was kept`) }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const hint = response.status === 401 || (response.status === 404 && !body.error) ? ' (the running Commando may predate agent archiving)' : ''
    throw new Error(`Commando could not archive session "${session.name}": ${body.error ?? `HTTP ${response.status}`}${hint}; it was kept`)
  }
  return body
}

// The recorded sessions still live under the same name, still where the audit found them and idle since.
function liveRecordedSessions(item, ctx) {
  const cutoff = Date.now() - ctx.plan.opts.activeHours * HOUR
  const sessions = []
  for (const recorded of item.sessions ?? []) {
    const session = ctx.live.sessions.get(recorded.id)
    if (!session || session.name !== recorded.name) continue
    if (!session.panes.every((pane) => !existsSync(pane.path))) throw new Error(`session "${session.name}" now has panes in existing folders`)
    if (session.activity > Math.max(recorded.activity, cutoff)) throw new Error(`session "${session.name}" has new activity since audit`)
    sessions.push(session)
  }
  return sessions
}

// A worktree with sessions goes through Commando's Archive, which removes it (committing uncommitted work)
// and keeps the branch so Restore can check it out again; this script deletes neither.
async function archiveWorktreeSessions(item, sessions, ctx) {
  // Commando's generated helpers (tilt-<worktree>, native_app-<worktree>) close with the session they support.
  const helper = new RegExp(`^(native_app|tilt)-${basename(item.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  const owners = sessions.filter((session) => !helper.test(session.name))
  if (!owners.length) throw new Error(`only helper session(s) ${sessions.map((session) => `"${session.name}"`).join(', ')} use it; close them in Commando first`)
  // Each session must be one the audit saw, under the same name, with nothing new in it since.
  const cutoff = Date.now() - ctx.plan.opts.activeHours * HOUR
  for (const session of owners) {
    const recorded = item.sessions?.find((entry) => entry.id === session.id)
    if (!recorded || recorded.name !== session.name) throw new Error(`session "${session.name}" was not there at audit time`)
    if (session.activity > Math.max(recorded.activity, cutoff)) throw new Error(`session "${session.name}" has new activity since audit`)
  }
  const names = owners.map((session) => `"${session.name}"`).join(', ')
  if (ctx.dryRun) return `would archive ${names} in Commando (it commits uncommitted work and removes the worktree; branch ${item.branch ?? 'kept'} kept)`
  const archived = []
  let kept
  for (const session of owners) {
    try {
      const result = await archiveInCommando(session, ctx.socket)
      kept ??= result.worktreeKept
    } catch (error) {
      if (!archived.length) throw error
      kept = error.message
      break
    }
    archived.push(`"${session.name}"`)
    ctx.restore.push(`Commando → Archived → "${session.name}" → Restore   # recreates ${item.path}`)
  }
  if (existsSync(item.path)) return `archived ${archived.join(', ')}; worktree kept${kept ? `: ${kept}` : ''}`
  ctx.removedDeps = true
  return `archived ${archived.join(', ')}; Commando removed the worktree, branch kept${kept ? ` (${kept})` : ''}`
}

// Save every change git would add (ignored files excluded) as a commit on the worktree's branch, the
// way Commando's Archive does. Refuses what a commit can't hold, including edits git hides from status,
// so it runs even when the worktree looks clean. Returns the new HEAD and change count, or null when
// there was nothing to save. A detached worktree passes no message: any change there is refused.
async function saveWorkInProgress(path, message) {
  const git = (args) => run('git', ['-C', path, ...args], { timeout: 600_000 })
  const indexEntries = async () => {
    const listed = await git(['ls-files', '-v', '--stage', '-z'])
    if (listed.code) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`)
    return listed.stdout.split('\0').filter(Boolean) // `<tag> <mode> <object> <stage>\t<path>`
  }
  const gitlinkIn = (entries) => entries.find((line) => line.split(' ')[1] === '160000')?.split('\t')[1]
  const entries = await indexEntries()
  // A submodule's work lives in the folder removal deletes; a commit records only its commit id.
  const submodule = gitlinkIn(entries)
  if (submodule) throw new Error(`contains a submodule at ${submodule}; worktree kept`)
  // assume-unchanged (lowercase tag) and skip-worktree (S) hide edits from add. Sparse-checkout files
  // are S too, but those aren't on disk, so there is nothing to lose.
  const hidden = entries.find((line) => /^[a-z] /.test(line) || (line.startsWith('S ') && onDisk(join(path, line.split('\t')[1]))))
  if (hidden) throw new Error(`git is told to ignore edits to ${hidden.split('\t')[1]} (assume-unchanged or skip-worktree); worktree kept`)
  const status = async () => {
    const result = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'])
    if (result.code) throw new Error(`git status failed: ${result.stderr.trim()}`)
    return parseStatus(result.stdout)
  }
  if ((await status()).some((file) => /^(DD|AU|UD|UA|DU|AA|UU)$/.test(file.code))) throw new Error('unresolved merge conflicts; worktree kept')
  // A nested repository's history lives in its own .git, which no commit of the outer repo holds.
  const nested = await nestedRepository(path)
  if (nested) throw new Error(`contains another git repository at ${nested}; worktree kept`)
  const pending = (await status()).length
  if (!pending) return null
  if (!message) throw new Error('uncommitted changes on a detached HEAD, which no branch would keep; worktree kept')
  // Back up the index file itself, so a refusal after `git add` restores it byte for byte, including
  // skip-worktree (sparse checkout) and intent-to-add entries that a tree would not hold.
  const indexPath = (await git(['rev-parse', '--path-format=absolute', '--git-path', 'index'])).stdout.trim()
  const backup = `${indexPath}.disk-cleanup-backup`
  copyFileSync(indexPath, backup)
  try {
    const added = await git(['add', '--all'])
    if (added.code) throw new Error(`git add failed: ${added.stderr.trim()}`)
    // Backstop for the walk above: anything staged as a bare commit id would drop its files.
    const gitlink = gitlinkIn(await indexEntries())
    if (gitlink) throw new Error(`contains another git repository at ${gitlink}`)
    // No hooks or signing: either could block or prompt with nobody watching.
    const committed = await git(['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--no-verify', '--quiet', '-m', message])
    if (committed.code) throw new Error(`git commit failed: ${(committed.stderr || committed.stdout).trim().split('\n').pop()}`)
  } catch (error) {
    try { renameSync(backup, indexPath) }
    catch (restore) { throw new Error(`${error.message}; the index could not be restored (${restore.message}), its backup is ${backup}; worktree kept`) }
    throw new Error(`${error.message}; worktree kept`)
  }
  rmSync(backup, { force: true })
  const head = (await git(['rev-parse', '--verify', 'HEAD'])).stdout.trim()
  if ((await status()).length) throw new Error(`WIP commit ${head.slice(0, 8)} made, but some changes could not be committed; worktree kept`)
  return { head, count: pending }
}

// The first folder below `root` with its own .git, skipping ignored folders (their contents go with the
// worktree by design). Inside a tracked folder a repository looks like ordinary files to the outer one.
async function nestedRepository(root) {
  const listed = await run('git', ['-C', root, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { timeout: 600_000 })
  if (listed.code) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`)
  const ignored = new Set(listed.stdout.split('\0').filter((entry) => entry.endsWith('/')).map((entry) => join(root, entry.slice(0, -1))))
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true })
    if (dir !== root && entries.some((entry) => entry.name === '.git')) return dir.slice(root.length + 1)
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (!entry.isDirectory() || entry.name === '.git' || ignored.has(child)) continue
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(root)
}

const actions = {
  async 'git-worktree-prune'(item, ctx) {
    if (ctx.dryRun) return 'would prune'
    const result = await run('git', ['-C', item.repo, 'worktree', 'prune'])
    if (result.code) throw new Error(result.stderr.trim())
    return 'pruned'
  },

  async 'remove-worktree'(item, ctx) {
    const current = parseWorktrees((await run('git', ['-C', item.repo, 'worktree', 'list', '--porcelain'])).stdout).find((worktree) => worktree.path === item.path)
    if (!current) throw new Error('no longer a registered worktree')
    if (current.head !== item.head || (current.branch ?? null) !== item.branch) throw new Error(`HEAD/branch moved since audit (${current.branch ?? 'detached'} @ ${current.head.slice(0, 8)})`)
    const nested = nestedIn(item.path, await registeredWorktrees(ctx.plan.repos))
    if (nested.length) throw new Error(`contains nested worktree ${tilde(nested[0])}`)
    const state = await worktreeState(item.path, ctx.live)
    if (state.lastActivity > item.lastActivity + 60_000) throw new Error(`new activity since audit (${ago(state.lastActivity)} ago)`)
    if (state.dirty === null) throw new Error('git status failed')
    // A worktree that was clean at audit time must still be clean; wip items save their work first instead.
    if (!item.force && !item.wip && state.dirty.length) throw new Error('worktree is no longer clean')
    if (item.auto && state.external.length) throw new Error(`process now running outside tmux: ${state.external[0].args}`)
    const shared = state.sessions.filter((session) => !session.exclusive)
    if (shared.length) throw new Error(`session(s) ${shared.map((session) => `"${session.name}"`).join(', ')} also use other folders; archive them from Commando first`)
    if (state.sessions.length) return archiveWorktreeSessions(item, state.sessions, ctx)
    if (ctx.dryRun) return `would ${item.wip ? (item.branch ? `save any uncommitted work as a WIP commit on ${item.branch}, then ` : 'check it has no hidden edits, then ') : ''}remove${item.deleteBranch ? ` and delete branch ${item.branch}` : ''}`
    let note = 'removed'
    const saved = item.wip ? await saveWorkInProgress(item.path, item.branch && `wip: saved by disk-cleanup before removing worktree ${basename(item.path)}`) : null
    if (saved) note = `saved ${saved.count} uncommitted change(s) as WIP commit ${saved.head.slice(0, 8)} on ${item.branch}, removed`
    // After a WIP commit the worktree holds only ignored files, which a plain remove deletes.
    const removed = await run('git', ['-C', item.repo, 'worktree', 'remove', ...(item.force ? ['--force'] : []), item.path], { timeout: 600_000 })
    if (removed.code) throw new Error(`${saved ? `WIP commit ${saved.head.slice(0, 8)} made, but ` : ''}${removed.stderr.trim()}`)
    ctx.removedDeps = true
    ctx.restore.push(item.branch && !item.deleteBranch
      ? `git -C ${item.repo} worktree add ${item.path} ${item.branch}`
      : `git -C ${item.repo} worktree add ${item.path} ${item.head}${item.branch ? `   # branch ${item.branch}` : ''}`)
    if (item.deleteBranch) {
      const deleted = await run('git', ['-C', item.repo, 'branch', '-D', item.branch])
      if (deleted.code === 0) { note += `, branch ${item.branch} deleted`; ctx.restore.push(`git -C ${item.repo} branch ${item.branch} ${item.head}`) }
      else note += `, branch kept (${deleted.stderr.trim()})`
    }
    return note
  },

  async 'prune-node-modules'(item, ctx) {
    const state = await worktreeState(item.path, ctx.live)
    if (state.lastActivity > item.lastActivity + 60_000) throw new Error(`new activity since audit (${ago(state.lastActivity)} ago)`)
    if (state.running.length) throw new Error(`process now running: ${state.running[0].args}`)
    const targets = item.nodeModules.filter((dir) => basename(dir) === 'node_modules' && inside(dir, item.path) && existsSync(dir))
    if (ctx.dryRun) return `would delete ${targets.length} node_modules folder(s)`
    for (const dir of targets) rmSync(dir, { recursive: true, force: true })
    ctx.removedDeps = true
    return `deleted ${targets.length} node_modules folder(s)`
  },

  async 'remove-dir'(item, ctx) {
    if (!existsSync(item.path)) throw new Error('already gone')
    if (mtime(item.path) > item.lastActivity + 60_000) throw new Error('modified since audit')
    if (ctx.live.procs.some((proc) => proc.cwd && inside(proc.cwd, item.path))) throw new Error('a process is using it')
    if (ctx.dryRun) return 'would delete folder'
    rmSync(item.path, { recursive: true, force: true })
    return 'deleted'
  },

  async 'archive-session'(item, ctx) {
    const sessions = liveRecordedSessions(item, ctx)
    if (!sessions.length) throw new Error('session already gone')
    const names = sessions.map((session) => `"${session.name}"`).join(', ')
    if (ctx.dryRun) return `would archive ${names} in Commando`
    for (const session of sessions) {
      await archiveInCommando(session, ctx.socket)
      ctx.restore.push(`Commando → Archived → "${session.name}" → Restore`)
    }
    return `archived ${names}`
  },

  async 'pnpm-store-prune'(item, ctx) {
    if (ctx.dryRun) return 'would run if anything above was removed'
    if (!ctx.removedDeps) return 'nothing removed, skipped'
    const result = await run('pnpm', ['store', 'prune'], { timeout: 1_800_000, cwd: HOME })
    if (result.code) throw new Error(result.stderr.trim().split('\n')[0])
    return 'done'
  },

  async 'docker-cache'(item, ctx) {
    if (ctx.dryRun) return `would run: ${item.commands.map((command) => `docker ${command.join(' ')}`).join('; ')}`
    const notes = []
    for (const command of item.commands) {
      const result = await run('docker', command, { timeout: 900_000 })
      notes.push(result.code ? `docker ${command[0]} failed: ${result.stderr.trim()}` : (result.stdout.match(/Total reclaimed space: .*/)?.[0] ?? `docker ${command[0]} prune done`))
    }
    return notes.join('; ')
  },

  async 'docker-rm'(item, ctx) {
    if (ctx.dryRun) return `would remove ${item.ids.length} container(s)`
    const result = await run('docker', ['rm', ...item.ids])
    if (result.code) throw new Error(`partly failed: ${result.stderr.trim().split('\n')[0]}`)
    return `removed ${item.ids.length} container(s)`
  },

  async 'docker-volume-rm'(item, ctx) {
    if (ctx.dryRun) return `would remove ${item.ids.length} volume(s)`
    const result = await run('docker', ['volume', 'rm', ...item.ids])
    if (result.code) throw new Error(`partly failed: ${result.stderr.trim().split('\n')[0]}`)
    return `removed ${item.ids.length} volume(s)`
  },
}

async function apply(opts) {
  if (!opts.plan) throw new Error('apply needs --plan FILE (printed by audit)')
  if (!opts.auto && !opts.ids.length && !opts.groups.length) throw new Error('apply needs --auto, --groups and/or --ids')
  const plan = JSON.parse(readFileSync(opts.plan, 'utf8'))
  if (Date.now() - plan.createdAt > PLAN_MAX_AGE) throw new Error('plan is more than 2h old; run audit again')
  const unknown = opts.ids.filter((id) => !plan.items.some((item) => item.id === id))
  if (unknown.length) throw new Error(`unknown item id(s): ${unknown.join(', ')}`)
  const unknownGroups = opts.groups.filter((group) => !plan.items.some((item) => item.group === group))
  if (unknownGroups.length) throw new Error(`unknown group(s): ${unknownGroups.join(', ')}`)
  const selected = plan.items.filter((item) => (opts.auto && item.auto) || opts.ids.includes(item.id) || opts.groups.includes(item.group))
    .sort((a, b) => (a.action === 'pnpm-store-prune') - (b.action === 'pnpm-store-prune'))

  const freeBefore = await diskFreeKB()
  const ctx = { plan, dryRun: opts.dryRun, socket: plan.opts.tmuxSocket, live: await liveState(plan.opts.tmuxSocket), restore: [], removedDeps: false }
  const results = []
  for (const item of selected) {
    process.stderr.write(`${item.id.padEnd(4)} ${item.title} … `)
    try {
      if (Date.now() - ctx.live.at > LIVE_MAX_AGE) ctx.live = await liveState(ctx.socket)
      const note = await actions[item.action](item, ctx)
      results.push({ id: item.id, ok: true, note }); log(note)
    } catch (error) {
      results.push({ id: item.id, ok: false, note: error.message }); log(`SKIPPED: ${error.message}`)
    }
  }
  const freeAfter = await diskFreeKB()
  const record = { plan: opts.plan, appliedAt: Date.now(), dryRun: opts.dryRun, freeBefore, freeAfter, results, restore: ctx.restore }
  const logPath = join(STATE_DIR, `log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  if (!opts.dryRun) writeFileSync(logPath, JSON.stringify(record, null, 2))
  const done = results.filter((result) => result.ok).length
  console.log([
    `${opts.dryRun ? 'dry run: ' : ''}${done}/${results.length} item(s) ${opts.dryRun ? 'would apply' : 'applied'}; ${results.length - done} skipped`,
    ...results.filter((result) => !result.ok).map((result) => `  ${result.id}: ${result.note}`),
    `free space: ${human(freeBefore)} → ${human(freeAfter)} (${freeAfter >= freeBefore ? '+' : ''}${human(freeAfter - freeBefore)})`,
    ...(opts.dryRun ? [] : [`log (with restore commands for removed worktrees/branches): ${logPath}`]),
  ].join('\n'))
}

// ---------- cli ----------

function parseArgs(argv) {
  const [command, ...rest] = argv
  const opts = { command, roots: [], staleDays: 3, activeHours: 24, abandonDays: 14, fetch: true, docker: true, sizes: false, json: false, tmuxSocket: null, plan: null, auto: false, ids: [], groups: [], dryRun: false }
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]
    const value = () => { const next = rest[++i]; if (next === undefined) throw new Error(`${flag} needs a value`); return next }
    const number = () => { const parsed = Number(value()); if (!(parsed >= 0)) throw new Error(`${flag} needs a number`); return parsed }
    switch (flag) {
      case '--root': opts.roots.push(realpathSync(resolve(value()))); break
      case '--stale-days': opts.staleDays = number(); break
      case '--active-hours': opts.activeHours = number(); break
      case '--abandon-days': opts.abandonDays = number(); break
      case '--tmux-socket': opts.tmuxSocket = value(); break
      case '--no-fetch': opts.fetch = false; break
      case '--no-docker': opts.docker = false; break
      case '--sizes': opts.sizes = true; break
      case '--json': opts.json = true; break
      case '--plan': opts.plan = resolve(value()); break
      case '--auto': opts.auto = true; break
      case '--groups': opts.groups.push(...value().split(',').map((group) => group.trim()).filter(Boolean)); break
      case '--ids': opts.ids.push(...value().split(',').map((id) => id.trim()).filter(Boolean)); break
      case '--dry-run': opts.dryRun = true; break
      default: throw new Error(`unknown argument: ${flag}`)
    }
  }
  return opts
}

try {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.command === 'audit') await audit(opts)
  else if (opts.command === 'apply') await apply(opts)
  else throw new Error('usage: disk-cleanup.mjs audit [options] | apply --plan FILE (--auto | --ids a,b) [--dry-run]')
} catch (error) {
  console.error(`disk-cleanup: ${error.message}`)
  process.exitCode = 1
}
