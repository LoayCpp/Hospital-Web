const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("../assets/vendor/jszip.min.js");
const X = require("../src/xlsx.js");

test("ينشئ ملف XLSX صالحًا متعدد الأوراق وباتجاه RTL", async () => {
  const bytes = await X.createWorkbook([
    {
      name: "ملخص سبتمبر 2026",
      rows: [
        [{ value: "ملخص الأداء", style: X.STYLE.title }],
        [
          { value: "النسبة", style: X.STYLE.header },
          { value: "التاريخ", style: X.STYLE.header },
          { value: "الوقت", style: X.STYLE.header },
        ],
        [
          { value: 0.65, style: X.STYLE.percent },
          { value: "2026-09-10", style: X.STYLE.date, type: "date" },
          { value: "10:30", style: X.STYLE.time, type: "time" },
        ],
      ],
      freezeRows: 2,
      freezeCols: 1,
      merges: ["A1:C1"],
      autoFilter: "A2:C3",
    },
    { name: "السجل", rows: [["المستشفى", "الدرجة"], ["مستشفى تجريبي", 100]] },
  ], { title: "اختبار التقرير", creator: "تجمع القصيم الصحي" });

  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.byteLength > 2000);
  const zip = await JSZip.loadAsync(bytes);
  const required = [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
  ];
  required.forEach((path) => assert.ok(zip.file(path), `ملف OpenXML مفقود: ${path}`));

  const workbook = await zip.file("xl/workbook.xml").async("string");
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(workbook, /name="ملخص سبتمبر 2026"/);
  assert.match(workbook, /name="السجل"/);
  assert.match(sheet, /rightToLeft="1"/);
  assert.match(sheet, /activePane="bottomRight"/);
  assert.match(sheet, /mergeCell ref="A1:C1"/);
  assert.match(sheet, /autoFilter ref="A2:C3"/);
  assert.match(sheet, /<c r="A3" s="6"><v>0\.65<\/v><\/c>/);
  assert.match(sheet, /<c r="B3" s="7"><v>46275<\/v><\/c>/);
  assert.match(sheet, /<c r="C3" s="8"><v>0\.4375<\/v><\/c>/);
});

test("يُنقّي أسماء الأوراق ويمنع التكرار", async () => {
  const bytes = await X.createWorkbook([
    { name: "'Data/يومي'", rows: [[1]] },
    { name: "data/يومي", rows: [[2]] },
  ]);
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await zip.file("xl/workbook.xml").async("string");
  assert.match(workbook, /name="Data يومي"/);
  assert.match(workbook, /name="data يومي 2"/);
});

test("يرفض تحويل الأوقات غير الصالحة إلى أرقام Excel", () => {
  assert.equal(X.excelTime("23:59"), 1439 / 1440);
  assert.equal(X.excelTime("24:00"), null);
  assert.equal(X.excelTime("12:60"), null);
});

test("يرفض تحويل التواريخ غير الصالحة إلى أرقام Excel", () => {
  assert.equal(X.excelDate("2026-02-28"), 46081);
  assert.equal(X.excelDate("2026-02-30"), null);
  assert.equal(X.excelDate("2026-13-01"), null);
});
