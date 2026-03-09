/**
 * PM2 ecosystem file for Retail POS server and WhatsApp bot.
 * Usage (from server folder):
 *   pm2 start ecosystem.config.cjs           — start both API and WhatsApp bot
 *   pm2 start ecosystem.config.cjs --only api
 *   pm2 start ecosystem.config.cjs --only whatsapp
 *   pm2 logs
 *   pm2 stop all
 */

module.exports = {
  apps: [
    {
      name: "pos-api",
      script: "src/index.js",
      cwd: __dirname,
      interpreter: "node",
      env: { NODE_ENV: "development" },
      env_production: { NODE_ENV: "production" },
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
    },
    {
      name: "pos-whatsapp",
      script: "whatsappBot.cjs",
      cwd: __dirname,
      interpreter: "node",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
    },
  ],
};
