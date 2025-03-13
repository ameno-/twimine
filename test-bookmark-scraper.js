#!/usr/bin/env node

import { program } from 'commander';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { chromium } from 'playwright';
import { logger } from './src/utils/logger.js';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Parse command-line arguments
program
  .option('-u, --username <username>', 'Twitter username or email')
  .option('-p, --password <password>', 'Twitter password')
  .option('--headless <boolean>', 'Run in headless mode', 'false')
  .option('-d, --debug', 'Enable debug logging')
  .option('-t, --test-action <action>', 'Test action to perform', 'github-extraction')
  .parse(process.argv);

const options = program.opts();

// Configure debug mode
if (options.debug) {
  logger.level = 'debug';
}

// Use command line args or environment variables
const username = options.username || process.env.TWITTER_USERNAME;
const password = options.password || process.env.TWITTER_PASSWORD;
const headless = options.headless === 'true';

if (!username || !password) {
  logger.error('Username and password are required. Provide them via CLI arguments or .env file.');
  process.exit(1);
}

/**
 * Test the GitHub URL extraction from tweet text
 */
async function testGitHubExtraction() {
  // Sample tweets with GitHub URLs
  const sampleTweets = [
    {
      text: "Check out my new project: https://github.com/username/cool-project #opensource",
      expectedUrl: "https://github.com/username/cool-project"
    },
    {
      text: "I've been working on https://github.com/user-name/project-name which solves...",
      expectedUrl: "https://github.com/user-name/project-name"
    },
    {
      text: "No GitHub URL in this tweet, just talking about code.",
      expectedUrl: null
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  logger.info('Testing GitHub URL extraction from tweet text...');
  console.log();
  
  for (let i = 0; i < sampleTweets.length; i++) {
    const { text, expectedUrl } = sampleTweets[i];
    logger.info(`Test #${i + 1}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    
    // Extract GitHub URL using the same regex as in the main code
    const githubUrlRegex = /https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/g;
    const matches = text.match(githubUrlRegex);
    
    const extractedUrl = matches && matches.length > 0 ? 
      matches[0] : null;
    
    if ((extractedUrl === expectedUrl) || 
        (extractedUrl === null && expectedUrl === null)) {
      logger.info('✓ PASSED');
      passed++;
    } else {
      logger.error('✗ FAILED');
      logger.error(`Expected: ${expectedUrl}`);
      logger.error(`Actual: ${extractedUrl}`);
      failed++;
    }
    
    console.log();
  }
  
  logger.info(`GitHub extraction test results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

/**
 * Test the bookmark extraction process with a simplified approach
 */
async function testBookmarkExtraction() {
  logger.info('Starting simplified bookmark extraction test...');
  
  // Browser configuration
  const config = {
    headless,
    timeout: 30000,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
  
  let browser;
  let page;
  
  try {
    // Launch browser
    logger.info('Launching browser...');
    browser = await chromium.launch({
      headless: config.headless,
      timeout: config.timeout
    });
    
    // Create context and page
    const context = await browser.newContext({
      viewport: config.viewport,
      userAgent: config.userAgent
    });
    
    page = await context.newPage();
    page.setDefaultTimeout(config.timeout);
    
    // Navigate to Twitter login page
    logger.info('Navigating to Twitter login...');
    await page.goto('https://twitter.com/login');
    
    // Login sequence
    logger.info('Attempting to log in...');
    
    // Enter username
    await page.waitForSelector('input[autocomplete="username"], input[name="text"]');
    await page.fill('input[autocomplete="username"], input[name="text"]', username);
    await page.click('div[role="button"]:has-text("Next"), button:has-text("Next")');
    
    // There might be a verification step if Twitter thinks the login is suspicious
    await page.waitForTimeout(2000);
    
    // Enter password 
    await page.waitForSelector('input[name="password"], input[type="password"]');
    await page.fill('input[name="password"], input[type="password"]', password);
    await page.click('div[data-testid="LoginForm_Login_Button"], button:has-text("Log in")');
    
    // Wait for login to complete
    await page.waitForTimeout(5000);
    
    // Verify we're logged in by checking for home elements
    logger.info('Verifying login...');
    const isLoggedIn = await page.isVisible('a[data-testid="AppTabBar_Home_Link"], a[href="/home"]');
    
    if (!isLoggedIn) {
      logger.error('Login verification failed. Not logged in to Twitter.');
      if (config.headless) {
        logger.info('Try running with --headless false to see what\'s happening.');
      }
      return false;
    }
    
    logger.info('Successfully logged in to Twitter');
    
    // Navigate to bookmarks
    logger.info('Navigating to bookmarks page...');
    await page.goto('https://twitter.com/i/bookmarks');
    await page.waitForTimeout(3000);
    
    // Check if we can access bookmarks
    const onBookmarksPage = await page.isVisible('div:has-text("Bookmarks"), div[data-testid="primaryColumn"] h2:has-text("Bookmarks")');
    
    if (!onBookmarksPage) {
      logger.error('Could not verify we are on the bookmarks page.');
      return false;
    }
    
    logger.info('Successfully loaded bookmarks page');
    
    // Check if we can see bookmarks
    const hasTweets = await page.isVisible('article[data-testid="tweet"], div[data-testid="cellInnerDiv"]');
    
    if (!hasTweets) {
      logger.warning('No bookmarks found on the page - this could be normal if your account has no bookmarks');
    } else {
      logger.info('Successfully found bookmarks on the page');
      
      // Attempt to find GitHub URLs in visible bookmarks
      const bookmarkInfo = await page.evaluate(() => {
        const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"], div[data-testid="cellInnerDiv"]'));
        return tweets.slice(0, 5).map(tweet => {
          // Get tweet text
          const tweetTextEl = tweet.querySelector('div[data-testid="tweetText"], div[lang]');
          const tweetText = tweetTextEl ? tweetTextEl.textContent : '';
          
          // Get author
          const authorEl = tweet.querySelector('div[data-testid="User-Name"] a:nth-child(2), a[role="link"][href*="/"]');
          const author = authorEl ? authorEl.textContent : '';
          
          return { author, tweetText };
        });
      });
      
      logger.info(`Found ${bookmarkInfo.length} bookmarks to analyze`);
      
      // Check for GitHub links in the first few bookmarks
      let foundGitHubUrl = false;
      
      for (const bookmark of bookmarkInfo) {
        // Extract GitHub URL using the same regex as in the main code
        const githubUrlRegex = /https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/g;
        const matches = bookmark.tweetText.match(githubUrlRegex);
        
        if (matches && matches.length > 0) {
          logger.info(`Found GitHub URL in bookmark: ${matches[0]}`);
          logger.info(`From author: ${bookmark.author}`);
          foundGitHubUrl = true;
          break;
        }
      }
      
      if (!foundGitHubUrl) {
        logger.info('No GitHub URLs found in the sample of bookmarks. This is normal if your bookmarks don\'t contain GitHub links.');
      }
    }
    
    logger.info('Bookmark extraction test completed successfully');
    return true;
  } catch (error) {
    logger.error('Error during bookmark extraction test:', error);
    return false;
  } finally {
    // Close browser
    if (browser) {
      logger.info('Closing browser...');
      await browser.close();
    }
  }
}

async function runTest() {
  switch (options.testAction) {
    case 'github-extraction':
      return await testGitHubExtraction();
    
    case 'bookmark-extraction':
      return await testBookmarkExtraction();
      
    default:
      logger.error(`Unknown test action: ${options.testAction}`);
      return false;
  }
}

// Run the selected test
runTest().then(success => {
  if (success) {
    logger.info('Test completed successfully!');
    process.exit(0);
  } else {
    logger.error('Test failed!');
    process.exit(1);
  }
}).catch(error => {
  logger.error('Unhandled error during test:', error);
  process.exit(1);
});
