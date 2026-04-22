import type { HttpRequest } from './httpClient.js';
import type { ProviderOverride } from './config.js';
import { openaiProvider } from '../providers/openai.js';
import { anthropicProvider } from '../providers/anthropic.js';
import { geminiProvider } from '../providers/gemini.js';
import { stripeProvider } from '../providers/stripe.js';
import { twilioProvider } from '../providers/twilio.js';
import { sarvamProvider } from '../providers/sarvam.js';
import { buildHttpProvider } from '../providers/http.js';

export interface ProviderSpec {
  id: string;
  displayName: string;
  defaultTimeoutMs: number;
  buildRequest(envValue: string, options?: Record<string, unknown>): HttpRequest;
  interpretResponse(status: number): 'ok' | 'invalid' | 'denied' | 'unknown';
}

export const builtInProviders: Record<string, ProviderSpec> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  stripe: stripeProvider,
  twilio: twilioProvider,
  sarvam: sarvamProvider,
};

export function getProvider(id: string, overrides: ProviderOverride[] = []): ProviderSpec {
  const override = overrides.find(o => o.id === id);
  if (override) return buildHttpProvider(override);

  const builtin = builtInProviders[id];
  if (builtin) return builtin;

  throw new Error(
    `Unknown provider: "${id}". Built-in providers: ${Object.keys(builtInProviders).join(', ')}. ` +
    `Add a providerOverrides entry in your config to use a custom endpoint.`
  );
}
