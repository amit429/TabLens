# TabLens — Development plan

Built in small vertical slices; each slice ends in a commit that builds and passes tests.

**Status (Nov 13, 2026):** slices 1–17 are implemented. Remaining before a store release: real-world tuning of clustering thresholds on volunteer tab sets, store listing assets, and Web Store review.

| # | Slice | Done when |
| --- | --- | --- |
| 1 | Docs: product spec v2, UI spec, architecture, plan | Committed |
| 2 | Scaffold: WXT + React + Tailwind v4 + shadcn primitives, fonts, theme tokens, Vitest | `pnpm build` produces a loadable MV3 extension |
| 3 | Domain core: types, URL normalisation, text/TF-IDF, settings, Dexie schema, RPC | Unit tests green |
| 4 | Tracking: tab lifecycle, activations, active time with idle/focus, visits, opener chains, restart re-keying | Manual check in Chrome; counters persist across worker restarts |
| 5 | Content capture: snapshot extraction, page type, scroll depth, interactions, form-started flag, runtime registration after permission grant | Snapshots visible in IndexedDB; no form values stored |
| 6 | Analysis engine: states, engagement, duplicates, clustering, naming, rules, explanations, cleanup plan | Unit tests green on fixture tab sets |
| 7 | Executor: group, move, archive, restore, snooze, close duplicates, focus mode, undo | Undo restores tabs and groups |
| 8 | Popup: spectrum, summary sentence, cleanup plan, unfinished, apply + undo | Plan applies only checked items |
| 9 | Dashboard shell + Overview + Quick find | Navigation, ⌘K palette across tabs/archive/saves |
| 10 | Missions board with drag and drop → real tab groups | Dropping a card moves the real tab |
| 11 | Tab dossier | Every verdict shows its reasons |
| 12 | Library: bookmarks + saves with intent | Topic/folder/intent views, last seen |
| 13 | Archive + snooze | Restore, resume mission in new window, snooze wakes tabs |
| 14 | Settings | All controls persist; delete all data empties storage |
| 15 | AI: Gemini Nano on-device + Gemini API (your key) routing, AI page summaries | Falls back cleanly when unavailable |
| 16 | Side panel, context menus, already-open nudge, badge, digest | — |
| 17 | Polish, onboarding, README, privacy policy | Screenshots in README |

## Testing

- **Unit (Vitest)**: everything in `lib/` that is pure — URL normalisation, TF-IDF, states, engagement, clustering, plan, rules.
- **Manual / scripted**: load `.output/chrome-mv3` in Chrome (or Playwright's Chromium with `--load-extension`) and exercise the flows against a fixture set of tabs.
