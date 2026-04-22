import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeEnvVarsWithLLM, type ProviderSuggestion } from '../core/llm.js';

export interface InitResult {
  matched: ProviderSuggestion[];
  unmatched: string[];
  written: boolean;
}

// Env file patterns to scan (production-only)
const ENV_FILE_PATTERNS = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.prod',
];

export function scanEnvFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of ENV_FILE_PATTERNS) {
    const path = resolve(dir, name);
    if (existsSync(path)) {
      found.push(name);
    }
  }
  return found;
}

export function parseEnvFile(filePath: string): string[] {
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

export async function initEnvguard(
  dir: string,
  apiKey?: string,
  outputPath?: string
): Promise<InitResult> {
  const targetDir = dir || process.cwd();
  const outPath = outputPath || resolve(targetDir, 'envguard.json');
  
  // Scan for env files
  const envFiles = scanEnvFiles(targetDir);
  
  if (envFiles.length === 0) {
    throw new Error(
      `No .env files found in ${targetDir}.\n` +
      `Searched for: ${ENV_FILE_PATTERNS.join(', ')}`
    );
  }
  
  // Collect all env vars from all files (deduplicated)
  const allEnvVars = new Set<string>();
  for (const file of envFiles) {
    const vars = parseEnvFile(resolve(targetDir, file));
    for (const v of vars) {
      allEnvVars.add(v);
    }
  }
  
  if (allEnvVars.size === 0) {
    throw new Error(
      `No environment variables found in ${envFiles.join(', ')}.`
    );
  }
  
  // Use LLM to analyze env vars
  console.error('[envguard] Analyzing env vars with AI...');
  let analysis;
  try {
    analysis = await analyzeEnvVarsWithLLM([...allEnvVars], apiKey);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to initialize:
` +
      `${errorMsg}`
    );
  }
  
  if (analysis.suggestions.length === 0) {
    throw new Error(
      `No API keys detected in ${envFiles.join(', ')}.\n` +
      `Found ${analysis.unmatched.length} unrecognized vars: ${analysis.unmatched.slice(0, 5).join(', ')}${analysis.unmatched.length > 5 ? '...' : ''}\n` +
      `Note: An LLM API key may be required for intelligent detection. Set OPENAI_API_KEY or use --api-key.`
    );
  }
  
  // Check if file already exists
  if (existsSync(outPath)) {
    throw new Error(
      `${outPath} already exists.\n` +
      `Please remove it first.`
    );
  }
  
  // Write config
  const config = {
    concurrency: 5,
    keys: analysis.suggestions.map(s => ({
      envVar: s.envVar,
      provider: s.provider,
    })),
  };
  
  writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n');
  
  return {
    matched: analysis.suggestions,
    unmatched: analysis.unmatched,
    written: true,
  };
}