const logger = require('../utils/logger');
const freshservice = require('../services/freshservice');

/**
 * Routes a Calendly webhook event to the appropriate handler.
 */
async function handleCalendlyEvent(eventType, payload) {
  switch (eventType) {
    case 'invitee.created':
      await handleInviteeCreated(payload);
      break;
    case 'invitee.canceled':
      await handleInviteeCanceled(payload);
      break;
    default:
      logger.warn(`Unhandled Calendly event type: "${eventType}" — skipping`);
  }
}

/**
 * invitee.created → Create a FreshService ticket for the scheduled meeting.
 */
const ALLOWED_EVENT_NAMES = [
  'iPostal1 Onboarding Training Session.',
];

async function handleInviteeCreated(payload) {
  const { invitee, event } = payload.payload || {};

  if (!invitee || !event) {
    logger.error('invitee.created payload missing invitee or event data');
    throw new Error('Malformed invitee.created payload');
  }

  const eventName = event.name || '';
  if (!ALLOWED_EVENT_NAMES.includes(eventName)) {
    logger.info(`Skipping "${eventName}" — not in allowed event types`);
    return;
  }

  const inviteeName   = invitee.name || 'Unknown';
  const inviteeEmail  = invitee.email || process.env.FRESHSERVICE_DEFAULT_EMAIL;
  const inviteePhone  = invitee.text_reminder_number || null;
  const inviteeTimezone = invitee.timezone || null;
  const startTime     = event.start_time ? new Date(event.start_time).toLocaleString() : 'Unknown';
  const endTime       = event.end_time   ? new Date(event.end_time).toLocaleString()   : 'Unknown';
  const meetingLink   = event.location?.join_url || event.location?.location || 'N/A';
  const cancelUrl     = invitee.cancel_url || 'N/A';
  const rescheduleUrl = invitee.reschedule_url || 'N/A';
  const questionsAndAnswers = invitee.questions_and_answers || [];

  const ticketSubject = `[Calendly] ${eventName} with ${inviteeName}`;

  const noteLines = [
    `<b>A new meeting has been scheduled via Calendly.</b>`,
    ``,
    `<b>Event:</b> ${eventName}`,
    `<b>Invitee:</b> ${inviteeName} (${inviteeEmail})`,
  ];
  if (inviteePhone)    noteLines.push(`<b>Phone:</b> ${inviteePhone}`);
  if (inviteeTimezone) noteLines.push(`<b>Time Zone:</b> ${inviteeTimezone}`);
  noteLines.push(
    `<b>Start:</b> ${startTime}`,
    `<b>End:</b> ${endTime}`,
    `<b>Meeting Link:</b> ${meetingLink}`,
  );

  if (questionsAndAnswers.length > 0) {
    noteLines.push(``, `<b>--- Invitee Questions ---</b>`);
    for (const qa of questionsAndAnswers) {
      if (qa.answer) noteLines.push(`<b>${qa.question}:</b> ${qa.answer}`);
    }
  }

  noteLines.push(
    ``,
    `<b>Cancel URL:</b> ${cancelUrl}`,
    `<b>Reschedule URL:</b> ${rescheduleUrl}`,
  );

  const ticketBody = noteLines.join('<br>');

  // Extract the unique event UUID from the Calendly event URI
  // e.g. https://api.calendly.com/scheduled_events/ABCDEF123456 → ABCDEF123456
  const eventUuid = event.uri ? `calendly-evt-${event.uri.split('/').pop()}` : null;
  const tags = ['calendly', 'meeting-scheduled'];
  if (eventUuid) tags.push(eventUuid);

  if (eventUuid) logger.info(`Tagging with Calendly event ID: ${eventUuid}`);

  const serviceItemId = parseInt(process.env.FRESHSERVICE_SERVICE_ITEM_ID, 10);

  if (serviceItemId) {
    // --- Service Catalog path ---
    logger.info(`Creating FreshService service request under service item #${serviceItemId}`);
    const sr = await freshservice.createServiceRequest({
      serviceItemId,
      email: inviteeEmail,
      noteBody: ticketBody,
      tags,
    });
    logger.info(`FreshService service request created: #${sr.id}`);
  } else {
    // --- Fallback: plain ticket (no service item configured) ---
    logger.warn('FRESHSERVICE_SERVICE_ITEM_ID not set — falling back to plain ticket creation');
    const ticket = await freshservice.createTicket({
      subject: ticketSubject,
      description: ticketBody,
      email: inviteeEmail,
      priority: parseInt(process.env.FRESHSERVICE_DEFAULT_PRIORITY, 10) || 2,
      status: 2,
      tags,
    });
    logger.info(`FreshService ticket created: #${ticket.id} — "${ticketSubject}"`);
  }
}

/**
 * invitee.canceled → Add a cancellation note to the existing ticket (best-effort)
 * or create a new cancellation ticket if no prior ticket is found.
 */
async function handleInviteeCanceled(payload) {
  const { invitee, event } = payload.payload || {};

  if (!invitee || !event) {
    logger.error('invitee.canceled payload missing invitee or event data');
    throw new Error('Malformed invitee.canceled payload');
  }

  const inviteeName   = invitee.name || 'Unknown';
  const inviteeEmail  = invitee.email || process.env.FRESHSERVICE_DEFAULT_EMAIL;
  const eventName     = event.name || 'Meeting';
  const cancelReason  = invitee.cancellation?.reason || 'No reason provided';
  const canceledBy    = invitee.cancellation?.canceler_name || 'Unknown';

  // Use the Calendly event UUID tag for an exact 1:1 match
  const eventUuid = event.uri ? `calendly-evt-${event.uri.split('/').pop()}` : null;

  logger.info(`Meeting canceled — searching for ticket with tag "${eventUuid || 'N/A'}"`);

  const existingTickets = eventUuid
    ? await freshservice.searchTicketsByTag(eventUuid)
    : await freshservice.searchTickets(inviteeEmail, eventName); // fallback if URI missing

  const cancellationNote = [
    `<b>This meeting has been canceled.</b>`,
    ``,
    `<b>Canceled by:</b> ${canceledBy}`,
    `<b>Reason:</b> ${cancelReason}`,
  ].join('<br>');

  if (existingTickets.length > 0) {
    const ticket = existingTickets[0];
    logger.info(`Found existing ticket #${ticket.id} — adding cancellation note`);
    await freshservice.addNote(ticket.id, cancellationNote);
    await freshservice.updateTicketStatus(ticket.id, 5); // 5 = Closed in FreshService
    logger.info(`Ticket #${ticket.id} updated with cancellation and closed`);
  } else {
    logger.warn(`No existing ticket found for ${inviteeEmail} — creating cancellation ticket`);
    const ticket = await freshservice.createTicket({
      subject: `[Calendly] CANCELED: ${eventName} with ${inviteeName}`,
      description: cancellationNote,
      email: inviteeEmail,
      priority: parseInt(process.env.FRESHSERVICE_DEFAULT_PRIORITY, 10) || 2,
      status: 5, // Closed
      tags: ['calendly', 'meeting-canceled'],
    });
    logger.info(`Cancellation ticket created: #${ticket.id}`);
  }
}

module.exports = { handleCalendlyEvent };
