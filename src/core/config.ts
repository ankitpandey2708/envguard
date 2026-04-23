import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const KeyConfigSchema = z.object({
  envVar: z.string().min(1, 'envVar must not be empty'),
  provider: z.string().min(1, 'provider must not be empty'),
  required: z.boolean().default(true),
});

const ConfigSchema = z.object({
  keys: z.array(KeyConfigSchema).min(1, 'at least one key must be configured'),
  concurrency: z.number().int().positive().default(5),
});

export type KeyConfig = z.infer<typeof KeyConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

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
