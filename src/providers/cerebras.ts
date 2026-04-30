import type { ProviderSpec } from '../core/registry.js';
import { defaultInterpretResponse } from '../core/registry.js';

export const cerebrasProvider: ProviderSpec = {
  id: 'cerebras',
  displayName: 'Cerebras',
  buildRequest(envValue) {
    return {
      url: 'https://api.cerebras.ai/v1/models',
      method: 'GET',
      headers: {
        'authorization': `Bearer ${envValue}`,
      },
    };
  },
  interpretResponse: defaultInterpretResponse,
};
