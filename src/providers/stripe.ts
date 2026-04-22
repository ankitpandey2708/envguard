import type { ProviderSpec } from '../core/registry.js';

export const stripeProvider: ProviderSpec = {
  id: 'stripe',
  displayName: 'Stripe',
  buildRequest(envValue) {
    return {
      url: 'https://api.stripe.com/v1/charges?limit=1',
      method: 'GET',
      headers: { Authorization: `Bearer ${envValue}` },
    };
  },
  interpretResponse(status) {
    if (status === 200) return 'ok';
    if (status === 401) return 'invalid';
    if (status === 403) return 'denied';
    return 'unknown';
  },
};
