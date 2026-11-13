# TabLens privacy policy

Last updated: November 13, 2026

TabLens is a browser extension that helps you understand and tidy your open tabs. This policy describes exactly what it collects and where that data goes.

## The short version

- Everything TabLens records stays in your browser, in the extension's own storage.
- There is no TabLens account, analytics or tracking. The only server is the optional TabLens AI API, which stores no tab content.
- The only time anything leaves your browser is if **you** turn on TabLens AI (asked once during setup, changeable in Settings). Then a short description of each tab is sent to the TabLens API, which asks Google Gemini to name your missions. If Gemini Nano runs on your device, it's used instead and nothing leaves.

## What TabLens stores on your device

| Data | Why | How long |
| --- | --- | --- |
| Tab title, URL and favicon | To show and group your tabs | While the tab is open |
| When a tab was opened, last used, how many times you visited it, active time (only while the window is focused and you're not idle) | To tell active tabs from forgotten ones | While the tab is open |
| Maximum scroll depth (%) | To know how far you read | While the tab is open |
| Number of clicks and key presses — **never which keys** | Engagement | While the tab is open |
| A true/false flag for "a form was started" — **never form values** | To protect unfinished work | While the tab is open |
| Page snapshot: up to 2,000 words of main text, headings, description, detected page type | To understand what each tab is about | Deleted 7 days after the tab closes (configurable) |
| Archive entries: title, URL, mission name, date | So closed tabs can be restored | Until you delete them |
| Saves, notes, reasons and reminders you add; learned grouping rules | Your library and corrections | Until you delete them |
| Settings and a random install id (used only for TabLens AI's daily limits) | Configuration | Until you delete them |

Passwords, form contents and anything you type are never read or stored.

## Pages TabLens never reads

Page reading is optional and off until you allow it. Even when it's on, TabLens does not read:

- Banking, payment, health and password-manager sites (a default list you can edit)
- Any site you add to the exclusion list
- Incognito tabs (unless you turn this on in Settings and in Chrome)
- Chrome's own pages, the Chrome Web Store and PDFs

## AI

- **Gemini Nano (on device):** when your browser supports Chrome's built-in AI, mission names and summaries are generated locally. Nothing leaves your device.
- **TabLens AI (optional, asked once):** if you turn it on, TabLens sends a short descriptor per tab — title, site, page type and at most about 100 words of summary — to the TabLens API (a Cloudflare Worker run by TabLens), which forwards it to Google's Gemini API and returns mission names or a page summary. Full page text, form data and behaviour history are never sent. The TabLens API does not store or log this content. It keeps only a daily request count per install, keyed by a random install id that isn't linked to you, to enforce fair-use limits. Gemini processes requests under [Google's Gemini API terms](https://ai.google.dev/gemini-api/terms).

## Bookmarks

If you allow bookmark access for the Library, TabLens reads your bookmarks to sort and display them, and creates a "TabLens saves" folder for pages you save. Bookmark data stays in your browser.

## Your controls

In **Settings**: pause tracking, edit excluded sites, turn page reading off, export your data as JSON, and **Delete all data**, which empties TabLens's storage immediately. Uninstalling the extension also removes all of its stored data.

## Contact

Questions or concerns: open an issue at https://github.com/amit429/TabLens/issues.
