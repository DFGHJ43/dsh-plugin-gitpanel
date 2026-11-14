# dsh-plugin-gitpanel

A Git branch panel for the DeepSeek Harness (DSH) Web UI.
DeepSeek Harness 的 Git 分支面板插件。

[简体中文](#简体中文) · [English](#english)

---

## 写在前面

感谢您在茫茫插件之海中发现了本插件。

如您所见，这是一个简单的git插件。我知道，类似的插件已有不少，而且他们做得都很好！我的这个主要是更契合我自己的使用习惯：我喜欢一边打开其他IDE或者文本编辑器来阅读git历史信息，一边打开DSH指点仓库，激扬prompt。

我的设计思路是如果我需要仔细阅读Git信息，我会打开有正经Git功能的软件，如果我只打开了DSH，那说明我也不太关心详细Git历史信息，毕竟仅靠DSH看那些信息也多少别扭，一来二去，本插件就不用提供复杂的Git相关功能了，因为轮不到它，也正因此本插件的功能相对克制，希望您键盘下留情。

要是本插件刚好也能契合您的需求就再好不过了！也希望您能因此给个star，我会很开心的！

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

### 安装与快速开始

本仓库是一个 DSH 插件 bundle（包名 `dsh-plugin-gitpanel`，Host 行 `gitpanel`），不发布到 npm，以目录形式安装到 DSH Profile 中使用。

**环境要求**

- DSH Desktop / Web 版（在 DSH `0.2.2-rc.3` 的 desktop profile 上开发与验证；其它版本如内部 API 变动可能不兼容）
- Host 的 PATH 中有可用的 `git` 2.23+（更旧版本会自动回退到 `git checkout`）
- 官方 Web Profile 提供的服务：`webServer`、`connection`、`subprocess`、`sessions`、`workingDirectory`
- 一个 Git 仓库作为会话工作区（插件只在该目录属于 Git 仓库时显示入口）
- 如需获取 / 拉取 / 推送：仓库已配置 remote，且本机已通过 credential helper 或 SSH key 完成认证（插件不会弹出终端密码提示）

**安装步骤**

1. 获取源码：`git clone <repository-url> dsh-plugin-gitpanel`（或下载 ZIP 后解压；目录名建议保持 `dsh-plugin-gitpanel`）
2. 打开 DSH 的 **Plugins / 插件** 页面
3. 点击 **Add plugin / 添加插件**，选择上一步的目录
4. 安装完成后插件在 Profile 中启用；刷新页面即可看到输入框工具栏里的分支按钮。Plugins 页面会显示插件名「Git 分支面板 / Git panel」及其详情页

> 也可以让 DSH Agent 帮忙安装：把本目录的绝对路径告诉它，让它用 `plugin_manager` 的 `install_bundle` 安装。
> 修改与升级：浏览器端（`client.js` 等）改动刷新页面即可；Host 端（`index.js`、`lib/`）改动后需要移除并重新安装该插件，或重启 DSH。
> 卸载：在 Plugins 页面对 `dsh-plugin-gitpanel` 执行 Disable（禁用）或 Remove（移除）。

### 使用方法

打开任意一个工作区为 Git 仓库的对话，输入框工具行（权限 / 计划控件右侧）会出现「分支图标 + 当前分支名」的按钮。

- **查看面板**：点击按钮打开——左侧提交关系图、右侧本地分支列表、底部操作栏。点击面板外部或按 `Esc` 关闭；右上角刷新按钮可立即重读仓库。
- **切换分支**：点击右侧任一本地分支。若存在会被覆盖的未提交修改，Git 会阻止切换，面板显示 Git 的原始错误，不会覆盖文件。
- **获取**：拉取远程引用（`git fetch --all --prune`），不修改工作区、不自动合并。
- **拉取**：对当前分支执行 `git pull`，遵循仓库自身的 `pull.rebase` / 合并策略；冲突时保留本地修改并列出冲突文件。
- **新建分支**：点击后输入名称，创建并自动切换；非法名称或重名会在气泡内提示。
- **提交**：按钮上实时显示未提交更改数量。点击后弹出提交气泡：
  - 配置了 `commit.template` 时预填该模板内容，未配置则为空；
  - 只有点击气泡右下角的「提交」才真正执行 `git commit`；
  - 优先提交暂存区；没有暂存内容时只提交已跟踪文件的修改，**未跟踪文件不会自动加入**。需要精确选择文件时，先在终端执行 `git add <files>`；
  - 提交失败保留气泡与输入内容；成功才清空草稿并刷新状态；
  - 编辑区不自动折行，长行可横向滚动，只有 Enter 产生真实换行，空行 / 列表 / 缩进原样保留。
- **推送**：推送到已配置的上游分支，绝不 force。没有上游时会弹出确认气泡，选择远程并执行 `git push --set-upstream <remote> <branch>`。
- **错误提示**：操作失败会弹出红底白字、前置黑白 `⚠` 的气泡，包含本地化摘要与 Git 原始错误；8 秒自动消失，也可手动关闭。
- **提交草稿**：提交说明按仓库自动保存在浏览器 localStorage；关闭气泡、误触、切换焦点、提交失败都不会丢失，只有提交真正成功才清除。

### 常见问题

- **看不到分支按钮**：确认当前会话工作区是 Git 仓库、Host 能运行 `git`，且插件已在 Plugins 页面启用；非仓库目录会隐藏入口。
- **Fetch / Pull / Push 报认证失败**：插件不进行交互式认证，请先配置 credential helper 或 SSH key。
- **提交数量包含未跟踪文件，但提交后它们仍在**：按钮数字是全部未提交更改（含未跟踪文件）；提交只包含暂存区或已跟踪修改，未跟踪文件需要先 `git add`。
- **只想提交部分文件**：先在终端暂存目标文件，再点击提交（插件只提交暂存区）。
- **面板数据多久刷新一次**：页面可见时每 5 秒、窗口重新聚焦、每次操作完成后。
- **支持哪些 DSH 版本**：在 DSH `0.2.2-rc.3` 上验证；其它版本如 API 变动可能不兼容。

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

本项目基于 [MIT License](LICENSE) 开源。

```text
Copyright (c) 2026 dsh-plugin-gitpanel DFGHJ43
```

在遵守 MIT 许可证的前提下，可自由使用、复制、修改、合并、发布、分发、再授权或销售本软件的副本；分发时请保留上述版权声明与许可声明。

---

## A note from the author

Thank you for discovering this plugin in the vast ocean of plugins.

As you can seen, this is a simple Git plugin in for Deepseek Harness, I knew there are already a lot of similar plugins and they are great! This one is simply tailored to my own habit: I would launch another IDE or text editor to inspect Git history in detail, while keeping DSH open to survey the repository, prompt up a storm.

My idea is that I would launch software with proper Git tools when needed. If I only have Deepseek Harness open, that probably means I don't care much about Git informations anyway. After all, Deepseek Harness isn't exactly the best place to browse codes and Git informations.

So, this plugin no longer need to provide complicated git features, as they are someone else's job, that's why it's so simple. Please go easy on me!

It would be awesome if this plugin happens to matches your workflow too! Please give me a star for that, I'd really appreciate it! 

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

### Installation and quick start

This repository is a DSH plugin bundle (package `dsh-plugin-gitpanel`, Loader row `gitpanel`). It is not published to npm; install it from this directory into a DSH profile.

**Requirements**

- DSH Desktop / Web (developed and verified on DSH `0.2.2-rc.3`, desktop profile; other versions may be incompatible if internal APIs changed)
- `git` 2.23+ available on the host PATH (older versions fall back to `git checkout` automatically)
- The services the official Web profile provides: `webServer`, `connection`, `subprocess`, `sessions`, `workingDirectory`
- A Git repository as the session working directory (the control stays hidden elsewhere)
- For fetch / pull / push: a configured remote and pre-configured authentication via a credential helper or SSH key (the plugin never prompts for credentials)

**Steps**

1. Get the source: `git clone <repository-url> dsh-plugin-gitpanel` (or download and extract the ZIP; keep the directory named `dsh-plugin-gitpanel`)
2. Open **Plugins** in DSH
3. Click **Add plugin** and select that directory
4. The bundle activates in the profile; refresh the page and the branch control appears in the composer tool row. The Plugins page lists it as "Git panel / Git 分支面板" with its detail page

> You can also ask a DSH agent to install it: give it the absolute path of this directory and have it run `plugin_manager`'s `install_bundle`.
> Updating: browser-side changes (`client.js`, …) need a page refresh; host-side changes (`index.js`, `lib/`) need the plugin removed and installed again, or a DSH restart.
> Uninstalling: use Disable or Remove for `dsh-plugin-gitpanel` on the Plugins page.

### Using the panel

Open a conversation whose workspace is a Git repository; a "branch glyph + current branch" button appears in the composer tool row (after the permission/plan controls).

- **Open the panel**: click the button — commit graph on the left, local branches on the right, action bar at the bottom. Click outside or press `Esc` to close; the refresh button re-reads the repository immediately.
- **Switch branches**: click a local branch row. If uncommitted changes would be overwritten, Git refuses and the panel shows Git's own error instead of touching your files.
- **Fetch**: updates remote-tracking refs (`git fetch --all --prune`) without touching the work tree or merging.
- **Pull**: runs `git pull` for the current branch and follows the repository's `pull.rebase` / merge strategy. On conflict it keeps local work and lists the conflicted files.
- **New branch**: type a name, then create — it is created from the current HEAD and checked out; invalid or duplicate names are reported inside the bubble.
- **Commit**: the button shows the live count of uncommitted changes. Clicking it opens the commit bubble:
  - a configured `commit.template` is loaded as the starting text, otherwise the editor starts empty;
  - only the bubble's own **Commit** button runs `git commit`;
  - staged changes are committed as they are; when nothing is staged, only tracked modifications are committed — **untracked files are never added automatically**. To commit a subset, run `git add <files>` in a terminal first;
  - a failed commit keeps the bubble and your text; a successful one clears the draft and refreshes;
  - the editor does not soft-wrap: long lines scroll horizontally, only Enter creates a real newline, and blank lines / lists / indentation are preserved.
- **Push**: pushes the current branch to its configured upstream and never forces. Without an upstream, a confirmation bubble lets you pick the remote and run `git push --set-upstream <remote> <branch>`.
- **Errors**: failures appear in a white-on-red bubble with a monochrome `⚠`, a localized summary, and Git's raw detail; it closes automatically after eight seconds or manually.
- **Drafts**: the commit message is saved per repository in browser localStorage; closing the bubble, losing focus, or a failed commit never loses it, and only a successful commit clears it.

### FAQ

- **The branch button is missing**: make sure the session workspace is a Git repository, the host can run `git`, and the plugin is enabled on the Plugins page. Non-repository directories hide the control.
- **Fetch / Pull / Push fails with an authentication error**: the plugin never prompts interactively; configure a credential helper or SSH key first.
- **The commit count includes untracked files, but they are still untracked after committing**: the number covers all uncommitted changes including untracked files; a commit only contains the staging area (or tracked modifications), so `git add` them first.
- **How do I commit only some files?** Stage the files in a terminal first; the panel commits the staging area as it is.
- **How often does the panel refresh?** Every 5 seconds while the page is visible, when the window regains focus, and after every action.
- **Which DSH versions are supported?** Verified on DSH `0.2.2-rc.3`; other versions may be incompatible when internal APIs change.

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

Released under the [MIT License](LICENSE).

```text
Copyright (c) 2026 dsh-plugin-gitpanel DFGHJ43
```

You may use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of this software under the terms of the MIT License; keep the copyright
and permission notice with substantial portions of the software.
