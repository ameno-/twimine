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
  .option('-l, --limit <number>', 'Limit number of bookmarks to test', '5')
  .parse(process.argv);

const options = program.opts();

// Use command line args or environment variables
const username = options.username || process.env.TWITTER_USERNAME;
const password = options.password || process.env.TWITTER_PASSWORD;
const headless = options.headless.toLowerCase() === 'true';
const debug = options.debug || true; // Enable debug mode by default for testing
const limit = parseInt(options.limit) || 5;

// Configure logging based on debug mode
if (debug) {
  // Override info and debug loggers to always show in debug mode
  logger.info = (msg) => console.log('\x1b[32m%s\x1b[0m', `[INFO] ${msg}`);
  logger.debug = (msg) => console.log('\x1b[36m%s\x1b[0m', `[DEBUG] ${msg}`);
} else {
  // In non-debug mode, debug messages are suppressed
  logger.debug = () => {};
}

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
 * Get tweetURLs from bookmarks page
 */
async function getBookmarkTweetURLs(page, maxCount = 10) {
  logger.info('Navigating to Twitter bookmarks page...');

  // Go to bookmarks with more robust navigation
  try {
    await page.goto('https://twitter.com/i/bookmarks', { 
      waitUntil: 'domcontentloaded',
      timeout: config.timeout
    });
  } catch (error) {
    logger.error(`Failed to navigate to bookmarks: ${error.message}`);
    // Try an alternative navigation method
    try {
      logger.debug('Trying alternative navigation to bookmarks...');
      await page.goto('https://twitter.com/home');
      await page.waitForTimeout(3000);
      await page.click('a[data-testid="AppTabBar_Bookmarks_Link"], a[href="/i/bookmarks"]');
      await page.waitForTimeout(3000);
    } catch (altError) {
      logger.error(`Alternative navigation failed: ${altError.message}`);
    }
  }

  // Wait for the page to stabilize
  await page.waitForLoadState('networkidle').catch(e => 
    logger.debug('Network never reached idle state, continuing anyway')
  );
  
  // Take a screenshot to debug
  if (debug) {
    await page.screenshot({ path: 'bookmarks-page.png' });
    logger.debug('Saved screenshot to bookmarks-page.png');
  }
  
  // Check for various bookmark page indicators with more comprehensive selectors
  logger.debug('Verifying we are on the bookmarks page...');
  const bookmarksIndicators = [
    'div:has-text("Bookmarks")',
    'div[data-testid="primaryColumn"] h2:has-text("Bookmarks")',
    'a[href="/i/bookmarks"][aria-selected="true"]',
    'div[aria-label="Timeline: Bookmarks"]',
    '[data-testid="BookmarkTimeline"]',
    'header:has-text("Bookmarks")'
  ];
  
  let onBookmarksPage = false;
  for (const selector of bookmarksIndicators) {
    try {
      const hasIndicator = await page.isVisible(selector);
      if (hasIndicator) {
        onBookmarksPage = true;
        logger.debug(`Found bookmarks page indicator: ${selector}`);
        break;
      }
    } catch (e) {
      logger.debug(`Error checking selector ${selector}: ${e.message}`);
    }
  }
  
  if (!onBookmarksPage) {
    // Try one last check with direct content check
    const pageContent = await page.content();
    if (pageContent.includes('Bookmarks') || pageContent.includes('bookmark')) {
      logger.debug('Found "Bookmarks" in page content, proceeding anyway');
      onBookmarksPage = true;
    } else {
      logger.error('Could not verify we are on the bookmarks page');
      return [];
    }
  }
  
  logger.info('Successfully loaded bookmarks page');
  
  // Scroll a few times to load more bookmarks
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
    await page.waitForTimeout(1000);
  }
  
  // Find bookmark tweets with multiple selection strategies
  await page.waitForTimeout(2000); // Wait a bit for tweets to load
  
  // Take a screenshot of the loaded tweets for debugging
  if (debug) {
    await page.screenshot({ path: 'bookmarks-loaded.png' });
    logger.debug('Saved screenshot to bookmarks-loaded.png');
  }
  
  // Try multiple strategies to find tweet elements
  let tweetUrls = [];
  
  try {
    // First strategy: Use querySelector directly
    tweetUrls = await page.evaluate(() => {
      // Try multiple selectors to find tweets
      const tweetSelectors = [
        'article[data-testid="tweet"]', 
        'div[data-testid="cellInnerDiv"]',
        'article',
        'div[data-testid="bookmark-item"]',
        // More generic fallbacks
        'a[href*="/status/"]',
        '[role="article"]'
      ];
      
      let tweets = [];
      
      // Try each selector until we find tweets
      for (const selector of tweetSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements && elements.length > 0) {
          console.log(`Found ${elements.length} elements with selector: ${selector}`);
          tweets = Array.from(elements);
          break;
        }
      }
      
      const urls = [];
      
      // Extract status URLs from tweets
      for (const tweet of tweets) {
        // Try multiple strategies to find the tweet link
        const selectors = [
          'a[href*="/status/"]',
          'a[role="link"][href*="/status/"]',
          'time[datetime] a',
          'a[href*="twitter.com"][href*="/status/"]',
          'a[href*="x.com"][href*="/status/"]'
        ];
        
        for (const selector of selectors) {
          const link = tweet.querySelector(selector);
          if (link && link.href && link.href.includes('/status/')) {
            urls.push(link.href);
            break;
          }
        }
      }
      
      return urls;
    });
  } catch (evalError) {
    logger.error(`Error during tweet URL extraction: ${evalError.message}`);
  }
  
  // If no URLs found, try a more direct approach
  if (tweetUrls.length === 0) {
    logger.debug('Direct extraction failed, trying alternative approach...');
    
    try {
      // Just look for any status links on the page
      const links = await page.$$('a[href*="/status/"]');
      for (const link of links) {
        const href = await link.getAttribute('href');
        if (href && (href.includes('/status/') || href.includes('/statuses/'))) {
          const fullUrl = href.startsWith('http') ? href : 
            (href.startsWith('/') ? `https://twitter.com${href}` : `https://twitter.com/${href}`);
          tweetUrls.push(fullUrl);
        }
      }
    } catch (altError) {
      logger.error(`Alternative extraction failed: ${altError.message}`);
    }
  }
  
  // Deduplicate URLs
  tweetUrls = [...new Set(tweetUrls)];
  
  logger.info(`Found ${tweetUrls.length} bookmarked tweets`);
  
  // Return limited number of URLs
  return tweetUrls.slice(0, maxCount);
}

/**
 * Test finding GitHub links in tweet replies
 */
async function testReplyLinks() {
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
    
    // Create browser context with our settings
    context = await browser.newContext({
      viewport: config.viewport,
      userAgent: config.userAgent
    });
    
    // Create page and navigate to Twitter login
    page = await context.newPage();
    page.setDefaultTimeout(config.timeout);
    
    // Create redirect page
    redirectPage = await context.newPage();
    redirectPage.setDefaultTimeout(config.timeout / 2);
    
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
    
    // Get bookmark tweet URLs
    const tweetUrls = await getBookmarkTweetURLs(page, limit);
    if (tweetUrls.length === 0) {
      logger.error('No bookmarks found for testing');
      return false;
    }
    
    // Process each tweet
    let processedCount = 0;
    let foundGitHubLinks = 0;
    
    for (const tweetUrl of tweetUrls) {
      logger.info(`Testing tweet ${++processedCount}/${tweetUrls.length}: ${tweetUrl}`);
      
      try {
        // Navigate to the tweet to see replies
        await page.goto(tweetUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        
        // Find the main tweet
        const mainTweet = await page.$('article[data-testid="tweet"]');
        if (!mainTweet) {
          logger.warn('Could not find the main tweet element');
          continue;
        }
        
        // Get all tweets on the page
        const allTweets = await page.$$('article[data-testid="tweet"]');
        
        // Filter out replies (any tweets after the main one)
        const replyTweets = [];
        let foundMainTweet = false;
        
        for (const tweet of allTweets) {
          if (foundMainTweet) {
            replyTweets.push(tweet);
          } else if (tweet === mainTweet) {
            foundMainTweet = true;
          }
        }
        
        logger.debug(`Found ${replyTweets.length} replies to the tweet`);
        
        if (replyTweets.length === 0) {
          logger.debug('No replies found for this tweet');
          continue;
        }
        
        // Check each reply for external links
        let foundLink = false;
        
        for (const reply of replyTweets) {
          // Find all links in the reply
          const links = await reply.$$('a[href]');
          
          if (links.length === 0) {
            continue;
          }
          
          // Try each link in the reply
          for (const link of links) {
            const href = await link.getAttribute('href');
            
            // Skip Twitter internal links
            if (!href || 
                href.startsWith('#') || 
                href.includes('twitter.com') || 
                href.includes('x.com') ||
                href.includes('/status/')) {
              continue;
            }
            
            logger.debug(`Found external link in reply: ${href}`);
            
            try {
              // Follow the link to get final URL after redirects
              await redirectPage.goto(href, {
                waitUntil: 'domcontentloaded',
                timeout: config.timeout / 2
              });
              
              const finalUrl = redirectPage.url();
              logger.debug(`Link redirected to: ${finalUrl}`);
              
              // Check if it's a GitHub URL
              if (finalUrl.includes('github.com') && 
                  !finalUrl.includes('github.com/login') && 
                  !finalUrl.includes('github.com/signup')) {
                
                logger.info(`SUCCESS! Found GitHub link: ${finalUrl}`);
                foundGitHubLinks++;
                foundLink = true;
                break;
              }
            } catch (error) {
              logger.debug(`Error following link: ${error.message}`);
              continue;
            }
          }
          
          if (foundLink) {
            break;
          }
        }
        
        if (!foundLink) {
          logger.debug('No GitHub links found in any replies to this tweet');
        }
      } catch (error) {
        logger.error(`Error processing tweet ${tweetUrl}:`, error);
      }
      
      // Add a small delay between tweets
      await page.waitForTimeout(1000);
    }
    
    logger.info(`Test summary: Processed ${processedCount} tweets, found ${foundGitHubLinks} GitHub links`);
    return true;
  } catch (error) {
    logger.error('Unhandled error during test:', error);
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
testReplyLinks().then(success => {
  if (success) {
    logger.info('Test completed successfully!');
    process.exit(0);
  } else {
    logger.error('Test failed!');
    process.exit(1);
  }
}).catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
