/**
 * @module auth
 * @description Handles Twitter authentication processes for TwiMine including browser setup,
 * login, challenge handling, and session verification
 */

import { chromium } from 'playwright';
import { logger } from './utils/logger.js';

/**
 * Browser configuration type definition
 * @typedef {Object} BrowserConfig
 * @property {string} username - Twitter username or email
 * @property {string|null} password - Twitter password
 * @property {boolean|string} headless - Whether to run in headless mode
 * @property {number} timeout - Operation timeout in milliseconds
 * @property {Object} viewport - Browser viewport dimensions
 * @property {number} viewport.width - Viewport width
 * @property {number} viewport.height - Viewport height
 * @property {string} userAgent - Browser user agent string
 * @property {boolean} debug - Whether debug mode is enabled
 */

/**
 * Browser instance returned after authentication
 * @typedef {Object} BrowserInstance
 * @property {import('playwright').Browser} browser - Playwright Browser instance
 * @property {import('playwright').BrowserContext} context - Playwright BrowserContext
 * @property {import('playwright').Page} page - Playwright Page with active Twitter session
 */

/**
 * Initialize a browser instance and authenticate with Twitter
 * 
 * @param {BrowserConfig} config - Configuration options
 * @returns {Promise<BrowserInstance>} Browser instance with authenticated context
 * @throws {Error} If authentication fails
 */
export async function authenticateTwitter(config) {
  logger.debug('======== Authentication Process Started ========');
  logger.debug('Initializing browser...');
  
  // Parse headless option properly - ensure consistent handling regardless of input type
  const headless = typeof config.headless === 'string'
    ? config.headless.toLowerCase() !== 'false'
    : Boolean(config.headless);
  logger.debug(`Running in ${headless ? 'headless' : 'visible'} mode`);
  
  let browser;
  try {
    // Launch browser with better error handling
    browser = await chromium.launch({
      headless: headless,
      timeout: config.timeout,
      args: ['--disable-extensions', '--disable-dev-shm-usage', '--no-sandbox']
    }).catch(err => {
      logger.error('Failed to launch browser:', err);
      throw new Error(`Browser launch failed: ${err.message}`);
    });
    
    logger.debug('Browser launched successfully');
    
    // Create a new browser context with specific viewport and user agent
    const context = await browser.newContext({
      viewport: config.viewport,
      userAgent: config.userAgent,
      bypassCSP: true,
      acceptDownloads: false, // Avoid unnecessary download prompts
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true, // Help with certain Twitter behaviors
    });
    
    // Enable console logging from the browser
    context.on('console', msg => {
      const text = msg.text();
      if (config.debug && text) {
        logger.debug(`Browser console: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
      }
    });
    
    // Create a new page in context
    const page = await context.newPage();
    
    // Set default timeout for all operations
    page.setDefaultTimeout(config.timeout);
    
    // Navigate to Twitter login page with better error handling
    logger.debug('Navigating to Twitter login page...');
    try {
      await page.goto('https://twitter.com/login', { 
        waitUntil: 'domcontentloaded',
        timeout: config.timeout 
      });
      logger.debug('Twitter login page loaded successfully');
    } catch (error) {
      logger.error('Failed to load Twitter login page:', error);
      throw new Error(`Navigation failed: ${error.message}`);
    }
    
    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle').catch(e => 
      logger.debug('Network never reached idle state, continuing anyway:', e.message)
    );
    
    // Twitter sometimes has different login flows, check which one we have
    logger.debug('Analyzing login page structure...');
    
    // Take a screenshot in debug mode to diagnose issues
    if (config.debug) {
      await page.screenshot({ path: 'twitter-login-page.png' });
      logger.debug('Saved screenshot of login page to twitter-login-page.png');
    }
    
    // Enter username/email with retry logic
    let loginSuccess = await enterUsername(page, config);
    if (!loginSuccess) {
      throw new Error('Failed to enter username or proceed to password step');
    }
    
    // Enter password with retry logic
    loginSuccess = await enterPassword(page, config);
    if (!loginSuccess) {
      throw new Error('Failed to enter password or complete login');
    }
    
    // Verify login success
    loginSuccess = await verifyLoginSuccess(page, config);
    if (!loginSuccess) {
      throw new Error('Could not verify successful login');
    }
    
    logger.info('Successfully logged into Twitter');
    
    // Return the created browser object (which contains the page and context)
    return { browser, context, page };
  } catch (error) {
    // If any error occurs during the login process, close the browser and throw the error
    if (browser) {
      await browser.close().catch(e => logger.debug('Error while closing browser:', e.message));
    }
    logger.error('Authentication failed:', error);
    throw new Error(`Failed to authenticate with Twitter: ${error.message}`);
  }
}

/**
 * Enter username on the login page
 * 
 * @param {import('playwright').Page} page - Playwright page object
 * @param {BrowserConfig} config - Configuration options
 * @returns {Promise<boolean>} Success status
 */
async function enterUsername(page, config) {
  logger.debug('Attempting to enter username...');
  
  try {
    // Wait for the username input field with a better selector strategy
    // Try multiple possible selectors to handle Twitter UI changes
    const usernameSelectors = [
      'input[autocomplete="username"]',
      'input[name="text"]',
      'input[data-testid="ocfEnterTextTextInput"]'
    ];
    
    let usernameField = null;
    for (const selector of usernameSelectors) {
      const field = await page.$(selector);
      if (field) {
        usernameField = field;
        logger.debug(`Found username field with selector: ${selector}`);
        break;
      }
    }
    
    if (!usernameField) {
      logger.error('Could not find username input field');
      if (config.debug) {
        await page.screenshot({ path: 'username-field-not-found.png' });
      }
      return false;
    }
    
    // Clear the field first
    await usernameField.click({ clickCount: 3 });
    await usernameField.press('Backspace');
    
    // Enter username - ensure it's not null (but it shouldn't be at this point)
    if (!config.username) {
      logger.error('Username is null, cannot proceed with authentication');
      return false;
    }
    
    await usernameField.fill(config.username);
    logger.debug('Username entered successfully');
    
    // Try to click next button
    const nextButtonSelectors = [
      'div[role="button"]:has-text("Next")',
      'button[data-testid="auth-dialog-next"]',
      'button:has-text("Next")',
      '[data-testid="login-next-button"]'
    ];
    
    let nextButtonClicked = false;
    for (const selector of nextButtonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          nextButtonClicked = true;
          logger.debug(`Clicked next button with selector: ${selector}`);
          break;
        }
      } catch (e) {
        logger.debug(`Failed to click next button with selector: ${selector}`);
      }
    }
    
    if (!nextButtonClicked) {
      logger.error('Could not find or click next button');
      if (config.debug) {
        await page.screenshot({ path: 'next-button-not-found.png' });
      }
      return false;
    }
    
    // Wait for username step to complete
    await page.waitForTimeout(2000);
    
    // Handle possible security challenge
    const challengeSelectors = [
      'input[data-testid="ocfEnterTextTextInput"]',
      'input[name="text"]',
      'div:has-text("Enter your phone number or username")'
    ];
    
    let hasChallenge = false;
    for (const selector of challengeSelectors) {
      const challengeField = await page.$(selector);
      if (challengeField) {
        hasChallenge = true;
        logger.info('Security challenge detected, providing additional verification...');
        
        await challengeField.click({ clickCount: 3 });
        await challengeField.press('Backspace');
        await challengeField.fill(config.username);
        
        // Try to click next button again
        for (const nextSelector of nextButtonSelectors) {
          try {
            const button = await page.$(nextSelector);
            if (button) {
              await button.click();
              logger.debug('Clicked next button on challenge screen');
              break;
            }
          } catch (e) {
            logger.debug(`Failed to click challenge next button with selector: ${nextSelector}`);
          }
        }
        
        // Wait for challenge step to complete
        await page.waitForTimeout(2000);
        break;
      }
    }
    
    if (hasChallenge) {
      logger.debug('Handled security challenge');
    } else {
      logger.debug('No security challenge detected');
    }
    
    return true;
  } catch (error) {
    logger.error('Error during username entry:', error);
    if (config.debug) {
      await page.screenshot({ path: 'username-entry-error.png' });
    }
    return false;
  }
}

/**
 * Enter password on the login page
 * 
 * @param {import('playwright').Page} page - Playwright page object
 * @param {BrowserConfig} config - Configuration options
 * @returns {Promise<boolean>} Success status
 */
async function enterPassword(page, config) {
  logger.debug('Attempting to enter password...');
  
  try {
    // Wait for the password input with multiple possible selectors
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      'input[autocomplete="current-password"]'
    ];
    
    let passwordField = null;
    for (const selector of passwordSelectors) {
      try {
        // Use a shorter timeout for each selector attempt
        const field = await page.waitForSelector(selector, { timeout: 5000 });
        if (field) {
          passwordField = field;
          logger.debug(`Found password field with selector: ${selector}`);
          break;
        }
      } catch (e) {
        logger.debug(`Selector ${selector} not found, trying next...`);
      }
    }
    
    if (!passwordField) {
      logger.error('Could not find password input field');
      if (config.debug) {
        await page.screenshot({ path: 'password-field-not-found.png' });
      }
      return false;
    }
    
    // Clear the field and enter password
    await passwordField.click({ clickCount: 3 });
    await passwordField.press('Backspace');
    
    // Check if password is null
    if (!config.password) {
      logger.error('Password is null, cannot proceed with authentication');
      return false;
    }
    
    await passwordField.fill(config.password);
    logger.debug('Password entered successfully');
    
    // Click login button with multiple selector attempts
    const loginButtonSelectors = [
      'div[data-testid="LoginForm_Login_Button"]',
      'button[data-testid="sign-in-button"]',
      'button:has-text("Log in")',
      'button:has-text("Sign in")'
    ];
    
    let loginButtonClicked = false;
    for (const selector of loginButtonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          loginButtonClicked = true;
          logger.debug(`Clicked login button with selector: ${selector}`);
          break;
        }
      } catch (e) {
        logger.debug(`Failed to click login button with selector: ${selector}`);
      }
    }
    
    if (!loginButtonClicked) {
      logger.error('Could not find or click login button');
      if (config.debug) {
        await page.screenshot({ path: 'login-button-not-found.png' });
      }
      return false;
    }
    
    // Wait for login attempt to complete
    await page.waitForTimeout(5000);
    
    return true;
  } catch (error) {
    logger.error('Error during password entry:', error);
    if (config.debug) {
      await page.screenshot({ path: 'password-entry-error.png' });
    }
    return false;
  }
}

/**
 * Verify login success by checking for Twitter home elements
 * 
 * @param {import('playwright').Page} page - Playwright page object
 * @param {BrowserConfig} config - Configuration options
 * @returns {Promise<boolean>} Success status
 */
async function verifyLoginSuccess(page, config) {
  logger.debug('Verifying successful login...');
  
  // Take a screenshot if in debug mode
  if (config.debug) {
    await page.screenshot({ path: 'post-login-verification.png' });
  }
  
  try {
    // Check URL first
    const currentUrl = page.url();
    logger.debug(`Current URL: ${currentUrl}`);
    
    if (currentUrl.includes('login') || currentUrl.includes('error')) {
      logger.error(`Login failed: Still on login page or error page: ${currentUrl}`);
      return false;
    }
    
    // Check for success indicators with better timeout handling
    const successSelectors = [
      'a[data-testid="AppTabBar_Home_Link"]',
      'a[data-testid="AppTabBar_Bookmarks_Link"]',
      'a[href="/home"]',
      'a[aria-label="Profile"]',
      'div[data-testid="primaryColumn"]'
    ];
    
    for (const selector of successSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          logger.debug(`Found success indicator: ${selector}`);
          return true;
        }
      } catch (e) {
        logger.debug(`Success indicator not found: ${selector}`);
      }
    }
    
    // Check for additional verification methods or security challenges
    const challengeSelectors = [
      'input[data-testid="ocfEnterTextTextInput"]',
      'input[name="text"]',
      'div:has-text("Enter the verification code")',
      'div:has-text("Verify your identity")'
    ];
    
    for (const selector of challengeSelectors) {
      const challengeElement = await page.$(selector);
      if (challengeElement) {
        logger.error('Additional verification required - cannot proceed automatically');
        return false;
      }
    }
    
    // Check for error messages
    const errorSelectors = [
      'div:has-text("Wrong password")',
      'div:has-text("Incorrect password")',
      'div:has-text("The username and password you entered did not match our records")'
    ];
    
    for (const selector of errorSelectors) {
      const errorElement = await page.$(selector);
      if (errorElement) {
        logger.error(`Login error detected: ${selector}`);
        return false;
      }
    }
    
    logger.debug('No explicit success indicators found, but no errors detected either');
    return false;
  } catch (error) {
    logger.error('Error verifying login success:', error);
    return false;
  }
}
