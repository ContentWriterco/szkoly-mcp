import { test } from "node:test";
import assert from "node:assert/strict";
import { titleCase } from "../dist/schools.js";
import { parseE8, parseMatura } from "../dist/data.js";

test("school names: title case with Roman numerals and small words", () => {
  assert.equal(titleCase("SZKOŁA PODSTAWOWA NR 82 IM. KSIĘCIA PRZEMYSŁA I"), "Szkoła Podstawowa nr 82 im. Księcia Przemysła I");
  assert.equal(titleCase("XXXVIII DWUJĘZYCZNE LICEUM OGÓLNOKSZTAŁCĄCE"), "XXXVIII Dwujęzyczne Liceum Ogólnokształcące");
  assert.equal(titleCase("SZKOŁA PODSTAWOWA I GIMNAZJUM"), "Szkoła Podstawowa i Gimnazjum");
  assert.equal(titleCase("Już Ładnie"), "Już Ładnie");
});

// tiny stored-zip writer to build an .xlsx in memory
function zip(files) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = [], centrals = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), nm = Buffer.from(name), c = crc(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(c, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); centrals.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}


function workbook(rows) {
  const cell = (v) => (v === "" ? "<c/>" : typeof v === "number" ? `<c><v>${v}</v></c>` : `<c t="inlineStr"><is><t>${v}</t></is></c>`);
  const sheet = `<worksheet><sheetData>${rows.map((r) => `<row>${r.map(cell).join("")}</row>`).join("")}</sheetData></worksheet>`;
  return zip({
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="SAS" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheet,
  });
}

test("eighth-grade exam file -> per-school averages", () => {
  const buf = workbook([
    ["", "", "język polski", "", "matematyka", ""],
    ["Nazwa", "RSPO", "liczba zdających", "wynik średni (%)", "liczba zdających", "wynik średni (%)"],
    ["SP 1", 70079, 76, 60.25, 76, 55.4],
    ["SP 2", 70077, 3, "", "", ""],
  ]);
  const r = parseE8(buf);
  assert.deepEqual(r[70079], { "język polski": [76, 60.3], matematyka: [76, 55.4] });
  assert.equal(r[70077], undefined);
});

test("matura file -> pass rate and subject averages", () => {
  const buf = workbook([
    ["", "", "egzaminy obowiazkowe", "", "", "", ""],
    ["", "", "dla całego egzaminu dojrzałości", "", "matematyka poziom podstawowy (M)", "", ""],
    ["RSPO szkoły", "Nazwa", "* Otrzymali świadectwo", "* zdawalność (%)", "* liczba zdających", "* zdawalność (%)", "średni wynik (%)"],
    [4117, "LO", 90, 100, 90, 100, 72.4],
  ]);
  const r = parseMatura(buf);
  assert.equal(r[4117]["egzamin (całość)"][2], 100);
  assert.deepEqual(r[4117]["matematyka poziom podstawowy (M)"].slice(0, 3), [90, 72.4, 100]);
});
