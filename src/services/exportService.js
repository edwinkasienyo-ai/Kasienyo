const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

function sendSimplePdf(res, title, rows) {
  const doc = new PDFDocument({ margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${title}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).text(title, { underline: true });
  doc.moveDown();

  rows.forEach((row, index) => {
    doc.fontSize(11).text(`${index + 1}. ${row}`);
  });

  doc.end();
}

async function sendSimpleExcel(res, sheetName, headers, dataRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  dataRows.forEach((row) => sheet.addRow(row));

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${sheetName}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

module.exports = { sendSimplePdf, sendSimpleExcel };
