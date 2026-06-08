# Outreach Automation Pipeline

TypeScript CLI for the Vocallabs take-home: one company domain in, outreach emails out.

**Pipeline:** Ocean.io (lookalikes) → Prospeo (people + verified emails) → Brevo (send)

## Quick Start

```bash
npm install
cp .env.example .env   # fill in API keys

# dry-run first (no emails sent)
npm run dev linear.app -- --limit 2 --dry-run

# live run with confirmation prompt
npm run dev linear.app -- --limit 1
```

`linear.app` is a reliable demo seed. Some domains (e.g. `openai.com`) return weak lookalikes.

## Prerequisites

- Node.js 18+
- Accounts: [Ocean.io](https://ocean.io), [Prospeo](https://prospeo.io), [Brevo](https://brevo.com)
- Verified sender on your custom domain in Brevo (`BREVO_SENDER_EMAIL`)

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OCEAN_API_KEY` | Yes | - | Ocean.io API token |
| `PROSPEO_API_KEY` | Yes | - | Prospeo API key |
| `BREVO_API_KEY` | Yes | - | Brevo transactional API key |
| `BREVO_SENDER_EMAIL` | Yes | - | Verified sender email |
| `BREVO_SENDER_NAME` | Yes | - | Display name on outgoing mail |
| `COMPANY_LIMIT` | No | `10` | Lookalike companies to fetch |
| `CONTACTS_PER_COMPANY` | No | `1` | People per company |
| `API_DELAY_MS` | No | `1000` | Delay between API calls (ms) |
| `RETRY_MAX_ATTEMPTS` | No | `3` | Retries for transient failures |
| `DEBUG` | No | `false` | Verbose logging |

CLI flags: `--limit N`, `--dry-run`

## How it runs

| Stage | What happens |
|---|---|
| 1 | Ocean.io finds lookalike companies from seed domain |
| 2 | Prospeo searches decision-makers per company (LinkedIn URL kept on contact) |
| 3 | Prospeo bulk-enrich gets verified work emails |
| 4 | Dedupe by email, validate format |
| 5 | Preview + confirm before send (`default: false`) |
| 6 | Brevo sends personalized emails |

**Eazyreach:** Vocallabs FAQ says to use Prospeo for email enrichment instead. Stage 3 uses `bulk-enrich-person` with `only_verified_email: true`.

## Safety checkpoint

Before send, the CLI shows a summary and sample contacts, then asks for confirmation. `--dry-run` skips send and the prompt.

## Retry behavior

[`src/utils/retry.ts`](src/utils/retry.ts) wraps individual HTTP calls with exponential backoff.

Retries: 429, 502, 503, 504, network timeouts.

Does not retry: 400, 401, 403, 404, business errors like `NO_RESULTS`.

Per-company search failures are caught in `index.ts` and skipped.

## Project layout

```
src/
├── index.ts              # CLI, stage wiring
├── config/env.ts
├── services/
│   ├── ocean.service.ts
│   ├── prospeo.service.ts
│   └── brevo.service.ts
├── templates/emailTemplate.ts
├── types/index.ts
└── utils/                # retry, dedupe, validate, logger
```

## Smoke tests

```bash
npm run smoke:template
npm run smoke:validate
npm run smoke:config      # needs .env
```

## Notes

- One Prospeo search per company so failures are easy to trace
- Enrich runs in batches of 50
- Brevo sends are sequential with a delay between each
- Error formatting is copied per service file (small project, kept vendors separate)
- No live API tests in CI (costs credits)
- Lookalike quality depends on the seed domain

