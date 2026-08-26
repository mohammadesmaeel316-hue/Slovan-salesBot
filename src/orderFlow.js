"use strict";

const {
  clearConversationState,
  addOrderChild,
  addOrderLine,
  cancelSavedOrder,
  deleteOrderChild,
  deleteOrderLine,
  getConversationState,
  getOrderByCode,
  listItems,
  listPackages,
  getItemById,
  getPackageById,
  searchDeliveryPrices,
  searchItems,
  searchOrders,
  searchPackages,
  searchCustomerProfiles,
  findRecentOrdersByPhone,
  findRecentDuplicateOrders,
  deleteAllOrders,
  saveOrder,
  setConversationState,
  updateOrderField,
  updateOrderAdvancePayment,
  updateOrderChild,
  updateOrderDelivery,
  updateOrderLineQuantity,
  updateOrderLineDetails,
} = require("./db");
const { normalizeName, normalizePhone } = require("./utils");

const PAGE_SIZE = 8;
const ORDER_STEPS = new Set([
  "order_customer_choice",
  "customer_search",
  "customer_results",
  "customer_preview",
  "order_duplicate_warning",
  "admin_delete_all_confirm",
  "order_source",
  "order_other_source",
  "order_child_name",
  "order_parent_name",
  "order_parent_phone",
  "order_parent_phone_2",
  "order_parent_phone_3",
  "order_cartoon",
  "order_school",
  "order_stage",
  "order_line_label_color", "order_line_label_white_count", "order_line_label_black_count", "order_line_custom_label",
  "order_type",
  "order_list",
  "order_search",
  "order_quantity",
  "order_post_add",
  "order_discount_type",
  "order_discount_value",
  "order_delivery_list",
  "order_delivery_search",
  "order_cancel_confirm",
  "order_address",
  "order_notes",
  "order_advance_choice",
  "order_advance_amount",
  "order_advance_details",
  "view_order_code",
  "view_order_results",
  "admin_cancel_order_code",
  "admin_cancel_order_confirm",
  "edit_order_code",
  "edit_order_menu",
  "edit_order_value",
  "edit_advance_choice",
  "edit_advance_amount",
  "edit_advance_details",
  "edit_children_list",
  "edit_child_menu",
  "edit_child_value",
  "edit_child_delete_confirm",
  "edit_lines_list",
  "edit_line_menu",
  "edit_line_quantity",
  "edit_line_delete_confirm",
  "edit_line_label_color", "edit_line_label_white_count", "edit_line_label_black_count", "edit_line_custom_label",
  "edit_add_child_name",
  "edit_add_child_cartoon",
  "edit_add_child_school",
  "edit_add_child_stage",
  "edit_add_select_child",
  "edit_add_type",
  "edit_add_list",
  "edit_add_search",
  "edit_add_quantity",
  "edit_add_line_label_color", "edit_add_line_label_white_count", "edit_add_line_label_black_count", "edit_add_line_custom_label",
  "edit_delivery_list",
  "edit_delivery_search",
  "edit_cancel_confirm",
]);

function keyboard(rows, placeholder) {
  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
      input_field_placeholder: placeholder,
    },
  };
}

function orderMenuKeyboard() {
  return keyboard(
    [
      [{ text: "طلب جديد" }, { text: "تعديل طلب" }],
      [{ text: "بحث عن أوردر" }, { text: "بحث عن عميل" }],
      [{ text: "رجوع" }],
    ],
    "اختر إنشاء أو تعديل طلب",
  );
}

function customerChoiceKeyboard() {
  return keyboard(
    [
      [{ text: "بحث عن عميل موجود" }],
      [{ text: "إدخال عميل جديد" }],
      [{ text: "إلغاء" }],
    ],
    "اختر طريقة إدخال العميل",
  );
}
function customerResultsKeyboard(entries) {
  return keyboard(
    [
      ...entries.map((entry) => [
        {
          text: `${entry.customer_name || "بدون اسم"} — ${(entry.primary_phone || entry.phones?.[0] || "").slice(0, 20)}`,
        },
      ]),
      [{ text: "بحث جديد 🔎" }, { text: "إلغاء" }],
    ],
    "اختر العميل",
  );
}
function customerProfileText(profile) {
  const phones = [
    ...new Set(
      [profile.primary_phone, ...(profile.phones || [])].filter(Boolean),
    ),
  ];
  const location = [profile.governorate, profile.zone, profile.area]
    .filter(Boolean)
    .join(" - ");
  return [
    "👤 بيانات العميل",
    "",
    `🖋️ الاسم: ${profile.customer_name || "غير محدد"}`,
    ...phones.map((phone) => `📱 ${arabicDigits(phone)}`),
    location ? `📍 المنطقة: ${location}` : null,
    profile.addresses?.[0] ? `🏠 العنوان: ${profile.addresses[0]}` : null,
    profile.notes ? `📝 ملاحظات: ${profile.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
function profileToDraft(profile) {
  const phones = [
    ...new Set(
      [profile.primary_phone, ...(profile.phones || [])].filter(Boolean),
    ),
  ];
  const savedAddresses = [
    ...new Set((profile.addresses || []).filter(Boolean)),
  ];
  return {
    parentName: profile.customer_name || null,
    parentPhone: phones[0] || null,
    parentPhone2: phones[1] || null,
    parentPhone3: phones[2] || null,
    address: savedAddresses[0] || null,
    savedAddresses,
    notes: profile.notes || null,
    customerArea: profile.area || null,
  };
}

function savedAddressKeyboard(addresses) {
  return keyboard(
    [
      ...addresses.map((_, index) => [{ text: `العنوان ${index + 1}` }]),
      [{ text: "إدخال عنوان جديد" }],
      [{ text: "رجوع خطوة" }, { text: "إلغاء الطلب" }],
    ],
    "اختر عنوان التوصيل",
  );
}
function duplicateWarningText(orders) {
  return `⚠️ تنبيه: يوجد أوردر مؤكد لنفس رقم الموبايل خلال آخر 7 أيام:\n\n${orders.map((o) => `• ${o.order_code} - ${o.parent_name} - ${money(o.grand_total)}ج`).join("\n")}\n\nهل تريد متابعة الأوردر الجديد؟`;
}

function editRootKeyboard() {
  return keyboard(
    [
      [{ text: "تعديل المصدر" }, { text: "تعديل اسم ولي الأمر" }],
      [{ text: "تعديل رقم الموبايل" }, { text: "تعديل الشحن" }],
      [{ text: "تعديل الدفعة المقدمة" }],
      [{ text: "الأطفال داخل الأوردر" }],
      [{ text: "المنتجات والباكدجات" }],
      [{ text: "إضافة طفل جديد" }, { text: "إضافة منتج جديد" }],
      [{ text: "إلغاء الأوردر بالكامل" }],
      [{ text: "إنهاء التعديل" }],
    ],
    "اختر البيانات المطلوب تعديلها",
  );
}

function childEditKeyboard() {
  return keyboard(
    [
      [{ text: "تعديل اسم الطفل" }, { text: "تعديل الشخصية" }],
      [{ text: "تعديل المدرسة" }, { text: "تعديل المرحلة الدراسية" }],
      [{ text: "حذف الطفل" }, { text: "العودة لبيانات الأوردر" }],
    ],
    "اختر التعديل المطلوب",
  );
}

function lineEditKeyboard(hasLabel = false) {
  const rows = [
    [{ text: "تعديل الكمية" }, { text: "حذف المنتج" }],
  ];
  if (hasLabel) rows.push([{ text: "تعديل لون الليبل" }]);
  rows.push([{ text: "العودة لبيانات الأوردر" }]);
  return keyboard(rows, "اختر التعديل المطلوب");
}

async function lineRequiresLabel(line) {
  if (line.details?.labelColor) return true;
  if (!line.reference_id) return false;
  try {
    if (line.line_type === "item") {
      const item = await getItemById(line.reference_id);
      return Boolean(item?.requires_label_color);
    }
    if (line.line_type === "package") {
      const pkg = await getPackageById(line.reference_id);
      return Boolean(pkg?.requires_label_color);
    }
  } catch {}
  return false;
}

function confirmKeyboard(confirmText) {
  return keyboard(
    [[{ text: confirmText }, { text: "لا، رجوع" }]],
    "أكد العملية",
  );
}

function controls(extra = []) {
  return [...extra, [{ text: "رجوع خطوة" }, { text: "إلغاء الطلب" }]];
}

function deleteConfirmationKeyboard() {
  return keyboard([[{ text: "رجوع خطوة" }]], "اكتب حذف للتأكيد");
}

function cancelConfirmationKeyboard() {
  return keyboard([[{ text: "رجوع خطوة" }]], "اكتب الغاء للتأكيد");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function short(value, max = 48) {
  const text = String(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function historySnapshot(state) {
  const { history, ...snapshot } = state;
  return clone(snapshot);
}

async function moveForward(telegramId, state, changes) {
  const next = {
    ...state,
    ...changes,
    history: [...(state.history || []), historySnapshot(state)].slice(-30),
  };
  await setConversationState(telegramId, next);
  return next;
}

async function goBack(telegramId, state) {
  const history = [...(state.history || [])];
  const previous = history.pop();
  if (!previous) return null;
  const restored = { ...previous, history };
  await setConversationState(telegramId, restored);
  return restored;
}

function sourceKeyboard() {
  return keyboard(
    controls([
      [{ text: "Facebook" }, { text: "Instagram" }],
      [{ text: "WhatsApp" }, { text: "أخرى" }],
    ]),
    "اختر مصدر الأوردر",
  );
}

function textKeyboard(placeholder) {
  return keyboard(controls([]), placeholder);
}

function optionalTextKeyboard(placeholder) {
  return keyboard(
    [[{ text: "تخطي" }], [{ text: "رجوع خطوة" }, { text: "إلغاء الطلب" }]],
    placeholder,
  );
}

function lineLabelKeyboard(quantity = 2) {
  const row = [{ text: "أبيض" }, { text: "أسود" }];
  if (Number(quantity) !== 1) row.push({ text: "الاثنين" });
  return keyboard(controls([row, [{ text: "لون آخر" }]]), "اختر لون الليبل");
}

function packageLabelCount(pkg) {
  if (!pkg || !Array.isArray(pkg.items)) return 0;
  return pkg.items.reduce((sum, it) => {
    const name = String(it.item_name || "").toLowerCase();
    if (name.includes("ليبل") && name.includes("ملابس")) return sum + Number(it.quantity || 0);
    return sum;
  }, 0);
}

async function getLineLabelCount(line) {
  if (!line) return 1;
  if (line.line_type === "package" && line.reference_id) {
    try {
      const pkg = await getPackageById(line.reference_id);
      const c = packageLabelCount(pkg);
      if (c > 0) return c;
    } catch {}
  }
  return Number(line.quantity || 1);
}

function orderTypeKeyboard() {
  return keyboard(
    controls([[{ text: "باكدج" }, { text: "صنف عادي" }]]),
    "اختر نوع المنتج",
  );
}

function discountKeyboard() {
  return keyboard(
    controls([
      [{ text: "بدون خصم" }],
      [{ text: "خصم نسبة مئوية" }, { text: "خصم مبلغ ثابت" }],
    ]),
    "اختر نوع الخصم",
  );
}

function postAddKeyboard(childCount) {
  const rows = [[{ text: "التالي ➕" }, { text: "إنهاء الطلب" }]];
  if (childCount < 6) rows.push([{ text: "إضافة طفل آخر" }]);
  return keyboard(controls(rows), "أضف منتجاً أو طفلاً، أو أنهِ الطلب");
}

function listKeyboard(entries, page, totalPages) {
  const rows = entries.map((entry) => [{ text: short(entry.label, 60) }]);
  const navigation = [];
  if (page > 0) navigation.push({ text: "السابق ◀️" });
  navigation.push({ text: "بحث 🔎" });
  if (page + 1 < totalPages) navigation.push({ text: "التالي ▶️" });
  rows.push(navigation);
  return keyboard(controls(rows), "اختر من القائمة أو استخدم البحث");
}

function orderResultsKeyboard(entries, page, totalPages) {
  const rows = entries.map((entry) => [
    {
      text: `${entry.order_code} — ${short(entry.parent_name, 24)} — ${entry.parent_phone}`,
    },
  ]);
  const navigation = [];
  if (page > 0) navigation.push({ text: "السابق ◀️" });
  navigation.push({ text: "بحث جديد 🔎" });
  if (page + 1 < totalPages) navigation.push({ text: "التالي ▶️" });
  rows.push(navigation, [{ text: "إلغاء" }]);
  return keyboard(rows, "اختر الأوردر");
}

function initialDraft() {
  return {
    source: null,
    parentName: null,
    parentPhone: null,
    parentPhone2: null,
    parentPhone3: null,
    address: null,
    notes: null,
    advancePayment: 0,
    advancePaymentDetails: null,
    discount: { type: null, value: 0 },
    children: [],
    lines: [],
    currentChildIndex: 0,
    delivery: null,
  };
}

function currentChild(state) {
  return state.draft.children[state.draft.currentChildIndex];
}

function normalizeSearch(value) {
  return normalizeName(value).toLocaleLowerCase("ar-EG");
}

async function listEntries(listType, query = "", page = 0) {
  let result;
  if (listType === "package") {
    result = await searchPackages(query, page, PAGE_SIZE);
    return {
      entries: result.entries.map((row) => ({
        label: row.package_name,
        value: row,
      })),
      total: result.total,
    };
  } else if (listType === "item") {
    result = await searchItems(query, page, PAGE_SIZE);
    return {
      entries: result.entries.map((row) => ({
        label: row.item_name,
        value: row,
      })),
      total: result.total,
    };
  } else {
    result = await searchDeliveryPrices(query, page, PAGE_SIZE);
    return {
      entries: result.entries.map((row) => ({
        label: row.area_name,
        value: row,
      })),
      total: result.total,
    };
  }
}

async function showList(bot, msg, state) {
  const requestedPage = state.page || 0;
  const initial = await listEntries(
    state.listType,
    state.query || "",
    requestedPage,
  );
  const totalPages = Math.max(1, Math.ceil(initial.total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages - 1);
  if (page !== state.page) {
    state.page = page;
    await setConversationState(msg.from.id, state);
  }
  const { entries: visible } =
    page === requestedPage
      ? initial
      : await listEntries(state.listType, state.query || "", page);
  const names = {
    package: "الباكدجات",
    item: "الأصناف",
    delivery: "مناطق الشحن",
  };
  const suffix = state.query ? `\nنتائج البحث عن: ${state.query}` : "";
  await bot.sendMessage(
    msg.chat.id,
    visible.length
      ? `اختر من ${names[state.listType]}:${suffix}`
      : `لا توجد نتائج.${suffix}`,
    listKeyboard(visible, page, totalPages),
  );
}

async function showOrderSearchResults(bot, msg, state) {
  const requestedPage = state.page || 0;
  const first = await searchOrders(state.query, requestedPage, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(first.total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages - 1);
  if (page !== state.page) {
    state.page = page;
    await setConversationState(msg.from.id, state);
  }
  const { entries } =
    page === requestedPage
      ? first
      : await searchOrders(state.query, page, PAGE_SIZE);
  await bot.sendMessage(
    msg.chat.id,
    entries.length
      ? `نتائج البحث عن: ${state.query}`
      : "لا توجد أوردرات مطابقة.",
    orderResultsKeyboard(entries, page, totalPages),
  );
}

async function promptForState(bot, msg, state) {
  const prompts = {
    order_customer_choice: [
      "هل تريد استخدام بيانات عميل موجود أم إدخال بيانات جديدة؟",
      customerChoiceKeyboard(),
    ],
    customer_search: [
      "اكتب رقم موبايل العميل أو اسمه للبحث:",
      textKeyboard("رقم الموبايل أو الاسم"),
    ],
    order_source: ["اختر مصدر الأوردر:", sourceKeyboard()],
    order_other_source: ["اكتب مصدر الأوردر:", textKeyboard("اكتب المصدر")],
    order_child_name: [
      state.draft?.children?.length
        ? `اكتب اسم الطفل رقم ${state.draft.children.length + 1} (كلمتان على الأقل):`
        : "اكتب اسم الطفل (كلمتان على الأقل):",
      textKeyboard("اسم الطفل"),
    ],
    order_parent_name: [
      "اكتب اسم ولي الأمر (كلمتان على الأقل):",
      textKeyboard("اسم ولي الأمر"),
    ],
    order_parent_phone: [
      "اكتب رقم موبايل ولي الأمر:",
      textKeyboard("رقم الموبايل"),
    ],
    order_parent_phone_2: [
      "اكتب رقم الموبايل الثاني (اختياري)، أو اضغط تخطي:",
      optionalTextKeyboard("رقم الموبايل الثاني"),
    ],
    order_parent_phone_3: [
      "اكتب رقم الموبايل الثالث (اختياري)، أو اضغط تخطي:",
      optionalTextKeyboard("رقم الموبايل الثالث"),
    ],
    order_cartoon: [
      "اكتب الشخصية الكرتونية المطلوبة، أو اضغط تخطي:",
      optionalTextKeyboard("الشخصية الكرتونية"),
    ],
    order_school: [
      "اكتب اسم المدرسة، أو اضغط تخطي:",
      optionalTextKeyboard("اسم المدرسة"),
    ],
    order_stage: [
      "اكتب المرحلة الدراسية، أو اضغط تخطي:",
      optionalTextKeyboard("المرحلة الدراسية"),
    ],
    order_line_label_color: ["اختر لون ليبل الملابس لهذا الصنف:", lineLabelKeyboard(state.pendingLine?.labelCount ?? state.pendingLine?.quantity)],
    order_line_label_white_count: [`اكتب عدد الليبل الأبيض. الكمية المطلوبة: ${state.pendingLine?.labelCount ?? state.pendingLine?.quantity ?? 1}`, textKeyboard("عدد الأبيض")],
    order_line_label_black_count: [`اكتب عدد الليبل الأسود. المتبقي: ${Math.max(0, (state.pendingLine?.labelCount ?? state.pendingLine?.quantity ?? 1) - (state.labelWhiteCount || 0))}`, textKeyboard("عدد الأسود")],
    order_line_custom_label: ["اكتب لون ليبل الملابس:", textKeyboard("لون الليبل")],
    order_type: ["اختر: باكدج أم صنف عادي؟", orderTypeKeyboard()],
    order_quantity: [
      `اكتب الكمية المطلوبة من «${state.pendingItem?.itemName || "الصنف"}».\nالمسموح: ${state.pendingItem?.minQuantity ?? "بدون حد أدنى"} إلى ${state.pendingItem?.maxQuantity ?? "بدون حد أقصى"}.`,
      textKeyboard("الكمية"),
    ],
    order_post_add: [
      "تمت الإضافة ✅\nاختر الخطوة التالية:",
      postAddKeyboard(state.draft?.children?.length || 0),
    ],
    order_discount_type: ["هل يوجد خصم على الأوردر؟", discountKeyboard()],
    order_discount_value: [
      state.discountType === "percent"
        ? "اكتب نسبة الخصم، مثال: 20 أو 20%:"
        : "اكتب قيمة الخصم بالجنيه، مثال: 50:",
      textKeyboard("قيمة الخصم"),
    ],
    order_cancel_confirm: [
      "لإلغاء الأوردر اكتب كلمة «الغاء» حرفياً.\nأي كلمة أخرى لن تلغي الأوردر.",
      cancelConfirmationKeyboard(),
    ],
    order_address: [
      Array.isArray(state.draft?.savedAddresses) &&
      state.draft.savedAddresses.length &&
      state.addressMode !== "manual"
        ? `اختر عنوان التوصيل:\n${state.draft.savedAddresses.map((address, index) => `${index + 1}. ${address}`).join("\n")}`
        : "اكتب عنوان التوصيل بالتفصيل:",
      Array.isArray(state.draft?.savedAddresses) &&
      state.draft.savedAddresses.length &&
      state.addressMode !== "manual"
        ? savedAddressKeyboard(state.draft.savedAddresses)
        : textKeyboard("العنوان"),
    ],
    order_notes: [
      state.draft?.notes
        ? `الملاحظات المحفوظة: ${state.draft.notes}\nاكتب ملاحظات جديدة، أو اختر الاحتفاظ بها أو تخطي:`
        : "اكتب الملاحظات الإضافية (اختياري)، أو اضغط تخطي:",
      state.draft?.notes
        ? keyboard(
            [
              [{ text: "استخدام الملاحظات المحفوظة" }, { text: "تخطي" }],
              [{ text: "رجوع خطوة" }, { text: "إلغاء الطلب" }],
            ],
            "ملاحظات",
          )
        : optionalTextKeyboard("ملاحظات"),
    ],
    order_advance_choice: [
      "هل قام العميل بدفع مبلغ مقدم؟",
      keyboard(
        [
          [{ text: "نعم، تم الدفع" }, { text: "لا، لم يدفع" }],
          [{ text: "رجوع خطوة" }, { text: "إلغاء الطلب" }],
        ],
        "اختر حالة الدفعة",
      ),
    ],
    order_advance_amount: [
      "اكتب مبلغ الدفعة المقدمة بالجنيه:",
      textKeyboard("مبلغ الدفعة"),
    ],
    order_advance_details: ["اكتب تفاصيل الدفع:", textKeyboard("تفاصيل الدفع")],
    edit_advance_amount: [
      "اكتب مبلغ الدفعة المقدمة بالجنيه:",
      keyboard([[{ text: "رجوع خطوة" }, { text: "إلغاء" }]], "مبلغ الدفعة"),
    ],
    edit_advance_details: [
      "اكتب تفاصيل الدفع:",
      keyboard([[{ text: "رجوع خطوة" }, { text: "إلغاء" }]], "تفاصيل الدفع"),
    ],
    edit_line_label_color: ["اختر لون الليبل لهذا المنتج:", lineLabelKeyboard(state.editLineLabelCount ?? state.editLine?.quantity)],
    edit_line_label_white_count: [`اكتب عدد الليبل الأبيض. الكمية المطلوبة: ${state.editLineLabelCount ?? state.editLine?.quantity ?? 1}`, textKeyboard("عدد الأبيض")],
    edit_line_label_black_count: [`اكتب عدد الليبل الأسود. المتبقي: ${Math.max(0, (state.editLineLabelCount ?? state.editLine?.quantity ?? 1) - (state.labelWhiteCount || 0))}`, textKeyboard("عدد الأسود")],
    edit_line_custom_label: ["اكتب لون ليبل الملابس:", textKeyboard("لون الليبل")],
    admin_cancel_order_code: [
      "اكتب رقم الأوردر المراد إلغاؤه، مثال: ORD#001",
      keyboard([[{ text: "إلغاء" }]], "رقم الأوردر"),
    ],
    view_order_code: [
      "ابحث برقم الأوردر، أو رقم موبايل العميل، أو اسم الطفل:\nمثال: ORD#001 أو 01126390787 أو Hamza",
      keyboard([[{ text: "إلغاء" }]], "ابحث عن أوردر"),
    ],
    edit_order_code: [
      "اكتب رقم الأوردر، مثال: ORD#001",
      keyboard([[{ text: "إلغاء" }]], "رقم الأوردر"),
    ],
    edit_add_child_name: [
      "اكتب اسم الطفل الجديد (كلمتان على الأقل):",
      textKeyboard("اسم الطفل"),
    ],
    edit_add_child_cartoon: [
      "اكتب الشخصية الكرتونية للطفل الجديد، أو اضغط تخطي:",
      optionalTextKeyboard("الشخصية"),
    ],
    edit_add_child_school: [
      "اكتب مدرسة الطفل الجديد، أو اضغط تخطي:",
      optionalTextKeyboard("المدرسة"),
    ],
    edit_add_child_stage: [
      "اكتب المرحلة الدراسية للطفل الجديد، أو اضغط تخطي:",
      optionalTextKeyboard("المرحلة الدراسية"),
    ],
    edit_add_type: ["اختر ما تريد إضافته:", orderTypeKeyboard()],
    edit_add_line_label_color: ["اختر لون ليبل الملابس لهذا الصنف:", lineLabelKeyboard(state.pendingLine?.labelCount ?? state.pendingLine?.quantity)],
    edit_add_line_label_white_count: [`اكتب عدد الليبل الأبيض. الكمية المطلوبة: ${state.pendingLine?.labelCount ?? state.pendingLine?.quantity ?? 1}`, textKeyboard("عدد الأبيض")],
    edit_add_line_label_black_count: [`اكتب عدد الليبل الأسود. المتبقي: ${Math.max(0, (state.pendingLine?.labelCount ?? state.pendingLine?.quantity ?? 1) - (state.labelWhiteCount || 0))}`, textKeyboard("عدد الأسود")],
    edit_add_line_custom_label: ["اكتب لون ليبل الملابس:", textKeyboard("لون الليبل")],
  };
  if (
    [
      "order_list",
      "order_delivery_list",
      "edit_add_list",
      "edit_delivery_list",
    ].includes(state.step)
  )
    return showList(bot, msg, state);
  const prompt = prompts[state.step];
  if (prompt) {
    await bot.sendMessage(msg.chat.id, prompt[0], prompt[1]);
    return;
  }
  // Steps rendered by custom functions must also re-render when the user
  // presses رجوع خطوة back into them, otherwise the bot appears stuck.
  if (state.step === "edit_order_menu") return showEditRoot(bot, msg, state);
  if (state.step === "edit_children_list") return showEditChildren(bot, msg, state);
  if (state.step === "edit_lines_list") return showEditLines(bot, msg, state);
  if (state.step === "view_order_results") return showOrderSearchResults(bot, msg, state);
  if (state.step === "order_duplicate_warning") {
    return bot.sendMessage(
      msg.chat.id,
      duplicateWarningText(state.duplicateOrders || []),
      keyboard(
        [
          [{ text: "متابعة الأوردر الجديد" }],
          [{ text: "الرجوع وتعديل البيانات" }, { text: "إلغاء" }],
        ],
        "اختر الإجراء",
      ),
    );
  }
  if (state.step === "admin_cancel_order_confirm") {
    return bot.sendMessage(
      msg.chat.id,
      `${savedOrderSummary(state.cancelOrderPreview || {})}\n\nلإلغاء هذا الأوردر اكتب كلمة «الغاء» حرفياً. أو اضغط رجوع خطوة.`,
      cancelConfirmationKeyboard(),
    );
  }
  if (state.step === "customer_results") {
    return bot.sendMessage(
      msg.chat.id,
      "اختر العميل:",
      customerResultsKeyboard(state.customerResults || []),
    );
  }
  if (state.step === "customer_preview") {
    const actions =
      state.customerContext === "new_order"
        ? keyboard(
            [
              [{ text: "استخدام بيانات العميل" }],
              [{ text: "إدخال عميل جديد" }],
              [{ text: "إلغاء" }],
            ],
            "اختر الإجراء",
          )
        : orderMenuKeyboard();
    return bot.sendMessage(
      msg.chat.id,
      customerProfileText(state.selectedCustomer || {}),
      actions,
    );
  }
  if (state.step === "edit_child_menu") {
    const order = await editOrderAndCheck(state);
    const child = order?.children.find(
      (c) => String(c.id) === String(state.editChildId),
    );
    return bot.sendMessage(
      msg.chat.id,
      `الطفل: ${child?.child_name ?? ""}`,
      childEditKeyboard(),
    );
  }
  if (state.step === "edit_line_menu") {
    const order = await editOrderAndCheck(state);
    const line = order?.lines.find(
      (l) => String(l.id) === String(state.editLineId),
    );
    if (!line) return showEditLines(bot, msg, state);
    const hasLabel = await lineRequiresLabel(line);
    return bot.sendMessage(
      msg.chat.id,
      `${line.description} × ${line.quantity}`,
      lineEditKeyboard(hasLabel),
    );
  }
  if (state.step === "edit_add_select_child") {
    const order = await editOrderAndCheck(state);
    if (!order) return;
    const rows = order.children.map((child, i) => [
      { text: `إضافة للطفل ${i + 1}: ${short(child.child_name, 38)}` },
    ]);
    rows.push([{ text: "العودة لبيانات الأوردر" }]);
    return bot.sendMessage(
      msg.chat.id,
      "اختر الطفل الذي سيُضاف له المنتج:",
      keyboard(rows, "اختر الطفل"),
    );
  }
  if (state.step === "edit_order_value") {
    return bot.sendMessage(
      msg.chat.id,
      "اكتب القيمة الجديدة:",
      keyboard(
        [[{ text: "رجوع خطوة" }, { text: "إلغاء" }]],
        "القيمة الجديدة",
      ),
    );
  }
  if (state.step === "edit_child_value") {
    return bot.sendMessage(
      msg.chat.id,
      "اكتب القيمة الجديدة:",
      textKeyboard("القيمة الجديدة"),
    );
  }
  if (state.step === "edit_line_quantity") {
    return bot.sendMessage(
      msg.chat.id,
      "اكتب الكمية الجديدة:",
      textKeyboard("الكمية"),
    );
  }
  if (state.step === "edit_add_quantity") {
    return bot.sendMessage(
      msg.chat.id,
      `اكتب الكمية من «${state.pendingItem?.itemName || "الصنف"}».\nالمسموح: ${state.pendingItem?.minQuantity ?? 1} إلى ${state.pendingItem?.maxQuantity ?? "بدون حد"}.`,
      textKeyboard("الكمية"),
    );
  }
}

function arabicDigits(value) {
  return String(value).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
}

function money(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

const SUMMARY_DIVIDER = "━━━━━━━━━━━━━━";

function spacedSummary(lines) {
  return lines.join("\n").replace(/([^\n])\n([^\n])/g, "$1\n\n$2");
}

function itemsTotalFor(draft) {
  return (
    draft.lines.reduce(
      (sum, line) => sum + Math.round(Number(line.lineTotal) * 100),
      0,
    ) / 100
  );
}

function discountAmountFor(draft, itemsTotal = itemsTotalFor(draft)) {
  const discount = draft.discount || {};
  const raw = Number(discount.value || 0);
  const amount =
    discount.type === "percent"
      ? (itemsTotal * raw) / 100
      : discount.type === "fixed"
        ? raw
        : 0;
  return Math.min(itemsTotal, Math.max(0, Math.round(amount * 100) / 100));
}

function orderSummary(draft, orderCode) {
  const itemsTotal = itemsTotalFor(draft);
  const discountAmount = discountAmountFor(draft, itemsTotal);
  const afterDiscount = itemsTotal - discountAmount;
  const grandTotal =
    (Math.round(afterDiscount * 100) +
      Math.round(Number(draft.delivery.price) * 100)) /
    100;

  const lines = [
    `🧾 رقم الأوردر: ${orderCode}`,
    `📍 مصدر الأوردر: ${draft.source}`,
    "",
    SUMMARY_DIVIDER,
    "👤 بيانات العميل والتوصيل",
    "",
    `🖋️ الاسم: ${draft.parentName}`,
    `📱 رقم الموبايل: ${draft.parentPhone}`,
  ];

  if (draft.parentPhone2) {
    lines.push(`📱 رقم موبايل إضافي : ${draft.parentPhone2}`);
  }

  if (draft.parentPhone3) {
    lines.push(`📱 رقم موبايل إضافي ٢ : ${draft.parentPhone3}`);
  }

  if (draft.delivery?.areaName) {
    lines.push(`📍 منطقة التوصيل: ${draft.delivery.areaName}`);
  }

  if (draft.address) {
    lines.push(`🏠 العنوان: ${draft.address}`);
  }

  lines.push("", SUMMARY_DIVIDER, "📦 تفاصيل الأوردر");

  draft.children.forEach((child, index) => {
    const childLines = draft.lines.filter((line) => line.childIndex === index);

    lines.push("", `🌝 اسم الطفل : ${child.childName}`);
    if (child.cartoonCharacter && child.cartoonCharacter !== "غير محدد") {
      lines.push(`🧸 الشخصيه : ${child.cartoonCharacter}`);
    }
    if (child.schoolName && child.schoolName !== "غير محدد") {
      lines.push(`📌 المدرسة :- ${child.schoolName}`);
    }
    if (child.schoolStage && child.schoolStage !== "غير محدد") {
      lines.push(`📚 المرحلة الدراسية : ${child.schoolStage}`);
    }

    // كل منتج / باكدج في سطر منفصل
    const orderItems = childLines
      .map((line) => {
        let text;
        if (line.type === "item") {
          text = `${line.description} × ${line.quantity}`;
        } else {
          // الباكدج بدون × 1
          text = line.description;
        }
        if (line.details?.labelColor) {
          text += line.details.labelColor === "الاثنين"
            ? ` (ليبل أبيض ${line.details.whiteCount ?? 0} / أسود ${line.details.blackCount ?? 0})`
            : ` (ليبل ${line.details.labelColor})`;
        }
        return text;
      })
      .join("\n");

    lines.push(`◼️ الاوردر المطلوب :\n${orderItems}`);
  });

  const priceParts = draft.lines.map((line) => money(line.lineTotal));

  lines.push(
    "",
    SUMMARY_DIVIDER,
    "💰 ملخص الحساب",
    "",
    `▪️ إجمالي الأوردر: ${priceParts.join("+")}=${money(itemsTotal)}ج`,
  );

  if (discountAmount) {
    lines.push(
      `🏷️ الخصم : ${
        draft.discount.type === "percent"
          ? `${money(draft.discount.value)}%`
          : `${money(discountAmount)}ج`
      } = ${money(discountAmount)}ج`,
      `▪️ إجمالي الأوردر بعد الخصم : ${money(afterDiscount)}ج`,
    );
  }

  lines.push(
    `🚚 الشحن: ${money(draft.delivery.price)}ج`,
    `🧾 إجمالي الأوردر بالشحن: ${money(afterDiscount)}+${money(
      draft.delivery.price,
    )}=${money(grandTotal)}ج`,
  );

  const advancePayment = Math.min(
    grandTotal,
    Math.max(0, Number(draft.advancePayment || 0)),
  );

  if (advancePayment) {
    lines.push(`💳 الدفعة المقدمة : ${money(advancePayment)}ج`);

    if (draft.advancePaymentDetails) {
      lines.push(`📝 تفاصيل الدفع : ${draft.advancePaymentDetails}`);
    }

    lines.push(`💰 المتبقي : ${money(grandTotal - advancePayment)}ج`);
  }

  if (draft.notes) {
    lines.push("", SUMMARY_DIVIDER, "📝 ملاحظات", "", draft.notes);
  }

  return spacedSummary(lines);
}

function savedOrderSummary(order) {
  const lines = [
    `🧾 رقم الأوردر: ${order.order_code}`,
    `📍 مصدر الأوردر: ${order.source}`,
    "",
    SUMMARY_DIVIDER,
    "👤 بيانات العميل والتوصيل",
    "",
    `🖋️ الاسم: ${order.parent_name}`,
    `📱 رقم الموبايل: ${order.parent_phone}`,
  ];

  if (order.status === "cancelled") {
    lines.splice(1, 0, "⚠️ حالة الأوردر : ملغي");
  }

  if (order.parent_phone_2) {
    lines.push(`📱 رقم موبايل إضافي : ${order.parent_phone_2}`);
  }

  if (order.parent_phone_3) {
    lines.push(`📱 رقم موبايل إضافي ٢ : ${order.parent_phone_3}`);
  }

  if (order.delivery_area) {
    lines.push(`📍 منطقة التوصيل: ${order.delivery_area}`);
  }

  if (order.address) {
    lines.push(`🏠 العنوان: ${order.address}`);
  }

  lines.push("", SUMMARY_DIVIDER, "📦 تفاصيل الأوردر");

  order.children.forEach((child) => {
    const childLines = order.lines.filter(
      (line) => String(line.child_id) === String(child.id),
    );

    lines.push("", `🌝 اسم الطفل : ${child.child_name}`);
    if (child.cartoon_character && child.cartoon_character !== "غير محدد") {
      lines.push(`🧸 الشخصيه : ${child.cartoon_character}`);
    }
    if (child.school_name && child.school_name !== "غير محدد") {
      lines.push(`📌 المدرسة :- ${child.school_name}`);
    }
    if (child.school_stage && child.school_stage !== "غير محدد") {
      lines.push(`📚 المرحلة الدراسية : ${child.school_stage}`);
    }

    // كل منتج / باكدج في سطر منفصل
    const orderItems = childLines
      .map((line) => {
        let text;
        if (line.line_type === "item") {
          text = `${line.description} × ${line.quantity}`;
        } else {
          // الباكدج بدون × 1
          text = line.description;
        }
        const details = line.details && typeof line.details === "object" ? line.details : null;
        if (details?.labelColor) {
          text += details.labelColor === "الاثنين"
            ? ` (ليبل أبيض ${details.whiteCount ?? 0} / أسود ${details.blackCount ?? 0})`
            : ` (ليبل ${details.labelColor})`;
        }
        return text;
      })
      .join("\n");

    lines.push(`◼️ الاوردر المطلوب :\n${orderItems}`);
  });

  const priceParts = order.lines.map((line) => money(line.line_total));

  lines.push(
    "",
    SUMMARY_DIVIDER,
    "💰 ملخص الحساب",
    "",
    `▪️ إجمالي الأوردر: ${priceParts.join("+")}=${money(order.items_total)}ج`,
  );

  if (Number(order.discount_amount || 0)) {
    lines.push(
      `🏷️ الخصم : ${
        order.discount_type === "percent"
          ? `${money(order.discount_value)}%`
          : `${money(order.discount_amount)}ج`
      } = ${money(order.discount_amount)}ج`,
    );

    const afterDiscount =
      Number(order.items_total) - Number(order.discount_amount || 0);

    lines.push(`▪️ إجمالي الأوردر بعد الخصم : ${money(afterDiscount)}ج`);
  }

  const afterDiscount =
    Number(order.items_total) - Number(order.discount_amount || 0);

  lines.push(
    `🚚 الشحن: ${money(order.shipping_price)}ج`,
    `🧾 إجمالي الأوردر بالشحن: ${money(
      afterDiscount,
    )}+${money(order.shipping_price)}=${money(order.grand_total)}ج`,
  );

  const advancePayment = Math.min(
    Number(order.grand_total),
    Math.max(0, Number(order.advance_payment || 0)),
  );

  if (advancePayment) {
    lines.push(`💳 الدفعة المقدمة : ${money(advancePayment)}ج`);

    if (order.advance_payment_details) {
      lines.push(`📝 تفاصيل الدفع : ${order.advance_payment_details}`);
    }

    lines.push(
      `💰 المتبقي : ${money(Number(order.grand_total) - advancePayment)}ج`,
    );
  }

  if (order.notes) {
    lines.push("", SUMMARY_DIVIDER, "📝 ملاحظات", "", order.notes);
  }

  return spacedSummary(lines);
}

function parseAmount(value) {
  return Number(
    String(value)
      .replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit))
      .replace(/,/g, "")
      .trim(),
  );
}

function draftGrandTotal(draft) {
  const itemsTotal = itemsTotalFor(draft);
  const discountAmount = discountAmountFor(draft, itemsTotal);
  return (
    (Math.round((itemsTotal - discountAmount) * 100) +
      Math.round(Number(draft.delivery?.price || 0) * 100)) /
    100
  );
}

async function finishNewOrder(bot, msg, draft, telegramId) {
  if (!draft.skipDuplicateCheck) {
    let duplicates = [];
    try {
      duplicates = await findRecentDuplicateOrders(draft);
    } catch (error) {
      // A warning must never prevent a valid order from being saved.
      console.error("Duplicate-order check failed:", error);
    }
    if (duplicates.length) {
      const current = await getConversationState(telegramId);
      await setConversationState(telegramId, {
        ...(current || {}),
        step: "order_duplicate_warning",
        pendingNextStep: "order_finish",
        draft,
        duplicateOrders: duplicates,
      });
      await bot.sendMessage(
        msg.chat.id,
        duplicateWarningText(duplicates),
        keyboard(
          [
            [{ text: "متابعة الأوردر الجديد" }],
            [{ text: "الرجوع وتعديل البيانات" }, { text: "إلغاء" }],
          ],
          "اختر الإجراء",
        ),
      );
      return false;
    }
  }
  // Retry once for transient pool/network blips; keep draft on failure so user can retry.
  let saved = null;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      saved = await saveOrder(draft, telegramId);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const isTransient = /timeout|ECONN|terminat|Pool|connection|ETIMEDOUT/i.test(error.message || "");
      console.error(`saveOrder attempt ${attempt + 1} failed:`, error.message, error.stack);
      if (attempt === 0 && isTransient) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      break;
    }
  }
  if (lastError) {
    console.error("saveOrder failed final:", {
      error: lastError.message,
      stack: lastError.stack,
      draftPreview: JSON.stringify(draft).slice(0, 2000),
    });
    // Preserve conversation so user does not lose the whole order - they can press the same button again.
    try {
      const current = await getConversationState(telegramId);
      await setConversationState(telegramId, {
        ...(current || { step: "order_advance_choice", draft, history: [] }),
        step: "order_advance_choice",
        draft,
        saveError: true,
      });
    } catch {}
    await bot.sendMessage(
      msg.chat.id,
      "تعذر حفظ الأوردر لخلل مؤقت في الاتصال. اضغط نفس الزر مرة أخرى (مثلاً «لا، لم يدفع») أو «رجوع خطوة» للمحاولة مجدداً. موضعك محفوظ.",
      keyboard(
        [
          [{ text: "لا، لم يدفع" }, { text: "نعم، تم الدفع" }],
          [{ text: "رجوع خطوة" }, { text: "إلغاء الطلب" }],
        ],
        "أعد المحاولة",
      ),
    );
    return false;
  }
  await clearConversationState(telegramId);
  await bot.sendMessage(
    msg.chat.id,
    `${orderSummary(draft, saved.orderCode)}\n\nتم حفظ الأوردر بنجاح ✅`,
    orderMenuKeyboard(),
  );
}

async function showEditRoot(bot, msg, state, notice = null) {
  const order = await getOrderByCode(state.editOrderCode);
  if (!order || order.status !== "confirmed") {
    await cancelOrder(bot, msg);
    return;
  }
  const prefix = notice ? `${notice}\n\n` : "";
  await bot.sendMessage(
    msg.chat.id,
    `${prefix}${savedOrderSummary(order)}\n\nاختر أي جزء لتعديله أو حذفه أو إضافة بيانات جديدة:`,
    editRootKeyboard(),
  );
}

async function showEditChildren(bot, msg, state) {
  const order = await getOrderByCode(state.editOrderCode);
  const rows = order.children.map((child, index) => [
    { text: `طفل ${index + 1}: ${short(child.child_name)}` },
  ]);
  rows.push([{ text: "إضافة طفل جديد" }], [{ text: "العودة لبيانات الأوردر" }]);
  await bot.sendMessage(
    msg.chat.id,
    "اختر الطفل المطلوب تعديله أو حذفه:",
    keyboard(rows, "اختر الطفل"),
  );
}

async function showEditLines(bot, msg, state) {
  const order = await getOrderByCode(state.editOrderCode);
  const rows = order.lines.map((line, index) => [
    {
      text: `${line.line_type === "package" ? "باكدج" : "صنف"} ${index + 1}: ${short(line.description, 36)} × ${line.quantity}`,
    },
  ]);
  rows.push(
    [{ text: "إضافة منتج جديد" }],
    [{ text: "العودة لبيانات الأوردر" }],
  );
  await bot.sendMessage(
    msg.chat.id,
    "اختر المنتج أو الباكدج المطلوب تعديله أو حذفه:",
    keyboard(rows, "اختر المنتج"),
  );
}

async function editOrderAndCheck(state) {
  const order = await getOrderByCode(state.editOrderCode);
  if (!order || order.status !== "confirmed") return null;
  return order;
}

async function cancelOrder(bot, msg) {
  await clearConversationState(msg.from.id);
  await bot.sendMessage(msg.chat.id, "تم إلغاء العملية.", orderMenuKeyboard());
}

async function handleOrderMessage(bot, msg, text, role) {
  if (role === "none") return false;
  const telegramId = msg.from.id;
  try {
  if (/^الطلبات$/i.test(text)) {
    await clearConversationState(telegramId);
    await bot.sendMessage(msg.chat.id, "إدارة الطلبات:", orderMenuKeyboard());
    return true;
  }
  if (/^طلب جديد$/i.test(text)) {
    const state = {
      step: "order_customer_choice",
      draft: initialDraft(),
      customerContext: "new_order",
      history: [],
    };
    await setConversationState(telegramId, state);
    await promptForState(bot, msg, state);
    return true;
  }
  if (/^بحث عن عميل$/i.test(text)) {
    const state = {
      step: "customer_search",
      customerContext: "lookup",
      history: [],
    };
    await setConversationState(telegramId, state);
    await promptForState(bot, msg, state);
    return true;
  }
  if (/^تعديل طلب$/i.test(text)) {
    const state = { step: "edit_order_code", history: [] };
    await setConversationState(telegramId, state);
    await promptForState(bot, msg, state);
    return true;
  }
  if (/^بحث عن أوردر$/i.test(text)) {
    const state = { step: "view_order_code", history: [] };
    await setConversationState(telegramId, state);
    await promptForState(bot, msg, state);
    return true;
  }
  if (/^إلغاء أوردر محفوظ$/i.test(text) && role === "super_admin") {
    const state = { step: "admin_cancel_order_code", history: [] };
    await setConversationState(telegramId, state);
    await promptForState(bot, msg, state);
    return true;
  }
  if (/^حذف كل الأوردرات$/i.test(text) && role === "super_admin") {
    const state = { step: "admin_delete_all_confirm", history: [] };
    await setConversationState(telegramId, state);
    await bot.sendMessage(
      msg.chat.id,
      "⚠️ سيتم حذف كل الأوردرات نهائياً، بما فيها الملغية.\nلن تتأثر الأصناف أو الباكدجات أو المستخدمون.\n\nللتأكيد اكتب بالضبط: حذف الكل",
      keyboard([[{ text: "إلغاء" }]], "اكتب حذف الكل"),
    );
    return true;
  }

  let state = await getConversationState(telegramId);
  if (!state || !ORDER_STEPS.has(state.step)) return false;
  if (
    [
      "view_order_code",
      "view_order_results",
      "admin_cancel_order_code",
      "edit_order_code",
      "order_customer_choice",
      "customer_search",
      "customer_results",
      "customer_preview",
    ].includes(state.step) &&
    /^إلغاء$/i.test(text)
  ) {
    await clearConversationState(telegramId);
    await bot.sendMessage(msg.chat.id, "تم الإلغاء.", orderMenuKeyboard());
    return true;
  }
  if (state.step === "admin_delete_all_confirm") {
    if (text === "إلغاء") {
      await clearConversationState(telegramId);
      await bot.sendMessage(msg.chat.id, "تم الإلغاء.", orderMenuKeyboard());
      return true;
    }
    if (text !== "حذف الكل") {
      await bot.sendMessage(
        msg.chat.id,
        "لم يتم حذف أي أوردر. اكتب «حذف الكل» حرفياً للتأكيد، أو اضغط إلغاء.",
        keyboard([[{ text: "إلغاء" }]], "اكتب حذف الكل"),
      );
      return true;
    }
    const deleted = await deleteAllOrders();
    await clearConversationState(telegramId);
    await bot.sendMessage(
      msg.chat.id,
      `تم حذف ${deleted} أوردر نهائياً.`,
      orderMenuKeyboard(),
    );
    return true;
  }
  if (
    ![
      "admin_cancel_order_confirm",
      "admin_delete_all_confirm",
      "order_cancel_confirm",
      "edit_cancel_confirm",
    ].includes(state.step) &&
    /^(إلغاء الطلب|إلغاء)$/i.test(text)
  ) {
    state = await moveForward(telegramId, state, {
      step: "order_cancel_confirm",
    });
    await promptForState(bot, msg, state);
    return true;
  }
  if (/^رجوع خطوة$/i.test(text)) {
    const previous = await goBack(telegramId, state);
    if (!previous) {
      // Nothing left to restore (for example an old session stored before this fix).
      await clearConversationState(telegramId);
      await bot.sendMessage(
        msg.chat.id,
        "لا توجد خطوات سابقة محفوظة. ابدأ من القائمة:",
        orderMenuKeyboard(),
      );
      return true;
    }
    await promptForState(bot, msg, previous);
    return true;
  }

  if (state.step === "view_order_code") {
    const query = normalizeName(text);
    if (!query) {
      await promptForState(bot, msg, state);
      return true;
    }
    const result = await searchOrders(query, 0, PAGE_SIZE);
    if (!result.total) {
      await bot.sendMessage(
        msg.chat.id,
        "لا توجد أوردرات مطابقة. حاول برقم الأوردر أو رقم الموبايل أو اسم الطفل.",
        keyboard([[{ text: "إلغاء" }]], "ابحث عن أوردر"),
      );
      return true;
    }
    if (result.total === 1) {
      const order = await getOrderByCode(result.entries[0].order_code);
      await clearConversationState(telegramId);
      await bot.sendMessage(
        msg.chat.id,
        savedOrderSummary(order),
        orderMenuKeyboard(),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "view_order_results",
      query,
      page: 0,
    });
    await showOrderSearchResults(bot, msg, state);
    return true;
  } else if (state.step === "view_order_results") {
    if (text === "بحث جديد 🔎") {
      state = await moveForward(telegramId, state, {
        step: "view_order_code",
        query: null,
        page: 0,
      });
      await promptForState(bot, msg, state);
      return true;
    }
    if (["التالي ▶️", "السابق ◀️"].includes(text)) {
      state.page = Math.max(
        0,
        (state.page || 0) + (text === "التالي ▶️" ? 1 : -1),
      );
      await setConversationState(telegramId, state);
      await showOrderSearchResults(bot, msg, state);
      return true;
    }
    const orderCode = String(text).split(" — ")[0];
    const order = await getOrderByCode(orderCode);
    if (!order) {
      await showOrderSearchResults(bot, msg, state);
      return true;
    }
    await clearConversationState(telegramId);
    await bot.sendMessage(
      msg.chat.id,
      savedOrderSummary(order),
      orderMenuKeyboard(),
    );
    return true;
  } else if (state.step === "admin_cancel_order_code") {
    const order = await getOrderByCode(text);
    if (!order) {
      await bot.sendMessage(
        msg.chat.id,
        "لم يتم العثور على أوردر بهذا الرقم. حاول مرة أخرى أو اكتب إلغاء.",
        keyboard([[{ text: "إلغاء" }]], "رقم الأوردر"),
      );
      return true;
    }
    if (order.status === "cancelled") {
      await bot.sendMessage(
        msg.chat.id,
        `${savedOrderSummary(order)}\n\nهذا الأوردر ملغي بالفعل.`,
        orderMenuKeyboard(),
      );
      await clearConversationState(telegramId);
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "admin_cancel_order_confirm",
      cancelOrderCode: order.order_code,
      cancelOrderPreview: order,
    });
    await bot.sendMessage(
      msg.chat.id,
      `${savedOrderSummary(order)}\n\nلإلغاء هذا الأوردر اكتب كلمة «الغاء» حرفياً. أو اضغط رجوع خطوة.`,
      cancelConfirmationKeyboard(),
    );
    return true;
  } else if (state.step === "admin_cancel_order_confirm") {
    if (!/^(الغاء|إلغاء)$/i.test(text)) {
      await bot.sendMessage(
        msg.chat.id,
        "لم يتم إلغاء الأوردر. اكتب «الغاء» حرفياً للتأكيد، أو اضغط رجوع خطوة.",
        cancelConfirmationKeyboard(),
      );
      return true;
    }
    await cancelSavedOrder(state.cancelOrderCode, telegramId);
    const cancelledOrder = { ...state.cancelOrderPreview, status: "cancelled" };
    await clearConversationState(telegramId);
    await bot.sendMessage(
      msg.chat.id,
      `${savedOrderSummary(cancelledOrder)}\n\nتم إلغاء الأوردر مع الاحتفاظ به في السجل.`,
      orderMenuKeyboard(),
    );
    return true;
  } else if (state.step === "order_customer_choice") {
    if (text === "إدخال عميل جديد") {
      state = await moveForward(telegramId, state, {
        step: "order_source",
        customerContext: null,
      });
    } else if (text === "بحث عن عميل موجود") {
      state = await moveForward(telegramId, state, { step: "customer_search" });
    } else {
      await promptForState(bot, msg, state);
      return true;
    }
  } else if (state.step === "customer_search") {
    const result = await searchCustomerProfiles(text, 0, PAGE_SIZE);
    if (!result.configured) {
      await bot.sendMessage(
        msg.chat.id,
        "بحث العملاء غير مُعدّ بعد. أضف CUSTOMER_DATABASE_URL في Vercel أولاً.",
        orderMenuKeyboard(),
      );
      await clearConversationState(telegramId);
      return true;
    }
    if (!result.total) {
      await bot.sendMessage(
        msg.chat.id,
        "لا يوجد عميل مطابق. جرّب رقم موبايل أو جزءاً من الاسم.",
        textKeyboard("رقم الموبايل أو الاسم"),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "customer_results",
      customerResults: result.entries,
    });
    await bot.sendMessage(
      msg.chat.id,
      "اختر العميل:",
      customerResultsKeyboard(result.entries),
    );
    return true;
  } else if (state.step === "customer_results") {
    if (text === "بحث جديد 🔎") {
      state = await moveForward(telegramId, state, {
        step: "customer_search",
        customerResults: null,
      });
      await promptForState(bot, msg, state);
      return true;
    }
    const profile = (state.customerResults || []).find(
      (entry) =>
        text ===
        `${entry.customer_name || "بدون اسم"} — ${(entry.primary_phone || entry.phones?.[0] || "").slice(0, 20)}`,
    );
    if (!profile) {
      await bot.sendMessage(
        msg.chat.id,
        "اختر عميلاً من القائمة أو ابدأ بحثاً جديداً.",
        customerResultsKeyboard(state.customerResults || []),
      );
      return true;
    }
    if (state.customerContext !== "new_order") {
      await bot.sendMessage(
        msg.chat.id,
        customerProfileText(profile),
        orderMenuKeyboard(),
      );
      await clearConversationState(telegramId);
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "customer_preview",
      selectedCustomer: profile,
    });
    const actions =
      state.customerContext === "new_order"
        ? keyboard(
            [
              [{ text: "استخدام بيانات العميل" }],
              [{ text: "إدخال عميل جديد" }],
              [{ text: "إلغاء" }],
            ],
            "اختر الإجراء",
          )
        : orderMenuKeyboard();
    await bot.sendMessage(msg.chat.id, customerProfileText(profile), actions);
    return true;
  } else if (state.step === "customer_preview") {
    if (state.customerContext !== "new_order") {
      await clearConversationState(telegramId);
      return true;
    }
    if (text === "إدخال عميل جديد") {
      state = await moveForward(telegramId, state, {
        step: "order_source",
        customerContext: null,
        selectedCustomer: null,
      });
    } else if (text === "استخدام بيانات العميل") {
      const draft = {
        ...state.draft,
        ...profileToDraft(state.selectedCustomer),
      };
      state = await moveForward(telegramId, state, {
        step: "order_source",
        customerContext: null,
        selectedCustomer: null,
        draft,
      });
    } else {
      await bot.sendMessage(
        msg.chat.id,
        "اختر استخدام البيانات أو إدخال عميل جديد.",
      );
      return true;
    }
  } else if (state.step === "order_source") {
    if (!/^(Facebook|Instagram|WhatsApp|أخرى)$/i.test(text)) {
      await promptForState(bot, msg, state);
      return true;
    }
    const nextStep =
      state.draft.parentName && state.draft.parentPhone
        ? "order_delivery_list"
        : "order_parent_name";
    const baseDraft = text === "أخرى" ? state.draft : { ...state.draft, source: text };
    if (text === "أخرى") {
      state = await moveForward(telegramId, state, { step: "order_other_source" });
    } else if (nextStep === "order_delivery_list") {
      state = await moveForward(telegramId, state, {
        step: "order_delivery_list",
        listType: "delivery",
        query: "",
        page: 0,
        draft: baseDraft,
      });
    } else {
      state = await moveForward(telegramId, state, { step: nextStep, draft: baseDraft });
    }
  } else if (state.step === "order_other_source") {
    const source = normalizeName(text);
    if (!source) return true;
    const nextStep =
      state.draft.parentName && state.draft.parentPhone
        ? "order_delivery_list"
        : "order_parent_name";
    if (nextStep === "order_delivery_list") {
      state = await moveForward(telegramId, state, {
        step: "order_delivery_list",
        listType: "delivery",
        query: "",
        page: 0,
        draft: { ...state.draft, source },
      });
    } else {
      state = await moveForward(telegramId, state, {
        step: nextStep,
        draft: { ...state.draft, source },
      });
    }
  } else if (state.step === "order_child_name") {
    const childName = normalizeName(text);
    if (childName.split(" ").filter(Boolean).length < 2) {
      await bot.sendMessage(
        msg.chat.id,
        "اسم الطفل يجب أن يتكون من كلمتين على الأقل.",
        textKeyboard("اسم الطفل"),
      );
      return true;
    }
    const children = [
      ...state.draft.children,
      { childName, cartoonCharacter: null, schoolName: null, schoolStage: null, labelColor: null },
    ];
    const draft = {
      ...state.draft,
      children,
      currentChildIndex: children.length - 1,
    };
    state = await moveForward(telegramId, state, {
      step:
        draft.parentName && draft.parentPhone
          ? "order_cartoon"
          : "order_parent_name",
      draft,
    });
  } else if (state.step === "order_parent_name") {
    const parentName = normalizeName(text);
    if (parentName.split(" ").filter(Boolean).length < 2) {
      await bot.sendMessage(
        msg.chat.id,
        "اسم ولي الأمر يجب أن يتكون من كلمتين على الأقل.",
        textKeyboard("اسم ولي الأمر"),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "order_parent_phone",
      draft: { ...state.draft, parentName },
    });
  } else if (state.step === "order_parent_phone") {
    const parentPhone = normalizePhone(text);
    if (!parentPhone) {
      await bot.sendMessage(
        msg.chat.id,
        "رقم الموبايل غير صحيح. أرسله مرة أخرى.",
        textKeyboard("رقم الموبايل"),
      );
      return true;
    }
    const draft = { ...state.draft, parentPhone };
    state = await moveForward(telegramId, state, {
      step: "order_parent_phone_2",
      draft,
    });
  } else if (state.step === "order_duplicate_warning") {
    if (text === "متابعة الأوردر الجديد") {
      if (state.pendingNextStep === "order_finish") {
        await finishNewOrder(
          bot,
          msg,
          { ...state.draft, skipDuplicateCheck: true },
          telegramId,
        );
        return true;
      }
      state = await moveForward(telegramId, state, {
        step: state.pendingNextStep,
        duplicateOrders: null,
        pendingNextStep: null,
      });
    } else if (text === "الرجوع وتعديل البيانات") {
      state = await moveForward(telegramId, state, {
        step: "order_parent_phone",
        duplicateOrders: null,
        pendingNextStep: null,
      });
    } else {
      return true;
    }
  } else if (state.step === "order_parent_phone_2") {
    if (text === "تخطي")
      state = await moveForward(telegramId, state, {
        step: "order_delivery_list",
        listType: "delivery",
        query: "",
        page: 0,
      });
    else {
      const parentPhone2 = normalizePhone(text);
      if (!parentPhone2) {
        await bot.sendMessage(
          msg.chat.id,
          "رقم الموبايل غير صحيح. أرسله مرة أخرى أو اضغط تخطي.",
          optionalTextKeyboard("رقم الموبايل الثاني"),
        );
        return true;
      }
      state = await moveForward(telegramId, state, {
        step: "order_parent_phone_3",
        draft: { ...state.draft, parentPhone2 },
      });
    }
  } else if (state.step === "order_parent_phone_3") {
    if (text === "تخطي")
      state = await moveForward(telegramId, state, {
        step: "order_delivery_list",
        listType: "delivery",
        query: "",
        page: 0,
      });
    else {
      const parentPhone3 = normalizePhone(text);
      if (!parentPhone3) {
        await bot.sendMessage(
          msg.chat.id,
          "رقم الموبايل غير صحيح. أرسله مرة أخرى أو اضغط تخطي.",
          optionalTextKeyboard("رقم الموبايل الثالث"),
        );
        return true;
      }
      state = await moveForward(telegramId, state, {
        step: "order_delivery_list",
        listType: "delivery",
        query: "",
        page: 0,
        draft: { ...state.draft, parentPhone3 },
      });
    }
  } else if (state.step === "order_cartoon") {
    const value = normalizeName(text);
    const children = clone(state.draft.children);
    if (!children[state.draft.currentChildIndex]) {
      children[state.draft.currentChildIndex] = { childName: "غير محدد", cartoonCharacter: null, schoolName: null, schoolStage: null, labelColor: null };
    }
    children[state.draft.currentChildIndex].cartoonCharacter =
      text === "تخطي" || !value ? "غير محدد" : value;
    state = await moveForward(telegramId, state, {
      step: "order_school",
      draft: { ...state.draft, children },
    });
  } else if (state.step === "order_school") {
    const value = normalizeName(text);
    const children = clone(state.draft.children);
    if (!children[state.draft.currentChildIndex]) {
      children[state.draft.currentChildIndex] = { childName: "غير محدد", cartoonCharacter: null, schoolName: null, schoolStage: null, labelColor: null };
    }
    children[state.draft.currentChildIndex].schoolName =
      text === "تخطي" || !value ? "غير محدد" : value;
    state = await moveForward(telegramId, state, {
      step: "order_stage",
      draft: { ...state.draft, children },
    });
  } else if (state.step === "order_stage") {
    const value = normalizeName(text);
    const children = clone(state.draft.children);
    if (!children[state.draft.currentChildIndex]) {
      children[state.draft.currentChildIndex] = { childName: "غير محدد", cartoonCharacter: null, schoolName: null, schoolStage: null, labelColor: null };
    }
    children[state.draft.currentChildIndex].schoolStage =
      text === "تخطي" || !value ? "غير محدد" : value;
    state = await moveForward(telegramId, state, {
      step: "order_type",
      draft: { ...state.draft, children },
    });
  } else if (state.step === "order_type") {
    const listType =
      text === "باكدج" ? "package" : text === "صنف عادي" ? "item" : null;
    if (!listType) {
      await promptForState(bot, msg, state);
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "order_list",
      listType,
      query: "",
      page: 0,
    });
  } else if (
    state.step === "order_list" ||
    state.step === "order_delivery_list"
  ) {
    if (text === "بحث 🔎") {
      state = await moveForward(telegramId, state, {
        step:
          state.listType === "delivery"
            ? "order_delivery_search"
            : "order_search",
      });
      await bot.sendMessage(
        msg.chat.id,
        "اكتب جزءاً من الاسم للبحث:",
        textKeyboard("كلمة البحث"),
      );
      return true;
    }
    if (text === "التالي ▶️" || text === "السابق ◀️") {
      state.page = Math.max(
        0,
        (state.page || 0) + (text === "التالي ▶️" ? 1 : -1),
      );
      await setConversationState(telegramId, state);
      await showList(bot, msg, state);
      return true;
    }
    const { entries } = await listEntries(
      state.listType,
      state.query || "",
      state.page || 0,
    );
    const selected = entries.find((entry) => short(entry.label, 60) === text);
    if (!selected) {
      await showList(bot, msg, state);
      return true;
    }
    if (state.listType === "package") {
      const row = selected.value;
      const labelCount = row.requires_label_color ? (packageLabelCount(row) || 1) : 1;
      const line = {
        type: "package",
        referenceId: row.id || null,
        description: row.package_name,
        quantity: 1,
        labelCount,
        unitPrice: Number(row.total_price),
        lineTotal: Number(row.total_price),
        childIndex: state.draft.currentChildIndex,
        details: {},
      };
      state = await moveForward(telegramId, state, {
        step: row.requires_label_color ? "order_line_label_color" : "order_post_add",
        pendingLine: row.requires_label_color ? line : null,
        draft: row.requires_label_color ? state.draft : { ...state.draft, lines: [...state.draft.lines, line] },
        listType: null,
        query: "",
        page: 0,
      });
    } else if (state.listType === "item") {
      const row = selected.value;
      state = await moveForward(telegramId, state, {
        step: "order_quantity",
        pendingItem: {
          referenceId: row.id || null,
          itemName: row.item_name,
          price: Number(row.price),
          minQuantity: row.min_quantity,
          maxQuantity: row.max_quantity,
          requiresLabelColor: row.requires_label_color,
        },
      });
    } else {
      const delivery = {
        areaName: selected.value.area_name,
        price: Number(selected.value.price),
      };
      state = await moveForward(telegramId, state, {
        step: "order_address",
        draft: { ...state.draft, delivery },
      });
    }
  } else if (
    state.step === "order_search" ||
    state.step === "order_delivery_search"
  ) {
    state = await moveForward(telegramId, state, {
      step:
        state.step === "order_delivery_search"
          ? "order_delivery_list"
          : "order_list",
      query: normalizeName(text),
      page: 0,
    });
  } else if (state.step === "order_address") {
    if (text === "إدخال عنوان جديد") {
      state = await moveForward(telegramId, state, {
        step: "order_address",
        addressMode: "manual",
      });
      await promptForState(bot, msg, state);
      return true;
    }
    const selectedAddress = text.match(/^العنوان (\d+)$/);
    const address = selectedAddress
      ? state.draft.savedAddresses?.[Number(selectedAddress[1]) - 1]
      : normalizeName(text);
    if (!address) {
      await bot.sendMessage(
        msg.chat.id,
        "العنوان مطلوب. اكتب عنوان التوصيل بالتفصيل.",
        textKeyboard("العنوان"),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "order_child_name",
      addressMode: null,
      draft: { ...state.draft, address },
    });
  } else if (state.step === "order_notes") {
    const notes =
      text === "تخطي" || text === "استخدام الملاحظات المحفوظة"
        ? state.draft.notes
        : normalizeName(text);
    state = await moveForward(telegramId, state, {
      step: "order_advance_choice",
      draft: { ...state.draft, notes },
    });
  } else if (state.step === "order_advance_choice") {
    if (text === "لا، لم يدفع") {
      await finishNewOrder(
        bot,
        msg,
        { ...state.draft, advancePayment: 0, advancePaymentDetails: null },
        telegramId,
      );
      return true;
    }
    if (text === "نعم، تم الدفع") {
      state = await moveForward(telegramId, state, {
        step: "order_advance_amount",
      });
    } else {
      await promptForState(bot, msg, state);
      return true;
    }
  } else if (state.step === "order_advance_amount") {
    const amount = parseAmount(text);
    const grandTotal = draftGrandTotal(state.draft);
    if (!Number.isFinite(amount) || amount <= 0 || amount > grandTotal) {
      await bot.sendMessage(
        msg.chat.id,
        `اكتب مبلغاً صحيحاً أكبر من 0 ولا يزيد عن ${money(grandTotal)}ج.`,
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "order_advance_details",
      draft: { ...state.draft, advancePayment: amount },
    });
  } else if (state.step === "order_advance_details") {
    const details = normalizeName(text);
    if (!details || text === "تخطي") {
      await bot.sendMessage(
        msg.chat.id,
        "تفاصيل الدفع مطلوبة. اكتب طريقة أو تفاصيل الدفع.",
      );
      return true;
    }
    await finishNewOrder(
      bot,
      msg,
      { ...state.draft, advancePaymentDetails: details },
      telegramId,
    );
    return true;
  } else if (state.step === "order_quantity") {
    const quantity = Number(
      String(text).replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    );
    const min = state.pendingItem.minQuantity;
    const max = state.pendingItem.maxQuantity;
    if (
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      (min !== null && quantity < Number(min)) ||
      (max !== null && quantity > Number(max))
    ) {
      await bot.sendMessage(
        msg.chat.id,
        "الكمية خارج الحدود المسموحة. حاول مرة أخرى.",
        textKeyboard("الكمية"),
      );
      return true;
    }
    const item = state.pendingItem;
    const line = {
      type: "item",
      referenceId: item.referenceId,
      description: item.itemName,
      quantity,
      labelCount: quantity,
      unitPrice: item.price,
      lineTotal: Math.round(item.price * quantity * 100) / 100,
      childIndex: state.draft.currentChildIndex,
      details: {},
    };
    state = await moveForward(telegramId, state, {
      step: item.requiresLabelColor ? "order_line_label_color" : "order_post_add",
      pendingItem: null,
      pendingLine: item.requiresLabelColor ? line : null,
      draft: item.requiresLabelColor ? state.draft : { ...state.draft, lines: [...state.draft.lines, line] },
    });
  } else if (state.step === "order_line_label_color") {
    const labelCount = state.pendingLine.labelCount ?? state.pendingLine.quantity;
    if (text === "أبيض" || text === "أسود") {
      const line = { ...state.pendingLine, details: { labelColor: text, [text === "أبيض" ? "whiteCount" : "blackCount"]: labelCount } };
      state = await moveForward(telegramId, state, { step: "order_post_add", pendingLine: null, draft: { ...state.draft, lines: [...state.draft.lines, line] } });
    } else if (text === "الاثنين") state = await moveForward(telegramId, state, { step: "order_line_label_white_count" });
    else if (text === "لون آخر") state = await moveForward(telegramId, state, { step: "order_line_custom_label" });
    else { await promptForState(bot, msg, state); return true; }
  } else if (state.step === "order_line_custom_label") {
    const value = normalizeName(text);
    if (!value) return true;
    const line = { ...state.pendingLine, details: { labelColor: value } };
    state = await moveForward(telegramId, state, { step: "order_post_add", pendingLine: null, draft: { ...state.draft, lines: [...state.draft.lines, line] } });
  } else if (state.step === "order_line_label_white_count") {
    const labelCount = state.pendingLine.labelCount ?? state.pendingLine.quantity;
    const white = Number(String(text).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    if (!Number.isSafeInteger(white) || white < 0 || white > labelCount) { await bot.sendMessage(msg.chat.id, "اكتب عدداً صحيحاً لا يزيد عن الكمية المطلوبة."); return true; }
    state = await moveForward(telegramId, state, { step: "order_line_label_black_count", labelWhiteCount: white });
  } else if (state.step === "order_line_label_black_count") {
    const labelCount = state.pendingLine.labelCount ?? state.pendingLine.quantity;
    const black = Number(String(text).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const white = Number(state.labelWhiteCount || 0);
    if (!Number.isSafeInteger(black) || black < 0 || white + black > labelCount) { await bot.sendMessage(msg.chat.id, "مجموع الأبيض والأسود لا يمكن أن يزيد عن الكمية المطلوبة."); return true; }
    const line = { ...state.pendingLine, details: { labelColor: "الاثنين", whiteCount: white, blackCount: black } };
    state = await moveForward(telegramId, state, { step: "order_post_add", pendingLine: null, labelWhiteCount: null, draft: { ...state.draft, lines: [...state.draft.lines, line] } });
  } else if (state.step === "order_post_add") {
    if (text === "التالي ➕")
      state = await moveForward(telegramId, state, { step: "order_type" });
    else if (text === "إضافة طفل آخر" && state.draft.children.length < 6)
      state = await moveForward(telegramId, state, {
        step: "order_child_name",
      });
    else if (text === "إنهاء الطلب")
      state = await moveForward(telegramId, state, {
        step: "order_discount_type",
      });
    else {
      await promptForState(bot, msg, state);
      return true;
    }
  } else if (state.step === "order_discount_type") {
    if (text === "بدون خصم")
      state = await moveForward(telegramId, state, {
        step: "order_notes",
        draft: { ...state.draft, discount: { type: null, value: 0 } },
      });
    else if (text === "خصم نسبة مئوية")
      state = await moveForward(telegramId, state, {
        step: "order_discount_value",
        discountType: "percent",
      });
    else if (text === "خصم مبلغ ثابت")
      state = await moveForward(telegramId, state, {
        step: "order_discount_value",
        discountType: "fixed",
      });
    else {
      await promptForState(bot, msg, state);
      return true;
    }
  } else if (state.step === "order_discount_value") {
    const raw = String(text).replace(/[٪%]/g, "").trim();
    const value = Number(
      raw.replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    );
    const itemsTotal = itemsTotalFor(state.draft);
    const max = state.discountType === "percent" ? 100 : itemsTotal;
    if (!Number.isFinite(value) || value <= 0 || value > max) {
      await bot.sendMessage(
        msg.chat.id,
        state.discountType === "percent"
          ? "اكتب نسبة صحيحة أكبر من 0 ولا تزيد عن 100."
          : `اكتب مبلغ خصم صحيحاً أكبر من 0 ولا يزيد عن ${money(itemsTotal)}ج.`,
        textKeyboard("قيمة الخصم"),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "order_notes",
      discountType: null,
      draft: { ...state.draft, discount: { type: state.discountType, value } },
    });
  } else if (state.step === "order_cancel_confirm") {
    if (!/^(الغاء|إلغاء)$/i.test(text)) {
      await promptForState(bot, msg, state);
      return true;
    }
    await cancelOrder(bot, msg);
    return true;
  } else if (state.step === "edit_order_code") {
    const order = await getOrderByCode(text);
    if (
      !order ||
      order.status !== "confirmed" ||
      (role === "sales" && String(order.created_by) !== String(telegramId))
    ) {
      await bot.sendMessage(
        msg.chat.id,
        "لم يتم العثور على أوردر مسموح لك بتعديله بهذا الرقم.",
        keyboard([[{ text: "إلغاء" }]], "رقم الأوردر"),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      editOrderCode: order.order_code,
    });
    await showEditRoot(bot, msg, state);
    return true;
  } else if (state.step === "edit_order_menu") {
    const fields = {
      "تعديل المصدر": "source",
      "تعديل اسم ولي الأمر": "parentName",
      "تعديل رقم الموبايل": "parentPhone",
    };
    if (fields[text]) {
      state = await moveForward(telegramId, state, {
        step: "edit_order_value",
        editField: fields[text],
      });
      await bot.sendMessage(
        msg.chat.id,
        "اكتب القيمة الجديدة:",
        keyboard(
          [[{ text: "رجوع خطوة" }, { text: "إلغاء" }]],
          "القيمة الجديدة",
        ),
      );
      return true;
    }
    if (text === "تعديل الشحن") {
      state = await moveForward(telegramId, state, {
        step: "edit_delivery_list",
        listType: "delivery",
        query: "",
        page: 0,
      });
      await showList(bot, msg, state);
      return true;
    }
    if (text === "تعديل الدفعة المقدمة") {
      state = await moveForward(telegramId, state, {
        step: "edit_advance_choice",
      });
      await bot.sendMessage(
        msg.chat.id,
        "اختر تعديل الدفعة المقدمة:",
        keyboard(
          [
            [{ text: "إضافة أو تعديل دفعة" }],
            [{ text: "إزالة الدفعة المقدمة" }],
            [{ text: "العودة لبيانات الأوردر" }],
          ],
          "الدفعة المقدمة",
        ),
      );
      return true;
    }
    if (text === "الأطفال داخل الأوردر") {
      state = await moveForward(telegramId, state, {
        step: "edit_children_list",
      });
      await showEditChildren(bot, msg, state);
      return true;
    }
    if (text === "المنتجات والباكدجات") {
      state = await moveForward(telegramId, state, { step: "edit_lines_list" });
      await showEditLines(bot, msg, state);
      return true;
    }
    if (text === "إضافة طفل جديد") {
      const order = await editOrderAndCheck(state);
      if (order.children.length >= 6) {
        await bot.sendMessage(
          msg.chat.id,
          "الحد الأقصى هو 6 أطفال.",
          editRootKeyboard(),
        );
        return true;
      }
      state = await moveForward(telegramId, state, {
        step: "edit_add_child_name",
        editNewChild: {},
      });
      await promptForState(bot, msg, state);
      return true;
    }
    if (text === "إضافة منتج جديد") {
      const order = await editOrderAndCheck(state);
      state = await moveForward(
        telegramId,
        state,
        order.children.length === 1
          ? { step: "edit_add_type", editChildId: order.children[0].id }
          : { step: "edit_add_select_child" },
      );
      if (state.step === "edit_add_select_child") {
        const rows = order.children.map((child, i) => [
          { text: `إضافة للطفل ${i + 1}: ${short(child.child_name, 38)}` },
        ]);
        rows.push([{ text: "العودة لبيانات الأوردر" }]);
        await bot.sendMessage(
          msg.chat.id,
          "اختر الطفل الذي سيُضاف له المنتج:",
          keyboard(rows, "اختر الطفل"),
        );
      } else await promptForState(bot, msg, state);
      return true;
    }
    if (text === "إلغاء الأوردر بالكامل") {
      state = await moveForward(telegramId, state, {
        step: "edit_cancel_confirm",
      });
      await bot.sendMessage(
        msg.chat.id,
        "سيتم وضع الأوردر في حالة «ملغي» مع الاحتفاظ بسجله.\nللتأكيد اكتب كلمة «الغاء» حرفياً.",
        cancelConfirmationKeyboard(),
      );
      return true;
    }
    if (text === "إنهاء التعديل") {
      await clearConversationState(telegramId);
      await bot.sendMessage(
        msg.chat.id,
        "تم إنهاء التعديل ✅",
        orderMenuKeyboard(),
      );
      return true;
    }
    await showEditRoot(bot, msg, state);
    return true;
  } else if (state.step === "edit_order_value") {
    let value = normalizeName(text);
    if (state.editField === "parentPhone") value = normalizePhone(text);
    if (!value) {
      await bot.sendMessage(msg.chat.id, "القيمة غير صحيحة. حاول مرة أخرى.");
      return true;
    }
    await updateOrderField(
      state.editOrderCode,
      state.editField,
      value,
      telegramId,
    );
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      editField: null,
    });
    await showEditRoot(bot, msg, state, "تم حفظ التعديل ✅");
    return true;
  } else if (state.step === "edit_advance_choice") {
    if (text === "العودة لبيانات الأوردر") {
      state = await moveForward(telegramId, state, { step: "edit_order_menu" });
      await showEditRoot(bot, msg, state);
      return true;
    }
    if (text === "إزالة الدفعة المقدمة") {
      await updateOrderAdvancePayment(state.editOrderCode, 0, null, telegramId);
      state = await moveForward(telegramId, state, { step: "edit_order_menu" });
      await showEditRoot(bot, msg, state, "تمت إزالة الدفعة المقدمة ✅");
      return true;
    }
    if (text === "إضافة أو تعديل دفعة") {
      state = await moveForward(telegramId, state, {
        step: "edit_advance_amount",
      });
      await promptForState(bot, msg, state);
      return true;
    }
    await promptForState(bot, msg, state);
    return true;
  } else if (state.step === "edit_advance_amount") {
    const amount = parseAmount(text);
    const order = await editOrderAndCheck(state);
    if (!order) return true;
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > Number(order.grand_total)
    ) {
      await bot.sendMessage(
        msg.chat.id,
        `اكتب مبلغاً صحيحاً أكبر من 0 ولا يزيد عن ${money(order.grand_total)}ج.`,
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_advance_details",
      editAdvancePayment: amount,
    });
    await promptForState(bot, msg, state);
    return true;
  } else if (state.step === "edit_advance_details") {
    const details = normalizeName(text);
    if (!details || text === "تخطي") {
      await bot.sendMessage(
        msg.chat.id,
        "تفاصيل الدفع مطلوبة. اكتب طريقة أو تفاصيل الدفع.",
      );
      return true;
    }
    await updateOrderAdvancePayment(
      state.editOrderCode,
      state.editAdvancePayment,
      details,
      telegramId,
    );
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      editAdvancePayment: null,
    });
    await showEditRoot(bot, msg, state, "تم حفظ الدفعة المقدمة ✅");
    return true;
  } else if (state.step === "edit_delivery_list") {
    if (text === "بحث 🔎") {
      state = await moveForward(telegramId, state, {
        step: "edit_delivery_search",
      });
      await bot.sendMessage(
        msg.chat.id,
        "اكتب جزءاً من اسم المنطقة:",
        textKeyboard("بحث المنطقة"),
      );
      return true;
    }
    if (["التالي ▶️", "السابق ◀️"].includes(text)) {
      state.page = Math.max(
        0,
        (state.page || 0) + (text === "التالي ▶️" ? 1 : -1),
      );
      await setConversationState(telegramId, state);
      await showList(bot, msg, state);
      return true;
    }
    const { entries } = await listEntries(
      "delivery",
      state.query || "",
      state.page || 0,
    );
    const selected = entries.find((entry) => short(entry.label, 60) === text);
    if (!selected) {
      await showList(bot, msg, state);
      return true;
    }
    await updateOrderDelivery(
      state.editOrderCode,
      {
        areaName: selected.value.area_name,
        price: Number(selected.value.price),
      },
      telegramId,
    );
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      listType: null,
      query: "",
      page: 0,
    });
    await showEditRoot(
      bot,
      msg,
      state,
      "تم تعديل الشحن وإعادة حساب الإجمالي ✅",
    );
    return true;
  } else if (state.step === "edit_delivery_search") {
    state = await moveForward(telegramId, state, {
      step: "edit_delivery_list",
      query: normalizeName(text),
      page: 0,
    });
    await showList(bot, msg, state);
    return true;
  } else if (state.step === "edit_children_list") {
    if (text === "العودة لبيانات الأوردر") {
      state = await moveForward(telegramId, state, { step: "edit_order_menu" });
      await showEditRoot(bot, msg, state);
      return true;
    }
    if (text === "إضافة طفل جديد") {
      state = await moveForward(telegramId, state, {
        step: "edit_add_child_name",
        editNewChild: {},
      });
      await promptForState(bot, msg, state);
      return true;
    }
    const order = await editOrderAndCheck(state);
    const index = order.children.findIndex(
      (child, i) => text === `طفل ${i + 1}: ${short(child.child_name)}`,
    );
    if (index < 0) {
      await showEditChildren(bot, msg, state);
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_child_menu",
      editChildId: order.children[index].id,
    });
    await bot.sendMessage(
      msg.chat.id,
      `الطفل: ${order.children[index].child_name}`,
      childEditKeyboard(),
    );
    return true;
  } else if (state.step === "edit_child_menu") {
    const fields = {
      "تعديل اسم الطفل": "childName",
      "تعديل الشخصية": "cartoonCharacter",
      "تعديل المدرسة": "schoolName",
      "تعديل المرحلة الدراسية": "schoolStage",
    };
    if (fields[text]) {
      state = await moveForward(telegramId, state, {
        step: "edit_child_value",
        editField: fields[text],
      });
      await bot.sendMessage(
        msg.chat.id,
        "اكتب القيمة الجديدة:",
        textKeyboard("القيمة الجديدة"),
      );
      return true;
    }
    if (text === "حذف الطفل") {
      state = await moveForward(telegramId, state, {
        step: "edit_child_delete_confirm",
      });
      await bot.sendMessage(
        msg.chat.id,
        "حذف الطفل سيحذف كل منتجاته أيضاً. هل أنت متأكد؟",
        confirmKeyboard("نعم، حذف الطفل"),
      );
      return true;
    }
    if (text === "العودة لبيانات الأوردر") {
      state = await moveForward(telegramId, state, {
        step: "edit_children_list",
      });
      await showEditChildren(bot, msg, state);
      return true;
    }
    return true;
  } else if (state.step === "edit_child_value") {
    const value = normalizeName(text);
    if (!value) return true;
    await updateOrderChild(
      state.editOrderCode,
      state.editChildId,
      state.editField,
      value,
      telegramId,
    );
    state = await moveForward(telegramId, state, {
      step: "edit_child_menu",
      editField: null,
    });
    await bot.sendMessage(
      msg.chat.id,
      "تم تعديل بيانات الطفل ✅",
      childEditKeyboard(),
    );
    return true;
  } else if (state.step === "edit_child_delete_confirm") {
    if (text === "لا، رجوع") {
      state = await moveForward(telegramId, state, { step: "edit_child_menu" });
      await bot.sendMessage(msg.chat.id, "لم يتم الحذف.", childEditKeyboard());
      return true;
    }
    if (text !== "نعم، حذف الطفل") return true;
    const result = await deleteOrderChild(
      state.editOrderCode,
      state.editChildId,
      telegramId,
    );
    if (result?.lastChild) {
      state = await moveForward(telegramId, state, { step: "edit_child_menu" });
      await bot.sendMessage(
        msg.chat.id,
        "لا يمكن حذف الطفل الوحيد. عدّل بياناته أو ألغِ الأوردر بالكامل.",
        childEditKeyboard(),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      editChildId: null,
    });
    await showEditRoot(
      bot,
      msg,
      state,
      "تم حذف الطفل ومنتجاته وإعادة حساب الإجمالي ✅",
    );
    return true;
  } else if (state.step === "edit_lines_list") {
    if (text === "العودة لبيانات الأوردر") {
      state = await moveForward(telegramId, state, { step: "edit_order_menu" });
      await showEditRoot(bot, msg, state);
      return true;
    }
    if (text === "إضافة منتج جديد") {
      const order = await editOrderAndCheck(state);
      state = await moveForward(
        telegramId,
        state,
        order.children.length === 1
          ? { step: "edit_add_type", editChildId: order.children[0].id }
          : { step: "edit_add_select_child" },
      );
      if (state.step === "edit_add_type") await promptForState(bot, msg, state);
      else {
        const rows = order.children.map((child, i) => [
          { text: `إضافة للطفل ${i + 1}: ${short(child.child_name, 38)}` },
        ]);
        rows.push([{ text: "العودة لبيانات الأوردر" }]);
        await bot.sendMessage(
          msg.chat.id,
          "اختر الطفل:",
          keyboard(rows, "اختر الطفل"),
        );
      }
      return true;
    }
    const order = await editOrderAndCheck(state);
    const index = order.lines.findIndex(
      (line, i) =>
        text ===
        `${line.line_type === "package" ? "باكدج" : "صنف"} ${i + 1}: ${short(line.description, 36)} × ${line.quantity}`,
    );
    if (index < 0) {
      await showEditLines(bot, msg, state);
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_line_menu",
      editLineId: order.lines[index].id,
      editLine: order.lines[index],
    });
    const hasLabel = await lineRequiresLabel(order.lines[index]);
    await bot.sendMessage(
      msg.chat.id,
      `${order.lines[index].description} × ${order.lines[index].quantity}`,
      lineEditKeyboard(hasLabel),
    );
    return true;
  } else if (state.step === "edit_line_menu") {
    if (text === "تعديل الكمية") {
      state = await moveForward(telegramId, state, {
        step: "edit_line_quantity",
      });
      await bot.sendMessage(
        msg.chat.id,
        "اكتب الكمية الجديدة:",
        textKeyboard("الكمية"),
      );
      return true;
    }
    if (text === "تعديل لون الليبل") {
      const labelCount = await getLineLabelCount(state.editLine);
      state = await moveForward(telegramId, state, {
        step: "edit_line_label_color",
        editLineLabelCount: labelCount,
        labelWhiteCount: null,
      });
      await promptForState(bot, msg, state);
      return true;
    }
    if (text === "حذف المنتج") {
      state = await moveForward(telegramId, state, {
        step: "edit_line_delete_confirm",
      });
      await bot.sendMessage(
        msg.chat.id,
        "هل أنت متأكد من حذف هذا المنتج؟",
        confirmKeyboard("نعم، حذف المنتج"),
      );
      return true;
    }
    if (text === "العودة لبيانات الأوردر") {
      state = await moveForward(telegramId, state, { step: "edit_lines_list" });
      await showEditLines(bot, msg, state);
      return true;
    }
    return true;
  } else if (state.step === "edit_line_quantity") {
    const quantity = Number(
      String(text).replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    );
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      await bot.sendMessage(
        msg.chat.id,
        "الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر.",
        textKeyboard("الكمية"),
      );
      return true;
    }
    if (state.editLine.line_type === "item" && state.editLine.reference_id) {
      const catalog = await getItemById(state.editLine.reference_id);
      if (
        catalog &&
        ((catalog.min_quantity !== null &&
          quantity < Number(catalog.min_quantity)) ||
          (catalog.max_quantity !== null &&
            quantity > Number(catalog.max_quantity)))
      ) {
        await bot.sendMessage(
          msg.chat.id,
          `الكمية المسموحة من ${catalog.min_quantity ?? 1} إلى ${catalog.max_quantity ?? "بدون حد"}.`,
          textKeyboard("الكمية"),
        );
        return true;
      }
    }
    await updateOrderLineQuantity(
      state.editOrderCode,
      state.editLineId,
      quantity,
      telegramId,
    );
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      editLineId: null,
      editLine: null,
    });
    await showEditRoot(
      bot,
      msg,
      state,
      "تم تعديل الكمية وإعادة حساب الإجمالي ✅",
    );
    return true;
  } else if (state.step === "edit_line_delete_confirm") {
    if (text === "لا، رجوع") {
      state = await moveForward(telegramId, state, { step: "edit_line_menu" });
      const hasLabel = state.editLine ? await lineRequiresLabel(state.editLine) : false;
      await bot.sendMessage(msg.chat.id, "لم يتم الحذف.", lineEditKeyboard(hasLabel));
      return true;
    }
    if (text !== "نعم، حذف المنتج") return true;
    const result = await deleteOrderLine(
      state.editOrderCode,
      state.editLineId,
      telegramId,
    );
    if (result?.lastLine) {
      state = await moveForward(telegramId, state, { step: "edit_line_menu" });
      const hasLabel = state.editLine ? await lineRequiresLabel(state.editLine) : false;
      await bot.sendMessage(
        msg.chat.id,
        "لا يمكن حذف المنتج الوحيد. أضف منتجاً آخر أولاً أو ألغِ الأوردر.",
        lineEditKeyboard(hasLabel),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      editLineId: null,
      editLine: null,
    });
    await showEditRoot(
      bot,
      msg,
      state,
      "تم حذف المنتج وإعادة حساب الإجمالي ✅",
    );
    return true;
  } else if (state.step === "edit_line_label_color") {
    const labelCount = state.editLineLabelCount ?? state.editLine.quantity;
    if (text === "أبيض" || text === "أسود") {
      await updateOrderLineDetails(
        state.editOrderCode,
        state.editLineId,
        {
          labelColor: text,
          [text === "أبيض" ? "whiteCount" : "blackCount"]: labelCount,
        },
        telegramId,
      );
      state = await moveForward(telegramId, state, {
        step: "edit_order_menu",
        editLineId: null,
        editLine: null,
        editLineLabelCount: null,
        labelWhiteCount: null,
      });
      await showEditRoot(bot, msg, state, "تم تعديل لون الليبل ✅");
      return true;
    }
    if (text === "الاثنين") {
      state = await moveForward(telegramId, state, {
        step: "edit_line_label_white_count",
      });
      await promptForState(bot, msg, state);
      return true;
    }
    if (text === "لون آخر") {
      state = await moveForward(telegramId, state, {
        step: "edit_line_custom_label",
      });
      await promptForState(bot, msg, state);
      return true;
    }
    await promptForState(bot, msg, state);
    return true;
  } else if (state.step === "edit_line_custom_label") {
    const value = normalizeName(text);
    if (!value) return true;
    await updateOrderLineDetails(
      state.editOrderCode,
      state.editLineId,
      { labelColor: value },
      telegramId,
    );
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      editLineId: null,
      editLine: null,
      editLineLabelCount: null,
      labelWhiteCount: null,
    });
    await showEditRoot(bot, msg, state, "تم تعديل لون الليبل ✅");
    return true;
  } else if (state.step === "edit_line_label_white_count") {
    const labelCount = state.editLineLabelCount ?? state.editLine.quantity;
    const white = Number(
      String(text).replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    );
    if (
      !Number.isSafeInteger(white) ||
      white < 0 ||
      white > labelCount
    ) {
      await bot.sendMessage(
        msg.chat.id,
        "اكتب عدداً صحيحاً لا يزيد عن الكمية المطلوبة.",
        textKeyboard("عدد الأبيض"),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_line_label_black_count",
      labelWhiteCount: white,
    });
    await promptForState(bot, msg, state);
    return true;
  } else if (state.step === "edit_line_label_black_count") {
    const labelCount = state.editLineLabelCount ?? state.editLine.quantity;
    const black = Number(
      String(text).replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    );
    const white = Number(state.labelWhiteCount || 0);
    if (!Number.isSafeInteger(black) || black < 0 || white + black > labelCount) {
      await bot.sendMessage(
        msg.chat.id,
        "مجموع الأبيض والأسود لا يمكن أن يزيد عن الكمية المطلوبة.",
        textKeyboard("عدد الأسود"),
      );
      return true;
    }
    await updateOrderLineDetails(
      state.editOrderCode,
      state.editLineId,
      { labelColor: "الاثنين", whiteCount: white, blackCount: black },
      telegramId,
    );
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      editLineId: null,
      editLine: null,
      editLineLabelCount: null,
      labelWhiteCount: null,
    });
    await showEditRoot(bot, msg, state, "تم تعديل لون الليبل ✅");
    return true;
  } else if (state.step === "edit_add_child_name") {
    const value = normalizeName(text);
    if (value.split(" ").filter(Boolean).length < 2) {
      await bot.sendMessage(
        msg.chat.id,
        "اسم الطفل يجب أن يتكون من كلمتين على الأقل.",
        textKeyboard("اسم الطفل"),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_add_child_cartoon",
      editNewChild: { childName: value },
    });
    await promptForState(bot, msg, state);
    return true;
  } else if (state.step === "edit_add_child_cartoon") {
    const value = normalizeName(text);
    state = await moveForward(telegramId, state, {
      step: "edit_add_child_school",
      editNewChild: {
        ...state.editNewChild,
        cartoonCharacter: text === "تخطي" || !value ? "غير محدد" : value,
      },
    });
    await promptForState(bot, msg, state);
    return true;
  } else if (state.step === "edit_add_child_school") {
    const value = normalizeName(text);
    state = await moveForward(telegramId, state, {
      step: "edit_add_child_stage",
      editNewChild: {
        ...state.editNewChild,
        schoolName: text === "تخطي" || !value ? "غير محدد" : value,
      },
    });
    await promptForState(bot, msg, state);
    return true;
  } else if (state.step === "edit_add_child_stage") {
    const value = normalizeName(text);
    const child = {
      ...state.editNewChild,
      schoolStage: text === "تخطي" || !value ? "غير محدد" : value,
      labelColor: "غير محدد",
    };
    const added = await addOrderChild(state.editOrderCode, child, telegramId);
    if (!added) {
      state = await moveForward(telegramId, state, {
        step: "edit_order_menu",
        editNewChild: null,
      });
      await showEditRoot(
        bot,
        msg,
        state,
        "تعذر إضافة الطفل؛ ربما وصل الأوردر إلى 6 أطفال.",
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_add_type",
      editChildId: added.id,
      editNewChild: null,
    });
    await bot.sendMessage(
      msg.chat.id,
      "تمت إضافة الطفل ✅\nأضف له الآن منتجاً أو باكدج:",
      orderTypeKeyboard(),
    );
    return true;
  } else if (state.step === "edit_add_select_child") {
    if (text === "العودة لبيانات الأوردر") {
      state = await moveForward(telegramId, state, { step: "edit_order_menu" });
      await showEditRoot(bot, msg, state);
      return true;
    }
    const order = await editOrderAndCheck(state);
    const index = order.children.findIndex(
      (child, i) =>
        text === `إضافة للطفل ${i + 1}: ${short(child.child_name, 38)}`,
    );
    if (index < 0) return true;
    state = await moveForward(telegramId, state, {
      step: "edit_add_type",
      editChildId: order.children[index].id,
    });
    await promptForState(bot, msg, state);
    return true;
  } else if (state.step === "edit_add_type") {
    const listType =
      text === "باكدج" ? "package" : text === "صنف عادي" ? "item" : null;
    if (!listType) {
      await promptForState(bot, msg, state);
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_add_list",
      listType,
      query: "",
      page: 0,
    });
    await showList(bot, msg, state);
    return true;
  } else if (state.step === "edit_add_list") {
    if (text === "بحث 🔎") {
      state = await moveForward(telegramId, state, { step: "edit_add_search" });
      await bot.sendMessage(
        msg.chat.id,
        "اكتب جزءاً من الاسم:",
        textKeyboard("كلمة البحث"),
      );
      return true;
    }
    if (["التالي ▶️", "السابق ◀️"].includes(text)) {
      state.page = Math.max(
        0,
        (state.page || 0) + (text === "التالي ▶️" ? 1 : -1),
      );
      await setConversationState(telegramId, state);
      await showList(bot, msg, state);
      return true;
    }
    const { entries } = await listEntries(
      state.listType,
      state.query || "",
      state.page || 0,
    );
    const selected = entries.find((entry) => short(entry.label, 60) === text);
    if (!selected) {
      await showList(bot, msg, state);
      return true;
    }
    if (state.listType === "package") {
      const row = selected.value;
      const labelCount = row.requires_label_color ? (packageLabelCount(row) || 1) : 1;
      const line = {
        type: "package",
        referenceId: row.id,
        description: row.package_name,
        quantity: 1,
        labelCount,
        unitPrice: Number(row.total_price),
        lineTotal: Number(row.total_price),
        details: {},
      };
      if (row.requires_label_color) {
        state = await moveForward(telegramId, state, {
          step: "edit_add_line_label_color",
          pendingLine: line,
          listType: null,
          query: "",
          page: 0,
        });
        await promptForState(bot, msg, state);
        return true;
      }
      await addOrderLine(
        state.editOrderCode,
        state.editChildId,
        line,
        telegramId,
      );
      state = await moveForward(telegramId, state, {
        step: "edit_order_menu",
        listType: null,
        query: "",
        page: 0,
      });
      await showEditRoot(
        bot,
        msg,
        state,
        "تمت إضافة الباكدج وإعادة حساب الإجمالي ✅",
      );
      return true;
    }
    const row = selected.value;
    state = await moveForward(telegramId, state, {
      step: "edit_add_quantity",
      pendingItem: {
        referenceId: row.id,
        itemName: row.item_name,
        price: Number(row.price),
        minQuantity: row.min_quantity,
        maxQuantity: row.max_quantity,
        requiresLabelColor: row.requires_label_color,
      },
    });
    await bot.sendMessage(
      msg.chat.id,
      `اكتب الكمية من «${row.item_name}».\nالمسموح: ${row.min_quantity ?? 1} إلى ${row.max_quantity ?? "بدون حد"}.`,
      textKeyboard("الكمية"),
    );
    return true;
  } else if (state.step === "edit_add_search") {
    state = await moveForward(telegramId, state, {
      step: "edit_add_list",
      query: normalizeName(text),
      page: 0,
    });
    await showList(bot, msg, state);
    return true;
  } else if (state.step === "edit_add_quantity") {
    const quantity = Number(
      String(text).replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    );
    const item = state.pendingItem;
    if (
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      (item.minQuantity !== null && quantity < Number(item.minQuantity)) ||
      (item.maxQuantity !== null && quantity > Number(item.maxQuantity))
    ) {
      await bot.sendMessage(
        msg.chat.id,
        "الكمية خارج الحدود المسموحة.",
        textKeyboard("الكمية"),
      );
      return true;
    }
    const line = {
      type: "item",
      referenceId: item.referenceId,
      description: item.itemName,
      quantity,
      labelCount: quantity,
      unitPrice: item.price,
      lineTotal: Math.round(item.price * quantity * 100) / 100,
      details: {},
    };
    if (item.requiresLabelColor) {
      state = await moveForward(telegramId, state, {
        step: "edit_add_line_label_color",
        pendingItem: null,
        pendingLine: line,
      });
      await promptForState(bot, msg, state);
      return true;
    }
    await addOrderLine(
      state.editOrderCode,
      state.editChildId,
      line,
      telegramId,
    );
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      pendingItem: null,
      listType: null,
      query: "",
      page: 0,
    });
    await showEditRoot(
      bot,
      msg,
      state,
      "تمت إضافة الصنف وإعادة حساب الإجمالي ✅",
    );
    return true;
  } else if (state.step === "edit_add_line_label_color") {
    const labelCount = state.pendingLine.labelCount ?? state.pendingLine.quantity;
    if (text === "أبيض" || text === "أسود") {
      const line = {
        ...state.pendingLine,
        details: { labelColor: text, [text === "أبيض" ? "whiteCount" : "blackCount"]: labelCount },
      };
      await addOrderLine(state.editOrderCode, state.editChildId, line, telegramId);
      state = await moveForward(telegramId, state, {
        step: "edit_order_menu",
        pendingLine: null,
        labelWhiteCount: null,
      });
      await showEditRoot(bot, msg, state, "تمت الإضافة وإعادة حساب الإجمالي ✅");
      return true;
    }
    if (text === "الاثنين") {
      state = await moveForward(telegramId, state, {
        step: "edit_add_line_label_white_count",
      });
      await promptForState(bot, msg, state);
      return true;
    }
    if (text === "لون آخر") {
      state = await moveForward(telegramId, state, {
        step: "edit_add_line_custom_label",
      });
      await promptForState(bot, msg, state);
      return true;
    }
    await promptForState(bot, msg, state);
    return true;
  } else if (state.step === "edit_add_line_custom_label") {
    const value = normalizeName(text);
    if (!value) return true;
    const line = { ...state.pendingLine, details: { labelColor: value } };
    await addOrderLine(state.editOrderCode, state.editChildId, line, telegramId);
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      pendingLine: null,
      labelWhiteCount: null,
    });
    await showEditRoot(bot, msg, state, "تمت الإضافة وإعادة حساب الإجمالي ✅");
    return true;
  } else if (state.step === "edit_add_line_label_white_count") {
    const labelCount = state.pendingLine.labelCount ?? state.pendingLine.quantity;
    const white = Number(
      String(text).replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    );
    if (!Number.isSafeInteger(white) || white < 0 || white > labelCount) {
      await bot.sendMessage(
        msg.chat.id,
        "اكتب عدداً صحيحاً لا يزيد عن الكمية المطلوبة.",
        textKeyboard("عدد الأبيض"),
      );
      return true;
    }
    state = await moveForward(telegramId, state, {
      step: "edit_add_line_label_black_count",
      labelWhiteCount: white,
    });
    await promptForState(bot, msg, state);
    return true;
  } else if (state.step === "edit_add_line_label_black_count") {
    const labelCount = state.pendingLine.labelCount ?? state.pendingLine.quantity;
    const black = Number(
      String(text).replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    );
    const white = Number(state.labelWhiteCount || 0);
    if (!Number.isSafeInteger(black) || black < 0 || white + black > labelCount) {
      await bot.sendMessage(
        msg.chat.id,
        "مجموع الأبيض والأسود لا يمكن أن يزيد عن الكمية المطلوبة.",
        textKeyboard("عدد الأسود"),
      );
      return true;
    }
    const line = {
      ...state.pendingLine,
      details: { labelColor: "الاثنين", whiteCount: white, blackCount: black },
    };
    await addOrderLine(state.editOrderCode, state.editChildId, line, telegramId);
    state = await moveForward(telegramId, state, {
      step: "edit_order_menu",
      pendingLine: null,
      labelWhiteCount: null,
    });
    await showEditRoot(bot, msg, state, "تمت الإضافة وإعادة حساب الإجمالي ✅");
    return true;
  } else if (state.step === "edit_cancel_confirm") {
    if (!/^(الغاء|إلغاء)$/i.test(text)) {
      await bot.sendMessage(
        msg.chat.id,
        "لم يتم إلغاء الأوردر. إذا كنت متأكداً اكتب «الغاء» حرفياً، أو اضغط رجوع خطوة.",
        cancelConfirmationKeyboard(),
      );
      return true;
    }
    await cancelSavedOrder(state.editOrderCode, telegramId);
    await clearConversationState(telegramId);
    await bot.sendMessage(
      msg.chat.id,
      `تم إلغاء الأوردر ${state.editOrderCode} مع الاحتفاظ بسجله.`,
      orderMenuKeyboard(),
    );
    return true;
  }

  await promptForState(bot, msg, state);
  return true;
  } catch (error) {
    console.error("handleOrderMessage failed:", {
      step: typeof state !== "undefined" ? state?.step : "before_state",
      editOrderCode: typeof state !== "undefined" ? state?.editOrderCode : undefined,
      text: String(text).slice(0, 120),
      error: error.message,
      stack: error.stack,
    });
    const isTransient = /timeout|ECONN|terminat|Pool|connection|ETIMEDOUT|deadlock|Rate/i.test(error.message || "");
    try {
      await bot.sendMessage(
        msg.chat.id,
        isTransient
          ? "تعذر تنفيذ العملية لخلل مؤقت في الاتصال. موضعك محفوظ — اضغط نفس الزر أو «رجوع خطوة» للمحاولة مجدداً."
          : "تعذر تنفيذ العملية حالياً. موضعك محفوظ — حاول مرة أخرى أو اضغط «رجوع خطوة».",
        state?.draft || state?.editOrderCode
          ? keyboard([[{ text: "رجوع خطوة" }, { text: "إلغاء الطلب" }]], "أعد المحاولة")
          : orderMenuKeyboard(),
      );
    } catch {}
    return true;
  }
}

module.exports = {
  handleOrderMessage,
  orderMenuKeyboard,
  orderSummary,
  promptForState,
};
