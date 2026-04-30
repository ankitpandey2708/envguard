import type { ProviderSpec } from '../core/registry.js';

export const fingerprintProvider: ProviderSpec = {
  id: 'fingerprint',
  displayName: 'Fingerprint',
  buildRequest(envValue) {
    return {
      url: 'https://api.fpjs.io/v4/events/envguard-probe',
      method: 'GET',
      headers: {
        'Auth-API-Key': envValue,
      },
    };
  },
  interpretResponse(status) {
    // 404 = key is valid but the probe event_id doesn't exist — that's fine
    if (status === 200 || status === 404) return 'ok';
    if (status === 401 || status === 403) return 'invalid';
    return 'unknown';
  },
};
