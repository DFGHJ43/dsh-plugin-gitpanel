/**
 * Route-level check for the Host half: mount the real `apply(ctx)` from
 * index.js on a fake Cordis context whose `webServer` captures the two route
 * handlers, whose `connection` applies a test fence, and whose `subprocess`
 * runs real git with file-captured output. Then exercise GET/POST handling,
 * Session and path directory resolution, status codes, and the switch round trip.
 *
 * Child output is captured through files rather than pipes because the agent
 * sandbox denies named pipes; the plugin's own runner is unaffected.
 */
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../index.js'
import { createFixtureRepo } from './fixture.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out')
mkdirSync(out, { recursive: true })
// The route tests run against a repository built here, never the plugin's own
// checkout, so committing in the workspace cannot change their expectations.
const repo = join(out, 'route-fixture')
rmSync(repo, { recursive: true, force: true })
mkdirSync(repo, { recursive: true })
const fixtureGit = (cwd, args) => new Promise((resolve) => {
  const child = spawn('git', args, { cwd, stdio: 'ignore', windowsHide: true })
  child.on('error', () => resolve({ ok: false, stdout: '', stderr: 'spawn failed' }))
  child.on('close', (code) => resolve({ ok: code === 0, stdout: '', stderr: '' }))
})
await createFixtureRepo(fixtureGit, repo)

const failures = []
const check = (name, condition, detail) => {
  if (condition) return
  failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// --------------------------------------------------------------- fake platform
let run = 0
const subprocess = {
  async resolveExecutable(name) {
    if (name === 'git') return 'git'
    throw new Error(`not found: ${name}`)
  },
  spawn({ argv, cwd, env, stdio }) {
    const stdoutPath = join(out, `route-${run}.out`)
    const stderrPath = join(out, `route-${run}.err`)
    const stdinPath = join(out, `route-${run}.in`)
    run += 1
    const outFd = openSync(stdoutPath, 'w')
    const errFd = openSync(stderrPath, 'w')
    const stdinSpec = stdio?.stdin
    if (stdinSpec !== null && typeof stdinSpec === 'object' && 'data' in stdinSpec) {
      writeFileSync(stdinPath, String(stdinSpec.data))
    }
    // The child reads stdin, so the descriptor must be readable.
    const stdinFd = stdinSpec !== null && typeof stdinSpec === 'object' && 'data' in stdinSpec
      ? openSync(stdinPath, 'r')
      : undefined
    const done = new Promise((resolve) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd,
        env: { ...process.env, ...(env ?? {}) },
        stdio: [stdinFd ?? 'ignore', outFd, errFd],
        windowsHide: true,
      })
      child.on('error', () => resolve({ exitCode: -1, signal: null }))
      child.on('close', (code, signal) => {
        closeSync(outFd)
        closeSync(errFd)
        if (stdinFd !== undefined) closeSync(stdinFd)
        resolve({ exitCode: code, signal })
      })
    })
    const reader = (path) => ({
      readFrom() {
        try {
          return { text: readFileSync(path, 'utf8'), nextOffset: 0, lossy: false }
        } catch {
          return { text: '', nextOffset: 0, lossy: false }
        }
      },
    })
    return {
      done,
      collected: { stdout: reader(stdoutPath), stderr: reader(stderrPath) },
      terminate() {},
      async waitForExit() {
        return true
      },
    }
  },
}

const liveSession = { sessionId: 'live-session', header: { id: 'live-session', cwd: repo } }
const routes = new Map()
const disposers = []
const ctx = {
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
  effect(callback) {
    const dispose = callback()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  connection: {
    requestRejection(request) {
      return request.headers['x-test-auth'] === 'secret' ? undefined : 401
    },
  },
  sessions: {
    get(id) {
      return id === liveSession.sessionId ? liveSession : undefined
    },
  },
  workingDirectory: {
    get(session) {
      return session.header.cwd
    },
  },
  get(name) {
    return this[name]
  },
  subprocess,
}

apply(ctx)
check('state route registered', routes.has('/gitpanel/state'), [...routes.keys()].join(','))
check('switch route registered', routes.has('/gitpanel/switch'))
const stateRoute = routes.get('/gitpanel/state')
const switchRoute = routes.get('/gitpanel/switch')

// ------------------------------------------------------------------ fake wire
function makeRequest({ method = 'GET', url, headers = {}, body }) {
  return {
    method,
    url,
    headers,
    resume() {},
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(body, 'utf8')
    },
  }
}
async function call(route, request) {
  const result = { status: 0, headers: {}, body: '' }
  const response = {
    set statusCode(value) { result.status = value },
    get statusCode() { return result.status },
    setHeader(name, value) { result.headers[name.toLowerCase()] = value },
    end(body) { result.body = body === undefined ? '' : String(body) },
  }
  await route.handler(request, response)
  let json
  try {
    json = JSON.parse(result.body)
  } catch {
    json = undefined
  }
  return { ...result, json }
}

const auth = { 'x-test-auth': 'secret' }

// ---------------------------------------------------------- new write routes
const registeredCount = routes.size
const actionPaths = ['/gitpanel/fetch', '/gitpanel/pull', '/gitpanel/branch', '/gitpanel/commit', '/gitpanel/push']
for (const path of actionPaths) check(`route registered: ${path}`, routes.has(path))
check('template route registered', routes.has('/gitpanel/commit-template'))

const templateRoute = routes.get('/gitpanel/commit-template')
const fetchRoute = routes.get('/gitpanel/fetch')
const pullRoute = routes.get('/gitpanel/pull')
const branchRoute = routes.get('/gitpanel/branch')
const commitRoute = routes.get('/gitpanel/commit')
const pushRoute = routes.get('/gitpanel/push')

const jsonPost = (path, payload, headers = auth) => makeRequest({
  method: 'POST',
  url: path,
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

const unauthFetch = await call(fetchRoute, makeRequest({ method: 'POST', url: '/gitpanel/fetch', headers: { 'content-type': 'application/json' }, body: '{}' }))
check('unauthenticated action refused', unauthFetch.status === 401, String(unauthFetch.status))

const fetchNoRemote = await call(fetchRoute, jsonPost('/gitpanel/fetch', { sessionId: liveSession.sessionId }))
check('fetch without remote reported', fetchNoRemote.status === 200 && fetchNoRemote.json?.ok === false && fetchNoRemote.json?.code === 'no-remote', `${fetchNoRemote.status} ${fetchNoRemote.body.slice(0, 200)}`)
check('failed fetch still returns state', fetchNoRemote.json?.state?.repo === true, JSON.stringify(fetchNoRemote.json?.state).slice(0, 120))

const pushNoRemote = await call(pushRoute, jsonPost('/gitpanel/push', { sessionId: liveSession.sessionId }))
check('push without remote reported', pushNoRemote.status === 200 && pushNoRemote.json?.code === 'no-remote', `${pushNoRemote.status} ${pushNoRemote.body.slice(0, 200)}`)

const pullNoUpstream = await call(pullRoute, jsonPost('/gitpanel/pull', { sessionId: liveSession.sessionId }))
check('pull without upstream reported', pullNoUpstream.status === 200 && pullNoUpstream.json?.code === 'no-upstream', `${pullNoUpstream.status} ${pullNoUpstream.body.slice(0, 200)}`)

const emptyCommit = await call(commitRoute, jsonPost('/gitpanel/commit', { sessionId: liveSession.sessionId, message: '   ' }))
check('empty commit message reported', emptyCommit.status === 200 && emptyCommit.json?.code === 'empty-message', `${emptyCommit.status} ${emptyCommit.body.slice(0, 200)}`)
check('failed commit returns state', emptyCommit.json?.state?.repo === true && Number.isInteger(emptyCommit.json?.state?.stagedCount), JSON.stringify(emptyCommit.json?.state).slice(0, 120))

const invalidBranchRoute = await call(branchRoute, jsonPost('/gitpanel/branch', { sessionId: liveSession.sessionId, name: 'bad..name' }))
check('invalid branch routed', invalidBranchRoute.status === 200 && invalidBranchRoute.json?.code === 'invalid-name', `${invalidBranchRoute.status} ${invalidBranchRoute.body.slice(0, 220)}`)
const duplicateBranchRoute = await call(branchRoute, jsonPost('/gitpanel/branch', { sessionId: liveSession.sessionId, name: 'main' }))
check('duplicate branch routed', duplicateBranchRoute.status === 200 && duplicateBranchRoute.json?.code === 'exists', `${duplicateBranchRoute.status} ${duplicateBranchRoute.body.slice(0, 200)}`)

const wrongType = await call(commitRoute, makeRequest({
  method: 'POST', url: '/gitpanel/commit', headers: { ...auth, 'content-type': 'text/plain' }, body: 'x',
}))
check('action needs JSON content type', wrongType.status === 415, String(wrongType.status))

// commit.template is read from the repository configuration (git config only).
const templatePath = join(repo, 'docs', 'commit-template.txt')
writeFileSync(templatePath, '# Git panel template\n\nSubject line\n\n# explain the change\n')
await new Promise((resolve) => {
  const child = spawn('git', ['config', 'commit.template', 'docs/commit-template.txt'], { cwd: repo, stdio: 'ignore', windowsHide: true })
  child.on('close', resolve)
  child.on('error', resolve)
})
const templateResponse = await call(templateRoute, makeRequest({
  url: `/gitpanel/commit-template?sessionId=${liveSession.sessionId}`,
  headers: auth,
}))
check('template route reads file', templateResponse.status === 200 && templateResponse.json?.ok === true && String(templateResponse.json?.template).startsWith('# Git panel'), `${templateResponse.status} ${String(templateResponse.body).slice(0, 160)}`)
check('template route reports source', templateResponse.json?.source === 'commit.template' && String(templateResponse.json?.path).endsWith('commit-template.txt'), JSON.stringify(templateResponse.json).slice(0, 200))
await new Promise((resolve) => {
  const child = spawn('git', ['config', '--unset', 'commit.template'], { cwd: repo, stdio: 'ignore', windowsHide: true })
  child.on('close', resolve)
  child.on('error', resolve)
})
const noTemplateResponse = await call(templateRoute, makeRequest({ url: `/gitpanel/commit-template?sessionId=${liveSession.sessionId}`, headers: auth }))
check('absent template is empty', noTemplateResponse.json?.ok === true && noTemplateResponse.json?.template === '' && noTemplateResponse.json?.source === null, JSON.stringify(noTemplateResponse.json).slice(0, 160))

// Unauthenticated requests are refused before any repository work.
const refused = await call(stateRoute, makeRequest({ url: '/gitpanel/state?sessionId=live-session' }))
check('unauthenticated refused', refused.status === 401, String(refused.status))
const refusedSwitch = await call(switchRoute, makeRequest({
  method: 'POST', url: '/gitpanel/switch', headers: { 'content-type': 'application/json' }, body: '{}',
}))
check('unauthenticated switch refused', refusedSwitch.status === 401, String(refusedSwitch.status))

// GET light state through the live Session's working directory.
const light = await call(stateRoute, makeRequest({ url: '/gitpanel/state?sessionId=live-session&light=1', headers: auth }))
check('light status', light.status === 200, String(light.status))
check('light branch', light.json?.branch === 'main', JSON.stringify(light.json?.branch))
check('light no branch list', light.json?.branches === undefined)

// Full state.
const full = await call(stateRoute, makeRequest({ url: '/gitpanel/state?sessionId=live-session', headers: auth }))
check('full status', full.status === 200, String(full.status))
check('full repo', full.json?.repo === true, JSON.stringify(full.json).slice(0, 200))
check('full branches', full.json?.branches?.length === 3, String(full.json?.branches?.length))
check('full commits', full.json?.commits?.length === 5, String(full.json?.commits?.length))
check('full edges', full.json?.edges?.length === 5, String(full.json?.edges?.length))
check('full current branch', full.json?.branch === 'main')

// The path fallback is used when no live Session matches.
const byPath = await call(stateRoute, makeRequest({
  url: `/gitpanel/state?path=${encodeURIComponent(repo)}&light=1`,
  headers: auth,
}))
check('path fallback works', byPath.status === 200 && byPath.json?.repo === true, `${byPath.status} ${byPath.body.slice(0, 120)}`)

// A missing Session and no path is a clear client error.
const noDirectory = await call(stateRoute, makeRequest({ url: '/gitpanel/state?sessionId=ghost', headers: auth }))
check('no directory is 400', noDirectory.status === 400 && noDirectory.json?.code === 'no-directory', `${noDirectory.status} ${noDirectory.body}`)

// A directory that does not exist is a 404 from the path branch.
const missingDir = await call(stateRoute, makeRequest({
  url: `/gitpanel/state?path=${encodeURIComponent(join(repo, 'does-not-exist'))}`,
  headers: auth,
}))
check('missing directory is 404', missingDir.status === 404 && missingDir.json?.code === 'not-found', `${missingDir.status} ${missingDir.body}`)

// A non-repository directory answers repo:false instead of failing.
const nonRepo = await call(stateRoute, makeRequest({
  url: `/gitpanel/state?path=${encodeURIComponent(tmpdir())}&light=1`,
  headers: auth,
}))
check('non-repo answers ok with repo false', nonRepo.status === 200 && nonRepo.json?.repo === false && nonRepo.json?.reason === 'not-a-repo', `${nonRepo.status} ${nonRepo.body.slice(0, 160)}`)

// Wrong method.
const wrongMethod = await call(stateRoute, makeRequest({ method: 'POST', url: '/gitpanel/state', headers: auth }))
check('GET route rejects POST', wrongMethod.status === 405 && wrongMethod.headers.allow === 'GET', String(wrongMethod.status))

// Switch validation and the successful round trip.
const noJson = await call(switchRoute, makeRequest({
  method: 'POST', url: '/gitpanel/switch', headers: { ...auth, 'content-type': 'text/plain' }, body: 'x',
}))
check('switch needs JSON', noJson.status === 415, String(noJson.status))
const badBranch = await call(switchRoute, makeRequest({
  method: 'POST', url: '/gitpanel/switch', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ branch: '-oops' }),
}))
check('switch rejects option-like branch', badBranch.status === 400 && badBranch.json?.code === 'bad-branch', `${badBranch.status} ${badBranch.body}`)
const missingBranch = await call(switchRoute, makeRequest({
  method: 'POST', url: '/gitpanel/switch',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ branch: 'no-such-branch', sessionId: liveSession.sessionId }),
}))
check('switch missing branch 404', missingBranch.status === 404 && missingBranch.json?.code === 'not-found', `${missingBranch.status} ${missingBranch.body}`)

const switched = await call(switchRoute, makeRequest({
  method: 'POST', url: '/gitpanel/switch',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ branch: 'hotfix/icon', sessionId: liveSession.sessionId }),
}))
check('switch status', switched.status === 200, `${switched.status} ${switched.body.slice(0, 200)}`)
check('switch reports branch', switched.json?.branch === 'hotfix/icon', JSON.stringify(switched.json?.branch))
check('switch returns fresh state', switched.json?.state?.branch === 'hotfix/icon', JSON.stringify(switched.json?.state?.branch))

const back = await call(switchRoute, makeRequest({
  method: 'POST', url: '/gitpanel/switch',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ branch: 'main', sessionId: liveSession.sessionId }),
}))
check('switch back', back.status === 200 && back.json?.state?.branch === 'main', `${back.status} ${back.body.slice(0, 200)}`)

// The dirty refusal reaches the wire as 409 with git's own message.
const notePath = join(repo, 'docs', 'main-note.md')
const original = readFileSync(notePath, 'utf8')
writeFileSync(notePath, `${original}dirty probe\n`)
const dirty = await call(switchRoute, makeRequest({
  method: 'POST', url: '/gitpanel/switch',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ branch: 'feature/graph', sessionId: liveSession.sessionId }),
}))
check('dirty switch 409', dirty.status === 409 && dirty.json?.code === 'dirty', `${dirty.status} ${dirty.body.slice(0, 200)}`)
check('dirty switch keeps git message', /local changes|would be overwritten/i.test(dirty.json?.message ?? ''), dirty.json?.message)
writeFileSync(notePath, original)

// Disposing the plugin removes every route.
for (const dispose of disposers) dispose()
check('routes disposed with the plugin', routes.size === 0, [...routes.keys()].join(','))

console.log(JSON.stringify({
  ok: failures.length === 0,
  failures,
  routeCount: registeredCount,
  lightBranch: light.json?.branch,
  branches: full.json?.branches?.map((branch) => branch.name),
  dirtyMessage: dirty.json?.message,
}, null, 2))
