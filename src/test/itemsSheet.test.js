"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const {
  ITEM_NAME_HEADER,
  ITEM_PRICE_HEADER,
  MIN_QUANTITY_HEADER,
  MAX_QUANTITY_HEADER,
  buildItemsWorkbook,
  parseItemsWorkbook,
} = require("../itemsSheet");

async function workbookBuffer(rows, headers = [
  ITEM_NAME_HEADER, ITEM_PRICE_HEADER, MIN_QUANTITY_HEADER, MAX_QUANTITY_HEADER,
]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("الأصناف");
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("builds a reusable workbook containing current items", async () => {
  const buffer = await buildItemsWorkbook([{
    item_name: "ليبل ملابس", price: "85.00", min_quantity: 2, max_quantity: 20,
  }]);
  assert.deepEqual(await parseItemsWorkbook(buffer), [{
    itemName: "ليبل ملابس", price: 85, minQuantity: 2, maxQuantity: 20,
  }]);
});

test("accepts an empty item template and optional quantity limits", async () => {
  assert.deepEqual(await parseItemsWorkbook(await buildItemsWorkbook([])), []);
  const buffer = await workbookBuffer([["ميدالية شنطة", 30, "", ""]]);
  assert.deepEqual(await parseItemsWorkbook(buffer), [{
    itemName: "ميدالية شنطة", price: 30, minQuantity: null, maxQuantity: null,
  }]);
});

test("requires item name and price", async () => {
  await assert.rejects(() => workbookBuffer([["", 10, "", ""]]).then(parseItemsWorkbook), /اسم الصنف مفقود/);
  await assert.rejects(() => workbookBuffer([["تيكت", "", "", ""]]).then(parseItemsWorkbook), /السعر مفقود/);
});

test("validates optional minimum and maximum quantities", async () => {
  await assert.rejects(() => workbookBuffer([["تيكت", 5, 1.5, ""]]).then(parseItemsWorkbook), /عدداً صحيحاً/);
  await assert.rejects(() => workbookBuffer([["تيكت", 5, 10, 2]]).then(parseItemsWorkbook), /أكبر من الحد الأقصى/);
});

test("rejects duplicate names and incorrect headers", async () => {
  await assert.rejects(
    () => workbookBuffer([["تيكت", 5], ["تيكت", 6]]).then(parseItemsWorkbook),
    /مكرر/,
  );
  await assert.rejects(
    () => workbookBuffer([], ["item", "price", "min", "max"]).then(parseItemsWorkbook),
    /الصف الأول/,
  );
});
