# TabLens — UI spec

How every surface looks and behaves. Built with React 19, Tailwind CSS v4 and shadcn/ui-style components (Radix primitives, CVA variants, `cn()` helper), drag and drop with dnd-kit, toasts with Sonner, the palette with cmdk.

## Design direction

TabLens is an optical instrument for a messy tab bar. The memorable element is the **spectrum**: the lens splits the tab pile into bands of colour, one slice per tab, coloured by state. It appears at the top of the popup, the dashboard header and, in miniature, on every mission column. Everything else is quiet: neutral surfaces, ink-coloured primary buttons, compact type, so the state colours carry the meaning.

### Tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` | `#F5F6F8` | `#14171C` | App canvas |
| `card` | `#FFFFFF` | `#1B1F26` | Panels, cards, columns |
| `foreground` | `#18202B` | `#E8EBF0` | Body text, primary button fill |
| `muted-foreground` | `#5C6675` | `#98A1AF` | Secondary text |
| `border` | `#E2E5EA` | `#2A2F38` | Hairlines, inputs |
| `ring` / `accent` | `#3049D9` | `#7D8CFF` | Focus, selection, links |

**State spectrum** (same in both themes, tuned for 3:1 against both cards):

| State | Colour | Meaning |
| --- | --- | --- |
| Active | `#159A78` | visited in last 24 h |
| Simmering | `#D99A00` | 1–3 days |
| Stale | `#E8692A` | 3–7 days, low engagement |
| Abandoned | `#8892A3` | > 7 days |
| Unfinished | `#7B4FD9` | form started or read 20–80 % |
| Duplicate | `#D63F86` | same normalised URL elsewhere |
| Protected | `#2D7BE0` | pinned, audible or kept |
| No history | `#BFC6D1` | opened before install |

**Type.** *Bricolage Grotesque* (variable, optical size) for headings, numbers and the wordmark — its ink traps give the lens instrument some character. *Onest* (variable) for UI text. Numbers use tabular figures. Scale (dashboard): 12 / 13 / 14 / 16 / 20 / 28 / 40. Popup runs one step smaller.

**Shape.** Radius encodes hierarchy: windows and drawers 16 px, columns and panels 12 px, tab cards 8 px, chips fully round, inputs 8 px. Shadows only on things that float (drag overlay, popovers, drawers).

**Motion.** Only in response to the user: drawers slide, dragged cards lift, applied actions collapse out of the plan. One orchestrated moment: the spectrum re-sorts itself after an analysis run. `prefers-reduced-motion` disables both.

**Copy.** Sentence case, plain verbs. Buttons say what happens and keep their name in the toast: *Archive 12 tabs* → "Archived 12 tabs · Undo".

## Popup — "Lens" (380 × ~560)

```
┌──────────────────────────────────────────┐
│ ◐ TabLens                 ⌕   ▤   ⚙      │  search · side panel · dashboard
│ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮ │  spectrum, one slice per tab
│ 87 tabs in 9 missions.                    │
│ 23 can go. 3 have unfinished work.        │
│                                          │
│ Cleanup plan                     Analysed 2m ago ↻
│ ┌──────────────────────────────────────┐ │
│ │ ☑ Close 4 duplicates             ⌄   │ │
│ │ ☑ Archive 12 abandoned           ⌄   │ │  expands to tab rows with reasons
│ │ ☐ Archive 7 stale                ⌄   │ │
│ │ ☐ Group 5 missions               ⌄   │ │
│ └──────────────────────────────────────┘ │
│ Unfinished — kept for you                │
│  ◉ Visa application form · form started  │
│  ◉ Attention is all you need · read 46 % │
│                                          │
│ [ Apply plan (16 tabs) ]   Open dashboard│
└──────────────────────────────────────────┘
```

- Expanded rows: favicon, title, reason line ("9 days since last visit · read 4 %"), per-tab checkbox.
- *No site access yet* banner when content reading isn't granted: "Grouping uses titles only. Let TabLens read pages for sharper missions." → *Allow page reading*.
- Search icon turns the popup into Quick find.

## Side panel (~360 wide, full height)

Three tabs: **This tab** (dossier of the active tab, updates as you switch), **Missions** (list with mini spectrum and counts; click to focus the group), **Save** (save current tab with intent chips and note).

## Dashboard

```
┌───────────────┬─────────────────────────────────────────────────────────┐
│ ◐ TabLens     │ Missions                         ⌘K Find   ↻ Analyse    │
│               │ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮ │
│ Overview      │                                                         │
│ Missions   9  │ ┌ Comparing laptops ┐ ┌ Work: Expense app┐ ┌ Unsorted ┐  │
│ Unfinished 3  │ │ ▮▮▮▮▮▮▮  personal │ │ ▮▮▮▮▮▮▮▮  work   │ │          │  │
│ Library       │ │ 9 tabs · 3 read   │ │ PR #42 to review │ │          │  │
│ Archive       │ │ ┌──────────────┐  │ │ ┌──────────────┐ │ │          │  │
│               │ │ │▣ MacBook Air │  │ │ │▣ Fix receipt │ │ │          │  │
│               │ │ │ Read 82% ·2d │  │ │ │ PR · 3h ago  │ │ │          │  │
│               │ │ └──────────────┘  │ │ └──────────────┘ │ │          │  │
│ Settings      │ │ Group  Archive 6  │ │ Focus  Export    │ │          │  │
│ Focus: off    │ └───────────────────┘ └──────────────────┘ └──────────┘  │
│               │                                        ┌ Drop to archive┐│
└───────────────┴─────────────────────────────────────────────────────────┘
```

### Overview
Summary strip (tabs, missions, can go, duplicates, unfinished, last analysed), **Unfinished work** pinned first (Open / Keep), **Needs attention** (top five suggestions with reasons), **From your library** (one resurfaced save), **Windows** (tab count per window with mini spectrum).

### Missions board
Columns per mission sorted by "most can go" first. Column header: name (inline rename), work/personal tag, colour dot (Chrome group colour picker), mini spectrum, one-line intent, insight line, menu (Focus, Group in Chrome, Archive stale, Export Markdown, Merge into…). Cards: favicon, title (2 lines), state chip, last visit, read-depth micro bar, duplicate / form / pinned icons. Card click opens the dossier. Drag behaviour per [PRODUCT.md §2](./PRODUCT.md). Filter bar: All · Work · Personal, state filter chips, window filter, search.

### Tab dossier (sheet, 440 wide, from the right)

```
┌──────────────────────────────────────┐
│ ▣ MacBook Air M4 review — The Verge  │
│ theverge.com · Article      ◉ Stale  │
│                                      │
│ What it is                           │
│ Review of Apple's M4 MacBook Air …   │
│ Outline: Design · Battery · Verdict  │
│ #laptop #battery #m4                 │
│                                      │
│ What you did                         │
│ Opened 6 days ago from "best laptops │
│ 2026" · 3 visits · 4m 12s active     │
│ Read depth  ████████░░  82 %         │
│ Visits  ▁▃▁▁▅▁                        │
│                                      │
│ Why it's here                        │
│ In "Comparing laptops" because:      │
│  · opened from a tab in the mission  │
│  · shares laptop, battery, m4        │
│ Verdict: suggest archive             │
│  · not opened for 4 days             │
│  · you finished reading it           │
│                                      │
│ [Open] [Keep] [Snooze ▾] [Save] [Archive]
└──────────────────────────────────────┘
```

### Unfinished
List of tabs with form started or partial reads, grouped by mission, with *Open*, *Keep*, *Save with note*.

### Library
Header toggle **By topic / By folder / By intent**, search, filters (Never opened · Not seen 90 d · Duplicates · This week · Reminders). Content is a responsive grid of shelves; each shelf lists bookmark rows: favicon, title, domain, intent chip, note, "Saved 3 mo ago · last seen never". Selecting rows shows a bulk bar (Move to folder, Add intent, Delete duplicates). If the `bookmarks` permission is not granted the page shows what it will do and a single *Allow bookmark access* button.

### Archive
Sections: **Snoozed** (countdown, Wake now), **Archived missions** (Resume in new window, Restore tabs, Delete), **Archived tabs** (search, restore). Archive never auto-deletes without a setting.

### Settings
Left sub-nav inside the page.

| Section | Controls |
| --- | --- |
| General | Theme (System/Light/Dark), default surface (popup/side panel), keyboard shortcuts (link to chrome://extensions/shortcuts), already-open nudge on/off |
| Analysis | State thresholds (sliders: simmering, stale, abandoned days; unfinished read range), engagement weights (four sliders that always sum to 1), mission confidence threshold, daily analysis time, auto-run on browser start |
| AI | Mode: Automatic / On-device only / Cloud / Off. On-device availability check with status. Cloud: API key (stored locally), model, *Test connection*, and a preview of exactly what would be sent for one tab |
| Privacy | Page reading status + *Allow*/*Revoke*, excluded domains (chips, presets: banking, payments, health, email), incognito toggle, pause tracking (1 h / until tomorrow / indefinitely), snapshot retention days |
| Rules | Learned rules table (pattern → mission, created from, date), delete, add manually |
| Data | Storage usage, export all as JSON, import, **Delete all data** (confirm dialog naming what goes) |

## Accessibility
Every drag has a keyboard path (dnd-kit keyboard sensor + "Move to…" menu on each card). Focus rings use `ring`. Colour is never the only carrier of state: chips carry the state name and the spectrum has tooltips plus an accessible table fallback.
