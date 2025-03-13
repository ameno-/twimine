import { logger } from './utils/logger.js';

/**
 * Navigates to the bookmarks page and processes bookmarks immediately as they're found
 * @param {Object} browserObj Object containing browser, context and page
 * @param {Object} config Configuration options
 * @returns {Array} Array of bookmark objects with extracted information
 */
export async function scrapeBookmarks(browserObj, config) {
  const { page, context } = browserObj;
  const bookmarks = [];
  let processedCount = 0;
  let reachedEnd = false;
  let scrollCount = 0;
  let consecutiveEmptyScrolls = 0;
  const MAX_CONSECUTIVE_EMPTY_SCROLLS = 15; // Increased from 5 to ensure we don't stop too early
  
  logger.info(`Will scrape up to ${config.limit || 'unlimited'} bookmarks (use -l or --limit to change)`);
  
  // Create a separate page for following links (with reduced timeout)
  let redirectPage = null;
  try {
    redirectPage = await context.newPage();
    // Reduce timeout for quicker processing
    redirectPage.setDefaultTimeout(Math.min(config.timeout / 3, 10000));
  } catch (error) {
    logger.error('Failed to create redirect page:', error);
    throw new Error(`Failed to create redirect page: ${error.message}`);
  }
  
  try {
    // Navigate to bookmarks page
    logger.info('Navigating to Twitter bookmarks page...');
    try {
      await page.goto(`${config.twitterBaseUrl}${config.bookmarksPath}`, { 
        waitUntil: 'domcontentloaded',
        timeout: config.timeout 
      });
    } catch (error) {
      logger.error('Failed to navigate to bookmarks page:', error);
      throw new Error(`Navigation to bookmarks failed: ${error.message}`);
    }
    
    // Wait for the page to stabilize
    await page.waitForLoadState('networkidle').catch(e => 
      logger.debug('Network never reached idle state on bookmarks page, continuing anyway:', e.message)
    );
    
    // Verify we're on the bookmarks page
    logger.debug('Verifying we are on the bookmarks page...');
    const bookmarksIndicators = [
      'div:has-text("Bookmarks")',
      'div[data-testid="primaryColumn"] h2:has-text("Bookmarks")',
      'a[href="/i/bookmarks"][aria-selected="true"]'
    ];
    
    let onBookmarksPage = false;
    for (const selector of bookmarksIndicators) {
      const indicator = await page.$(selector);
      if (indicator) {
        onBookmarksPage = true;
        logger.debug(`Found bookmarks page indicator: ${selector}`);
        break;
      }
    }
    
    if (!onBookmarksPage) {
      if (config.debug) {
        await page.screenshot({ path: 'not-on-bookmarks-page.png' });
      }
      throw new Error('Navigation to bookmarks page failed: Could not verify we are on the bookmarks page');
    }
    
    // Wait for bookmarks to load
    logger.debug('Waiting for bookmarks to load...');
    
    const tweetSelectors = [
      'article[data-testid="tweet"]',
      'div[data-testid="cellInnerDiv"]',
      'div[data-testid="tweetText"]'
    ];
    
    let foundTweets = false;
    for (const selector of tweetSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 }); // Reduced from 10000
        foundTweets = true;
        logger.debug(`Found tweets using selector: ${selector}`);
        break;
      } catch (e) {
        logger.debug(`No tweets found with selector: ${selector}`);
      }
    }
    
    if (!foundTweets) {
      if (config.debug) {
        await page.screenshot({ path: 'no-bookmarks-found.png' });
        logger.debug('Saved screenshot of bookmarks page to no-bookmarks-found.png');
      }
      
      // Check for empty bookmarks message
      const emptyBookmarksIndicators = [
        'div:has-text("You haven\'t added any Tweets to your Bookmarks yet")',
        'span:has-text("When you do, they\'ll show up here")'
      ];
      
      for (const selector of emptyBookmarksIndicators) {
        const emptyIndicator = await page.$(selector);
        if (emptyIndicator) {
          logger.info('No bookmarks found: Your bookmarks are empty');
          return [];
        }
      }
      
      throw new Error('No bookmarks found or bookmarks page failed to load properly');
    }
    
    // Process bookmarks immediately as we find them
    logger.info('Starting to process bookmarks...');
    
    while (!reachedEnd && 
           (config.limit === 0 || processedCount < config.limit) && 
           scrollCount < config.maxScrolls &&
           consecutiveEmptyScrolls < MAX_CONSECUTIVE_EMPTY_SCROLLS) {
      
      // Get tweet links currently visible on the page
      const visibleTweetLinks = await page.evaluate(() => {
        const links = [];
        document.querySelectorAll('a[href*="/status/"]').forEach(link => {
          if (link.href && link.href.includes('/status/') && 
              !link.href.includes('/analytics') &&
              !links.includes(link.href)) {
            links.push(link.href);
          }
        });
        return links;
      });
      
      logger.debug(`Found ${visibleTweetLinks.length} tweet links on current screen`);
      
      // Process each unprocessed bookmark
      let processedAny = false;
      for (const tweetUrl of visibleTweetLinks) {
        // Skip if we've already processed this tweet or reached the limit
        if (bookmarks.some(b => b.tweet_url === tweetUrl) || 
            (config.limit > 0 && processedCount >= config.limit)) {
          continue;
        }
        
        processedCount++;
        processedAny = true;
        logger.info(`Processing bookmark ${processedCount}${config.limit > 0 ? '/' + config.limit : ''}: ${tweetUrl}`);
        
        // Create a new bookmark object with all_links field
        const bookmark = {
          tweet_url: tweetUrl,
          username: null,
          tweet_text: null,
          github_url: null, // Keep for backward compatibility
          all_links: [], // Store all redirected links
          scraped_at: new Date().toISOString()
        };
        
        try {
          // Extract username from the bookmark on the bookmarks page if possible
          const tweetElement = await page.$(`a[href="${tweetUrl}"]`).then(
            a => a ? a.evaluate(el => el.closest('article[data-testid="tweet"]')) : null
          );
          
          if (tweetElement) {
            const username = await page.evaluate(el => {
              const usernameEl = el.querySelector('div[data-testid="User-Name"] a:nth-child(2)');
              return usernameEl ? usernameEl.textContent.trim() : null;
            }, tweetElement);
            
            if (username) {
              bookmark.username = username.startsWith('@') ? username : `@${username}`;
            }
          }
          
          // Visit the tweet to find replies and extract GitHub links
          logger.info(`Visiting tweet: ${tweetUrl}`);
          await page.goto(tweetUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: config.timeout 
          });
          
          // Wait for the page to load (reduced timeouts)
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(1000); // Reduced from 2000
          
          // Try to get username if we couldn't get it from the bookmarks page
          if (!bookmark.username) {
            try {
              const username = await page.evaluate(() => {
                const usernameEl = document.querySelector('div[data-testid="User-Name"] a:nth-child(2)');
                return usernameEl ? usernameEl.textContent.trim() : null;
              });
              
              if (username) {
                bookmark.username = username.startsWith('@') ? username : `@${username}`;
              }
            } catch (e) {
              logger.debug(`Error getting username: ${e.message}`);
            }
          }
          
          // Wait a bit longer for the content to fully load
          await page.waitForTimeout(3000);
          
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
          
          if (config.debug) {
            await page.screenshot({ path: `tweet-${processedCount}-loaded.png` });
          }
          
          // Check ALL tweets on the page (not just the first reply)
          const allTweets = await page.$$('article[data-testid="tweet"], div[data-testid="cellInnerDiv"]');
          logger.info(`Found ${allTweets.length} tweet elements on the page`);
          
          if (allTweets.length === 0) {
            logger.warn('No tweets found on the page - this is unusual');
            bookmarks.push(bookmark);
            continue;
          }
          
          // Track if we found a GitHub link
          let foundGitHubLink = false;
          let linksChecked = 0;
          let finalUrls = []; // Store all discovered final URLs
          
          // Check each tweet for links - similar to test-tco-links.js approach
          for (const tweetElement of allTweets) {
            // Find ALL links in this tweet element
            const allLinks = await tweetElement.$$('a[href]');
            
            if (allLinks.length > 0) {
              logger.debug(`Found ${allLinks.length} links in tweet element`);
              
              // Process each link
              for (const link of allLinks) {
                try {
                  const href = await link.getAttribute('href');
                  
                  // Skip common Twitter-internal links and analytics
                  if (!href || 
                      href.startsWith('#') || 
                      href === '/' || 
                      href.includes('/search?') ||
                      href.includes('/i/lists/') ||
                      href.includes('/i/topics/') ||
                      href.endsWith('/analytics')) {
                    logger.debug(`Skipping Twitter internal link: ${href}`);
                    continue;
                  }
                  
                  linksChecked++;
                  logger.info(`Processing link #${linksChecked}: ${href}`);
                  
                  // Follow the link to see where it redirects
                  try {
                    await redirectPage.goto(href, {
                      waitUntil: 'domcontentloaded',
                      timeout: Math.min(config.timeout / 2, 15000)
                    });
                    
                    // Get the final URL after all redirects
                    const finalUrl = redirectPage.url();
                    logger.info(`Link redirected to: ${finalUrl}`);
                    
                    // Add to finalUrls array
                    finalUrls.push(finalUrl);
                    
                    // Also set github_url if it's a GitHub link
                    if (finalUrl.includes('github.com') && 
                        !finalUrl.includes('github.com/login') && 
                        !finalUrl.includes('github.com/signup')) {
                      bookmark.github_url = finalUrl;
                      logger.info(`Found GitHub link: ${finalUrl}`);
                      foundGitHubLink = true;
                      // We don't break here - continue to find all links
                    }
                  } catch (redirectError) {
                    logger.debug(`Error following link: ${redirectError.message}`);
                    // Skip links that can't be followed
                  }
                } catch (linkError) {
                  logger.debug(`Error getting link attribute: ${linkError.message}`);
                }
              }
            }
          }
          
          // Remove duplicate URLs from finalUrls
          const uniqueUrls = [...new Set(finalUrls)];
          bookmark.all_links = uniqueUrls;
          
          logger.info(`Found ${bookmark.all_links.length} unique links in this tweet`);
          logger.info(`Checked ${linksChecked} links in total. Found GitHub link: ${foundGitHubLink ? 'YES' : 'NO'}`);
          
        } catch (error) {
          logger.error(`Error processing bookmark ${tweetUrl}:`, error);
        }
        
        // Add the bookmark to our collection
        bookmarks.push(bookmark);
        
        // Log progress
        const withLinks = bookmarks.filter(b => b.all_links.length > 0).length;
        const withGitHub = bookmarks.filter(b => b.github_url).length;
        logger.info(`Status: ${processedCount} processed, ${withLinks} with links, ${withGitHub} with GitHub links`);
        
        // Return to the bookmarks page to continue
        logger.debug('Returning to bookmarks page...');
        await page.goto(`${config.twitterBaseUrl}${config.bookmarksPath}`, { 
          waitUntil: 'domcontentloaded',
          timeout: config.timeout 
        });
        await page.waitForTimeout(1000); // Reduced from 2000
        
        // If we've reached the limit, break out
        if (config.limit > 0 && processedCount >= config.limit) {
          logger.info(`Reached the specified limit of ${config.limit} bookmarks`);
          break;
        }
      }
      
      // Check if we processed any new bookmarks
      if (!processedAny) {
        consecutiveEmptyScrolls++;
        logger.debug(`No new bookmarks found in scroll ${scrollCount+1}. Consecutive empty scrolls: ${consecutiveEmptyScrolls}`);
      } else {
        consecutiveEmptyScrolls = 0; // Reset the counter
      }
      
      // Scroll down to see more bookmarks
      if (config.limit === 0 || processedCount < config.limit) {
        try {
          await smartScroll(page, config.scrollDelay);
          scrollCount++;
          
          if (scrollCount % 5 === 0) {
            logger.debug(`Performed ${scrollCount} scrolls so far`);
          }
        } catch (scrollError) {
          logger.error('Error during scrolling:', scrollError);
          break;
        }
        
        // Wait for potential new content to load (reduced timeout)
        await page.waitForTimeout(500); // Reduced from 1000
      }
      
      // Check if we should stop
      if (consecutiveEmptyScrolls >= MAX_CONSECUTIVE_EMPTY_SCROLLS) {
        logger.info(`Reached the end of bookmarks after ${consecutiveEmptyScrolls} consecutive scrolls with no new content`);
        reachedEnd = true;
      }
      
      if (scrollCount >= config.maxScrolls) {
        logger.warn(`Reached maximum scroll limit (${config.maxScrolls}). Stopping.`);
      }
    }
    
    // Make a final pass to ensure all bookmarks have unique links
    const cleanedBookmarks = bookmarks.map(bookmark => {
      if (bookmark.all_links && bookmark.all_links.length > 0) {
        bookmark.all_links = [...new Set(bookmark.all_links)];
      }
      return bookmark;
    });
    
    // Log final statistics
    const totalBookmarks = cleanedBookmarks.length;
    const withLinks = cleanedBookmarks.filter(b => b.all_links.length > 0).length;
    const withGitHub = cleanedBookmarks.filter(b => b.github_url).length;
    const totalLinks = cleanedBookmarks.reduce((total, b) => total + (b.all_links?.length || 0), 0);
    
    logger.info('==== Bookmark Processing Complete ====');
    logger.info(`Total bookmarks: ${totalBookmarks}`);
    logger.info(`Bookmarks with links: ${withLinks}`);
    logger.info(`Bookmarks with GitHub links: ${withGitHub}`);
    logger.info(`Total unique links found: ${totalLinks}`);
    
    return cleanedBookmarks;
  } catch (error) {
    logger.error('Error scraping bookmarks:', error);
    throw error;
  } finally {
    // Close the redirect page
    if (redirectPage) {
      await redirectPage.close().catch(() => {});
    }
  }
}

/**
 * Smart scroll function that checks page height before and after scrolling
 * to detect if we've reached the bottom
 * @param {Object} page Playwright page object
 * @param {number} delay Delay between scrolls in milliseconds
 */
async function smartScroll(page, delay = 1000) {
  await page.evaluate(async (scrollDelay) => {
    return new Promise((resolve) => {
      // Get current scroll position and document height
      const prevScrollTop = window.scrollY;
      const prevHeight = document.body.scrollHeight;
      
      // Scroll down
      window.scrollBy(0, window.innerHeight * 0.8); // Scroll 80% of viewport height
      
      // Wait for content to load and check if we actually moved
      setTimeout(() => {
        const newScrollTop = window.scrollY;
        const newHeight = document.body.scrollHeight;
        
        // Check if we scrolled and if content height changed
        const didScroll = newScrollTop > prevScrollTop;
        const heightChanged = newHeight > prevHeight;
        
        // Return scroll status for debugging
        resolve({
          didScroll,
          heightChanged,
          prevScrollTop,
          newScrollTop,
          prevHeight,
          newHeight
        });
      }, scrollDelay);
    });
  }, delay).then(result => {
    // Log scroll results in debug mode
    logger.debug(`Scroll result: moved=${result.didScroll}, heightChanged=${result.heightChanged}, scrollDelta=${result.newScrollTop - result.prevScrollTop}px, heightDelta=${result.newHeight - result.prevHeight}px`);
    
    return result;
  });
}
