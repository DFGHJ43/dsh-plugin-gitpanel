/**
 * Repository reads and switches for the GitPanel Host half.
 *
 * Every function here takes an injected `runGit(cwd, args)` so the same code
 * that serves the HTTP routes can be exercised against a real repository by the
 * fixture check. `runGit` resolves to
 * `{ ok, code?, exitCode?, stdout, stderr, message? }` and never throws.
 */

import { layoutGraph, parseBranches, parseLog, parseStatusSummary } from './git-core.js'

/** Commit graph window defaults: readable topology, bounded cost. */
export const DEFAULT_COMMIT_LIMIT = 120
export const MAX_COMMIT_LIMIT = 300

/** `git log` fields are separated by unit/record separators, which refs and subjects cannot contain. */
const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%at%x1f%s%x1f%D%x1e'
/** Tab-separated branch rows: control characters are illegal in ref names. */
const BRANCH_FORMAT = '%(refname:short)\t%(HEAD)\t%(objectname)\t%(upstream:short)\t%(upstream:track)'

/** Clamp an untrusted integer to a range. */
export function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** Trim git's stderr to one readable message for the menu banner. */
export function cleanMessage(stderr, fallback) {
  const text = String(stderr ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (!text) return fallback
  return text.length > 600 ? `${text.slice(0, 597)}…` : text
}

/** Map a failed checkout to a stable code the menu can explain. */
function switchFailureCode(result, message) {
  if (/local changes|would be overwritten|please commit|please stash|resolve your current index|cannot switch|your working tree/i.test(message)) {
    return 'dirty'
  }
  if (/not a git repository/i.test(message)) return 'not-a-repo'
  if (result.code === 'timeout') return 'timeout'
  return 'git-failed'
}

/**
 * Read the current branch, the local branch list, and (unless `light`) the
 * commit graph and working-tree dirtiness for one directory. Returns a
 * `repo: false` payload instead of failing when the directory is not a repo.
 *
 * Every git command runs in one parallel wave directly in `directory`: git
 * discovers the repository from any subdirectory, so no command needs the
 * toplevel result first. The light read is the trigger's poll; the full read
 * costs four processes in the same wave (`status --porcelain=v2 --branch`
 * carries branch, head, upstream, ahead/behind, and dirtiness at once).
 */
export async function readState(runGit, directory, { light = false, commitLimit = DEFAULT_COMMIT_LIMIT } = {}) {
  const limit = clampInt(commitLimit, 1, MAX_COMMIT_LIMIT, DEFAULT_COMMIT_LIMIT)
  const [top, symbolicRef, headRevision, branchRefs, log, status] = await Promise.all([
    runGit(directory, ['rev-parse', '--show-toplevel']),
    light ? runGit(directory, ['symbolic-ref', '--short', '-q', 'HEAD']) : Promise.resolve(undefined),
    light ? runGit(directory, ['rev-parse', '--verify', '--short', 'HEAD']) : Promise.resolve(undefined),
    light ? Promise.resolve(undefined) : runGit(directory, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads']),
    light
      ? Promise.resolve(undefined)
      // One extra commit tells the menu whether the window was truncated.
      : runGit(directory, ['log', '--all', '--topo-order', '--no-color', '-n', String(limit + 1), `--pretty=format:${LOG_FORMAT}`]),
    light ? Promise.resolve(undefined) : runGit(directory, ['status', '--porcelain=v2', '--branch']),
  ])

  if (!top.ok) {
    if (/not a git repository/i.test(top.stderr)) return { repo: false, reason: 'not-a-repo' }
    if (top.code === 'timeout') return { repo: false, reason: 'timeout', message: top.message }
    if (top.code === 'git-missing' || top.code === 'no-subprocess') {
      return { repo: false, reason: top.code, message: top.message }
    }
    return { repo: false, reason: 'git-error', message: cleanMessage(top.stderr, 'git could not read this directory.') }
  }
  const root = top.stdout.trim() || directory

  if (light) {
    const rawBranch = symbolicRef.ok ? symbolicRef.stdout.trim() : ''
    const branch = rawBranch || null
    const head = headRevision.ok && headRevision.stdout.trim() ? headRevision.stdout.trim() : null
    const detached = branch === null && head !== null
    return { repo: true, root, branch, detached, head, empty: head === null }
  }

  // The full read takes branch facts from the status summary; a status failure
  // (unusual) falls back to the two ref commands rather than misreporting.
  const summary = parseStatusSummary(status.ok ? status.stdout : '')
  let branch = summary.detached ? null : summary.branch
  let head = summary.head
  let detached = summary.detached
  if (!status.ok) {
    const [symbolic, revision] = await Promise.all([
      runGit(directory, ['symbolic-ref', '--short', '-q', 'HEAD']),
      runGit(directory, ['rev-parse', '--verify', '--short', 'HEAD']),
    ])
    branch = symbolic.ok && symbolic.stdout.trim() ? symbolic.stdout.trim() : null
    head = revision.ok && revision.stdout.trim() ? revision.stdout.trim() : null
    detached = branch === null && head !== null
  }
  const empty = head === null

  const branches = parseBranches(branchRefs.ok ? branchRefs.stdout : '')
  const current = detached ? null : branch
  for (const entry of branches) entry.current = entry.name === current
  if (current !== null && !branches.some((entry) => entry.name === current)) {
    // An unborn branch (fresh `git init`, no commit yet) has no ref of its own.
    branches.unshift({
      name: current,
      current: true,
      tip: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      gone: false,
      unborn: true,
    })
  }
  branches.sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1
    return left.name.localeCompare(right.name, 'en')
  })

  const parsed = log.ok ? parseLog(log.stdout) : []
  const truncated = parsed.length > limit
  const commits = truncated ? parsed.slice(0, limit) : parsed
  // `%D` cannot tell a local branch from a remote-tracking name when either
  // contains "/", so classify against the branch list this repo actually has.
  const branchNames = new Set(branches.map((entry) => entry.name))
  for (const commit of commits) {
    for (const ref of commit.refs) {
      if (ref.kind === 'head' || ref.kind === 'branch') continue
      if (branchNames.has(ref.name)) ref.kind = 'branch'
    }
  }
  const graph = layoutGraph(commits)
  const laneOf = new Map(graph.rows.map((row) => [row.hash, row.lane]))
  for (const entry of branches) entry.tipLane = entry.tip ? (laneOf.get(entry.tip) ?? null) : null

  return {
    repo: true,
    root,
    branch: current,
    detached,
    head,
    empty,
    branches,
    commits: graph.rows,
    edges: graph.edges,
    laneCount: graph.laneCount,
    truncated,
    commitLimit: limit,
    dirtyCount: summary.dirtyCount,
    stagedCount: summary.stagedCount,
    unstagedCount: summary.unstagedCount,
    untrackedCount: summary.untrackedCount,
    conflictCount: summary.conflictCount,
  }
}

/**
 * Check out one existing local branch in `directory` and return the refreshed
 * state. Git's own refusal (uncommitted work that would be overwritten) is
 * preserved as a `dirty` failure carrying git's message.
 */
export async function switchBranch(runGit, directory, target) {
  const top = await runGit(directory, ['rev-parse', '--show-toplevel'])
  if (!top.ok) {
    return {
      ok: false,
      code: /not a git repository/i.test(top.stderr) ? 'not-a-repo' : 'git-failed',
      message: cleanMessage(top.stderr, 'This directory is not a Git repository.'),
    }
  }
  const root = top.stdout.trim() || directory

  // Only a branch this repository lists may be checked out.
  const exists = await runGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${target}`])
  if (!exists.ok) {
    return { ok: false, code: 'not-found', message: `Branch does not exist: ${target}` }
  }

  let switched = await runGit(root, ['switch', target])
  if (!switched.ok && /is not a git command|unknown option|unrecognized/i.test(switched.stderr)) {
    // Git older than 2.23 has no `switch`; `checkout` keeps the same safety rules.
    switched = await runGit(root, ['checkout', target])
  }
  if (!switched.ok) {
    const message = cleanMessage(switched.stderr, `Failed to switch to ${target}.`)
    return { ok: false, code: switchFailureCode(switched, message), message }
  }

  return { ok: true, branch: target, state: await readState(runGit, directory, { commitLimit: DEFAULT_COMMIT_LIMIT }) }
}
