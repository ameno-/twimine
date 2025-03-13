/**
 * @module output
 * @description TwiMine output processing: Handles saving mined bookmark data to files,
 * including formatting, deduplication, and generating human-readable summaries
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import { logger } from './utils/logger.js';
import { ensureOutputDir } from './utils/config.js';

/**
 * Process and save bookmark data to output file with improved error handling
 * 
 * @param {Array<Object>} bookmarks - Array of bookmark objects from scraping
 * @param {Object} config - Configuration options
 * @param {string} config.output - Path to output file
 * @param {boolean} config.append - Whether to append to existing output file
 * @returns {Promise<Array<Object>>} Array of processed bookmark objects that were saved
 * @throws {Error} If saving output fails
 */
export async function processOutput(bookmarks, config) {
  try {
    logger.debug('Processing output data...');
    
    // Include all bookmarks with any captured links, not just GitHub links
    const finalBookmarks = bookmarks.filter(bookmark => {
      if (!bookmark.github_url && (!bookmark.all_links || bookmark.all_links.length === 0)) {
        logger.debug(`Skipping bookmark without any links: ${bookmark.tweet_url}`);
        return false;
      }
      return true;
    });
    
    /**
     * Format bookmarks data for final output with consistent field order
     * @type {Array<{
     *   username: string|null,
     *   tweet_url: string,
     *   github_url: string|null,
     *   all_links: string[],
     *   scraped_at: string
     * }>}
     */
    const formattedBookmarks = finalBookmarks.map(bookmark => {
      // Remove duplicates from all_links
      const uniqueLinks = [...new Set(bookmark.all_links || [])];
      
      return {
        username: bookmark.username,
        tweet_url: bookmark.tweet_url,
        github_url: bookmark.github_url,
        all_links: uniqueLinks, // Include only unique links
        scraped_at: bookmark.scraped_at
      };
    });
    
    const withLinksCount = formattedBookmarks.length;
    const totalCount = bookmarks.length;
    
    logger.info(`Found ${withLinksCount} bookmarks with links out of ${totalCount} total bookmarks`);
    logger.info(`${bookmarks.filter(b => b.github_url).length} bookmarks have GitHub links`);
    
    if (withLinksCount === 0) {
      logger.warn('No links found in any bookmarks. Output file will be empty or unchanged.');
      if (totalCount > 0) {
        logger.info('Try visiting the bookmarks directly in your browser to verify if they contain links.');
      }
    }
    
    // Determine final output based on append option
    let finalOutput = formattedBookmarks;
    let existingCount = 0;
    let newCount = 0;
    
    if (config.append && existsSync(config.output)) {
      try {
        // Read existing file
        const fileContent = await fs.readFile(config.output, 'utf8');
        
        // Safely parse JSON with error handling
        let existingData;
        try {
          existingData = JSON.parse(fileContent);
        } catch (parseError) {
          logger.warn(`Error parsing existing output file: ${parseError.message}`);
          logger.warn('File content is not valid JSON. Creating backup and overwriting with new data.');
          
          // Create backup of corrupted file
          const backupPath = `${config.output}.backup.${Date.now()}`;
          await fs.writeFile(backupPath, fileContent, 'utf8');
          logger.info(`Created backup of existing file at ${backupPath}`);
          
          existingData = [];
        }
        
        if (Array.isArray(existingData)) {
          existingCount = existingData.length;
          
          // Performance improvement: Create a Set of existing URLs to check for duplicates efficiently
          const existingUrls = new Set(existingData.map(item => item.tweet_url));
          
          // Only add bookmarks that don't already exist in the file
          const newBookmarks = formattedBookmarks.filter(bookmark => !existingUrls.has(bookmark.tweet_url));
          newCount = newBookmarks.length;
          
          finalOutput = [...existingData, ...newBookmarks];
          
          logger.info(`Appending ${newCount} new bookmarks to existing file with ${existingCount} entries`);
        } else {
          logger.warn('Existing output file is not a valid JSON array. Creating backup and overwriting with new data.');
          
          // Create backup of invalid format file
          const backupPath = `${config.output}.backup.${Date.now()}`;
          await fs.writeFile(backupPath, fileContent, 'utf8');
          logger.info(`Created backup of existing file at ${backupPath}`);
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.warn(`Output file ${config.output} does not exist. Creating new file.`);
        } else {
          logger.warn(`Error reading existing output file: ${error.message}. Overwriting with new data.`);
        }
      }
    } else {
      logger.info(`Creating new output file with ${formattedBookmarks.length} bookmarks`);
    }
    
    // Ensure output directory exists
    ensureOutputDir(config.output);
    
    // Write data to output file with pretty formatting
    await fs.writeFile(config.output, JSON.stringify(finalOutput, null, 2), 'utf8');
    
    const summaryMessage = config.append
      ? `Successfully saved ${finalOutput.length} bookmarks to ${config.output} (${newCount} new, ${existingCount} existing)`
      : `Successfully saved ${finalOutput.length} bookmarks to ${config.output}`;
    
    logger.info(summaryMessage);
    
    return finalOutput;
  } catch (error) {
    logger.error('Error processing output:', error);
    throw new Error(`Failed to save output: ${error.message}`);
  }
}

/**
 * Generates a human-readable summary of the scraping results
 * 
 * @param {Array<Object>} bookmarks - Array of processed bookmark objects
 * @param {number} originalCount - Total number of bookmarks processed
 * @param {Object} config - Configuration options
 * @param {string} config.output - Path to output file
 * @returns {string} Human-readable summary text
 */
export function generateSummary(bookmarks, originalCount, config) {
  const withLinksCount = bookmarks.length;
  const withoutLinksCount = originalCount - withLinksCount;
  const gitHubLinksCount = bookmarks.filter(b => b.github_url).length;
  const totalLinksCount = bookmarks.reduce((total, b) => total + (b.all_links?.length || 0), 0);
  
  const summary = [
    `TwiMine: Mining Twitter Bookmarks`,
    `================================`,
    ``,
    `Total bookmarks processed: ${originalCount}`,
    `Bookmarks with any links: ${withLinksCount}`,
    `Bookmarks with GitHub links: ${gitHubLinksCount}`,
    `Total links captured: ${totalLinksCount}`,
    `Bookmarks without links: ${withoutLinksCount}`,
    `Results saved to: ${config.output}`,
    ``
  ];
  
  if (withLinksCount > 0) {
    if (gitHubLinksCount > 0) {
      summary.push(`Sample of extracted GitHub links:`);
      
      // Show up to 5 samples of extracted GitHub links
      const gitHubBookmarks = bookmarks.filter(b => b.github_url);
      const sampleCount = Math.min(gitHubBookmarks.length, 5);
      for (let i = 0; i < sampleCount; i++) {
        const bookmark = gitHubBookmarks[i];
        // Handle the case where username might be null
        const userDisplay = bookmark.username ? 
          `from @${bookmark.username.replace('@', '')}` : 
          'unknown user';
        summary.push(`- ${bookmark.github_url} (${userDisplay})`);
      }
      
      if (gitHubBookmarks.length > 5) {
        summary.push(`... and ${gitHubBookmarks.length - 5} more GitHub links`);
      }
    }
    
    if (totalLinksCount > gitHubLinksCount) {
      summary.push(`\nAdditional non-GitHub links were also captured in the output file.`);
    }
  }
  
  return summary.join('\n');
}
