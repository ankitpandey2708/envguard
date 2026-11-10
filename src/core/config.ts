import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface KeyConfig {
  envVar: string;
  provider: string;
  /** Default: true */
  required: boolean;
}

export interface Config {
  keys: KeyConfig[];
  /** Max provider requests in flight at once. Default: DEFAULT_CONCURRENCY */
  concurrency: number;
}

export const DEFAULT_CONCURRENCY = 10;

/** What callers may pass in: like `Config`, but defaulted fields are optional. */
export interface ConfigInput {
  keys: Array<Pick<KeyConfig, 'envVar' | 'provider'> & Partial<Pick<KeyConfig, 'required'>>>;
  concurrency?: number;
}

const DEFAULT_CONFIG_FILENAME = 'envguard.json';

export const MANUAL_CONFIG_HINT =
  'Create envguard.json manually: https://github.com/ankitpandey2708/envguard#quick-start';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export async function loadConfig(configPath?: string): Promise<Config> {
  let rawPath: string;

  if (configPath) {
    rawPath = resolve(process.cwd(), configPath);
    if (!existsSync(rawPath)) {
      throw new ConfigError(`Config file not found: ${rawPath}`);
    }
  } else {
    const defaultPath = resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);
    if (!existsSync(defaultPath)) {
      throw new ConfigError(
        `No config file found. \n` +
        `Run 'npx envguard init --api-key <openrouter_key>' to auto-generate,\n` +
        `or ${MANUAL_CONFIG_HINT}`
      );
    }
    rawPath = defaultPath;
  }

  return parseConfigFile(rawPath);
}

function parseConfigFile(filePath: string): Config {
  if (!filePath.endsWith('.json')) {
    throw new ConfigError(`Unsupported config file extension: ${filePath} (only .json is supported)`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (e) {
    throw new ConfigError(`Failed to parse JSON config: ${(e as Error).message}`);
  }

  return validateConfig(raw);
}

// ---- schema validation (hand-rolled: a schema library cost ~150ms startup and 6MB install) ----

interface Issue { path: string; message: string }

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  return typeof v;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeName(v) === 'object';
const expected = (type: string, v: unknown) => `Invalid input: expected ${type}, received ${typeName(v)}`;

function checkNonEmptyString(v: unknown, path: string, field: string, issues: Issue[]): string {
  if (typeof v !== 'string') issues.push({ path, message: expected('string', v) });
  else if (v.length === 0) issues.push({ path, message: `${field} must not be empty` });
  return v as string;
}

function parseKey(v: unknown, path: string, issues: Issue[]): KeyConfig {
  if (!isObject(v)) {
    issues.push({ path, message: expected('object', v) });
    return undefined as never;
  }
  const envVar = checkNonEmptyString(v.envVar, `${path}.envVar`, 'envVar', issues);
  const provider = checkNonEmptyString(v.provider, `${path}.provider`, 'provider', issues);
  let required = true;
  if (v.required !== undefined) {
    if (typeof v.required !== 'boolean') issues.push({ path: `${path}.required`, message: expected('boolean', v.required) });
    required = v.required as boolean;
  }
  return { envVar, provider, required };
}

function parseConfig(raw: unknown, issues: Issue[]): Config {
  if (!isObject(raw)) {
    issues.push({ path: '(root)', message: expected('object', raw) });
    return undefined as never;
  }

  let keys: KeyConfig[] = [];
  if (!Array.isArray(raw.keys)) issues.push({ path: 'keys', message: expected('array', raw.keys) });
  else if (raw.keys.length === 0) issues.push({ path: 'keys', message: 'at least one key must be configured' });
  else keys = raw.keys.map((k, i) => parseKey(k, `keys.${i}`, issues));

  let concurrency = DEFAULT_CONCURRENCY;
  const c = raw.concurrency;
  if (c !== undefined) {
    if (typeof c !== 'number' || !Number.isFinite(c)) issues.push({ path: 'concurrency', message: expected('number', c) });
    else if (!Number.isInteger(c)) issues.push({ path: 'concurrency', message: expected('int', c) });
    else if (c <= 0) issues.push({ path: 'concurrency', message: 'Too small: expected number to be >0' });
    concurrency = c as number;
  }

  // Unknown fields are dropped, so the returned object only ever has the documented shape.
  return { keys, concurrency };
}

export function validateConfig(raw: unknown): Config {
  const issues: Issue[] = [];
  const config = parseConfig(raw, issues);
  if (issues.length > 0) {
    throw new ConfigError(`Invalid config:\n${issues.map(e => `  - ${e.path}: ${e.message}`).join('\n')}`);
  }

  const seen = new Set<string>();
  for (const key of config.keys) {
    if (seen.has(key.envVar)) {
      throw new ConfigError(`Duplicate envVar in config: ${key.envVar}`);
    }
    seen.add(key.envVar);
  }

  return config;
}
