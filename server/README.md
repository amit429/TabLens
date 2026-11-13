# TabLens API

A deliberately narrow Cloudflare Worker in front of Google Gemini. It holds the Gemini API key so the extension never ships one, and users never need their own.

```
extension ──short tab descriptors──▶ TabLens API (this Worker, holds GEMINI_API_KEY) ──▶ Gemini
```

## What it does

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/health` | `{ ok, model }` |
| `GET /v1/quota` | Today's usage for this install |
| `POST /v1/name-missions` | Names clusters of tabs, merges clusters that are one task, places unsorted tabs |
| `POST /v1/summarize` | Two-sentence page summary for the dossier |

Prompts, request limits and response schemas live in [`src/lib/ai/contract.ts`](../src/lib/ai/contract.ts), shared with the extension.

## Abuse protection

- **Fixed prompts, capped input.** The Worker only runs its own two prompts on size-limited, schema-validated input, so it can't be used as a general Gemini endpoint.
- **Caller check.** Requests must come from a Chrome extension (Origin `chrome-extension://…`, or the `X-TabLens-Extension` header when Chrome omits Origin). Web pages always send their own Origin and are rejected. Set `ALLOWED_EXTENSION_IDS` to your published extension id(s) in production.
- **Rate limits.** 20 requests/minute per install and 60/minute per IP (Workers Rate Limiting).
- **Daily quota per install.** 60 analyses and 200 summaries by default (`DAILY_NAMING_LIMIT`, `DAILY_SUMMARY_LIMIT`), counted in KV under a random install id.
- **No content logging.** Only error classes are logged; tab data is never stored.

Non-browser scripts can fake any header, so the caller check is a deterrent; the narrow endpoints, rate limits, quotas and a spend cap on the Gemini key are what bound cost.

## Develop

```bash
cd server
pnpm install
cp .dev.vars.example .dev.vars   # put your Gemini key in .dev.vars (git-ignored)
pnpm dev                         # http://localhost:8787
pnpm test
```

Build the extension against it: `TABLENS_API=http://localhost:8787 pnpm build` (from the repo root).

## Deploy

```bash
cd server
npx wrangler login
npx wrangler secret put GEMINI_API_KEY    # paste the key when prompted; it never touches the repo
npx wrangler deploy                       # prints https://tablens-api.<your-subdomain>.workers.dev
```

Then build the extension with that URL: `TABLENS_API=https://tablens-api.<your-subdomain>.workers.dev pnpm build`, and once the extension has a stable id, set `ALLOWED_EXTENSION_IDS` in `wrangler.jsonc` and redeploy.

Cost control: `gemini-3.5-flash-lite` is the default model (`GEMINI_MODEL`). Also set a budget alert on the Google Cloud project that owns the key.
