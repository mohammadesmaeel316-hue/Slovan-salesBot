"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { orderSummary, promptForState } = require("../orderFlow");

test("builds the final Arabic order summary with exact totals and order ID", () => {
  const draft = {
    source: "Facebook", parentName: "نورا عبد السلام", parentPhone: "01126390787",
    address: "مدينة نصر - شارع مصطفى النحاس", notes: "التواصل قبل التوصيل",
    delivery: { areaName: "القاهرة", price: 115 },
    children: [{ childName: "Hamza Khaled", cartoonCharacter: "سونك", schoolName: "Degla Valley", labelColor: "أبيض" }],
    lines: [
      { childIndex: 0, type: "package", description: "توفير ٢+", quantity: 1, lineTotal: 335 },
      { childIndex: 0, type: "item", description: "ليبل شنطة", quantity: 1, lineTotal: 85 },
    ],
  };
  const summary = orderSummary(draft, "ORD-20260815-000001");
  assert.match(summary, /ORD-20260815-000001/);
  assert.match(summary, /نورا عبد السلام/);
  assert.match(summary, /Hamza Khaled/);
  assert.match(summary, /335\+85=420ج/);
  assert.match(summary, /420\+115=535ج/);
  assert.match(summary, /👤 بيانات العميل والتوصيل/);
  assert.ok(summary.indexOf("📍 منطقة التوصيل") < summary.indexOf("📦 تفاصيل الأوردر"));
  assert.ok(summary.indexOf("💰 ملخص الحساب") < summary.indexOf("📝 ملاحظات"));
  assert.match(summary, /🏠 العنوان: مدينة نصر - شارع مصطفى النحاس/);
});

test("rounds currency arithmetic to cents", () => {
  const draft = {
    source: "WhatsApp", parentName: "أحمد محمد", parentPhone: "01000000000",
    delivery: { areaName: "الجيزة", price: 0.1 },
    children: [{ childName: "عمر أحمد", cartoonCharacter: "باتمان", schoolName: "مدرسة", labelColor: "أسود" }],
    lines: [{ childIndex: 0, type: "item", description: "صنف", quantity: 1, lineTotal: 0.2 }, { childIndex: 0, type: "item", description: "صنف 2", quantity: 1, lineTotal: 0.1 }],
  };
  assert.match(orderSummary(draft, "ORD-X"), /0.30\+0.10=0.40ج/);
});

test("applies a percentage discount before shipping", () => {
  const draft = {
    source: "Facebook", parentName: "Noura Ahmed", parentPhone: "01100000000",
    delivery: { areaName: "Cairo", price: 115 },
    discount: { type: "percent", value: 20 },
    children: [{ childName: "Hamza Khaled", cartoonCharacter: "Sonic", schoolName: "School", labelColor: "White" }],
    lines: [{ childIndex: 0, type: "item", description: "Label", quantity: 1, lineTotal: 500 }],
  };
  const summary = orderSummary(draft, "ORD#001");
  assert.match(summary, /إجمالي الأوردر: 500=500ج/);
  assert.match(summary, /20% = 100ج/);
  assert.match(summary, /400\+115=515ج/);
});

test("builds early and edit prompts without evaluating unavailable future data", async () => {
  const sent = [];
  const bot = { sendMessage: async (...args) => sent.push(args) };
  const msg = { chat: { id: 1 }, from: { id: 1 } };
  await promptForState(bot, msg, { step: "order_source", draft: { children: [] } });
  await promptForState(bot, msg, { step: "edit_order_code" });
  assert.equal(sent.length, 2);
  assert.match(sent[0][1], /مصدر الأوردر/);
  assert.match(sent[1][1], /رقم الأوردر/);
});
