import type { ProviderSpec } from '../core/registry.js';
import { defaultInterpretResponse } from '../core/registry.js';

export const mistralProvider: ProviderSpec = {
  id: 'mistral',
  displayName: 'Mistral',
  buildRequest(envValue) {
    return {
      url: 'https://api.mistral.ai/v1/models',
      method: 'GET',
      headers: {
        'authorization': `Bearer ${envValue}`,
      },
    };
  },
  interpretResponse: defaultInterpretResponse,
};
