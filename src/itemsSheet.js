"use strict";

const ExcelJS = require("exceljs");
const { normalizeDigits, normalizeName } = require("./utils");

const ITEM_NAME_HEADER = "اسم الصنف";
const ITEM_PRICE_HEADER = "السعر";
const MIN_QUANTITY_HEADER = "الحد الأدنى";
const MAX_QUANTITY_HEADER = "الحد الأقصى";
const LABEL_COLOR_HEADER = "يحتاج لون ليبل؟";
const MAX_ITEM_ROWS = 1000;
const MAX_ITEM_PRICE = 9_999_999_999.99;

function workbookError(message) {
  const error = new Error(message);
  error.isItemsValidationError = true;
  return error;
}

function cellValue(cell) {
  const value = cell.value;
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value;
}

function normalizeNumberText(value) {
  return normalizeDigits(String(value ?? ""))
    .replace(/[٬,]/g, "")
    .replace(/٫/g, ".")
    .trim();
}

function parsePrice(value, rowNumber) {
  const number = typeof value === "number" ? value : Number(normalizeNumberText(value));
  if (!Number.isFinite(number) || number < 0 || number > MAX_ITEM_PRICE) {
    throw workbookError(`السعر غير صحيح في الصف ${rowNumber}.`);
  }
  const cents = Math.round(number * 100);
  if (Math.abs(number * 100 - cents) > 1e-7) {
    throw workbookError(`السعر في الصف ${rowNumber} يجب ألا يتجاوز منزلتين عشريتين.`);
  }
  return cents / 100;
}

function parseOptionalQuantity(value, label, rowNumber) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = typeof value === "number" ? value : Number(normalizeNumberText(value));
  if (!Number.isSafeInteger(number) || number < 0) {
    throw workbookError(`${label} في الصف ${rowNumber} يجب أن يكون عدداً صحيحاً يساوي صفراً أو أكبر.`);
  }
  return number;
}

async function buildItemsWorkbook(rows = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Slovan Sales Bot";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("الأصناف", {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
    properties: { defaultRowHeight: 20 },
  });
  sheet.columns = [
    { header: ITEM_NAME_HEADER, key: "itemName", width: 34 },
    { header: ITEM_PRICE_HEADER, key: "price", width: 18 },
    { header: MIN_QUANTITY_HEADER, key: "minQuantity", width: 18 },
    { header: MAX_QUANTITY_HEADER, key: "maxQuantity", width: 18 },
    { header: LABEL_COLOR_HEADER, key: "requiresLabelColor", width: 20 },
  ];
  for (const row of rows) {
    sheet.addRow({
      itemName: row.item_name,
      price: Number(row.price),
      minQuantity: row.min_quantity === null ? null : Number(row.min_quantity),
      maxQuantity: row.max_quantity === null ? null : Number(row.max_quantity),
      requiresLabelColor: row.requires_label_color ? "نعم" : "",
    });
  }
  const header = sheet.getRow(1);
  header.height = 28;
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  header.alignment = { horizontal: "center", vertical: "middle" };
  header.eachCell((cell) => {
    cell.border = {
      top: { style: "medium", color: { argb: "FF115E59" } },
      bottom: { style: "medium", color: { argb: "FF115E59" } },
    };
  });
  sheet.getColumn(1).alignment = { horizontal: "right", vertical: "middle" };
  for (const column of [2, 3, 4]) {
    sheet.getColumn(column).alignment = { horizontal: "center", vertical: "middle" };
  }
  sheet.getColumn(2).numFmt = "#,##0.00";
  sheet.getColumn(3).numFmt = "0";
  sheet.getColumn(4).numFmt = "0";
  sheet.autoFilter = { from: "A1", to: "E1" };

  for (let rowNumber = 2; rowNumber <= MAX_ITEM_ROWS + 1; rowNumber += 1) {
    sheet.getCell(rowNumber, 2).dataValidation = {
      type: "decimal", operator: "greaterThanOrEqual", allowBlank: false,
      showErrorMessage: true, errorTitle: "قيمة غير صحيحة",
      error: "أدخل سعراً رقمياً يساوي صفراً أو أكبر.", formulae: [0],
    };
    for (const column of [3, 4]) {
      sheet.getCell(rowNumber, column).dataValidation = {
        type: "whole", operator: "greaterThanOrEqual", allowBlank: true,
        showErrorMessage: true, errorTitle: "قيمة غير صحيحة",
        error: "أدخل عدداً صحيحاً يساوي صفراً أو أكبر، أو اترك الخلية فارغة.", formulae: [0],
      };
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function parseItemsWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw workbookError("تعذر قراءة الملف. تأكد أنه ملف Excel بصيغة .xlsx.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw workbookError("ملف Excel لا يحتوي على ورقة بيانات.");
  const expected = [ITEM_NAME_HEADER, ITEM_PRICE_HEADER, MIN_QUANTITY_HEADER, MAX_QUANTITY_HEADER];
  const actual = expected.map((_, index) => normalizeName(sheet.getCell(1, index + 1).text));
  if (actual.some((header, index) => header !== expected[index])) {
    throw workbookError(`يجب أن يكون الصف الأول بالترتيب: ${expected.join(" | ")}.`);
  }

  const rows = [];
  const seenNames = new Set();
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const itemName = normalizeName(sheet.getCell(rowNumber, 1).text);
    const rawPrice = cellValue(sheet.getCell(rowNumber, 2));
    const rawMin = cellValue(sheet.getCell(rowNumber, 3));
    const rawMax = cellValue(sheet.getCell(rowNumber, 4));
    const hasPrice = rawPrice !== null && rawPrice !== undefined && String(rawPrice).trim() !== "";
    const hasMin = rawMin !== null && rawMin !== undefined && String(rawMin).trim() !== "";
    const rawLabel = normalizeName(sheet.getCell(rowNumber, 5).text); const hasMax = rawMax !== null && rawMax !== undefined && String(rawMax).trim() !== "";
    if (!itemName && !hasPrice && !hasMin && !hasMax) continue;
    if (!itemName) throw workbookError(`اسم الصنف مفقود في الصف ${rowNumber}.`);
    if (itemName.length > 200) throw workbookError(`اسم الصنف في الصف ${rowNumber} أطول من 200 حرف.`);
    if (!hasPrice) throw workbookError(`السعر مفقود في الصف ${rowNumber}.`);
    const key = itemName.toLocaleLowerCase("ar-EG");
    if (seenNames.has(key)) throw workbookError(`الصنف «${itemName}» مكرر في الملف.`);
    seenNames.add(key);
    const minQuantity = parseOptionalQuantity(rawMin, MIN_QUANTITY_HEADER, rowNumber);
    const maxQuantity = parseOptionalQuantity(rawMax, MAX_QUANTITY_HEADER, rowNumber);
    if (minQuantity !== null && maxQuantity !== null && minQuantity > maxQuantity) {
      throw workbookError(`الحد الأدنى أكبر من الحد الأقصى في الصف ${rowNumber}.`);
    }
    if (rawLabel && !["نعم", "لا"].includes(rawLabel)) throw workbookError(`حقل «${LABEL_COLOR_HEADER}» في الصف ${rowNumber} يجب أن يكون نعم أو لا.`);
    rows.push({ itemName, price: parsePrice(rawPrice, rowNumber), minQuantity, maxQuantity, requiresLabelColor: rawLabel === "نعم" });
    if (rows.length > MAX_ITEM_ROWS) throw workbookError(`الحد الأقصى هو ${MAX_ITEM_ROWS} صنف في الملف.`);
  }
  return rows;
}

module.exports = {
  ITEM_NAME_HEADER, ITEM_PRICE_HEADER, MIN_QUANTITY_HEADER, MAX_QUANTITY_HEADER, LABEL_COLOR_HEADER,
  MAX_ITEM_ROWS, buildItemsWorkbook, parseItemsWorkbook,
};
