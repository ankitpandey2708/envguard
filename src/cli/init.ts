import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeEnvVarsWithLLM, type ProviderSuggestion } from '../core/llm.js';
import { validateConfig, type Config } from '../core/config.js';

interface InitResult {
  matched: ProviderSuggestion[];
  unmatched: string[];
  unregistered: ProviderSuggestion[];
  added: string[];
  updated: boolean;
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
    
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match) {
      envVars.push(match[1]);
    }
  }
  
  return envVars;
}

export function getAllEnvVars(dir: string): Set<string> {
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
function buildNoKeysError(
  envFiles: string[],
  unregistered: ProviderSuggestion[],
  unmatched: string[]
): Error {
  if (unregistered.length > 0) {
    return new Error(
      `No registered API keys detected in ${envFiles.join(', ')}.\n` +
      `Detected ${unregistered.length} API key(s) for unregistered provider(s): ${unregistered.map(s => `${s.provider}`).join(', ')}\n` +
      `Found ${unmatched.length} other unrecognized vars: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? '...' : ''}\n` +
      `Create envguard.json manually (see README.md).`
    );
  }
  return new Error(
    `No API keys detected in ${envFiles.join(', ')}.\n` +
    `Found ${unmatched.length} unrecognized vars: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? '...' : ''}\n` +
    `Create envguard.json manually (see README.md).`
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
  outputPath?: string
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
  
  // Use LLM to analyze env vars
  console.error('[envguard] Analyzing env vars with AI...');
  let analysis;
  try {
    analysis = await analyzeEnvVarsWithLLM([...allEnvVars], apiKey);
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

  // Check if config file exists
  const configExists = existsSync(outPath);
  
  if (configExists) {
    // MERGE: Update existing config with new vars
    const rawConfig = JSON.parse(readFileSync(outPath, 'utf-8'));
    const existingConfig = validateConfig(rawConfig);
    
    // Find new vars to add (only from registered providers)
    const newVars = findNewEnvVars(allEnvVars, existingConfig);
    const newSuggestions = registered.filter(s => newVars.includes(s.envVar));
    
    if (newSuggestions.length === 0 && registered.length === 0) {
      throw buildNoKeysError(envFilesFound, unregistered, analysis.unmatched);
    }
    
    // Merge: keep existing keys + add new registered ones
    const existingKeys = existingConfig.keys.map(k => ({
      envVar: k.envVar,
      provider: k.provider,
      required: k.required,
    }));
    
    const newKeys = newSuggestions.map(s => ({
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
      unmatched: analysis.unmatched,
      unregistered,
      added: newSuggestions.map(s => s.envVar),
      updated: true,
    };
  } else {
    // CREATE: Fresh config — only include registered providers
    if (registered.length === 0) {
      throw buildNoKeysError(envFilesFound, unregistered, analysis.unmatched);
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
      unmatched: analysis.unmatched,
      unregistered,
      added: registered.map(s => s.envVar),
      updated: false,
    };
  }
}

// Warn about unknown vars (for validate command)
export function checkForUnknownVars(envVars: Set<string>, config: Config): string[] {
  return findNewEnvVars(envVars, config);
}

// Load env vars from .env files into process.env
export function loadEnvFiles(dir: string): number {
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
      const value = trimmed.slice(eqIndex + 1).trim();
      
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        const unquoted = value.slice(1, -1);
        // Only set if not already in process.env (preserve existing)
        if (!(key in process.env)) {
          process.env[key] = unquoted;
          loaded++;
        }
      } else {
        if (!(key in process.env)) {
          process.env[key] = value;
          loaded++;
        }
      }
    }
  }
  
  return loaded;
}