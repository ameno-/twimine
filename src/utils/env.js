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
 * @returns {Object} Environment variables
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
      console.log('Successfully loaded environment variables from:', envPath);
    }
  } else {
    console.warn(`No .env file found at ${envPath}`);
  }
  
  return {
    TWITTER_USERNAME: process.env.TWITTER_USERNAME,
    TWITTER_PASSWORD: process.env.TWITTER_PASSWORD,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    TIMEOUT: process.env.TIMEOUT ? parseInt(process.env.TIMEOUT, 10) : undefined
  };
}

// Load environment variables immediately
const env = loadEnv();

export default env;
