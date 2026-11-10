import { loadConfig, type Config, type KeyConfig } from './config.js';
import { loadProvidersByIds, listProvidersSync, type ProviderSpec } from './registry.js';
import { httpRequest, HTTP_TIMEOUT_MS, type HttpRequest } from './httpClient.js';

/** Coarse, stable status. Kept for backwards compatibility — see `KeyReason` for the precise cause. */
export type KeyStatus = 'ok' | 'invalid' | 'denied' | 'missing' | 'unknown';

/**
 * Terminal state of one key's validation lifecycle.
 *
 *   pending ─┬─ skipped_fail_fast                      (another required key already failed)
 *            ├─ env_not_set                             (env var empty/unset)
 *            ├─ request_build_failed                    (provider misconfigured, e.g. Twilio without SID)
 *            └─ in_flight ─┬─ http_ok / http_invalid / http_denied / http_unexpected
 *                          ├─ timeout
 *                          ├─ aborted_fail_fast
 *                          └─ network_error
 *
 * Each reason maps to exactly one `KeyStatus` (see REASON_STATUS).
 */
export type KeyReason =
  | 'http_ok'
  | 'http_invalid'
  | 'http_denied'
  | 'http_unexpected'
  | 'env_not_set'
  | 'request_build_failed'
  | 'timeout'
  | 'network_error'
  | 'skipped_fail_fast';

const REASON_STATUS: Record<KeyReason, KeyStatus> = {
  http_ok: 'ok',
  http_invalid: 'invalid',
  http_denied: 'denied',
  http_unexpected: 'unknown',
  env_not_set: 'missing',
  request_build_failed: 'unknown',
  timeout: 'unknown',
  network_error: 'unknown',
  skipped_fail_fast: 'unknown',
};

const HTTP_REASON: Record<Exclude<KeyStatus, 'missing'>, KeyReason> = {
  ok: 'http_ok',
  invalid: 'http_invalid',
  denied: 'http_denied',
  unknown: 'http_unexpected',
};

/** Statuses that definitively prove a required key is bad (these trigger --fail-fast). */
const DEFINITIVE_FAILURES: ReadonlySet<KeyStatus> = new Set(['invalid', 'denied', 'missing']);

export interface KeyValidationResult {
  envVar: string;
  provider: string;
  status: KeyStatus;
  /** Precise cause behind `status`. Always set by `validateEnv`. */
  reason?: KeyReason;
  required: boolean;
  message?: string;
}

/** Which bucket of `ValidationResult` a key lands in. */
export type KeyOutcome = 'passed' | 'failed' | 'warning';

export function keyOutcome(result: Pick<KeyValidationResult, 'status' | 'required'>): KeyOutcome {
  if (result.status === 'ok') return 'passed';
  return result.required ? 'failed' : 'warning';
}

export interface ValidationResult {
  ok: boolean;
  passed: KeyValidationResult[];
  failed: KeyValidationResult[];
  warnings: KeyValidationResult[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function settle(keyCfg: KeyConfig, provider: ProviderSpec, reason: KeyReason, message?: string): KeyValidationResult {
  return {
    envVar: keyCfg.envVar,
    provider: provider.displayName,
    status: REASON_STATUS[reason],
    reason,
    required: keyCfg.required,
    ...(message !== undefined && { message }),
  };
}

async function validateKey(
  keyCfg: KeyConfig,
  provider: ProviderSpec,
  failFast: AbortSignal,
): Promise<KeyValidationResult> {
  const envValue = process.env[keyCfg.envVar];
  if (!envValue) return settle(keyCfg, provider, 'env_not_set', 'environment variable not set');

  let req: HttpRequest;
  try {
    req = provider.buildRequest(envValue);
  } catch (err) {
    return settle(keyCfg, provider, 'request_build_failed', errorMessage(err));
  }

  try {
    const res = await httpRequest(req, failFast);
    const reason = HTTP_REASON[provider.interpretResponse(res.status)];
    return settle(keyCfg, provider, reason, reason === 'http_ok' ? undefined : `provider returned HTTP ${res.status}`);
  } catch (err) {
    if (failFast.aborted) return settle(keyCfg, provider, 'skipped_fail_fast', 'skipped (fail-fast)');
    if (err instanceof Error && err.name === 'TimeoutError') {
      return settle(keyCfg, provider, 'timeout', `request timed out after ${HTTP_TIMEOUT_MS / 1000}s`);
    }
    return settle(keyCfg, provider, 'network_error', errorMessage(err));
  }
}

async function runConcurrent<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  const pool = tasks.map((fn, i) => ({ fn, i }));

  async function worker() {
    while (pool.length > 0) {
      const item = pool.shift()!;
      results[item.i] = await item.fn();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export async function validateEnv(config?: Config, options?: { failFast?: boolean }): Promise<ValidationResult> {
  const cfg = config ?? await loadConfig();
  const { keys, concurrency } = cfg;

  const neededIds = [...new Set(keys.map(k => k.provider))];
  const providerMap = await loadProvidersByIds(neededIds);

  // Validate all providers exist — unregistered providers in config are a hard error
  for (const key of keys) {
    if (!providerMap[key.provider]) {
      const available = listProvidersSync();
      throw new Error(
        `Config references unregistered provider "${key.provider}" — cannot validate.\n` +
        `Registered providers: ${available.join(', ') || '(none)'}.\n` +
        `Remove the key from envguard.json or add a provider plugin.`
      );
    }
  }

  // Run state: `running` until a required key fails definitively under --fail-fast,
  // then `aborting` (signal.aborted): pending keys are skipped, in-flight requests cancelled.
  const failFast = new AbortController();

  const results = await runConcurrent(
    keys.map(key => async () => {
      const provider = providerMap[key.provider];
      if (failFast.signal.aborted) return settle(key, provider, 'skipped_fail_fast', 'skipped (fail-fast)');

      const result = await validateKey(key, provider, failFast.signal);
      if (options?.failFast && key.required && DEFINITIVE_FAILURES.has(result.status)) {
        failFast.abort();
      }
      return result;
    }),
    concurrency
  );

  const buckets: Record<KeyOutcome, KeyValidationResult[]> = { passed: [], failed: [], warning: [] };
  for (const result of results) buckets[keyOutcome(result)].push(result);

  return { ok: buckets.failed.length === 0, passed: buckets.passed, failed: buckets.failed, warnings: buckets.warning };
}
