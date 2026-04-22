import type { ProviderSpec } from '../core/registry.js';

export const openaiProvider: ProviderSpec = {
  id: 'openai',
  displayName: 'OpenAI',
  buildRequest(envValue) {
    return {
      url: 'https://api.openai.com/v1/models',
      method: 'GET',
      headers: { Authorization: `Bearer ${envValue}` },
    };
  },
  interpretResponse(status) {
    if (status === 200) return 'ok';
    if (status === 401) return 'invalid';
    if (status === 403) return 'denied';
    return 'unknown';
  },
};
