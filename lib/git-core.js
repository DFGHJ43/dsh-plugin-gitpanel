/**
 * Pure helpers for the GitPanel Host half: parsing `git` output and laying out
 * the commit graph the browser draws. No Node, Cordis, or subprocess APIs are
 * used here so the layout stays testable on its own.
 */

/** Field separator for `git log --pretty=format:`. */
const FIELD = '\x1f'
/** Record separator for `git log --pretty=format:`. */
const RECORD = '\x1e'
/** Strip control characters a commit message could smuggle into the wire. */
const CONTROL = /[\u0000-\u001f\u007f]+/g

/** Collapse one git-provided string to a single printable line. */
export function sanitizeText(value, maxLength = 300) {
  const text = String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

/**
 * Parse one `%D` decoration list into typed refs. `%D` renders local branches,
 * `HEAD -> branch`, remote-tracking names, and tags.
 */
export function parseRefs(decoration) {
  const refs = []
  for (const raw of String(decoration ?? '').split(',')) {
    const item = raw.trim()
    if (!item) continue
    if (item.startsWith('HEAD -> ')) {
      refs.push({ kind: 'head', name: sanitizeText(item.slice(8), 200) })
    } else if (item === 'HEAD') {
      refs.push({ kind: 'detached', name: 'HEAD' })
    } else if (item.startsWith('tag: ')) {
      refs.push({ kind: 'tag', name: sanitizeText(item.slice(5), 200) })
    } else if (item.includes('/')) {
      refs.push({ kind: 'remote', name: sanitizeText(item, 200) })
    } else {
      refs.push({ kind: 'branch', name: sanitizeText(item, 200) })
    }
  }
  return refs
}

/** Parse the NUL-safe record stream produced by the `git log` format below. */
export function parseLog(text) {
  const commits = []
  const seen = new Set()
  for (const chunk of String(text ?? '').split(RECORD)) {
    const record = chunk.replace(/^\n+/, '')
    if (!record) continue
    const [hash, parents, author, time, subject, decoration] = record.split(FIELD)
    if (!hash || !/^[0-9a-f]{4,64}$/i.test(hash.trim())) continue
    const id = hash.trim()
    if (seen.has(id)) continue
    seen.add(id)
    commits.push({
      hash: id,
      parents: String(parents ?? '').split(' ').filter(Boolean),
      author: sanitizeText(author, 120),
      time: Number(time) || 0,
      subject: sanitizeText(subject, 300),
      refs: parseRefs(decoration),
    })
  }
  return commits
}

/** Parse `for-each-ref` rows (tab separated) into the branch list. */
export function parseBranches(text) {
  const branches = []
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    const [name, head, tip, upstream, track] = line.split('\t')
    if (!name) continue
    const sync = /ahead\s+(\d+)/i.exec(track ?? '')
    const behind = /behind\s+(\d+)/i.exec(track ?? '')
    branches.push({
      name,
      current: String(head ?? '').trim() === '*',
      tip: String(tip ?? '').trim() || null,
      upstream: String(upstream ?? '').trim() || null,
      ahead: sync ? Number(sync[1]) : 0,
      behind: behind ? Number(behind[1]) : 0,
      gone: /gone/i.test(track ?? ''),
      unborn: false,
    })
  }
  return branches
}

/**
 * Parse `git status --porcelain=v2 --branch` into the current branch summary:
 * head oid, current branch (or detached), upstream tracking, and the dirty
 * entry count. This one command replaces separate ref, head, and status reads.
 */
export function parseStatusSummary(text) {
  const summary = {
    branch: null,
    head: null,
    detached: false,
    empty: false,
    dirtyCount: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    upstream: null,
    ahead: 0,
    behind: 0,
  }
  for (const line of String(text ?? '').split('\n')) {
    if (!line) continue
    if (line.startsWith('# branch.oid ')) {
      const value = line.slice('# branch.oid '.length).trim()
      if (value === '(initial)') summary.empty = true
      else if (value) summary.head = value.slice(0, 7)
    } else if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim()
      if (value === '(detached)') summary.detached = true
      else if (value) summary.branch = value
    } else if (line.startsWith('# branch.upstream ')) {
      summary.upstream = line.slice('# branch.upstream '.length).trim() || null
    } else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line)
      if (match) {
        summary.ahead = Number(match[1])
        summary.behind = Number(match[2])
      }
    } else if (!line.startsWith('#')) {
      // Every remaining row is one changed or untracked path.
      summary.dirtyCount += 1
      if (line.startsWith('? ')) {
        summary.untrackedCount += 1
      } else if (line.startsWith('u ')) {
        summary.conflictCount += 1
      } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
        const index = line.charAt(2)
        const worktree = line.charAt(3)
        if (index !== '.') summary.stagedCount += 1
        if (worktree !== '.') summary.unstagedCount += 1
      }
    }
  }
  return summary
}

/**
 * Assign every commit a lane (column) for a top-down graph and derive the
 * edges the browser draws. `commits` must be newest-first (`--topo-order`) so
 * every parent appears after its children. Neighbouring lanes keep a branch
 * contiguous, merges fan into their existing lane, and freed lanes are reused
 * by the next tip so the graph stays narrow.
 */
export function layoutGraph(commits) {
  const indexOf = new Map()
  commits.forEach((commit, index) => {
    if (!indexOf.has(commit.hash)) indexOf.set(commit.hash, index)
  })

  /** Lane slots: a commit hash expected next in that lane, or null when free. */
  const lanes = []
  const rows = []
  let widest = 1

  const freeLane = () => {
    const free = lanes.findIndex((value) => value == null)
    if (free !== -1) return free
    lanes.push(null)
    return lanes.length - 1
  }

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index]
    let lane = lanes.indexOf(commit.hash)
    if (lane === -1) lane = freeLane()
    // A commit reached by two still-open lanes becomes one node in the leftmost
    // of them; every other lane stops waiting for it here.
    for (let other = 0; other < lanes.length; other += 1) {
      if (other !== lane && lanes[other] === commit.hash) lanes[other] = null
    }
    lanes[lane] = null

    // The first parent continues the current lane; extra parents (a merge)
    // join an existing lane when one already follows them, otherwise they open
    // a new lane.
    const knownParents = commit.parents.filter((parent) => {
      const parentIndex = indexOf.get(parent)
      return parentIndex !== undefined && parentIndex > index
    })
    if (knownParents.length > 0) {
      lanes[lane] = knownParents[0]
      for (const parent of knownParents.slice(1)) {
        if (lanes.includes(parent)) continue
        lanes[freeLane()] = parent
      }
    }
    widest = Math.max(widest, lane + 1, lanes.length)

    rows.push({
      hash: commit.hash,
      short: commit.hash.slice(0, 7),
      parents: commit.parents,
      subject: commit.subject,
      author: commit.author,
      time: commit.time,
      refs: commit.refs,
      merge: commit.parents.length > 1,
      lane,
    })
  }

  const laneCount = Math.max(1, widest)

  const rowOf = new Map(rows.map((row, index) => [row.hash, index]))
  const laneOf = new Map(rows.map((row) => [row.hash, row.lane]))
  const edges = []
  rows.forEach((row, fromRow) => {
    for (const parent of row.parents) {
      const toRow = rowOf.get(parent)
      if (toRow === undefined) continue
      edges.push({
        fromRow,
        fromLane: row.lane,
        toRow,
        toLane: laneOf.get(parent),
        parent,
      })
    }
  })

  return { rows, edges, laneCount }
}
