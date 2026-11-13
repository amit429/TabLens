# TabLens — Architecture

Manifest V3 extension, built with [WXT](https://wxt.dev) (Vite under the hood), TypeScript, React 19, Tailwind CSS v4. One small backend: the TabLens API (`server/`), a Cloudflare Worker that holds the Gemini key.

```
          capture                       analyse                     approve
┌──────────────────────┐      ┌───────────────────────────┐   ┌──────────────────────┐
│ content script       │      │ background service worker │   │ popup / side panel / │
│  · snapshot (text,   │─msg─▶│  · tracker (time, visits) │   │ dashboard (React)    │
│    headings, type)   │      │  · analysis engine        │◀──│  · read IndexedDB    │
│  · scroll / clicks / │      │  · AI router              │rpc│  · send intents      │
│    form-started flag │      │  · action executor ◀──────┼───│    (rpc)             │
└──────────────────────┘      │      (only thing that     │   └──────────────────────┘
 chrome.tabs / idle /         │       touches tabs)       │
 windows events ─────────────▶│                           │
                              └─────────────┬─────────────┘
                                            ▼
                          IndexedDB (Dexie) + chrome.storage.local (settings)
```

## Source layout

```
src/
  entrypoints/
    background.ts          service worker: wires tracker, analysis, executor, alarms, menus
    content.ts             runtime-registered content script (only after page access is granted)
    popup/                 "Lens" — spectrum + cleanup plan
    sidepanel/             this tab · missions · save
    dashboard/             full-page workbench (overview, board, library, archive, settings)
  components/
    ui/                    shadcn-style primitives (button, sheet, dialog, command, …)
    *.tsx                  product components (Spectrum, TabCard, Dossier, CleanupPlan, Board…)
  lib/
    types.ts               domain model
    db.ts                  Dexie schema and helpers
    settings.ts            typed settings in chrome.storage.local with defaults
    rpc.ts                 typed request/response messages between UI and background
    url.ts                 URL normalisation, tracking-param stripping, sensitive-domain checks
    text.ts                tokeniser, stop words, TF-IDF, cosine similarity
    analysis/              states, engagement, clustering, naming, rules, plan, explanations
    ai/                    contract.ts (shared with server), router: Gemini Nano → TabLens API → heuristics
    executor.ts            group / move / archive / restore / snooze / undo
    tracker.ts             active time, activations, visits, opener chains
    library.ts             bookmarks + saves model and clustering
  hooks/                   React hooks (useLiveQuery wrappers, useTabs, useSettings)
```

## Data model (IndexedDB via Dexie)

| Table | Key | Fields |
| --- | --- | --- |
| `tabs` | `tabId` | url, normUrl, title, favIconUrl, windowId, openedAt, lastAccessed, activations, activeMs, maxScroll, interactions, formStarted, openerTabId, openerUrl, visits (last 20 timestamps), keep, closedAt, hasHistory |
| `snapshots` | `normUrl` | url, title, pageType, description, headings, text (≤ 2,000 words), keywords, capturedAt |
| `missions` | `id` | name, intent, kind (work/personal), color, tabIds, confidence, source (model/heuristic/user), groupId, insight, evidence |
| `analyses` | `id` | createdAt, durationMs, engine, perTab verdicts and reasons, plan |
| `rules` | `id` | kind (domain/url-prefix/tab), pattern, missionName, createdFrom, createdAt |
| `archive` | `id` | url, title, favIconUrl, missionName, archivedAt, lastState, reason, snoozeUntil, batchId |
| `saves` | `id` | url, title, intent, note, remindAt, bookmarkId, createdAt, lastSeenAt |
| `bookmarkMeta` | `bookmarkId` | intent, note, lastSeenAt |
| `undo` | `id` | label, createdAt, inverse operations |

Tab ids are not stable across browser restarts. On startup the tracker re-keys records by matching `normUrl` + window position, carrying behaviour over.

## Key decisions

- **WXT over hand-rolled Vite**: file-based entrypoints, MV3 manifest generation, HMR for extension pages, runtime-registered content scripts.
- **Single executor**: only `executor.ts` (in the worker) calls `chrome.tabs.remove/group/move`. UI surfaces send intents over RPC. Every executor call returns an undo token.
- **Service worker lifetime**: active-time state lives in `chrome.storage.session`; counters are flushed on every event and by a 30 s alarm (Chrome's minimum). Content scripts send a 15 s heartbeat while visible.
- **Analysis is pure**: `analysis/*` takes plain data in and returns missions, verdicts and a plan. It is unit tested with Vitest and runs in the worker.
- **Clustering pipeline**: rules first → opener chains (union-find) → same-site sessions for app domains → TF-IDF cosine over descriptor text with agglomerative merge → AI naming/merging when available → heuristic naming fallback (top distinctive keywords + domain archetype).
- **AI routing (LLM-first)**: with TabLens AI on, `/v1/organize` lets Gemini decide every free tab's mission (heuristic clusters are sent as hints; the user's Chrome groups, rules and renames are fixed missions it can add to by name); otherwise Gemini Nano names heuristic clusters; otherwise heuristics. Automatic AI runs have a 10-minute cooldown. Only descriptors (title, domain, page type, ≤ 100-word summary) are ever sent. The Gemini key lives only in the Worker as a secret; users never provide one.
- **TabLens API** (`server/`): Cloudflare Worker with two fixed-prompt endpoints, zod-validated size-capped input, caller check (extension origin/id), Workers Rate Limiting per install and per IP, a KV daily quota per random install id, and no content logging.
- **Live UI**: Dexie `liveQuery` (cross-context via BroadcastChannel) plus `chrome.tabs` events keep every surface current without polling.
- **Optional permissions**: `<all_urls>` host access and `bookmarks` are optional and requested in context, after the user has seen value.
