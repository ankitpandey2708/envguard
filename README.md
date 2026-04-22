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

The `postinstall` hook automatically adds `envguard validate` to your build script.

Requires Node.js 20+.

## Usage

**From terminal:** (use `npx`)

```bash
npx envguard validate  # test keys
npx envguard init     # generate config
```

**In package.json scripts:**

```json
{
  "scripts": {
    "build": "envguard validate && next build"
  }
}
```

## Quick start

### Option 1: Auto-detect your keys

```bash
npx envguard init
```

This scans your `.env` files, detects API keys, and creates `envguard.json` for you.

**Example output:**
```
Found 3 API key(s):
  OPENAI_API_KEY → openai
  STRIPE_SECRET_KEY → stripe
  ANTHROPIC_API_KEY → anthropic

Created envguard.json
Run 'npx envguard validate' to test your keys.
```

You'll need an OpenRouter API key for the detection (free). Get one at https://openrouter.ai/keys, then set it via `--api-key` flag or `OPENROUTER_API_KEY` environment variable.

### Option 2: Create config manually

Create `envguard.json` in your project root:

```json
{
  "keys": [
    { "envVar": "OPENAI_API_KEY", "provider": "openai" },
    { "envVar": "STRIPE_SECRET_KEY", "provider": "stripe" },
    { "envVar": "TWILIO_AUTH_TOKEN", "provider": "twilio", "required": false }
  ]
}
```

### Add to your build

In `package.json` scripts:
```json
{
  "scripts": {
    "build": "envguard validate && next build"
  }
}
```

## Commands

| Command | Description |
|---|---|
| `validate` | Validate API keys (default) |
| `init` | Scan `.env` files and generate `envguard.json` |

```bash
envguard validate  # validate keys (default)
envguard init      # generate config
```

The `postinstall` hook automatically adds `envguard validate` to your build script.

### `envguard validate`

Checks all configured keys.

```bash
envguard validate
```

**Output:**
```
✔ STRIPE_SECRET_KEY: OK
✖ OPENAI_API_KEY: INVALID
! GEMINI_API_KEY: MISSING (optional)

Deployment blocked: 1 required key failed.
```

### `envguard init`

Scans `.env` files and creates `envguard.json`:

```bash
envguard init
```

Requires an OpenRouter API key (free at https://openrouter.ai/keys).

### Flags

| Flag | Description |
|---|---|
| `--config <path>` | Use a different config file |
| `--provider <id>` | Check only one provider |
| `--json` | JSON output (for scripts) |
| `--debug` | Show which endpoints are called |
| `-h` | Show help |

### Examples

```bash
# Check all keys
envguard validate

# Check one provider
envguard validate --provider stripe

# JSON output for CI
envguard validate --json

# Shell scripting
envguard validate && echo Ready to deploy

# Auto-generate config
envguard init
```

### Exit codes

- `0` — All required keys valid
- `1` — Validation failed
- `2` — Config error

### JSON output

Use `--json` for machine-readable output in scripts:

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

## Supported providers

| Provider | ID |
|---|---|
| OpenAI | `openai` |
| Anthropic | `anthropic` |
| Google Gemini | `gemini` |
| Stripe | `stripe` |
| Twilio | `twilio` |
| Sarvam AI | `sarvam` |

All providers work with just the API key. Twilio requires additional configuration:

### Twilio setup

Twilio requires your Account SID. Set the `TWILIO_ACCOUNT_SID` environment variable:

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Config file

Create `envguard.json` in your project root.

```json
{
  "concurrency": 5,
  "keys": [
    { "envVar": "OPENAI_API_KEY", "provider": "openai" },
    { "envVar": "STRIPE_SECRET_KEY", "provider": "stripe" },
    { "envVar": "ANTHROPIC_API_KEY", "provider": "anthropic", "required": false }
  ]
}
```

**Options:**
- `concurrency` — How many checks to run in parallel (default: 5)
- `keys[].envVar` — Environment variable name
- `keys[].provider` — Provider ID from the table above
- `keys[].required` — Whether to block deployment if key fails (default: true)

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

Set as your Build Command:
```
envguard validate && next build
```

### Render / Railway

Build Command:
```
envguard validate && npm run build
```

### Fly.io

In `fly.toml`:
```toml
[deploy]
  release_command = envguard validate
```

## Use in code

Import envguard in your application:

```typescript
import { validateEnv } from 'envguard';

const result = await validateEnv();

if (!result.ok) {
  console.error('Key validation failed:', result.failed);
  process.exit(1);
}
```

Or pass config directly:

```typescript
const result = await validateEnv({
  keys: [
    { envVar: 'OPENAI_API_KEY', provider: 'openai' },
    { envVar: 'STRIPE_SECRET_KEY', provider: 'stripe' }
  ]
});
```

## Status meanings

| Status | What it means |
|---|---|
| OK | Key is valid and working |
| INVALID | Key was rejected (revoked, wrong scope) |
| MISSING | Environment variable not set |
| UNKNOWN | Network error or provider issue |

## Troubleshooting

**Key shows INVALID**
- Check if the key was revoked or regenerated
- Verify the key has the correct permissions/scopes

**Key shows UNKNOWN**
- Network issue or provider is down
- Try again or check your firewall

**Config not found**
- Ensure `envguard.json` exists in your project root
- Use `--config` to specify a different path

## Security

- Your API keys are never logged or sent anywhere except the respective provider
- `--debug` shows URLs and methods but no secrets
- No external service calls — all validation goes directly to providers

## License

MIT