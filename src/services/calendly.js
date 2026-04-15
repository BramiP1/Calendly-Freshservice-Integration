const axios = require('axios');
const logger = require('../utils/logger');

function getClient() {
  const token = process.env.CALENDLY_API_TOKEN;
  if (!token) {
    throw new Error('CALENDLY_API_TOKEN must be set in .env');
  }
  return axios.create({
    baseURL: 'https://api.calendly.com',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });
}

/**
 * Retrieve the authenticated user's Calendly profile.
 * Useful for bootstrapping (e.g., getting the user URI for webhook registration).
 */
async function getCurrentUser() {
  logger.info('Calendly: fetching current user');
  const client = getClient();
  try {
    const response = await client.get('/users/me');
    logger.info(`Calendly: current user — ${response.data.resource.email}`);
    return response.data.resource;
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data);
    logger.error(`Calendly: getCurrentUser failed [${status}] — ${body}`);
    throw new Error(`Calendly getCurrentUser error: ${status} ${body}`);
  }
}

/**
 * List all webhook subscriptions for the current user.
 */
async function listWebhooks(organizationUri, userUri) {
  logger.info('Calendly: listing webhook subscriptions');
  const client = getClient();
  try {
    const response = await client.get('/webhook_subscriptions', {
      params: { organization: organizationUri, user: userUri, scope: 'user' },
    });
    logger.info(`Calendly: found ${response.data.collection.length} webhook subscription(s)`);
    return response.data.collection;
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data);
    logger.error(`Calendly: listWebhooks failed [${status}] — ${body}`);
    throw new Error(`Calendly listWebhooks error: ${status} ${body}`);
  }
}

/**
 * Register a new webhook subscription pointing at this server's /webhook/calendly endpoint.
 *
 * @param {string} callbackUrl  - Public URL (e.g. https://abc123.ngrok.io/webhook/calendly)
 * @param {string} organizationUri
 * @param {string} userUri
 */
async function createWebhook(callbackUrl, organizationUri, userUri) {
  logger.info(`Calendly: creating webhook subscription → ${callbackUrl}`);
  const client = getClient();
  try {
    const response = await client.post('/webhook_subscriptions', {
      url: callbackUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: organizationUri,
      user: userUri,
      scope: 'user',
    });
    logger.info(`Calendly: webhook created — URI: ${response.data.resource.uri}`);
    return response.data.resource;
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data);
    logger.error(`Calendly: createWebhook failed [${status}] — ${body}`);
    throw new Error(`Calendly createWebhook error: ${status} ${body}`);
  }
}

module.exports = { getCurrentUser, listWebhooks, createWebhook };
