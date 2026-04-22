# envguard

Validate third-party API keys at deploy time — fail fast before bad keys reach production.

## The Problem

Existing env validation tools (`envalid`, `env-var`, etc.) only check if a key is **present** and **formatted correctly**. They don't verify the key is **actually accepted** by the provider.

A revoked or mis-scoped key looks valid until it hits production and starts returning 401s to real users.

## How It Works

`envguard` pings each provider's cheapest validation endpoint at build/startup time. If any required key returns 401 or 403, the process exits with a non-zero code — blocking the deployment before it goes live.

All calls go **directly to providers**. No envguard cloud service, no secrets sent anywhere else.

## Installation

```bash
npm install envguard --save-dev
```

## Quick Start

**1. Create `envguard.json` in your project root:**

```json
{
  "keys": [
    { "envVar": "OPENAI_API_KEY",    "provider": "openai",    "required": true },
    { "envVar": "ANTHROPIC_API_KEY", "provider": "anthropic", "required": true },
    { "envVar": "STRIPE_SECRET_KEY", "provider": "stripe",    "required": true },
    { "envVar": "GEMINI_API_KEY",    "provider": "gemini",    "required": false }
  ]
}
```

**2. Add to your build:**

```json
{
  "scripts": {
    "build": "envguard validate && next build"
  }
}
```

---

## Commands

### `envguard validate`

Validates all keys defined in the config. This is the only command.

```bash
envguard validate
```

**All flags:**

| Flag | Description |
|---|---|
| `--config <path>` | Path to config file. Default: auto-detects `envguard.json` in project root |
| `--context <name>` | Only validate keys whose `context` field matches this value |
| `--provider <id>` | Only validate keys for this provider (e.g. `openai`, `stripe`) |
| `--strict` | Treat optional key failures as fatal (overrides `failOnWarning: false` in config) |
| `--json` | Print results as JSON instead of human-readable output |
| `--debug` | Print request metadata — URLs, methods, redacted headers (no secrets) |
| `-h`, `--help` | Show help |

---

### Common usage patterns

**Validate everything (default):**
```bash
envguard validate
```

**Block deploy if even optional keys fail:**
```bash
envguard validate --strict
```

**Only check payment keys:**
```bash
envguard validate --context payments
```

**Only check a specific provider:**
```bash
envguard validate --provider stripe
```

**Use a custom config path:**
```bash
envguard validate --config ./config/keys.json
```

**Machine-readable output (for scripts/CI parsing):**
```bash
envguard validate --json
```

**Combine filters:**
```bash
envguard validate --context backend --provider openai --strict
```

**One-off check without installing (via npx):**
```bash
npx envguard validate
```

**Conditional in shell scripts:**
```bash
envguard validate && echo "Keys OK, deploying..." || echo "Key validation failed"
```

---

### Exit codes

| Code | Meaning |
|---|---|
| `0` | All required keys passed |
| `1` | At least one required key failed (missing, invalid, or denied) |
| `2` | Config error or internal error (bad config file, unknown provider, etc.) |

---

### Example output

```
envguard v0.1.0 — validating API keys...

✔ STRIPE_SECRET_KEY (Stripe): OK
✖ OPENAI_API_KEY (OpenAI): INVALID – provider returned HTTP 401
! GEMINI_API_KEY (Google Gemini): MISSING – environment variable not set (optional)

Summary:
  Passed:   1
  Failed:   1
  Warnings: 1

Deployment blocked: 1 required key failed validation.
```

### JSON output (`--json`)

```json
{
  "ok": false,
  "passed": [
    { "envVar": "STRIPE_SECRET_KEY", "provider": "Stripe", "status": "ok", "required": true }
  ],
  "failed": [
    { "envVar": "OPENAI_API_KEY", "provider": "OpenAI", "status": "invalid", "required": true, "message": "provider returned HTTP 401" }
  ],
  "warnings": [
    { "envVar": "GEMINI_API_KEY", "provider": "Google Gemini", "status": "missing", "required": false, "message": "environment variable not set" }
  ]
}
```

---

## Config reference

Auto-detected filenames (in order): `envguard.json`, `envguard.yml`, `envguard.yaml`, `envguard.js`, `envguard.cjs`

```yaml
# envguard.yml
timeoutMs: 4000       # per-request timeout in ms (default: 4000)
concurrency: 5        # max parallel validation requests (default: 5)
failOnWarning: false  # treat optional failures as fatal (default: false)

keys:
  - envVar: OPENAI_API_KEY
    provider: openai
    required: true          # default: true — omit to make required
    context: backend        # optional label, used with --context flag

  - envVar: STRIPE_SECRET_KEY
    provider: stripe
    required: true
    context: payments

  - envVar: TWILIO_AUTH_TOKEN
    provider: twilio
    required: false
    options:
      accountSid: ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX  # or set TWILIO_ACCOUNT_SID env var

  - envVar: MY_CUSTOM_API_KEY
    provider: my-api        # matches an entry in providerOverrides below
    required: true

providerOverrides:
  - id: my-api
    endpoint: https://api.example.com/v1/whoami
    method: GET
    authPlacement: bearer   # bearer | basic | header | query
    successCodes: [200]
    timeoutMs: 3000
    headers:
      X-Client: envguard    # static headers (use {{API_KEY}} to inject the key value)
```

---

## Supported providers

| Provider      | ID          | Validation endpoint               |
|---|---|---|
| OpenAI        | `openai`    | `GET /v1/models`                  |
| Anthropic     | `anthropic` | `POST /v1/messages` (1 token)     |
| Google Gemini | `gemini`    | `GET /v1beta/models`              |
| Stripe        | `stripe`    | `GET /v1/charges?limit=1`         |
| Twilio        | `twilio`    | `GET /2010-04-01/Accounts/{sid}`  |
| Sarvam AI     | `sarvam`    | `POST /translate`                 |
| Custom HTTP   | any string  | configured via `providerOverrides` |

---

## Node API

Use `validateEnv` when you want to run validation programmatically (e.g. at server startup) without calling `process.exit` yourself.

```ts
import { validateEnv } from 'envguard';

// Loads envguard.json automatically
const result = await validateEnv();

if (!result.ok) {
  console.error('Key validation failed:', result.failed);
  process.exit(1);
}
```

```ts
// Pass config directly — no file needed
const result = await validateEnv({
  keys: [
    { envVar: 'OPENAI_API_KEY', provider: 'openai', required: true },
    { envVar: 'STRIPE_SECRET_KEY', provider: 'stripe', required: true },
  ],
  timeoutMs: 5000,
  concurrency: 3,
  failOnWarning: false,
});

console.log(result.passed);   // KeyValidationResult[]
console.log(result.failed);   // KeyValidationResult[]
console.log(result.warnings); // KeyValidationResult[]
```

---

## CI/CD integration

### GitHub Actions

```yaml
- name: Validate API keys
  run: npx envguard validate --strict
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
```

### Vercel

```bash
# Build Command in Vercel dashboard:
npx envguard validate --strict && next build
```

### Render / Railway

```bash
# Build Command:
npx envguard validate --strict && npm run build
```

### Fly.io

```toml
# fly.toml
[deploy]
  release_command = "npx envguard validate --strict"
```

---

## Security

- Secrets are **never logged** — `--debug` prints only URLs, methods, and redacted headers.
- No outbound calls to any envguard service — validation goes directly to each provider.
- Network errors and timeouts mark keys as `unknown`; required keys in that state fail the deployment by default (safe).
- Provider 5xx responses trigger one automatic retry with a 300ms delay before failing.

## License

MIT
