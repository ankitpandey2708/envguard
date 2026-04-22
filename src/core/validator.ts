import { loadConfig, type Config, type KeyConfig, type ProviderOverride } from './config.js';
import { getProvider } from './registry.js';
import { httpRequestWithRetry, type HttpRequest } from './httpClient.js';

export type KeyStatus = 'ok' | 'invalid' | 'denied' | 'missing' | 'unknown';

export interface KeyValidationResult {
  envVar: string;
  provider: string;
  status: KeyStatus;
  required: boolean;
  message?: string;
}

export interface ValidationResult {
  ok: boolean;
  passed: KeyValidationResult[];
  failed: KeyValidationResult[];
  warnings: KeyValidationResult[];
}

async function validateKey(
  keyCfg: KeyConfig,
  overrides: ProviderOverride[],
  timeoutMs: number
): Promise<KeyValidationResult> {
  const provider = getProvider(keyCfg.provider, overrides);
  const envValue = process.env[keyCfg.envVar];

  if (!envValue) {
    return { envVar: keyCfg.envVar, provider: provider.displayName, status: 'missing', required: keyCfg.required, message: 'environment variable not set' };
  }

  let req: HttpRequest;
  try {
    req = provider.buildRequest(envValue, keyCfg.options);
  } catch (err) {
    return { envVar: keyCfg.envVar, provider: provider.displayName, status: 'unknown', required: keyCfg.required, message: err instanceof Error ? err.message : String(err) };
  }

  try {
    const res = await httpRequestWithRetry(req, timeoutMs);
    const status = provider.interpretResponse(res.status);
    return {
      envVar: keyCfg.envVar,
      provider: provider.displayName,
      status,
      required: keyCfg.required,
      message: status !== 'ok' ? `provider returned HTTP ${res.status}` : undefined,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      envVar: keyCfg.envVar,
      provider: provider.displayName,
      status: 'unknown',
      required: keyCfg.required,
      message: isTimeout ? `request timed out after ${timeoutMs}ms` : err instanceof Error ? err.message : String(err),
    };
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

export async function validateEnv(config?: Config): Promise<ValidationResult> {
  const cfg = config ?? await loadConfig();
  const { keys, providerOverrides = [], timeoutMs, concurrency, failOnWarning } = cfg;

  for (const key of keys) {
    getProvider(key.provider, providerOverrides);
  }

  const results = await runConcurrent(
    keys.map(key => () => validateKey(key, providerOverrides, timeoutMs)),
    concurrency
  );

  const passed: KeyValidationResult[] = [];
  const failed: KeyValidationResult[] = [];
  const warnings: KeyValidationResult[] = [];

  for (const result of results) {
    if (result.status === 'ok') passed.push(result);
    else if (!result.required && !failOnWarning) warnings.push(result);
    else failed.push(result);
  }

  return { ok: failed.length === 0, passed, failed, warnings };
}
