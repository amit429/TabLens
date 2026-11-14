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
| `POST /v1/organize` | LLM-first: assigns every tab to a mission (respecting the user's own missions) and names them — up to 300 tabs per call |
| `POST /v1/name-missions` | Names pre-made clusters, merges clusters that are one task, places unsorted tabs |
| `POST /v1/summarize` | Two-sentence page summary for the dossier |

Prompts, request limits and response schemas live in [`src/lib/ai/contract.ts`](../src/lib/ai/contract.ts), shared with the extension.

## Abuse protection

- **Fixed prompts, capped input.** The Worker only runs its own two prompts on size-limited, schema-validated input, so it can't be used as a general Gemini endpoint.
- **Caller check, fail closed.** Only extensions listed in the `ALLOWED_EXTENSION_IDS` secret get in (Origin `chrome-extension://…`, or the `X-TabLens-Extension` header when Chrome omits Origin). Unset means every request is refused; `*` allows any extension, for local development only. Web pages always send their own Origin and are rejected.
- **Rate limits.** 20 requests/minute per install and 60/minute per IP (Workers Rate Limiting).
- **Daily quotas.** Per install: 60 analyses and 200 summaries (`DAILY_NAMING_LIMIT`, `DAILY_SUMMARY_LIMIT`). Per IP: 300 calls (`DAILY_IP_LIMIT`) — install ids are self-asserted, IPs aren't. In total: 3,000 calls (`DAILY_GLOBAL_LIMIT`) — the hard ceiling on your Gemini spend, whoever finds the URL.
- **No content logging.** Only error classes are logged; tab data is never stored.

A published extension's API URL and id are public by nature (anyone can read an extension's code), and scripts can fake headers — so the caller check is a deterrent. What bounds your bill is server-side: the narrow endpoints, rate limits, the per-IP and global daily caps, and a budget alert on the Gemini key's Google Cloud project.

## Develop

```bash
cd server
pnpm install
cp .dev.vars.example .dev.vars   # your Gemini key (git-ignored), or GEMINI_API_KEY=mock for fake answers
pnpm dev                         # http://localhost:8787
pnpm test
```

Build the extension against it: `TABLENS_API=http://localhost:8787 pnpm build` (from the repo root).

## Deploy

**From the Cloudflare dashboard (no terminal):** Workers & Pages → Create → Import a repository → this repo, project name `tablens-api`, root directory `server`, deploy command `npx wrangler deploy`. Then the Worker's Settings → Variables and Secrets → Add two values of type **Secret**: `GEMINI_API_KEY` (your key) and `ALLOWED_EXTENSION_IDS` (your extension id from `pnpm keygen`). Every push to `main` redeploys; secrets survive redeploys.

**From the terminal:**

```bash
cd server
npx wrangler login
npx wrangler secret put GEMINI_API_KEY          # paste the key when prompted; it never touches the repo
npx wrangler secret put ALLOWED_EXTENSION_IDS   # your extension id(s) from `pnpm keygen`
npx wrangler deploy                       # prints https://tablens-api.<your-subdomain>.workers.dev
```

Then, in the repo root: put the Worker URL in `TABLENS_API` in `.env`, run `pnpm keygen` to pin your extension id, and add that id as the `ALLOWED_EXTENSION_IDS` secret (comma-separate several, e.g. your dev id and your Chrome Web Store id). Rebuild the extension.

Cost control: `gemini-3.5-flash-lite` is the default model (`GEMINI_MODEL`). Also set a budget alert on the Google Cloud project that owns the key.
