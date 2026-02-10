const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

module.exports = [
  {
    script: "dist/src/index.js",
    name: "cocoscan-batch-bot",
    autorestart: true,
    max_restarts: -1,
    min_uptime: "10s",
    max_memory_restart: "500M",
    restart_delay: 1000,
    watch: false,
    log_file: "./logs/combined.log",
    out_file: "./logs/out.log",
    error_file: "./logs/error.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    max_log_size: "10M",
    retain_logs: 5,
    env: {
      TZ: "Asia/Seoul",
      DB_HOST: process.env.COCOSCAN_DB_HOST || process.env.DB_HOST,
      DB_PORT: process.env.COCOSCAN_DB_PORT || process.env.DB_PORT,
      DB_USER: process.env.COCOSCAN_DB_USERNAME || process.env.DB_USER,
      DB_PASSWORD: process.env.COCOSCAN_DB_PASSWORD || process.env.DB_PASSWORD,
      DB_NAME: process.env.COCOSCAN_DB_NAME || process.env.DB_NAME,
      COCOSCAN_DISCORD_WEBHOOK_URL: process.env.COCOSCAN_DISCORD_WEBHOOK_URL,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
      GOOGLE_SEARCH_API_KEY: process.env.GOOGLE_SEARCH_API_KEY,
      GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID,
      DISCORD_DEV_WEBHOOK_URL: process.env.DISCORD_DEV_WEBHOOK_URL,
    },
  },
];
