require('dotenv').config();
const express = require('express');
const webhookRouter = require('./routes/webhook');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse raw body for webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));

// Parse JSON for all other routes
app.use(express.json());

// Health check — also used as the keep-alive ping target for UptimeRobot / Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Calendly webhook route
app.use('/webhook', webhookRouter);

// 404 handler
app.use((req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`Calendly-FreshService Connector running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`Webhook endpoint: http://localhost:${PORT}/webhook/calendly`);
});
