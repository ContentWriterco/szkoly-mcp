import { unzip } from "./zip.js";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unesc = (s: string) =>
  s.indexOf("&") < 0 ? s : s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m)));

function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/**
 * Stream rows of every sheet of an .xlsx without turning the (often 100 MB+) sheet XML into one JS string.
 * onSheet(name) returns a row callback, or null to skip the sheet.
 */
export function streamXlsx(buf: Buffer, onSheet: (name: string) => ((cells: string[], rowIndex: number) => void) | null): void {
  const files = unzip(buf);
  const text = (name: string) => (files.get(name)?.toString("utf8") ?? "").replace(/<(\/?)[A-Za-z][\w.-]*:/g, "<$1");
  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml");
  if (ss) {
    // shared strings can be large too – scan the buffer
    let p = 0;
    for (;;) {
      const a = ss.indexOf("<si>", p);
      if (a < 0) break;
      const b = ss.indexOf("</si>", a);
      const si = ss.toString("utf8", a, b);
      let s = "";
      for (const m of si.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) s += m[1];
      shared.push(unesc(s));
      p = b + 5;
    }
    files.delete("xl/sharedStrings.xml");
  }
  const rels = new Map<string, string>();
  for (const m of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(m[0].match(/name="([^"]+)"/)?.[1] ?? "");
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1] ?? "";
    const cb = onSheet(name);
    const path = `xl/${rels.get(rid) ?? ""}`;
    const x = files.get(path);
    if (!cb || !x) continue;
    // namespace prefix, e.g. "x:" in <x:row>
    const sd = x.indexOf("sheetData");
    let pre = "";
    if (sd > 0) {
      const lt = x.lastIndexOf("<", sd);
      pre = x.toString("utf8", lt + 1, sd);
    }
    const ROW = Buffer.from(`<${pre}row`);
    const ROW_END = Buffer.from(`</${pre}row>`);
    let p = 0;
    let ri = 0;
    for (;;) {
      const a = x.indexOf(ROW, p);
      if (a < 0) break;
      const gt = x.indexOf(">", a);
      if (x[gt - 1] === 0x2f /* "/" */) {
        p = gt + 1;
        cb([], ri++);
        continue;
      }
      const b = x.indexOf(ROW_END, gt);
      if (b < 0) break;
      const row = x.toString("utf8", a, b).replace(/<(\/?)[A-Za-z][\w.-]*:/g, "<$1");
      const cells: string[] = [];
      for (const c of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
        const t = attrs.match(/t="(\w+)"/)?.[1];
        const body = c[2] ?? "";
        let v = "";
        if (t === "s") v = shared[+(body.match(/<v>([^<]*)<\/v>/)?.[1] ?? -1)] ?? "";
        else if (t === "inlineStr") v = unesc([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((y) => y[1]).join(""));
        else v = unesc(body.match(/<v>([^<]*)<\/v>/)?.[1] ?? "");
        const i = ref ? colIndex(ref) : cells.length;
        while (cells.length < i) cells.push("");
        cells[i] = v;
      }
      cb(cells, ri++);
      p = b + ROW_END.length;
    }
    files.delete(path);
  }
}
