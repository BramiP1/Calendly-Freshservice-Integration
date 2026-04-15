const express = require('express');
const router = express.Router();
const { validateCalendlySignature } = require('../middleware/validateWebhook');
const { handleCalendlyEvent } = require('../handlers/calendlyEvents');
const logger = require('../utils/logger');

router.post('/calendly', validateCalendlySignature, async (req, res) => {
  // Body may still be a Buffer at this point; parse it if needed
  let payload;
  try {
    payload = req.body instanceof Buffer ? JSON.parse(req.body.toString('utf8')) : req.body;
  } catch (err) {
    logger.error('Failed to parse webhook payload JSON', err.message);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const eventType = payload?.event;
  if (!eventType) {
    logger.warn('Webhook payload missing "event" field');
    return res.status(400).json({ error: 'Missing event type in payload' });
  }

  logger.info(`Received Calendly event: ${eventType}`);
  logger.debug('Webhook payload:', JSON.stringify(payload, null, 2));

  // Respond immediately so Calendly doesn't retry
  res.status(200).json({ received: true });

  // Process async — errors here won't affect the 200 response
  try {
    await handleCalendlyEvent(eventType, payload);
  } catch (err) {
    logger.error(`Error processing event "${eventType}": ${err.message}`, err.stack);
  }
});

module.exports = router;
