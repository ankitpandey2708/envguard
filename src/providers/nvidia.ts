import type { ProviderSpec } from '../core/registry.js';
import { defaultInterpretResponse } from '../core/registry.js';

export const nvidiaProvider: ProviderSpec = {
  id: 'nvidia',
  displayName: 'NVIDIA NIM',
  buildRequest(envValue) {
    return {
      url: 'https://integrate.api.nvidia.com/v1/models',
      method: 'GET',
      headers: {
        'authorization': `Bearer ${envValue}`,
      },
    };
  },
  interpretResponse: defaultInterpretResponse,
};
