import { type ProviderSpec, defaultInterpretResponse } from '../core/registry.js';

export const anthropicProvider: ProviderSpec = {
  id: 'anthropic',
  displayName: 'Anthropic',
  buildRequest(envValue) {
    return {
      url: 'https://api.anthropic.com/v1/models',
      method: 'GET',
      headers: {
        'x-api-key': envValue,
        'anthropic-version': '2023-06-01',
      },
    };
  },
  interpretResponse: defaultInterpretResponse,
};
