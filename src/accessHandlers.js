"use strict";

const {
  approveRequest,
  changeUserRole,
  clearConversationState,
  findPendingRequestsByIdentifier,
  findUsersByIdentifier,
  getAccessRequest,
  getAccessUser,
  getConversationState,
  listDeliveryPrices,
  listItems,
  listOrdersForExport,
  listPackages,
  listActiveUsers,
  listPendingRequests,
  rejectRequest,
  removeUserAccess,
  replaceDeliveryPrices,
  replaceItems,
  replacePackages,
  setConversationState,
  submitAccessRequest,
} = require("./db");
const {
  buildDeliveryPricesWorkbook,
  parseDeliveryPricesWorkbook,
} = require("./deliveryPricesSheet");
const { buildItemsWorkbook, parseItemsWorkbook } = require("./itemsSheet");
const { buildPackagesWorkbook, parsePackagesWorkbook } = require("./packagesSheet");
const { buildOrdersWorkbook } = require("./ordersSheet");
const { superAdminIds } = require("./config");
const { trackHandler } = require("./taskTracker");
const { handleOrderMessage } = require("./orderFlow");
const {
  isNavigationCommand,
  normalizePhone,
  telegramDisplayName,
} = require("./utils");

const roleLabels = {
  super_admin: "سوبر أدمن",
  manager: "مدير",
  sales: "مبيعات",
  none: "بدون صلاحية",
};

const MAX_DELIVERY_SHEET_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS_SHEET_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGES_SHEET_BYTES = 2 * 1024 * 1024;

function isSuperAdmin(telegramId) {
  return superAdminIds.has(String(telegramId));
}

async function getRole(msg) {
  const telegramId = String(msg.from?.id || "");
  if (isSuperAdmin(telegramId)) return "super_admin";
  const user = await getAccessUser(telegramId);
  return user?.role || "none";
}

function mainKeyboard(role) {
  const rows = [];
  if (role !== "none") rows.push([{ text: "الطلبات" }]);
  if (role === "super_admin") rows.push([{ text: "إلغاء أوردر محفوظ" }, { text: "حذف كل الأوردرات" }], [{ text: "تحميل سجل الطلبات" }]);
  else if (role === "manager") rows.push([{ text: "تحميل سجل الطلبات" }]);
  if (role === "super_admin" || role === "manager") {
    rows.push([{ text: "أسعار الشحن" }, { text: "الأصناف والأسعار" }]);
    rows.push([{ text: "الباكدجات" }]);
  }
  if (role === "super_admin") rows.push([{ text: "إدارة المستخدمين" }]);
  rows.push([{ text: "مساعدة" }, { text: "رقمي" }]);

  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
    },
  };
}

function deliveryPricesKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "تحميل ملف أسعار الشحن" }],
        [{ text: "رفع ملف أسعار الشحن" }],
        [{ text: "رجوع" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
      input_field_placeholder: "اختر تحميل أو رفع ملف أسعار الشحن",
    },
  };
}

function itemsKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "تحميل ملف الأصناف" }],
        [{ text: "رفع ملف الأصناف" }],
        [{ text: "رجوع" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
      input_field_placeholder: "اختر تحميل أو رفع ملف الأصناف",
    },
  };
}

function packagesKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "تحميل ملف الباكدجات" }],
        [{ text: "رفع ملف الباكدجات" }],
        [{ text: "رجوع" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
      input_field_placeholder: "اختر تحميل أو رفع ملف الباكدجات",
    },
  };
}

function unauthorizedKeyboard() {
  return {
    reply_markup: {
      keyboard: [[{ text: "طلب صلاحية", request_contact: true }]],
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
      input_field_placeholder: "اضغط على زر طلب صلاحية",
    },
  };
}

function managementKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "طلبات الصلاحية" }, { text: "قائمة المستخدمين" }],
        [{ text: "ترقية إلى مدير" }, { text: "تخفيض إلى مبيعات" }],
        [{ text: "حذف مستخدم" }, { text: "رجوع" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
      input_field_placeholder: "اختر إجراء إدارة المستخدمين",
    },
  };
}

function approvalKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "مدير" }, { text: "مبيعات" }],
        [{ text: "رفض" }, { text: "إلغاء" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
    },
  };
}

function confirmationKeyboard() {
  return {
    reply_markup: {
      keyboard: [[{ text: "تأكيد" }, { text: "إلغاء" }]],
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
    },
  };
}

function helpText(role) {
  const lines = [
    "اختر من القائمة:",
    "",
    "رقمي - إظهار Telegram ID الخاص بك.",
    "مساعدة - عرض هذه الرسالة.",
  ];
  if (role === "super_admin") {
    lines.push("إدارة المستخدمين - مراجعة الطلبات وإدارة صلاحيات المدير والمبيعات.");
  }
  if (role === "super_admin" || role === "manager") {
    lines.push("أسعار الشحن - تحميل ملف الأسعار الحالي أو رفع ملف جديد لاستبداله.");
    lines.push("الأصناف والأسعار - تحميل ملف الأصناف الحالي أو رفع ملف جديد لاستبداله.");
    lines.push("الباكدجات - تحميل ملف الباكدجات الحالي أو رفع ملف جديد لاستبداله.");
  }
  if (role !== "none") {
    lines.push("الطلبات - إنشاء أوردر جديد أو البحث عن أوردر محفوظ لتعديله.");
  }
  return lines.join("\n");
}

function userSummary(user) {
  return [
    `الاسم: ${user.display_name || "غير محدد"}`,
    `الهاتف: ${user.phone || "غير محدد"}`,
    `Telegram ID: ${user.telegram_id}`,
    user.role ? `الصلاحية: ${roleLabels[user.role] || user.role}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function safeNotify(bot, telegramId, message) {
  try {
    await bot.sendMessage(telegramId, message);
  } catch (error) {
    console.error(`Could not notify Telegram ID ${telegramId}:`, error.message);
  }
}

async function requireSuperAdmin(bot, msg, role) {
  if (role === "super_admin") return true;
  await bot.sendMessage(
    msg.chat.id,
    "إدارة المستخدمين متاحة للسوبر أدمن فقط.",
    mainKeyboard(role),
  );
  return false;
}

async function requireDeliveryManager(bot, msg, role) {
  if (role === "super_admin" || role === "manager") return true;
  await bot.sendMessage(
    msg.chat.id,
    "إدارة أسعار الشحن متاحة للسوبر أدمن والمدير فقط.",
    role === "none" ? unauthorizedKeyboard() : mainKeyboard(role),
  );
  return false;
}

async function requireItemsManager(bot, msg, role) {
  if (role === "super_admin" || role === "manager") return true;
  await bot.sendMessage(
    msg.chat.id,
    "إدارة الأصناف متاحة للسوبر أدمن والمدير فقط.",
    role === "none" ? unauthorizedKeyboard() : mainKeyboard(role),
  );
  return false;
}

async function requirePackagesManager(bot, msg, role) {
  if (role === "super_admin" || role === "manager") return true;
  await bot.sendMessage(msg.chat.id, "إدارة الباكدجات متاحة للسوبر أدمن والمدير فقط.", role === "none" ? unauthorizedKeyboard() : mainKeyboard(role));
  return false;
}

async function requireOrdersExport(bot, msg, role) {
  if (role === "super_admin" || role === "manager") return true;
  await bot.sendMessage(msg.chat.id, "تصدير سجل الطلبات متاح للسوبر أدمن والمدير فقط.", role === "none" ? unauthorizedKeyboard() : mainKeyboard(role));
  return false;
}

async function sendOrdersWorkbook(bot, msg, role) {
  const rows = await listOrdersForExport();
  const workbook = await buildOrdersWorkbook(rows);
  await bot.sendDocument(msg.chat.id, workbook, {
    caption: rows.length
      ? `سجل الطلبات الحالي — ${new Set(rows.map((row) => row.order_code)).size} أوردر.`
      : "سجل الطلبات فارغ حالياً.",
    ...mainKeyboard(role),
  }, { filename: "orders.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function showDeliveryPricesMenu(bot, chatId) {
  await bot.sendMessage(
    chatId,
    [
      "أسعار الشحن:",
      "",
      "• تحميل ملف أسعار الشحن: ينزّل الأسعار المحفوظة حالياً، أو ملفاً فارغاً بالعناوين إذا لم توجد بيانات.",
      "• رفع ملف أسعار الشحن: يتحقق من الملف ثم يستبدل جميع الأسعار القديمة بالبيانات الجديدة.",
      "",
      "عناوين الملف المطلوبة:",
      "المحافظة\\المنطقه | سعر الشحن",
    ].join("\n"),
    deliveryPricesKeyboard(),
  );
}

async function sendDeliveryPricesWorkbook(bot, msg) {
  const rows = await listDeliveryPrices();
  const workbook = await buildDeliveryPricesWorkbook(rows);
  await bot.sendDocument(
    msg.chat.id,
    workbook,
    {
      caption: rows.length
        ? `ملف أسعار الشحن الحالي — ${rows.length} منطقة.`
        : "ملف أسعار الشحن فارغ وجاهز للتعبئة.",
      ...deliveryPricesKeyboard(),
    },
    {
      filename: "delivery-prices.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
}

async function showItemsMenu(bot, chatId) {
  await bot.sendMessage(
    chatId,
    [
      "الأصناف والأسعار:",
      "",
      "• تحميل ملف الأصناف: ينزّل الأصناف المحفوظة حالياً، أو ملفاً فارغاً بالعناوين إذا لم توجد بيانات.",
      "• رفع ملف الأصناف: يتحقق من الملف ثم يستبدل جميع الأصناف القديمة بالبيانات الجديدة.",
      "",
      "العناوين المطلوبة:",
      "اسم الصنف | السعر | الحد الأدنى | الحد الأقصى",
      "الاسم والسعر مطلوبان، والحد الأدنى والأقصى اختياريان.",
    ].join("\n"),
    itemsKeyboard(),
  );
}

async function sendItemsWorkbook(bot, msg) {
  const rows = await listItems();
  const workbook = await buildItemsWorkbook(rows);
  await bot.sendDocument(
    msg.chat.id,
    workbook,
    {
      caption: rows.length
        ? `ملف الأصناف الحالي — ${rows.length} صنف.`
        : "ملف الأصناف فارغ وجاهز للتعبئة.",
      ...itemsKeyboard(),
    },
    {
      filename: "items.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
}

async function showPackagesMenu(bot, chatId) {
  await bot.sendMessage(chatId, [
    "الباكدجات:", "",
    "• تحميل ملف الباكدجات: ينزّل البيانات المحفوظة حالياً أو ملفاً فارغاً.",
    "• رفع ملف الباكدجات: يتحقق من الملف ثم يستبدل جميع الباكدجات القديمة.", "",
    "العناوين الحالية:",
    "اسم الباكدج | الصنف | الكمية | السعر الإجمالي",
    "اكتب اسم الباكدج وسعره في أول صف له، ثم أضف باقي أصنافه في الصفوف التالية.",
  ].join("\n"), packagesKeyboard());
}

async function sendPackagesWorkbook(bot, msg) {
  const rows = await listPackages();
  const workbook = await buildPackagesWorkbook(rows);
  await bot.sendDocument(msg.chat.id, workbook, {
    caption: rows.length ? `ملف الباكدجات الحالي — ${rows.length} باكدج.` : "ملف الباكدجات فارغ وجاهز للتعبئة.",
    ...packagesKeyboard(),
  }, { filename: "packages.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function showManagement(bot, chatId) {
  await bot.sendMessage(
    chatId,
    [
      "إدارة المستخدمين:",
      "",
      "• طلبات الصلاحية: الموافقة كمدير أو مبيعات، أو رفض الطلب.",
      "• ترقية إلى مدير: تحويل موظف مبيعات إلى مدير.",
      "• تخفيض إلى مبيعات: تحويل مدير إلى موظف مبيعات.",
      "• حذف مستخدم: إلغاء وصوله مع الاحتفاظ بسجل العملية.",
      "",
      "يمكن البحث بالاسم أو رقم الهاتف أو Telegram ID.",
    ].join("\n"),
    managementKeyboard(),
  );
}

async function showPendingRequests(bot, msg) {
  const requests = await listPendingRequests();
  if (!requests.length) {
    await bot.sendMessage(msg.chat.id, "لا توجد طلبات صلاحية معلقة.", managementKeyboard());
    return;
  }

  await setConversationState(msg.from.id, { step: "awaiting_request_target" });
  const list = requests
    .map((request, index) => `${index + 1}. ${request.display_name} — ${request.phone || "بدون هاتف"} — ${request.telegram_id}`)
    .join("\n");
  await bot.sendMessage(
    msg.chat.id,
    [
      "طلبات الصلاحية المعلقة:",
      "",
      list,
      "",
      "أرسل اسم المستخدم أو رقم الهاتف أو Telegram ID.",
    ].join("\n"),
    managementKeyboard(),
  );
}

async function showUsers(bot, chatId) {
  const users = await listActiveUsers();
  const superAdmins = [...superAdminIds].map((id) => `سوبر أدمن: ${id} (محمي)`);
  const storedUsers = users.map(
    (user) => `${roleLabels[user.role]}: ${user.display_name} — ${user.phone || "بدون هاتف"} — ${user.telegram_id}`,
  );
  await bot.sendMessage(
    chatId,
    [...superAdmins, ...storedUsers].join("\n") || "لا يوجد مستخدمون.",
    managementKeyboard(),
  );
}

function candidateList(candidates) {
  return candidates.map((candidate, index) => `${index + 1}. ${userSummary(candidate).replace(/\n/g, " — ")}`).join("\n");
}

async function chooseRequest(bot, msg, request) {
  await setConversationState(msg.from.id, { step: "choosing_request_role", request });
  await bot.sendMessage(
    msg.chat.id,
    ["مراجعة طلب الصلاحية:", "", userSummary(request), "", "اختر الصلاحية أو ارفض الطلب."].join("\n"),
    approvalKeyboard(),
  );
}

async function chooseUserAction(bot, msg, user, action) {
  const expectedRole = action === "promote" ? "sales" : action === "demote" ? "manager" : null;
  if (expectedRole && user.role !== expectedRole) {
    const message = action === "promote"
      ? "يمكن ترقية مستخدم المبيعات فقط. هذا المستخدم مدير بالفعل."
      : "يمكن تخفيض المدير فقط. هذا المستخدم مبيعات بالفعل.";
    await clearConversationState(msg.from.id);
    await bot.sendMessage(msg.chat.id, message, managementKeyboard());
    return;
  }

  await setConversationState(msg.from.id, { step: "confirming_user_action", user, action });
  const actionLabel = action === "promote" ? "ترقية المستخدم إلى مدير" : action === "demote" ? "تخفيض المستخدم إلى مبيعات" : "حذف صلاحية المستخدم";
  await bot.sendMessage(
    msg.chat.id,
    [actionLabel, "", userSummary(user), "", "اضغط تأكيد لتنفيذ العملية."].join("\n"),
    confirmationKeyboard(),
  );
}

async function resolveSelection(bot, msg, text, source, action = null) {
  const candidates = source === "requests"
    ? await findPendingRequestsByIdentifier(text)
    : await findUsersByIdentifier(text);

  if (!candidates.length) {
    await bot.sendMessage(
      msg.chat.id,
      "لم يتم العثور على المستخدم. أرسل الاسم أو رقم الهاتف أو Telegram ID، أو اكتب إلغاء.",
      managementKeyboard(),
    );
    return;
  }

  if (candidates.length === 1) {
    if (source === "requests") await chooseRequest(bot, msg, candidates[0]);
    else await chooseUserAction(bot, msg, candidates[0], action);
    return;
  }

  await setConversationState(msg.from.id, {
    step: source === "requests" ? "selecting_request_candidate" : "selecting_user_candidate",
    candidates,
    action,
  });
  await bot.sendMessage(
    msg.chat.id,
    ["يوجد أكثر من مستخدم مطابق. أرسل رقم الاختيار:", "", candidateList(candidates), "", "أو اكتب إلغاء."].join("\n"),
    managementKeyboard(),
  );
}

async function handleState(bot, msg, text) {
  const key = String(msg.from.id);
  const state = await getConversationState(key);
  if (!state) return false;

  if (/^(إلغاء|الغاء|رجوع)$/i.test(text)) {
    await clearConversationState(key);
    await bot.sendMessage(msg.chat.id, "تم الإلغاء.", managementKeyboard());
    return true;
  }

  if (state.step === "awaiting_request_target") {
    await resolveSelection(bot, msg, text, "requests");
    return true;
  }

  if (state.step === "awaiting_user_target") {
    if (isSuperAdmin(text.trim())) {
      await clearConversationState(key);
      await bot.sendMessage(msg.chat.id, "لا يمكن تعديل أو حذف السوبر أدمن.", managementKeyboard());
      return true;
    }
    await resolveSelection(bot, msg, text, "users", state.action);
    return true;
  }

  if (state.step === "selecting_request_candidate" || state.step === "selecting_user_candidate") {
    const number = /^\d+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isInteger(number) || number < 1 || number > state.candidates.length) {
      await bot.sendMessage(msg.chat.id, "رقم الاختيار غير صحيح. حاول مرة أخرى أو اكتب إلغاء.", managementKeyboard());
      return true;
    }
    const selected = state.candidates[number - 1];
    if (state.step === "selecting_request_candidate") await chooseRequest(bot, msg, selected);
    else await chooseUserAction(bot, msg, selected, state.action);
    return true;
  }

  if (state.step === "choosing_request_role") {
    let result;
    if (/^مدير$/i.test(text)) {
      result = await approveRequest(state.request.telegram_id, "manager", msg.from.id);
      await clearConversationState(key);
      if (!result) {
        await bot.sendMessage(msg.chat.id, "تمت مراجعة هذا الطلب من قبل.", managementKeyboard());
        return true;
      }
      await safeNotify(bot, result.telegram_id, "تمت الموافقة على طلبك كمدير ✅\nأرسل /start لفتح القائمة.");
      await bot.sendMessage(msg.chat.id, `تمت الموافقة على ${result.display_name} كمدير.`, managementKeyboard());
      return true;
    }
    if (/^مبيعات$/i.test(text)) {
      result = await approveRequest(state.request.telegram_id, "sales", msg.from.id);
      await clearConversationState(key);
      if (!result) {
        await bot.sendMessage(msg.chat.id, "تمت مراجعة هذا الطلب من قبل.", managementKeyboard());
        return true;
      }
      await safeNotify(bot, result.telegram_id, "تمت الموافقة على طلبك كموظف مبيعات ✅\nأرسل /start لفتح القائمة.");
      await bot.sendMessage(msg.chat.id, `تمت الموافقة على ${result.display_name} كمبيعات.`, managementKeyboard());
      return true;
    }
    if (/^رفض$/i.test(text)) {
      result = await rejectRequest(state.request.telegram_id, msg.from.id);
      await clearConversationState(key);
      if (result) await safeNotify(bot, result.telegram_id, "تم رفض طلب الصلاحية. تواصل مع الإدارة للاستفسار.");
      await bot.sendMessage(msg.chat.id, result ? `تم رفض طلب ${result.display_name}.` : "تمت مراجعة هذا الطلب من قبل.", managementKeyboard());
      return true;
    }
    await bot.sendMessage(msg.chat.id, "اختر مدير أو مبيعات أو رفض، أو اكتب إلغاء.", approvalKeyboard());
    return true;
  }

  if (state.step === "confirming_user_action") {
    if (!/^تأكيد$/i.test(text)) {
      await bot.sendMessage(msg.chat.id, "اضغط تأكيد أو إلغاء.", confirmationKeyboard());
      return true;
    }

    await clearConversationState(key);
    if (state.action === "promote") {
      const changed = await changeUserRole(state.user.telegram_id, "manager", msg.from.id);
      if (!changed || changed.unchanged) {
        await bot.sendMessage(msg.chat.id, "لم تتغير الصلاحية.", managementKeyboard());
        return true;
      }
      await safeNotify(bot, state.user.telegram_id, "تمت ترقيتك إلى مدير ✅\nأرسل /start لتحديث القائمة.");
      await bot.sendMessage(msg.chat.id, `تمت ترقية ${state.user.display_name} إلى مدير.`, managementKeyboard());
      return true;
    }

    if (state.action === "demote") {
      const changed = await changeUserRole(state.user.telegram_id, "sales", msg.from.id);
      if (!changed || changed.unchanged) {
        await bot.sendMessage(msg.chat.id, "لم تتغير الصلاحية.", managementKeyboard());
        return true;
      }
      await safeNotify(bot, state.user.telegram_id, "تم تعديل صلاحيتك إلى مبيعات.\nأرسل /start لتحديث القائمة.");
      await bot.sendMessage(msg.chat.id, `تم تخفيض ${state.user.display_name} إلى مبيعات.`, managementKeyboard());
      return true;
    }

    const removed = await removeUserAccess(state.user.telegram_id, msg.from.id);
    if (removed) await safeNotify(bot, state.user.telegram_id, "تم إلغاء صلاحيتك في البوت. يمكنك إرسال طلب صلاحية جديد لاحقاً.");
    await bot.sendMessage(msg.chat.id, removed ? `تم حذف صلاحية ${removed.display_name}.` : "المستخدم غير موجود أو محذوف بالفعل.", managementKeyboard());
    return true;
  }

  // This state belongs to another workflow (for example, creating/editing an
  // order). Leave it intact so the matching handler can continue it.
  return false;
}

function registerAccessHandlers(bot) {
  bot.onText(/^\/ping(?:@[A-Za-z0-9_]+)?$/i, trackHandler(async (msg) => {
    await bot.sendMessage(msg.chat.id, "البوت يعمل ✅");
  }));

  bot.onText(/^\/start$/, trackHandler(async (msg) => {
    try {
      await clearConversationState(msg.from.id);
      const role = await getRole(msg);
      if (role !== "none") {
        await bot.sendMessage(msg.chat.id, helpText(role), mainKeyboard(role));
        return;
      }

      const request = await getAccessRequest(msg.from.id);
      const message = request?.status === "pending"
        ? "طلبك قيد المراجعة من السوبر أدمن. سيتم إعلامك عند الموافقة."
        : [
            "مرحباً! أنت غير مصرح لك باستخدام هذا البوت.",
            "",
            "اضغط على زر «طلب صلاحية» لمشاركة جهة اتصالك وإرسال طلب للسوبر أدمن.",
          ].join("\n");
      await bot.sendMessage(msg.chat.id, message, unauthorizedKeyboard());
    } catch (error) {
      console.error(error);
      await bot.sendMessage(msg.chat.id, "تعذر التحقق من الصلاحية حالياً. حاول مرة أخرى.");
    }
  }));

  bot.onText(/^\/help$/, trackHandler(async (msg) => {
    await clearConversationState(msg.from.id);
    const role = await getRole(msg);
    await bot.sendMessage(msg.chat.id, helpText(role), role === "none" ? unauthorizedKeyboard() : mainKeyboard(role));
  }));

  bot.onText(/^\/myid$/, trackHandler(async (msg) => {
    await clearConversationState(msg.from.id);
    const role = await getRole(msg);
    await bot.sendMessage(msg.chat.id, `رقم حسابك في تيليجرام: ${msg.from.id}`, role === "none" ? unauthorizedKeyboard() : mainKeyboard(role));
  }));

  bot.on("contact", trackHandler(async (msg) => {
    try {
      const contact = msg.contact;
      if (!contact || String(contact.user_id || "") !== String(msg.from.id)) {
        await bot.sendMessage(msg.chat.id, "يجب إرسال جهة الاتصال الخاصة بك أنت من زر «طلب صلاحية».", unauthorizedKeyboard());
        return;
      }

      const profile = {
        telegramId: String(msg.from.id),
        phone: normalizePhone(contact.phone_number),
        displayName: telegramDisplayName({
          id: msg.from.id,
          first_name: contact.first_name || msg.from.first_name,
          last_name: contact.last_name || msg.from.last_name,
          username: msg.from.username,
        }),
        username: msg.from.username || null,
      };
      const result = await submitAccessRequest(profile);

      if (result.status === "approved") {
        await bot.sendMessage(msg.chat.id, "لديك صلاحية بالفعل. أرسل /start لفتح القائمة.", mainKeyboard(await getRole(msg)));
        return;
      }
      if (!result.isNew) {
        await bot.sendMessage(msg.chat.id, "طلبك قيد المراجعة بالفعل. سيتم إعلامك عند الموافقة.", unauthorizedKeyboard());
        return;
      }

      await bot.sendMessage(
        msg.chat.id,
        [
          "تم استلام طلبك بنجاح! ✅",
          "",
          `الاسم: ${profile.displayName}`,
          `الهاتف: ${profile.phone || "غير محدد"}`,
          "",
          "سيتم مراجعة طلبك من السوبر أدمن. سيصلك إشعار عند الموافقة.",
        ].join("\n"),
        unauthorizedKeyboard(),
      );

      for (const adminId of superAdminIds) {
        await safeNotify(
          bot,
          adminId,
          [
            "📥 طلب صلاحية جديد:",
            "",
            `الاسم: ${profile.displayName}`,
            `الهاتف: ${profile.phone || "غير محدد"}`,
            `Telegram ID: ${profile.telegramId}`,
            "",
            "للمراجعة: إدارة المستخدمين ← طلبات الصلاحية",
          ].join("\n"),
        );
      }
    } catch (error) {
      console.error(error);
      await bot.sendMessage(msg.chat.id, "تعذر إرسال طلب الصلاحية حالياً. حاول مرة أخرى.", unauthorizedKeyboard());
    }
  }));

  bot.on("document", trackHandler(async (msg) => {
    try {
      const [role, state] = await Promise.all([
        getRole(msg),
        getConversationState(msg.from.id),
      ]);
      const isItemsUpload = state?.step === "awaiting_items_file";
      const isPackagesUpload = state?.step === "awaiting_packages_file";
      const isDeliveryUpload = state?.step === "awaiting_delivery_prices_file";
      if (isPackagesUpload) {
        if (!(await requirePackagesManager(bot, msg, role))) return;
      } else if (isItemsUpload) {
        if (!(await requireItemsManager(bot, msg, role))) return;
      } else if (!(await requireDeliveryManager(bot, msg, role))) return;

      const activeKeyboard = isPackagesUpload ? packagesKeyboard() : isItemsUpload ? itemsKeyboard() : deliveryPricesKeyboard();
      if (!isPackagesUpload && !isItemsUpload && !isDeliveryUpload) {
        await bot.sendMessage(
          msg.chat.id,
          "اختر قسم أسعار الشحن أو الأصناف، ثم اضغط زر رفع الملف قبل إرساله.",
          mainKeyboard(role),
        );
        return;
      }

      const document = msg.document;
      const filename = String(document.file_name || "");
      if (!filename.toLowerCase().endsWith(".xlsx")) {
        await bot.sendMessage(msg.chat.id, "أرسل ملف Excel بصيغة .xlsx فقط.", activeKeyboard);
        return;
      }
      const maxBytes = isPackagesUpload ? MAX_PACKAGES_SHEET_BYTES : isItemsUpload ? MAX_ITEMS_SHEET_BYTES : MAX_DELIVERY_SHEET_BYTES;
      if (!document.file_size || document.file_size > maxBytes) {
        await bot.sendMessage(msg.chat.id, "حجم الملف يجب ألا يتجاوز 2 MB.", activeKeyboard);
        return;
      }

      const fileUrl = await bot.getFileLink(document.file_id);
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Telegram file download failed with ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const rows = isPackagesUpload
        ? await parsePackagesWorkbook(buffer)
        : isItemsUpload
        ? await parseItemsWorkbook(buffer)
        : await parseDeliveryPricesWorkbook(buffer);
      if (!rows.length) {
        await bot.sendMessage(
          msg.chat.id,
          isPackagesUpload
            ? "الملف لا يحتوي على باكدجات. أضف باكدج واحداً على الأقل ثم أرسله مرة أخرى."
            : isItemsUpload
            ? "الملف لا يحتوي على أصناف. أضف صنفاً واحداً على الأقل ثم أرسله مرة أخرى."
            : "الملف لا يحتوي على أسعار. أضف منطقة واحدة على الأقل ثم أرسله مرة أخرى.",
          activeKeyboard,
        );
        return;
      }

      const count = isPackagesUpload
        ? await replacePackages(rows, msg.from.id)
        : isItemsUpload
        ? await replaceItems(rows, msg.from.id)
        : await replaceDeliveryPrices(rows, msg.from.id);
      await clearConversationState(msg.from.id);
      await bot.sendMessage(
        msg.chat.id,
        isPackagesUpload
          ? `تم استبدال الباكدجات بنجاح ✅\nعدد الباكدجات المحفوظة: ${count}`
          : isItemsUpload
          ? `تم استبدال الأصناف بنجاح ✅\nعدد الأصناف المحفوظة: ${count}`
          : `تم استبدال أسعار الشحن بنجاح ✅\nعدد المناطق المحفوظة: ${count}`,
        activeKeyboard,
      );
    } catch (error) {
      console.error("Excel upload failed:", error);
      const state = await getConversationState(msg.from.id).catch(() => null);
      const isItemsUpload = state?.step === "awaiting_items_file";
      const isPackagesUpload = state?.step === "awaiting_packages_file";
      const activeKeyboard = isPackagesUpload ? packagesKeyboard() : isItemsUpload ? itemsKeyboard() : deliveryPricesKeyboard();
      const message = error.isDeliveryPricesValidationError || error.isItemsValidationError || error.isPackagesValidationError
        ? error.message
        : isPackagesUpload
          ? "تعذر معالجة ملف الباكدجات حالياً. حاول مرة أخرى."
          : isItemsUpload
          ? "تعذر معالجة ملف الأصناف حالياً. حاول مرة أخرى."
          : "تعذر معالجة ملف أسعار الشحن حالياً. حاول مرة أخرى.";
      await bot.sendMessage(msg.chat.id, message, activeKeyboard);
    }
  }));

  bot.on("message", trackHandler(async (msg) => {
    const text = msg.text?.trim();
    if (!text || text.startsWith("/") || msg.contact) return;

    try {
      const role = await getRole(msg);
      const startsNewCommand = isNavigationCommand(text);
      if (startsNewCommand) await clearConversationState(msg.from.id);
      if (await handleOrderMessage(bot, msg, text, role)) return;
      if (!startsNewCommand && role === "super_admin" && (await handleState(bot, msg, text))) return;

      if (/^(رقمي|myid)$/i.test(text)) {
        await bot.sendMessage(msg.chat.id, `رقم حسابك في تيليجرام: ${msg.from.id}`, role === "none" ? unauthorizedKeyboard() : mainKeyboard(role));
        return;
      }
      if (/^(مساعدة|help)$/i.test(text)) {
        await bot.sendMessage(msg.chat.id, helpText(role), role === "none" ? unauthorizedKeyboard() : mainKeyboard(role));
        return;
      }
      if (/^(طلب صلاحية)$/i.test(text) && role === "none") {
        await bot.sendMessage(msg.chat.id, "اضغط على زر «طلب صلاحية» بالأسفل ووافق على مشاركة جهة اتصالك.", unauthorizedKeyboard());
        return;
      }
      if (/^أسعار الشحن$/i.test(text)) {
        if (!(await requireDeliveryManager(bot, msg, role))) return;
        await showDeliveryPricesMenu(bot, msg.chat.id);
        return;
      }
      if (/^تحميل ملف أسعار الشحن$/i.test(text)) {
        if (!(await requireDeliveryManager(bot, msg, role))) return;
        await sendDeliveryPricesWorkbook(bot, msg);
        return;
      }
      if (/^رفع ملف أسعار الشحن$/i.test(text)) {
        if (!(await requireDeliveryManager(bot, msg, role))) return;
        await setConversationState(msg.from.id, { step: "awaiting_delivery_prices_file" });
        await bot.sendMessage(
          msg.chat.id,
          [
            "أرسل الآن ملف Excel بصيغة .xlsx.",
            "",
            "سيتم التحقق من جميع الصفوف أولاً، ثم استبدال الأسعار القديمة بالكامل.",
            "الحد الأقصى: 1000 منطقة وحجم 2 MB.",
          ].join("\n"),
          deliveryPricesKeyboard(),
        );
        return;
      }
      if (/^الأصناف والأسعار$/i.test(text)) {
        if (!(await requireItemsManager(bot, msg, role))) return;
        await showItemsMenu(bot, msg.chat.id);
        return;
      }
      if (/^تحميل ملف الأصناف$/i.test(text)) {
        if (!(await requireItemsManager(bot, msg, role))) return;
        await sendItemsWorkbook(bot, msg);
        return;
      }
      if (/^رفع ملف الأصناف$/i.test(text)) {
        if (!(await requireItemsManager(bot, msg, role))) return;
        await setConversationState(msg.from.id, { step: "awaiting_items_file" });
        await bot.sendMessage(
          msg.chat.id,
          [
            "أرسل الآن ملف Excel بصيغة .xlsx.",
            "",
            "سيتم التحقق من جميع الصفوف أولاً، ثم استبدال الأصناف القديمة بالكامل.",
            "اسم الصنف والسعر مطلوبان. الحد الأدنى والحد الأقصى اختياريان.",
            "الحد الأقصى: 1000 صنف وحجم 2 MB.",
          ].join("\n"),
          itemsKeyboard(),
        );
        return;
      }
      if (/^الباكدجات$/i.test(text)) {
        if (!(await requirePackagesManager(bot, msg, role))) return;
        await showPackagesMenu(bot, msg.chat.id);
        return;
      }
      if (/^تحميل ملف الباكدجات$/i.test(text)) {
        if (!(await requirePackagesManager(bot, msg, role))) return;
        await sendPackagesWorkbook(bot, msg);
        return;
      }
      if (/^رفع ملف الباكدجات$/i.test(text)) {
        if (!(await requirePackagesManager(bot, msg, role))) return;
        await setConversationState(msg.from.id, { step: "awaiting_packages_file" });
        await bot.sendMessage(msg.chat.id, [
          "أرسل الآن ملف Excel بصيغة .xlsx.", "",
          "سيتم التحقق من جميع الصفوف أولاً، ثم استبدال الباكدجات القديمة بالكامل.",
          "اكتب اسم الباكدج وسعره الإجمالي في أول صف له، ثم أصنافه وكمياتها في الصفوف التالية.",
          "الحد الأقصى: 1000 صف وحجم 2 MB.",
        ].join("\n"), packagesKeyboard());
        return;
      }
      if (/^(إدارة المستخدمين|ادارة المستخدمين)$/i.test(text)) {
        if (!(await requireSuperAdmin(bot, msg, role))) return;
        await showManagement(bot, msg.chat.id);
        return;
      }
      if (/^طلبات الصلاحية$/i.test(text)) {
        if (!(await requireSuperAdmin(bot, msg, role))) return;
        await showPendingRequests(bot, msg);
        return;
      }
      if (/^تحميل سجل الطلبات$/i.test(text)) {
        if (!(await requireOrdersExport(bot, msg, role))) return;
        await sendOrdersWorkbook(bot, msg, role);
        return;
      }
      if (/^قائمة المستخدمين$/i.test(text)) {
        if (!(await requireSuperAdmin(bot, msg, role))) return;
        await showUsers(bot, msg.chat.id);
        return;
      }
      if (/^ترقية إلى مدير$/i.test(text)) {
        if (!(await requireSuperAdmin(bot, msg, role))) return;
        await setConversationState(msg.from.id, { step: "awaiting_user_target", action: "promote" });
        await bot.sendMessage(msg.chat.id, "أرسل اسم موظف المبيعات أو رقم هاتفه أو Telegram ID.", managementKeyboard());
        return;
      }
      if (/^تخفيض إلى مبيعات$/i.test(text)) {
        if (!(await requireSuperAdmin(bot, msg, role))) return;
        await setConversationState(msg.from.id, { step: "awaiting_user_target", action: "demote" });
        await bot.sendMessage(msg.chat.id, "أرسل اسم المدير أو رقم هاتفه أو Telegram ID.", managementKeyboard());
        return;
      }
      if (/^حذف مستخدم$/i.test(text)) {
        if (!(await requireSuperAdmin(bot, msg, role))) return;
        await setConversationState(msg.from.id, { step: "awaiting_user_target", action: "remove" });
        await bot.sendMessage(msg.chat.id, "أرسل اسم المستخدم أو رقم هاتفه أو Telegram ID.", managementKeyboard());
        return;
      }
      if (/^رجوع$/i.test(text)) {
        await clearConversationState(msg.from.id);
        await bot.sendMessage(msg.chat.id, "تم الرجوع للقائمة الرئيسية.", mainKeyboard(role));
        return;
      }

      if (role === "none") {
        await bot.sendMessage(msg.chat.id, "غير مسموح لك باستخدام البوت. أرسل طلب صلاحية أولاً.", unauthorizedKeyboard());
        return;
      }
      await bot.sendMessage(msg.chat.id, "هذه الميزة ستُضاف في المرحلة التالية.", mainKeyboard(role));
    } catch (error) {
      console.error(error);
      await bot.sendMessage(msg.chat.id, "تعذر تنفيذ الطلب حالياً. حاول مرة أخرى.");
    }
  }));
}

module.exports = {
  getRole,
  isSuperAdmin,
  mainKeyboard,
  registerAccessHandlers,
  roleLabels,
  unauthorizedKeyboard,
};
