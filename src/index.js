"use strict";

require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { registerAccessHandlers } = require("./accessHandlers");
const { commands, superAdminIds } = require("./config");
const { pool, testConnection } = require("./db");

const { BOT_TOKEN, DATABASE_URL } = process.env;

if (!BOT_TOKEN) {
  console.error("EFATAL: BOT_TOKEN is missing in .env");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("EFATAL: DATABASE_URL is missing in .env");
  process.exit(1);
}

if (!superAdminIds.size) {
  console.error("EFATAL: SUPER_ADMIN_IDS is missing in .env");
  process.exit(1);
}

let bot;

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down...`);
  if (bot) await bot.stopPolling().catch(() => {});
  await pool.end();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

async function start() {
  try {
    await testConnection();

    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    registerAccessHandlers(bot);
    await bot.setMyCommands(commands);

    console.log("Bot is running. Authentication database is ready.");
  } catch (error) {
    console.error("Bot startup failed:", error.message);
    if (bot) await bot.stopPolling().catch(() => {});
    await pool.end();
    process.exit(1);
  }
}

start();
