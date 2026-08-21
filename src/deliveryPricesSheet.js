"use strict";

const ExcelJS = require("exceljs");
const { normalizeDigits, normalizeName } = require("./utils");

const AREA_HEADER = "المحافظة\\المنطقه";
const PRICE_HEADER = "سعر الشحن";
const MAX_DELIVERY_PRICE_ROWS = 1000;
const MAX_DELIVERY_PRICE = 9_999_999_999.99;

function workbookError(message) {
  const error = new Error(message);
  error.isDeliveryPricesValidationError = true;
  return error;
}

function cellValue(cell) {
  const value = cell.value;
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value;
}

function parsePrice(value, rowNumber) {
  const normalized = typeof value === "number"
    ? value
    : Number(
        normalizeDigits(String(value ?? ""))
          .replace(/[٬,]/g, "")
          .replace(/٫/g, ".")
          .trim(),
      );

  if (!Number.isFinite(normalized) || normalized < 0 || normalized > MAX_DELIVERY_PRICE) {
    throw workbookError(`قيمة سعر الشحن غير صحيحة في الصف ${rowNumber}.`);
  }

  const cents = Math.round(normalized * 100);
  if (Math.abs(normalized * 100 - cents) > 1e-7) {
    throw workbookError(`قيمة سعر الشحن في الصف ${rowNumber} يجب ألا تتجاوز منزلتين عشريتين.`);
  }
  return cents / 100;
}

async function buildDeliveryPricesWorkbook(rows = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Slovan Sales Bot";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("أسعار الشحن", {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
    properties: { defaultRowHeight: 20 },
  });
  sheet.columns = [
    { header: AREA_HEADER, key: "areaName", width: 32 },
    { header: PRICE_HEADER, key: "price", width: 18 },
  ];

  for (const row of rows) {
    sheet.addRow({ areaName: row.area_name, price: Number(row.price) });
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
  sheet.getColumn(2).alignment = { horizontal: "right", vertical: "middle" };
  sheet.getColumn(2).numFmt = "#,##0.00";
  sheet.autoFilter = { from: "A1", to: "B1" };

  for (let rowNumber = 2; rowNumber <= MAX_DELIVERY_PRICE_ROWS + 1; rowNumber += 1) {
    sheet.getCell(rowNumber, 2).dataValidation = {
      type: "decimal",
      operator: "greaterThanOrEqual",
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "قيمة غير صحيحة",
      error: "أدخل سعرًا رقميًا يساوي صفرًا أو أكبر.",
      formulae: [0],
    };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function parseDeliveryPricesWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw workbookError("تعذر قراءة الملف. تأكد أنه ملف Excel بصيغة .xlsx.");
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw workbookError("ملف Excel لا يحتوي على ورقة بيانات.");

  const areaHeader = normalizeName(sheet.getCell(1, 1).text);
  const priceHeader = normalizeName(sheet.getCell(1, 2).text).toLowerCase();
  if (areaHeader !== AREA_HEADER || priceHeader !== PRICE_HEADER) {
    throw workbookError(`يجب أن يكون الصف الأول بالترتيب: ${AREA_HEADER} ثم ${PRICE_HEADER}.`);
  }

  const rows = [];
  const seenAreas = new Set();
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const areaCell = sheet.getCell(rowNumber, 1);
    const priceCell = sheet.getCell(rowNumber, 2);
    const areaName = normalizeName(areaCell.text);
    const rawPrice = cellValue(priceCell);
    const hasPrice = rawPrice !== null && rawPrice !== undefined && String(rawPrice).trim() !== "";

    if (!areaName && !hasPrice) continue;
    if (!areaName) throw workbookError(`اسم المحافظة أو المنطقة مفقود في الصف ${rowNumber}.`);
    if (areaName.length > 200) throw workbookError(`اسم المنطقة في الصف ${rowNumber} أطول من 200 حرف.`);
    if (!hasPrice) throw workbookError(`قيمة سعر الشحن مفقودة في الصف ${rowNumber}.`);

    const areaKey = areaName.toLocaleLowerCase("ar-EG");
    if (seenAreas.has(areaKey)) {
      throw workbookError(`المنطقة «${areaName}» مكررة في الملف.`);
    }
    seenAreas.add(areaKey);

    rows.push({ areaName, price: parsePrice(rawPrice, rowNumber) });
    if (rows.length > MAX_DELIVERY_PRICE_ROWS) {
      throw workbookError(`الحد الأقصى هو ${MAX_DELIVERY_PRICE_ROWS} منطقة في الملف.`);
    }
  }

  return rows;
}

module.exports = {
  AREA_HEADER,
  MAX_DELIVERY_PRICE_ROWS,
  PRICE_HEADER,
  buildDeliveryPricesWorkbook,
  parseDeliveryPricesWorkbook,
};
