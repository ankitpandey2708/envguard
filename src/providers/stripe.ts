import { bearerProvider } from './_helpers.js';
export const stripeProvider = bearerProvider('stripe', 'Stripe', 'https://api.stripe.com/v1/charges?limit=1');
