/**
 * Host half of dsh-plugin-gitpanel.
 *
 * Two routes on the composition's `webServer` serve the browser half:
 *
 * - `GET /gitpanel/state` reads one Session's working directory (falling back to
 *   an absolute existing directory supplied by the browser) and returns the
 *   current branch, the local branch list, and a laid-out commit graph.
 *   `light=1` returns only what the composer trigger needs, so the periodic
 *   refresh stays cheap.
 * - `POST /gitpanel/switch` checks out one existing local branch in that same
 *   directory and answers with the fresh state. Git itself refuses a checkout
 *   that would overwrite uncommitted work; that refusal is reported verbatim.
 *
 * Security has one home here. Every route asks the composition's `connection`
 * service for a rejection first (`requestRejection`): its Host/Origin fence
 * defeats DNS rebinding and cross-site calls, and its browser authentication (the
 * login-token cookie) gates callers before any repository fact is reachable. The
 * routes then validate their own inputs: a Session id, a bounded commit limit, an
 * absolute existing directory, and an existing local branch name.
 *
 * `git` runs through the composition's `subprocess` capability (argv only, no
 * shell) with a deadline; the executable is resolved once per plugin life.
 */

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { clampInt, readState, switchBranch } from './lib/git-read.js'

/** Cordis function-plugin name. */
export const name = 'gitpanel'
/**
 * The route carrier and trust fence, plus the Session/directory and process
 * capabilities every request needs. All of them are mounted by the Web profile.
 */
export const inject = ['webServer', 'connection', 'subprocess', 'sessions', 'workingDirectory']

/** Route paths. Kept outside `/api`, which the Remote transport owns. */
const STATE_PATH = '/gitpanel/state'
const SWITCH_PATH = '/gitpanel/switch'

/** Request bodies are tiny JSON objects; anything larger is hostile. */
const MAX_BODY_BYTES = 16 * 1024
/** Upper bound on one git invocation; the switch itself is usually instant. */
const GIT_TIMEOUT_MS = 20_000
const COMMIT_LIMIT_MAX = 300
/** A ref name git itself would accept: no whitespace, no `~^:?*[\\`. */
const UNSAFE_REF = /[\u0000-\u0020~^:?*\[\\]/

/** JSON response (no-store: branch facts are live). */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 405 with the route's one supported method. */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/** Collect a bounded request body as UTF-8 text; null past the ceiling. */
async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** Register the state and switch routes. */
export function apply(ctx) {
  /** The connection trust fence (the Host half of the browser transport). */
  const connectionOf = () => {
    try {
      return ctx.connection ?? ctx.get('connection')
    } catch {
      return undefined
    }
  }
  const rejected = (req, res) => {
    const connection = connectionOf()
    if (!connection || typeof connection.requestRejection !== 'function') return false
    const rejection = connection.requestRejection(req)
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }

  /** One provider lookup; the cache clears on failure so a late install heals. */
  let gitExecutablePromise
  const gitExecutable = (subprocess) => {
    if (!gitExecutablePromise) {
      gitExecutablePromise = Promise.resolve(subprocess.resolveExecutable('git')).catch((error) => {
        gitExecutablePromise = undefined
        throw error
      })
    }
    return gitExecutablePromise
  }

  /**
   * Run one git command in `cwd`. Never throws: every failure becomes a result
   * object with an exit code, bounded output, and a machine-readable `code`.
   * The environment is the provider's scrubbed parent plus the minimal git
   * hardening (no prompts, no optional locks, C locale for stable parsing).
   */
  const GIT_ENV = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
  }
  const runGit = async (cwd, args, timeoutMs = GIT_TIMEOUT_MS) => {
    const subprocess = ctx.get('subprocess')
    if (!subprocess) {
      return { ok: false, code: 'no-subprocess', message: 'The subprocess capability is not available in this profile.' }
    }
    let executable
    try {
      executable = await gitExecutable(subprocess)
    } catch {
      return { ok: false, code: 'git-missing', message: 'Git is not installed, or not on this host\'s PATH.' }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let handle
    try {
      handle = subprocess.spawn({
        argv: [executable, ...args],
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 4 * 1024 * 1024 },
          stderr: { maxBytes: 256 * 1024 },
        },
        env: GIT_ENV,
        graceMs: 2000,
        signal: controller.signal,
      })
      let outcome
      try {
        outcome = await handle.done
      } catch (error) {
        return { ok: false, code: 'spawn-failed', message: String(error?.message ?? error) }
      }
      const stdout = handle.collected?.stdout?.readFrom(0).text ?? ''
      const stderr = handle.collected?.stderr?.readFrom(0).text ?? ''
      if (controller.signal.aborted) {
        return { ok: false, code: 'timeout', message: `git ${args[0]} did not finish within ${timeoutMs} ms.`, stdout, stderr }
      }
      return { ok: (outcome?.exitCode ?? -1) === 0, exitCode: outcome?.exitCode ?? -1, stdout, stderr }
    } catch (error) {
      return { ok: false, code: 'spawn-failed', message: String(error?.message ?? error) }
    } finally {
      clearTimeout(timer)
      try {
        handle?.terminate()
        await handle?.waitForExit?.()
      } catch {
        // A handle that already exited needs no cleanup; the failure is not ours.
      }
    }
  }

  /**
   * The directory a request acts on: the Session's effective working directory
   * first (live Session, else a cold one read through the session query seam),
   * then an absolute existing directory supplied by the browser.
   */
  const directoryFor = async (sessionId, path) => {
    if (typeof sessionId === 'string' && sessionId) {
      try {
        const live = ctx.sessions.get(sessionId)
        if (live) {
          const effective = ctx.workingDirectory.get(live)
          if (typeof effective === 'string' && effective) return { directory: effective }
        } else {
          // A Session that is open but not yet materialized in this process: read
          // its committed working directory without resuming it.
          const sessionQuery = ctx.get('sessionQuery')
          if (sessionQuery && typeof sessionQuery.inspectSession === 'function') {
            const directory = await sessionQuery.inspectSession(
              sessionId,
              (session) => ctx.workingDirectory.get(session),
              AbortSignal.timeout(5000),
            )
            if (typeof directory === 'string' && isAbsolute(directory)) return { directory }
          }
        }
      } catch {
        // A profile without the session seam falls through to the path branch.
      }
    }
    if (typeof path === 'string' && path && isAbsolute(path)) {
      try {
        if ((await stat(path)).isDirectory()) return { directory: path }
      } catch {
        return { error: { status: 404, code: 'not-found', message: `Directory does not exist: ${path}` } }
      }
    }
    return { error: { status: 400, code: 'no-directory', message: 'No Session working directory is available for this request.' } }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATE_PATH,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      const url = new URL(String(req.url), 'http://localhost')
      const directory = await directoryFor(url.searchParams.get('sessionId'), url.searchParams.get('path'))
      if (directory.error) {
        sendJson(res, directory.error.status, { ok: false, code: directory.error.code, message: directory.error.message })
        return
      }
      const state = await readState(runGit, directory.directory, {
        light: url.searchParams.get('light') === '1',
        commitLimit: clampInt(url.searchParams.get('commits'), 1, COMMIT_LIMIT_MAX, undefined),
      })
      sendJson(res, 200, { ok: true, ...state })
    },
  }), `gitpanel: GET ${STATE_PATH}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SWITCH_PATH,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
      if (essence !== 'application/json') {
        sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: 'content-type must be application/json' })
        return
      }
      let text
      try {
        text = await readBoundedBody(req)
      } catch {
        sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request body unreadable' })
        return
      }
      if (text === null) {
        sendJson(res, 413, { ok: false, code: 'payload-too-large', message: 'request body is too large' })
        return
      }
      let body
      try {
        body = JSON.parse(text)
      } catch {
        sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request body must be a JSON object' })
        return
      }
      if (typeof body !== 'object' || body === null || typeof body.branch !== 'string') {
        sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request body needs a string "branch"' })
        return
      }
      const target = body.branch
      if (!target || target.startsWith('-') || UNSAFE_REF.test(target)) {
        sendJson(res, 400, { ok: false, code: 'bad-branch', message: `Not a usable branch name: ${target}` })
        return
      }
      const directory = await directoryFor(body.sessionId, body.path)
      if (directory.error) {
        sendJson(res, directory.error.status, { ok: false, code: directory.error.code, message: directory.error.message })
        return
      }
      const result = await switchBranch(runGit, directory.directory, target)
      if (!result.ok) {
        sendJson(res, result.code === 'not-found' ? 404 : 409, { ok: false, code: result.code, message: result.message })
        return
      }
      sendJson(res, 200, { ok: true, branch: result.branch, state: result.state })
    },
  }), `gitpanel: POST ${SWITCH_PATH}`)
}
