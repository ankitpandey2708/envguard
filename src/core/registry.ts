import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HttpRequest } from './httpClient.js';

export interface ProviderSpec {
  id: string;
  displayName: string;
  buildRequest(envValue: string): HttpRequest;
  interpretResponse(status: number): 'ok' | 'invalid' | 'denied' | 'unknown';
}

export function defaultInterpretResponse(status: number): 'ok' | 'invalid' | 'denied' | 'unknown' {
  if (status === 200) return 'ok';
  if (status === 401) return 'invalid';
  if (status === 403) return 'denied';
  return 'unknown';
}

/**
 * Full-registry cache lifecycle: `unloaded` → `loading` (promise shared by concurrent callers) → `ready`.
 * `ready` is tracked separately so `listProvidersSync` can read it without awaiting.
 */
let loading: Promise<Record<string, ProviderSpec>> | null = null;
let ready: Record<string, ProviderSpec> | null = null;

function getProvidersDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, '../providers');
}

/**
 * Import one provider module and find its spec.
 * Convention: each provider file exports `${id}Provider` (e.g. geminiProvider);
 * falls back to `provider` / default, then to any export shaped like a ProviderSpec.
 * Returns null if the module is missing or exports no spec.
 */
async function importProvider(id: string): Promise<ProviderSpec | null> {
  let mod: Record<string, unknown>;
  try {
    mod = await import(`../providers/${id}.js`) as Record<string, unknown>;
  } catch {
    return null;
  }
  const provider = (mod[`${id}Provider`] ?? mod.provider ?? mod.default ??
    Object.values(mod).find((v): v is ProviderSpec =>
      v != null && typeof v === 'object' && 'id' in v && typeof (v as ProviderSpec).id === 'string'
    )) as ProviderSpec | undefined;
  return provider && typeof provider.id === 'string' ? provider : null;
}

async function importProviders(ids: string[]): Promise<Record<string, ProviderSpec>> {
  const entries = await Promise.all(ids.map(async id => [id, await importProvider(id)] as const));
  const loaded: Record<string, ProviderSpec> = {};
  for (const [id, provider] of entries) {
    if (provider) loaded[id] = provider;
  }
  return loaded;
}

function discoverProviderIds(): string[] {
  try {
    const dir = getProvidersDir();
    const files = readdirSync(dir);
    // Support both source (.ts) and compiled (.js) environments
    const providerFiles = files.filter(f =>
      (f.endsWith('.ts') || f.endsWith('.js')) && !f.startsWith('index.') && !f.startsWith('_') && !f.includes('.d.') && !f.endsWith('.map')
    );
    // Deduplicate by base name (e.g., gemini.ts and gemini.js → gemini)
    return [...new Set(providerFiles.map(f => f.replace(/\.(ts|js)$/, '')))];
  } catch {
    return [];
  }
}

function loadAll(): Promise<Record<string, ProviderSpec>> {
  loading ??= importProviders(discoverProviderIds()).then(map => (ready = map));
  return loading;
}

// Synchronous access - discovers and returns provider IDs without loading full specs
export function listProvidersSync(): string[] {
  if (ready) return Object.keys(ready);
  return discoverProviderIds();
}

// Async access - initializes cache if needed
export async function initProviders(): Promise<void> {
  await loadAll();
}

// Get a specific provider
export async function getProvider(id: string): Promise<ProviderSpec> {
  const providers = await loadAll();
  const provider = providers[id];
  if (provider) return provider;

  const available = Object.keys(providers);
  throw new Error(
    `Unknown provider: "${id}". Available: ${available.join(', ') || '(none)'}.`
  );
}

// List all providers
export async function listProviders(): Promise<string[]> {
  return Object.keys(await loadAll());
}

// Load only the provider IDs needed — avoids importing all provider files on validate
export async function loadProvidersByIds(ids: string[]): Promise<Record<string, ProviderSpec>> {
  if (ready) {
    const cache = ready;
    return Object.fromEntries(ids.flatMap(id => cache[id] ? [[id, cache[id]]] : []));
  }
  return importProviders([...new Set(ids)]);
}
