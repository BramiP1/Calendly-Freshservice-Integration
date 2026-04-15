const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Validates the Calendly webhook signature using HMAC-SHA256.
 * Calendly signs payloads with the signing key configured on the webhook subscription.
 * Docs: https://developer.calendly.com/api-docs/ZG9jOjM2MzE3ODI4-webhook-signatures
 */
function validateCalendlySignature(req, res, next) {
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;

  if (!signingKey) {
    logger.warn('CALENDLY_WEBHOOK_SIGNING_KEY not set — skipping signature validation');
    return next();
  }

  const signature = req.headers['calendly-webhook-signature'];
  if (!signature) {
    logger.warn('Webhook received with no signature header — rejecting');
    return res.status(401).json({ error: 'Missing webhook signature' });
  }

  // Signature format: "t=<timestamp>,v1=<hmac>"
  const parts = Object.fromEntries(signature.split(',').map(p => p.split('=')));
  const { t: timestamp, v1: receivedHmac } = parts;

  if (!timestamp || !receivedHmac) {
    logger.warn('Malformed webhook signature header — rejecting');
    return res.status(401).json({ error: 'Malformed signature header' });
  }

  // Reject webhooks older than 5 minutes
  const age = Date.now() / 1000 - parseInt(timestamp, 10);
  if (age > 300) {
    logger.warn(`Webhook timestamp too old (${Math.round(age)}s) — rejecting replay attack`);
    return res.status(401).json({ error: 'Webhook timestamp expired' });
  }

  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
  const toSign = `${timestamp}.${rawBody}`;
  const expectedHmac = crypto
    .createHmac('sha256', signingKey)
    .update(toSign)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(receivedHmac), Buffer.from(expectedHmac))) {
    logger.warn('Webhook signature mismatch — rejecting');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  logger.info('Webhook signature validated successfully');
  next();
}

module.exports = { validateCalendlySignature };
