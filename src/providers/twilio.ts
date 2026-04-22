import type { ProviderSpec } from '../core/registry.js';

// Twilio auth token validation uses HTTP Basic auth: AccountSid:AuthToken.
// Provide accountSid via the TWILIO_ACCOUNT_SID env var.
export const twilioProvider: ProviderSpec = {
  id: 'twilio',
  displayName: 'Twilio',
  buildRequest(envValue) {
    const accountSid = process.env['TWILIO_ACCOUNT_SID'] ?? '';

    if (!accountSid) {
      throw new Error(
        'Twilio provider requires TWILIO_ACCOUNT_SID env var'
      );
    }

    const credentials = Buffer.from(`${accountSid}:${envValue}`).toString('base64');
    return {
      url: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
      method: 'GET',
      headers: { Authorization: `Basic ${credentials}` },
    };
  },
  interpretResponse(status) {
    if (status === 200) return 'ok';
    if (status === 401) return 'invalid';
    if (status === 403) return 'denied';
    return 'unknown';
  },
};
