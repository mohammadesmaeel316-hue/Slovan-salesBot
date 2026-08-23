"use strict";

const ExcelJS = require("exceljs");

const SUMMARY_HEADERS = [
  "رقم الأوردر", "الحالة", "مصدر الأوردر", "اسم ولي الأمر", "رقم الموبايل", "موبايل ٢", "موبايل ٣",
  "منطقة الشحن", "العنوان", "عدد الأطفال", "عدد بنود الطلب", "إجمالي المنتجات", "نوع الخصم", "قيمة الخصم",
  "قيمة الخصم الفعلية", "سعر الشحن", "إجمالي الأوردر", "الدفعة المقدمة", "تفاصيل الدفعة", "المتبقي",
  "ملاحظات", "اسم منشئ الأوردر", "Telegram ID المنشئ", "هاتف المنشئ", "تاريخ الإنشاء", "آخر تعديل",
];

const DETAIL_HEADERS = [
  "رقم الأوردر", "الحالة", "مصدر الأوردر", "اسم ولي الأمر", "رقم الموبايل", "موبايل ٢", "موبايل ٣",
  "اسم الطفل", "الشخصية", "المدرسة", "المرحلة الدراسية", "لون الليبل", "نوع الطلب", "الصنف / الباكدج",
  "الكمية", "سعر الوحدة", "إجمالي السطر", "نوع الخصم", "قيمة الخصم", "قيمة الخصم الفعلية", "اسم منشئ الأوردر", "Telegram ID المنشئ",
  "هاتف المنشئ", "العنوان", "ملاحظات", "منطقة الشحن", "سعر الشحن", "إجمالي الأوردر", "الدفعة المقدمة", "تفاصيل الدفعة", "المتبقي", "تاريخ الإنشاء", "آخر تعديل",
];

function formatDate(value) { return value ? new Date(value) : null; }
function discountLabel(value) { return value === "percent" ? "نسبة مئوية" : value === "fixed" ? "مبلغ ثابت" : ""; }
function numeric(value) { return value === null || value === undefined ? null : Number(value); }

function createSheet(workbook, name, headers, widths) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
    properties: { defaultRowHeight: 20 },
  });
  sheet.columns = headers.map((header, index) => ({ header, key: `column${index + 1}`, width: widths[index] }));
  return sheet;
}

function styleSheet(sheet, dateColumns, moneyColumns) {
  const header = sheet.getRow(1);
  header.height = 30;
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  header.eachCell((cell) => {
    cell.border = {
      top: { style: "medium", color: { argb: "FF115E59" } },
      bottom: { style: "medium", color: { argb: "FF115E59" } },
      left: { style: "thin", color: { argb: "FFD1D5DB" } },
      right: { style: "thin", color: { argb: "FFD1D5DB" } },
    };
  });
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: "middle", wrapText: true };
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
    });
    for (const column of dateColumns) row.getCell(column).numFmt = "yyyy-mm-dd hh:mm";
    for (const column of moneyColumns) row.getCell(column).numFmt = "#,##0.00";
  }
  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(sheet.columnCount).letter}${Math.max(1, sheet.rowCount)}` };
}

function summarizeOrders(rows) {
  const orders = new Map();
  for (const row of rows) {
    if (!orders.has(row.order_code)) orders.set(row.order_code, { row, children: new Set(), lines: new Set() });
    const summary = orders.get(row.order_code);
    if (row.child_position !== null && row.child_position !== undefined) summary.children.add(String(row.child_position));
    if (row.line_position !== null && row.line_position !== undefined) summary.lines.add(String(row.line_position));
  }
  return [...orders.values()];
}

async function buildOrdersWorkbook(rows = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Slovan Sales Bot";
  workbook.created = new Date();

  const summarySheet = createSheet(workbook, "ملخص الطلبات", SUMMARY_HEADERS,
    [22, 14, 16, 24, 18, 16, 16, 22, 28, 14, 16, 17, 15, 14, 18, 15, 17, 17, 24, 16, 28, 24, 18, 18, 20, 20]);
  for (const { row, children, lines } of summarizeOrders(rows)) {
    summarySheet.addRow({
      column1: row.order_code || "", column2: row.status === "cancelled" ? "ملغي" : "مؤكد", column3: row.source || "",
      column4: row.parent_name || "", column5: row.parent_phone || "", column6: row.parent_phone_2 || "", column7: row.parent_phone_3 || "",
      column8: row.delivery_area || "", column9: row.address || "", column10: children.size, column11: lines.size,
      column12: numeric(row.items_total), column13: discountLabel(row.discount_type), column14: numeric(row.discount_value),
      column15: numeric(row.discount_amount), column16: numeric(row.shipping_price), column17: numeric(row.grand_total),
      column18: numeric(row.advance_payment), column19: row.advance_payment_details || "",
      column20: Math.max(0, Number(row.grand_total || 0) - Number(row.advance_payment || 0)), column21: row.notes || "",
      column22: row.creator_name || "غير مسجل", column23: row.created_by || "", column24: row.creator_phone || "",
      column25: formatDate(row.created_at), column26: formatDate(row.updated_at),
    });
  }
  styleSheet(summarySheet, [25, 26], [12, 14, 15, 16, 17, 18, 20]);

  const detailsSheet = createSheet(workbook, "تفاصيل الطلبات", DETAIL_HEADERS,
    [22, 14, 16, 24, 18, 16, 16, 24, 20, 24, 18, 18, 14, 28, 12, 15, 16, 15, 14, 17, 24, 18, 18, 24, 28, 22, 15, 16, 16, 24, 16, 20, 20]);
  for (const row of rows) {
    detailsSheet.addRow({
      column1: row.order_code || "", column2: row.status === "cancelled" ? "ملغي" : "مؤكد", column3: row.source || "",
      column4: row.parent_name || "", column5: row.parent_phone || "", column6: row.parent_phone_2 || "", column7: row.parent_phone_3 || "",
      column8: row.child_name || "", column9: row.cartoon_character || "", column10: row.school_name || "", column11: row.school_stage || "", column12: row.clothing_label_color || "",
      column13: row.line_type === "package" ? "باكدج" : row.line_type === "item" ? "صنف عادي" : "", column14: row.description || "",
      column15: numeric(row.quantity), column16: numeric(row.unit_price), column17: numeric(row.line_total), column18: discountLabel(row.discount_type),
      column19: numeric(row.discount_value), column20: numeric(row.discount_amount), column21: row.creator_name || "غير مسجل",
      column22: row.created_by || "", column23: row.creator_phone || "", column24: row.address || "", column25: row.notes || "",
      column26: row.delivery_area || "", column27: numeric(row.shipping_price), column28: numeric(row.grand_total),
      column29: numeric(row.advance_payment), column30: row.advance_payment_details || "",
      column31: Math.max(0, Number(row.grand_total || 0) - Number(row.advance_payment || 0)),
      column32: formatDate(row.created_at), column33: formatDate(row.updated_at),
    });
  }
  styleSheet(detailsSheet, [32, 33], [16, 17, 19, 20, 27, 28, 29, 31]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { DETAIL_HEADERS, SUMMARY_HEADERS, buildOrdersWorkbook };
