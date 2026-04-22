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

// Lazy-loaded provider cache
let _providers: Record<string, ProviderSpec> | null = null;

function getProvidersDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, '../../providers');
}

// Load all providers in parallel
async function loadAllProviders(): Promise<Record<string, ProviderSpec>> {
  const ids = discoverProviderIds();
  
  const results = await Promise.all(
    ids.map(async (id) => {
      const mod = await import(`../providers/${id}.js`) as { provider?: ProviderSpec; default?: ProviderSpec };
      const provider = mod.provider || mod.default;
      return provider && typeof provider.id === 'string' ? [id, provider] as const : null;
    })
  );

  const providers: Record<string, ProviderSpec> = {};
  for (const r of results) {
    if (r) providers[r[0]] = r[1];
  }
  return providers;
}

function discoverProviderIds(): string[] {
  try {
    return readdirSync(getProvidersDir())
      .filter(f => f.endsWith('.ts') && f !== 'index.ts')
      .map(f => f.replace('.ts', ''));
  } catch {
    return [];
  }
}

// Synchronous access (returns empty if called before first async access)
export function listProvidersSync(): string[] {
  return _providers ? Object.keys(_providers) : [];
}

// Async access - initializes cache if needed
export async function initProviders(): Promise<void> {
  if (_providers) return;
  _providers = await loadAllProviders();
}

// Get a specific provider
export async function getProvider(id: string): Promise<ProviderSpec> {
  if (!_providers) {
    await initProviders();
  }
  
  const provider = _providers![id];
  if (provider) return provider;

  const available = Object.keys(_providers!);
  throw new Error(
    `Unknown provider: \"${id}\". Available: ${available.join(', ') || '(none)'}.`
  );
}

// List all providers
export async function listProviders(): Promise<string[]> {
  if (!_providers) {
    await initProviders();
  }
  return Object.keys(_providers!);
}