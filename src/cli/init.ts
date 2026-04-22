import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeEnvVarsWithLLM, type ProviderSuggestion } from '../core/llm.js';
import { validateConfig, type Config, MANUAL_CONFIG_HINT } from '../core/config.js';

type InitStatus = 'created' | 'updated' | 'skipped';

interface InitResult {
  matched: ProviderSuggestion[];
  unregistered: ProviderSuggestion[];
  unmatched: string[];
  status: InitStatus;
}

// Env file patterns to scan (production-only)
const ENV_FILE_PATTERNS = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.prod',
];

function scanEnvFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of ENV_FILE_PATTERNS) {
    const path = resolve(dir, name);
    if (existsSync(path)) {
      found.push(path);
    }
  }
  return found;
}

function parseEnvFile(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const envVars: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) {
      envVars.push(match[1]);
    }
  }

  return envVars;
}

function getAllEnvVars(dir: string): Set<string> {
  const envFiles = scanEnvFiles(dir);
  const allEnvVars = new Set<string>();
  for (const file of envFiles) {
    const vars = parseEnvFile(file);
    for (const v of vars) {
      allEnvVars.add(v);
    }
  }
  return allEnvVars;
}

// Build error message when no registered API keys were found
// manualHint is only shown when envguard.json doesn't exist yet (first-run scenario)
function buildNoKeysError(
  envFiles: string[],
  unregistered: ProviderSuggestion[],
  unmatched: string[],
  manualHint: boolean
): Error {
  const hint = manualHint ? `\n${MANUAL_CONFIG_HINT}` : '';
  if (unregistered.length > 0) {
    const uniqueProviders = [...new Set(unregistered.map(s => s.provider!))];
    const total = unregistered.length + unmatched.length;
    return new Error(
      `No registered API keys detected in ${envFiles.join(', ')}.\n` +
      `Total: ${total} var(s) — ${unregistered.length} unregistered API key(s) across ${uniqueProviders.length} provider(s), ${unmatched.length} non-API var(s)\n` +
      `Unregistered provider(s): ${uniqueProviders.join(', ')}\n` +
      `Unregistered key(s): ${unregistered.map(s => s.envVar).join(', ')}\n` +
      `Non-API var(s): ${unmatched.join(', ')}${hint}`
    );
  }
  return new Error(
    `No API keys detected in ${envFiles.join(', ')}.\n` +
    `Total: ${unmatched.length} var(s) — all are non-API vars\n` +
    `Vars: ${unmatched.join(', ')}${hint}`
  );
}

// Get current env vars from config
function getConfigEnvVars(config: Config): Set<string> {
  return new Set(config.keys.map(k => k.envVar));
}

// Find new env vars not in config
function findNewEnvVars(envVars: Set<string>, config: Config): string[] {
  const configVars = getConfigEnvVars(config);
  return [...envVars].filter(v => !configVars.has(v));
}

export async function initEnvguard(
  dir: string,
  apiKey?: string,
  outputPath?: string,
  model?: string,
): Promise<InitResult> {
  const targetDir = dir || process.cwd();
  const outPath = outputPath || resolve(targetDir, 'envguard.json');

  // Get all env vars from .env files
  const allEnvVars = getAllEnvVars(targetDir);

  if (allEnvVars.size === 0) {
    throw new Error(
      `No .env files found in ${targetDir}.\n` +
      `Searched for: ${ENV_FILE_PATTERNS.join(', ')}`
    );
  }

  const envFilesFound = scanEnvFiles(targetDir);

  // Check if config file exists — if so, only send NEW vars to LLM
  const configExists = existsSync(outPath);
  let existingConfig: Config | null = null;
  let varsToAnalyze: string[] = [...allEnvVars];  // default: analyze all vars

  if (configExists) {
    try {
      const rawConfig = JSON.parse(readFileSync(outPath, 'utf-8'));
      existingConfig = validateConfig(rawConfig);
    } catch {
      // Malformed config (zero keys, missing fields, bad JSON) — treat as no config, let init overwrite
      existingConfig = null;
    }
  }

  if (existingConfig) {
    const newVars = findNewEnvVars(allEnvVars, existingConfig);
    if (newVars.length === 0) {
      return {
        matched: [],
        unregistered: [],
        unmatched: [],
        status: 'skipped',
      };
    }
    varsToAnalyze = newVars;
  }

  // Use LLM to analyze env vars (only new/unconfigured ones)
  console.error('[envguard] Analyzing env vars with AI...');
  let analysis;
  try {
    analysis = await analyzeEnvVarsWithLLM(varsToAnalyze, apiKey, model);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to initialize:\n` +
      `${errorMsg}`
    );
  }

  // Separate suggestions into registered (to write in config) and unregistered (warnings only)
  const suggestionsWithProvider = analysis.suggestions.filter(s => s.provider);
  const registered = suggestionsWithProvider.filter(s => !s.unregistered);
  const unregistered = suggestionsWithProvider.filter(s => s.unregistered);

  if (configExists && existingConfig) {
    // MERGE: Update existing config with new vars
    if (registered.length === 0) {
      // No new API keys found among the new vars.
      // If config already has keys, just skip silently — it's fine.
      // If config is empty, throw so the user knows.
      if (existingConfig.keys.length === 0) {
        throw buildNoKeysError(envFilesFound, unregistered, analysis.unmatched, false);
      }
      return {
        matched: [],
        unregistered,
        unmatched: analysis.unmatched,
        status: 'updated',
      };
    }

    // Merge: keep existing keys + add new registered ones
    const existingKeys = existingConfig.keys.map(k => ({
      envVar: k.envVar,
      provider: k.provider,
      required: k.required,
    }));

    const newKeys = registered.map(s => ({
      envVar: s.envVar,
      provider: s.provider!,
      required: false, // New keys default to not required
    }));

    const mergedConfig = {
      concurrency: existingConfig.concurrency,
      keys: [...existingKeys, ...newKeys],
    };

    writeFileSync(outPath, JSON.stringify(mergedConfig, null, 2) + '\n');

    return {
      matched: registered,
      unregistered,
      unmatched: analysis.unmatched,
      status: 'updated',
    };
  } else {
    // CREATE: Fresh config — only include registered providers
    if (registered.length === 0) {
      throw buildNoKeysError(envFilesFound, unregistered, analysis.unmatched, !configExists);
    }

    // Write fresh config — only registered providers
    const config = {
      concurrency: 5,
      keys: registered.map(s => ({
        envVar: s.envVar,
        provider: s.provider!,
      })),
    };

    writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n');

    return {
      matched: registered,
      unregistered,
      unmatched: analysis.unmatched,
      status: 'created',
    };
  }
}

// Load env vars from .env files into process.env
// Always scoped to config keys — no optional whitelist escape hatch
export function loadEnvFiles(dir: string, config: Config): number {
  const configKeys = new Set(config.keys.map(k => k.envVar));
  const envFiles = scanEnvFiles(dir);
  let loaded = 0;

  for (const file of envFiles) {
    const content = readFileSync(file, 'utf-8');

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();

      // Only load vars that are declared in config
      if (!configKeys.has(key)) {
        continue;
      }

      // Don't overwrite existing env vars
      if (key in process.env) {
        continue;
      }

      let value = trimmed.slice(eqIndex + 1).trim();

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
      loaded++;
    }
  }

  return loaded;
}