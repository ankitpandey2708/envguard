# TODO : envguard Multi-Environment Support Design

## Problem Statement

API providers typically offer two distinct environments:

| Provider | Production Endpoint | Sandbox/Test Endpoint |
|----------|---------------------|----------------------|
| **Stripe** | `api.stripe.com` | `api.stripe.com` (test mode via key prefix) |
| **OpenAI** | `api.openai.com` | `api.openai.com` (different org keys) |
| **Anthropic** | `api.anthropic.com` | Same, different org |
| **Twilio** | `api.twilio.com` | `api.twilio.com` (Account SID prefix) |
| **Gemini** | `generativelanguage.googleapis.com` | Separate project/key |
| **Sarvam** | `api.sarvam.ai` | Same, different key |

## Current Behavior

envguard hardcodes production endpoints. It only validates **if a key works**, not **which environment it's for**.

```typescript
// stripe.ts - always hits production
buildRequest(envValue) {
  return {
    url: 'https://api.stripe.com/v1/charges?limit=1',
    method: 'GET',
    headers: { Authorization: `Bearer ${envValue}` },
  };
}
```

## The Problem

Teams often have multiple keys across environments:

```
.env.production
  OPENAI_API_KEY=sk-prod-...
  STRIPE_SECRET_KEY=sk_live_...

.env.staging
  OPENAI_API_KEY=sk-staging-...
  STRIPE_SECRET_KEY=sk_live_staging_...

.env.development
  OPENAI_API_KEY=sk-test-...
  STRIPE_SECRET_KEY=sk_test_...
```

**Without explicit distinction:**
1. A test key validated against a production endpoint might succeed (test keys sometimes work on production APIs)
2. A production key validated against sandbox might fail incorrectly
3. There's no way to validate if a key is the right one for the right environment

## Technical Challenges

### 1. Provider Behavior Varies

- **Stripe**: Test keys start with `sk_test_`, live with `sk_live_`. Both hit same endpoint, but responses differ.
- **OpenAI**: Test/org keys vs production/org keys use same endpoint but have different org scopes.
- **Anthropic**: Same endpoint, different org.
- **Some providers** have completely separate sandbox endpoints (rare but exists).

### 2. Provider Endpoint Mapping

Looking at current provider implementations:

| Provider | Current Endpoint | Sandbox Equivalent |
|----------|-----------------|-------------------|
| OpenAI | `api.openai.com/v1/models` | Same endpoint |
| Stripe | `api.stripe.com/v1/charges` | Same endpoint (key prefix differs) |
| Anthropic | `api.anthropic.com/v1/messages` | Same endpoint |
| Twilio | `api.twilio.com` | Same endpoint (Account SID differs) |
| Gemini | `generativelanguage.googleapis.com` | Same endpoint |
| Sarvam | `api.sarvam.ai` | Same endpoint |

**Key insight:** Most providers use the same endpoint for both environments. The distinction comes from:
1. The key format/prefix (Stripe)
2. The key's associated org/project (OpenAI, Anthropic, Gemini)

## Solution Options

### Option A: Mode-based (Recommended for v2)

Add a `mode` field to each key configuration:

```json
{
  keys: [
    { envVar: 'STRIPE_SECRET_KEY', provider: 'stripe', mode: 'production' },
    { envVar: 'STRIPE_TEST_SECRET_KEY', provider: 'stripe', mode: 'sandbox' }
  ]
}
```

**Pros:**
- Explicit, self-documenting
- Provider implementations can use mode to adjust behavior
- Easy to add `--mode` CLI flag for bulk validation

**Cons:**
- Requires updating all providers
- Slightly more config complexity

### Option B: Endpoint Override

Allow custom endpoint URLs per key:

```json
{
  keys: [
    { envVar: 'STRIPE_TEST_SECRET_KEY', provider: 'stripe', endpoint: 'https://api.stripe.com/v1/charges' }
  ]
}
```

**Pros:**
- Maximum flexibility
- Handles providers with truly separate endpoints

**Cons:**
- Users need to know exact endpoint URLs
- Doesn't help with Stripe-style key prefix validation

### Option C: Naming Convention Auto-Detection

Pattern matching on env var names:
- `_TEST`, `_SANDBOX`, `_DEV`, `_STAGING` → sandbox mode
- `_PROD`, `_LIVE` → production mode
- Default → production

**Pros:**
- Zero config changes
- Works out of the box

**Cons:**
- Implicit, can be wrong
- Doesn't work for `STRIPE_SECRET_KEY` vs `STRIPE_LIVE_KEY` ambiguity
- Different teams use different conventions

### Option D: Multiple Config Files

```bash
envguard validate --env production   # uses envguard.production.json
envguard validate --env staging      # uses envguard.staging.json
envguard validate --env sandbox      # uses envguard.sandbox.json
```

**Pros:**
- Clean separation
- CI/CD friendly (different envs have different configs)

**Cons:**
- Duplication of provider configs
- Hard to share common settings

## Recommended Approach for v2

**Implement Option A (mode field) with Option D (multiple configs) as fallback:**

1. Add `mode: 'production' | 'sandbox'` field to key config (default: 'production')
2. Add `--env <name>` CLI flag that loads `envguard.<name>.json` as fallback
3. Update provider specs to accept and validate mode
4. Add strict mode validation for providers that support it (Stripe)

## Provider Implementation Changes

### Interface Update

```typescript
interface ProviderSpec {
  id: string;
  displayName: string;
  buildRequest(envValue: string, mode: 'production' | 'sandbox'): HttpRequest
  interpretResponse(status: number): KeyStatus
  validateKeyFormat?(envValue: string, mode: 'production' | 'sandbox'): boolean
}
```

### Stripe Implementation Example

```typescript
buildRequest(envValue, mode) {
  const isTestKey = envValue.startsWith('sk_test_');
  const isLiveKey = envValue.startsWith('sk_live_');

  if (mode === 'sandbox' && !isTestKey && !isLiveKey) {
    throw new Error('Invalid Stripe key format');
  }
  if (mode === 'sandbox' && isLiveKey) {
    throw new Error('Stripe key appears to be a live key, not a test key');
  }
  if (mode === 'production' && isTestKey) {
    throw new Error('Stripe key appears to be a test key, not a live key');
  }

  return {
    url: 'https://api.stripe.com/v1/charges?limit=1',
    method: 'GET',
    headers: { Authorization: `Bearer ${envValue}` },
  };
}
```

### OpenAI Implementation Example

```typescript
buildRequest(envValue, mode) {
  // OpenAI uses same endpoint but validates key org
  return {
    url: 'https://api.openai.com/v1/models',
    method: 'GET',
    headers: { Authorization: `Bearer ${envValue}` },
  };
}

validateKeyFormat(envValue, mode) {
  // Could check for org- prefix or sk- prefix patterns
  // For now, let the API response determine validity
  return true;
}
```

## Config Schema Update

```typescript
const KeyConfigSchema = z.object({
  envVar: z.string().min(1, 'envVar must not be empty'),
  provider: z.string().min(1, 'provider must not be empty'),
  required: z.boolean().default(true),
  mode: z.enum(['production', 'sandbox']).default('production'),  // NEW
});
```

## CLI Changes

```bash
# Check only production keys
envguard validate --mode production

# Check only sandbox keys
envguard validate --mode sandbox

# Use different config file
envguard validate --env staging
envguard validate --config envguard.staging.json

# Combined
envguard validate --env staging --mode sandbox
```

## Migration Path

**Backward Compatibility:**
- Old config files still work, defaulting to `mode: 'production'`
- No breaking changes to existing users

**Example migration:**

```json
// Old config - still works, defaults to production
{
  keys: [
    { envVar: 'STRIPE_SECRET_KEY', provider: 'stripe' }
  ]
}

// New config - explicit mode
{
  keys: [
    { envVar: 'STRIPE_SECRET_KEY', provider: 'stripe', mode: 'production' },
    { envVar: 'STRIPE_TEST_SECRET_KEY', provider: 'stripe', mode: 'sandbox' }
  ]
}
```

## Implementation Effort

| Component | Changes Needed | Complexity |
|-----------|----------------|------------|
| `config.ts` | Add `mode` to KeyConfigSchema | Low |
| `registry.ts` | Update ProviderSpec interface | Low |
| Provider specs | Update `buildRequest` signature and add `validateKeyFormat` | Medium |
| `validator.ts` | Pass mode to provider methods | Low |
| Stripe provider | Add key prefix validation based on mode | Medium |
| CLI | Add `--mode` and `--env` flags | Medium |
| Documentation | Update README with new config options | Low |

## Future Considerations

1. **Strict validation mode**: Add a flag `--strict` that enforces key format validation, not just API validity
2. **Auto-detection enhancement**: LLM could suggest `mode` based on key patterns
3. **Environment-specific providers**: Some enterprise setups have completely separate API endpoints per environment
4. **Key rotation warnings**: Detect keys that haven't been validated in X days

## Status Meanings Extension

| Status | What it means |
|--------|---------------|
| OK | Key is valid for the specified mode |
| INVALID | Key rejected (revoked, wrong scope, or wrong mode for key type) |
| MODE_MISMATCH | Key format doesn't match specified mode (e.g., live key in sandbox mode) |
| MISSING | Environment variable not set |
| UNKNOWN | Network error or provider issue |

## Related Issues

- Multi-environment CI/CD pipelines need different validation per stage
- Teams want to validate staging keys before deploying to staging
- Production validation should fail if a sandbox key is accidentally used