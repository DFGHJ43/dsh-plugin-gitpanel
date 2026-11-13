/**
 * Integration checks for the write operations: fetch, pull (fast-forward and
 * conflict), branch creation, commit (staged, tracked fallback, template,
 * failure paths), and push (upstream setup, rejection). Runs real git against a
 * bare "remote" plus two clones under tests/out/scratch.
 *
 * Child output is captured through files rather than pipes because the agent
 * sandbox may deny named pipes; the plugin's own runner is unaffected.
 */
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  commitChanges, createBranch, fetchRemote, pullBranch, pushBranch, readCommitTemplate,
} from '../lib/git-actions.js'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out')
const scratch = join(out, 'actions')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })

const remotePath = join(scratch, 'remote.git')
const workPath = join(scratch, 'work')
const otherPath = join(scratch, 'other')
const plainPath = join(scratch, 'plain')

let run = 0
const runGit = async (cwd, args, options = {}) => {
  const stdoutPath = join(scratch, `raw-${run}.out`)
  const stderrPath = join(scratch, `raw-${run}.err`)
  const stdinPath = join(scratch, `raw-${run}.in`)
  run += 1
  const outFd = openSync(stdoutPath, 'w')
  const errFd = openSync(stderrPath, 'w')
  if (options.stdin !== undefined) writeFileSync(stdinPath, String(options.stdin))
  // The child needs a readable descriptor; a write-only handle fails with EBADF.
  const stdinFd = options.stdin === undefined ? undefined : openSync(stdinPath, 'r')
  const status = await new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      stdio: [stdinFd ?? 'ignore', outFd, errFd],
      windowsHide: true,
    })
    child.on('error', () => resolve(-1))
    child.on('close', (code) => resolve(code ?? -1))
  })
  closeSync(outFd)
  closeSync(errFd)
  if (stdinFd !== undefined) closeSync(stdinFd)
  return {
    ok: status === 0,
    exitCode: status,
    stdout: readFileSync(stdoutPath, 'utf8'),
    stderr: readFileSync(stderrPath, 'utf8'),
  }
}

const git = async (cwd, ...args) => {
  const result = await runGit(cwd, args)
  if (!result.ok) throw new Error(`git ${args.join(' ')} (${cwd}): ${result.stderr}`)
  return result.stdout.trim()
}

const failures = []
const check = (name, condition, detail) => {
  if (condition) return
  failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const named = (text) => readFileSync(join(workPath, text), 'utf8')

// ------------------------------------------------------------------- setup
mkdirSync(remotePath)
await git(remotePath, 'init', '--bare')
await git(remotePath, 'symbolic-ref', 'HEAD', 'refs/heads/main')
await git(scratch, 'clone', remotePath, workPath)
await git(workPath, 'config', 'user.name', 'GitPanel Test')
await git(workPath, 'config', 'user.email', 'gitpanel@example.com')
writeFileSync(join(workPath, 'file.txt'), 'base\n')
writeFileSync(join(workPath, 'other.txt'), 'other base\n')
await git(workPath, 'add', '-A')
await git(workPath, 'commit', '-m', 'initial')
await git(workPath, 'branch', '-M', 'main')
const mainBranch = await git(workPath, 'branch', '--show-current')
check('fixture branch', mainBranch === 'main', mainBranch)

// ------------------------------------------------------ commit template
writeFileSync(join(workPath, '.gitmessage'), 'Subject line\n\n# Explain why this change is needed\n')
await git(workPath, 'config', 'commit.template', '.gitmessage')
const template = await readCommitTemplate(runGit, workPath, { readTextFile: (file) => readFileSync(file, 'utf8'), homeDir: 'C:/Users' })
check('template read', template.ok === true && template.template.includes('Subject line'), JSON.stringify(template))
check('template source', template.source === 'commit.template' && template.path.endsWith('.gitmessage'), JSON.stringify(template))
await git(workPath, 'config', 'commit.template', 'missing-template.txt')
const missingTemplate = await readCommitTemplate(runGit, workPath, { readTextFile: (file) => readFileSync(file, 'utf8'), homeDir: 'C:/Users' })
check('missing template warns', missingTemplate.ok === true && missingTemplate.template === '' && missingTemplate.warning === 'unreadable-template', JSON.stringify(missingTemplate))
await git(workPath, 'config', '--unset', 'commit.template')
const noTemplate = await readCommitTemplate(runGit, workPath, { readTextFile: (file) => readFileSync(file, 'utf8'), homeDir: 'C:/Users' })
check('no template config', noTemplate.ok === true && noTemplate.template === '' && noTemplate.source === null, JSON.stringify(noTemplate))

// ------------------------------------------------------------------ commit
writeFileSync(join(workPath, 'file.txt'), 'base\nstaged part\n')
writeFileSync(join(workPath, 'other.txt'), 'other base\nunstaged part\n')
await git(workPath, 'add', 'file.txt')
const stagedCommit = await commitChanges(runGit, workPath, 'Commit staged only')
check('staged commit ok', stagedCommit.ok === true, JSON.stringify(stagedCommit).slice(0, 240))
check('staged commit did not auto-stage', stagedCommit.stagedByPanel === false)
const stagedFiles = await git(workPath, 'show', '--name-only', '--pretty=format:', 'HEAD')
check('only staged file committed', stagedFiles === 'file.txt', stagedFiles)
const otherStillDirty = await runGit(workPath, ['diff', '--quiet', '--', 'other.txt'])
check('unstaged file still modified', otherStillDirty.ok === false)

writeFileSync(join(workPath, 'file.txt'), 'base\nstaged part\ntracked fallback\n')
const fallbackCommit = await commitChanges(runGit, workPath, 'Commit tracked fallback')
check('tracked fallback ok', fallbackCommit.ok === true && fallbackCommit.stagedByPanel === true, JSON.stringify(fallbackCommit).slice(0, 240))
check('tracked fallback staged other file', (await git(workPath, 'show', '--name-only', '--pretty=format:', 'HEAD')).includes('other.txt'))

// ------------------------------------------- commit message data integrity
// A long line stays one line, blank lines/list markers/indentation survive, and
// CRLF input is normalized to LF while every visible character is preserved.
const integrityLongLine = 'This is a deliberately long English paragraph used to test whether the editor preserves a single continuous line without inserting unintended line breaks, regardless of the available viewport width.'
const integrityMessage = [
  'feat(git-panel): preserve long commit messages without wrapping',
  '',
  '这是一段较长的中文提交说明，用于测试文本框是否会自动插入换行，以及 Git 是否能够完整保存用户输入的原始文本。',
  '',
  integrityLongLine,
  '',
  '- Preserve manually inserted line breaks.',
  '  - Keep blank lines and indentation.',
  '- Support UTF-8 Chinese and English mixed content.',
].join('\n')
writeFileSync(join(workPath, 'integrity.txt'), 'integrity\n')
await git(workPath, 'add', 'integrity.txt')
const integrityCommit = await commitChanges(runGit, workPath, integrityMessage.replace(/\n/g, '\r\n'))
check('multiline commit ok', integrityCommit.ok === true, JSON.stringify(integrityCommit).slice(0, 240))
const rawObject = await git(workPath, 'cat-file', 'commit', 'HEAD')
const rawSeparator = rawObject.indexOf('\n\n')
const rawMessage = rawSeparator < 0 ? '' : rawObject.slice(rawSeparator + 2)
check('message stored verbatim', rawMessage === integrityMessage, JSON.stringify(rawMessage).slice(0, 320))
check('long line is not wrapped', rawMessage.split('\n').includes(integrityLongLine))
check('blank lines preserved', rawMessage.includes('without wrapping\n\n这是一段较长的中文提交说明'))
check('indentation preserved', rawMessage.includes('  - Keep blank lines and indentation.'))
check('list order preserved', rawMessage.indexOf('Preserve manually') < rawMessage.indexOf('Support UTF-8'))
const messageLineCount = rawMessage.split('\n').length
check('line count preserved', messageLineCount === integrityMessage.split('\n').length, `${messageLineCount}`)

writeFileSync(join(workPath, 'untracked.txt'), 'never staged\n')
const emptyMessage = await commitChanges(runGit, workPath, '   ')
check('empty message refused', emptyMessage.ok === false && emptyMessage.code === 'empty-message', JSON.stringify(emptyMessage))
const nothingToCommit = await commitChanges(runGit, workPath, 'nothing here')
check('nothing to commit refused', nothingToCommit.ok === false && nothingToCommit.code === 'nothing-to-commit', JSON.stringify(nothingToCommit))

// -------------------------------------------------------------------- push
const firstPush = await pushBranch(runGit, workPath, { setUpstream: true, remote: 'origin' })
check('initial push with upstream', firstPush.ok === true && firstPush.upstream === 'origin/main', JSON.stringify(firstPush))
const upstream = await git(workPath, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
check('upstream configured', upstream === 'origin/main', upstream)

const noUpstreamBranch = await createBranch(runGit, workPath, 'feature/no-upstream')
check('branch created', noUpstreamBranch.ok === true, JSON.stringify(noUpstreamBranch))
check('branch switched', (await git(workPath, 'branch', '--show-current')) === 'feature/no-upstream')
const pullWithoutUpstream = await pullBranch(runGit, workPath)
check('pull without upstream refused', pullWithoutUpstream.ok === false && pullWithoutUpstream.code === 'no-upstream', JSON.stringify(pullWithoutUpstream).slice(0, 200))
const pushWithoutUpstream = await pushBranch(runGit, workPath)
check(
  'push without upstream offers setup',
  pushWithoutUpstream.ok === false && pushWithoutUpstream.code === 'no-upstream' && pushWithoutUpstream.remotes.includes('origin') && pushWithoutUpstream.suggestedRemote === 'origin',
  JSON.stringify(pushWithoutUpstream).slice(0, 260),
)
const pushAfterSetup = await pushBranch(runGit, workPath, { setUpstream: true, remote: 'origin' })
check('push with upstream setup', pushAfterSetup.ok === true && pushAfterSetup.upstream === 'origin/feature/no-upstream', JSON.stringify(pushAfterSetup).slice(0, 200))
await git(workPath, 'switch', 'main')

// ----------------------------------------------------------- fetch / pull
await git(scratch, 'clone', remotePath, otherPath)
await git(otherPath, 'config', 'user.name', 'GitPanel Test')
await git(otherPath, 'config', 'user.email', 'gitpanel@example.com')
writeFileSync(join(otherPath, 'fetched.txt'), 'from other clone\n')
await git(otherPath, 'add', '-A')
await git(otherPath, 'commit', '-m', 'remote addition')
await git(otherPath, 'push', 'origin', 'main')
const remoteHead = await git(otherPath, 'rev-parse', 'HEAD')

const fetched = await fetchRemote(runGit, workPath)
check('fetch ok', fetched.ok === true, JSON.stringify(fetched).slice(0, 240))
check('fetch updates remote ref', (await git(workPath, 'rev-parse', 'origin/main')) === remoteHead)
check('fetch leaves work tree alone', (() => {
  try {
    named('fetched.txt')
    return false
  } catch {
    return true
  }
})())

const pulled = await pullBranch(runGit, workPath)
check('pull fast-forward ok', pulled.ok === true, JSON.stringify(pulled).slice(0, 240))
check('pull brings remote file', named('fetched.txt').includes('from other clone'))

// -------- rejected push after the remote advanced
writeFileSync(join(workPath, 'file.txt'), 'local commit for push\n')
await git(workPath, 'add', '-A')
await git(workPath, 'commit', '-m', 'local ahead')
writeFileSync(join(otherPath, 'remote-b.txt'), 'remote second\n')
await git(otherPath, 'add', '-A')
await git(otherPath, 'commit', '-m', 'remote second')
await git(otherPath, 'push', 'origin', 'main')
const rejectedPush = await pushBranch(runGit, workPath)
check('rejected push classified', rejectedPush.ok === false && rejectedPush.code === 'rejected', JSON.stringify(rejectedPush).slice(0, 240))
await git(workPath, 'fetch', 'origin')
await git(workPath, 'reset', '--hard', 'origin/main')

// -------- conflicting pull keeps local work
writeFileSync(join(workPath, 'conflict.txt'), 'local version\n')
await git(workPath, 'add', '-A')
await git(workPath, 'commit', '-m', 'local change')
await git(otherPath, 'pull', 'origin', 'main')
writeFileSync(join(otherPath, 'conflict.txt'), 'remote version\n')
await git(otherPath, 'add', '-A')
await git(otherPath, 'commit', '-m', 'remote change')
await git(otherPath, 'push', 'origin', 'main')
await fetchRemote(runGit, workPath)
const conflictedPull = await pullBranch(runGit, workPath)
check('conflict pull classified', conflictedPull.ok === false && conflictedPull.code === 'conflict', JSON.stringify(conflictedPull).slice(0, 300))
check('conflict files reported', Array.isArray(conflictedPull.files) && conflictedPull.files.includes('conflict.txt'), JSON.stringify(conflictedPull.files))
const conflictedContent = named('conflict.txt')
check('local modifications preserved', conflictedContent.includes('local version') && /<<<<<<</.test(conflictedContent), conflictedContent.slice(0, 120))
const blockedCommit = await commitChanges(runGit, workPath, 'while conflicted')
check('commit blocked by conflict', blockedCommit.ok === false && blockedCommit.code === 'conflict', JSON.stringify(blockedCommit).slice(0, 240))
await git(workPath, 'merge', '--abort')
await git(workPath, 'reset', '--hard', 'origin/main')

// ------------------------------------------------------- branch validation
const invalidBranch = await createBranch(runGit, workPath, 'bad..name')
check('invalid branch refused', invalidBranch.ok === false && invalidBranch.code === 'invalid-name', JSON.stringify(invalidBranch).slice(0, 200))
const duplicateBranch = await createBranch(runGit, workPath, 'main')
check('duplicate branch refused', duplicateBranch.ok === false && duplicateBranch.code === 'exists', JSON.stringify(duplicateBranch))

// ------------------------------------------------------- no remote at all
mkdirSync(plainPath)
await git(plainPath, 'init', '--initial-branch=main')
await git(plainPath, 'config', 'user.name', 'GitPanel Test')
await git(plainPath, 'config', 'user.email', 'gitpanel@example.com')
writeFileSync(join(plainPath, 'a.txt'), 'a\n')
await git(plainPath, 'add', '-A')
await git(plainPath, 'commit', '-m', 'plain')
const fetchNoRemote = await fetchRemote(runGit, plainPath)
check('fetch without remote refused', fetchNoRemote.ok === false && fetchNoRemote.code === 'no-remote', JSON.stringify(fetchNoRemote))
const pushNoRemote = await pushBranch(runGit, plainPath)
check('push without remote refused', pushNoRemote.ok === false && pushNoRemote.code === 'no-remote', JSON.stringify(pushNoRemote))

rmSync(scratch, { recursive: true, force: true })

console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 2))
