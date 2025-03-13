#!/usr/bin/env node

/**
 * @module index
 * @description Main entry point for the TwiMine CLI tool.
 * Handles command line arguments, authentication, scraping, and output processing
 * to mine valuable links from Twitter bookmarks.
 */

import { program } from 'commander';
import { authenticateTwitter } from './auth.js';
import { scrapeBookmarks } from './bookmarks.js';
import { processOutput, generateSummary } from './output.js';
import { logger, fatalError } from './utils/logger.js';
import { loadConfig } from './utils/config.js';
import env from './utils/env.js';

// Log environment variables for debugging (hiding sensitive information)
logger.debug('Environment variables loaded. TWITTER_USERNAME exists: ' + 
  (env.TWITTER_USERNAME ? 'Yes' : 'No'));
logger.debug('Environment variables loaded. TWITTER_PASSWORD exists: ' + 
  (env.TWITTER_PASSWORD ? 'Yes' : 'No'));

// Global variables to track execution
/** @type {import('playwright').Browser|null} */
let browser = null;

/**
 * Clean up resources when process is terminated
 * @returns {Promise<void>}
 */
async function cleanupResources() {
  logger.info('Process interrupted. Cleaning up...');
  if (browser) {
    await browser.close().catch(e => logger.debug('Error closing browser on SIGINT:', e.message));
  }
  process.exit(0);
}

// Register cleanup handler for SIGINT (Ctrl+C)
process.on('SIGINT', cleanupResources);

/**
 * Main application function that handles CLI arguments,
 * authentication, scraping, and processing output
 * 
 * @returns {Promise<number>} Exit code (0 for success, 1 for error)
 */
async function main() {
  try {
    // CLI Configuration
    program
      .name('twimine')
      .description('TwiMine: Mining your twitter bookmarks for gold')
      .version('1.0.0')
      .option('-u, --username <username>', 'Twitter username or email')
      .option('-p, --password <password>', 'Twitter password')
      .option('-o, --output <file>', 'Output JSON file', 'bookmarks.json')
      .option('-a, --append', 'Append to existing output file', false)
      .option('-l, --limit <number>', 'Maximum number of bookmarks to scrape', parseInt)
      .option('-d, --debug', 'Enable debug logging', false)
      .option('--headless <boolean>', 'Run in headless mode (default: true)')
      .option('--timeout <milliseconds>', 'Timeout for operations in milliseconds', parseInt)
      .option('--screenshot-dir <directory>', 'Directory to save debug screenshots')
      .parse(process.argv);

    const options = program.opts();
    
    // Initial status message
    logger.info('TwiMine starting...');
    
    // Load config and merge with CLI options
    const config = loadConfig(options);
    
    try {
      // Initialize browser and authenticate
      logger.info('Authenticating with Twitter...');
      const browserObj = await authenticateTwitter(config);
      browser = browserObj.browser; // Store for cleanup on interrupt
      
      // Scrape bookmarks with detailed console feedback
      logger.info('Starting to scrape bookmarks...');
      // Set debug level higher temporarily if not already in debug mode
      const originalLogLevel = logger.level;
      if (originalLogLevel !== 'debug') {
        logger.level = 'info'; // Ensure we see important processing messages
      }
      
      const bookmarks = await scrapeBookmarks(browserObj, config);
      const originalCount = bookmarks.length;
      
      // Restore original log level
      logger.level = originalLogLevel;
      
      // Process and save output
      const processedBookmarks = await processOutput(bookmarks, config);
      
      // Close browser
      logger.info('Closing browser...');
      await browser.close();
      browser = null;
      
      // Display summary
      const summary = generateSummary(processedBookmarks, originalCount, config);
      console.log('\n' + summary);
      
      logger.info('TwiMine completed successfully');
      return 0;
    } catch (error) {
      // Cleanup browser resources if there was an error
      if (browser) {
        await browser.close().catch(e => logger.debug('Error closing browser during error handling:', e.message));
        browser = null;
      }
      
      // Re-throw the error to be handled by the outer catch block
      throw error;
    }
  } catch (error) {
    // Handle all top-level errors
    logger.error('Error occurred during scraping process:');
    if (error.stack) {
      logger.error(error.stack);
    } else {
      logger.error(error.message || error);
    }
    
    // Provide more specific error guidance based on the error message
    if (error.message?.includes('authentication')) {
      logger.error('Authentication error - please check your Twitter credentials and try again');
      logger.error('If you use 2FA, you may need to temporarily disable it or use an app password');
    } else if (error.message?.includes('timeout')) {
      logger.error('Operation timed out - this could be due to slow internet connection or Twitter rate limiting');
      logger.error('Try again later or use the --timeout option to increase the timeout value');
    } else if (error.message?.includes('navigation') || error.message?.includes('ERR_CONNECTION')) {
      logger.error('Network error - please check your internet connection and try again');
    }
    
    logger.error('For more detailed debugging information, run with the -d option');
    
    return 1;
  }
}

// Run the main function
main().then(exitCode => {
  process.exit(exitCode);
}).catch(error => {
  logger.error('Unhandled exception:', error);
  process.exit(1);
});
