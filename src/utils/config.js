/**
 * @module utils/config
 * @description TwiMine configuration management: Handles loading, validation, and provides utilities for
 * directory management. Merges defaults with environment variables and CLI options.
 */

import fs from 'fs';
import path from 'path';
import { logger, setDebugMode } from './logger.js';
import env from './env.js';

/**
 * Default configuration with optimized settings
 * @type {Object}
 */
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
 * Loads configuration from various sources and merges them
 * Priority: CLI args > .env file > defaults
 * 
 * @param {Object} cliOptions - Command line options passed to the program
 * @param {string} [cliOptions.username] - Twitter username from CLI
 * @param {string} [cliOptions.password] - Twitter password from CLI
 * @param {string} [cliOptions.output] - Output JSON file path
 * @param {boolean} [cliOptions.append] - Whether to append to existing output file
 * @param {number} [cliOptions.limit] - Maximum bookmarks to scrape
 * @param {boolean|string} [cliOptions.debug] - Enable debug logging
 * @param {boolean|string} [cliOptions.headless] - Run in headless mode
 * @param {string} [cliOptions.timeout] - Operation timeout in milliseconds
 * @param {string} [cliOptions.screenshotDir] - Directory to save debug screenshots
 * @returns {Object} Complete configuration object with all settings
 * @throws {Error} If configuration validation fails
 */
export function loadConfig(cliOptions = {}) {
  logger.debug('Loading configuration...');
  
  /**
   * @type {{
   *   username: string|null;
   *   password: string|null;
   *   output: string;
   *   append: boolean;
   *   limit: number;
   *   debug: boolean;
   *   headless: boolean;
   *   viewport: {width: number, height: number};
   *   timeout: number;
   *   scrollDelay: number;
   *   maxScrolls: number;
   *   retryAttempts: number;
   *   retryDelay: number;
   *   twitterBaseUrl: string;
   *   bookmarksPath: string;
   *   userAgent: string;
   * }}
   */
  const config = {
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
        // @ts-ignore - We know this is safe because we're only setting properties that exist on config
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
  /** @type {Partial<typeof config>} */
  const sanitizedConfig = { ...config };
  // @ts-ignore - We know these properties exist
  sanitizedConfig.username = '[REDACTED]';
  // @ts-ignore - We know these properties exist
  sanitizedConfig.password = '[REDACTED]';
  logger.debug('Configuration loaded:', sanitizedConfig);
  
  return config;
}

/**
 * Validates the configuration for required fields and proper values
 * 
 * @param {Object} config - Configuration to validate
 * @param {string|null} config.username - Twitter username
 * @param {string|null} config.password - Twitter password
 * @param {number} [config.timeout] - Operation timeout in milliseconds
 * @param {number} [config.limit] - Maximum bookmarks to scrape
 * @param {number} [config.scrollDelay] - Delay between scrolls in milliseconds
 * @returns {string[]} Array of validation error messages
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
 * Ensures the output directory exists, creating it if necessary
 * 
 * @param {string} filePath - Path to the output file
 * @returns {void}
 */
export function ensureOutputDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.debug(`Created output directory: ${dir}`);
  }
}
