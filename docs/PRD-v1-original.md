# TabLens — PRD: Automated, Behaviour-Aware Tab Intelligence

Nov 13, 2026 · @Amit Pile

## Summary

TabLens (working name) is a Chrome extension that understands what is inside each open tab and how you have actually used it, groups tabs into "missions" automatically, and shows a clear report with suggested actions you approve. Nothing is grouped, closed or archived without your approval.

The wedge is depth. Existing AI tab groupers sort by title and URL, or by rules the user types into settings. TabLens adds two layers they lack:

- **Content:** it reads the page itself (headings, main text, page type such as product, article, form, doc, search results).
- **Behaviour:** it records how each tab has been used since install: last visit, total visits, active time, scroll depth, whether a form was started, whether the tab is pinned or playing audio.

Combining the two lets TabLens say something no URL-based grouper can: "You opened 9 laptop tabs over 6 days, read 3 of them properly, and haven't touched the rest since Tuesday."

v1 is a solo-buildable Manifest V3 extension, local-first, with an optional cloud model for better grouping.

## Problem statement

Heavy browser users keep dozens of tabs open because each one is an unfinished intention, and closing it feels like losing work. Over days the tab bar stops being a workspace and becomes a pile nobody can read: titles truncate to icons, duplicates pile up, and the user no longer remembers why half the tabs are open.

The cost shows up three ways:

- **Lost work:** a half-filled form or half-read article gets closed by accident or forgotten.
- **Repeated work:** the user searches again for something already open in tab 47.
- **Decision paralysis:** a shopping or research task never finishes because the comparison is spread across 12 tabs.

Current AI tab groupers only fix the surface. They group by title, URL or user-written rules, so they cannot tell a laptop review from a laptop job listing on the same site, and they know nothing about which tabs the user actually engaged with.

Evidence status: this is based on observed behaviour and competitor review, not yet on user research. Validating it is the first job of phase 0 (see Phasing).

## Competitive landscape

No product today combines open-tab content with per-tab engagement history and turns it into an approvable report. The closest is Edge Journeys, which works on browsing history rather than open tabs and only in Edge.

| Product | Groups on | Reads page content | Uses engagement signals | What it does with the result |
| --- | --- | --- | --- | --- |
| [Smart Tab Grouper](https://chromewebstore.google.com/detail/smart-tab-grouper/melbgikjlgmldokhmlfkaooijjoddcle) | Titles, URLs, user-defined groups | No (per hands-on test) | No | Groups tabs; Focus Mode closes tabs unrelated to a chosen topic |
| [TabWise](https://chromewebstore.google.com/detail/tabwise/eidpapnjkfikecioapdklppjbfjehcbj) | AI-named groups | Not documented | Staleness only | Groups, closes stale tabs, weekly email summary |
| Chrome tab organizer (built in) | Suggested groups with names and emoji | Not documented | No | Creates tab groups on request |
| [Gemini in Chrome](https://www.businesstoday.in/technology/news/story/google-integrates-gemini-3-into-chrome-adds-agentic-ai-features-513354-2026-01-29) | Tabs the user adds to a context group | Yes, on demand | No | Answers questions and compares across tabs; auto-browse runs tasks on request |
| [Edge Journeys](https://support.microsoft.com/en-us/Microsoft-Copilot/copilot-journeys) | Browsing history, by topic | Yes (summaries) | History-level | Topic cards with summaries and suggested next steps on the new tab page |

**Positioning:** TabLens works on the tabs open right now, in Chrome, using content plus behaviour, and ends in a report the user acts on. Gemini answers when asked; TabLens notices without being asked.

**Biggest threat:** Google ships this inside Chrome. See Risks for the response.

## Target users

v1 targets one primary persona; the other two are design checks, not separate products.

| Persona | Typical tab count | Main pain | What they need from TabLens |
| --- | --- | --- | --- |
| **Primary: the knowledge worker (developer, PM, analyst)** | 40–150 across 2–5 windows | Work tabs (PRs, docs, tickets) mixed with personal research | Separate work missions from personal ones; find the half-done PR review |
| Student or researcher | 30–80 | Many articles and papers, few actually read | Know which sources were really read; keep the rest without guilt |
| Shopper or planner | 15–40 per task | Comparison spread across many product or travel tabs | See the shortlist in one place; know which options were never looked at |

## Goals

**User goals**

1. **Understand the tab pile in under 60 seconds.** The first report after install explains every open tab's mission and status.
2. **Reduce open tabs without fear.** Median open-tab count falls 40% within 14 days for active users, with zero unrecoverable closures.
3. **Never lose half-done work.** Tabs with unsaved form input or unfinished reading are always flagged before any cleanup.

**Business goals**

4. **Prove pull before building more.** 30% of installers approve at least one suggested action in week 1.
5. **Earn a reason to return.** 25% of installers open the report in week 4 (D28 retention).

## Non-goals (v1)

- **No automatic closing or grouping without approval.** Trust is the product; one wrongly closed tab loses the user.
- **No task completion.** No drafting applications or booking flights. Gemini in Chrome and Edge already do task execution, and it multiplies risk. Revisit after v1 data.
- **No browsing-history mining.** v1 looks only at tabs open now and signals collected after install. History is Edge Journeys' ground and raises privacy concerns.
- **No Firefox, Safari or mobile.** Chrome and Chromium browsers (Edge, Brave, Arc) only; the tab APIs differ elsewhere.
- **No accounts or sync.** Everything stays in local storage; accounts come only if a paid tier needs them.

## User stories

**Knowledge worker (primary)**

1. As a developer with 90 open tabs, I want to see all of them sorted into named missions within a minute of installing, so that I understand my tab pile without clicking through it.
2. As a knowledge worker, I want to see which tabs I haven't touched in over a week, so that I can let go of them with confidence.
3. As a knowledge worker, I want to turn a suggested mission into a Chrome tab group with one click, so that my tab bar reflects how I actually work.
4. As a knowledge worker, I want to archive a finished mission and restore it later in one click, so that closing tabs never means losing them.
5. As a knowledge worker, I want to be warned before archiving a tab where I started typing into a form, so that I never lose half-done work.
6. As a knowledge worker, I want to rename, merge or split missions and have TabLens remember my corrections, so that grouping gets better each week.
7. As a knowledge worker, I want to mark a tab as "keep", so that it is never suggested for cleanup.

**Student or researcher**

8. As a student, I want to see how far I actually read each article, so that I know which sources I still need to read.

**Shopper or planner**

9. As someone comparing laptops, I want to see which product tabs I looked at closely and which I barely opened, so that I can shortlist faster.

**Edge cases**

10. As a new user, I want tabs opened before install labelled "no history yet" rather than "stale", so that the first report isn't wrong.
11. As a user with sleeping (discarded) tabs, I want them still grouped using their last saved snapshot, so that they don't fall into "Unknown".
12. As a user, I want banking, health and incognito tabs excluded from content reading by default, so that sensitive pages are never analysed.
13. As a user with 300+ tabs, I want the report to load in under 3 seconds, so that the tool never feels heavier than the problem.

## Core concepts

TabLens combines three layers per tab: what the page is (content), how the user has used it (behaviour), and how recently (recency). Behaviour signals are only collected after install, so the first report leans on content and Chrome's own last-accessed time.

**Signals collected**

| Signal | Source | How it is captured | Used for |
| --- | --- | --- | --- |
| Title, URL, domain | `chrome.tabs` | Read on each analysis run | Fast first-pass clustering |
| Page content (main text up to \~2,000 words, headings, meta, page type) | Content script with readability-style extraction | Captured when the page loads or is active; cached as a snapshot | Content-based mission inference |
| Last accessed time | `Tab.lastAccessed` | Read directly, works for pre-install tabs | Recency |
| Opened at | `tabs.onCreated` | Stored from install onward | Tab age |
| Opener tab | `Tab.openerTabId` | Stored on creation | Links tabs opened from one another into the same mission |
| Activation count | `tabs.onActivated` | Counter | Interest |
| Active time | `tabs.onActivated`, `windows.onFocusChanged`, `chrome.idle` | Foreground time only while the user is not idle | Engagement |
| Scroll depth | Content script scroll listener | Maximum % reached | Read depth |
| Interaction count | Content script | Counts of clicks and keypresses only, never content | Engagement |
| Form started | Content script input listener | True if any field is non-empty; values never stored | Protect unfinished work |
| Pinned, audible, discarded, grouped | `chrome.tabs` | Read on each run | Protection and state |
| Duplicate | Normalised URL (tracking parameters stripped) | Computed | Duplicate cleanup |

**Tab states** (derived; thresholds user-configurable)

| State | Rule (default) | Suggested action |
| --- | --- | --- |
| Active | Visited in the last 24 hours | None |
| Simmering | Last visit 1–3 days ago | None, shown for context |
| Stale | Last visit 3–7 days ago and low engagement | Suggest archive |
| Abandoned | Last visit more than 7 days ago | Suggest archive first |
| Unfinished | Form started, or scroll depth between 20% and 80% | Never auto-suggest closing; flag "finish or save" |
| Duplicate | Same normalised URL as another open tab | Suggest closing the older copy |
| Protected | Pinned, playing audio, or marked "keep" | Excluded from suggestions |
| No history yet | Opened before install with no behaviour data | Group by content only; no stale label |

**Engagement score** (0 to 1, each input normalised to 0–1 across the user's own tabs):

```latex
E = 0.4\,T_{active} + 0.3\,D_{scroll} + 0.2\,N_{visits} + 0.1\,I_{interactions}
```

Weights are starting guesses, tuned in phase 1 against which suggestions users accept.

**Mission inference**

1. Build a compact descriptor per tab: title, domain, URL path words, page type, and a \~100-word summary or keyword list.
2. Pre-cluster cheaply using opener chains, same-domain sessions and text similarity, so the model sees groups, not 150 loose tabs.
3. Ask the language model to name each cluster as a mission ("Comparing laptops under ₹80k"), mark it work or personal, merge or split clusters, and give a confidence score.
4. Attach engagement, states and duplicate info, then generate suggested actions per mission.
5. Store user corrections as rules (for example, every tab under a given repository goes to "Work: Expense app") and apply them before the model on the next run.

## Requirements

### P0: must ship in v1

1. **Behaviour tracking from install.** Record activation count, active time, scroll depth, interaction counts and form-started flag per tab.
   - Given a tab is in the foreground and the user is not idle for 2 minutes, active time increases by 120 s (±10%).
   - Active time pauses after 60 s of idle or when the browser window loses focus.
   - Inspecting extension storage shows no form field values, only a true/false flag.
2. **Content snapshot.** Extract main text, headings and page type for http and https pages; cache the latest snapshot per tab.
   - Excluded domains are never read; `chrome://`, the Web Store and PDFs fall back to title and URL.
   - A discarded (sleeping) tab is analysed from its last snapshot, or title and URL if none exists.
3. **Mission inference.** Runs on demand from the toolbar and once a day in the background.
   - Every open tab is assigned to exactly one mission, or to "Unsorted".
   - The report for 100 tabs is ready within 60 s on the cloud path.
   - In beta, users rate at least 80% of tab assignments correct.
4. **Report view.** A full-page report and a side panel summary (detailed under Report).
5. **Approve-only actions.** Group a mission into a Chrome tab group; archive a mission or single tab (close it and save a restorable record); close duplicates.
   - No tab is grouped, closed or moved without a user click.
   - Every action shows an Undo for 30 s; archived tabs stay restorable until the user deletes them.
6. **Protection.** Unfinished and Protected tabs are excluded from bulk archive.
   - Archiving a tab with a started form needs an explicit second confirmation naming the tab.
7. **Corrections.** Rename a mission, move a tab between missions, merge two missions.
   - A correction is stored as a rule and applied on the next run before the model.
8. **Privacy controls.** Domain exclusion list (pre-filled with banking, payments and health), incognito off by default, pause tracking, delete all data.
   - "Delete all data" empties extension storage within 2 s, verified by a storage read.
9. **Model routing.** Use on-device Gemini Nano when available; otherwise ask the user once whether to use the cloud model; otherwise fall back to non-AI clustering.
   - The cloud path sends only tab descriptors (title, domain, page type, short summary), never full page text.

### P1: fast follows

- Weekly digest notification: "14 tabs untouched for 7+ days across 3 missions."
- Mission card summary: for shopping missions, a shortlist of products viewed with engagement; for reading missions, read vs unread.
- Resume mission: reopen an archived mission into a new window.
- Export a mission as Markdown links (for Notion or notes).
- Keyboard shortcut to open the report.

### P2: design for, don't build

- Task completion per mission (comparison tables, drafts). Keep mission data structured so this can be added later.
- Cross-device sync and accounts.
- Firefox port; keep tab-API calls behind one adapter layer.
- Paid tier (cloud model quota, sync, history-based insights).

## Report

The report answers three questions in order: what needs my attention, what is each mission, and what can I safely let go. It appears in three places:

- **Toolbar badge:** the number of tabs needing attention (stale, abandoned, duplicate), refreshed after each daily run.
- **Side panel:** a one-screen summary listing missions with state counts and one-click actions.
- **Full-page report:** the detailed view below, plus an Archive tab for restoring past missions.

**Full-page layout, top to bottom**

1. **Summary strip:** total tabs, missions, stale, duplicates, unfinished; time of last analysis; Re-analyse button.
2. **Unfinished work:** pinned above everything. Tabs with a started form or 20–80% read depth, each with "Open" and "Keep".
3. **Mission cards:** sorted with the most stale tabs first. Each shows name, one-line intent, work or personal tag, state chips, and a tab table with title, state, last visit and read depth.
4. **Unsorted:** tabs below the confidence threshold, with a "Move to mission" control.

&#91;embedded content: Report mockup · one mission card\]

Suggested actions sit on each card and always name their scope ("Archive 6 stale"), so the user knows exactly what a click will do.

**First run:** before site access is granted, the report groups by title and URL only and shows a banner offering smarter grouping by reading page content.

## Technical architecture

TabLens is a Manifest V3 extension with no backend in v1, except an optional thin proxy for the cloud model. Signals flow from pages and Chrome events into local storage; analysis reads from storage and writes missions back; the report reads missions and only the action executor touches tabs.

&#91;embedded content: TabLens architecture · capture, analyse, approve\]

The highlighted executor is the only component that changes tabs, and only after a click in the report.

**Key technical decisions**

- **Service worker lifetime:** MV3 workers are shut down when idle, so counters are flushed to storage on every event and at least every 15 s, never held only in memory. The daily run uses `chrome.alarms`.
- **Sleeping tabs:** content scripts cannot run in discarded tabs, so the snapshot is taken when a page loads or becomes active and reused later. `Tab.lastAccessed` covers recency for tabs opened before install.
- **Text extraction:** a readability-style extractor, capped at \~2,000 words. Page type comes from cheap signals: schema.org Product or Article markup, forms on the page, search-result URL patterns.
- **Pre-clustering:** opener chains, same-domain sessions and TF-IDF similarity in the worker. A small in-browser embedding model is a P1 upgrade if quality needs it.
- **On-device model:** the [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) (`LanguageModel`) is stable for extensions from Chrome 138, but Gemini Nano needs 22 GB free disk and either a GPU with more than 4 GB VRAM or 16 GB RAM with 4+ cores. Expect many users to fall back.
- **Cloud model:** called through a small serverless proxy that holds the API key, requesting structured JSON (mission name, work or personal, tab ids, confidence). No logging.
- **Stack:** TypeScript, Vite with an MV3 plugin, React for the report and side panel, IndexedDB through a small wrapper library.

**Data model**

| Entity | Key fields |
| --- | --- |
| TabRecord | tab id, URL, title, opened at, last accessed, activations, active seconds, max scroll %, interaction count, form started, snapshot ref |
| Snapshot | URL, page type, headings, main text (capped), captured at |
| Mission | id, name, intent line, work or personal, tab ids, confidence, created by (model or user) |
| Rule | match (domain or URL pattern), target mission, source correction, created at |
| ArchiveEntry | mission name, URL, title, archived at, last state |

## Privacy, permissions and Web Store review

TabLens reads every page the user visits, so trust decides adoption. The rule: everything stays on the device unless the user opts into the cloud model, and even then only short tab descriptors leave the browser.

**Permissions**

| Permission | Why it is needed | Install-time or later |
| --- | --- | --- |
| `tabs`, `tabGroups` | Read titles, URLs, last-accessed time; create groups | Install |
| `storage`, `unlimitedStorage` | Local signals, snapshots, archive | Install |
| `idle`, `alarms` | Pause active time when idle; daily analysis run | Install |
| `sidePanel` | Side panel summary | Install |
| `scripting` + host access to all sites | Content and behaviour capture on pages | Requested during onboarding as an optional permission, after the user has seen a title-only report |

Asking for site access only after showing value avoids the "read and change all your data on all websites" warning at install, which is the biggest install-rate risk.

**Data handling**

- Signals and snapshots live in local extension storage only. No accounts, no server database in v1.
- Snapshots are capped at \~2,000 words and deleted 7 days after the tab closes; archive records keep only URL, title, mission and dates.
- Form values, passwords, and keystroke content are never captured, only counts and a form-started flag.
- Cloud path (opt-in): sends title, domain, page type and a \~100-word summary per tab over HTTPS; nothing is logged or used for training.
- Excluded by default: incognito, banking and payment sites, health portals, and any domain the user adds.

**Web Store readiness**

- Publish a plain-language privacy policy and fill in the store's privacy practices declaration to match it exactly.
- Justify each permission in the submission; expect a longer review because of broad site access.
- Open-source the content script so technical users can verify what it collects.

## Success metrics

Metrics come from opt-in anonymous counts (no URLs or titles ever leave the device), evaluated at 2 and 8 weeks after public launch.

| Metric | Type | Success | Stretch | How measured |
| --- | --- | --- | --- | --- |
| First report viewed within 10 min of install | Leading | 70% | 85% | Onboarding event |
| Time from "Analyse" click to report, 100 tabs | Leading | ≤ 60 s | ≤ 20 s | Timing event |
| Installers approving at least 1 action in week 1 | Leading | 30% | 45% | Action events |
| Suggestions accepted (of suggestions shown) | Leading | 40% | 60% | Accept vs dismiss events |
| Tabs moved by user corrections (of tabs grouped) | Leading (lower is better) | ≤ 20% | ≤ 10% | Correction events |
| Optional site-access permission granted | Leading | 50% | 70% | Permission event |
| D28 retention (report opened in week 4) | Lagging | 25% | 35% | Report-open events |
| Change in median open tabs at day 14 | Lagging | −40% | −60% | Daily tab count |
| Reports of a tab lost with no way to restore | Lagging | 0 | 0 | Support and reviews |
| Web Store rating, 50+ reviews | Lagging | ≥ 4.5 | ≥ 4.7 | Store listing |

## Risks and mitigations

The two risks most likely to sink TabLens are the site-access warning at install and Google building the same thing into Chrome.

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Google ships content- and behaviour-aware tab reports in Chrome | High | High | Ship fast and cheaply; own the behaviour layer and approve-only report; support all Chromium browsers; treat v1 as a learning bet, not a company |
| Broad site-access warning kills installs | High | High | Title-only report first, site access requested later as optional; plain privacy page; open-source content script |
| Gemini Nano unavailable on many laptops (needs 22 GB free disk and 16 GB RAM or a GPU with more than 4 GB VRAM) | High | Medium | Opt-in cloud model; non-AI clustering fallback |
| Wrong groupings erode trust | Medium | High | Confidence threshold with an "Unsorted" bucket; corrections stored as rules |
| Content scripts on every tab slow the browser | Medium | Medium | Extract once per load during idle time, cap text length, throttle scroll listeners, skip heavy app pages |
| Single-page apps (Gmail, Notion, GitHub) give poor extracted text | Medium | Medium | Treat known apps as "app tabs" grouped by title and URL pattern |
| Store review delays or rejects | Medium | Medium | Minimal permissions with written justifications; privacy declaration matches policy exactly |
| Cold start: no behaviour data in week 1 | Certain | Medium | Use `lastAccessed` and content; label "No history yet" instead of guessing |

## Open questions

**Blocking (answer in phase 0)**

- [ ] Research: do heavy-tab users want a report to act on, or just a tidier tab bar? Run 10 interviews and a landing-page fake door.
- [ ] Engineering: how well does Gemini Nano name missions on a real 100-tab set compared with a cloud model? Benchmark both on 5 volunteers' tab sets.
- [ ] Engineering: what is the cloud cost per 100-tab analysis, and is it low enough to stay free?

**Non-blocking**

- [ ] Legal: does the opt-in cloud path need a specific consent notice under India's DPDP Act beyond the privacy policy?
- [ ] Design: should the default surface be the side panel or the full-page report?
- [ ] Product: free forever, or a paid tier for cloud model usage and sync?
- [ ] Engineering: can behaviour capture survive Chrome's Memory Saver discarding tabs without losing counts?

## Phasing

The plan spends two weeks proving the pain before any build, then ships a private beta by week 6 and a public launch by week 8. Durations assume one person part-time and are estimates.

&#91;embedded content: Roadmap · 4 phases, 3 gates\]

The first gate is the real decision. If fewer than 6 of 10 interviewees describe the tab-pile problem without prompting, or neither model groups a real tab set at least 80% correctly, stop or pivot before building. Leave at least a week for Web Store review, since broad site access tends to lengthen it. D28 retention is first measurable around week 12 and decides whether phase 3 continues.

## Sources

- [Smart Tab Grouper, Chrome Web Store](https://chromewebstore.google.com/detail/smart-tab-grouper/melbgikjlgmldokhmlfkaooijjoddcle)
- [TabWise, Chrome Web Store](https://chromewebstore.google.com/detail/tabwise/eidpapnjkfikecioapdklppjbfjehcbj)
- [Gemini in Chrome agentic features, Business Today, Jan 2026](https://www.businesstoday.in/technology/news/story/google-integrates-gemini-3-into-chrome-adds-agentic-ai-features-513354-2026-01-29)
- [Copilot Journeys, Microsoft Support](https://support.microsoft.com/en-us/Microsoft-Copilot/copilot-journeys)
- [Prompt API, Chrome for Developers](https://developer.chrome.com/docs/ai/prompt-api)
- [Built-in AI APIs, Chrome for Developers](https://developer.chrome.com/docs/ai/built-in-apis)
