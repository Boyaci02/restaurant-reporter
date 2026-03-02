import winston from 'winston';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Creates a scoped Winston logger for a specific module and optionally a customer.
 * @param {string} moduleName - Name of the calling module (e.g. 'metricool', 'mailer')
 * @param {string} [customerId] - Optional customer ID for tracing
 * @returns {winston.Logger}
 */
export function createLogger(moduleName, customerId = null) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const logFile = path.join(logsDir, `${monthKey}.log`);

  const defaultMeta = customerId
    ? { module: moduleName, customerId }
    : { module: moduleName };

  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, module: mod, customerId: cid, ...rest }) => {
            const prefix = cid ? `[${mod}][${cid}]` : `[${mod}]`;
            const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
            return `${timestamp} ${level} ${prefix} ${message}${extra}`;
          })
        )
      }),
      new winston.transports.File({
        filename: logFile,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.json()
        )
      })
    ]
  });
}
