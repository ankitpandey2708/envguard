import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const KeyConfigSchema = z.object({
  envVar: z.string().min(1, 'envVar must not be empty'),
  provider: z.string().min(1, 'provider must not be empty'),
  required: z.boolean().default(true),
  context: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

const ProviderOverrideSchema = z.object({
  id: z.string().min(1),
  endpoint: z.string().url('endpoint must be a valid URL'),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  successCodes: z.array(z.number().int()).default([200, 201, 204]),
  authPlacement: z.enum(['header', 'query', 'bearer', 'basic']).optional(),
  timeoutMs: z.number().positive().optional(),
});

const ConfigSchema = z.object({
  keys: z.array(KeyConfigSchema).min(1, 'at least one key must be configured'),
  providerOverrides: z.array(ProviderOverrideSchema).optional(),
  timeoutMs: z.number().positive().default(4000),
  concurrency: z.number().int().positive().default(5),
  failOnWarning: z.boolean().default(false),
});

export type KeyConfig = z.infer<typeof KeyConfigSchema>;
export type ProviderOverride = z.infer<typeof ProviderOverrideSchema>;
export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_CANDIDATES = [
  'envguard.json',
  'envguard.yml',
  'envguard.yaml',
  'envguard.js',
  'envguard.cjs',
];

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
    const found = CONFIG_CANDIDATES.find(name =>
      existsSync(resolve(process.cwd(), name))
    );
    if (!found) {
      throw new ConfigError(
        `No config file found. Create one of: ${CONFIG_CANDIDATES.join(', ')}`
      );
    }
    rawPath = resolve(process.cwd(), found);
  }

  return parseConfigFile(rawPath);
}

async function parseConfigFile(filePath: string): Promise<Config> {
  let raw: unknown;

  if (filePath.endsWith('.json')) {
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (e) {
      throw new ConfigError(`Failed to parse JSON config: ${(e as Error).message}`);
    }
  } else if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
    try {
      raw = parseYaml(readFileSync(filePath, 'utf-8'));
    } catch (e) {
      throw new ConfigError(`Failed to parse YAML config: ${(e as Error).message}`);
    }
  } else if (filePath.endsWith('.js') || filePath.endsWith('.cjs')) {
    try {
      const mod = await import(pathToFileURL(filePath).href) as { default?: unknown };
      raw = mod.default ?? mod;
    } catch (e) {
      throw new ConfigError(`Failed to load JS config: ${(e as Error).message}`);
    }
  } else {
    throw new ConfigError(`Unsupported config file extension: ${filePath}`);
  }

  return validateConfig(raw);
}

export function validateConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues
      .map(e => `  - ${e.path.join('.') || '(root)'}: ${e.message}`)
      .join('\n');
    throw new ConfigError(`Invalid config:\n${errors}`);
  }

  const seen = new Set<string>();
  for (const key of result.data.keys) {
    if (seen.has(key.envVar)) {
      throw new ConfigError(`Duplicate envVar in config: ${key.envVar}`);
    }
    seen.add(key.envVar);
  }

  return result.data;
}
