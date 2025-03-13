/**
 * @module utils/env
 * @description TwiMine environment variables: Loads and provides access to
 * configuration from .env file for authentication and settings
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the project root directory (two levels up from utils)
const rootDir = path.resolve(__dirname, '../../');

/**
 * Load environment variables from .env file
 * @returns {Object} Environment variables object containing TWITTER_USERNAME, TWITTER_PASSWORD, LOG_LEVEL, and TIMEOUT
 */
export function loadEnv() {
  // Check if .env file exists in the root directory
  const envPath = path.join(rootDir, '.env');
  
  if (fs.existsSync(envPath)) {
    // Load environment variables from .env file
    const result = dotenv.config({ path: envPath });
    
    if (result.error) {
      console.error('Error loading .env file:', result.error);
    } else {
      console.log('TwiMine: Successfully loaded environment variables from:', envPath);
    }
  } else {
    console.warn(`No .env file found at ${envPath}`);
  }
  
  return {
    /** @type {string|undefined} Twitter username or email for login */
    TWITTER_USERNAME: process.env.TWITTER_USERNAME,
    
    /** @type {string|undefined} Twitter password for login */
    TWITTER_PASSWORD: process.env.TWITTER_PASSWORD,
    
    /** @type {string} Logging level (debug, info, warn, error) */
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    
    /** @type {number|undefined} Custom timeout value in milliseconds */
    TIMEOUT: process.env.TIMEOUT ? parseInt(process.env.TIMEOUT, 10) : undefined
  };
}

/**
 * Environment variables loaded at module initialization
 * @type {Object}
 * @property {string|undefined} TWITTER_USERNAME - Twitter username or email for login
 * @property {string|undefined} TWITTER_PASSWORD - Twitter password for login
 * @property {string} LOG_LEVEL - Logging level (debug, info, warn, error)
 * @property {number|undefined} TIMEOUT - Custom timeout value in milliseconds
 */
const env = loadEnv();

export default env;
