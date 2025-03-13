#!/usr/bin/env node

import { program } from 'commander';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the correct path
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

// Command line options
program
  .option('-t, --test-cases <file>', 'JSON file with test cases', 'test-cases.json')
  .parse(process.argv);

const options = program.opts();

// GitHub link extraction function (copy from main code)
function extractGitHubLinks(text) {
  if (!text) return [];
  
  const githubUrlRegex = /https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/g;
  const matches = text.match(githubUrlRegex);
  
  if (matches) {
    return matches.filter(url => 
      !url.includes('github.com/login') && 
      !url.includes('github.com/signup') &&
      !url.includes('github.com/account')
    );
  }
  
  return [];
}

// Test cases if no file is provided or file doesn't exist
const defaultTestCases = [
  {
    description: "Simple GitHub URL in text",
    text: "Check out this cool project https://github.com/username/repo",
    expectedLinks: ["https://github.com/username/repo"]
  },
  {
    description: "Multiple GitHub URLs",
    text: "Here are two projects: https://github.com/user1/repo1 and https://github.com/user2/repo2",
    expectedLinks: ["https://github.com/user1/repo1", "https://github.com/user2/repo2"]
  },
  {
    description: "GitHub URL with www",
    text: "Project at https://www.github.com/username/repo is cool",
    expectedLinks: ["https://www.github.com/username/repo"]
  },
  {
    description: "GitHub URL with dashes in username/repo",
    text: "See https://github.com/user-name/repo-name",
    expectedLinks: ["https://github.com/user-name/repo-name"]
  },
  {
    description: "No GitHub URLs",
    text: "This is just a regular tweet with no GitHub links",
    expectedLinks: []
  },
  {
    description: "GitHub URL mixed with other text",
    text: "The project https://github.com/username/repo has many stars! #coding #opensource",
    expectedLinks: ["https://github.com/username/repo"]
  },
  {
    description: "GitHub links with ignored patterns",
    text: "Don't include these: https://github.com/login and https://github.com/signup",
    expectedLinks: []
  }
];

async function runTest() {
  let testCases = defaultTestCases;
  
  // Try to load test cases from file if provided
  if (options.testCases) {
    try {
      if (fs.existsSync(options.testCases)) {
        const fileContent = fs.readFileSync(options.testCases, 'utf8');
        testCases = JSON.parse(fileContent);
        logger.info(`Loaded test cases from ${options.testCases}`);
      } else {
        logger.warn(`Test cases file "${options.testCases}" not found, using default test cases`);
      }
    } catch (error) {
      logger.error(`Error loading test cases file: ${error.message}`);
      logger.info('Using default test cases');
    }
  }
  
  logger.info(`Running ${testCases.length} test cases for GitHub link extraction`);
  console.log();
  
  let passed = 0;
  let failed = 0;
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const testNum = i + 1;
    
    try {
      logger.info(`Test #${testNum}: ${testCase.description}`);
      
      const extractedLinks = extractGitHubLinks(testCase.text);
      const expectedLinks = testCase.expectedLinks || [];
      
      // Check if arrays have the same length
      const lengthMatch = extractedLinks.length === expectedLinks.length;
      
      // Check if all expected links are in extracted links
      const contentMatch = expectedLinks.every(link => extractedLinks.includes(link));
      
      // Check if all extracted links are in expected links
      const noExtraLinks = extractedLinks.every(link => expectedLinks.includes(link));
      
      if (lengthMatch && contentMatch && noExtraLinks) {
        logger.debug('✓ PASSED');
        passed++;
      } else {
        logger.error('✗ FAILED');
        logger.error(`Expected: ${JSON.stringify(expectedLinks)}`);
        logger.error(`Actual:   ${JSON.stringify(extractedLinks)}`);
        failed++;
      }
    } catch (error) {
      logger.error(`Test #${testNum} threw an exception: ${error.message}`);
      failed++;
    }
    
    console.log(); // Add a blank line between tests
  }
  
  console.log('-----------------------------------');
  logger.info(`Test results: ${passed} passed, ${failed} failed`);
  
  return failed === 0; // Return true if all tests passed
}

// Generate test cases file if it doesn't exist
if (!fs.existsSync('test-cases.json')) {
  try {
    fs.writeFileSync('test-cases.json', JSON.stringify(defaultTestCases, null, 2), 'utf8');
    logger.info('Created test-cases.json with default test cases');
  } catch (error) {
    logger.error(`Error creating test-cases.json: ${error.message}`);
  }
}

// Run the tests
runTest().then(allPassed => {
  process.exit(allPassed ? 0 : 1);
}).catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
