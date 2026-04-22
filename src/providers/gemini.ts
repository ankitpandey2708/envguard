import type { ProviderSpec } from '../core/registry.js';

export const geminiProvider: ProviderSpec = {
  id: 'gemini',
  displayName: 'Google Gemini',
  defaultTimeoutMs: 5000,
  buildRequest(envValue) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(envValue)}`,
      method: 'GET',
      headers: {},
    };
  },
  interpretResponse(status) {
    if (status === 200) return 'ok';
    // Gemini returns 400 for invalid keys (bad request), 403 for missing/denied
    if (status === 400 || status === 401) return 'invalid';
    if (status === 403) return 'denied';
    return 'unknown';
  },
};
