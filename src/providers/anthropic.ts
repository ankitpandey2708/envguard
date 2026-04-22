import type { ProviderSpec } from '../core/registry.js';

export const anthropicProvider: ProviderSpec = {
  id: 'anthropic',
  displayName: 'Anthropic',
  defaultTimeoutMs: 8000,
  buildRequest(envValue) {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': envValue,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    };
  },
  interpretResponse(status) {
    if (status === 200) return 'ok';
    if (status === 401) return 'invalid';
    if (status === 403) return 'denied';
    return 'unknown';
  },
};
