import fs from 'fs';
import path from 'path';
import { logger, setDebugMode } from './logger.js';
import env from './env.js';

// Default configuration with optimized settings
const defaultConfig = {
  username: env.TWITTER_USERNAME,
  password: env.TWITTER_PASSWORD,
  output: 'bookmarks.json',
  append: false,
  limit: 0, // 0 means no limit
  debug: false,
  headless: true,
  // Browser configuration
  viewport: { width: 1280, height: 900 },
  timeout: 30000, // Default timeout in ms (reduced from 60s to 30s)
  // Scraping parameters
  scrollDelay: 800, // Milliseconds between scrolls (reduced for faster operation)
  maxScrolls: 1000, // Safety limit for infinite scrolls (increased to allow for more bookmarks)
  retryAttempts: 3, // Number of retry attempts for operations
  retryDelay: 1000, // Delay between retries in ms
  // Twitter specific settings
  twitterBaseUrl: 'https://twitter.com',
  bookmarksPath: '/i/bookmarks',
  // User agent for stealth mode (updated to a more recent Chrome version)
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * Load configuration from various sources and merge them
 * Priority: CLI args > .env file > defaults
 */
export function loadConfig(cliOptions = {}) {
  logger.debug('Loading configuration...');
  
  // Create base configuration
  let config = {
    // Start with empty values for credentials, will be filled in from env vars or CLI
    username: null,
    password: null,
    output: 'bookmarks.json',
    append: false,
    limit: 0, // 0 means no limit
    debug: false,
    headless: true,
    // Browser configuration
    viewport: { width: 1280, height: 900 },
    timeout: 30000, // Default timeout in ms
    scrollDelay: 800, // Milliseconds between scrolls
    maxScrolls: 1000, // Safety limit for infinite scrolls (increased from 500)
    retryAttempts: 3, // Number of retry attempts for operations
    retryDelay: 1000, // Delay between retries in ms
    twitterBaseUrl: 'https://twitter.com',
    bookmarksPath: '/i/bookmarks',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
  
  // First load from environment variables if available
  if (env.TWITTER_USERNAME) {
    config.username = env.TWITTER_USERNAME;
    logger.debug('Loaded username from environment variables');
  }
  
  if (env.TWITTER_PASSWORD) {
    config.password = env.TWITTER_PASSWORD;
    logger.debug('Loaded password from environment variables');
  }
  
  // Use timeout from env if specified
  if (env.TIMEOUT) {
    config.timeout = env.TIMEOUT;
    logger.debug('Loaded timeout from environment variables');
  }
  
  // Override with CLI options if provided (prioritize CLI over env vars)
  Object.keys(cliOptions).forEach(key => {
    if (cliOptions[key] !== undefined) {
      // Handle boolean options
      if (key === 'headless' || key === 'debug' || key === 'append') {
        if (cliOptions[key] === 'true' || cliOptions[key] === true) {
          config[key] = true;
        } else if (cliOptions[key] === 'false' || cliOptions[key] === false) {
          config[key] = false;
        } else {
          config[key] = Boolean(cliOptions[key]);
        }
      } else {
        config[key] = cliOptions[key];
      }
      logger.debug(`Loaded ${key} from CLI arguments`);
    }
  });
  
  // Set debug mode if specified
  if (config.debug) {
    setDebugMode(true);
  }
  
  // Validate configuration
  const validationErrors = validateConfig(config);
  if (validationErrors.length > 0) {
    validationErrors.forEach(error => logger.error(error));
    throw new Error('Configuration validation failed');
  }
  
  // Log configuration (excluding sensitive data)
  const sanitizedConfig = { ...config };
  delete sanitizedConfig.username;
  delete sanitizedConfig.password;
  logger.debug('Configuration loaded:', sanitizedConfig);
  
  return config;
}

/**
 * Validates the configuration for required fields and proper values
 * @param {Object} config Configuration to validate
 * @returns {Array} Array of validation error messages
 */
function validateConfig(config) {
  const errors = [];
  
  // Check required fields
  if (!config.username) {
    errors.push('Missing required configuration: username');
  }
  
  if (!config.password) {
    errors.push('Missing required configuration: password');
  }
  
  // Validate numeric values
  if (config.timeout && (isNaN(config.timeout) || config.timeout < 1000)) {
    errors.push('Invalid timeout value: must be a number >= 1000ms');
  }
  
  if (config.limit && (isNaN(config.limit) || config.limit < 0)) {
    errors.push('Invalid limit value: must be a non-negative number');
  }
  
  if (config.scrollDelay && (isNaN(config.scrollDelay) || config.scrollDelay < 100)) {
    errors.push('Invalid scrollDelay value: must be a number >= 100ms');
  }
  
  return errors;
}

/**
 * Ensures the output directory exists
 */
export function ensureOutputDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.debug(`Created output directory: ${dir}`);
  }
}
