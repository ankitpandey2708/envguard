import { bearerProvider } from './_helpers.js';
export const posthogProvider = bearerProvider('posthog', 'PostHog', 'https://us.posthog.com/api/projects/');
