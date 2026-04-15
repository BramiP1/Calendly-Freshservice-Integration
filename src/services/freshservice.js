const axios = require('axios');
const logger = require('../utils/logger');

function getClient() {
  const domain  = process.env.FRESHSERVICE_DOMAIN;
  const apiKey  = process.env.FRESHSERVICE_API_KEY;

  if (!domain || !apiKey) {
    throw new Error('FRESHSERVICE_DOMAIN and FRESHSERVICE_API_KEY must be set in .env');
  }

  return axios.create({
    baseURL: `https://${domain}/api/v2`,
    auth: { username: apiKey, password: 'X' },
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
}

/**
 * Create a new ticket in FreshService.
 */
async function createTicket({ subject, description, email, priority, status, tags = [] }) {
  logger.info(`FreshService: creating ticket — "${subject}"`);
  const client = getClient();

  try {
    const response = await client.post('/tickets', {
      subject,
      description,
      email,
      priority,
      status,
      tags,
      source: 2, // Portal
    });
    logger.info(`FreshService: ticket created — ID ${response.data.ticket.id}`);
    return response.data.ticket;
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data);
    logger.error(`FreshService: createTicket failed [${status}] — ${body}`);
    throw new Error(`FreshService createTicket error: ${status} ${body}`);
  }
}

/**
 * Search for open tickets by requester email and keyword in subject.
 * Returns an array (may be empty).
 */
async function searchTickets(email, keyword) {
  logger.info(`FreshService: searching tickets for email "${email}", keyword "${keyword}"`);
  const client = getClient();

  try {
    const query    = `"email:'${email}'"`;
    const response = await client.get('/tickets/filter', { params: { query } });
    const tickets  = response.data.tickets || [];

    const matches = tickets.filter(t =>
      t.subject && t.subject.toLowerCase().includes(keyword.toLowerCase())
    );

    logger.info(`FreshService: found ${matches.length} matching ticket(s)`);
    return matches;
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data);
    logger.error(`FreshService: searchTickets failed [${status}] — ${body}`);
    // Return empty array rather than throwing — cancellation flow handles missing tickets
    return [];
  }
}

/**
 * Create a Service Request under a specific Service Catalog item.
 *
 * FreshService creates the request with the service item's name as the subject.
 * Meeting details are immediately added as a follow-up note so agents see everything
 * in the conversation thread without needing custom fields on the service item.
 *
 * @param {object} opts
 * @param {number} opts.serviceItemId  - FreshService Service Item ID (from .env)
 * @param {string} opts.email          - Requester email
 * @param {string} opts.noteBody       - HTML content to post as the first note
 * @param {string[]} opts.tags         - Tags to apply (include the Calendly event UUID tag)
 */
async function createServiceRequest({ serviceItemId, email, noteBody, tags = [] }) {
  logger.info(`FreshService: creating service request under service item #${serviceItemId}`);
  const client = getClient();

  let serviceRequest;
  try {
    const response = await client.post(
      `/service_catalog/items/${serviceItemId}/place_request`,
      { email }
    );
    serviceRequest = response.data.service_request;
    logger.info(`FreshService: service request created — ID ${serviceRequest.id}`);
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data);
    logger.error(`FreshService: createServiceRequest failed [${status}] — ${body}`);
    throw new Error(`FreshService createServiceRequest error: ${status} ${body}`);
  }

  // Post the meeting details as the first note on the request
  if (noteBody) {
    try {
      await client.post(`/tickets/${serviceRequest.id}/notes`, {
        body: noteBody,
        private: false,
      });
      logger.info(`FreshService: meeting details note added to service request #${serviceRequest.id}`);
    } catch (err) {
      // Non-fatal — the request was created; just log and continue
      logger.warn(`FreshService: note post failed for service request #${serviceRequest.id} — ${err.message}`);
    }
  }

  return serviceRequest;
}

/**
 * Search for tickets by an exact tag value.
 * Used to find the ticket for a specific Calendly event UUID (e.g. "calendly-evt-ABCDEF").
 * Returns an array (may be empty).
 */
async function searchTicketsByTag(tag) {
  logger.info(`FreshService: searching tickets by tag "${tag}"`);
  const client = getClient();

  try {
    const query    = `"tag:'${tag}'"`;
    const response = await client.get('/tickets/filter', { params: { query } });
    const tickets  = response.data.tickets || [];
    logger.info(`FreshService: found ${tickets.length} ticket(s) with tag "${tag}"`);
    return tickets;
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data);
    logger.error(`FreshService: searchTicketsByTag failed [${status}] — ${body}`);
    return [];
  }
}

/**
 * Add a private note to a ticket.
 */
async function addNote(ticketId, body) {
  logger.info(`FreshService: adding note to ticket #${ticketId}`);
  const client = getClient();

  try {
    await client.post(`/tickets/${ticketId}/notes`, {
      body,
      private: false,
    });
    logger.info(`FreshService: note added to ticket #${ticketId}`);
  } catch (err) {
    const status = err.response?.status;
    const errBody = JSON.stringify(err.response?.data);
    logger.error(`FreshService: addNote failed [${status}] — ${errBody}`);
    throw new Error(`FreshService addNote error: ${status} ${errBody}`);
  }
}

/**
 * Update the status of a ticket.
 * FreshService status codes: 2=Open, 3=Pending, 4=Resolved, 5=Closed
 */
async function updateTicketStatus(ticketId, status) {
  logger.info(`FreshService: updating ticket #${ticketId} status to ${status}`);
  const client = getClient();

  try {
    await client.put(`/tickets/${ticketId}`, { status });
    logger.info(`FreshService: ticket #${ticketId} status updated to ${status}`);
  } catch (err) {
    const errStatus = err.response?.status;
    const body      = JSON.stringify(err.response?.data);
    logger.error(`FreshService: updateTicketStatus failed [${errStatus}] — ${body}`);
    throw new Error(`FreshService updateTicketStatus error: ${errStatus} ${body}`);
  }
}

module.exports = { createServiceRequest, createTicket, searchTickets, searchTicketsByTag, addNote, updateTicketStatus };
