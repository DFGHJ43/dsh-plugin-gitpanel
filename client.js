/**
 * Browser half of dsh-plugin-gitpanel.
 *
 * Registers one compact control into the composer tool row. It shows the current
 * branch of the Session's repository and opens a popup with the commit graph on
 * the left and the local branch list on the right. Repository facts come from the
 * Host half's `/gitpanel/*` routes on the same origin.
 *
 * The popup portals to the document body because the docked composer contains
 * fixed overlays; it is a non-modal dialog that closes on an outside pointer
 * press or Escape and returns focus to the trigger. Colours follow the host theme
 * tokens except the plugin's own lane palette.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-gitpanel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    /** `react-dom` is a baseline module; the portal keeps the popup out of the composer. */
    let createPortal
    try {
      createPortal = require('react-dom').createPortal
    } catch {
      createPortal = undefined
    }

    /** Lane colours: plugin-owned artwork, mid-tone so both themes read them. */
    const LANES = ['#4C6EF5', '#F08C00', '#12B886', '#D6336C', '#7950F2', '#0CA678', '#E8590C', '#C2255C']
    const ROW_H = 28
    const LANE_W = 14
    const LANE_PAD = 10
    const NODE_R = 4.2
    const PANEL_WIDTH = 760
    const PANEL_MAX_HEIGHT = 460
    const PANEL_MIN_HEIGHT = 180
    const COMMIT_LIMIT = 120
    const POLL_MS = 5000
    const PANEL_ID = 'gitpanel-branch-panel'

    /** Built-in dictionaries; the Client locale service receives them in apply. */
    const DICTIONARIES = {
      en: {
        trigger: 'Switch branch',
        title: 'Branches',
        current: 'Current',
        refresh: 'Refresh',
        loading: 'Reading repository…',
        emptyGraph: 'No commits in this repository yet',
        noBranches: 'No local branches',
        filterEmpty: 'No branch matches the filter',
        detached: 'detached',
        errorTitle: 'Git error',
        retry: 'Retry',
        switching: 'Switching…',
        switchFailed: 'Could not switch branch',
        switchedTo: 'Switched to {name}',
        dirtyCount: '{n} uncommitted change(s)',
        truncated: 'Newest {n} commits shown',
        commits: '{n} commits',
        branches: '{n} branches',
        unborn: 'no commits yet',
        gone: 'upstream gone',
        filter: 'Filter branches',
        graphPane: 'Commit graph',
        branchPane: 'Local branches',
        errorDirty: 'Uncommitted changes would be overwritten, so the branch was not switched',
        errorNotFound: 'That branch no longer exists',
        errorNotRepo: 'This directory is not a Git repository',
        errorTimeout: 'Git did not answer in time',
        errorNetwork: 'Could not reach the Git panel service',
        errorGeneric: 'A Git operation failed',
      },
      zh: {
        trigger: '切换分支',
        title: '分支',
        current: '当前',
        refresh: '刷新',
        loading: '正在读取仓库…',
        emptyGraph: '该仓库还没有提交',
        noBranches: '没有本地分支',
        filterEmpty: '没有匹配的分支',
        detached: '游离',
        errorTitle: 'Git 错误',
        retry: '重试',
        switching: '正在切换…',
        switchFailed: '切换分支失败',
        switchedTo: '已切换到 {name}',
        dirtyCount: '{n} 个未提交更改',
        truncated: '仅显示最近 {n} 条提交',
        commits: '{n} 条提交',
        branches: '{n} 个分支',
        unborn: '尚无提交',
        gone: '上游已删除',
        filter: '筛选分支',
        graphPane: '提交关系图',
        branchPane: '本地分支',
        errorDirty: '存在未提交的修改，切换会覆盖它们，因此未切换',
        errorNotFound: '该分支已不存在',
        errorNotRepo: '当前目录不是 Git 仓库',
        errorTimeout: 'Git 响应超时',
        errorNetwork: '无法连接 Git 面板服务',
        errorGeneric: 'Git 操作失败',
      },
    }

    /** Failure code to the localized headline shown above git's own message. */
    const ERROR_LEAD = {
      dirty: 'errorDirty',
      'not-found': 'errorNotFound',
      'not-a-repo': 'errorNotRepo',
      'no-directory': 'errorNotRepo',
      timeout: 'errorTimeout',
      network: 'errorNetwork',
    }

    const CSS = `
.gitpanel-trigger{display:inline-flex;align-items:center;gap:4px;height:28px;min-width:0;max-width:220px;padding:0 4px 0 8px;border:0;border-radius:var(--dsw-radius-sm,8px);outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:500;cursor:pointer;transition:background .12s ease}
@media (hover:hover){.gitpanel-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}}
.gitpanel-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.gitpanel-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gitpanel-trigger-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.gitpanel-trigger-icon{flex:none;display:block}
.gitpanel-trigger-caret{flex:none;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary));margin-left:-1px;transition:transform .12s ease}
.gitpanel-trigger[aria-expanded="true"] .gitpanel-trigger-caret{transform:rotate(180deg)}
@container (max-width:460px){.gitpanel-trigger-label{display:none}}
.gitpanel-layer{position:fixed;inset:0;z-index:1100;pointer-events:none}
.gitpanel-panel{pointer-events:auto;position:absolute;display:flex;flex-direction:column;background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-overlay));backdrop-filter:var(--dsw-menu-backdrop-filter);border:0;border-radius:var(--dsw-radius-lg,16px);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent,0 0 0 .5px var(--dsw-alias-border-l1),0 3px 8px 0 rgba(0,0,0,.04),0 0 20px 0 rgba(0,0,0,.05));overflow:hidden;outline:none;color:var(--dsw-alias-label-primary);font-size:13px;--dsh-scrollbar-thumb:var(--dsw-alias-border-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-label-secondary)}
.gitpanel-header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.gitpanel-header-title{display:flex;align-items:center;gap:6px;font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary)}
.gitpanel-current{display:inline-flex;align-items:center;gap:6px;min-width:0;padding:2px 8px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-state-business-tertiary,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));font-size:12px;max-width:260px}
.gitpanel-current-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.gitpanel-current-dot{width:7px;height:7px;border-radius:50%;corner-shape:round;flex:none}
.gitpanel-header-spacer{flex:1}
.gitpanel-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}
@media (hover:hover){.gitpanel-icon-btn:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}}
.gitpanel-icon-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gitpanel-icon-btn[disabled]{opacity:.45;cursor:default}
.gitpanel-spin{animation:gitpanel-spin 1s linear infinite}
@keyframes gitpanel-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.gitpanel-spin{animation-duration:2.4s}}
.gitpanel-error{margin:10px 12px 0;padding:8px 10px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-interactive-bg-hover-danger,color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent));color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5;max-height:110px;overflow:auto;display:flex;gap:8px;align-items:flex-start}
.gitpanel-error-body{flex:1;min-width:0}
.gitpanel-error-lead{font-weight:600}
.gitpanel-error-detail{margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word;opacity:.9}
.gitpanel-error-action{flex:none;border:0;background:transparent;color:inherit;font:inherit;text-decoration:underline;cursor:pointer;padding:0}
.gitpanel-columns{display:flex;min-height:0;flex:1}
.gitpanel-graph-pane{flex:1 1 58%;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1)}
.gitpanel-branch-pane{flex:0 0 42%;min-width:0;display:flex;flex-direction:column}
.gitpanel-pane-head{flex:none;display:flex;align-items:center;gap:6px;padding:8px 12px 6px;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600}
.gitpanel-pane-meta{font-weight:400;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
.gitpanel-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding-bottom:4px}
.gitpanel-graph-wrap{position:relative;padding-bottom:4px}
.gitpanel-graph-svg{position:absolute;left:0;top:0;pointer-events:none;display:block}
.gitpanel-commit{display:flex;align-items:center;gap:8px;height:${ROW_H}px;padding-right:12px;font-size:12px;line-height:1;white-space:nowrap}
.gitpanel-commit-subject{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}
.gitpanel-commit-refs{flex:0 1 auto;display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden}
.gitpanel-ref{flex:none;padding:2px 6px;border-radius:var(--dsw-radius-sm,8px);corner-shape:round;font-size:10.5px;line-height:1.35;border:1px solid transparent;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gitpanel-ref-head{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));background:var(--dsw-alias-state-business-tertiary,var(--dsw-alias-bg-layer-2))}
.gitpanel-commit-spacer{flex:1}
.gitpanel-commit-hash{flex:none;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;opacity:.85}
.gitpanel-commit-time{flex:none;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary));font-size:11px;min-width:56px;text-align:right}
.gitpanel-filter{flex:none;padding:6px 10px 2px}
.gitpanel-filter-input{width:100%;box-sizing:border-box;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}
.gitpanel-filter-input:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gitpanel-filter-input::placeholder{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
.gitpanel-branch-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:2px 6px 6px}
.gitpanel-branch{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:5px 8px;border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;text-align:left;cursor:pointer}
@media (hover:hover){.gitpanel-branch:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}}
.gitpanel-branch:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gitpanel-branch:disabled{cursor:default;opacity:.85}
.gitpanel-branch-dot{flex:none;width:8px;height:8px;border-radius:50%;corner-shape:round}
.gitpanel-branch-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gitpanel-branch-sync{flex:none;display:inline-flex;gap:4px;color:var(--dsw-alias-label-secondary);font-size:11px}
.gitpanel-branch-spacer{flex:1}
.gitpanel-branch-check{flex:none;color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));display:flex;align-items:center}
.gitpanel-branch-meta{flex:none;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary));font-size:10.5px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gitpanel-footer{flex:none;display:flex;align-items:center;gap:10px;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;min-height:32px;box-sizing:border-box}
.gitpanel-footer-spacer{flex:1}
.gitpanel-warn{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}
.gitpanel-status{color:var(--dsw-alias-state-success-primary)}
.gitpanel-empty{display:flex;align-items:center;justify-content:center;min-height:120px;color:var(--dsw-alias-label-secondary);font-size:12px;padding:24px;text-align:center}
.gitpanel-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:36px;color:var(--dsw-alias-label-secondary);font-size:12px}
@media (max-width:820px){.gitpanel-columns{flex-direction:column}.gitpanel-graph-pane{flex:1 1 auto;max-height:46%;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.gitpanel-branch-pane{flex:1 1 auto}}
`

    /** Small inline glyphs so the plugin owns no icon font. */
    function BranchGlyph(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        className: 'gitpanel-trigger-icon', 'aria-hidden': true,
      },
      h('path', { d: 'M4.5 3.2v9.6', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' }),
      h('path', { d: 'M4.5 6.6c0 2 1.8 3.1 3.9 3.1h3.1', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' }),
      h('circle', { cx: 4.5, cy: 2.4, r: 1.5, fill: 'currentColor' }),
      h('circle', { cx: 4.5, cy: 13.6, r: 1.5, fill: 'currentColor' }),
      h('circle', { cx: 13.2, cy: 9.7, r: 1.5, fill: 'currentColor' }))
    }

    function CaretDown() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', className: 'gitpanel-trigger-caret', 'aria-hidden': true },
        h('path', { d: 'M2.5 4.5L6 8l3.5-3.5', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
    }

    function CheckGlyph() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M2.4 6.3l2.3 2.3 4.9-4.9', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
    }

    function RefreshGlyph(spinning) {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, className: spinning ? 'gitpanel-spin' : undefined,
      },
      h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.6', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' }),
      h('path', { d: 'M13.2 2.4v2.9h-2.9', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
    }

    /** Relative time without Intl locale churn; falls back to a short date. */
    function relativeTime(seconds, locale) {
      const timestamp = Number(seconds) * 1000
      if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
      const delta = Date.now() - timestamp
      if (delta < 60_000) return locale === 'zh' ? '刚刚' : 'just now'
      const minutes = Math.floor(delta / 60_000)
      if (minutes < 60) return locale === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return locale === 'zh' ? `${hours} 小时前` : `${hours}h ago`
      const days = Math.floor(hours / 24)
      if (days < 30) return locale === 'zh' ? `${days} 天前` : `${days}d ago`
      const months = Math.floor(days / 30)
      if (months < 12) return locale === 'zh' ? `${months} 个月前` : `${months}mo ago`
      return locale === 'zh' ? `${Math.floor(months / 12)} 年前` : `${Math.floor(months / 12)}y ago`
    }

    /** Fill `{n}`-style placeholders in a service or bundled translation. */
    function interpolate(text, params) {
      const source = String(text ?? '')
      if (!params) return source
      return source.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    /** Register the dictionaries and bind a locale-aware translator in apply. */
    function registerLocale(ctx) {
      const dictionaries = { en: DICTIONARIES.en, zh: DICTIONARIES.zh }
      let translate
      try {
        ctx.effect(() => {
          const disposers = Object.entries(dictionaries).map(([locale, dict]) => ctx.locale.register('gitpanel', locale, dict))
          return () => {
            for (const dispose of disposers) {
              try {
                dispose()
              } catch {
                // A namespace disposed with the plugin needs no second release.
              }
            }
          }
        }, 'gitpanel: locale')
        translate = ctx.locale.bind('gitpanel')
      } catch {
        translate = undefined
      }
      return {
        t: (key, params) => {
          if (translate) {
            try {
              const text = translate(key, params)
              if (typeof text === 'string' && text) return text
            } catch {
              // Falls back to the bundled English dictionary.
            }
          }
          return interpolate(DICTIONARIES.en[key] ?? key, params)
        },
        localeId: () => {
          try {
            const snapshot = ctx.locale.getLocale()
            const active = String(snapshot?.active ?? snapshot?.id ?? snapshot?.locale ?? '')
            return /^zh/i.test(active) ? 'zh' : 'en'
          } catch {
            return 'en'
          }
        },
      }
    }

    /** Fetch one Host route; JSON failures still carry a code and message. */
    async function requestJson(url, init) {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
      let text = ''
      try {
        text = await response.text()
      } catch {
        text = ''
      }
      let payload
      try {
        payload = text ? JSON.parse(text) : undefined
      } catch {
        payload = undefined
      }
      if (payload !== null && typeof payload === 'object') return payload
      throw new Error(`Git panel request failed (HTTP ${response.status})`)
    }

    /** Build the query shared by every state request. */
    function stateQuery(sessionId, workspacePath, extra) {
      const params = new URLSearchParams()
      if (typeof sessionId === 'string' && sessionId) params.set('sessionId', sessionId)
      else if (typeof workspacePath === 'string' && workspacePath) params.set('path', workspacePath)
      for (const [key, value] of Object.entries(extra ?? {})) {
        if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
      }
      const query = params.toString()
      return query ? `?${query}` : ''
    }

    const STATE_URL = 'gitpanel/state'
    const SWITCH_URL = 'gitpanel/switch'

    /** One commit row: gutter, subject, ref pills, hash, relative time. */
    function CommitRow({ commit, gutterWidth, locale }) {
      const refs = commit.refs ?? []
      const visibleRefs = refs.filter((ref) => ref.kind !== 'remote').slice(0, 2)
      return h('div', {
        className: 'gitpanel-commit',
        title: `${commit.subject}\n${commit.author} · ${commit.short}`,
      },
      h('div', { style: { width: gutterWidth, minWidth: gutterWidth, flex: 'none' } }),
      h('div', { className: 'gitpanel-commit-subject' }, commit.subject || '(no message)'),
      visibleRefs.length > 0
        ? h('div', { className: 'gitpanel-commit-refs' },
          visibleRefs.map((ref) => h('span', {
            key: `${ref.kind}:${ref.name}`,
            className: `gitpanel-ref${ref.kind === 'head' ? ' gitpanel-ref-head' : ''}`,
            title: ref.name,
          }, ref.kind === 'tag' ? `#${ref.name}` : ref.name)))
        : null,
      h('div', { className: 'gitpanel-commit-spacer' }),
      h('div', { className: 'gitpanel-commit-hash' }, commit.short),
      h('div', { className: 'gitpanel-commit-time' }, relativeTime(commit.time, locale)))
    }

    /** The graph pane: SVG topology behind the commit rows. */
    function CommitGraph({ state, locale, t }) {
      const rows = state.commits ?? []
      const laneCount = Math.max(1, state.laneCount ?? 1)
      // Cap the gutter so many lanes cannot eat the subject column.
      const gutterWidth = Math.min(120, Math.max(28, laneCount * LANE_W + LANE_PAD * 2))
      const height = rows.length * ROW_H
      const laneX = (lane) => LANE_PAD + lane * LANE_W
      const rowY = (row) => row * ROW_H + ROW_H / 2
      const edges = state.edges ?? []
      const paths = edges.map((edge, index) => {
        const x1 = laneX(edge.fromLane)
        const y1 = rowY(edge.fromRow)
        const x2 = laneX(edge.toLane)
        const y2 = rowY(edge.toRow)
        const color = LANES[edge.fromLane % LANES.length]
        if (edge.fromLane === edge.toLane) {
          return h('line', {
            key: `edge-${index}`, x1, y1, x2, y2, stroke: color,
            'stroke-width': 1.8, 'stroke-linecap': 'round',
          })
        }
        const span = Math.max(8, y2 - y1)
        const curve = `M ${x1} ${y1} C ${x1} ${y1 + span * 0.45}, ${x2} ${y2 - span * 0.45}, ${x2} ${y2}`
        return h('path', { key: `edge-${index}`, d: curve, stroke: color, 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round' })
      })
      const nodes = rows.map((commit, index) => {
        const color = LANES[commit.lane % LANES.length]
        return h('g', { key: `node-${commit.hash}` },
          h('circle', { cx: laneX(commit.lane), cy: rowY(index), r: NODE_R + 1.4, fill: 'var(--dsw-menu-surface-fill, var(--dsw-alias-bg-overlay))' }),
          h('circle', {
            cx: laneX(commit.lane), cy: rowY(index), r: NODE_R, fill: color,
            stroke: commit.merge ? 'var(--dsw-menu-surface-fill, var(--dsw-alias-bg-overlay))' : 'none',
            'stroke-width': commit.merge ? 1.6 : 0,
          }))
      })
      return h('div', { className: 'gitpanel-scroll', role: 'group', 'aria-label': t('graphPane') },
        rows.length === 0
          ? h('div', { className: 'gitpanel-empty' }, t('emptyGraph'))
          : h('div', { className: 'gitpanel-graph-wrap' },
            h('svg', {
              className: 'gitpanel-graph-svg',
              width: gutterWidth,
              height,
              viewBox: `0 0 ${gutterWidth} ${height}`,
              'aria-hidden': true,
            }, paths, nodes),
            rows.map((commit, index) => h(CommitRow, {
              key: `${commit.hash}-${index}`,
              commit,
              gutterWidth,
              locale,
            }))))
    }

    /** One switchable branch row. */
    function BranchRow({ branch, disabled, pending, t, onSwitch }) {
      const color = branch.tipLane !== null && branch.tipLane !== undefined
        ? LANES[branch.tipLane % LANES.length]
        : 'var(--dsw-alias-state-idle-primary)'
      const sync = []
      if (branch.ahead > 0) sync.push(`↑${branch.ahead}`)
      if (branch.behind > 0) sync.push(`↓${branch.behind}`)
      const isCurrent = branch.current === true
      return h('button', {
        type: 'button',
        className: 'gitpanel-branch',
        role: 'menuitemradio',
        'aria-checked': isCurrent ? 'true' : 'false',
        'data-current': isCurrent ? 'true' : 'false',
        disabled: disabled || pending || isCurrent,
        title: branch.upstream
          ? `${branch.name} → ${branch.upstream}${branch.gone ? ` (${t('gone')})` : ''}`
          : branch.name,
        onClick: isCurrent || pending || disabled ? undefined : () => onSwitch(branch),
      },
      h('span', { className: 'gitpanel-branch-dot', style: { background: color } }),
      h('span', { className: 'gitpanel-branch-name' }, branch.name),
      sync.length > 0 ? h('span', { className: 'gitpanel-branch-sync' }, sync.join(' ')) : null,
      branch.upstream && sync.length === 0
        ? h('span', { className: 'gitpanel-branch-meta' }, branch.gone ? t('gone') : branch.upstream)
        : null,
      branch.unborn ? h('span', { className: 'gitpanel-branch-meta' }, t('unborn')) : null,
      h('span', { className: 'gitpanel-branch-spacer' }),
      pending ? h('span', { className: 'gitpanel-spin', style: { display: 'flex' } }, RefreshGlyph(true)) : null,
      isCurrent && !pending ? h('span', { className: 'gitpanel-branch-check' }, CheckGlyph()) : null)
    }

    /** The floating menu: graph left, branch list right, error banner and footer. */
    function BranchMenu({
      position, state, loading, error, switching, notice, filter, onFilter, filteredBranches,
      onRefresh, onSwitch, locale, t, panelRef,
    }) {
      const rows = state?.commits ?? []
      const branches = state?.branches ?? []
      const currentBranch = branches.find((branch) => branch.current)
      const currentColor = currentBranch && currentBranch.tipLane !== null && currentBranch.tipLane !== undefined
        ? LANES[currentBranch.tipLane % LANES.length]
        : 'var(--dsw-alias-state-idle-primary)'
      const showLoading = loading && !state
      const showColumns = state !== null
      const errorLeadKey = error?.code && ERROR_LEAD[error.code] ? ERROR_LEAD[error.code] : 'errorGeneric'
      const errorLead = error ? t(errorLeadKey) : ''
      const errorDetail = error?.message && error.message !== errorLead ? error.message : ''

      return h('div', {
        className: 'gitpanel-panel',
        id: PANEL_ID,
        style: position,
        ref: panelRef,
        role: 'dialog',
        'aria-label': t('title'),
        'aria-busy': loading || switching !== null ? 'true' : 'false',
        tabIndex: -1,
      },
      h('div', { className: 'gitpanel-header' },
        h('div', { className: 'gitpanel-header-title' }, BranchGlyph(13), t('title')),
        state?.repo && currentBranch
          ? h('div', { className: 'gitpanel-current', title: currentBranch.name },
            h('span', { className: 'gitpanel-current-dot', style: { background: currentColor } }),
            h('span', { className: 'gitpanel-current-name' }, `${t('current')} ${currentBranch.name}`))
          : state?.repo
            ? h('div', { className: 'gitpanel-current', title: t('detached') },
              h('span', { className: 'gitpanel-current-dot', style: { background: currentColor } }),
              h('span', { className: 'gitpanel-current-name' }, `${t('detached')} @${state.head ?? ''}`))
            : null,
        h('div', { className: 'gitpanel-header-spacer' }),
        h('button', {
          type: 'button', className: 'gitpanel-icon-btn', onClick: onRefresh,
          disabled: loading || switching !== null, title: t('refresh'), 'aria-label': t('refresh'),
        }, RefreshGlyph(loading))),
      error
        ? h('div', { className: 'gitpanel-error', role: 'alert' },
          h('div', { className: 'gitpanel-error-body' },
            h('div', { className: 'gitpanel-error-lead' }, errorLead),
            errorDetail ? h('div', { className: 'gitpanel-error-detail' }, errorDetail) : null),
          h('button', { type: 'button', className: 'gitpanel-error-action', onClick: onRefresh }, t('refresh')))
        : null,
      showLoading
        ? h('div', { className: 'gitpanel-loading', role: 'status', 'aria-live': 'polite' }, RefreshGlyph(true), t('loading'))
        : showColumns
          ? h('div', { className: 'gitpanel-columns', style: { maxHeight: Math.max(140, (position.maxHeight ?? PANEL_MAX_HEIGHT) - 96) } },
            h('div', { className: 'gitpanel-graph-pane' },
              h('div', { className: 'gitpanel-pane-head' },
                t('graphPane'),
                h('span', { className: 'gitpanel-branch-spacer' }),
                h('span', { className: 'gitpanel-pane-meta' }, t('commits', { n: rows.length }))),
              h(CommitGraph, { state, locale, t })),
            h('div', { className: 'gitpanel-branch-pane' },
              h('div', { className: 'gitpanel-pane-head' },
                t('branchPane'),
                h('span', { className: 'gitpanel-branch-spacer' }),
                h('span', { className: 'gitpanel-pane-meta' }, t('branches', { n: branches.length }))),
              branches.length > 6
                ? h('div', { className: 'gitpanel-filter' },
                  h('input', {
                    className: 'gitpanel-filter-input',
                    type: 'search',
                    value: filter,
                    placeholder: t('filter'),
                    'aria-label': t('filter'),
                    onChange: (event) => onFilter(event.target.value),
                  }))
                : null,
              h('div', { className: 'gitpanel-branch-list', role: 'menu', 'aria-label': t('branchPane') },
                branches.length === 0
                  ? h('div', { className: 'gitpanel-empty' }, t('noBranches'))
                  : filteredBranches.length === 0
                    ? h('div', { className: 'gitpanel-empty' }, t('filterEmpty'))
                    : filteredBranches.map((branch) => h(BranchRow, {
                      key: branch.name,
                      branch,
                      disabled: switching !== null,
                      pending: switching === branch.name,
                      t,
                      onSwitch,
                    })))))
          : null,
      h('div', { className: 'gitpanel-footer' },
        state?.repo
          ? [
            h('span', { key: 'counts' }, `${t('branches', { n: branches.length })} · ${t('commits', { n: rows.length })}`),
            h('span', { key: 'spacer', className: 'gitpanel-footer-spacer' }),
            switching
              ? h('span', { key: 'switching', className: 'gitpanel-warn', role: 'status', 'aria-live': 'polite' }, t('switching'))
              : null,
            notice
              ? h('span', { key: 'notice', className: 'gitpanel-status', role: 'status', 'aria-live': 'polite' }, notice)
              : null,
            state.truncated
              ? h('span', { key: 'truncated' }, t('truncated', { n: state.commitLimit ?? COMMIT_LIMIT }))
              : null,
            (state.dirtyCount ?? 0) > 0
              ? h('span', { key: 'dirty', className: 'gitpanel-warn' }, t('dirtyCount', { n: state.dirtyCount }))
              : null,
          ]
          : state
            ? [h('span', { key: 'hint' }, t('notRepo'))]
            : []))
    }

    /** Trigger + popup. `translator` is supplied by the registration wrapper. */
    function GitPanel(props) {
      const { t } = props.translator
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
      // The Session's committed working directory, then its workspace directory.
      const sessionCwd = props.useSessions((state) => (sessionId === undefined ? undefined : state.byId[sessionId]?.cwd))
      const workspaceSnapshot = props.useWorkspaces((state) => state)
      const workspacePath = sessionCwd
        ?? (workspaceSnapshot?.items ?? []).find((workspace) => (workspace.sessionIds ?? []).includes(sessionId))?.path
      const localeId = props.translator.localeId()
      const triggerRef = useRef(null)
      const panelRef = useRef(null)
      const openRef = useRef(false)
      const nonRepoRef = useRef(false)
      const requestRef = useRef(0)
      const loadControllerRef = useRef(null)
      const lastRectRef = useRef(null)
      const [branchInfo, setBranchInfo] = useState(null)
      const [open, setOpen] = useState(false)
      const [state, setState] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState(null)
      const [switching, setSwitching] = useState(null)
      const [notice, setNotice] = useState(null)
      const [filter, setFilter] = useState('')
      const [position, setPosition] = useState(null)

      /** Measure the trigger and place the panel above it, only when it moved. */
      const computePosition = useCallback(() => {
        const trigger = triggerRef.current
        if (!trigger) return
        const rect = trigger.getBoundingClientRect()
        const last = lastRectRef.current
        if (last && last.top === rect.top && last.left === rect.left && last.width === rect.width) {
          if (last.viewport === window.innerHeight) return
        }
        lastRectRef.current = { top: rect.top, left: rect.left, width: rect.width, viewport: window.innerHeight }
        const width = Math.min(PANEL_WIDTH, window.innerWidth - 24)
        const maxHeight = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, rect.top - 16))
        const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))
        setPosition({
          width,
          left,
          bottom: Math.max(8, window.innerHeight - rect.top + 8),
          maxHeight,
        })
      }, [])

      /** Light poll: only the facts the trigger needs. */
      const refreshLight = useCallback(async () => {
        const requestId = ++requestRef.current
        try {
          const payload = await requestJson(`${STATE_URL}${stateQuery(sessionId, workspacePath, { light: 1 })}`)
          if (requestId !== requestRef.current) return
          if (payload.ok === false) {
            nonRepoRef.current = true
            setBranchInfo(null)
            return
          }
          nonRepoRef.current = payload.repo === false
          setBranchInfo(payload)
          if (openRef.current && payload.repo === false) setOpen(false)
        } catch {
          // A transient network failure keeps the last known branch.
        }
      }, [sessionId, workspacePath])

      /** Full read for the menu; a newer read aborts the previous request. */
      const loadState = useCallback(async () => {
        if (loadControllerRef.current) loadControllerRef.current.abort()
        const controller = new AbortController()
        loadControllerRef.current = controller
        setLoading(true)
        setError(null)
        try {
          const payload = await requestJson(`${STATE_URL}${stateQuery(sessionId, workspacePath, { commits: COMMIT_LIMIT })}`, { signal: controller.signal })
          if (controller.signal.aborted) return
          if (payload.ok === false) {
            setError({ code: payload.code, message: payload.message })
            setState(null)
            return
          }
          setState(payload)
          if (payload.repo === false) setError({ code: 'not-a-repo', message: payload.message })
        } catch (failure) {
          if (controller.signal.aborted) return
          setError({ code: 'network', message: failure?.message })
          setState(null)
        } finally {
          if (loadControllerRef.current === controller) {
            loadControllerRef.current = null
            setLoading(false)
          }
        }
      }, [sessionId, workspacePath])

      // Initial and periodic branch refresh. A directory that is not a Git
      // repository backs off to every sixth tick so a plain workspace stays cheap.
      useEffect(() => {
        let disposed = false
        let ticks = 0
        const tick = () => {
          if (disposed) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          if (openRef.current) return
          ticks += 1
          if (nonRepoRef.current && ticks % 6 !== 0) return
          void refreshLight()
        }
        void refreshLight()
        const interval = setInterval(tick, POLL_MS)
        const onFocus = () => { if (!openRef.current) void refreshLight() }
        window.addEventListener('focus', onFocus)
        return () => {
          disposed = true
          clearInterval(interval)
          window.removeEventListener('focus', onFocus)
          if (loadControllerRef.current) loadControllerRef.current.abort()
        }
      }, [refreshLight])

      const close = useCallback((restoreFocus) => {
        setOpen(false)
        setError(null)
        if (restoreFocus) triggerRef.current?.focus()
      }, [])

      const toggle = useCallback(() => {
        if (open) {
          close(true)
          return
        }
        setError(null)
        setNotice(null)
        setFilter('')
        computePosition()
        setOpen(true)
      }, [close, computePosition, open])

      // While the menu is open: read the repository, focus it, trap Tab, and
      // close on Escape or a pointer press outside the panel and trigger.
      useEffect(() => {
        openRef.current = open
        if (!open) {
          // A menu close may follow an external change; refresh the trigger.
          void refreshLight()
          return undefined
        }
        void loadState()
        panelRef.current?.focus()
        const isInside = (node) => {
          if (!node) return false
          if (panelRef.current?.contains(node)) return true
          if (triggerRef.current?.contains(node)) return true
          return false
        }
        const focusables = () => {
          const panel = panelRef.current
          if (!panel) return []
          return [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close(true)
            return
          }
          if (event.key !== 'Tab') return
          const panel = panelRef.current
          if (!panel) return
          const list = focusables()
          if (list.length === 0) {
            event.preventDefault()
            panel.focus()
            return
          }
          const first = list[0]
          const last = list[list.length - 1]
          const active = document.activeElement
          if (!panel.contains(active)) {
            event.preventDefault()
            first.focus()
            return
          }
          if (event.shiftKey && active === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && active === last) {
            event.preventDefault()
            first.focus()
          }
        }
        const onPointerDown = (event) => {
          if (isInside(event.target)) return
          close(false)
        }
        const schedule = () => {
          requestAnimationFrame(() => computePosition())
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('mousedown', onPointerDown)
        window.addEventListener('resize', schedule)
        window.addEventListener('scroll', schedule, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('mousedown', onPointerDown)
          window.removeEventListener('resize', schedule)
          window.removeEventListener('scroll', schedule, true)
        }
      }, [open, loadState, refreshLight, computePosition, close])

      // The success notice is short-lived.
      useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(null), 3000)
        return () => clearTimeout(timer)
      }, [notice])

      const switchTo = useCallback(async (branch) => {
        if (switching || !branch || branch.current) return
        setSwitching(branch.name)
        setError(null)
        setNotice(null)
        try {
          const payload = await requestJson(SWITCH_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ branch: branch.name, sessionId, path: workspacePath }),
          })
          if (payload.ok === false) {
            setError({ code: payload.code, message: payload.message })
            return
          }
          if (payload.state) setState(payload.state)
          const name = payload.branch ?? branch.name
          setBranchInfo({ repo: true, branch: name, detached: false, head: payload.state?.head ?? null })
          setNotice(t('switchedTo', { name }))
          panelRef.current?.focus()
          void refreshLight()
        } catch (failure) {
          setError({ code: 'network', message: failure?.message })
        } finally {
          setSwitching(null)
        }
      }, [sessionId, workspacePath, refreshLight, switching, t])

      // Hidden until the repository is known to be a Git repository.
      if (!branchInfo || branchInfo.repo !== true) return null

      const label = branchInfo.branch ?? `${t('detached')} @${branchInfo.head ?? ''}`
      const trigger = h('button', {
        type: 'button',
        ref: triggerRef,
        className: 'gitpanel-trigger',
        onClick: toggle,
        title: `${t('trigger')} · ${label}`,
        'aria-label': t('trigger'),
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false',
        'aria-controls': open ? PANEL_ID : undefined,
      }, BranchGlyph(14), h('span', { className: 'gitpanel-trigger-label' }, label), CaretDown())

      if (!open) {
        return h(React.Fragment, null, h('style', null, CSS), trigger)
      }

      const branches = state?.branches ?? []
      const normalizedFilter = filter.trim().toLowerCase()
      const filteredBranches = normalizedFilter
        ? branches.filter((branch) => branch.name.toLowerCase().includes(normalizedFilter))
        : branches

      const menu = h('div', { className: 'gitpanel-layer' },
        position
          ? h(BranchMenu, {
            position,
            state,
            loading,
            error,
            switching,
            notice,
            filter,
            onFilter: setFilter,
            filteredBranches,
            onRefresh: loadState,
            onSwitch: switchTo,
            locale: localeId,
            t,
            panelRef,
          })
          : null)

      const layer = createPortal ? createPortal(menu, document.body) : menu
      return h(React.Fragment, null, h('style', null, CSS), trigger, layer)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const translator = registerLocale(ctx)
        /** The slot owner passes its standard props; the translator comes from here. */
        const Registered = (props) => h(GitPanel, Object.assign({}, props, { translator }))
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'gitpanel-branch',
          order: 12,
          label: () => 'Git',
        }, Registered))
      },
    }
  },
})
