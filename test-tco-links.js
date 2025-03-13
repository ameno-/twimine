#!/usr/bin/env node

import { program } from 'commander';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Simple console logger for the test with color coding
const logger = {
  info: (msg) => console.log('\x1b[32m%s\x1b[0m', `[INFO] ${msg}`), // Green
  debug: (msg) => console.log('\x1b[36m%s\x1b[0m', `[DEBUG] ${msg}`), // Cyan
  warn: (msg) => console.log('\x1b[33m%s\x1b[0m', `[WARN] ${msg}`), // Yellow
  error: (msg, err) => {
    console.error('\x1b[31m%s\x1b[0m', `[ERROR] ${msg}`); // Red
    if (err) console.error('\x1b[31m%s\x1b[0m', err);
  }
};

// Command line options
program
  .name('twitter-bookmark-test')
  .description('Test tool for Twitter bookmark link extraction')
  .version('1.0.0')
  .option('-u, --username <username>', 'Twitter username or email')
  .option('-p, --password <password>', 'Twitter password')
  .option('-l, --limit <number>', 'Maximum number of bookmarks to scrape', '3')
  .option('-d, --debug', 'Enable debug logging')
  .option('--headless <boolean>', 'Run in headless mode (default: false)', 'false')
  .option('--screenshot-dir <dir>', 'Directory to save screenshots', 'screenshots')
  .option('--timeout <milliseconds>', 'Timeout for operations in milliseconds', parseInt, 30000)
  .option('-o, --output <file>', 'Output JSON file', 'tco-link-test-results.json')
  .parse(process.argv);

const options = program.opts();

// Use command line args or environment variables
const username = options.username || process.env.TWITTER_USERNAME;
const password = options.password || process.env.TWITTER_PASSWORD;
const headless = options.headless.toLowerCase() === 'true';
const debug = options.debug || true; // Enable debug mode by default for testing
const limit = parseInt(options.limit) || 3;
const screenshotDir = options.screenshotDir || 'screenshots';
const outputFile = options.output || 'tco-link-test-results.json';
const timeout = options.timeout || 30000;

// Display the scraping limit in the console
logger.info(`Will scrape up to ${limit} bookmarks (use -l or --limit to change)`);

// Create screenshot directory if it doesn't exist
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

// Browser configuration
const config = {
  headless,
  timeout,
  viewport: { width: 1280, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * Take a screenshot for debugging
 */
async function takeScreenshot(page, name) {
  if (debug) {
    const filename = `${screenshotDir}/${name}-${new Date().getTime()}.png`;
    await page.screenshot({ path: filename });
    logger.debug(`Screenshot saved to ${filename}`);
  }
}

/**
 * Log in to Twitter
 */
async function loginToTwitter(page) {
  logger.info('Logging in to Twitter...');
  
  // Go to login page
  await page.goto('https://twitter.com/login');
  await takeScreenshot(page, 'login-page');
  
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
  await takeScreenshot(page, 'post-login');
  
  // Verify login
  const isLoggedIn = await page.isVisible('a[data-testid="AppTabBar_Home_Link"], a[href="/home"]');
  if (!isLoggedIn) {
    throw new Error('Login verification failed. Not logged in to Twitter.');
  }
  
  logger.info('Successfully logged in to Twitter');
}

/**
 * Get bookmark tweet URLs
 */
async function getBookmarkTweetURLs(page, maxCount) {
  logger.info('Navigating to Twitter bookmarks page...');
  
  try {
    // Navigate to bookmarks page
    await page.goto('https://twitter.com/i/bookmarks');
    await page.waitForLoadState('networkidle').catch(() => {});
    await takeScreenshot(page, 'bookmarks-page');
    
    // Wait for content to load
    await page.waitForTimeout(3000);
    
    // Scroll a few times to load more bookmarks
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
      await page.waitForTimeout(1000);
    }
    
    await takeScreenshot(page, 'bookmarks-loaded');
    
    // Find all tweet links
    const tweetUrls = await page.evaluate(() => {
      const links = [];
      const statusLinks = document.querySelectorAll('a[href*="/status/"]');
      
      statusLinks.forEach(link => {
        if (link.href && link.href.includes('/status/') && 
            !link.href.includes('/analytics') &&
            !links.includes(link.href)) {
          links.push(link.href);
        }
      });
      
      return [...new Set(links)]; // Remove duplicates
    });
    
    logger.info(`Found ${tweetUrls.length} bookmarked tweets`);
    return tweetUrls.slice(0, maxCount);
  } catch (error) {
    logger.error('Error getting bookmark tweets:', error);
    return [];
  }
}

/**
 * Test the t.co link finding and redirection functionality
 */
async function testTcoLinkRedirect() {
  let browser;
  let context;
  let page;
  let redirectPage;
  
  try {
    // Launch browser
    logger.info(`Launching browser in ${headless ? 'headless' : 'visible'} mode...`);
    browser = await chromium.launch({
      headless: config.headless
    });
    
    // Create context with viewport and user agent
    context = await browser.newContext({
      viewport: config.viewport,
      userAgent: config.userAgent,
      acceptDownloads: true
    });
    
    // Create pages
    page = await context.newPage();
    page.setDefaultTimeout(config.timeout);
    redirectPage = await context.newPage();
    redirectPage.setDefaultTimeout(config.timeout / 2);
    
    // Log into Twitter
    await loginToTwitter(page);
    
    // Get bookmark tweet URLs
    const tweetUrls = await getBookmarkTweetURLs(page, limit);
    if (tweetUrls.length === 0) {
      logger.error('No bookmarks found for testing');
      return false;
    }
    
    // Process each tweet
    let processedCount = 0;
    let foundGitHubLinks = 0;
    const results = [];
    
    for (const tweetUrl of tweetUrls) {
      logger.info(`Testing tweet ${++processedCount}/${tweetUrls.length}: ${tweetUrl}`);
      
      try {
        // Open the tweet to see replies
        await page.goto(tweetUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(3000);
        await takeScreenshot(page, `tweet-${processedCount}`);
        
        // Log the page title and URL to verify we're on the right page
        const title = await page.title();
        logger.debug(`Page title: ${title}, URL: ${page.url()}`);
        
        // First extract all t.co links from the page for debugging
        const allTcoLinks = await page.evaluate(() => {
          const links = [];
          document.querySelectorAll('a[href^="https://t.co/"]').forEach(link => {
            links.push(link.href);
          });
          return links;
        });
        
        logger.debug(`Found ${allTcoLinks.length} total t.co links on the page`);
        allTcoLinks.forEach(link => logger.debug(`t.co link: ${link}`));
        
        // The strategy of finding the main tweet and then filtering for replies isn't reliable
        // Instead, we'll look for all tweets and examine each one that isn't the main one
        
        // First, wait a bit longer for replies to load
        await page.waitForTimeout(5000);
        
        // Try to load more replies if there's a "Show more replies" button
        try {
          const showMoreButton = await page.$('div[role="button"]:has-text("Show more replies")');
          if (showMoreButton) {
            logger.debug('Found "Show more replies" button, clicking it');
            await showMoreButton.click();
            await page.waitForTimeout(3000);
          }
        } catch (e) {
          logger.debug('No "Show more replies" button found or error clicking it');
        }
        
        // Take a screenshot after trying to load more replies
        await takeScreenshot(page, `tweet-${processedCount}-replies`);
        
        // Try multiple approaches to find replies
        const allTweets = await page.$$('article[data-testid="tweet"], div[data-testid="cellInnerDiv"]');
        logger.debug(`Found ${allTweets.length} possible tweet elements on the page`);
        
        // We'll track stats for each tweet
        let foundTcoLink = false;
        let foundGitHubLink = false;
        let tcoLinkFound = null;
        let gitHubUrl = null;
        let linksChecked = 0;
        let finalUrls = []; // Keep track of all final URLs
        
        // For each tweet element on the page, look for any link (not just t.co links)
        for (const tweetElement of allTweets) {
          // Get the text of this tweet element for context
          try {
            const tweetText = await tweetElement.evaluate(el => {
              const textEl = el.querySelector('div[data-testid="tweetText"]');
              return textEl ? textEl.textContent : '';
            });
            
            if (tweetText) {
              logger.debug(`Tweet element text: ${tweetText.substring(0, 50)}${tweetText.length > 50 ? '...' : ''}`);
            }
          } catch (e) {
            // Ignore errors in getting tweet text
          }
          
          // Find ALL links in this tweet (not just t.co links)
          const allLinks = await tweetElement.$$('a[href]');
          
          if (allLinks.length > 0) {
            logger.debug(`Found ${allLinks.length} links in tweet element`);
            
            // Process each link
            for (const link of allLinks) {
              try {
                const href = await link.getAttribute('href');
                
                // Skip some common Twitter-internal links and analytics links
                if (!href || 
                    href.startsWith('#') || 
                    href === '/' || 
                    href.includes('/search?') ||
                    href.includes('/i/lists/') ||
                    href.includes('/i/topics/') ||
                    href.endsWith('/analytics')) {
                  logger.debug(`Skipping internal or analytics link: ${href}`);
                  continue;
                }
                
                linksChecked++;
                logger.info(`Processing link #${linksChecked}: ${href}`);
                
                // Follow the link to see where it goes
                try {
                  await redirectPage.goto(href, {
                    waitUntil: 'domcontentloaded',
                    timeout: config.timeout / 2
                  });
                  
                  // Get the final URL and title
                  const finalUrl = redirectPage.url();
                  let finalTitle = '';
                  try {
                    finalTitle = await redirectPage.title();
                  } catch (e) {
                    // Ignore title errors
                  }
                  
                  logger.debug(`Link redirected to: ${finalUrl}`);
                  if (finalTitle) {
                    logger.debug(`Final page title: ${finalTitle}`);
                  }
                  
                  // Add final URL to our list
                  finalUrls.push(finalUrl);
                  
                  // Record the t.co link if we found one
                  if (href.startsWith('https://t.co/')) {
                    foundTcoLink = true;
                    tcoLinkFound = href;
                  }
                  
                  // Check if it's a GitHub URL
                  if (finalUrl.includes('github.com') && 
                      !finalUrl.includes('github.com/login') && 
                      !finalUrl.includes('github.com/signup')) {
                    
                    logger.info(`SUCCESS: Found GitHub link: ${finalUrl}`);
                    foundGitHubLink = true;
                    gitHubUrl = finalUrl;
                    foundGitHubLinks++;
                    break;
                  }
                } catch (redirectError) {
                  logger.debug(`Error following link: ${redirectError.message}`);
                }
              } catch (linkError) {
                logger.debug(`Error processing link: ${linkError.message}`);
              }
            }
          } else {
            logger.debug('No links found in this tweet element');
          }
          
          // If we found a GitHub link, no need to check more tweets
          if (foundGitHubLink) {
            break;
          }
        }
        
        logger.info(`Checked ${linksChecked} links in this tweet page. Found GitHub link: ${foundGitHubLink ? 'YES' : 'NO'}`);
        
        // Remove duplicates from finalUrls before storing
        const uniqueFinalUrls = [...new Set(finalUrls)];
        
        // Store results for this tweet - focus only on final URLs, not t.co links
        results.push({
          tweet_url: tweetUrl,
          links: uniqueFinalUrls, // Store only unique final URLs
          found_github_link: foundGitHubLink,
          github_url: gitHubUrl
        });
        
        // Log the result for this tweet
        logger.info(`Tweet ${processedCount} result: ` + 
          `Found t.co link: ${foundTcoLink ? 'YES' : 'NO'}, ` + 
          `Found GitHub link: ${foundGitHubLink ? 'YES' : 'NO'}`);
        
      } catch (error) {
        logger.error(`Error processing tweet ${tweetUrl}:`, error);
      }
      
      // Small delay between tweets
      if (processedCount < tweetUrls.length) {
        await page.waitForTimeout(1000);
      }
    }
    
    // Log final results
    logger.info('=============== FINAL RESULTS ===============');
    logger.info(`Processed ${processedCount} tweets`);
    logger.info(`Found ${foundGitHubLinks} GitHub links`);
    
    results.forEach((result, i) => {
      logger.info(`Tweet ${i+1}: ${result.tweet_url}`);
      logger.info(`  Found GitHub link: ${result.found_github_link ? 'YES' : 'NO'}`);
      if (result.found_github_link) {
        logger.info(`  GitHub URL: ${result.github_url}`);
      }
      logger.info(`  All links found: ${result.links.length}`);
    });
    
    // Clean up final results - ensure no duplicate links in the JSON output
    // This is a sanity check in case any duplicates were missed in earlier processing
    const cleanResults = results.map(result => {
      // Ensure links array has no duplicates
      const uniqueLinks = [...new Set(result.links)];
      return {
        ...result,
        links: uniqueLinks,
      };
    });
    
    // Write results to a JSON file
    fs.writeFileSync(outputFile, JSON.stringify(cleanResults, null, 2));
    logger.info(`Results saved to ${outputFile} with ${cleanResults.length} bookmarks`);
    logger.info(`Total unique links found: ${cleanResults.reduce((count, item) => count + item.links.length, 0)}`);
    
    return foundGitHubLinks > 0;
  } catch (error) {
    logger.error('Unhandled error:', error);
    return false;
  } finally {
    // Close browser
    if (browser) {
      logger.info('Closing browser...');
      await browser.close().catch(() => {});
    }
  }
}

// Run the test
testTcoLinkRedirect().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
