import { type ProviderSpec, defaultInterpretResponse } from '../core/registry.js';

export function bearerProvider(id: string, displayName: string, url: string): ProviderSpec {
  return {
    id,
    displayName,
    buildRequest: (envValue) => ({
      url,
      method: 'GET',
      headers: { Authorization: `Bearer ${envValue}` },
    }),
    interpretResponse: defaultInterpretResponse,
  };
}
