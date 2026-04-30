[![npm version](https://img.shields.io/npm/v/@ankitpandey2708/envguard)](https://www.npmjs.com/package/@ankitpandey2708/envguard)
[![npm downloads](https://img.shields.io/npm/dm/@ankitpandey2708/envguard)](https://www.npmjs.com/package/@ankitpandey2708/envguard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/ankitpandey2708/envguard)

# envguard — API Key Validator for CI/CD Deployments

**envguard** is a Node.js CLI and library that validates third-party API keys at deploy time. It makes a live request to each provider and fails your build immediately if a key is revoked, missing, or has the wrong permissions — before bad keys ever reach production.

## Why envguard?

Most tools only check if an API key *exists*. They can't tell you if the key is actually valid.

```
✓ Key exists          ← dotenv, envalid, t3-env stop here
✗ Key is revoked      ← envguard catches this
✗ Key has wrong scope ← envguard catches this
```

| Feature | envguard | envalid | t3-env | dotenv-safe |
|---|---|---|---|---|
| Checks key actually works | ✅ | ❌ | ❌ | ❌ |
| Detects revoked keys | ✅ | ❌ | ❌ | ❌ |
| Detects wrong permissions | ✅ | ❌ | ❌ | ❌ |
| Auto-detect keys from .env | ✅ | ❌ | ❌ | ❌ |
| CLI + programmatic API | ✅ | ❌ | ❌ | ❌ |
| CI/CD integration | ✅ | ✅ | ✅ | ✅ |
| TypeScript types | ✅ | ✅ | ✅ | ❌ |

## Getting Started

### 1. Install

```bash
npm install @ankitpandey2708/envguard --save-dev
```

A `postinstall` hook automatically adds `envguard validate` to your build script.

### 2. Generate config

```bash
npx envguard init --api-key YOUR_OPENROUTER_API_KEY
```

Scans `.env` files, detects API keys via AI, and writes `envguard.json`. Requires a free OpenRouter key from https://openrouter.ai/keys.

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

### 3. Validate

```bash
envguard validate
```

```
✔ STRIPE_SECRET_KEY (Stripe): OK
✖ OPENAI_API_KEY (OpenAI): INVALID
! GEMINI_API_KEY (Google Gemini): MISSING (optional)

Deployment blocked: 1 required key failed.
```

## CLI Reference

### `envguard init`

Scans `.env` files and generates or updates `envguard.json`.

| Flag | Description |
|---|---|
| `--api-key <key>` | OpenRouter API key (or set `OPENROUTER_API_KEY`) |
| `--model <id>` | OpenRouter model (or set `OPENROUTER_MODEL`; default: `openrouter/free`) |
| `--config <path>` | Write config to a custom path |

### `envguard validate`

Validates all keys in `envguard.json` against their live provider APIs.

| Flag | Description |
|---|---|
| `--config <path>` | Use a different config file |
| `--provider <id>` | Check only one provider |
| `--fail-fast` | Stop after first required key failure |
| `--json` | Machine-readable JSON output |
| `-h, --help` | Show help |

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | All required keys valid |
| 1 | Validation failed |
| 2 | Config or internal error |

**Status meanings:**

| Status | Meaning |
|---|---|
| OK | Key is valid and working |
| INVALID | Key was rejected (revoked or wrong scope) |
| MISSING | Environment variable not set |
| DENIED | Key lacks required permissions |
| UNKNOWN | Network error or provider issue |

**JSON output:**

```bash
envguard validate --json
```

```json
{
  "ok": false,
  "passed": [
    { "envVar": "STRIPE_SECRET_KEY", "provider": "Stripe", "status": "ok", "required": true }
  ],
  "failed": [
    { "envVar": "OPENAI_API_KEY", "provider": "OpenAI", "status": "invalid", "required": true }
  ],
  "warnings": []
}
```

## Config Reference

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
| `keys[].provider` | Provider ID (see table below) | — |
| `keys[].required` | Block deployment if key fails | `true` |

## Supported Providers

| Provider | ID | Env var validated |
|---|---|---|
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| Google Gemini | `gemini` | `GEMINI_API_KEY` |
| Stripe | `stripe` | `STRIPE_SECRET_KEY` |
| Twilio | `twilio` | `TWILIO_AUTH_TOKEN` + `TWILIO_ACCOUNT_SID` |
| Groq | `groq` | `GROQ_API_KEY` |
| Mistral | `mistral` | `MISTRAL_API_KEY` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` |
| Together AI | `togetherai` | `TOGETHER_API_KEY` |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` |
| NVIDIA NIM | `nvidia` | `NVIDIA_API_KEY` |
| Sarvam AI | `sarvam` | `SARVAM_API_KEY` |
| PostHog | `posthog` | `POSTHOG_PERSONAL_API_KEY` |
| Resend | `resend` | `RESEND_API_KEY` |
| Loops | `loops` | `LOOPS_API_KEY` |
| Clerk | `clerk` | `CLERK_SECRET_KEY` |
| Fingerprint | `fingerprint` | `FINGERPRINT_SECRET_KEY` |

More providers coming. [Open an issue](https://github.com/ankitpandey2708/envguard/issues) to request one.

## CI/CD Integration

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

// Pass config directly
const result = await validateEnv({
  keys: [
    { envVar: 'OPENAI_API_KEY', provider: 'openai' },
    { envVar: 'STRIPE_SECRET_KEY', provider: 'stripe' }
  ]
});

// Stop as soon as the first required key fails
const result = await validateEnv(config, { failFast: true });

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
