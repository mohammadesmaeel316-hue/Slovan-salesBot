"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isNavigationCommand,
  isPingCommand,
  isTelegramId,
  normalizeDigits,
  normalizeName,
  normalizePhone,
  telegramDisplayName,
} = require("../utils");

test("normalizes Arabic and Persian digits", () => {
  assert.equal(normalizeDigits("٠١٢۳۴"), "01234");
});

test("normalizes common Egyptian phone formats", () => {
  assert.equal(normalizePhone("+20 112 639 0787"), "01126390787");
  assert.equal(normalizePhone("٢٠١١٢٦٣٩٠٧٨٧"), "01126390787");
  assert.equal(normalizePhone("1126390787"), "01126390787");
});

test("rejects invalid phones and recognizes Telegram IDs", () => {
  assert.equal(normalizePhone("abc"), null);
  assert.equal(isTelegramId("123456789"), true);
  assert.equal(isTelegramId("01234"), false);
});

test("recognizes the ping command with an optional bot username", () => {
  assert.equal(isPingCommand("/ping"), true);
  assert.equal(isPingCommand("/ping@SalesBot"), true);
  assert.equal(isPingCommand("ping"), false);
});

test("recognizes commands that replace an unfinished conversation", () => {
  assert.equal(isNavigationCommand("مساعدة"), true);
  assert.equal(isNavigationCommand("طلبات الصلاحية"), true);
  assert.equal(isNavigationCommand("ترقية إلى مدير"), true);
  assert.equal(isNavigationCommand("تحميل ملف أسعار الشحن"), true);
  assert.equal(isNavigationCommand("رفع ملف أسعار الشحن"), true);
  assert.equal(isNavigationCommand("الأصناف والأسعار"), true);
  assert.equal(isNavigationCommand("تحميل ملف الأصناف"), true);
  assert.equal(isNavigationCommand("رفع ملف الأصناف"), true);
  assert.equal(isNavigationCommand("الباكدجات"), true);
  assert.equal(isNavigationCommand("تحميل ملف الباكدجات"), true);
  assert.equal(isNavigationCommand("رفع ملف الباكدجات"), true);
  assert.equal(isNavigationCommand("الطلبات"), true);
  assert.equal(isNavigationCommand("طلب جديد"), true);
  assert.equal(isNavigationCommand("تعديل طلب"), true);
  assert.equal(isNavigationCommand("مدير"), false);
  assert.equal(isNavigationCommand("تأكيد"), false);
  assert.equal(isNavigationCommand("اسم مستخدم"), false);
});

test("normalizes names and builds Telegram display names", () => {
  assert.equal(normalizeName("  نورا   عبد السلام "), "نورا عبد السلام");
  assert.equal(
    telegramDisplayName({ id: 1, first_name: "نورا", last_name: "عبد السلام" }),
    "نورا عبد السلام",
  );
});
