"use strict";

function parseIdSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

const superAdminIds = parseIdSet(process.env.SUPER_ADMIN_IDS);

const commands = [
  { command: "start", description: "فتح القائمة" },
  { command: "ping", description: "اختبار تشغيل البوت" },
  { command: "help", description: "عرض المساعدة" },
  { command: "myid", description: "إظهار رقم حسابك" },
];

module.exports = {
  commands,
  parseIdSet,
  superAdminIds,
};
