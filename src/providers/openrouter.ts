import type { ProviderSpec } from '../core/registry.js';
import { defaultInterpretResponse } from '../core/registry.js';

export const openrouterProvider: ProviderSpec = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  buildRequest(envValue) {
    return {
      url: 'https://openrouter.ai/api/v1/key',
      method: 'GET',
      headers: {
        'authorization': `Bearer ${envValue}`,
      },
    };
  },
  interpretResponse: defaultInterpretResponse,
};
