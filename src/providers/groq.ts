import type { ProviderSpec } from '../core/registry.js';
import { defaultInterpretResponse } from '../core/registry.js';

export const groqProvider: ProviderSpec = {
  id: 'groq',
  displayName: 'Groq',
  buildRequest(envValue) {
    return {
      url: 'https://api.groq.com/openai/v1/models',
      method: 'GET',
      headers: {
        'authorization': `Bearer ${envValue}`,
      },
    };
  },
  interpretResponse: defaultInterpretResponse,
};
