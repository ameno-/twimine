# Twitter Bookmark Scraper

A robust command-line tool for scraping Twitter bookmarks and extracting GitHub links. This tool uses browser automation to access your Twitter bookmarks, scroll through them, and extract any GitHub links found in the tweets.

## Features

- **Improved Authentication System** - Reliable login process with fallback mechanisms
- **Robust Error Handling** - Clear error messages and automatic recovery
- **Smart Scrolling** - Automatically detects when it has reached the end of bookmarks
- **Enhanced Link Detection** - Multiple strategies to find GitHub links in tweets
- **Incremental Updates** - Can append new bookmarks to existing output file
- **Configurable Behavior** - Customizable timeout, scroll delay, and other parameters

## Prerequisites

- Node.js (v14+)
- npm or yarn
- Chromium-based browser (automatically installed by Playwright)

## Installation

1. Clone or download this repository:
```bash
git clone <repository-url>
cd twitter-bookmark-scraper-v2
```

2. Install dependencies:
```bash
npm install
```

3. Make the script executable (Unix/macOS):
```bash
chmod +x src/index.js
```

4. (Optional) Link the package globally for command-line access:
```bash
npm link
```

## Usage

### Basic Usage

```bash
node src/index.js -u "your_twitter_username" -p "your_twitter_password"
```

Or if linked globally:

```bash
twitter-bookmark-scraper -u "your_twitter_username" -p "your_twitter_password"
```

### Using Environment Variables

Create a `.env` file in the project root:

```
TWITTER_USERNAME=your_twitter_username
TWITTER_PASSWORD=your_twitter_password
```

Then run:

```bash
node src/index.js
```

### Options

```
Options:
  -u, --username <username>     Twitter username or email
  -p, --password <password>     Twitter password
  -o, --output <file>           Output JSON file (default: "bookmarks.json")
  -a, --append                  Append to existing output file
  -l, --limit <number>          Maximum number of bookmarks to scrape
  -d, --debug                   Enable debug logging
  --headless <boolean>          Run in headless mode (default: true)
  --timeout <milliseconds>      Timeout for operations in milliseconds
  --screenshot-dir <directory>  Directory to save debug screenshots
  --help                        Display help
```

### Examples

Scrape up to 50 bookmarks and save to a custom file:
```bash
twitter-bookmark-scraper -u "username" -p "password" -l 50 -o "github_links.json"
```

Run with visible browser (non-headless mode):
```bash
twitter-bookmark-scraper -u "username" -p "password" --headless false
```

Append new bookmarks to an existing output file:
```bash
twitter-bookmark-scraper -u "username" -p "password" -a
```

Debug mode with longer timeout:
```bash
twitter-bookmark-scraper -u "username" -p "password" -d --timeout 60000
```

## Output Format

The tool generates a JSON file with the following structure:

```json
[
  {
    "username": "@twitteruser",
    "tweet_url": "https://twitter.com/twitteruser/status/123456789",
    "github_url": "https://github.com/user/repo",
    "scraped_at": "2025-03-08T18:30:00.000Z"
  },
  ...
]
```

## Troubleshooting

### Login Issues

This version includes significant improvements to the authentication process, but Twitter's login flow can change. If you encounter login issues:

1. Try running in non-headless mode to see what's happening:
   ```bash
   twitter-bookmark-scraper -u "username" -p "password" --headless false
   ```

2. Enable debug mode for detailed logs:
   ```bash
   twitter-bookmark-scraper -u "username" -p "password" -d
   ```

3. If you have two-factor authentication enabled, you may need to disable it temporarily or use an app password.

4. Some accounts may trigger additional security challenges. Try using your email address instead of username.

### Common Issues

- **Timeout errors**: Increase the timeout value with `--timeout 60000` (for 60 seconds)
- **No GitHub links found**: Verify that your bookmarks actually contain tweets with GitHub links
- **Browser launch failure**: Ensure you have sufficient permissions on your system to launch a browser
- **Process hangs**: Use Ctrl+C to stop the scraper, which will clean up resources properly

## Advanced Configuration

The tool includes sensible defaults, but you can customize behavior by modifying `src/utils/config.js`:

- Adjust scroll behavior parameters
- Change browser viewport settings
- Modify timeouts and retry attempts
- Update user agent strings

## Security Considerations

- This tool requires your Twitter credentials. Consider using environment variables instead of command-line arguments.
- Credentials are only used for authentication with Twitter and are not stored or transmitted elsewhere.
- For additional security, consider creating a separate Twitter account for scraping.

## License

MIT
