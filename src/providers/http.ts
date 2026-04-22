import type { ProviderSpec } from '../core/registry.js';
import type { ProviderOverride } from '../core/config.js';

export function buildHttpProvider(override: ProviderOverride): ProviderSpec {
  return {
    id: override.id,
    displayName: override.id,
    defaultTimeoutMs: override.timeoutMs ?? 5000,
    buildRequest(envValue) {
      const headers: Record<string, string> = {};

      if (override.headers) {
        for (const [k, v] of Object.entries(override.headers)) {
          headers[k] = v.replace('{{API_KEY}}', envValue);
        }
      }

      switch (override.authPlacement) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${envValue}`;
          break;
        case 'basic':
          headers['Authorization'] = `Basic ${Buffer.from(envValue).toString('base64')}`;
          break;
        case 'header':
          headers['X-API-Key'] = envValue;
          break;
        // 'query' is applied to the URL below
      }

      let url = override.endpoint;
      if (override.authPlacement === 'query') {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}api_key=${encodeURIComponent(envValue)}`;
      }

      return {
        url,
        method: override.method,
        headers,
        body: override.body !== undefined ? JSON.stringify(override.body) : undefined,
      };
    },
    interpretResponse(status) {
      if (override.successCodes.includes(status)) return 'ok';
      if (status === 401) return 'invalid';
      if (status === 403) return 'denied';
      return 'unknown';
    },
  };
}
