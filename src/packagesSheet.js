"use strict";

const ExcelJS = require("exceljs");
const { normalizeDigits, normalizeName } = require("./utils");

const PACKAGE_NAME_HEADER = "اسم الباكدج";
const PACKAGE_ITEM_HEADER = "الصنف";
const PACKAGE_QUANTITY_HEADER = "الكمية";
const PACKAGE_PRICE_HEADER = "السعر الإجمالي";
const MAX_PACKAGE_ROWS = 1000;
const MAX_PACKAGE_PRICE = 9_999_999_999.99;

function workbookError(message) {
  const error = new Error(message);
  error.isPackagesValidationError = true;
  return error;
}

function cellValue(cell) {
  const value = cell.value;
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value;
}

function normalizedNumber(value) {
  return typeof value === "number" ? value : Number(normalizeDigits(String(value ?? ""))
    .replace(/[٬,]/g, "").replace(/٫/g, ".").trim());
}

function parsePrice(value, rowNumber) {
  const number = normalizedNumber(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_PACKAGE_PRICE) {
    throw workbookError(`السعر الإجمالي غير صحيح في الصف ${rowNumber}.`);
  }
  const cents = Math.round(number * 100);
  if (Math.abs(number * 100 - cents) > 1e-7) {
    throw workbookError(`السعر الإجمالي في الصف ${rowNumber} يجب ألا يتجاوز منزلتين عشريتين.`);
  }
  return cents / 100;
}

function parseQuantity(value, rowNumber) {
  const number = normalizedNumber(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw workbookError(`الكمية في الصف ${rowNumber} يجب أن تكون عدداً صحيحاً أكبر من صفر.`);
  }
  return number;
}

async function buildPackagesWorkbook(packages = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Slovan Sales Bot";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("الباكدجات", {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
    properties: { defaultRowHeight: 26 },
  });
  sheet.columns = [
    { header: PACKAGE_NAME_HEADER, key: "packageName", width: 24 },
    { header: PACKAGE_ITEM_HEADER, key: "itemName", width: 30 },
    { header: PACKAGE_QUANTITY_HEADER, key: "quantity", width: 12 },
    { header: PACKAGE_PRICE_HEADER, key: "totalPrice", width: 20 },
  ];
  for (const packageRow of packages) {
    packageRow.items.forEach((item, index) => sheet.addRow({
      packageName: index === 0 ? packageRow.package_name : null,
      itemName: item.item_name,
      quantity: item.quantity,
      totalPrice: index === 0 ? Number(packageRow.total_price) : null,
    }));
  }
  const header = sheet.getRow(1);
  header.height = 30;
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  header.alignment = { horizontal: "center", vertical: "middle" };
  header.eachCell((cell) => { cell.border = { top: { style: "medium", color: { argb: "FF115E59" } }, bottom: { style: "medium", color: { argb: "FF115E59" } } }; });
  sheet.getColumn(1).alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  sheet.getColumn(2).alignment = { horizontal: "right", vertical: "middle" };
  sheet.getColumn(3).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getColumn(4).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getColumn(3).numFmt = "#,##0";
  sheet.getColumn(4).numFmt = "#,##0.00 \"EGP\"";
  for (let row = 2; row <= MAX_PACKAGE_ROWS + 1; row += 1) {
    sheet.getCell(row, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCFBF1" } };
    sheet.getCell(row, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    sheet.getCell(row, 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    for (let column = 1; column <= 4; column += 1) {
      sheet.getCell(row, column).border = { top: { style: "thin", color: { argb: "FFB8C9D1" } }, bottom: { style: "thin", color: { argb: "FFB8C9D1" } }, left: { style: "thin", color: { argb: "FFB8C9D1" } }, right: { style: "thin", color: { argb: "FFB8C9D1" } } };
    }
    sheet.getCell(row, 3).dataValidation = { type: "whole", operator: "greaterThan", allowBlank: true, showErrorMessage: true, errorTitle: "كمية غير صحيحة", error: "أدخل عدداً صحيحاً أكبر من صفر.", formulae: [0] };
    sheet.getCell(row, 4).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, showErrorMessage: true, errorTitle: "سعر غير صحيح", error: "أدخل سعراً يساوي صفراً أو أكبر.", formulae: [0] };
  }
  sheet.autoFilter = { from: "A1", to: "D1" };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function parsePackagesWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); } catch { throw workbookError("تعذر قراءة الملف. تأكد أنه ملف Excel بصيغة .xlsx."); }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw workbookError("ملف Excel لا يحتوي على ورقة بيانات.");
  const expected = [PACKAGE_NAME_HEADER, PACKAGE_ITEM_HEADER, PACKAGE_QUANTITY_HEADER, PACKAGE_PRICE_HEADER];
  const actual = expected.map((_, index) => normalizeName(sheet.getCell(1, index + 1).text));
  if (actual.some((header, index) => header !== expected[index])) throw workbookError(`يجب أن يكون الصف الأول بالترتيب: ${expected.join(" | ")}.`);

  const packages = [];
  const packageNames = new Set();
  let current = null;
  let dataRows = 0;
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const packageName = normalizeName(sheet.getCell(rowNumber, 1).text);
    const itemName = normalizeName(sheet.getCell(rowNumber, 2).text);
    const rawQuantity = cellValue(sheet.getCell(rowNumber, 3));
    const rawPrice = cellValue(sheet.getCell(rowNumber, 4));
    const hasQuantity = rawQuantity !== null && rawQuantity !== undefined && String(rawQuantity).trim() !== "";
    const hasPrice = rawPrice !== null && rawPrice !== undefined && String(rawPrice).trim() !== "";
    if (!packageName && !itemName && !hasQuantity && !hasPrice) continue;
    dataRows += 1;
    if (dataRows > MAX_PACKAGE_ROWS) throw workbookError(`الحد الأقصى هو ${MAX_PACKAGE_ROWS} صف في الملف.`);

    if (packageName) {
      const key = packageName.toLocaleLowerCase("ar-EG");
      if (packageNames.has(key)) throw workbookError(`الباكدج «${packageName}» مكرر في الملف.`);
      if (!hasPrice) throw workbookError(`السعر الإجمالي للباكدج «${packageName}» مفقود في الصف ${rowNumber}.`);
      if (packageName.length > 200) throw workbookError(`اسم الباكدج في الصف ${rowNumber} أطول من 200 حرف.`);
      packageNames.add(key);
      current = { packageName, totalPrice: parsePrice(rawPrice, rowNumber), items: [], itemNames: new Set() };
      packages.push(current);
    } else {
      if (!current) throw workbookError(`اسم الباكدج مفقود في الصف ${rowNumber}.`);
      if (hasPrice) throw workbookError(`اكتب السعر الإجمالي في أول صف للباكدج فقط. الخطأ في الصف ${rowNumber}.`);
    }
    if (!itemName) throw workbookError(`اسم الصنف مفقود في الصف ${rowNumber}.`);
    if (!hasQuantity) throw workbookError(`الكمية مفقودة في الصف ${rowNumber}.`);
    if (itemName.length > 200) throw workbookError(`اسم الصنف في الصف ${rowNumber} أطول من 200 حرف.`);
    const itemKey = itemName.toLocaleLowerCase("ar-EG");
    if (current.itemNames.has(itemKey)) throw workbookError(`الصنف «${itemName}» مكرر داخل الباكدج «${current.packageName}».`);
    current.itemNames.add(itemKey);
    current.items.push({ itemName, quantity: parseQuantity(rawQuantity, rowNumber) });
  }
  return packages.map(({ itemNames, ...packageRow }) => packageRow);
}

module.exports = { PACKAGE_NAME_HEADER, PACKAGE_ITEM_HEADER, PACKAGE_QUANTITY_HEADER, PACKAGE_PRICE_HEADER, MAX_PACKAGE_ROWS, buildPackagesWorkbook, parsePackagesWorkbook };
