import { type ProviderSpec, defaultInterpretResponse } from '../core/registry.js';

export const sarvamProvider: ProviderSpec = {
  id: 'sarvam',
  displayName: 'Sarvam AI',
  buildRequest(envValue) {
    return {
      url: 'https://api.sarvam.ai/text-to-speech/pronunciation-dictionary',
      method: 'GET',
      headers: {
        'api-subscription-key': envValue,
      },
    };
  },
  interpretResponse: defaultInterpretResponse,
};
