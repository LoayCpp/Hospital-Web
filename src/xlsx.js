(function (root, factory) {
  "use strict";
  const api = factory(root && root.JSZip);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HCTXlsx = api;
})(typeof window !== "undefined" ? window : globalThis, function (BrowserZip) {
  "use strict";

  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const STYLE = Object.freeze({
    normal: 0,
    title: 1,
    section: 2,
    header: 3,
    integer: 4,
    decimal: 5,
    percent: 6,
    date: 7,
    time: 8,
    text: 9,
    success: 10,
    warning: 11,
    danger: 12,
    muted: 13,
  });

  function xml(value) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
      })[char]);
  }

  function colName(index) {
    let n = index + 1;
    let out = "";
    while (n > 0) {
      const remainder = (n - 1) % 26;
      out = String.fromCharCode(65 + remainder) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function excelDate(value) {
    if (value instanceof Date) return value.getTime() / 86400000 + 25569;
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.getTime() / 86400000 + 25569;
  }

  function excelTime(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
    return (hours * 60 + mins) / 1440;
  }

  function cellXml(value, rowIndex, colIndex) {
    const address = `${colName(colIndex)}${rowIndex}`;
    const cell = value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)
      ? value
      : { value };
    const style = Number.isInteger(cell.style) ? ` s="${cell.style}"` : "";
    let raw = cell.value;
    if (raw === undefined || raw === null || raw === "") {
      return cell.style == null ? "" : `<c r="${address}"${style}/>`;
    }
    if (cell.type === "date" || raw instanceof Date) {
      const serial = excelDate(raw);
      return serial == null ? `<c r="${address}" t="inlineStr"${style}><is><t>${xml(raw)}</t></is></c>` : `<c r="${address}"${style || ` s="${STYLE.date}"`}><v>${serial}</v></c>`;
    }
    if (cell.type === "time") {
      const serial = excelTime(raw);
      return serial == null ? `<c r="${address}" t="inlineStr"${style}><is><t>${xml(raw)}</t></is></c>` : `<c r="${address}"${style || ` s="${STYLE.time}"`}><v>${serial}</v></c>`;
    }
    if (cell.type === "formula") {
      const cached = Number.isFinite(cell.result) ? `<v>${cell.result}</v>` : "";
      return `<c r="${address}"${style}><f>${xml(raw)}</f>${cached}</c>`;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) return `<c r="${address}"${style}><v>${raw}</v></c>`;
    if (typeof raw === "boolean") return `<c r="${address}" t="b"${style}><v>${raw ? 1 : 0}</v></c>`;
    const text = String(raw);
    const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : "";
    return `<c r="${address}" t="inlineStr"${style}><is><t${preserve}>${xml(text)}</t></is></c>`;
  }

  function sheetXml(sheet) {
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const maxCols = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    const dimension = maxCols && rows.length ? `A1:${colName(maxCols - 1)}${rows.length}` : "A1";
    const cols = (sheet.widths || []).map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Number(width) || 10}" customWidth="1"/>`).join("");
    const freezeRows = Number(sheet.freezeRows || 0);
    const freezeCols = Number(sheet.freezeCols || 0);
    const topLeft = `${colName(freezeCols)}${freezeRows + 1}`;
    const activePane = freezeRows && freezeCols ? "bottomRight" : freezeCols ? "topRight" : "bottomLeft";
    const pane = freezeRows || freezeCols
      ? `<pane${freezeCols ? ` xSplit="${freezeCols}"` : ""}${freezeRows ? ` ySplit="${freezeRows}"` : ""} topLeftCell="${topLeft}" activePane="${activePane}" state="frozen"/>`
      : "";
    const rowHeights = sheet.rowHeights || {};
    const body = rows.map((row, r) => {
      const rowNumber = r + 1;
      const height = rowHeights[rowNumber];
      const cells = (row || []).map((value, c) => cellXml(value, rowNumber, c)).join("");
      return `<row r="${rowNumber}"${height ? ` ht="${Number(height)}" customHeight="1"` : ""}>${cells}</row>`;
    }).join("");
    const merges = Array.isArray(sheet.merges) && sheet.merges.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${xml(ref)}"/>`).join("")}</mergeCells>`
      : "";
    const autoFilter = sheet.autoFilter ? `<autoFilter ref="${xml(sheet.autoFilter)}"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0">${pane}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="19"/>
  ${cols ? `<cols>${cols}</cols>` : ""}
  <sheetData>${body}</sheetData>
  ${autoFilter}${merges}
  <pageMargins left="0.3" right="0.3" top="0.45" bottom="0.45" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="4">
    <numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>
    <numFmt numFmtId="165" formatCode="0.0%"/>
    <numFmt numFmtId="166" formatCode="hh:mm"/>
    <numFmt numFmtId="167" formatCode="#,##0.0"/>
  </numFmts>
  <fonts count="7">
    <font><sz val="11"/><color rgb="FF0E2A3B"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF0E2A3B"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF1E5E3C"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF8A6410"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF8E3826"/><name val="Arial"/><family val="2"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0E2A3B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0E7C7B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEDE9DC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEBDF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7ECCF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF5DDD6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFE1DDD0"/></left><right style="thin"><color rgb="FFE1DDD0"/></right><top style="thin"><color rgb="FFE1DDD0"/></top><bottom style="thin"><color rgb="FFE1DDD0"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="7" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function sanitizeSheetName(value, used) {
    const base = String(value || "ورقة").replace(/[\\/*?:\[\]]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "ورقة";
    let name = base;
    let suffix = 2;
    while (used.has(name.toLocaleLowerCase("en-US"))) {
      const end = ` ${suffix++}`;
      name = `${base.slice(0, 31 - end.length)}${end}`;
    }
    used.add(name.toLocaleLowerCase("en-US"));
    return name;
  }

  async function createWorkbook(sheets, options = {}) {
    const Zip = BrowserZip || (typeof require === "function" ? require("../assets/vendor/jszip.min.js") : null);
    if (!Zip) throw new Error("مكوّن Excel غير متاح");
    const validSheets = (sheets || []).filter((sheet) => sheet && Array.isArray(sheet.rows));
    if (!validSheets.length) throw new Error("لا توجد بيانات لتصديرها");
    const used = new Set();
    const normalized = validSheets.map((sheet) => ({ ...sheet, safeName: sanitizeSheetName(sheet.name, used) }));
    const zip = new Zip();
    const sheetOverrides = normalized.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheetOverrides}
</Types>`);
    zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
    const timestamp = new Date().toISOString();
    zip.folder("docProps").file("core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xml(options.title || "متابعة الحالات الحرجة والوفاة الدماغية")}</dc:title>
  <dc:creator>${xml(options.creator || "تجمع القصيم الصحي")}</dc:creator>
  <cp:lastModifiedBy>${xml(options.creator || "تجمع القصيم الصحي")}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`);
    zip.folder("docProps").file("app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>متابعة الحالات الحرجة</Application><AppVersion>1.0</AppVersion></Properties>`);
    const workbookSheets = normalized.map((sheet, index) => `<sheet name="${xml(sheet.safeName)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
    zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="0"/></bookViews>
  <sheets>${workbookSheets}</sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`);
    const workbookRels = normalized.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
    zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${normalized.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.folder("xl").file("styles.xml", stylesXml());
    const worksheets = zip.folder("xl").folder("worksheets");
    normalized.forEach((sheet, index) => worksheets.file(`sheet${index + 1}.xml`, sheetXml(sheet)));
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: MIME });
  }

  function workbookBlob(bytes) {
    return new Blob([bytes], { type: MIME });
  }

  return { MIME, STYLE, createWorkbook, workbookBlob, excelDate, excelTime, colName };
});
