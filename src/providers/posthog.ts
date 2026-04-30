import type { ProviderSpec } from '../core/registry.js';

export const posthogProvider: ProviderSpec = {
  id: 'posthog',
  displayName: 'PostHog',
  buildRequest(envValue) {
    return {
      url: 'https://us.i.posthog.com/decide/?v=3',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        api_key: envValue,
        distinct_id: 'envguard',
      }),
    };
  },
  interpretResponse(status) {
    if (status === 200) return 'ok';
    if (status === 401) return 'invalid';
    if (status === 403) return 'denied';
    return 'unknown';
  },
};
