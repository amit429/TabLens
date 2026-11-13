# TabLens — Product spec v2

Nov 13, 2026 · builds on [PRD-v1-original.md](./PRD-v1-original.md)

The original PRD defines the wedge: **content + behaviour**, turned into a report the user approves. This document keeps every P0 from that PRD and adds the features that make TabLens something people open every day rather than once a month.

## The one-line pitch

TabLens reads what's in your tabs and remembers how you used them, then tells you, tab by tab, what to keep, what to group and what you can safely let go. Nothing changes until you click.

## Product principles

1. **Explain every verdict.** Every suggestion carries its reasons in plain words: "Not opened for 9 days · read 4% · duplicate of tab in Window 2". A suggestion without a reason is a bug.
2. **Approve, then act, then undo.** Every action is a click; every click has a 30-second undo; every closed tab is restorable from the Archive.
3. **The tab bar is the source of truth.** Dragging a card in TabLens moves the real tab. Renaming a mission renames the real Chrome tab group. We never show a world that drifts from the browser.
4. **Local first.** Everything is stored on the device. AI is all Gemini: Gemini Nano on-device when available, otherwise TabLens AI — our hosted API that holds the Gemini key, so users never need one. It's asked for once and only ever receives short descriptors.
5. **Fast at 300 tabs.** Analysis is incremental; the popup paints from cache in under 200 ms and refreshes in the background.

## Surfaces

| Surface | Job | Opens from |
| --- | --- | --- |
| **Popup — "Lens"** | The verdict. A spectrum of every open tab by state, one sentence summary, and the **Cleanup plan**: a checklist of proposed actions with reasons. Apply in one click. | Toolbar icon, `Alt+Shift+L` |
| **Side panel** | A companion while browsing: missions with state counts, the current tab's dossier, quick save with intent. | Popup button, `Alt+Shift+S` |
| **Dashboard** (full page) | Workbench: Overview, Missions board (drag and drop), Unfinished, Library (bookmarks and saves), Archive, Settings. | Popup, side panel, `Alt+Shift+D` |
| **In-page nudge** | "You already have this open" chip with a *Switch* button, shown when a duplicate is opened. | Automatic (can be turned off) |
| **Context menu** | "Save to TabLens with a note…", "Keep this tab", "Snooze this tab". | Right-click on page or link |

## Feature set

### Inherited from the PRD (P0)

Behaviour tracking, content snapshots, mission inference, the report, approve-only actions, protection of unfinished work, corrections as rules, privacy controls, model routing (on-device → cloud opt-in → heuristic). See the original PRD for acceptance criteria; they still apply.

### New in v2

#### 0. Real tab groups across all windows
Missions become real Chrome tab groups for tabs in every window. A mission spread across windows is either gathered into one window (default) or grouped in each window under the same name and colour. "Keep groups in sync" adds new tabs to their mission's group automatically once the user has grouped it. Undo restores windows exactly, recreating any that gathering emptied.

#### 1. Cleanup plan (popup)
The PRD's report is the full page. Most people will only ever look at the popup, so the popup carries the verdict:

- **Spectrum bar** — every open tab drawn as a thin slice coloured by state (active, simmering, stale, abandoned, unfinished, duplicate, protected, no history). Hover a slice to see the tab. It's the product's signature: the lens splits the tab pile into its spectrum.
- **Summary sentence** — "87 tabs across 9 missions. 23 can go, 3 have unfinished work."
- **Plan** — grouped proposals: *Close 4 duplicates*, *Archive 12 abandoned*, *Archive 7 stale*, *Group 5 missions*. Each row expands into the tabs it affects with per-tab reasons and a checkbox. Unfinished and protected tabs are listed separately and never pre-checked.
- **Apply plan** — runs the checked actions, shows "Archived 19 tabs · Undo" for 30 s.

#### 2. Missions board (drag and drop)
A Kanban-style board in the dashboard: one column per mission, one card per tab, plus *Unsorted* and an *Archive* drop zone.
- Dragging a card into a column **moves the real tab into that mission's Chrome tab group** (creating the group if needed, moving across windows if needed).
- Reordering cards inside a column reorders the tabs in the tab strip.
- Dropping on *Archive* closes the tab and saves it.
- Every move is stored as a correction rule (for example "github.com/acme/expense-app → Work: Expense app"), so the next analysis respects it.
- Columns can be renamed (renames the Chrome group), recoloured (sets the Chrome group colour), collapsed, merged (drag column header onto another) and focused.

#### 3. Tab dossier
Click any tab card anywhere and a drawer explains it in three parts:
- **What it is** — favicon, title, domain, detected page type (article, product, docs, repo, issue/PR, video, search, form, app), summary, headings outline, keywords.
- **What you did** — first opened, last visited, visits, active time, read depth bar, interactions, form started, opened from which tab, a sparkline of recent visits.
- **Why it's here** — mission membership evidence ("opened from *MacBook Air M4 review*", "shares keywords laptop, battery, M4", "matched your rule"), its state with the rule that produced it, and the verdict ("Suggest archive: not opened for 9 days, read 4%"). Buttons: Open, Keep, Snooze, Save with note, Archive, Move to mission.

#### 4. Library — bookmarks and saves you can actually find
Bookmarks are a graveyard because they record *what* but not *why*. The Library fixes that:
- **Saves with intent.** "Save for later" (popup, side panel, context menu, dossier) asks one question — *why?* — with quick chips (Read later, Buy, Reference, Watch, To do, Inspiration) and an optional note and reminder date. Saves are mirrored into a "TabLens" bookmarks folder so they survive uninstall.
- **Topic shelves.** All bookmarks are clustered by topic (same engine as missions) in addition to their folders. Toggle *By topic* / *By folder* / *By intent*.
- **Last seen.** Every bookmark shows when it was added and when you last opened it (Chrome's `dateLastUsed` plus TabLens's own visit tracking).
- **Filters.** Never opened since saved · Not seen in 90 days · Duplicates · Saved this week · With reminders.
- **Resurface.** A small "From your library" strip on the Overview brings back one forgotten save per day.
- **Bulk tidy.** Select bookmarks → move to folder, delete duplicates, add intent.

#### 5. Snooze
Archive a tab now and have it reopen at a chosen time (later today, tomorrow morning, next week, a date). Snoozed tabs are listed in the Archive with a countdown.

#### 6. Already-open nudge
When you open a URL that's already open in another tab, a small in-page chip offers *Switch to it* (and closes the new copy). Directly attacks the PRD's "repeated work" cost.

#### 7. Quick find (command palette)
`⌘K` / `Ctrl+K` in any TabLens surface searches every open tab, archived tab, save and bookmark by title, URL, mission and page content (from snapshots). Enter switches to the tab or reopens it.

#### 8. Focus mode
Pick a mission → TabLens groups it, collapses every other group in the window and dims the badge. Turning focus off restores the previous collapse state.

#### 9. Mission tools
- **Export** a mission as Markdown links (with read depth and notes) to the clipboard.
- **Resume** an archived mission in a new window.
- **Mission insight** line: shopping missions list a shortlist of products ranked by engagement; reading missions show read vs unread; dev missions show open PRs/issues.

#### 10. Digest and badge
- Toolbar badge shows the number of tabs needing attention.
- Optional weekly notification: "14 tabs untouched for 7+ days across 3 missions."

## What stays out of v1

As in the PRD: no automatic closing, no task completion, no browsing-history mining, no accounts or sync, Chromium only.

## Success metrics

Unchanged from the PRD. Two additions for the new features:

| Metric | Target |
| --- | --- |
| Board drag-and-drop moves per active user per week | ≥ 3 (signal that the board is used, not just viewed) |
| Saves created with an intent | ≥ 60% of saves |
