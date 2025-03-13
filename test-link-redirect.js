#!/usr/bin/env node

import { program } from 'commander';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Simple console logger for the test
const logger = {
  info: (msg) => console.log('\x1b[32m%s\x1b[0m', `[INFO] ${msg}`), // Green
  debug: (msg) => console.log('\x1b[36m%s\x1b[0m', `[DEBUG] ${msg}`), // Cyan
  warn: (msg) => console.log('\x1b[33m%s\x1b[0m', `[WARN] ${msg}`), // Yellow
  error: (msg, err) => {
    console.error('\x1b[31m%s\x1b[0m', `[ERROR] ${msg}`); // Red
    if (err) console.error('\x1b[31m%s\x1b[0m', err);
  }
};

// Parse command-line arguments
program
  .option('-u, --username <username>', 'Twitter username or email')
  .option('-p, --password <password>', 'Twitter password')
  .option('--headless <boolean>', 'Run in headless mode', 'false')
  .option('-d, --debug', 'Enable debug logging')
  .option('-t, --tweet-url <url>', 'Twitter tweet URL to test with embedded link')
  .parse(process.argv);

const options = program.opts();

// Use command line args or environment variables
const username = options.username || process.env.TWITTER_USERNAME;
const password = options.password || process.env.TWITTER_PASSWORD;
const headless = options.headless.toLowerCase() === 'true';
const debug = options.debug || false;
const tweetUrl = options.tweetUrl || null;

if (!username || !password) {
  logger.error('Username and password are required. Provide them via CLI arguments or .env file.');
  process.exit(1);
}

// Define browser configuration
const config = {
  headless,
  timeout: 30000,
  viewport: { width: 1280, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * Find a tweet with an external link to test the redirect following
 * @param {Page} page Playwright page instance
 * @returns {Promise<string|null>} URL of tweet with an external link
 */
async function findTweetWithLink(page) {
  // Go to bookmarks
  await page.goto('https://twitter.com/i/bookmarks');
  await page.waitForLoadState('networkidle').catch(e => 
    logger.debug('Network never reached idle state, continuing anyway')
  );
  
  // Make sure we're on the bookmarks page
  const onBookmarksPage = await page.isVisible('div:has-text("Bookmarks"), div[data-testid="primaryColumn"] h2:has-text("Bookmarks")');
  if (!onBookmarksPage) {
    logger.error('Could not verify we are on the bookmarks page');
    return null;
  }
  
  logger.info('Successfully loaded bookmarks page');
  
  // Scroll a few times to load more bookmarks
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
    await page.waitForTimeout(1000);
  }
  
  // Find all tweets with external links
  const tweets = await page.$$('article[data-testid="tweet"], div[data-testid="cellInnerDiv"]');
  logger.info(`Found ${tweets.length} tweets to check for external links`);
  
  for (const tweet of tweets) {
    // Check if it has any links
    const links = await tweet.$$('a[href*="t.co"]');
    if (links.length > 0) {
      // Get the tweet URL
      const tweetUrlElem = await tweet.$('a[href*="/status/"]');
      if (tweetUrlElem) {
        const href = await tweetUrlElem.getAttribute('href');
        if (href) {
          const fullUrl = href.startsWith('http') ? href : `https://twitter.com${href}`;
          return fullUrl;
        }
      }
    }
  }
  
  logger.warn('Could not find any tweets with external links');
  return null;
}

/**
 * Test the redirect following functionality
 */
async function testRedirectFollowing() {
  let browser;
  let context;
  let page;
  let redirectPage;
  
  try {
    // Launch browser
    logger.info(`Launching browser in ${headless ? 'headless' : 'visible'} mode...`);
    browser = await chromium.launch({
      headless: config.headless,
      timeout: config.timeout
    });
    
    // Create a new browser context with our settings
    context = await browser.newContext({
      viewport: config.viewport,
      userAgent: config.userAgent
    });
    
    // Create a page and navigate to Twitter login
    page = await context.newPage();
    page.setDefaultTimeout(config.timeout);
    
    // Login to Twitter
    logger.info('Logging in to Twitter...');
    await page.goto('https://twitter.com/login');
    
    // Enter username
    await page.waitForSelector('input[autocomplete="username"], input[name="text"]');
    await page.fill('input[autocomplete="username"], input[name="text"]', username);
    await page.click('div[role="button"]:has-text("Next"), button:has-text("Next")');
    
    // Wait for verification step to load if needed
    await page.waitForTimeout(2000);
    
    // Enter password
    await page.waitForSelector('input[name="password"], input[type="password"]');
    await page.fill('input[name="password"], input[type="password"]', password);
    await page.click('div[data-testid="LoginForm_Login_Button"], button:has-text("Log in")');
    
    // Wait for login to complete
    await page.waitForTimeout(5000);
    
    // Verify login
    const isLoggedIn = await page.isVisible('a[data-testid="AppTabBar_Home_Link"], a[href="/home"]');
    if (!isLoggedIn) {
      logger.error('Login failed. Could not verify Twitter login.');
      return false;
    }
    
    logger.info('Successfully logged in to Twitter');
    
    // Find a tweet with external links or use provided URL
    let testTweetUrl = tweetUrl;
    if (!testTweetUrl) {
      logger.info('Looking for a tweet with external links...');
      testTweetUrl = await findTweetWithLink(page);
      if (!testTweetUrl) {
        logger.error('Could not find a tweet with external links for testing');
        return false;
      }
    }
    
    logger.info(`Using tweet URL for redirect test: ${testTweetUrl}`);
    
    // Navigate to the tweet
    await page.goto(testTweetUrl);
    await page.waitForLoadState('networkidle').catch(() => {});
    
    // Create a second page for redirect testing
    redirectPage = await context.newPage();
    redirectPage.setDefaultTimeout(config.timeout / 2); // Use shorter timeout for redirects
    
    // Find all links in the tweet
    const links = await page.$$('a[href]');
    logger.info(`Found ${links.length} links in the tweet`);
    
    let foundExternalLink = false;
    
    for (const link of links) {
      const href = await link.getAttribute('href');
      
      // Skip Twitter internal links
      if (!href || 
          href.startsWith('#') || 
          href.includes('twitter.com') ||
          href.includes('x.com')) {
        continue;
      }
      
      logger.info(`Testing external link: ${href}`);
      foundExternalLink = true;
      
      try {
        // Follow the link in the redirect page
        await redirectPage.goto(href, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeout / 2
        });
        
        // Get the final URL after all redirects
        const finalUrl = redirectPage.url();
        logger.info(`Link redirected to: ${finalUrl}`);
        
        // Get the page title for additional verification
        const title = await redirectPage.title();
        logger.info(`Page title: ${title}`);
        
        return true;
      } catch (error) {
        logger.error(`Error following link redirect: ${error.message}`);
      }
    }
    
    if (!foundExternalLink) {
      logger.warn('No external links found in the tweet');
      
      // Try to find t.co links in the tweet text as fallback
      const tweetText = await page.textContent('div[data-testid="tweetText"], div[lang]');
      if (tweetText) {
        const tcoMatches = tweetText.match(/https?:\/\/t\.co\/[a-zA-Z0-9]+/g);
        if (tcoMatches && tcoMatches.length > 0) {
          logger.info(`Found t.co link in tweet text: ${tcoMatches[0]}`);
          
          try {
            await redirectPage.goto(tcoMatches[0], {
              waitUntil: 'domcontentloaded',
              timeout: config.timeout / 2
            });
            
            const finalUrl = redirectPage.url();
            logger.info(`Text link redirected to: ${finalUrl}`);
            
            const title = await redirectPage.title();
            logger.info(`Page title: ${title}`);
            
            return true;
          } catch (error) {
            logger.error(`Error following text link redirect: ${error.message}`);
          }
        }
      }
    }
    
    logger.error('No usable external links found in the tweet');
    return false;
  } catch (error) {
    logger.error('Error during redirect test:', error);
    return false;
  } finally {
    // Close pages and browser
    if (redirectPage) {
      await redirectPage.close().catch(() => {});
    }
    
    if (browser) {
      logger.info('Closing browser...');
      await browser.close().catch(() => {});
    }
  }
}

// Run the test
testRedirectFollowing().then(success => {
  if (success) {
    logger.info('Redirect test completed successfully!');
    process.exit(0);
  } else {
    logger.error('Redirect test failed!');
    process.exit(1);
  }
}).catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
