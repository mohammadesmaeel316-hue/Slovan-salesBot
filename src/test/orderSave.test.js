"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pool, saveOrder } = require("../db");

test("saveOrder maps all sales order columns to the correct SQL parameters", async () => {
  const originalConnect = pool.connect;
  let salesInsertChecked = false;

  pool.connect = async () => ({
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") return { rows: [] };
      if (normalized.startsWith("insert into public.sales_orders")) {
        const match = normalized.match(/sales_orders \((.*?)\) values \((.*?)\) returning/);
        assert.ok(match, "sales order insert should expose its columns and values");
        assert.equal(match[1].split(",").length, 18);
        assert.equal(match[2].split(",").length, 18);
        assert.equal(params.length, 17);
        assert.equal(Math.max(...[...normalized.matchAll(/\$(\d+)/g)].map(entry => Number(entry[1]))), 17);
        assert.equal(params[14], "100");
        assert.equal(params[15], "تحويل بنكي");
        salesInsertChecked = true;
        return { rows: [{ id: 42, created_at: new Date() }] };
      }
      if (normalized.startsWith("insert into public.order_children")) return { rows: [{ id: 84, position: 1 }] };
      return { rows: [] };
    },
    release() {},
  });

  try {
    const result = await saveOrder({
      source: "Facebook",
      parentName: "عميل اختبار",
      parentPhone: "01000000000",
      address: "عنوان اختبار",
      notes: null,
      delivery: { areaName: "القاهرة", price: 50 },
      discount: { type: null, value: 0 },
      advancePayment: 100,
      advancePaymentDetails: "تحويل بنكي",
      children: [{ childName: "طفل اختبار", cartoonCharacter: "Sonic", schoolName: "مدرسة", labelColor: "غير محدد" }],
      lines: [{ type: "item", referenceId: null, description: "صنف اختبار", quantity: 1, unitPrice: 100, lineTotal: 100, childIndex: 0, details: {} }],
    }, "652732552");

    assert.equal(salesInsertChecked, true);
    assert.equal(result.orderCode, "ORD#042");
    assert.equal(result.grandTotal, 150);
  } finally {
    pool.connect = originalConnect;
  }
});
