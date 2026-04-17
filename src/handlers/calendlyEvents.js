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
  'iPostal1 Launch Call.',
];

async function handleInviteeCreated(payload) {
  const inviteeData    = payload.payload || {};
  const scheduledEvent = inviteeData.scheduled_event || {};

  if (!inviteeData.email || !scheduledEvent.uri) {
    logger.error('invitee.created payload missing required data');
    logger.error('Payload keys received: ' + JSON.stringify(Object.keys(inviteeData)));
    throw new Error('Malformed invitee.created payload');
  }

  const eventName = scheduledEvent.name || '';
  if (!ALLOWED_EVENT_NAMES.includes(eventName)) {
    logger.info(`Skipping "${eventName}" — not in allowed event types`);
    return;
  }

  const inviteeName     = inviteeData.name || 'Unknown';
  const inviteeEmail    = inviteeData.email || process.env.FRESHSERVICE_DEFAULT_EMAIL;
  const inviteePhone    = inviteeData.text_reminder_number || null;
  const inviteeTimezone = inviteeData.timezone || null;
  const startTime       = scheduledEvent.start_time ? new Date(scheduledEvent.start_time).toLocaleString() : 'Unknown';
  const endTime         = scheduledEvent.end_time   ? new Date(scheduledEvent.end_time).toLocaleString()   : 'Unknown';
  const meetingLink     = scheduledEvent.location?.join_url || scheduledEvent.location?.location || 'N/A';
  const cancelUrl       = inviteeData.cancel_url || 'N/A';
  const rescheduleUrl   = inviteeData.reschedule_url || 'N/A';
  const questionsAndAnswers = inviteeData.questions_and_answers || [];

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

  const eventUuid = scheduledEvent.uri ? `calendly-evt-${scheduledEvent.uri.split('/').pop()}` : null;
  const tags = ['calendly', 'meeting-scheduled'];
  if (eventUuid) tags.push(eventUuid);

  if (eventUuid) logger.info(`Tagging with Calendly event ID: ${eventUuid}`);

  const serviceItemId = parseInt(process.env.FRESHSERVICE_SERVICE_ITEM_ID, 10);

  if (serviceItemId) {
    logger.info(`Creating FreshService service request under service item #${serviceItemId}`);
    const sr = await freshservice.createServiceRequest({
      serviceItemId,
      email: inviteeEmail,
      noteBody: ticketBody,
      tags,
    });
    logger.info(`FreshService service request created: #${sr.id}`);
  } else {
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
  const inviteeData    = payload.payload || {};
  const scheduledEvent = inviteeData.scheduled_event || {};

  if (!inviteeData.email) {
    logger.error('invitee.canceled payload missing email');
    throw new Error('Malformed invitee.canceled payload');
  }

  const inviteeName  = inviteeData.name || 'Unknown';
  const inviteeEmail = inviteeData.email || process.env.FRESHSERVICE_DEFAULT_EMAIL;
  const eventName    = scheduledEvent.name || 'Meeting';
  const cancelReason = inviteeData.cancellation?.reason || 'No reason provided';
  const canceledBy   = inviteeData.cancellation?.canceler_name || 'Unknown';

  const eventUuid = scheduledEvent.uri ? `calendly-evt-${scheduledEvent.uri.split('/').pop()}` : null;

  logger.info(`Meeting canceled — searching for ticket with tag "${eventUuid || 'N/A'}"`);

  const existingTickets = eventUuid
    ? await freshservice.searchTicketsByTag(eventUuid)
    : await freshservice.searchTickets(inviteeEmail, eventName);

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
    await freshservice.updateTicketStatus(ticket.id, 5);
    logger.info(`Ticket #${ticket.id} updated with cancellation and closed`);
  } else {
    logger.warn(`No existing ticket found for ${inviteeEmail} — creating cancellation ticket`);
    const ticket = await freshservice.createTicket({
      subject: `[Calendly] CANCELED: ${eventName} with ${inviteeName}`,
      description: cancellationNote,
      email: inviteeEmail,
      priority: parseInt(process.env.FRESHSERVICE_DEFAULT_PRIORITY, 10) || 2,
      status: 5,
      tags: ['calendly', 'meeting-canceled'],
    });
    logger.info(`Cancellation ticket created: #${ticket.id}`);
  }
}

module.exports = { handleCalendlyEvent };
