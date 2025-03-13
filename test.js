#!/usr/bin/env node

import { program } from 'commander';
import dotenv from 'dotenv';
import { logger, setDebugMode } from './src/utils/logger.js';

// Load environment variables
dotenv.config();

// Set debug mode by default for testing
setDebugMode(true);

// Parse command line arguments
program
  .option('-u, --username <username>', 'Twitter username or email')
  .option('-p, --password <password>', 'Twitter password')
  .option('--headless <boolean>', 'Run in headless mode', 'false')
  .parse(process.argv);

const options = program.opts();

// Use either command line args or environment variables
const username = options.username || process.env.TWITTER_USERNAME;
const password = options.password || process.env.TWITTER_PASSWORD;
const headless = options.headless;

if (!username || !password) {
  logger.error('Username and password are required. Provide them via CLI arguments or .env file.');
  process.exit(1);
}

async function runTest() {
  // Import modules dynamically to ensure dotenv is loaded first
  const { authenticateTwitter } = await import('./src/auth.js');
  
  logger.info('Starting authentication test...');
  
  // Set a timeout for the entire test
  const testTimeout = setTimeout(() => {
    logger.error('Test timed out after 60 seconds. The authentication process may be hanging.');
    process.exit(1);
  }, 60000); // 60 second timeout
  
  try {
    // Test authentication with a simple config
    const config = {
      username,
      password,
      headless,
      debug: true,
      timeout: 30000,
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    
    logger.info('Attempting to authenticate with Twitter...');
    
    // Attempt to authenticate
    const browserObj = await authenticateTwitter(config);
    
    // If we get here, authentication was successful
    logger.info('Authentication successful! The browser did not hang.');
    
    // Clean up browser
    if (browserObj && browserObj.browser) {
      logger.info('Closing browser...');
      await browserObj.browser.close();
    }
    
    // Clear the timeout
    clearTimeout(testTimeout);
    
    logger.info('Test completed successfully.');
  } catch (error) {
    logger.error('Authentication test failed:', error);
    
    // Clear the timeout
    clearTimeout(testTimeout);
    
    process.exit(1);
  }
}

// Run the test
runTest().catch(error => {
  logger.error('Unhandled exception:', error);
  process.exit(1);
});
