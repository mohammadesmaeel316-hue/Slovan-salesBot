"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { buildOrdersWorkbook } = require("../ordersSheet");

test("builds an orders workbook with creator and order details", async () => {
  const orderRow = {
    order_code: "ORD-000001",
    created_at: "2026-08-15T18:00:00.000Z",
    updated_at: "2026-08-15T18:10:00.000Z",
    status: "confirmed",
    source: "Facebook",
    parent_name: "Noura",
    parent_phone: "01100000000",
    child_position: 1,
    line_position: 1,
    child_name: "Hamza Khaled",
    cartoon_character: "Sonic",
    school_name: "Degla Valley",
    clothing_label_color: "White",
    line_type: "item",
    description: "School label",
    quantity: 2,
    unit_price: "85.00",
    line_total: "170.00",
    creator_name: "Mohamed Esmail",
    created_by: "652732552",
    creator_phone: "01000000000",
    delivery_area: "Cairo",
    shipping_price: "115.00",
    grand_total: "285.00",
  };
  const buffer = await buildOrdersWorkbook([
    orderRow,
    { ...orderRow, line_position: 2, description: "Bag label", quantity: 1, line_total: "85.00" },
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["ملخص الطلبات", "تفاصيل الطلبات"]);
  const summary = workbook.worksheets[0];
  const details = workbook.worksheets[1];
  assert.equal(summary.getRow(1).getCell(1).text, "رقم الأوردر");
  assert.equal(summary.getRow(2).getCell(1).text, "ORD-000001");
  assert.equal(summary.getRow(2).getCell(10).value, 1);
  assert.equal(summary.getRow(2).getCell(11).value, 2);
  assert.equal(summary.getRow(2).getCell(17).value, 285);
  assert.equal(summary.rowCount, 2);
  assert.equal(details.rowCount, 3);
  assert.equal(details.getRow(1).getCell(11).text, "المرحلة الدراسية");
  assert.equal(details.getRow(2).getCell(21).text, "Mohamed Esmail");
  assert.equal(details.getRow(2).getCell(28).value, 285);
  assert.equal(details.getRow(1).getCell(32).text, "تاريخ الإنشاء");
  assert.equal(details.getRow(1).getCell(33).text, "آخر تعديل");
});
