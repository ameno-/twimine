import winston from 'winston';

// Create custom logger with improved formatting
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'twitter-bookmark-scraper' },
  transports: [
    // Write all logs with level 'error' to stderr with color
    new winston.transports.Console({
      level: 'error',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, stack, ...rest }) => {
          // Print error stack traces when available
          if (stack) {
            return `${level}: ${message}\n${stack}`;
          }
          return `${level}: ${message} ${Object.keys(rest).length ? JSON.stringify(rest) : ''}`;
        })
      )
    }),
    // Write all logs to stdout with color and formatting
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...rest }) => {
          // Exclude service name from regular logs to reduce clutter
          const meta = { ...rest };
          delete meta.service;
          
          return `${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      )
    })
  ]
});

// Adjust log level if in debug mode
export function setDebugMode(debug) {
  if (debug) {
    logger.level = 'debug';
    logger.debug('Debug logging enabled');
  }
}

// Utility method for critical errors that should stop execution
export function fatalError(message, error) {
  if (error) {
    logger.error(`FATAL: ${message}`, { error: error.message, stack: error.stack });
  } else {
    logger.error(`FATAL: ${message}`);
  }
  process.exit(1);
}
