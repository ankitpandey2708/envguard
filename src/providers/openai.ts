import type { ProviderSpec } from '../core/registry.js';
import { defaultInterpretResponse } from '../core/registry.js';

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
  interpretResponse: defaultInterpretResponse,
};
