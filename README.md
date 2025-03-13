# TwiMine

Mining your twitter bookmarks for gold - A robust CLI tool for extracting valuable links from your Twitter bookmarks.

## Features

- Authenticate with Twitter and access your bookmarks
- Extract all links from bookmarks, with special handling for GitHub links
- Follow redirects to get final URLs (e.g., t.co links)
- Save results to JSON format with options to append to existing files
- Configurable settings via command line arguments or environment variables
- Detailed logging and error handling
- Screenshots for debugging (optional)

## Installation

Make sure you have Node.js v14+ installed. Then:

```bash
# Clone the repository
git clone https://github.com/yourusername/twimine.git
cd twimine

# Install dependencies
npm install

# Make the CLI tool globally available (optional)
npm link
```

## Usage

### Setup

Create a `.env` file in the root directory with your Twitter credentials:

```
TWITTER_USERNAME=your_twitter_username_or_email
TWITTER_PASSWORD=your_twitter_password
```

Alternatively, you can pass your credentials via command line arguments.

### Basic Usage

```bash
# Using environment variables from .env
npm start

# Using command line arguments
npm start -- -u yourusername -p yourpassword

# Or if globally linked:
twimine -u yourusername -p yourpassword
```

### Command Line Options

```
Options:
  -u, --username <username>     Twitter username or email
  -p, --password <password>     Twitter password
  -o, --output <file>           Output JSON file (default: "bookmarks.json")
  -a, --append                  Append to existing output file (default: false)
  -l, --limit <number>          Maximum number of bookmarks to scrape
  -d, --debug                   Enable debug logging (default: false)
  --headless <boolean>          Run in headless mode (default: true)
  --timeout <milliseconds>      Timeout for operations in milliseconds
  --screenshot-dir <directory>  Directory to save debug screenshots
  -h, --help                    Display help information
```

### Examples

```bash
# Scrape only the first 5 bookmarks
npm start -- -l 5

# Enable debug mode with screenshots
npm start -- -d --screenshot-dir ./screenshots

# Append new bookmarks to existing output file
npm start -- -o my-bookmarks.json -a

# Use a longer timeout for slow connections
npm start -- --timeout 60000
```

## Output Format

Results are saved as a JSON array of bookmark objects:

```json
[
  {
    "username": "@user123",
    "tweet_url": "https://twitter.com/user123/status/1234567890123456789",
    "github_url": "https://github.com/org/repo",
    "all_links": [
      "https://github.com/org/repo",
      "https://example.com/page"
    ],
    "scraped_at": "2025-03-12T19:30:45.123Z"
  },
  ...
]
```

## Project Structure

The project is organized with the following structure:

```
twimine/
├── src/
│   ├── index.js        # Main entry point and CLI handling
│   ├── auth.js         # Twitter authentication logic
│   ├── bookmarks.js    # Bookmark scraping functionality
│   ├── output.js       # Output processing and saving
│   └── utils/
│       ├── config.js   # Configuration loading and validation
│       ├── env.js      # Environment variable handling
│       └── logger.js   # Logging utilities
├── .env.example        # Example environment variables
├── package.json        # Project metadata and dependencies
└── README.md           # Project documentation
```

## Technical Details

- Built with Node.js and Playwright for browser automation
- Uses ES modules for better code organization
- Robust error handling and retry mechanisms
- Performance optimizations for processing large numbers of bookmarks
- Detailed JSDoc comments throughout the codebase

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - If you use Two-Factor Authentication (2FA), you'll need to temporarily disable it or use an app password
   - Verify your username/email and password are correct

2. **Timeouts**
   - For slow connections, increase the timeout: `--timeout 60000` (60 seconds)
   - Twitter rate limiting may cause timeouts; try again later

3. **No Bookmarks Found**
   - Verify you have bookmarks on your Twitter account
   - Check if your account is restricted or if Twitter has changed their UI

### Debug Mode

Run with the `-d` flag to enable debug mode, which provides:
- Verbose console output
- Screenshots of key operations (when `--screenshot-dir` is specified)
- More detailed error information

## License

MIT
