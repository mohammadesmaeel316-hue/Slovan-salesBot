"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { PACKAGE_NAME_HEADER, PACKAGE_ITEM_HEADER, PACKAGE_QUANTITY_HEADER, PACKAGE_PRICE_HEADER, buildPackagesWorkbook, parsePackagesWorkbook } = require("../packagesSheet");

async function buffer(rows, headers = [PACKAGE_NAME_HEADER, PACKAGE_ITEM_HEADER, PACKAGE_QUANTITY_HEADER, PACKAGE_PRICE_HEADER]) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("الباكدجات");
  sheet.addRow(headers); rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("round-trips packages with flexible item counts", async () => {
  const built = await buildPackagesWorkbook([{ package_name: "باكيدج السعاده", total_price: "470.00", items: [{ item_name: "تيكت", quantity: 25 }, { item_name: "ليبل ملابس", quantity: 4 }] }]);
  assert.deepEqual(await parsePackagesWorkbook(built), [{ packageName: "باكيدج السعاده", totalPrice: 470, requiresLabelColor: false, items: [{ itemName: "تيكت", quantity: 25 }, { itemName: "ليبل ملابس", quantity: 4 }] }]);
});
test("accepts an empty package template", async () => assert.deepEqual(await parsePackagesWorkbook(await buildPackagesWorkbook([])), []));
test("requires package price, item name, and positive integer quantity", async () => {
  await assert.rejects(() => buffer([["باكدج", "تيكت", 1, ""]]).then(parsePackagesWorkbook), /السعر الإجمالي/);
  await assert.rejects(() => buffer([["باكدج", "", 1, 100]]).then(parsePackagesWorkbook), /اسم الصنف/);
  await assert.rejects(() => buffer([["باكدج", "تيكت", 0, 100]]).then(parsePackagesWorkbook), /أكبر من صفر/);
});
test("rejects duplicate packages and duplicate items within a package", async () => {
  await assert.rejects(() => buffer([["باكدج", "تيكت", 1, 100], ["باكدج", "ليبل", 1, 200]]).then(parsePackagesWorkbook), /الباكدج.*مكرر/);
  await assert.rejects(() => buffer([["باكدج", "تيكت", 1, 100], ["", "تيكت", 2, ""]]).then(parsePackagesWorkbook), /الصنف.*مكرر/);
});
test("requires exact headers", async () => assert.rejects(() => buffer([], ["package", "item", "qty", "price"]).then(parsePackagesWorkbook), /الصف الأول/));
