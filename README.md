# dsh-plugin-gitpanel

A Git branch panel for the DeepSeek Harness (DSH) Web UI.
DeepSeek Harness Web UI 的 Git 分支面板插件。

[简体中文](#简体中文) · [English](#english)

---

## 简体中文

在 DSH 对话输入框的工具栏中加入一个紧凑的 Git 分支入口：查看提交关系图、浏览和切换本地分支，并直接完成获取、拉取、新建分支、提交、推送等日常操作，全程不离开对话界面。

### 功能

- **分支入口**：位于输入框工具行（权限 / 计划控件之后），显示分支图标与当前分支名；页面可见时每 5 秒刷新，窗口重新聚焦、操作完成后也会刷新。目录不是 Git 仓库（或未安装 Git）时自动隐藏。
- **提交关系图**：左侧按泳道绘制 `git log --all --topo-order` 的拓扑，支持分叉、合并曲线、提交节点、分支徽章、短 Hash 与相对时间；默认读取最近 120 条提交，超出时给出截断提示。泳道颜色超出 8 条时循环复用。
- **本地分支列表**：右侧列出本地分支，当前分支置顶、禁用并带选中标记；显示泳道色点、upstream、领先/落后数量，上游已删除时标注；分支多于 6 个时出现筛选框。
- **仓库操作栏**：底部提供 `获取`、`拉取`、`新建分支`、`提交`（实时显示未提交更改数量）、`推送到远程仓库`。执行期间按钮禁用并显示处理中状态，避免重复触发。
  - **获取**：`git fetch --all --prune`，不修改工作区、不自动合并。
  - **拉取**：执行原生 `git pull`，遵循仓库自身的 `pull.rebase` / 合并策略与钩子；无上游、脏工作区覆盖、合并冲突都会给出明确错误，不丢弃本地修改，并列出冲突文件。
  - **新建分支**：弹出输入气泡，使用 `git check-ref-format --branch` 校验名称，拒绝重名；成功后从当前 HEAD 创建并切换到新分支。
  - **提交**：弹出提交编辑气泡。优先提交暂存区；没有暂存内容时仅 `git add -u` 暂存已跟踪修改（**绝不加入未跟踪文件**），未解决冲突会阻止提交。配置了 `commit.template` 时读取该文件预填编辑器，未配置则留空（不内置默认模板）。
  - **推送**：普通 `git push`，**绝不 force**。分支没有 upstream 时弹出确认气泡，可选择远程并执行 `git push --set-upstream <remote> <branch>`。
- **提交编辑器**：与终端 Git 编辑器行为一致——不自动折行、长行横向滚动、仅 Enter 产生真实换行；多行、空行、列表与缩进原样保留。编辑区按仓库持久化到浏览器 localStorage（键 `gitpanel:commit-draft:v1:<仓库根路径>`），关闭 / 失焦 / 重渲染 / 提交失败都不会丢失，只有提交真正成功才清空。提交内容通过 UTF-8 临时文件交给 `git commit --cleanup=strip -F <file>`，不经 shell、不截断、不重排。
- **统一气泡反馈**：提交编辑与错误提示共用一个带尖尾的 Speech Bubble 组件；错误气泡为红底白字、黑白单色 `⚠`，显示本地化摘要 + Git 原始错误细节，8 秒自动消失或手动关闭，同一时间只存在一个气泡。
- **主题与多语言**：面板、气泡与提示全部使用 DSH 主题变量，自动适配浅色 / 深色主题；界面文案提供英文与简体中文。

### 安装

本仓库是一个 DSH 插件 bundle（包名 `dsh-plugin-gitpanel`，Host 行 `gitpanel`），需要安装到 DSH Profile 中：

1. 打开 DSH Web 界面的 **Plugins / 插件** 页面；
2. 使用 **Add plugin / 添加插件** 选择本目录（或通过 `plugin_manager` 的 `install_bundle` 指定该目录）；
3. 安装后插件在 Profile 中生效，刷新页面即可在对话输入框看到分支入口。

运行环境：DSH Web（desktop）Profile，`webServer`、`connection`、`subprocess`、`sessions`、`workingDirectory` 服务可用（官方 Web Profile 默认满足），并确保 `git` 在 Host 的 PATH 中。本插件在 DSH `0.2.2-rc.3` 上开发与验证。

> 修改 Host 端代码后需要重新加载插件（remove + install 或重启 DSH）；修改 `client.js` 后刷新页面即可。

### 设计约定与限制

- 只列出并允许切换**本地分支**（`refs/heads/*`），不提供远程分支切换。
- 提交关系图窗口为最近 120 条提交；超过 8 条活跃泳道时颜色会重复。
- 只读取 `commit.template`，不提供模板编辑、保存或自定义模板管理，也没有额外设置页面。
- 网络类操作（fetch / pull / push）单条 Git 命令限时 60 秒，本地操作 20 秒。
- 不修改提示词、不注册 Agent 工具；插件只提供 Web UI 与 Host 路由。
- 所有 Host 路由都位于 DSH 连接信任围栏之后（同源浏览器认证 + Host/Origin 校验）。

### 目录结构

```text
dsh-plugin-gitpanel/
├─ index.js              # Host 半：webServer 路由与 git 进程调用
├─ lib/
│  ├─ git-core.js        # 提交图布局、git 输出解析（纯函数）
│  ├─ git-read.js        # 仓库状态读取与分支切换
│  └─ git-actions.js     # fetch / pull / branch / commit / push
├─ client.js             # 浏览器半：输入框分支控件、面板、气泡
├─ locale/{en,zh}.json   # 插件管理页显示元数据
├─ docs/DETAIL.md        # 插件详情文档（Plugin Manager 展示）
├─ icon.svg              # 插件图标
├─ cordis.patch.yml      # bundle 插入的 Loader 行
└─ tests/                # 真实 git 集成测试与客户端契约检查
```

### 开发与测试

测试会在临时目录中自建仓库（含 bare remote 与多个 clone），不依赖本仓库自身状态，也不需要外部服务：

```bash
node tests/check-layout.mjs        # 提交图布局、状态读取、分支名称
node tests/check-actions.mjs       # fetch / pull / commit / push 与消息完整性
node tests/check-routes.mjs        # Host 路由：围栏、参数校验、错误状态
node tests/check-client-source.mjs # 客户端契约：布局、气泡、草稿、Tooltip
node --check index.js && node --check client.js
```

Windows 下也可直接运行 `tests\run-checks.cmd` 执行全部检查。需要 Node.js 20+ 与可用的 `git`。

### 许可证

本仓库尚未选择开源许可证。在公开发布前请补充 `LICENSE` 文件。

---

## English

A compact Git branch control for the DSH composer toolbar: read the commit graph, browse and switch local branches, and run everyday Git operations — fetch, pull, create a branch, commit, and push — without leaving the conversation.

### Features

- **Branch control**: sits in the composer tool row after the permission/plan controls and shows a branch glyph plus the current branch. It refreshes every 5 seconds while the page is visible, on window focus, and after any action; it hides itself when the directory is not a Git repository or Git is unavailable.
- **Commit graph**: a lane-based topology from `git log --all --topo-order` on the left, with fork/merge curves, commit nodes, branch badges, short hashes, and relative times. Reads the newest 120 commits and says when older history is truncated. Lane colours cycle after eight active lanes.
- **Local branch list**: current branch first, disabled and checked; each row shows its lane colour, upstream, and ahead/behind counts, with a label for a deleted upstream. A filter appears above six branches.
- **Action bar**: `Fetch`, `Pull`, `New branch`, `Commit` (with the live count of uncommitted changes), and `Push to remote` in the footer. Buttons are disabled while an operation runs and show their own busy state, so a click cannot start a concurrent operation.
  - **Fetch** runs `git fetch --all --prune`; it never modifies the work tree and never merges.
  - **Pull** runs the native `git pull`, so the repository's own `pull.rebase`/merge strategy and hooks apply. Missing upstream, uncommitted changes that would be overwritten, and merge conflicts are reported without discarding local work; conflicted files are listed.
  - **New branch** opens an input bubble, validates the name with `git check-ref-format --branch`, refuses duplicates, and creates + checks out the branch from the current HEAD.
  - **Commit** opens the editor bubble. Staged changes are committed as they are; when nothing is staged, tracked modifications are staged with `git add -u` (untracked files are never added) and unmerged paths block the commit. A configured `commit.template` pre-fills the editor; without one the editor starts empty (no built-in default template).
  - **Push** runs a plain `git push` and never forces. A branch without an upstream opens a confirmation bubble offering the available remotes and runs `git push --set-upstream <remote> <branch>`.
- **Commit editor**: behaves like Git's terminal editor — soft wrapping is off, long lines scroll horizontally, Enter is the only source of real line breaks, and blank lines, lists, and indentation are preserved. The message is drafted per repository in browser localStorage (key `gitpanel:commit-draft:v1:<repo root>`); closing the bubble, losing focus, re-rendering, or a failed commit never loses it, and only a successful commit clears it. The text reaches Git through a UTF-8 temp file with `git commit --cleanup=strip -F <file>` — no shell, no truncation, no re-formatting.
- **One speech bubble for feedback**: the commit editor and error messages share a tailed Speech Bubble shell. Errors render white-on-red with a monochrome `⚠`, a localized summary plus Git's own detail, auto-dismiss after eight seconds (or close manually), and never stack.
- **Theme and locales**: panel, bubbles, and notices use DSH theme tokens and follow light/dark themes automatically; UI text ships in English and Simplified Chinese.

### Installation

This repository is a DSH plugin bundle (package `dsh-plugin-gitpanel`, Loader row `gitpanel`) and installs into a DSH profile:

1. Open **Plugins** in the DSH Web UI;
2. Use **Add plugin** to select this directory (or install it with `plugin_manager`'s `install_bundle` pointing at this directory);
3. The bundle activates in the profile; reload the page and the branch control appears in the composer.

Requirements: a DSH Web (desktop) profile where `webServer`, `connection`, `subprocess`, `sessions`, and `workingDirectory` are available (the official Web profile provides them) and `git` is on the host PATH. Developed and verified against DSH `0.2.2-rc.3`.

> Host-side changes need a plugin reload (remove + install, or restart DSH); client-only changes need a page refresh.

### Design rules and limits

- Only local branches (`refs/heads/*`) are listed and switchable; remote-tracking branches are not offered.
- The graph window covers the newest 120 commits; more than eight active lanes reuse colours.
- Only `commit.template` is read. There is no template editor, storage, or settings page.
- Network Git commands (fetch / pull / push) have a 60-second deadline; local commands 20 seconds.
- The plugin adds no prompt text and no agent tools; it contributes only Web UI and Host routes.
- Every Host route sits behind DSH's connection trust fence (same-origin browser authentication plus Host/Origin checks).

### Repository layout

```text
dsh-plugin-gitpanel/
├─ index.js              # Host half: webServer routes and git process calls
├─ lib/
│  ├─ git-core.js        # commit-graph layout and git output parsing (pure)
│  ├─ git-read.js        # repository state and branch switching
│  └─ git-actions.js     # fetch / pull / branch / commit / push
├─ client.js             # browser half: composer control, panel, bubbles
├─ locale/{en,zh}.json   # Plugin Manager display metadata
├─ docs/DETAIL.md        # detail document shown by Plugin Manager
├─ icon.svg              # plugin icon
├─ cordis.patch.yml      # Loader row inserted by the bundle
└─ tests/                # real-git integration tests and client contracts
```

### Development and tests

The checks build their own scratch repositories (including bare remotes and clones) in temporary directories, so they do not depend on this checkout and need no external services:

```bash
node tests/check-layout.mjs        # graph layout, state reads, branch names
node tests/check-actions.mjs       # fetch / pull / commit / push, message fidelity
node tests/check-routes.mjs        # Host routes: fence, validation, error states
node tests/check-client-source.mjs # client contracts: layout, bubble, draft, tooltip
node --check index.js && node --check client.js
```

On Windows, `tests\run-checks.cmd` runs the whole suite. Node.js 20+ and a working `git` are required.

### License

No open-source license has been chosen yet. Add a `LICENSE` file before publishing.
