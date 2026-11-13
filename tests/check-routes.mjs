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
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const out = join(here, 'out')
mkdirSync(out, { recursive: true })

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
  spawn({ argv, cwd, env }) {
    const stdoutPath = join(out, `route-${run}.out`)
    const stderrPath = join(out, `route-${run}.err`)
    run += 1
    const outFd = openSync(stdoutPath, 'w')
    const errFd = openSync(stderrPath, 'w')
    const done = new Promise((resolve) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd,
        env: { ...process.env, ...(env ?? {}) },
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
      })
      child.on('error', () => resolve({ exitCode: -1, signal: null }))
      child.on('close', (code, signal) => {
        closeSync(outFd)
        closeSync(errFd)
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

// Disposing the plugin removes both routes.
for (const dispose of disposers) dispose()
check('routes disposed with the plugin', routes.size === 0, [...routes.keys()].join(','))

console.log(JSON.stringify({
  ok: failures.length === 0,
  failures,
  routeCount: 2,
  lightBranch: light.json?.branch,
  branches: full.json?.branches?.map((branch) => branch.name),
  dirtyMessage: dirty.json?.message,
}, null, 2))
