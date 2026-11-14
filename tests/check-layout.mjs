/**
 * Fixture check for the Host git layer: drive `readState` and `switchBranch`
 * from lib/git-read.js against a scratch repository built by tests/fixture.mjs,
 * plus a throwaway repository for the failure paths.
 *
 * Child output is captured through files rather than pipes because the agent
 * sandbox denies named pipes; the plugin's own git runner is unaffected.
 */
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { readState, switchBranch } from '../lib/git-read.js'
import { parseStatusSummary } from '../lib/git-core.js'
import { createFixtureRepo } from './fixture.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out')
mkdirSync(out, { recursive: true })
// Built fresh here so the assertions never depend on the plugin's own checkout.
const repo = join(out, 'fixture-repo')
rmSync(repo, { recursive: true, force: true })
mkdirSync(repo, { recursive: true })

let run = 0
const runGit = async (cwd, args) => {
  const stdoutPath = join(out, `raw-${run}.out`)
  const stderrPath = join(out, `raw-${run}.err`)
  run += 1
  const outFd = openSync(stdoutPath, 'w')
  const errFd = openSync(stderrPath, 'w')
  const status = await new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
    })
    child.on('error', () => resolve(-1))
    child.on('close', (code) => resolve(code ?? -1))
  })
  closeSync(outFd)
  closeSync(errFd)
  return {
    ok: status === 0,
    exitCode: status,
    stdout: readFileSync(stdoutPath, 'utf8'),
    stderr: readFileSync(stderrPath, 'utf8'),
  }
}

const git = async (cwd, ...args) => {
  const result = await runGit(cwd, args)
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result
}

const failures = []
const check = (name, condition, detail) => {
  if (condition) return
  failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ---------------------------------------------------------------- main fixture
await createFixtureRepo(runGit, repo)
const mainNotePath = join(repo, 'docs', 'main-note.md')
const originalMainNote = readFileSync(mainNotePath, 'utf8')

const lightState = await readState(runGit, repo, { light: true })
check('light branch', lightState.branch === 'main', JSON.stringify(lightState.branch))
check('light omits branches', lightState.branches === undefined)

const state = await readState(runGit, repo)
check('repo detected', state.repo === true)
check('root reported', state.root.endsWith('fixture-repo'), state.root)
check('current branch', state.branch === 'main', state.branch)
check('head short hash', /^[0-9a-f]{7}$/.test(state.head ?? ''), state.head)
check('not detached', state.detached === false)
check('branch list size', state.branches.length === 3, `got ${state.branches.length}`)
check('current branch first', state.branches[0].name === 'main' && state.branches[0].current === true)
check('current branch has tip lane', state.branches[0].tipLane !== null, JSON.stringify(state.branches[0]))
check('merged branch keeps its tip', state.branches.find((branch) => branch.name === 'feature/graph')?.tip !== null)
check('commit count', state.commits.length === 5, `got ${state.commits.length}`)
check('lane count', state.laneCount === 3, `got ${state.laneCount}`)
check('edge count', state.edges.length === 5, `got ${state.edges.length}`)
// Row order among sibling branches can vary with identical commit timestamps, so
// locate the merge commit by subject instead of by index.
const mergeRow = state.commits.find((commit) => /^Merge branch 'feature\/graph'/.test(commit.subject))
check('merge row flagged', mergeRow?.merge === true, JSON.stringify(mergeRow?.subject))
check('dirty count is a number', Number.isInteger(state.dirtyCount), String(state.dirtyCount))
check('truncated flag off', state.truncated === false)
const featureRow = state.commits.find((commit) => commit.subject === 'Document the commit graph window')
check('slashed branch classified as branch', featureRow?.refs.every((ref) => ref.kind !== 'remote'), JSON.stringify(featureRow?.refs))
for (const edge of state.edges) {
  check('edge points forward', edge.toRow > edge.fromRow, `${edge.fromRow}->${edge.toRow}`)
  check('edge lane matches target', state.commits[edge.toRow].lane === edge.toLane)
}

// `git status --porcelain=v2 --branch` is the full read's branch source.
const dirtyStatus = parseStatusSummary([
  '# branch.oid abc1234567890',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -3',
  '1 .M N... 100644 100644 100644 a b file.txt',
  '? untracked.txt',
].join('\n'))
check('status summary branch', dirtyStatus.branch === 'main' && dirtyStatus.head === 'abc1234', JSON.stringify(dirtyStatus))
check('status summary sync', dirtyStatus.ahead === 2 && dirtyStatus.behind === 3 && dirtyStatus.upstream === 'origin/main')
check('status summary dirty', dirtyStatus.dirtyCount === 2, String(dirtyStatus.dirtyCount))
const detachedStatus = parseStatusSummary('# branch.oid abc1234def\n# branch.head (detached)\n')
check('status summary detached', detachedStatus.detached === true && detachedStatus.branch === null)
const unbornStatus = parseStatusSummary('# branch.oid (initial)\n# branch.head main\n')
check('status summary unborn', unbornStatus.empty === true && unbornStatus.branch === 'main')

const switched = await switchBranch(runGit, repo, 'hotfix/icon')
check('switch succeeded', switched.ok === true, JSON.stringify(switched).slice(0, 300))
check('switch reports branch', switched.branch === 'hotfix/icon')
check('switch refreshes state', switched.state?.branch === 'hotfix/icon', switched.state?.branch)
check('switched row is current', switched.state?.branches.find((branch) => branch.current)?.name === 'hotfix/icon')

const back = await switchBranch(runGit, repo, 'main')
check('switch back', back.ok === true && back.state?.branch === 'main', JSON.stringify(back).slice(0, 200))
check('fixture left on main', (await runGit(repo, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim() === 'main')
check('fixture note restored', readFileSync(mainNotePath, 'utf8') === originalMainNote)

const missing = await switchBranch(runGit, repo, 'does-not-exist')
check('missing branch refused', missing.ok === false && missing.code === 'not-found', JSON.stringify(missing))

// ------------------------------------------------------------- throwaway repos
const scratch = join(out, 'scratch')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })

// Git's own safety: an uncommitted change to a file that differs between the
// branches must block the checkout.
const dirtyRepo = join(scratch, 'dirty')
mkdirSync(dirtyRepo)
await git(dirtyRepo, 'init', '-b', 'main')
await git(dirtyRepo, 'config', 'user.name', 'GitPanel Test')
await git(dirtyRepo, 'config', 'user.email', 'gitpanel@example.com')
writeFileSync(join(dirtyRepo, 'file.txt'), 'base\n')
await git(dirtyRepo, 'add', '-A')
await git(dirtyRepo, 'commit', '-m', 'base')
await git(dirtyRepo, 'checkout', '-b', 'other')
writeFileSync(join(dirtyRepo, 'file.txt'), 'other branch\n')
await git(dirtyRepo, 'add', '-A')
await git(dirtyRepo, 'commit', '-m', 'other change')
await git(dirtyRepo, 'checkout', 'main')
writeFileSync(join(dirtyRepo, 'file.txt'), 'uncommitted local edit\n')
const blocked = await switchBranch(runGit, dirtyRepo, 'other')
check('dirty switch refused', blocked.ok === false, JSON.stringify(blocked).slice(0, 200))
check('dirty switch code', blocked.code === 'dirty', blocked.code)
check('dirty switch carries git message', /local changes|would be overwritten/i.test(blocked.message ?? ''), blocked.message)
writeFileSync(join(dirtyRepo, 'file.txt'), 'base\n')

// Unborn branch: a fresh `git init` with no commit yet.
const unbornRepo = join(scratch, 'unborn')
mkdirSync(unbornRepo)
await git(unbornRepo, 'init', '-b', 'main')
const unborn = await readState(runGit, unbornRepo)
check('unborn repo detected', unborn.repo === true)
check('unborn branch listed', unborn.branches[0]?.name === 'main' && unborn.branches[0]?.unborn === true, JSON.stringify(unborn.branches))
check('unborn has no commits', unborn.commits.length === 0 && unborn.empty === true)

// Detached HEAD reports the hash instead of a branch.
await git(dirtyRepo, 'checkout', '--detach', 'HEAD')
const detached = await readState(runGit, dirtyRepo, { light: true })
check('detached head detected', detached.detached === true && detached.branch === null, JSON.stringify(detached))
const detachedFull = await readState(runGit, dirtyRepo)
check(
  'detached full read',
  detachedFull.repo === true && detachedFull.detached === true && detachedFull.branch === null && detachedFull.commits.length > 0,
  JSON.stringify({ repo: detachedFull.repo, detached: detachedFull.detached, branch: detachedFull.branch, commits: detachedFull.commits.length }),
)
check('detached full read marks no current branch', detachedFull.branches.every((branch) => branch.current === false))

// A directory outside any repository is reported as such.
const notRepo = await readState(runGit, tmpdir(), { light: true })
check('non-repo detected', notRepo.repo === false && notRepo.reason === 'not-a-repo', JSON.stringify(notRepo))

// Long branch names survive the read path intact (the panel renders them whole).
const longNamesRepo = join(scratch, 'long-branches')
mkdirSync(longNamesRepo)
await git(longNamesRepo, 'init', '--initial-branch=master')
await git(longNamesRepo, 'config', 'user.name', 'GitPanel Test')
await git(longNamesRepo, 'config', 'user.email', 'gitpanel@example.com')
writeFileSync(join(longNamesRepo, 'a.txt'), 'a\n')
await git(longNamesRepo, 'add', '-A')
await git(longNamesRepo, 'commit', '-m', 'feat: long branch badge probe')
await git(longNamesRepo, 'branch', 'feature/xxx')
await git(longNamesRepo, 'branch', 'feature/very-long-branch-name')
const longNamesState = await readState(runGit, longNamesRepo)
const branchNames = longNamesState.branches.map((branch) => branch.name)
check('short branch name intact', branchNames.includes('master'), JSON.stringify(branchNames))
check('medium branch name intact', branchNames.includes('feature/xxx'), JSON.stringify(branchNames))
check('very long branch name intact', branchNames.includes('feature/very-long-branch-name'), JSON.stringify(branchNames))
const badgeRefNames = longNamesState.commits.flatMap((commit) => commit.refs.map((ref) => ref.name))
check(
  'badge refs keep the full branch name',
  badgeRefNames.includes('feature/xxx') && badgeRefNames.includes('feature/very-long-branch-name'),
  JSON.stringify(badgeRefNames),
)
check('no truncated badge names in the data', badgeRefNames.every((name) => !/(\.\.\.|…)$/.test(name)), JSON.stringify(badgeRefNames))

rmSync(scratch, { recursive: true, force: true })

console.log(JSON.stringify({
  ok: failures.length === 0,
  failures,
  branch: state.branch,
  branches: state.branches.map((branch) => ({ name: branch.name, current: branch.current, tipLane: branch.tipLane })),
  commits: state.commits.map((commit) => ({ short: commit.short, lane: commit.lane, subject: commit.subject, refs: commit.refs.map((ref) => `${ref.kind}:${ref.name}`) })),
  edges: state.edges,
  laneCount: state.laneCount,
  blocked: { ok: blocked.ok, code: blocked.code, message: blocked.message },
}, null, 2))
