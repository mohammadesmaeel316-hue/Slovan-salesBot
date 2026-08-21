"use strict";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function normalizeDigits(value) {
  return String(value ?? "").replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = ARABIC_DIGITS.indexOf(digit);
    return String(arabicIndex === -1 ? PERSIAN_DIGITS.indexOf(digit) : arabicIndex);
  });
}

function normalizePhone(value) {
  let phone = normalizeDigits(value).replace(/[^\d+]/g, "");
  if (!phone) return null;

  if (phone.startsWith("+20")) {
    phone = `0${phone.slice(3)}`;
  } else if (phone.startsWith("0020")) {
    phone = `0${phone.slice(4)}`;
  } else if (phone.startsWith("20") && phone.length === 12) {
    phone = `0${phone.slice(2)}`;
  } else if (phone.startsWith("1") && phone.length === 10) {
    phone = `0${phone}`;
  }

  return /^\d{7,15}$/.test(phone) ? phone : null;
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isTelegramId(value) {
  return /^[1-9]\d{4,19}$/.test(normalizeDigits(value).trim());
}

function isPingCommand(value) {
  return /^\/ping(?:@[A-Za-z0-9_]+)?$/i.test(String(value || "").trim());
}

function isNavigationCommand(value) {
  const text = String(value || "").trim();
  return [
    /^(رقمي|myid)$/i,
    /^(مساعدة|help)$/i,
    /^(طلب صلاحية)$/i,
    /^(إدارة المستخدمين|ادارة المستخدمين)$/i,
    /^طلبات الصلاحية$/i,
    /^قائمة المستخدمين$/i,
    /^ترقية إلى مدير$/i,
    /^تخفيض إلى مبيعات$/i,
    /^حذف مستخدم$/i,
    /^أسعار الشحن$/i,
    /^تحميل ملف أسعار الشحن$/i,
    /^رفع ملف أسعار الشحن$/i,
    /^الأصناف والأسعار$/i,
    /^تحميل ملف الأصناف$/i,
    /^رفع ملف الأصناف$/i,
    /^الباكدجات$/i,
    /^تحميل ملف الباكدجات$/i,
    /^رفع ملف الباكدجات$/i,
    /^الطلبات$/i,
    /^تحميل سجل الطلبات$/i,
    /^إلغاء أوردر محفوظ$/i,
    /^طلب جديد$/i,
    /^تعديل طلب$/i,
    /^بحث عن أوردر$/i,
    /^رجوع$/i,
  ].some((pattern) => pattern.test(text));
}

function telegramDisplayName(user = {}) {
  return (
    normalizeName([user.first_name, user.last_name].filter(Boolean).join(" ")) ||
    normalizeName(user.username ? `@${user.username}` : "") ||
    `Telegram ${user.id}`
  );
}

module.exports = {
  isNavigationCommand,
  isPingCommand,
  isTelegramId,
  normalizeDigits,
  normalizeName,
  normalizePhone,
  telegramDisplayName,
};
