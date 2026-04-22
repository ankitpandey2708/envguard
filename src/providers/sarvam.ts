import type { ProviderSpec } from '../core/registry.js';

export const sarvamProvider: ProviderSpec = {
  id: 'sarvam',
  displayName: 'Sarvam AI',
  defaultTimeoutMs: 5000,
  buildRequest(envValue) {
    return {
      url: 'https://api.sarvam.ai/translate',
      method: 'POST',
      headers: {
        'api-subscription-key': envValue,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        input: 'hi',
        source_language_code: 'auto',
        target_language_code: 'gu-IN',
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
