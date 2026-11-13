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

// ------------------------------------------------ repository action surface
expect('action list', /const ACTIONS = \['fetch', 'pull', 'branch', 'commit', 'push'\]/)
expect('fetch route', /const FETCH_URL = 'gitpanel\/fetch'/)
expect('pull route', /const PULL_URL = 'gitpanel\/pull'/)
expect('branch route', /const BRANCH_URL = 'gitpanel\/branch'/)
expect('commit route', /const COMMIT_URL = 'gitpanel\/commit'/)
expect('push route', /const PUSH_URL = 'gitpanel\/push'/)
expect('commit template route', /const TEMPLATE_URL = 'gitpanel\/commit-template'/)
expect('commit button carries the live count', /count: commitCount > 0 \? commitCount : undefined/)
expect('commit count label for assistive tech', /t\('commitWithCount', \{ n: commitCount \}\)/)
expect('staged state is respected in the hint', /t\('hintStaged', \{ n: state\.stagedCount \}\)/)
expect('tracked fallback hint', /t\('hintTracked'\)/)
expect('commit only from the bubble button', /onClick: onCommit/)
expect('template is read when the bubble opens', /`\$\{TEMPLATE_URL\}\$\{stateQuery\(sessionId, workspacePath\)\}`/)
expect('template prefill respects typing', /if \(!draftTouchedRef\.current && typeof payload\?\.template === 'string'\) setDraft\(payload\.template\)/)
expect('failed commit keeps the draft', /setBubble\(\(previous\) => \(previous && previous\.mode === 'commit'/)
expect('push upstream setup bubble', /mode: 'push', anchor: 'push'/)
check('no force push anywhere', !/--force|forceWithLease/.test(source))
check('no native alert', !/\balert\(/.test(source))

// -------------------------------------------------- reusable speech bubble
expect('single shared bubble shell', /function SpeechBubble\(\{ variant, geometry, label, bubbleRef, children \}\)/)
expect('bubble tail element', /className: 'gitpanel-bubble-tail'/)
expect('anchored geometry', /const tailOffset = Math\.min/)
expect('error variant styling', /data-variant="error"/)
expect('error background is the error token', /background:var\(--dsw-alias-state-error-primary/)
expect('error text is white', /\.gitpanel-bubble\[data-variant="error"\]\{background:var\(--dsw-alias-state-error-primary,#D92D20\);color:#fff/)
expect('monochrome warning mark', /fill: '#FFFFFF'[\s\S]{0,200}stroke: '#111111'/)
expect('error headline mapping', /const ACTION_ERROR_LEADS = \{/)
expect('error details keep git output', /error\?\.detail \? h\('div', \{ className: 'gitpanel-bubble-error-detail' \}/)
expect('error bubble auto dismisses', /setTimeout\(\(\) => closeBubble\(\), 8000\)/)
expect('one bubble at a time', /const \[bubble, setBubble\] = useState\(null\)/)
expect('bubble closes before a new action', /if \(bubbleStateRef\.current\?\.mode === 'error'\) closeBubble\(\)/)
expect('bubble stays out of the panel flow', /className: 'gitpanel-layer' \},[\s\S]{0,1600}\n        bubbleNode\)/)
expect('new branch input bubble', /function BranchBubbleBody/)
expect('commit editor bubble', /function CommitBubbleBody/)
expect('push confirmation bubble', /function PushBubbleBody/)
expect('busy state disables actions', /disabled: Boolean\(busy\) \|\| Boolean\(options\.disabled\)/)
expect('action loading labels', /busyLabel: t\('fetching'\)[\s\S]{0,2400}busyLabel: t\('pushing'\)/)

// -------------------------------------------------- scrollbar / glyph clipping
// The shared shell must not scroll: its absolutely positioned tail lives outside
// the box, so an outer scroll container would always show a stray scrollbar.
expect('bubble shell does not scroll', /\.gitpanel-bubble\{[^}]*overflow:visible/)
expect('bubble content owns the scroll area', /\.gitpanel-bubble-content\{[^}]*overflow:auto/)
check('error detail has no scroll cap', !/\.gitpanel-bubble-error-detail\{[^}]*max-height/.test(source))
check('error detail has no own overflow', !/\.gitpanel-bubble-error-detail\{[^}]*overflow:/.test(source))
expect('error bubbles skip the height cap', /if \(variant !== 'error' && geometry\.maxHeight\) contentStyle\.maxHeight = geometry\.maxHeight/)
expect('error content has no scroll container', /\.gitpanel-bubble\[data-variant="error"\] \.gitpanel-bubble-content\{overflow:visible\}/)
expect('error tail stays outside the content box', /gitpanel-bubble-tail'[\s\S]{0,120}gitpanel-bubble-content/)
// Button labels need a real line box: `line-height: 1` clipped CJK strokes and
// Latin descenders inside the `overflow: hidden` ellipsis span.
expect('action button keeps a full line box', /\.gitpanel-action\{[^}]*line-height:15px/)
expect('action label keeps a full line box', /\.gitpanel-action-label\{[^}]*line-height:15px/)

// ---------------------------------------------- commit dialog: size and draft
// Taller message field without changing the bubble width or tail.
expect('commit editor has a taller field', /\.gitpanel-bubble-textarea\{[^}]*min-height:160px/)
expect('commit editor keeps a resize cap', /\.gitpanel-bubble-textarea\{[^}]*max-height:300px/)
// Terminal-like text behaviour: no soft wrap, independent horizontal scrolling,
// only Enter produces a real newline, and the value reaches the payload untouched.
expect('editor disables soft wrapping', /wrap: 'off'/)
expect('editor preserves whitespace', /\.gitpanel-bubble-textarea\{[^}]*white-space:pre/)
expect('editor scrolls horizontally', /\.gitpanel-bubble-textarea\{[^}]*overflow-x:auto/)
expect('editor scrolls vertically', /\.gitpanel-bubble-textarea\{[^}]*overflow-y:auto/)
expect('editor scrollbars follow the theme', /\.gitpanel-bubble-textarea::-webkit-scrollbar-thumb\{background:var\(--dsh-scrollbar-thumb/)
check('commit payload is not rewritten', !/message:\s*draft\.replace/.test(source))
check('commit payload is not truncated', !/message:\s*draft\.slice/.test(source))
// The focus ring is drawn inside the field, so it cannot cross or be cut by the bubble.
expect('focus ring is inset', /\.gitpanel-bubble-textarea:focus-visible,[^{]*\{outline:2px solid[^}]*outline-offset:-2px/)
check('focus ring does not use an outer shadow', !/\.gitpanel-bubble-textarea:focus-visible[^}]*box-shadow/.test(source))
// Draft persistence: per repository, every edit stored, only success clears it.
expect('draft storage key is per repository', /gitpanel:commit-draft:v1:\$\{repoRoot\}/)
expect('draft read helper', /function readStoredDraft\(key\)/)
expect('draft write helper', /function writeStoredDraft\(key, value\)/)
expect('every edit is persisted', /writeStoredDraft\(draftStorageKeyOf\(state\?\.root\), value\)/)
expect('reopening restores the stored draft', /const savedDraft = readStoredDraft\(storageKey\)[\s\S]{0,200}setDraft\(savedDraft\)/)
expect('a stored draft wins over the template', /if \(savedDraft\.length > 0\) return/)
check('closing the bubble does not clear the draft', !/function closeBubble[\s\S]{0,300}setDraft\(''\)[\s\S]{0,80}\n      \}, \[\]\)/.test(source))
expect('only a successful commit clears the draft', /writeStoredDraft\(draftStorageKeyOf\(state\?\.root\), ''\)[\s\S]{0,160}setNotice\(t\('commitDone'/)
expect('failed commit keeps the editor and its text', /setBubble\(\(previous\) => \(previous && previous\.mode === 'commit'/)

console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 2))
