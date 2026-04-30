import type { ProviderSpec } from '../core/registry.js';
import { defaultInterpretResponse } from '../core/registry.js';

export const togetheraiProvider: ProviderSpec = {
  id: 'togetherai',
  displayName: 'Together AI',
  buildRequest(envValue) {
    return {
      url: 'https://api.together.ai/v1/models',
      method: 'GET',
      headers: {
        'authorization': `Bearer ${envValue}`,
      },
    };
  },
  interpretResponse: defaultInterpretResponse,
};
