import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnvFile, scanEnvFiles, ENV_FILE_PATTERNS } from './shared.js';
import { analyzeEnvVarsWithLLM, type ProviderSuggestion } from '../core/llm.js';
import { validateConfig, type Config, MANUAL_CONFIG_HINT } from '../core/config.js';

type InitStatus = 'created' | 'updated' | 'skipped';

interface InitResult {
  matched: ProviderSuggestion[];
  unregistered: ProviderSuggestion[];
  unmatched: string[];
  status: InitStatus;
}

function getEnvVarNames(envFiles: string[]): Set<string> {
  const allEnvVars = new Set<string>();
  for (const file of envFiles) {
    const entries = parseEnvFile(file);
    for (const e of entries) {
      allEnvVars.add(e.key);
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

// Find env vars that are not yet tracked in the given config
function findNewEnvVars(envVars: Set<string>, config: Config): string[] {
  const configVars = new Set(config.keys.map(k => k.envVar));
  return [...envVars].filter(v => !configVars.has(v));
}

/** Try to load an existing config file; returns null if missing or malformed. */
function tryLoadConfig(configPath: string): Config | null {
  if (!existsSync(configPath)) return null;
  try {
    return validateConfig(JSON.parse(readFileSync(configPath, 'utf-8')));
  } catch {
    // Malformed config (zero keys, missing fields, bad JSON) — treat as no config
    return null;
  }
}

/** Create a fresh envguard.json with only registered providers. */
function createNewConfig(
  outPath: string,
  registered: ProviderSuggestion[],
  unregistered: ProviderSuggestion[],
  unmatched: string[],
): InitResult {
  const config = {
    concurrency: 5,
    keys: registered.map(s => ({
      envVar: s.envVar,
      provider: s.provider!,
    })),
  };
  writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n');
  return { matched: registered, unregistered, unmatched, status: 'created' };
}

/** Merge new registered keys into an existing config file. */
function updateExistingConfig(
  outPath: string,
  existingConfig: Config,
  registered: ProviderSuggestion[],
  unregistered: ProviderSuggestion[],
  unmatched: string[],
  envFilesFound: string[],
): InitResult {
  if (registered.length === 0) {
    // No new API keys found among the new vars.
    // If config already has keys, just skip silently — it's fine.
    // If config is empty, throw so the user knows.
    if (existingConfig.keys.length === 0) {
      throw buildNoKeysError(envFilesFound, unregistered, unmatched, false);
    }
    return { matched: [], unregistered, unmatched, status: 'updated' };
  }

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
  return { matched: registered, unregistered, unmatched, status: 'updated' };
}

export async function initEnvguard(
  dir: string,
  apiKey?: string,
  outputPath?: string,
  model?: string,
): Promise<InitResult> {
  const targetDir = dir || process.cwd();
  const outPath = outputPath || resolve(targetDir, 'envguard.json');

  // Scan env files once (used for both var extraction and error messages)
  const envFilesFound = scanEnvFiles(targetDir);

  if (envFilesFound.length === 0) {
    throw new Error(
      `No .env files found in ${targetDir}.\n` +
      `Searched for: ${ENV_FILE_PATTERNS.join(', ')}`
    );
  }

  const allEnvVars = getEnvVarNames(envFilesFound);

  // Determine which vars need LLM analysis
  const existingConfig = tryLoadConfig(outPath);
  let varsToAnalyze: string[] = [...allEnvVars]; // default: analyze all vars

  if (existingConfig) {
    const newVars = findNewEnvVars(allEnvVars, existingConfig);
    if (newVars.length === 0) {
      return { matched: [], unregistered: [], unmatched: [], status: 'skipped' };
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
    throw new Error(`Failed to initialize:\n${errorMsg}`);
  }

  // Separate suggestions into registered (to write in config) and unregistered (warnings only)
  const registered = analysis.suggestions.filter(s => s.provider && !s.unregistered);
  const unregistered = analysis.suggestions.filter(s => s.provider && s.unregistered);

  if (existingConfig) {
    return updateExistingConfig(outPath, existingConfig, registered, unregistered, analysis.unmatched, envFilesFound);
  }

  // CREATE: Fresh config — only include registered providers
  if (registered.length === 0) {
    throw buildNoKeysError(envFilesFound, unregistered, analysis.unmatched, true);
  }
  return createNewConfig(outPath, registered, unregistered, analysis.unmatched);
}

// Load env vars from .env files into process.env
// Always scoped to config keys — no optional whitelist escape hatch
export function loadEnvFiles(dir: string, config: Config): number {
  const configKeys = new Set(config.keys.map(k => k.envVar));
  const envFiles = scanEnvFiles(dir);
  let loaded = 0;

  for (const file of envFiles) {
    const entries = parseEnvFile(file);

    for (const e of entries) {
      // Only load vars that are declared in config
      if (!configKeys.has(e.key)) {
        continue;
      }

      // Don't overwrite existing env vars
      if (e.key in process.env) {
        continue;
      }

      process.env[e.key] = e.value;
      loaded++;
    }
  }

  return loaded;
}