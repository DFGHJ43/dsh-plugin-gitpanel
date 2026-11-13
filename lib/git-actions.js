/**
 * Write operations for the GitPanel Host half: fetch, pull, branch creation,
 * commit (with `commit.template` support), and push. Like `git-read.js`, every
 * function takes an injected `runGit(cwd, args, options?)` so the real code can
 * be exercised against scratch repositories by the fixture checks.
 *
 * `runGit` resolves to `{ ok, code?, exitCode?, stdout, stderr, message? }`.
 * Network operations get a longer deadline; none of them ever force, reset, or
 * discard local work.
 */

import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { cleanMessage } from './git-read.js'

/** Network operations run longer than local reads. */
const NETWORK_TIMEOUT_MS = 60_000
/** Commit templates are small text files; anything bigger is not a template. */
const MAX_TEMPLATE_BYTES = 64 * 1024

/** Split command output into trimmed non-empty lines, bounded. */
function lines(text, limit = 40) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
}

/** Classify a failed git command from its stderr; longest-lived causes first. */
export function classifyGitFailure(stderr) {
  const text = String(stderr ?? '')
  if (/CONFLICT|Automatic merge failed|fix conflicts|unmerged|needs merge|not possible to fast-forward/i.test(text)) return 'conflict'
  if (/would be overwritten|local changes|please commit|please stash|your working tree|uncommitted changes/i.test(text)) return 'dirty'
  if (/no upstream|no tracking information|has no upstream branch|couldn't find remote ref|no remote repository specified/i.test(text)) return 'no-upstream'
  if (/\[rejected\]|non-fast-forward|fetch first|failed to push some refs|remote contains work/i.test(text)) return 'rejected'
  if (/authentication failed|could not read username|could not read password|permission denied|publickey|access denied|invalid username or password|terminal prompts disabled/i.test(text)) return 'auth'
  if (/could not resolve host|unable to access|connection refused|connection timed out|connection reset|failed to connect|network is unreachable|ssl|tls handshake|returned error|timed out|early eof/i.test(text)) return 'network'
  if (/hook|pre-commit|prepare-commit-msg|commit-msg|pre-push/i.test(text)) return 'hook-failed'
  if (/Please tell me who you are|unable to auto-detect email|empty ident name/i.test(text)) return 'identity'
  if (/nothing added to commit|nothing to commit/i.test(text)) return 'nothing-to-commit'
  return 'git-failed'
}

/** Map a failed run to the wire shape used by every action route. */
function failure(result, fallbackMessage, code) {
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const message = cleanMessage(result.stderr, '') || cleanMessage(combined, fallbackMessage) || fallbackMessage
  return {
    ok: false,
    code: code ?? result.code ?? classifyGitFailure(combined),
    message,
  }
}

/** Unique conflicted paths for one directory (bounded). */
async function conflictedFiles(runGit, directory) {
  const result = await runGit(directory, ['diff', '--name-only', '--diff-filter=U'])
  return result.ok ? lines(result.stdout, 20) : []
}

/** The common "read the repo root or fail" preamble. */
async function repositoryRoot(runGit, directory) {
  const top = await runGit(directory, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return { error: failure(top, 'This directory is not a Git repository.') }
  return { root: top.stdout.trim() || directory }
}

/** Fetch every remote and prune stale remote-tracking refs; never touches the work tree. */
export async function fetchRemote(runGit, directory, { timeoutMs = NETWORK_TIMEOUT_MS } = {}) {
  const root = await repositoryRoot(runGit, directory)
  if (root.error) return root.error
  const remotesResult = await runGit(root.root, ['remote'])
  const remotes = lines(remotesResult.stdout, 10)
  if (!remotesResult.ok || remotes.length === 0) {
    return { ok: false, code: 'no-remote', message: 'This repository has no configured remote.' }
  }
  const result = await runGit(root.root, ['fetch', '--all', '--prune'], { timeoutMs })
  if (!result.ok) return failure(result, 'Fetching from the remote failed.')
  return { ok: true, remotes }
}

/** Pull the current branch through its configured upstream and merge strategy. */
export async function pullBranch(runGit, directory, { timeoutMs = NETWORK_TIMEOUT_MS } = {}) {
  const root = await repositoryRoot(runGit, directory)
  if (root.error) return root.error
  const upstream = await runGit(root.root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (!upstream.ok) {
    return { ok: false, code: 'no-upstream', message: cleanMessage(upstream.stderr, 'This branch has no upstream branch.') }
  }
  const result = await runGit(root.root, ['pull'], { timeoutMs })
  if (!result.ok) {
    // Merge output (including conflict notices) is printed to stdout.
    const code = classifyGitFailure(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    const payload = failure(result, 'Pulling from the remote failed.', code)
    if (code === 'conflict') payload.files = await conflictedFiles(runGit, root.root)
    return payload
  }
  return { ok: true, upstream: upstream.stdout.trim() }
}

/**
 * Create a branch from the current HEAD and switch to it. `git check-ref-format
 * --branch` decides validity; the caller never passes an unvalidated name on.
 */
export async function createBranch(runGit, directory, name) {
  const root = await repositoryRoot(runGit, directory)
  if (root.error) return root.error
  const branch = String(name ?? '').trim()
  if (!branch) return { ok: false, code: 'invalid-name', message: 'A branch name is required.' }
  const check = await runGit(root.root, ['check-ref-format', '--branch', branch])
  if (!check.ok) {
    return {
      ok: false,
      code: 'invalid-name',
      message: cleanMessage(check.stderr, `Not a valid branch name: ${branch}`),
    }
  }
  const exists = await runGit(root.root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  if (exists.ok) return { ok: false, code: 'exists', message: `Branch already exists: ${branch}`, branch }
  let created = await runGit(root.root, ['switch', '-c', branch])
  if (!created.ok && /is not a git command|unknown option|unrecognized/i.test(created.stderr)) {
    // Git older than 2.23 has no `switch`.
    created = await runGit(root.root, ['checkout', '-b', branch])
  }
  if (!created.ok) return failure(created, `Could not create branch ${branch}.`)
  return { ok: true, branch }
}

/**
 * Commit through the user's staging area: staged changes are committed as they
 * are; when nothing is staged, tracked modifications are staged (`git add -u`,
 * never untracked files) before committing. Unmerged paths block the commit.
 */
export async function commitChanges(runGit, directory, message, { timeoutMs = NETWORK_TIMEOUT_MS } = {}) {
  const root = await repositoryRoot(runGit, directory)
  if (root.error) return root.error
  const text = String(message ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return { ok: false, code: 'empty-message', message: 'The commit message is empty.' }

  const [staged, unstaged, unmerged] = await Promise.all([
    runGit(root.root, ['diff', '--cached', '--quiet']),
    runGit(root.root, ['diff', '--quiet']),
    runGit(root.root, ['diff', '--name-only', '--diff-filter=U']),
  ])
  const conflicts = unmerged.ok ? lines(unmerged.stdout, 20) : []
  if (conflicts.length > 0) {
    return { ok: false, code: 'conflict', message: 'Unmerged paths must be resolved before committing.', files: conflicts }
  }
  const hasStaged = !staged.ok
  const hasUnstaged = !unstaged.ok
  let stagedByPanel = false
  if (!hasStaged) {
    if (!hasUnstaged) {
      return { ok: false, code: 'nothing-to-commit', message: 'There are no staged or tracked changes to commit.' }
    }
    const added = await runGit(root.root, ['add', '-u'])
    if (!added.ok) return failure(added, 'Staging tracked changes failed.')
    stagedByPanel = true
  }

  // Git receives the message as a UTF-8 file, never through a shell or a
  // wrapped command line. `--cleanup=strip` is the same cleanup the terminal
  // editor applies by default: internal blank lines, list markers, and
  // indentation are preserved, only edge whitespace and comments are removed.
  const messagePath = join(tmpdir(), `dsh-gitpanel-commit-${randomUUID()}.msg`)
  let result
  try {
    await writeFile(messagePath, `${text}\n`, 'utf8')
    result = await runGit(root.root, ['commit', '--cleanup=strip', '-F', messagePath], { timeoutMs })
  } finally {
    await unlink(messagePath).catch(() => {
      // A leftover temp file is harmless; the commit result stays authoritative.
    })
  }
  if (!result.ok) {
    const code = /empty commit message|empty message|aborting commit due to empty/i.test(result.stderr)
      ? 'empty-message'
      : /nothing added to commit|nothing to commit/i.test(result.stderr)
        ? 'nothing-to-commit'
        : classifyGitFailure(result.stderr)
    const payload = failure(result, 'Committing failed.', code === 'git-failed' ? 'commit-failed' : code)
    return payload
  }
  const head = await runGit(root.root, ['rev-parse', '--short', 'HEAD'])
  return {
    ok: true,
    commit: head.ok ? head.stdout.trim() : null,
    summary: lines(result.stdout, 1)[0] ?? '',
    stagedByPanel,
  }
}

/** Remotes available for upstream setup, bounded. */
async function remotesOf(runGit, root) {
  const result = await runGit(root, ['remote'])
  return result.ok ? lines(result.stdout, 20) : []
}

/**
 * Push the current branch. Without an upstream the call refuses with
 * `no-upstream` and the remotes to choose from, unless `setUpstream` names one;
 * push is never forced.
 */
export async function pushBranch(runGit, directory, { setUpstream = false, remote, branch, timeoutMs = NETWORK_TIMEOUT_MS } = {}) {
  const root = await repositoryRoot(runGit, directory)
  if (root.error) return root.error
  const current = await runGit(root.root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  const branchName = current.ok ? current.stdout.trim() : ''
  if (!branchName) {
    return { ok: false, code: 'detached', message: 'Cannot push from a detached HEAD.' }
  }
  const remotes = await remotesOf(runGit, root.root)
  if (remotes.length === 0) {
    return { ok: false, code: 'no-remote', message: 'This repository has no configured remote.' }
  }
  const upstream = await runGit(root.root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (!upstream.ok && !setUpstream) {
    return {
      ok: false,
      code: 'no-upstream',
      message: cleanMessage(upstream.stderr, 'This branch has no upstream branch.'),
      branch: branchName,
      remotes,
      suggestedRemote: remotes.includes('origin') ? 'origin' : remotes[0],
    }
  }
  const requestedRemote = typeof remote === 'string' && remotes.includes(remote) ? remote : undefined
  const targetRemote = requestedRemote ?? (remotes.includes('origin') ? 'origin' : remotes[0])
  const pushed = setUpstream
    ? await runGit(root.root, ['push', '--set-upstream', targetRemote, branchName], { timeoutMs })
    : await runGit(root.root, ['push'], { timeoutMs })
  if (!pushed.ok) {
    const payload = failure(pushed, 'Pushing to the remote failed.')
    // A push that needs an upstream retried with explicit setup stays a plain failure.
    return payload
  }
  return {
    ok: true,
    branch: branchName,
    upstream: setUpstream ? `${targetRemote}/${branchName}` : upstream.ok ? upstream.stdout.trim() : null,
  }
}

/**
 * Read the configured `commit.template`. No template is invented when the
 * configuration is absent, so the editor starts from Git's own default (empty).
 */
export async function readCommitTemplate(runGit, directory, { readTextFile, homeDir }) {
  const root = await repositoryRoot(runGit, directory)
  if (root.error) return root.error
  const configured = await runGit(root.root, ['config', '--get', 'commit.template'])
  const configuredPath = configured.ok ? configured.stdout.trim() : ''
  if (!configuredPath) return { ok: true, template: '', source: null }

  let filePath = configuredPath
  if (filePath === '~') filePath = homeDir
  else if (filePath.startsWith('~/') || filePath.startsWith('~\\')) filePath = resolve(homeDir, filePath.slice(2))
  if (!isAbsolute(filePath)) filePath = resolve(root.root, filePath)

  try {
    const raw = await readTextFile(filePath)
    return {
      ok: true,
      template: String(raw ?? '').slice(0, MAX_TEMPLATE_BYTES),
      source: 'commit.template',
      path: filePath,
    }
  } catch {
    return {
      ok: true,
      template: '',
      source: 'commit.template',
      path: filePath,
      warning: 'unreadable-template',
    }
  }
}
