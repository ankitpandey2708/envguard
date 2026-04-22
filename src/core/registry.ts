import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HttpRequest } from './httpClient.js';
import { openaiProvider } from '../providers/openai.js';
import { anthropicProvider } from '../providers/anthropic.js';
import { geminiProvider } from '../providers/gemini.js';
import { stripeProvider } from '../providers/stripe.js';
import { twilioProvider } from '../providers/twilio.js';
import { sarvamProvider } from '../providers/sarvam.js';

export interface ProviderSpec {
  id: string;
  displayName: string;
  buildRequest(envValue: string): HttpRequest;
  interpretResponse(status: number): 'ok' | 'invalid' | 'denied' | 'unknown';
}

function getProviderFiles(): Set<string> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const providersDir = join(__dirname, '../providers');
  try {
    return new Set(
      readdirSync(providersDir)
        .filter(f => f.endsWith('.ts'))
        .map(f => f.replace('.ts', ''))
    );
  } catch {
    return new Set();
  }
}

export const builtInProviders: Record<string, ProviderSpec> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  stripe: stripeProvider,
  twilio: twilioProvider,
  sarvam: sarvamProvider,
};

export function getProvider(id: string): ProviderSpec {
  const builtin = builtInProviders[id];
  if (builtin) {
    const providerFiles = getProviderFiles();
    if (!providerFiles.has(id)) {
      throw new Error(
        `Provider "${id}" is registered in code but missing file: src/providers/${id}.ts. ` +
        `Either create the provider file or remove it from builtInProviders.`
      );
    }
    return builtin;
  }

  throw new Error(
    `Unknown provider: "${id}". Built-in providers: ${Object.keys(builtInProviders).join(', ')}.`
  );
}
