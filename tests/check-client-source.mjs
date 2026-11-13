/**
 * Source-contract guard for the browser half. The client module is a
 * `window.__ModuleLoader__` script (not importable), so this check pins the
 * wiring that shipped together: the branch row's switch callback, the dialog
 * focus/close behaviour, locale registration, and the document-relative routes.
 * It exists because the route/fixture tests cannot reach the UI.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

const failures = []
const check = (name, condition, detail) => {
  if (condition) return
  failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const expect = (name, pattern) => {
  check(name, pattern.test(source), `missing ${pattern}`)
}

// The regression that broke branch switching: rows must call the handler prop.
expect('row calls the switch handler', /onSwitch\(branch\)/)
check('row keeps the handler prop', !/branch\.onSwitch/.test(source))

// Accessible non-modal dialog: focus moves in, outside press closes, labels exist.
expect('dialog role', /role: 'dialog'/)
expect('dialog is focusable', /tabIndex: -1/)
expect('panel focus on open', /panelRef\.current\?\.focus\(\)/)
expect('outside press closes', /document\.addEventListener\('mousedown'/)
expect('escape closes', /event\.key === 'Escape'/)
expect('tab is trapped', /event\.key !== 'Tab'/)
expect('trigger controls the panel', /'aria-controls': open \? PANEL_ID/)
expect('trigger labelled', /'aria-label': t\('trigger'\)/)
expect('rows are menu radio items', /role: 'menuitemradio'/)
expect('rows expose checked state', /'aria-checked': isCurrent/)

// Feedback semantics.
expect('error banner alerts', /role: 'alert'/)
expect('status regions announce', /'aria-live': 'polite'/)
expect('busy state', /'aria-busy'/)
expect('localized failure lead', /ERROR_LEAD\[error\.code\]/)

// Locale and bridge contracts confirmed against the installed client packages.
expect('locale namespace registered', /ctx\.locale\.register\('gitpanel'/)
expect('translator bound', /ctx\.locale\.bind\('gitpanel'\)/)
expect('relative state route', /const STATE_URL = 'gitpanel\/state'/)
expect('relative switch route', /const SWITCH_URL = 'gitpanel\/switch'/)
check('no invented ctx prop', !/props\.ctx/.test(source))
check('no runtime client-package import', !/require\('@deepseek-ai\/dsh-client-ui-/.test(source))
expect('portal to the document body', /createPortal\(menu, document\.body\)/)
expect('module id is the package name', /id: 'dsh-plugin-gitpanel'/)

console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 2))
