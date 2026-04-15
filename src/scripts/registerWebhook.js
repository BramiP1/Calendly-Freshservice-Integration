/**
 * One-time script to register a Calendly webhook subscription.
 * Run this after starting ngrok (or after deploying) to point Calendly at your server.
 *
 * Usage:
 *   node src/scripts/registerWebhook.js <PUBLIC_URL>
 *
 * Example:
 *   node src/scripts/registerWebhook.js https://abc123.ngrok-free.app
 */
require('dotenv').config();
const calendly = require('../services/calendly');
const logger   = require('../utils/logger');

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error('Usage: node src/scripts/registerWebhook.js <PUBLIC_URL>');
    console.error('Example: node src/scripts/registerWebhook.js https://abc123.ngrok-free.app');
    process.exit(1);
  }

  const callbackUrl = `${baseUrl.replace(/\/$/, '')}/webhook/calendly`;
  logger.info(`Registering Calendly webhook → ${callbackUrl}`);

  try {
    const user = await calendly.getCurrentUser();
    const webhook = await calendly.createWebhook(
      callbackUrl,
      user.current_organization,
      user.uri
    );
    logger.info('Webhook registered successfully!');
    logger.info(`Webhook URI: ${webhook.uri}`);
    logger.info(`Callback URL: ${webhook.callback_url}`);
    logger.info(`Events: ${webhook.events.join(', ')}`);
    if (webhook.signing_key) {
      console.log('\n---------------------------------------------------------');
      console.log('ACTION REQUIRED — add this to your .env file:');
      console.log(`CALENDLY_WEBHOOK_SIGNING_KEY=${webhook.signing_key}`);
      console.log('---------------------------------------------------------\n');
    }
  } catch (err) {
    logger.error(`Failed to register webhook: ${err.message}`);
    process.exit(1);
  }
}

main();
