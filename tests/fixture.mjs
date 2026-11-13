/**
 * Shared scratch fixture for the read/route tests: a small repository with the
 * known topology the layout assertions expect (root commit, a feature branch,
 * a main-tip commit, a hotfix branch, and a merge commit).
 *
 * `runGit(cwd, args)` resolves to `{ ok, stdout, stderr }`; the helper throws on
 * a failed command so a broken fixture fails the test loudly.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const gitOf = async (runGit, cwd, ...args) => {
  const result = await runGit(cwd, args)
  if (!result.ok) throw new Error(`fixture git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout
}

/** Write one fixture file, recreating its directory (branches drop empty dirs). */
const writeFixtureFile = (directory, relativePath, content) => {
  const path = join(directory, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

/** Build the five-commit, three-branch fixture in an existing empty directory. */
export async function createFixtureRepo(runGit, directory) {
  await gitOf(runGit, directory, 'init', '--initial-branch=main')
  await gitOf(runGit, directory, 'config', 'user.name', 'GitPanel Test')
  await gitOf(runGit, directory, 'config', 'user.email', 'gitpanel@example.com')

  writeFixtureFile(directory, 'base.txt', 'base\n')
  await gitOf(runGit, directory, 'add', '-A')
  await gitOf(runGit, directory, 'commit', '-m', 'Add git panel bundle')

  await gitOf(runGit, directory, 'branch', 'feature/graph')
  await gitOf(runGit, directory, 'switch', 'feature/graph')
  writeFixtureFile(directory, 'docs/feature-note.md', 'Feature notes for the commit graph window.\n')
  await gitOf(runGit, directory, 'add', '-A')
  await gitOf(runGit, directory, 'commit', '-m', 'Document the commit graph window')

  await gitOf(runGit, directory, 'switch', 'main')
  writeFixtureFile(directory, 'docs/main-note.md', 'Main branch note.\n')
  await gitOf(runGit, directory, 'add', '-A')
  await gitOf(runGit, directory, 'commit', '-m', 'Add main branch note')

  await gitOf(runGit, directory, 'switch', '-c', 'hotfix/icon', 'main')
  writeFixtureFile(directory, 'docs/icon-note.md', 'Icon colour probe.\n')
  await gitOf(runGit, directory, 'add', '-A')
  await gitOf(runGit, directory, 'commit', '-m', 'Tweak icon contrast')

  await gitOf(runGit, directory, 'switch', 'main')
  await gitOf(runGit, directory, 'merge', '--no-ff', 'feature/graph', '-m', "Merge branch 'feature/graph'")
  return directory
}
