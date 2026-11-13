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
    const { useState, useEffect, useRef, useCallback, useMemo } = React

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
        actions: 'Repository actions',
        fetch: 'Fetch',
        pull: 'Pull',
        newBranch: 'New branch',
        commit: 'Commit',
        push: 'Push to remote',
        commitWithCount: 'Commit | {n} uncommitted',
        commitTooltip: '{n} uncommitted change(s)',
        commitNoChanges: 'No committable changes',
        commitOnlyUntracked: 'Only untracked files are present',
        working: 'Working…',
        fetching: 'Fetching…',
        pulling: 'Pulling…',
        pushing: 'Pushing…',
        creatingBranch: 'Creating branch…',
        committing: 'Committing…',
        fetchDone: 'Fetched from the remote',
        pullDone: 'Pulled from the remote',
        pushDone: 'Pushed to the remote',
        branchCreated: 'Created branch {name}',
        commitDone: 'Committed {commit}',
        commitMessage: 'Commit message',
        commitMessagePlaceholder: 'Describe your changes',
        commitTemplateLoading: 'Reading commit template…',
        commitTemplateUnreadable: 'The configured commit template could not be read.',
        cancel: 'Cancel',
        close: 'Close',
        create: 'Create',
        branchName: 'Branch name',
        branchNamePlaceholder: 'Enter branch name',
        branchNameHint: 'Created from the current branch and switched to it.',
        hintStaged: '{n} staged change(s) will be committed',
        hintTracked: 'No staged changes: all tracked modifications will be committed',
        pushNoUpstream: 'This branch has no upstream yet. Push it and set the upstream?',
        pushUpstreamTarget: 'Push to {remote}/{branch}',
        remote: 'Remote',
        confirmPush: 'Push and set upstream',
        warningLabel: 'Warning',
        detailsLabel: 'Details',
        conflictFiles: 'Conflicted files: {files}',
        errorInvalidBranch: 'Enter a valid branch name.',
        errorBranchExists: 'That branch already exists.',
        errorFetchNoRemote: 'No remote repository is configured.',
        errorFetchNetwork: 'Cannot reach the remote repository. Check the network connection.',
        errorPullConflict: 'Merge conflict detected. Resolve the conflicts and try again.',
        errorPullNoUpstream: 'This branch has no upstream branch.',
        errorPullDirty: 'Local changes would be overwritten. Commit or stash them first.',
        errorCommitEmptyMessage: 'The commit message cannot be empty.',
        errorCommitNothing: 'There is nothing to commit.',
        errorCommitConflict: 'Resolve the conflicts before committing.',
        errorCommitHook: 'A Git hook rejected the commit.',
        errorCommitIdentity: 'Git author identity is not configured.',
        errorCommitGeneric: 'Commit failed. Check the message and the staging area.',
        errorPushNoRemote: 'No remote repository is configured.',
        errorPushNoUpstream: 'This branch has no upstream branch.',
        errorPushDetached: 'Cannot push from a detached HEAD.',
        errorPushRejected: 'The remote has new commits. Pull before pushing.',
        errorAuth: 'Authentication to the remote failed.',
        errorRemoteNetwork: 'Cannot reach the remote repository. Check the network connection.',
        errorActionTimeout: 'The Git operation timed out.',
        errorActionGeneric: 'The Git operation failed.',
        notRepo: 'This directory is not a Git repository',
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
        actions: '仓库操作',
        fetch: '获取',
        pull: '拉取',
        newBranch: '新建分支',
        commit: '提交',
        push: '推送到远程仓库',
        commitWithCount: '提交 | {n} 个未提交更改',
        commitTooltip: '{n} 个未提交更改',
        commitNoChanges: '没有可提交的更改',
        commitOnlyUntracked: '当前只有未跟踪文件',
        working: '正在处理中…',
        fetching: '正在获取…',
        pulling: '正在拉取…',
        pushing: '正在推送…',
        creatingBranch: '正在创建分支…',
        committing: '正在提交…',
        fetchDone: '已从远程获取',
        pullDone: '已从远程拉取',
        pushDone: '已推送到远程',
        branchCreated: '已创建分支 {name}',
        commitDone: '已提交 {commit}',
        commitMessage: '提交说明',
        commitMessagePlaceholder: '填写本次提交说明',
        commitTemplateLoading: '正在读取提交模板…',
        commitTemplateUnreadable: '无法读取已配置的提交模板。',
        cancel: '取消',
        close: '关闭',
        create: '创建',
        branchName: '分支名称',
        branchNamePlaceholder: '输入分支名称',
        branchNameHint: '将从当前分支创建并切换到新分支。',
        hintStaged: '将提交 {n} 个已暂存更改',
        hintTracked: '没有已暂存更改，将提交所有已跟踪文件的修改',
        pushNoUpstream: '当前分支还没有上游分支，要推送并设置上游吗？',
        pushUpstreamTarget: '推送到 {remote}/{branch}',
        remote: '远程仓库',
        confirmPush: '推送并设置上游',
        warningLabel: '警告',
        detailsLabel: '详细信息',
        conflictFiles: '冲突文件：{files}',
        errorInvalidBranch: '请输入合法的分支名称。',
        errorBranchExists: '该分支已存在。',
        errorFetchNoRemote: '没有配置远程仓库。',
        errorFetchNetwork: '无法连接到远程仓库，请检查网络连接。',
        errorPullConflict: '合并发生冲突，请先解决冲突后重试。',
        errorPullNoUpstream: '当前分支没有上游分支。',
        errorPullDirty: '本地修改会被覆盖，请先提交或暂存。',
        errorCommitEmptyMessage: '提交说明不能为空。',
        errorCommitNothing: '没有可提交的更改。',
        errorCommitConflict: '存在未解决的冲突，请先解决。',
        errorCommitHook: 'Git 钩子拒绝了本次提交。',
        errorCommitIdentity: '尚未配置 Git 作者身份。',
        errorCommitGeneric: '提交失败，请检查提交信息或暂存区状态。',
        errorPushNoRemote: '没有配置远程仓库。',
        errorPushNoUpstream: '当前分支没有上游分支。',
        errorPushDetached: '游离 HEAD 状态下无法推送。',
        errorPushRejected: '远程有新提交，请先拉取后再推送。',
        errorAuth: '远程仓库认证失败。',
        errorRemoteNetwork: '无法连接到远程仓库，请检查网络连接。',
        errorActionTimeout: 'Git 操作超时。',
        errorActionGeneric: 'Git 操作失败。',
        notRepo: '当前目录不是 Git 仓库',
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

    /** Per-action failure codes to localized speech-bubble headlines. */
    const ACTION_ERROR_LEADS = {
      fetch: {
        'no-remote': 'errorFetchNoRemote',
        network: 'errorFetchNetwork',
        auth: 'errorAuth',
        timeout: 'errorActionTimeout',
        default: 'errorActionGeneric',
      },
      pull: {
        conflict: 'errorPullConflict',
        'no-upstream': 'errorPullNoUpstream',
        dirty: 'errorPullDirty',
        network: 'errorRemoteNetwork',
        auth: 'errorAuth',
        timeout: 'errorActionTimeout',
        default: 'errorActionGeneric',
      },
      commit: {
        'empty-message': 'errorCommitEmptyMessage',
        'nothing-to-commit': 'errorCommitNothing',
        conflict: 'errorCommitConflict',
        'hook-failed': 'errorCommitHook',
        identity: 'errorCommitIdentity',
        default: 'errorCommitGeneric',
      },
      push: {
        'no-remote': 'errorPushNoRemote',
        'no-upstream': 'errorPushNoUpstream',
        detached: 'errorPushDetached',
        rejected: 'errorPushRejected',
        network: 'errorRemoteNetwork',
        auth: 'errorAuth',
        timeout: 'errorActionTimeout',
        default: 'errorActionGeneric',
      },
      branch: {
        'invalid-name': 'errorInvalidBranch',
        exists: 'errorBranchExists',
        default: 'errorActionGeneric',
      },
    }

    /** The actions in the footer bar, left to right. */
    const ACTIONS = ['fetch', 'pull', 'branch', 'commit', 'push']

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
.gitpanel-commit{display:flex;align-items:center;gap:8px;height:${ROW_H}px;min-width:0;padding-right:12px;font-size:12px;line-height:18px;white-space:nowrap}
.gitpanel-commit-subject{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);line-height:18px}
.gitpanel-commit-refs{flex:0 0 auto;display:flex;align-items:center;gap:4px;white-space:nowrap}
.gitpanel-ref{flex:0 0 auto;padding:2px 6px;border-radius:var(--dsw-radius-sm,8px);corner-shape:round;font-size:10.5px;line-height:1.35;border:1px solid transparent;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.gitpanel-ref-head{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));background:var(--dsw-alias-state-business-tertiary,var(--dsw-alias-bg-layer-2))}
.gitpanel-commit-spacer{flex:1}
.gitpanel-commit-hash{flex:none;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;opacity:.85}
.gitpanel-commit-time{flex:none;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary));font-size:11px;min-width:56px;text-align:right;line-height:18px}
.gitpanel-tooltip{position:fixed;z-index:1300;pointer-events:none;box-sizing:border-box;overflow:visible;padding:8px 12px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-overlay,#ffffff));box-shadow:var(--dsw-elevation-prominent,0 4px 12px rgba(0,0,0,.1));color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5}
.gitpanel-tooltip-body{display:flex;flex-direction:column;min-height:0;max-height:min(240px,calc(100vh - 32px));overflow:auto;scrollbar-width:thin;scrollbar-color:var(--dsh-scrollbar-thumb,var(--dsw-alias-border-l2)) transparent;--dsh-scrollbar-thumb:var(--dsw-alias-border-l2)}
.gitpanel-tooltip-subject{white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}
.gitpanel-tooltip-meta{margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gitpanel-tooltip-tail{position:absolute;width:10px;height:10px;background:inherit;transform:rotate(45deg);border-right:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}
.gitpanel-tooltip[data-placement="below"] .gitpanel-tooltip-tail{top:-6px;transform:rotate(225deg)}
.gitpanel-tooltip[data-placement="above"] .gitpanel-tooltip-tail{bottom:-6px}
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
.gitpanel-footer{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:10px;row-gap:4px;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;min-height:32px;box-sizing:border-box}
.gitpanel-footer-spacer{flex:1}
.gitpanel-warn{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}
.gitpanel-status{color:var(--dsw-alias-state-success-primary)}
.gitpanel-empty{display:flex;align-items:center;justify-content:center;min-height:120px;color:var(--dsw-alias-label-secondary);font-size:12px;padding:24px;text-align:center}
.gitpanel-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:36px;color:var(--dsw-alias-label-secondary);font-size:12px}
@media (max-width:820px){.gitpanel-columns{flex-direction:column}.gitpanel-graph-pane{flex:1 1 auto;max-height:46%;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.gitpanel-branch-pane{flex:1 1 auto}}
@media (max-width:900px){.gitpanel-commit{gap:6px;padding-right:8px}.gitpanel-commit-hash,.gitpanel-commit-time{font-size:10.5px}.gitpanel-commit-time{min-width:44px}}
.gitpanel-footer-info{flex:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gitpanel-actions{display:flex;align-items:center;gap:2px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end;min-width:0}
.gitpanel-action{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 6px;border:0;border-radius:var(--dsw-radius-sm,8px);outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;font-weight:500;line-height:15px;cursor:pointer;white-space:nowrap;transition:background .12s ease,color .12s ease}
@media (hover:hover){.gitpanel-action:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}}
.gitpanel-action:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gitpanel-action[disabled]{opacity:.45;cursor:default}
.gitpanel-action[data-busy="true"]{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary))}
.gitpanel-action-icon{flex:none;display:flex;align-items:center}
.gitpanel-action-label{overflow:hidden;text-overflow:ellipsis;line-height:15px;padding-bottom:0;padding-top:0}
.gitpanel-action-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;corner-shape:round;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#F59F00) 16%,transparent);color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary,#B7791F));font-size:10.5px;font-weight:600}
@media (max-width:860px){.gitpanel-action{padding:0 5px}.gitpanel-action-label{display:none}}
@media (max-width:700px){.gitpanel-footer-info{display:none}}
.gitpanel-bubble{position:fixed;z-index:1200;pointer-events:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:0;width:360px;height:auto;padding:10px 12px;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-overlay));backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent,0 0 0 .5px var(--dsw-alias-border-l1),0 3px 8px 0 rgba(0,0,0,.04),0 0 20px 0 rgba(0,0,0,.05));color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.5;overflow:visible;outline:none}
.gitpanel-bubble-content{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;--dsh-scrollbar-thumb:var(--dsw-alias-border-l2)}
.gitpanel-bubble[data-variant="error"]{background:var(--dsw-alias-state-error-primary,#D92D20);color:#fff;gap:0;padding:9px 11px;box-shadow:0 6px 20px rgba(0,0,0,.18)}
.gitpanel-bubble[data-variant="error"] .gitpanel-bubble-content{overflow:visible}
.gitpanel-bubble-tail{position:absolute;width:12px;height:12px;transform:rotate(45deg);background:inherit;border-right:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}
.gitpanel-bubble[data-variant="error"] .gitpanel-bubble-tail{border:0}
.gitpanel-bubble[data-placement="above"] .gitpanel-bubble-tail{bottom:-6px}
.gitpanel-bubble[data-placement="below"] .gitpanel-bubble-tail{top:-6px;transform:rotate(225deg)}
.gitpanel-bubble-title{display:flex;align-items:center;gap:6px;font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary);flex:none}
.gitpanel-bubble-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-left:auto;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1;cursor:pointer;padding:0;opacity:.75}
@media (hover:hover){.gitpanel-bubble-close:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}}
.gitpanel-bubble-close:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary)}
.gitpanel-bubble[data-variant="error"] .gitpanel-bubble-close{color:#fff}
.gitpanel-bubble-textarea{width:100%;box-sizing:border-box;min-height:160px;max-height:300px;resize:vertical;padding:8px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.5;outline:none;white-space:pre;overflow-x:auto;overflow-y:auto;word-break:normal;overflow-wrap:normal;scrollbar-width:thin;scrollbar-color:var(--dsh-scrollbar-thumb,var(--dsw-alias-border-l2)) transparent}
.gitpanel-bubble-textarea::-webkit-scrollbar{width:10px;height:10px}
.gitpanel-bubble-textarea::-webkit-scrollbar-thumb{background:var(--dsh-scrollbar-thumb,var(--dsw-alias-border-l2));border-radius:999px}
.gitpanel-bubble-textarea::-webkit-scrollbar-thumb:hover{background:var(--dsh-scrollbar-thumb-hover,var(--dsw-alias-label-secondary))}
.gitpanel-bubble-textarea::-webkit-scrollbar-track{background:transparent}
.gitpanel-bubble-input{width:100%;box-sizing:border-box;height:30px;padding:0 8px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;outline:none}
.gitpanel-bubble-textarea:focus-visible,.gitpanel-bubble-input:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px;border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-border-l2))}
.gitpanel-bubble-textarea::placeholder,.gitpanel-bubble-input::placeholder{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
.gitpanel-bubble-hint{flex:1;min-width:0;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary));font-size:11px;line-height:1.4}
.gitpanel-bubble-footer{display:flex;align-items:center;gap:8px;flex:none}
.gitpanel-bubble-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
@media (hover:hover){.gitpanel-bubble-btn:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-border-l1))}}
.gitpanel-bubble-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gitpanel-bubble-btn[disabled]{opacity:.5;cursor:default}
.gitpanel-bubble-btn-primary{background:var(--dsw-alias-state-business-tertiary,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));font-weight:600}
.gitpanel-bubble-error{display:flex;align-items:flex-start;gap:8px;min-width:0}
.gitpanel-bubble-inline-error{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-state-error-primary,#D92D20);color:#fff}
.gitpanel-warning{flex:none;display:flex;align-items:center;padding-top:1px}
.gitpanel-bubble-error-body{flex:1;min-width:0}
.gitpanel-bubble-error-title{font-weight:600;color:#fff}
.gitpanel-bubble-inline-error .gitpanel-bubble-error-title{font-size:12px}
.gitpanel-bubble-error-detail{margin-top:3px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word;opacity:.92}
.gitpanel-bubble-select{height:26px;max-width:150px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 6px;outline:none}
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

    /** A monochrome warning mark: white triangle with a black exclamation. */
    function WarningGlyph() {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: false,
      },
      h('path', { d: 'M8 1.6L15 14.2H1L8 1.6Z', fill: '#FFFFFF', stroke: '#FFFFFF', 'stroke-width': 1, 'stroke-linejoin': 'round' }),
      h('path', { d: 'M8 5.7v4.1', stroke: '#111111', 'stroke-width': 1.7, 'stroke-linecap': 'round' }),
      h('circle', { cx: 8, cy: 12.1, r: 0.95, fill: '#111111' }))
    }

    /** Inline glyphs for the five footer actions. */
    function ActionIcon(name) {
      const common = {
        width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, focusable: false, className: 'gitpanel-action-icon',
      }
      const stroke = { stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
      if (name === 'fetch') {
        return h('svg', common,
          h('path', { d: 'M8 2.6v6.6', ...stroke }),
          h('path', { d: 'M5 6.4L8 9.4l3-3', ...stroke }),
          h('path', { d: 'M3.4 13.4h9.2', ...stroke }))
      }
      if (name === 'pull') {
        return h('svg', common,
          h('path', { d: 'M8 2.6v6', ...stroke }),
          h('path', { d: 'M5 5.6l3 3 3-3', ...stroke }),
          h('path', { d: 'M3 10.6v2.8h10v-2.8', ...stroke }))
      }
      if (name === 'branch') {
        return h('svg', common,
          h('path', { d: 'M5 3v10', ...stroke }),
          h('path', { d: 'M5 7.2c0 2 1.8 2.9 3.9 2.9H11', ...stroke }),
          h('circle', { cx: 5, cy: 2.4, r: 1.4, fill: 'currentColor' }),
          h('circle', { cx: 5, cy: 13.6, r: 1.4, fill: 'currentColor' }),
          h('path', { d: 'M13.4 2.4v3.4', ...stroke }),
          h('path', { d: 'M11.7 4.1h3.4', ...stroke }))
      }
      if (name === 'push') {
        return h('svg', common,
          h('path', { d: 'M8 13.4V6.6', ...stroke }),
          h('path', { d: 'M5 9.6l3-3 3 3', ...stroke }),
          h('path', { d: 'M3.4 2.6h9.2', ...stroke }))
      }
      return h('svg', common,
        h('circle', { cx: 8, cy: 8, r: 6.2, ...stroke }),
        h('path', { d: 'M5.1 8.2l2 2 3.9-4', ...stroke }))
    }

    /** Shared speech-bubble shell: tail, radius, shadow, and anchored geometry. */
    function SpeechBubble({ variant, geometry, label, bubbleRef, children }) {
      const style = { width: geometry.width, left: geometry.left }
      if (geometry.placement === 'above') style.bottom = geometry.bottom
      else style.top = geometry.top
      // Error bubbles take their natural height so short messages never scroll;
      // form content keeps the measured cap and scrolls inside the bubble.
      const contentStyle = {}
      if (variant !== 'error' && geometry.maxHeight) contentStyle.maxHeight = geometry.maxHeight
      return h('div', {
        ref: bubbleRef,
        className: 'gitpanel-bubble',
        'data-variant': variant,
        'data-placement': geometry.placement,
        style,
        role: variant === 'error' ? 'alert' : 'dialog',
        'aria-label': label,
        'aria-live': variant === 'error' ? 'assertive' : undefined,
        tabIndex: -1,
      },
      h('span', { className: 'gitpanel-bubble-tail', style: { left: geometry.tailOffset } }),
      h('div', { className: 'gitpanel-bubble-content', style: contentStyle }, children))
    }

    /**
     * The one error presentation used by every bubble: white-on-red, monochrome
     * warning mark, a concise localized headline, and git's own detail.
     */
    function BubbleErrorBody({ error, t, onClose, inline = false }) {
      return h('div', { className: inline ? 'gitpanel-bubble-inline-error' : 'gitpanel-bubble-error' },
        h('span', { className: 'gitpanel-warning' }, WarningGlyph()),
        h('div', { className: 'gitpanel-bubble-error-body' },
          h('div', { className: 'gitpanel-bubble-error-title' }, error?.lead ?? t('errorActionGeneric')),
          error?.detail ? h('div', { className: 'gitpanel-bubble-error-detail' }, error.detail) : null,
          Array.isArray(error?.files) && error.files.length > 0
            ? h('div', { className: 'gitpanel-bubble-error-detail' }, t('conflictFiles', { files: error.files.join(', ') }))
            : null),
        onClose
          ? h('button', { type: 'button', className: 'gitpanel-bubble-close', onClick: onClose, title: t('close'), 'aria-label': t('close') }, '×')
          : null)
    }

    /** Commit editor bubble content. */
    function CommitBubbleBody({ t, draft, onDraft, textareaRef, templateLoading, hint, busy, error, onClose, onErrorClose, onCommit }) {
      const canCommit = !busy && !templateLoading && draft.trim().length > 0
      return h(React.Fragment, null,
        h('div', { className: 'gitpanel-bubble-title' },
          ActionIcon('commit'),
          t('commitMessage'),
          h('button', { type: 'button', className: 'gitpanel-bubble-close', onClick: onClose, title: t('close'), 'aria-label': t('close') }, '×')),
        error ? h(BubbleErrorBody, { error, t, onClose: onErrorClose, inline: true }) : null,
        h('textarea', {
          ref: textareaRef,
          className: 'gitpanel-bubble-textarea',
          value: draft,
          placeholder: t('commitMessagePlaceholder'),
          'aria-label': t('commitMessage'),
          disabled: busy,
          spellCheck: false,
          wrap: 'off',
          onChange: (event) => onDraft(event.target.value),
        }),
        h('div', { className: 'gitpanel-bubble-footer' },
          h('div', { className: 'gitpanel-bubble-hint' }, templateLoading ? t('commitTemplateLoading') : hint),
          h('button', { type: 'button', className: 'gitpanel-bubble-btn', onClick: onClose, disabled: busy }, t('cancel')),
          h('button', {
            type: 'button',
            className: 'gitpanel-bubble-btn gitpanel-bubble-btn-primary',
            onClick: onCommit,
            disabled: !canCommit,
          }, busy ? RefreshGlyph(true) : null, busy ? t('committing') : t('commit'))))
    }

    /** New-branch input bubble content. */
    function BranchBubbleBody({ t, name, onName, inputRef, busy, error, onClose, onErrorClose, onCreate }) {
      return h(React.Fragment, null,
        h('div', { className: 'gitpanel-bubble-title' },
          ActionIcon('branch'),
          t('newBranch'),
          h('button', { type: 'button', className: 'gitpanel-bubble-close', onClick: onClose, title: t('close'), 'aria-label': t('close') }, '×')),
        h('input', {
          ref: inputRef,
          className: 'gitpanel-bubble-input',
          value: name,
          placeholder: t('branchNamePlaceholder'),
          'aria-label': t('branchName'),
          spellCheck: false,
          disabled: busy,
          onChange: (event) => onName(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && name.trim() && !busy) onCreate()
          },
        }),
        h('div', { className: 'gitpanel-bubble-hint' }, t('branchNameHint')),
        error ? h(BubbleErrorBody, { error, t, onClose: onErrorClose, inline: true }) : null,
        h('div', { className: 'gitpanel-bubble-footer' },
          h('button', { type: 'button', className: 'gitpanel-bubble-btn', onClick: onClose, disabled: busy }, t('cancel')),
          h('button', {
            type: 'button',
            className: 'gitpanel-bubble-btn gitpanel-bubble-btn-primary',
            onClick: onCreate,
            disabled: busy || name.trim().length === 0,
          }, busy ? t('creatingBranch') : t('create'))))
    }

    /** Push-without-upstream confirmation bubble content. */
    function PushBubbleBody({ t, branch, remotes, remote, onRemote, busy, error, onClose, onErrorClose, onConfirm }) {
      const target = `${remote ?? remotes?.[0] ?? ''}/${branch ?? ''}`
      return h(React.Fragment, null,
        h('div', { className: 'gitpanel-bubble-title' },
          ActionIcon('push'),
          t('push'),
          h('button', { type: 'button', className: 'gitpanel-bubble-close', onClick: onClose, title: t('close'), 'aria-label': t('close') }, '×')),
        h('div', { className: 'gitpanel-bubble-hint' }, t('pushNoUpstream')),
        remotes && remotes.length > 1
          ? h('label', { className: 'gitpanel-bubble-footer' },
            h('span', { className: 'gitpanel-bubble-hint' }, t('remote')),
            h('select', {
              className: 'gitpanel-bubble-select',
              value: remote ?? remotes[0],
              onChange: (event) => onRemote(event.target.value),
              disabled: busy,
              'aria-label': t('remote'),
            }, remotes.map((name) => h('option', { key: name, value: name }, name))))
          : null,
        h('div', { className: 'gitpanel-bubble-hint' }, t('pushUpstreamTarget', { remote: remote ?? remotes?.[0] ?? '', branch: branch ?? '' })),
        error ? h(BubbleErrorBody, { error, t, onClose: onErrorClose, inline: true }) : null,
        h('div', { className: 'gitpanel-bubble-footer' },
          h('button', { type: 'button', className: 'gitpanel-bubble-btn', onClick: onClose, disabled: busy }, t('cancel')),
          h('button', {
            type: 'button',
            className: 'gitpanel-bubble-btn gitpanel-bubble-btn-primary',
            onClick: onConfirm,
            disabled: busy || !target.replace('/', ''),
          }, busy ? RefreshGlyph(true) : null, busy ? t('pushing') : t('confirmPush'))))
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

    /** One commit-draft slot per repository; nothing is written into Git config. */
    function draftStorageKeyOf(repoRoot) {
      return repoRoot ? `gitpanel:commit-draft:v1:${repoRoot}` : null
    }
    function readStoredDraft(key) {
      if (!key) return ''
      try {
        return window.localStorage.getItem(key) ?? ''
      } catch {
        return ''
      }
    }
    function writeStoredDraft(key, value) {
      if (!key) return
      try {
        if (value) window.localStorage.setItem(key, value)
        else window.localStorage.removeItem(key)
      } catch {
        // Storage can be unavailable (private mode, quota); the draft then only lives in memory.
      }
    }

    const STATE_URL = 'gitpanel/state'
    const SWITCH_URL = 'gitpanel/switch'
    const TEMPLATE_URL = 'gitpanel/commit-template'
    const FETCH_URL = 'gitpanel/fetch'
    const PULL_URL = 'gitpanel/pull'
    const BRANCH_URL = 'gitpanel/branch'
    const COMMIT_URL = 'gitpanel/commit'
    const PUSH_URL = 'gitpanel/push'

    /** Plugin-styled hover tooltip anchored directly above the mouse cursor. */
    function CommitTooltip({ point, commit }) {
      if (!point || typeof window === 'undefined') return null
      const width = Math.min(420, Math.max(220, window.innerWidth - 16))
      const left = Math.min(Math.max(8, point.x - width / 2), Math.max(8, window.innerWidth - width - 8))
      const tailOffset = Math.min(Math.max(14, point.x - left - 5), width - 24)
      // Sit above the cursor whenever the viewport has room; near the top edge
      // flip below it so the content is never pushed off screen.
      const above = point.y - 12 >= Math.min(240, window.innerHeight - 24)
      const style = { width, left }
      if (above) style.bottom = Math.max(8, window.innerHeight - point.y + 12)
      else style.top = Math.min(window.innerHeight - 16, point.y + 14)
      const node = h('div', {
        className: 'gitpanel-tooltip',
        'data-placement': above ? 'above' : 'below',
        style,
        role: 'tooltip',
      },
      h('span', { className: 'gitpanel-tooltip-tail', style: { left: tailOffset } }),
      h('div', { className: 'gitpanel-tooltip-body' },
        h('div', { className: 'gitpanel-tooltip-subject' }, commit.subject || '(no message)'),
        h('div', { className: 'gitpanel-tooltip-meta' }, `${commit.author} · ${commit.short}`)))
      return createPortal ? createPortal(node, document.body) : node
    }

    /** One commit row: gutter, subject, ref pills, hash, relative time. */
    function CommitRow({ commit, gutterWidth, locale }) {
      const refs = commit.refs ?? []
      const visibleRefs = refs.filter((ref) => ref.kind !== 'remote').slice(0, 2)
      const [hoverPoint, setHoverPoint] = useState(null)
      useEffect(() => {
        if (!hoverPoint) return undefined
        const hide = () => setHoverPoint(null)
        window.addEventListener('scroll', hide, true)
        window.addEventListener('resize', hide)
        return () => {
          window.removeEventListener('scroll', hide, true)
          window.removeEventListener('resize', hide)
        }
      }, [hoverPoint])
      return h(React.Fragment, null, h('div', {
        className: 'gitpanel-commit',
        onMouseEnter: (event) => setHoverPoint({ x: event.clientX, y: event.clientY }),
        onMouseMove: (event) => setHoverPoint((previous) => (
          previous && Math.abs(previous.x - event.clientX) < 1 && Math.abs(previous.y - event.clientY) < 1
            ? previous
            : { x: event.clientX, y: event.clientY }
        )),
        onMouseLeave: () => setHoverPoint(null),
      },
      h('div', { style: { width: gutterWidth, minWidth: gutterWidth, flex: 'none' } }),
      h('div', { className: 'gitpanel-commit-subject' }, commit.subject || '(no message)'),
      visibleRefs.length > 0
        ? h('div', { className: 'gitpanel-commit-refs' },
          visibleRefs.map((ref) => h('span', {
            key: `${ref.kind}:${ref.name}`,
            className: `gitpanel-ref${ref.kind === 'head' ? ' gitpanel-ref-head' : ''}`,
          }, ref.kind === 'tag' ? `#${ref.name}` : ref.name)))
        : null,
      h('div', { className: 'gitpanel-commit-spacer' }),
      h('div', { className: 'gitpanel-commit-hash' }, commit.short),
      h('div', { className: 'gitpanel-commit-time' }, relativeTime(commit.time, locale))),
      h(CommitTooltip, { point: hoverPoint, commit }))
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
      onRefresh, onSwitch, locale, t, panelRef, actions, busy,
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
        'aria-busy': loading || switching !== null || Boolean(busy) ? 'true' : 'false',
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
          disabled: loading || switching !== null || Boolean(busy), title: t('refresh'), 'aria-label': t('refresh'),
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
            h('span', {
              key: 'counts',
              className: 'gitpanel-footer-info',
              title: state.truncated ? t('truncated', { n: state.commitLimit ?? COMMIT_LIMIT }) : undefined,
            }, `${t('branches', { n: branches.length })} · ${t('commits', { n: rows.length })}`),
            switching
              ? h('span', { key: 'switching', className: 'gitpanel-warn', role: 'status', 'aria-live': 'polite' }, t('switching'))
              : null,
            notice
              ? h('span', { key: 'notice', className: 'gitpanel-status', role: 'status', 'aria-live': 'polite' }, notice)
              : null,
            h('div', { key: 'actions', className: 'gitpanel-actions' }, actions),
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

      // ------------------------------------------------- repository actions
      const [busy, setBusy] = useState(null)
      const [bubble, setBubble] = useState(null)
      const [bubbleGeom, setBubbleGeom] = useState(null)
      const [draft, setDraft] = useState('')
      const [branchDraft, setBranchDraft] = useState('')
      const [template, setTemplate] = useState({ loading: false, warning: null })
      const [remoteDraft, setRemoteDraft] = useState(null)
      const busyRef = useRef(false)
      const actionRefs = useRef({})
      const bubbleElRef = useRef(null)
      const textareaRef = useRef(null)
      const branchInputRef = useRef(null)
      const draftTouchedRef = useRef(false)
      const bubbleStateRef = useRef(null)
      bubbleStateRef.current = bubble

      const actionRefSetters = useMemo(() => {
        const setters = {}
        for (const name of ACTIONS) {
          setters[name] = (node) => {
            actionRefs.current[name] = node
          }
        }
        return setters
      }, [])

      const setBubbleEl = useCallback((node) => {
        bubbleElRef.current = node
      }, [])

      /** Map a failed action payload to one localized headline plus git's detail. */
      const describeActionError = useCallback((action, payload) => {
        const table = ACTION_ERROR_LEADS[action] ?? {}
        const leadKey = table[payload?.code] ?? table.default ?? 'errorActionGeneric'
        const lead = t(leadKey)
        const detail = typeof payload?.message === 'string' && payload.message !== lead ? payload.message : ''
        return {
          code: payload?.code,
          lead,
          detail,
          files: Array.isArray(payload?.files) && payload.files.length > 0 ? payload.files : undefined,
        }
      }, [t])

      const clearBubbleError = useCallback(() => {
        setBubble((previous) => (previous ? { ...previous, error: null } : previous))
      }, [])

      const closeBubble = useCallback(() => {
        setBubble(null)
        setBubbleGeom(null)
        setTemplate({ loading: false, warning: null })
      }, [])

      /** Place the bubble above its action button; fall below when space is short. */
      const measureBubble = useCallback(() => {
        const active = bubbleStateRef.current
        if (!active) {
          setBubbleGeom(null)
          return
        }
        const anchor = actionRefs.current[active.anchor]
        if (!anchor) return
        const rect = anchor.getBoundingClientRect()
        const width = Math.min(active.mode === 'commit' ? 380 : 340, Math.max(240, window.innerWidth - 24))
        const centerX = rect.left + rect.width / 2
        const left = Math.min(Math.max(8, centerX - width / 2), Math.max(8, window.innerWidth - width - 8))
        const tailOffset = Math.min(Math.max(12, centerX - left - 6), width - 24)
        const spaceAbove = rect.top - 16
        const placement = spaceAbove >= 170 ? 'above' : 'below'
        if (placement === 'above') {
          setBubbleGeom({
            left,
            width,
            placement,
            tailOffset,
            bottom: Math.max(8, window.innerHeight - rect.top + 12),
            maxHeight: Math.max(160, Math.min(420, spaceAbove)),
          })
        } else {
          setBubbleGeom({
            left,
            width,
            placement,
            tailOffset,
            top: rect.bottom + 12,
            maxHeight: Math.max(160, Math.min(420, window.innerHeight - rect.bottom - 24)),
          })
        }
      }, [])

      useEffect(() => {
        if (!bubble) {
          setBubbleGeom(null)
          return undefined
        }
        measureBubble()
        const schedule = () => {
          requestAnimationFrame(() => measureBubble())
        }
        window.addEventListener('resize', schedule)
        window.addEventListener('scroll', schedule, true)
        return () => {
          window.removeEventListener('resize', schedule)
          window.removeEventListener('scroll', schedule, true)
        }
      }, [bubble, measureBubble])

      // Focus the field a form bubble opens with.
      useEffect(() => {
        if (!bubble) return undefined
        if (bubble.mode === 'commit') textareaRef.current?.focus()
        else if (bubble.mode === 'branch') branchInputRef.current?.focus()
        else if (bubble.mode === 'push') bubbleElRef.current?.querySelector('.gitpanel-bubble-btn-primary')?.focus()
        return undefined
      }, [bubble])

      // A standalone error bubble dismisses itself; form bubbles keep their error.
      useEffect(() => {
        if (!bubble || bubble.mode !== 'error') return undefined
        const timer = setTimeout(() => closeBubble(), 8000)
        return () => clearTimeout(timer)
      }, [bubble, closeBubble])

      /** Apply the fresh state every action response carries. */
      const applyStatePayload = useCallback((payload) => {
        if (!payload?.state) return
        setState(payload.state)
        setBranchInfo({
          repo: true,
          branch: payload.state.branch,
          detached: payload.state.detached === true,
          head: payload.state.head ?? null,
        })
      }, [])

      /** One guarded POST; concurrent actions are ignored, not queued. */
      const runAction = useCallback(async (name, url, body) => {
        if (busyRef.current) return null
        busyRef.current = true
        setBusy(name)
        if (bubbleStateRef.current?.mode === 'error') closeBubble()
        try {
          const payload = await requestJson(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...body, sessionId, path: workspacePath }),
          })
          applyStatePayload(payload)
          return payload
        } catch (failure) {
          return { ok: false, code: 'network', message: failure?.message }
        } finally {
          busyRef.current = false
          setBusy(null)
        }
      }, [applyStatePayload, closeBubble, sessionId, workspacePath])

      const showActionError = useCallback((action, payload) => {
        setBubble({ mode: 'error', anchor: action, error: describeActionError(action, payload) })
      }, [describeActionError])

      /** Fetch and pull share the same success/failure shape. */
      const runSimpleAction = useCallback(async (name, url, doneKey) => {
        const payload = await runAction(name, url, {})
        if (!payload) return
        if (payload.ok === false) {
          showActionError(name, payload)
          return
        }
        setNotice(t(doneKey))
        void refreshLight()
      }, [refreshLight, runAction, showActionError, t])

      const onFetch = useCallback(() => {
        void runSimpleAction('fetch', FETCH_URL, 'fetchDone')
      }, [runSimpleAction])

      const onPull = useCallback(() => {
        void runSimpleAction('pull', PULL_URL, 'pullDone')
      }, [runSimpleAction])

      const onDraftChange = useCallback((value) => {
        draftTouchedRef.current = true
        setDraft(value)
        writeStoredDraft(draftStorageKeyOf(state?.root), value)
      }, [state])

      /** Open the commit editor: a stored draft wins over the configured template. */
      const openCommitBubble = useCallback(() => {
        if (!state) return
        if ((state.stagedCount ?? 0) + (state.unstagedCount ?? 0) === 0) return
        const storageKey = draftStorageKeyOf(state.root)
        const savedDraft = readStoredDraft(storageKey)
        draftTouchedRef.current = savedDraft.length > 0
        setDraft(savedDraft)
        setTemplate({ loading: savedDraft.length === 0, warning: null })
        setBubble({ mode: 'commit', anchor: 'commit', error: null })
        if (savedDraft.length > 0) return
        void (async () => {
          try {
            const payload = await requestJson(`${TEMPLATE_URL}${stateQuery(sessionId, workspacePath)}`)
            if (!draftTouchedRef.current && typeof payload?.template === 'string') setDraft(payload.template)
            setTemplate({ loading: false, warning: payload?.warning ? t('commitTemplateUnreadable') : null })
          } catch {
            setTemplate({ loading: false, warning: t('commitTemplateUnreadable') })
          }
        })()
      }, [sessionId, state, t, workspacePath])

      const onCommit = useCallback(async () => {
        if (!bubble || bubble.mode !== 'commit') return
        if (!draft.trim()) return
        const payload = await runAction('commit', COMMIT_URL, { message: draft })
        if (!payload) return
        if (payload.ok === false) {
          setBubble((previous) => (previous && previous.mode === 'commit'
            ? { ...previous, error: describeActionError('commit', payload) }
            : previous))
          return
        }
        writeStoredDraft(draftStorageKeyOf(state?.root), '')
        setDraft('')
        closeBubble()
        setNotice(t('commitDone', { commit: payload.commit ?? '' }))
        void refreshLight()
      }, [bubble, closeBubble, describeActionError, draft, refreshLight, runAction, state, t])

      const openBranchBubble = useCallback(() => {
        setBranchDraft('')
        setBubble({ mode: 'branch', anchor: 'branch', error: null })
      }, [])

      const onCreateBranch = useCallback(async () => {
        const name = branchDraft.trim()
        if (!name) return
        const payload = await runAction('branch', BRANCH_URL, { name })
        if (!payload) return
        if (payload.ok === false) {
          setBubble((previous) => (previous && previous.mode === 'branch'
            ? { ...previous, error: describeActionError('branch', payload) }
            : previous))
          return
        }
        closeBubble()
        setNotice(t('branchCreated', { name: payload.branch ?? name }))
        void refreshLight()
      }, [branchDraft, closeBubble, describeActionError, refreshLight, runAction, t])

      /** Push normally; a missing upstream opens the setup bubble instead. */
      const onPush = useCallback(async () => {
        const payload = await runAction('push', PUSH_URL, {})
        if (!payload) return
        if (payload.ok === false) {
          if (payload.code === 'no-upstream' && Array.isArray(payload.remotes) && payload.remotes.length > 0) {
            setRemoteDraft(payload.suggestedRemote ?? payload.remotes[0])
            setBubble({ mode: 'push', anchor: 'push', error: null, branch: payload.branch, remotes: payload.remotes })
            return
          }
          showActionError('push', payload)
          return
        }
        setNotice(t('pushDone'))
        void refreshLight()
      }, [refreshLight, runAction, showActionError, t])

      const onConfirmPush = useCallback(async () => {
        const payload = await runAction('push', PUSH_URL, { setUpstream: true, remote: remoteDraft ?? undefined })
        if (!payload) return
        if (payload.ok === false) {
          setBubble((previous) => (previous && previous.mode === 'push'
            ? { ...previous, error: describeActionError('push', payload) }
            : previous))
          return
        }
        closeBubble()
        setNotice(t('pushDone'))
        void refreshLight()
      }, [closeBubble, describeActionError, refreshLight, remoteDraft, runAction, t])

      const toggle = useCallback(() => {
        if (open) {
          closeBubble()
          close(true)
          return
        }
        setError(null)
        setNotice(null)
        setFilter('')
        closeBubble()
        computePosition()
        setOpen(true)
      }, [close, closeBubble, computePosition, open])

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
        const bubbleNode = () => bubbleElRef.current
        const isInside = (node) => {
          if (!node) return false
          if (panelRef.current?.contains(node)) return true
          if (triggerRef.current?.contains(node)) return true
          return false
        }
        const focusables = () => {
          const nodes = [panelRef.current, bubbleElRef.current].filter(Boolean)
          const list = []
          for (const node of nodes) {
            list.push(...node.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
          }
          return list
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            if (bubbleStateRef.current) closeBubble()
            else close(true)
            return
          }
          if (event.key !== 'Tab') return
          const list = focusables()
          if (list.length === 0) {
            event.preventDefault()
            panelRef.current?.focus()
            return
          }
          const first = list[0]
          const last = list[list.length - 1]
          const active = document.activeElement
          const inside = panelRef.current?.contains(active) === true || bubbleNode()?.contains(active) === true
          if (!inside) {
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
          if (bubbleNode()?.contains(event.target)) return
          if (triggerRef.current?.contains(event.target)) return
          if (panelRef.current?.contains(event.target)) {
            // A different panel control pressed: the bubble yields first.
            if (bubbleStateRef.current) closeBubble()
            return
          }
          if (bubbleStateRef.current) {
            closeBubble()
            return
          }
          close(false)
        }
        const schedule = () => {
          requestAnimationFrame(() => {
            computePosition()
            measureBubble()
          })
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
      }, [open, loadState, refreshLight, computePosition, close, closeBubble, measureBubble])


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

      const commitCount = state?.dirtyCount ?? 0
      const stagedPlusUnstaged = (state?.stagedCount ?? 0) + (state?.unstagedCount ?? 0)
      const commitDisabled = !state || stagedPlusUnstaged === 0
      const commitDisabledReason = commitDisabled
        ? (commitCount > 0 ? t('commitOnlyUntracked') : t('commitNoChanges'))
        : t('commitTooltip', { n: commitCount })
      const pushDisabled = !state || state.detached === true
      const actionButton = (name, options) => h('button', {
        key: name,
        ref: actionRefSetters[name],
        type: 'button',
        className: 'gitpanel-action',
        'data-busy': busy === name ? 'true' : undefined,
        disabled: Boolean(busy) || Boolean(options.disabled),
        onClick: options.onClick,
        title: options.title ?? options.label,
        'aria-label': options.ariaLabel ?? options.title ?? options.label,
      },
      busy === name ? RefreshGlyph(true) : ActionIcon(name),
      h('span', { className: 'gitpanel-action-label' }, busy === name ? options.busyLabel : options.label),
      options.count !== undefined ? h('span', { className: 'gitpanel-action-count' }, String(options.count)) : null)
      const actionBar = state?.repo
        ? [
          actionButton('fetch', { label: t('fetch'), busyLabel: t('fetching'), onClick: onFetch }),
          actionButton('pull', { label: t('pull'), busyLabel: t('pulling'), onClick: onPull }),
          actionButton('branch', { label: t('newBranch'), busyLabel: t('creatingBranch'), onClick: openBranchBubble }),
          actionButton('commit', {
            label: t('commit'),
            busyLabel: t('committing'),
            onClick: openCommitBubble,
            disabled: commitDisabled,
            count: commitCount > 0 ? commitCount : undefined,
            title: commitDisabledReason,
            ariaLabel: t('commitWithCount', { n: commitCount }),
          }),
          actionButton('push', {
            label: t('push'),
            busyLabel: t('pushing'),
            onClick: onPush,
            disabled: pushDisabled,
            title: pushDisabled ? t('detached') : t('push'),
          }),
        ]
        : []

      const commitHint = (state?.stagedCount ?? 0) > 0
        ? t('hintStaged', { n: state.stagedCount })
        : t('hintTracked')

      const bubbleLabel = !bubble
        ? ''
        : bubble.mode === 'error'
          ? t('errorTitle')
          : bubble.mode === 'commit'
            ? t('commitMessage')
            : bubble.mode === 'branch'
              ? t('newBranch')
              : t('push')

      const bubbleNode = bubble && bubbleGeom
        ? h(SpeechBubble, {
          variant: bubble.mode === 'error' ? 'error' : 'form',
          geometry: bubbleGeom,
          label: bubbleLabel,
          bubbleRef: setBubbleEl,
        },
        bubble.mode === 'error'
          ? h(BubbleErrorBody, { error: bubble.error, t, onClose: closeBubble })
          : bubble.mode === 'commit'
            ? h(CommitBubbleBody, {
              t,
              draft,
              onDraft: onDraftChange,
              textareaRef,
              templateLoading: template.loading,
              hint: template.warning ? `${commitHint} · ${template.warning}` : commitHint,
              busy: busy === 'commit',
              error: bubble.error,
              onClose: closeBubble,
              onErrorClose: clearBubbleError,
              onCommit,
            })
            : bubble.mode === 'branch'
              ? h(BranchBubbleBody, {
                t,
                name: branchDraft,
                onName: setBranchDraft,
                inputRef: branchInputRef,
                busy: busy === 'branch',
                error: bubble.error,
                onClose: closeBubble,
                onErrorClose: clearBubbleError,
                onCreate: onCreateBranch,
              })
              : h(PushBubbleBody, {
                t,
                branch: bubble.branch,
                remotes: bubble.remotes,
                remote: remoteDraft,
                onRemote: setRemoteDraft,
                busy: busy === 'push',
                error: bubble.error,
                onClose: closeBubble,
                onErrorClose: clearBubbleError,
                onConfirm: onConfirmPush,
              }))
        : null

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
            actions: actionBar,
            busy,
          })
          : null,
        bubbleNode)

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
