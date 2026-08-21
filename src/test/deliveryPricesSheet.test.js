"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const {
  AREA_HEADER,
  PRICE_HEADER,
  buildDeliveryPricesWorkbook,
  parseDeliveryPricesWorkbook,
} = require("../deliveryPricesSheet");

async function workbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("أسعار الشحن");
  sheet.addRow([AREA_HEADER, PRICE_HEADER]);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("builds a reusable workbook containing current prices", async () => {
  const buffer = await buildDeliveryPricesWorkbook([
    { area_name: "القاهرة", price: "115.00" },
  ]);
  const rows = await parseDeliveryPricesWorkbook(buffer);
  assert.deepEqual(rows, [{ areaName: "القاهرة", price: 115 }]);
});

test("accepts an empty template", async () => {
  const buffer = await buildDeliveryPricesWorkbook([]);
  assert.deepEqual(await parseDeliveryPricesWorkbook(buffer), []);
});

test("rejects duplicate areas and invalid prices", async () => {
  const duplicate = await workbookBuffer([
    ["القاهرة", 100],
    ["القاهرة", 120],
  ]);
  await assert.rejects(() => parseDeliveryPricesWorkbook(duplicate), /مكررة/);

  const invalidPrice = await workbookBuffer([["الجيزة", "abc"]]);
  await assert.rejects(() => parseDeliveryPricesWorkbook(invalidPrice), /سعر الشحن غير صحيحة/);
});

test("requires the exact two-column header", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["area", "price"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(() => parseDeliveryPricesWorkbook(buffer), /الصف الأول/);
});
