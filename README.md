# envguard

Validate API keys before deployment — catch revoked or misconfigured keys before they break production.

## Why envguard?

Most tools only check if an API key *exists*. They can't tell you if the key is actually valid.

```
✓ Key exists          ← Most tools stop here
✗ Key is revoked      ← envguard catches this
✗ Key has wrong scope ← envguard catches this
```

envguard makes a lightweight request to each provider's API. If the key is rejected, your build fails immediately — not when it hits production.

## Install

```bash
npm install @ankitpandey2708/envguard --save-dev
```

A `postinstall` hook automatically adds `envguard validate` to your build script.

## Setup

Choose one of two ways to create `envguard.json`:

### Auto-detect (recommended)

```bash
npx envguard init --api-key YOUR_OPENROUTER_API_KEY
```

Scans `.env` files, detects API keys via AI, and generates the config. Requires a free OpenRouter key from https://openrouter.ai/keys.

Optionally specify a model (defaults to `openrouter/free`):

```bash
npx envguard init --api-key YOUR_OPENROUTER_API_KEY --model google/gemini-2.0-flash-001
```

Or set `OPENROUTER_MODEL` in your environment.

On re-run, only *new* env vars are sent to the LLM — already-configured keys are skipped.

**First run:**
```
Found 3 API key(s):
  OPENAI_API_KEY → openai
  STRIPE_SECRET_KEY → stripe
  ANTHROPIC_API_KEY → anthropic

Created envguard.json
```

**Re-run (nothing changed):**
```
No new env vars to add — envguard.json is up to date.
```

### Manual

Create `envguard.json` in your project root — see [Config reference](#config-reference) for the full schema.

## Validate

```bash
envguard validate                # check all keys
envguard validate --provider stripe  # check one provider
envguard validate --json        # machine-readable output
```

**Output:**

```
✔ STRIPE_SECRET_KEY (stripe): OK
✖ OPENAI_API_KEY (openai): INVALID
! GEMINI_API_KEY (gemini): MISSING (optional)

Deployment blocked: 1 required key failed.
```

### Status meanings

| Status | Meaning |
|---|---|
| OK | Key is valid and working |
| INVALID | Key was rejected (revoked, wrong scope) |
| MISSING | Environment variable not set |
| DENIED | Key lacks required permissions |
| UNKNOWN | Network error or provider issue |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | All required keys valid |
| 1 | Validation failed |
| 2 | Config error |

### Flags

| Flag | Description |
|---|---|
| `--config <path>` | Use a different config file |
| `--provider <id>` | Check only one provider |
| `--api-key <key>` | OpenRouter API key for `init` (or set `OPENROUTER_API_KEY`) |
| `--model <id>` | OpenRouter model for `init` (or set `OPENROUTER_MODEL`; default: `openrouter/free`) |
| `--json` | JSON output for scripts/CI — see [JSON output](#json-output) |
| `-h` | Show help |

### JSON output

Use `--json` for machine-readable output in CI pipelines:

```bash
envguard validate --json
```

```json
{
  "ok": false,
  "passed": [
    { "envVar": "STRIPE_SECRET_KEY", "provider": "stripe", "status": "ok", "required": true }
  ],
  "failed": [
    { "envVar": "OPENAI_API_KEY", "provider": "openai", "status": "invalid", "required": true }
  ],
  "warnings": []
}
```

## Config reference

`envguard.json` schema:

```json
{
  "concurrency": 5,
  "keys": [
    { "envVar": "OPENAI_API_KEY", "provider": "openai" },
    { "envVar": "STRIPE_SECRET_KEY", "provider": "stripe" },
    { "envVar": "TWILIO_AUTH_TOKEN", "provider": "twilio", "required": false }
  ]
}
```

| Field | Description | Default |
|---|---|---|
| `concurrency` | Parallel checks to run | 5 |
| `keys[].envVar` | Environment variable name | — |
| `keys[].provider` | Provider ID from table below | — |
| `keys[].required` | Block deployment if key fails | true |

## Supported providers

| Provider | ID | Notes |
|---|---|---|
| OpenAI | `openai` | — |
| Anthropic | `anthropic` | — |
| Google Gemini | `gemini` | — |
| Stripe | `stripe` | — |
| Twilio | `twilio` | Requires `TWILIO_ACCOUNT_SID` env var |
| Sarvam AI | `sarvam` | — |

## CI/CD

### GitHub Actions

```yaml
- name: Validate API keys
  run: envguard validate
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
```

### Vercel

Set as Build Command:
```
envguard validate && next build
```

### Render / Railway

Build Command:
```
envguard validate && npm run build
```

### Fly.io

```toml
[deploy]
  release_command = envguard validate
```

## Programmatic API

```typescript
import { validateEnv } from '@ankitpandey2708/envguard';

// Uses envguard.json auto-detected from cwd
const result = await validateEnv();

// Or pass config directly
const result = await validateEnv({
  keys: [
    { envVar: 'OPENAI_API_KEY', provider: 'openai' },
    { envVar: 'STRIPE_SECRET_KEY', provider: 'stripe' }
  ]
});

if (!result.ok) {
  console.error('Key validation failed:', result.failed);
  process.exit(1);
}
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Key shows INVALID | Key was revoked or regenerated, or has wrong permissions |
| Key shows UNKNOWN | Network issue or provider is down — try again |
| Config not found | Ensure `envguard.json` exists, or use `--config` for a custom path |

## Security

- API keys are never logged or sent anywhere except the respective provider
- All validation goes directly to providers — no intermediary service

## License

MIT
