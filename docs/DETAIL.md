# Git panel

Adds a Git branch selector to the DSH composer tool row. The selector sits after
the permission and plan controls: a branch glyph and the current branch of the
Session's project. Clicking it opens a compact popup with the repository's commit
graph on the left, its local branches on the right, and a repository action bar in
the footer: **Fetch**, **Pull**, **New branch**, **Commit** (with the live count of
uncommitted changes), and **Push to remote**. Commit editing and every action
failure are presented through one shared speech-bubble component.

## Browse branches

- The trigger shows the current branch, refreshed every few seconds while the page
  is visible, when the window regains focus, and after any action. When the
  Session's directory is not a Git repository (or Git is not installed) the trigger
  stays hidden; a non-repository workspace is only re-checked every 30 seconds.
- The popup opens above the composer, portals to the page body, and is a
  non-modal dialog: pressing Escape or clicking outside closes it, focus moves
  into the panel when it opens, Tab stays inside it, and the trigger receives
  focus back on Escape.
- The left pane draws the commit topology from `git log --all --topo-order`: one
  lane per active branch colour, merge and fork edges drawn as curves, a node per
  commit with its subject, short hash, and relative time. Up to 120 commits are
  read; the footer counts show when older history was truncated. The gutter is
  capped so many lanes do not squeeze the subjects.
- The right pane lists local branches, current branch first: lane colour, name,
  upstream plus ahead/behind, a deleted-upstream label, a disabled checked row for
  the current branch, and a filter box above six branches.

## Repository actions

All five actions call real Git commands through the Host's `subprocess` capability
(argv only, no shell, scrubbed environment, no editor prompts) and answer with a
fresh state, so the trigger label, branch list, graph, and commit count refresh
together. While one action runs every action button is disabled and the running
button shows a spinner; a second click cannot start a concurrent operation.

- **Fetch** runs `git fetch --all --prune`. It never touches the work tree and
  never merges.
- **Pull** runs `git pull` for the current branch, so the repository's own
  `pull.rebase`/merge strategy and hooks apply. A missing upstream, uncommitted
  changes that would be overwritten, and merge conflicts are reported without
  discarding local work; conflicted paths are listed in the error bubble.
- **New branch** opens a small input bubble. The name is validated with
  `git check-ref-format --branch`, duplicates are refused, and a valid name is
  created from the current HEAD and checked out (`switch -c`, with a `checkout -b`
  fallback for Git older than 2.23).
- **Commit** opens a speech bubble with an editable message and a taller editing
  area. The editor behaves like Git's terminal editor: soft wrapping is off, a
  long line extends horizontally with a conditional horizontal scrollbar instead
  of an inserted newline, Enter is the only source of real line breaks, and
  vertical scrolling stays independent. Only the bubble's own Commit button
  executes the commit. The message is handed to Git as a UTF-8 file through
  `git commit --cleanup=strip -F <temp file>`, never through a shell or a wrapped
  string, so blank lines, list markers, indentation, and long single lines reach
  the commit object unchanged (only edge whitespace and comment lines are
  trimmed, exactly as the terminal editor's default cleanup does). When the
  repository configures `commit.template`, that file's contents prefill the
  editor; without it the editor starts empty (no invented default template).
  Staged changes are committed as they are; when nothing is staged, tracked
  modifications are staged first (`git add -u`, never untracked files) and the
  bubble says so. Unmerged paths block the commit. A failure keeps the bubble and
  the typed message so it can be retried. The footer button shows the repository's
  real uncommitted count.
- The commit message is saved as a per-repository draft in the browser's local
  storage on every edit, so closing the bubble (Cancel, Escape, clicking outside),
  switching focus, re-rendering, or a failed commit never loses it; reopening the
  editor restores it and takes precedence over the template. The draft is cleared
  only after a commit actually succeeds. Nothing is written into Git config or
  `commit.template`, and drafts of different repositories stay independent.
- **Push to remote** pushes the current branch to its configured upstream with
  plain `git push` (never forced). A branch without an upstream opens a
  confirmation bubble that offers the available remotes and runs
  `git push --set-upstream <remote> <branch>`.

## Speech bubbles

One base component provides the tail, radius, shadow, anchoring, and placement for
every bubble. It is positioned above the action that opened it (falling below only
when the viewport has no room), and only one bubble exists at a time.

- **Commit editor** uses the normal surface with the message textarea, a hint
  describing what will be committed, Cancel, and the Commit button.
- **Errors** use the same shell in a red variant: white text, a monochrome
  white-triangle/black-exclamation warning mark, a concise localized headline, and
  Git's own message as detail (conflict files are listed separately). Standalone
  error bubbles dismiss themselves after eight seconds or via their close button;
  a new action replaces the previous bubble instead of stacking. Commit failures
  keep the editor open and show the same error content inline inside it.
- Branch creation and upstream setup reuse the same shell as small forms.

## Internationalization

Every button, placeholder, hint, status, and error headline has English and
Simplified Chinese text through the Client locale service; Git's own stderr is
shown unchanged as supplementary detail.

## Behaviour and limits

- Only local branches (`refs/heads/*`) are listed and switchable; remote-tracking
  branches are not offered.
- The graph reads the last 120 commits across all branches.
- Network operations (`fetch`, `pull`, `push`) have a 60-second deadline per Git
  command; local operations time out after 20 seconds.
- Only `commit.template` is read. There is no template editor, template storage,
  or template settings page, and no built-in default message.
- Surfaces, borders, focus rings, and text use DSH theme tokens, so the panel and
  its bubbles follow light and dark themes. The lane palette is plugin-owned
  colour, so more than eight active lanes repeat colours.
