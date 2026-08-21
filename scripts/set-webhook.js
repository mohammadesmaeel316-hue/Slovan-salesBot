"use strict";

require("dotenv").config();

const { commands } = require("../src/config");
const { isAllowedWebhookSecret } = require("../src/webhookSecurity");

async function main() {
  const baseUrl = String(process.argv[2] || process.env.PUBLIC_URL || "")
    .trim()
    .replace(/\/$/, "");
  const token = process.env.BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token) throw new Error("BOT_TOKEN is missing");
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error("Pass the HTTPS deployment URL, for example: pnpm webhook -- https://example.vercel.app");
  }
  if (!isAllowedWebhookSecret(secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET must be 16-256 characters using letters, numbers, _ or -");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${baseUrl}/api/telegram`,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram returned HTTP ${response.status}`);
  }

  const commandsResponse = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  const commandsResult = await commandsResponse.json();
  if (!commandsResponse.ok || !commandsResult.ok) {
    throw new Error(commandsResult.description || `Telegram returned HTTP ${commandsResponse.status}`);
  }

  console.log(`Telegram webhook configured: ${baseUrl}/api/telegram`);
}

main().catch((error) => {
  console.error(`Webhook setup failed: ${error.message}`);
  process.exit(1);
});
