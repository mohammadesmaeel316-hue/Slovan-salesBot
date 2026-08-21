"use strict";
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { superAdminIds } = require("../src/config");
const { getPreviousMonthReport, testConnection } = require("../src/db");

module.exports = async function monthlyReport(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false });
  try {
    await testConnection();
    const report = await getPreviousMonthReport();
    const message = [`📊 التقرير الشهري`, `✅ أوردرات مؤكدة: ${report.confirmed}`, `⚠️ أوردرات ملغية: ${report.cancelled}`, `🧾 إجمالي المنتجات: ${report.items_total}ج`, `🏷️ الخصومات: ${report.discounts}ج`, `🚚 الشحن: ${report.shipping}ج`, `💰 الإجمالي النهائي: ${report.grand_total}ج`, "", "🏆 أكثر المنتجات/الباكدجات:", ...(report.top.length ? report.top.map((x, i) => `${i + 1}. ${x.description} × ${x.quantity}`) : ["لا توجد أوردرات مؤكدة خلال الشهر."])].join("\n");
    const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
    await Promise.all([...superAdminIds].map((id) => bot.sendMessage(id, message)));
    return res.status(200).json({ ok: true });
  } catch (error) { console.error(error); return res.status(500).json({ ok: false }); }
};
