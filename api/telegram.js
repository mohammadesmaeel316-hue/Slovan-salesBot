"use strict";

require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { registerAccessHandlers } = require("../src/accessHandlers");
const { testConnection } = require("../src/db");
const { processUpdateAndWait } = require("../src/taskTracker");
const { isPingCommand } = require("../src/utils");
const {
  isAllowedWebhookSecret,
  isValidWebhookSecret,
} = require("../src/webhookSecurity");

let bot;
let databaseReady;

function getBot() {
  if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN is not configured");
  if (!bot) {
    bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
    registerAccessHandlers(bot);
  }
  return bot;
}

async function ensureDatabaseReady() {
  if (!databaseReady) {
    databaseReady = testConnection().catch((error) => {
      databaseReady = null;
      throw error;
    });
  }
  await databaseReady;
}

module.exports = async function telegramWebhook(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "telegram-webhook" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!isAllowedWebhookSecret(expectedSecret)) {
    console.error("TELEGRAM_WEBHOOK_SECRET is missing or invalid");
    return res.status(500).json({ ok: false, error: "webhook_not_configured" });
  }

  const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!isValidWebhookSecret(receivedSecret, expectedSecret)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!update || typeof update !== "object") {
      return res.status(400).json({ ok: false, error: "invalid_update" });
    }

    if (!isPingCommand(update.message?.text)) await ensureDatabaseReady();
    await processUpdateAndWait(getBot(), update);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook failed:", error);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};
