#!/usr/bin/env node
// Audit, then reclaim disk from git worktrees, node_modules, Docker and idle tmux (Commando) sessions.
//
//   disk-cleanup.mjs audit [--root DIR]... [--stale-days 3] [--active-hours 24] [--abandon-days 14]
//                          [--no-fetch] [--no-docker] [--no-sizes] [--tmux-socket NAME]
//   disk-cleanup.mjs apply --plan FILE (--auto | --ids f1,f2 | --auto --ids f1) [--dry-run]
//
// audit writes a plan to ~/.local/state/disk-cleanup/ and prints a report. apply re-checks every
// selected item against live state before acting and writes a log with what it removed.
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

const HOME = homedir()
const STATE_DIR = process.env.DISK_CLEANUP_STATE_DIR ?? join(HOME, '.local/state/disk-cleanup')
const HOUR = 3_600_000, DAY = 24 * HOUR
const PLAN_MAX_AGE = 6 * HOUR
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

function human(kb) {
  if (kb == null) return '?'
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = kb, unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function mtime(path) { try { return lstatSync(path).mtimeMs } catch { return 0 } }

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

async function tmuxPanes(socket) {
  const format = ['#{session_id}', '#{session_name}', '#{session_activity}', '#{pane_pid}', '#{pane_current_path}'].join('\t')
  const { code, stdout } = await run('tmux', [...(socket ? ['-L', socket] : []), 'list-panes', '-a', '-F', format])
  if (code) return []
  return stdout.split('\n').filter(Boolean).map((line) => {
    const [sessionId, sessionName, activity, pid, path] = line.split('\t')
    return { sessionId, sessionName, activity: Number(activity) * 1000, pid: Number(pid), path }
  })
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
  const [panes, procs] = await Promise.all([tmuxPanes(socket), processTable()])
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
      if (/^tmux\b/.test(basename((procs.get(pid)?.args ?? '').split(' ')[0]))) { proc.tmuxHook = true; break } // run-shell / hook children of the server
    }
    const command = basename(proc.args.split(' ')[0]).replace(/^-/, '')
    proc.kind = self.has(proc.pid) ? 'self' : SHELLS.has(command) || command.startsWith('gitstatusd') ? 'shell' : AGENT_RE.test(proc.args) ? 'agent' : 'program'
  }
  // Children of an agent (MCP servers, tool runs) belong to that agent's session.
  for (const proc of procs.values()) {
    if (proc.kind !== 'program') continue
    for (let pid = proc.ppid, hops = 0; pid > 1 && hops < 64; pid = procs.get(pid)?.ppid ?? 0, hops++) {
      if (procs.get(pid)?.kind === 'agent') { proc.kind = 'agent'; break }
    }
  }
  return { panes, sessions, procs: [...procs.values()] }
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
  const sessions = [...live.sessions.values()].filter((session) => session.panes.some((pane) => inside(pane.path, path)))
  const procs = live.procs.filter((proc) => proc.cwd && inside(proc.cwd, path) && proc.kind !== 'self')
  const sources = {
    commit: Number(head.stdout.trim()) * 1000 || 0,
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
    const list = await run('gh', ['pr', 'list', '-R', slug, '--state', 'all', '--limit', '1000', '--json', 'number,state,headRefName,headRefOid,url,updatedAt'])
    if (list.code === 0) prs = JSON.parse(list.stdout)
    else log(`warn: gh pr list failed for ${slug}; merge detection falls back to git only`)
  }
  const worktrees = parseWorktrees((await run('git', ['-C', path, 'worktree', 'list', '--porcelain'])).stdout)
  return { path, base, baseTree, slug, prs, worktrees }
}

async function mergedReason(repo, worktree, prs) {
  if (!repo.base || !worktree.head) return null
  if ((await run('git', ['-C', repo.path, 'merge-base', '--is-ancestor', worktree.head, repo.base])).code === 0) return `in ${repo.base}`
  const pr = prs.find((candidate) => candidate.state === 'MERGED' && candidate.headRefOid === worktree.head)
  if (pr) return `PR #${pr.number} merged`
  const merge = await run('git', ['-C', repo.path, 'merge-tree', '--write-tree', '--no-messages', repo.base, worktree.head])
  if (merge.code === 0 && merge.stdout.trim().split('\n')[0] === repo.baseTree) return `changes already in ${repo.base}`
  return null
}

async function findNodeModules(path) {
  const { stdout } = await run('find', [path, '(', '-name', '.git', '-o', '-name', 'Pods', ')', '-prune', '-o', '-name', 'node_modules', '-type', 'd', '-print', '-prune'], { timeout: 300_000 })
  return stdout.split('\n').filter(Boolean)
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
    if (missing.length) add('g', { action: 'git-worktree-prune', auto: true, repo: repo.path, title: `git worktree prune in ${tilde(repo.path)}`, detail: `${missing.length} registered worktree(s) whose folder is gone` })
  }

  const inspected = await mapLimit(candidates, 8, async ({ repo, worktree }) => {
    if (worktree.prunable || worktree.bare || !existsSync(worktree.path)) return null
    const prs = repo.prs?.filter((pr) => worktree.branch && pr.headRefName === worktree.branch) ?? []
    const [state, merged] = await Promise.all([worktreeState(worktree.path, live), mergedReason(repo, worktree, prs)])
    return { repo, worktree, prs, state, merged }
  })

  const sizeJobs = []
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

    const recent = state.lastActivity > activeCutoff
    const stale = state.lastActivity < staleCutoff
    const clean = state.dirty?.length === 0
    const sharedSessions = state.sessions.filter((session) => !session.exclusive)
    let handled = false

    if (merged && !open && clean) {
      const blockers = [
        ...(recent ? [`active ${ago(state.lastActivity)} ago`] : []),
        ...(state.external.length ? [`${state.external.length} process(es) outside tmux: ${state.external.map((proc) => proc.args.split(' ')[0]).join(', ')}`] : []),
        ...(sharedSessions.length ? [`session(s) ${sharedSessions.map((session) => `"${session.name}"`).join(', ')} also use other folders`] : []),
      ]
      const item = { ...describe, action: 'remove-worktree', deleteBranch: Boolean(worktree.branch), force: false }
      if (blockers.length) add('f', { ...item, auto: false, title: `delete merged worktree ${tilde(worktree.path)}`, detail: blockers.join('; ') })
      else add('d', { ...item, auto: true, title: tilde(worktree.path) })
      sizeJobs.push({ item: items.at(-1), paths: [worktree.path] })
      handled = true
    } else if (merged && !open && !recent) {
      add('f', { ...describe, action: 'remove-worktree', deleteBranch: Boolean(worktree.branch), force: true, auto: false,
        title: `force-delete merged worktree ${tilde(worktree.path)}`,
        detail: `merged, but has uncommitted changes: ${state.dirty.slice(0, 5).map((file) => `${file.code.trim()} ${file.path}`).join(', ')}${state.dirty.length > 5 ? ', …' : ''}` })
      sizeJobs.push({ item: items.at(-1), paths: [worktree.path] })
      handled = true
    } else if (!merged && !open && stale) {
      const closed = latest?.state === 'CLOSED'
      if (closed || state.lastActivity < abandonCutoff) {
        const unpushed = Number((await run('git', ['-C', repo.path, 'rev-list', '--count', worktree.head, '--not', '--remotes'])).stdout.trim()) || 0
        add('f', { ...describe, action: 'remove-worktree', deleteBranch: false, force: !clean, auto: false,
          title: `delete ${closed ? 'closed-PR' : 'abandoned'} worktree ${tilde(worktree.path)} (branch kept)`,
          detail: [closed ? `PR #${latest.number} closed without merge` : `no PR, idle ${ago(state.lastActivity)}`,
            clean ? 'clean' : `${state.dirty.length} uncommitted change(s) would be lost`,
            unpushed ? `${unpushed} commit(s) not on any remote (kept on the local branch)` : 'all commits pushed'].join('; ') })
        sizeJobs.push({ item: items.at(-1), paths: [worktree.path] })
        handled = true
      }
    }

    const autoDelete = items.at(-1)?.path === worktree.path && items.at(-1).auto
    if (!autoDelete && stale && !state.running.length) {
      const nodeModules = await findNodeModules(worktree.path)
      if (nodeModules.length) {
        add('p', { ...describe, action: 'prune-node-modules', auto: true, title: tilde(worktree.path), nodeModules })
        sizeJobs.push({ item: items.at(-1), paths: nodeModules })
        handled = true
      }
    }
    if (!handled) {
      left.push({ ...describe, why: recent ? 'active recently' : !stale ? `ageing (<${opts.staleDays}d)` : state.running.length ? `process running: ${state.running[0].args.split(' ')[0]}` : open ? 'open PR, nothing to prune' : 'nothing to prune' })
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
      add('f', { action: 'remove-dir', auto: false, path, lastActivity: mtime(path), title: `delete unregistered folder ${tilde(path)}`,
        detail: isOwnRepo ? 'standalone git clone (not a worktree) — check for unpushed work first' : `not a registered git worktree; modified ${ago(mtime(path))} ago` })
      sizeJobs.push({ item: items.at(-1), paths: [path] })
    }
  }

  // tmux sessions whose every pane points at a folder that no longer exists.
  for (const session of live.sessions.values()) {
    if (session.panes.every((pane) => !existsSync(pane.path)) && session.activity < activeCutoff) {
      add('f', { action: 'kill-session', auto: false, sessions: [{ id: session.id, name: session.name, activity: session.activity, exclusive: true }], lastActivity: session.activity,
        title: `kill session "${session.name}"`, detail: `every pane is in a deleted folder (${tilde(session.panes[0].path)}); idle ${ago(session.activity)}` })
    }
  }

  if (opts.docker) await auditDocker(opts, add)
  if (items.some((item) => item.auto && ['remove-worktree', 'prune-node-modules'].includes(item.action)) && (await run('pnpm', ['--version'])).code === 0) {
    add('k', { action: 'pnpm-store-prune', auto: true, title: 'pnpm store prune', detail: 'after node_modules go, drop store packages no project references (runs last, only if something was removed)' })
  }

  if (opts.sizes && sizeJobs.length) {
    log(`measuring ${sizeJobs.length} folders…`)
    await mapLimit(sizeJobs, 8, async (job) => { job.item.sizeKB = await sizeKB(job.paths) })
  }

  const plan = { version: 1, createdAt: startedAt, opts, freeKB: await diskFreeKB(), items, left }
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
  add('k', { action: 'docker-cache', auto: true, title: `Docker build cache, unused images and networks older than ${opts.staleDays}d`,
    detail: `build cache ${byType['Build Cache']?.Size ?? '?'} (reclaimable ${byType['Build Cache']?.Reclaimable ?? '?'}), images reclaimable ${byType.Images?.Reclaimable ?? '?'}`,
    commands: [['builder', 'prune', '--all', '--force', '--filter', until], ['image', 'prune', '--all', '--force', '--filter', until], ['network', 'prune', '--force', '--filter', until]] })

  const stopped = (await run('docker', ['ps', '-a', '--filter', 'status=exited', '--filter', 'status=created', '--format', '{{json .}}'])).stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  if (stopped.length) {
    add('f', { action: 'docker-rm', auto: false, ids: stopped.map((container) => container.ID), title: `remove ${stopped.length} stopped Docker container(s)`,
      detail: stopped.slice(0, 8).map((container) => `${container.Names} (${container.Image}, ${container.Status})`).join('; ') + (stopped.length > 8 ? '; …' : '') + ' — their writable layers are lost; named volumes are kept' })
  }
  const volumes = (await run('docker', ['volume', 'ls', '-q', '-f', 'dangling=true'])).stdout.split('\n').filter(Boolean)
  if (volumes.length) {
    const named = volumes.filter((name) => !/^[0-9a-f]{64}$/.test(name))
    add('f', { action: 'docker-volume-rm', auto: false, ids: volumes, title: `remove ${volumes.length} Docker volume(s) not used by any container`,
      detail: `${byType['Local Volumes']?.Reclaimable ?? '?'} reclaimable; ${named.length} named (may hold database data): ${named.slice(0, 8).join(', ')}${named.length > 8 ? ', …' : ''}` })
  }
}

function report(plan, planPath) {
  const lines = []
  const group = (title, list, row) => {
    if (!list.length) return
    const total = list.reduce((sum, item) => sum + (item.sizeKB ?? 0), 0)
    lines.push('', `${title} (${list.length}${total ? `, ~${human(total)}` : ''})`)
    for (const item of list) lines.push(row(item))
  }
  const size = (item) => (item.sizeKB != null ? human(item.sizeKB).padStart(7) : '       ')
  lines.push(`Disk cleanup audit — ${new Date(plan.createdAt).toLocaleString()} — ${human(plan.freeKB)} free`, `plan: ${planPath}`)
  lines.push(`rules: delete = merged into origin + clean + no open PR + idle ≥${plan.opts.activeHours}h; prune node_modules = idle ≥${plan.opts.staleDays}d`)
  const auto = plan.items.filter((item) => item.auto)
  group('AUTO · delete merged worktrees (+ local branch, + their idle tmux sessions)', auto.filter((item) => item.action === 'remove-worktree'),
    (item) => `  ${item.id.padEnd(4)} ${size(item)}  ${item.title}  — ${item.facts}`)
  group('AUTO · prune node_modules from ageing worktrees', auto.filter((item) => item.action === 'prune-node-modules'),
    (item) => `  ${item.id.padEnd(4)} ${size(item)}  ${item.title}  — ${item.facts}`)
  group('AUTO · housekeeping', auto.filter((item) => !['remove-worktree', 'prune-node-modules'].includes(item.action)),
    (item) => `  ${item.id.padEnd(4)}          ${item.title}${item.detail ? `  — ${item.detail}` : ''}`)
  group('NEEDS APPROVAL', plan.items.filter((item) => !item.auto),
    (item) => `  ${item.id.padEnd(4)} ${size(item)}  ${item.title}\n                 ${item.detail}${item.facts ? `\n                 ${item.facts}` : ''}`)
  if (plan.left.length) {
    const reasons = {}
    for (const item of plan.left) reasons[item.why] = (reasons[item.why] ?? 0) + 1
    lines.push('', `LEFT ALONE (${plan.left.length}): ${Object.entries(reasons).map(([why, count]) => `${count} ${why}`).join(', ')}`)
  }
  lines.push('', 'Sizes are du estimates; pnpm hard links/clones mean real savings can be lower. apply reports the actual change in free space.')
  return lines.join('\n')
}

// ---------- apply ----------

async function killSessions(item, socket, live, cutoff) {
  const killed = []
  for (const recorded of item.sessions ?? []) {
    const session = live.sessions.get(recorded.id)
    if (!session || session.name !== recorded.name) continue
    const within = session.panes.every((pane) => (item.path ? inside(pane.path, item.path) : !existsSync(pane.path)))
    if (!within) { log(`  keep session "${session.name}": it now has panes elsewhere`); continue }
    if (session.activity > Math.max(recorded.activity, cutoff)) { log(`  keep session "${session.name}": new activity since audit`); continue }
    const result = await run('tmux', [...(socket ? ['-L', socket] : []), 'kill-session', '-t', session.id])
    if (result.code === 0) killed.push(session.name)
    else log(`  could not kill session "${session.name}": ${result.stderr.trim()}`)
  }
  return killed
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
    const state = await worktreeState(item.path, ctx.live)
    if (state.lastActivity > item.lastActivity + 60_000) throw new Error(`new activity since audit (${ago(state.lastActivity)} ago)`)
    if (!item.force && state.dirty?.length !== 0) throw new Error('worktree is no longer clean')
    if (item.auto && state.external.length) throw new Error(`process now running outside tmux: ${state.external[0].args}`)
    if (ctx.dryRun) return `would remove${item.deleteBranch ? ` and delete branch ${item.branch}` : ''}${item.sessions?.length ? `, kill ${item.sessions.map((session) => `"${session.name}"`).join(', ')}` : ''}`
    const removed = await run('git', ['-C', item.repo, 'worktree', 'remove', ...(item.force ? ['--force'] : []), item.path], { timeout: 600_000 })
    if (removed.code) throw new Error(removed.stderr.trim())
    ctx.removedDeps = true
    ctx.restore.push(`git -C ${item.repo} worktree add ${item.path} ${item.head}${item.branch ? `   # branch ${item.branch}` : ''}`)
    let note = 'removed'
    if (item.deleteBranch) {
      const deleted = await run('git', ['-C', item.repo, 'branch', '-D', item.branch])
      if (deleted.code === 0) { note += `, branch ${item.branch} deleted`; ctx.restore.push(`git -C ${item.repo} branch ${item.branch} ${item.head}`) }
      else note += `, branch kept (${deleted.stderr.trim()})`
    }
    const killed = await killSessions(item, ctx.socket, ctx.live, Date.now() - ctx.plan.opts.activeHours * HOUR)
    if (killed.length) note += `, killed ${killed.map((name) => `"${name}"`).join(', ')}`
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

  async 'kill-session'(item, ctx) {
    if (ctx.dryRun) return `would kill ${item.sessions.map((session) => `"${session.name}"`).join(', ')}`
    const killed = await killSessions(item, ctx.socket, ctx.live, Date.now() - ctx.plan.opts.activeHours * HOUR)
    if (!killed.length) throw new Error('nothing killed')
    return `killed ${killed.join(', ')}`
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
    return result.code ? `partial: ${result.stderr.trim().split('\n')[0]}` : `removed ${item.ids.length} container(s)`
  },

  async 'docker-volume-rm'(item, ctx) {
    if (ctx.dryRun) return `would remove ${item.ids.length} volume(s)`
    const result = await run('docker', ['volume', 'rm', ...item.ids])
    return result.code ? `partial: ${result.stderr.trim().split('\n')[0]}` : `removed ${item.ids.length} volume(s)`
  },
}

async function apply(opts) {
  if (!opts.plan) throw new Error('apply needs --plan FILE (printed by audit)')
  if (!opts.auto && !opts.ids.length) throw new Error('apply needs --auto and/or --ids')
  const plan = JSON.parse(readFileSync(opts.plan, 'utf8'))
  if (Date.now() - plan.createdAt > PLAN_MAX_AGE) throw new Error('plan is more than 6h old; run audit again')
  const unknown = opts.ids.filter((id) => !plan.items.some((item) => item.id === id))
  if (unknown.length) throw new Error(`unknown item id(s): ${unknown.join(', ')}`)
  const selected = plan.items.filter((item) => (opts.auto && item.auto) || opts.ids.includes(item.id))
    .sort((a, b) => (a.action === 'pnpm-store-prune') - (b.action === 'pnpm-store-prune'))

  const freeBefore = await diskFreeKB()
  const ctx = { plan, dryRun: opts.dryRun, socket: plan.opts.tmuxSocket, live: await liveState(plan.opts.tmuxSocket), restore: [], removedDeps: false }
  const results = []
  for (const item of selected) {
    process.stderr.write(`${item.id.padEnd(4)} ${item.title} … `)
    try {
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
  const opts = { command, roots: [], staleDays: 3, activeHours: 24, abandonDays: 14, fetch: true, docker: true, sizes: true, json: false, tmuxSocket: null, plan: null, auto: false, ids: [], dryRun: false }
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
      case '--no-sizes': opts.sizes = false; break
      case '--json': opts.json = true; break
      case '--plan': opts.plan = resolve(value()); break
      case '--auto': opts.auto = true; break
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
