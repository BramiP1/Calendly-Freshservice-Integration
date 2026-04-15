const LOG_LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR', debug: 'DEBUG' };

function timestamp() {
  return new Date().toISOString();
}

function log(level, message, extra) {
  const prefix = `[${timestamp()}] [${LOG_LEVELS[level]}]`;
  if (extra) {
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`${prefix} ${message}`, extra);
  } else {
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`${prefix} ${message}`);
  }
}

module.exports = {
  info:  (msg, extra) => log('info',  msg, extra),
  warn:  (msg, extra) => log('warn',  msg, extra),
  error: (msg, extra) => log('error', msg, extra),
  debug: (msg, extra) => log('debug', msg, extra),
};
