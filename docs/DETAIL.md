# Git panel

Adds a Git branch selector to the DSH composer tool row. The selector sits after
the permission and plan controls: a branch glyph and the current branch of the
Session's project. Clicking it opens a compact popup with the repository's commit
graph on the left and its local branches on the right; clicking a branch checks it
out and refreshes everything in place.

## Use it

- The trigger shows the current branch, refreshed every few seconds while the page
  is visible, when the window regains focus, and after a switch. When the Session's
  directory is not a Git repository (or Git is not installed) the trigger stays
  hidden; a non-repository workspace is only re-checked every 30 seconds.
- The popup opens above the composer, portals to the page body, and is a
  non-modal dialog: pressing Escape or clicking outside closes it, focus moves
  into the panel when it opens, Tab stays inside it, and the trigger receives
  focus back on Escape. A refresh button re-reads the repository immediately.
- The left pane draws the commit topology from `git log --all --topo-order`: one
  lane per active branch colour, merge and fork edges drawn as curves, a node per
  commit with its subject, short hash, and relative time. Up to 120 commits are
  read; the footer says when older history was truncated. The gutter is capped so
  a repository with many lanes does not squeeze the subjects.
- The right pane lists local branches, current branch first. Each row shows the
  lane colour of that branch's tip, the branch name, and its upstream plus
  ahead/behind counts; a deleted upstream is labelled. The current branch is
  disabled, marked with a check, and highlighted. Above six branches a filter box
  narrows the list.
- Clicking a branch row checks it out in the Session's working directory. The
  branch list, graph, trigger label, and footer notice refresh from the same
  response.

## Behaviour and limits

- Switching uses `git switch` and falls back to `git checkout` on Git older than
  2.23. Both obey Git's own safety rules: uncommitted changes that would be
  overwritten block the switch, and the menu shows a localized explanation plus
  Git's own message. Nothing is stashed, forced, or reset.
- The menu counts tracked modifications and untracked paths as uncommitted
  changes, because either can block some checkouts.
- Only local branches (`refs/heads/*`) are listed and switchable; remote-tracking
  branches are not offered. An unborn branch (a fresh `git init` with no commit)
  is listed but cannot be switched away from.
- The graph reads the last 120 commits across all branches. Large repositories pay
  a few git invocations per menu open, not per render.
- Reads and switches run through the Host's `subprocess` capability with argv only
  (no shell), a scrubbed environment, and a 20-second deadline. The routes are
  served on the same origin (`/gitpanel/state`, `/gitpanel/switch`) behind the
  deployment's browser authentication and Host/Origin trust fence.
- Surfaces, borders, focus rings, and text use DSH theme tokens, so the panel
  follows light and dark themes; the lane palette is plugin-owned colour, so
  more than eight active lanes repeat colours.
