import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(__dirname, '../logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

const LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'];

class Logger {
  constructor(context = 'APP') {
    this.context = context;
  }

  #formatTimestamp() {
    return new Date().toISOString();
  }

  #shouldLog(level) {
    return LOG_LEVELS[level] <= LOG_LEVEL;
  }

  #writeLog(level, message, data = {}) {
    if (!this.#shouldLog(level)) return;

    const timestamp = this.#formatTimestamp();
    const logEntry = {
      timestamp,
      level,
      context: this.context,
      message,
      ...data
    };

    // Console output
    const logString = `[${timestamp}] [${level}] [${this.context}] ${message}`;
    const logData = Object.keys(data).length > 0 ? JSON.stringify(data, null, 2) : '';

    switch (level) {
      case 'ERROR':
        console.error(logString);
        if (logData) console.error(logData);
        break;
      case 'WARN':
        console.warn(logString);
        if (logData) console.warn(logData);
        break;
      case 'DEBUG':
        console.debug(logString);
        if (logData) console.debug(logData);
        break;
      default:
        console.log(logString);
        if (logData) console.log(logData);
    }

    // File output - log to appropriate file
    const filename = `${level.toLowerCase()}.log`;
    const filepath = path.join(logsDir, filename);
    const fileEntry = JSON.stringify(logEntry) + '\n';

    fs.appendFileSync(filepath, fileEntry, { encoding: 'utf8' });
  }

  error(message, data = {}) {
    this.#writeLog('ERROR', message, data);
  }

  warn(message, data = {}) {
    this.#writeLog('WARN', message, data);
  }

  info(message, data = {}) {
    this.#writeLog('INFO', message, data);
  }

  debug(message, data = {}) {
    this.#writeLog('DEBUG', message, data);
  }

  trace(message, data = {}) {
    this.#writeLog('TRACE', message, data);
  }

  // Specialized loggers
  http(method, path, status, duration, data = {}) {
    this.info(`${method} ${path} ${status}`, {
      http: { method, path, status, duration_ms: duration },
      ...data
    });
  }

  security(event, data = {}) {
    this.warn(`SECURITY: ${event}`, { event, ...data });
  }

  trading(action, data = {}) {
    this.info(`TRADING: ${action}`, { action, ...data });
  }

  automation(action, data = {}) {
    this.info(`AUTOMATION: ${action}`, { action, ...data });
  }

  error_trace(error) {
    this.error('Exception occurred', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
  }
}

export function createLogger(context = 'APP') {
  return new Logger(context);
}

// Default logger instance
const defaultLogger = new Logger('DEFAULT');

export default defaultLogger;
