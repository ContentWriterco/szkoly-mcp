import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, log } from "./config.js";
import { streamXlsx } from "./xlsxstream.js";

export interface School {
  rspo: number;
  name: string;
  typeId: number;
  type: string;
  pub: string;
  cat: string;
  spec: string;
  town: string;
  street: string;
  house: string;
  postal: string;
  gmina: string;
  gminaType: string;
  teryt: string;
  powiat: string;
  woj: string;
  www: string;
  organ: string;
  parent: number;
  students: number;
  teachers: number;
}

/** subject -> [takers, average %] (E8) or [takers, average %, pass %] (matura) */
export type Scores = Record<string, number[]>;
export type ExamYears = Record<string, Record<number, Scores>>; // year -> rspo -> scores

export interface Dataset {
  schools: School[];
  byRspo: Map<number, School>;
  e8: ExamYears;
  matura: ExamYears;
  /** exam|year|subject -> [takers, avg] for Poland, and exam|year|subject|woj|powiat */
  agg: Map<string, [number, number]>;
  sources: { sio: string; e8: string[]; matura: string[] };
  loadedAt: string;
}

// school types worth showing to parents (SIO "Typ podmiotu" ids)
const TYPES = new Set([1, 3, 14, 16, 19, 21, 24, 27, 80, 81, 85, 86, 93, 94]);

const n = (s: string | undefined) => {
  const v = Number(String(s ?? "").replace(",", "."));
  return Number.isFinite(v) && String(s ?? "").trim() !== "" ? v : NaN;
};
const own = (s: string) => (s ? Buffer.from(s, "utf8").toString("utf8") : "");

async function fetchBuf(url: string, ms = 180_000): Promise<Buffer> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "user-agent": config.userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------------ SIO school list

export function parseSio(buf: Buffer): School[] {
  const out: School[] = [];
  let col: Record<string, number> = {};
  streamXlsx(buf, () => (cells, i) => {
    if (i === 0) {
      col = Object.fromEntries(cells.map((h, j) => [h.trim().toLowerCase(), j]));
      return;
    }
    const g = (name: string) => cells[col[name.toLowerCase()]] ?? "";
    const typeId = n(g("idTypPodmiotu"));
    if (!TYPES.has(typeId)) return;
    const rspo = n(g("RSPO"));
    if (!Number.isFinite(rspo)) return;
    out.push({
      rspo,
      name: own(g("Nazwa placówki")),
      typeId,
      type: own(g("Typ podmiotu")),
      pub: own(g("Publiczność")),
      cat: own(g("Kategoria uczniów")),
      spec: own(g("Specyfika szkoły")),
      town: own(g("Miejscowość")),
      street: own(g("Ulica")),
      house: own(g("Numer domu")),
      postal: own(g("Kod pocztowy")),
      gmina: own(g("Gmina")),
      gminaType: own(g("Typ gminy")),
      teryt: own(g("idTerytGmina")),
      powiat: own(g("Powiat")),
      woj: own(g("Wojewodztwo")),
      www: own(g("Adres www")),
      organ: own(g("Organ prowadzący")),
      parent: n(g("idPodmiotNadrzedny")) || 0,
      students: n(g("ucz_ogolem")),
      teachers: n(g("lb_naucz_osoby")),
    });
  });
  return out;
}

// ------------------------------------------------------------------ exam results (Mapa wyników egzaminów)

/** E8: row 0 = subject over 5 columns, row 1 = labels; RSPO column in labels. */
export function parseE8(buf: Buffer): Record<number, Scores> {
  const out: Record<number, Scores> = {};
  let subjRow: string[] = [];
  let head: string[] = [];
  let rspoCol = -1;
  let blocks: { subj: string; nCol: number; avgCol: number }[] = [];
  let sheetDone = false;
  streamXlsx(buf, (name) => {
    if (sheetDone || /legenda/i.test(name)) return null;
    return (cells, i) => {
      if (rspoCol < 0) {
        if (cells.some((c) => /^RSPO/i.test(c.trim()))) {
          head = cells.map((c) => c.trim().toLowerCase());
          rspoCol = head.findIndex((c) => c.startsWith("rspo"));
          let cur = "";
          blocks = [];
          for (let j = 0; j < head.length; j++) {
            if (subjRow[j]?.trim()) cur = subjRow[j].trim();
            if (head[j].startsWith("liczba zdających") && cur) blocks.push({ subj: cur, nCol: j, avgCol: head.findIndex((h, k) => k > j && h.startsWith("wynik średni")) });
          }
        } else subjRow = cells;
        return;
      }
      sheetDone = true;
      const rspo = n(cells[rspoCol]);
      if (!Number.isFinite(rspo)) return;
      const sc: Scores = {};
      for (const b of blocks) {
        const cnt = n(cells[b.nCol]);
        const avg = n(cells[b.avgCol]);
        if (cnt > 0 && Number.isFinite(avg)) sc[b.subj] = [cnt, Math.round(avg * 10) / 10];
      }
      if (Object.keys(sc).length) out[rspo] = sc;
    };
  });
  return out;
}

/** Matura (formula 2023): rows 0-1 = groups / subjects, row 2 = labels. */
export function parseMatura(buf: Buffer): Record<number, Scores> {
  const out: Record<number, Scores> = {};
  const pre: string[][] = [];
  let rspoCol = -1;
  let cols: { subj: string; kind: "n" | "avg" | "pass" | "cert" }[] = [];
  let sheetDone = false;
  streamXlsx(buf, (name) => {
    if (sheetDone || /legenda/i.test(name)) return null;
    return (cells) => {
      if (rspoCol < 0) {
        if (cells.some((c) => /^RSPO/i.test(c.trim()))) {
          const head = cells.map((c) => c.trim().toLowerCase());
          rspoCol = head.findIndex((c) => c.startsWith("rspo"));
          const subjRow = pre[pre.length - 1] ?? [];
          let cur = "";
          cols = head.map((h, j) => {
            if (subjRow[j]?.trim() && subjRow[j].trim() !== ".") cur = subjRow[j].trim();
            const k: "n" | "avg" | "pass" | "cert" | undefined = /otrzymali świadectwo/.test(h)
              ? "cert"
              : /liczba zdających/.test(h)
                ? "n"
                : /zdawalność/.test(h)
                  ? "pass"
                  : /średni wynik/.test(h)
                    ? "avg"
                    : undefined;
            return { subj: j > rspoCol ? cur : "", kind: (k ?? "x") as "n" };
          });
        } else pre.push(cells);
        return;
      }
      sheetDone = true;
      const rspo = n(cells[rspoCol]);
      if (!Number.isFinite(rspo)) return;
      const sc: Scores = {};
      cols.forEach((c, j) => {
        if (!c.subj || !["n", "avg", "pass", "cert"].includes(c.kind)) return;
        const v = n(cells[j]);
        if (!Number.isFinite(v)) return;
        const key = /całego egzaminu/i.test(c.subj) ? "egzamin (całość)" : c.subj;
        const arr = (sc[key] ??= [NaN, NaN, NaN, NaN]);
        const idx = { n: 0, avg: 1, pass: 2, cert: 3 }[c.kind as "n"];
        if (Number.isNaN(arr[idx])) arr[idx] = Math.round(v * 10) / 10;
      });
      for (const [k, v] of Object.entries(sc)) if (!(v[0] > 0) && !(v[3] > 0)) delete sc[k];
      // a school appears once per RSPO; merge if repeated (several identifiers)
      if (Object.keys(sc).length) out[rspo] = { ...(out[rspo] ?? {}), ...sc };
    };
  });
  return out;
}

interface Meta {
  declarationTypes: { id: string; supportedYears: string[] }[];
  downloads: Record<string, Record<string, { code: string; date: string }[]>>;
}

/** URLs of the newest per-school result file for each year. */
export async function examFiles(type: "E8" | "EM2023", years: number): Promise<{ year: string; url: string }[]> {
  const meta = JSON.parse((await fetchBuf(`${config.examBase}/assets/metadata/metadata.json`, 30_000)).toString("utf8")) as Meta;
  const supported = meta.declarationTypes.find((t) => t.id === type)?.supportedYears ?? [];
  const out: { year: string; url: string }[] = [];
  for (const y of [...supported].sort().reverse().slice(0, years)) {
    const files = (meta.downloads[type]?.[y] ?? []).filter((f) => f.code === "szkoly");
    const best = files.map((f) => f.date.split(".")[0]).sort().pop();
    if (best) out.push({ year: y, url: `${config.examBase}/assets/data/CSV/${type}/${y}/${type}_${y}_szkoly_${best}.xlsx` });
  }
  return out;
}

async function sioUrl(): Promise<string> {
  if (config.sioUrl) return config.sioUrl;
  const j = JSON.parse((await fetchBuf(config.sioDatasetApi, 30_000)).toString("utf8")) as { data: { attributes: { format?: string; file_url?: string; link?: string; title?: string } }[] };
  const r = j.data.find((x) => /xlsx/i.test(x.attributes.format ?? "") && /wykaz/i.test(x.attributes.title ?? ""));
  const u = r?.attributes.file_url ?? r?.attributes.link;
  if (!u) throw new Error("SIO school list not found on dane.gov.pl");
  return u;
}

// ------------------------------------------------------------------ cache

interface Compact {
  version: 1;
  sources: Dataset["sources"];
  schools: School[];
  e8: ExamYears;
  matura: ExamYears;
}

let current: Dataset | null = null;
let loading: Promise<Dataset> | null = null;

const cachePath = () => join(config.dataDir, "data-v1.json");

async function ageHours(p: string): Promise<number> {
  try {
    return (Date.now() - (await stat(p)).mtimeMs) / 3_600_000;
  } catch {
    return Infinity;
  }
}

function aggregate(schools: Map<number, School>, e8: ExamYears, matura: ExamYears): Dataset["agg"] {
  const agg = new Map<string, [number, number]>();
  const add = (key: string, cnt: number, avg: number) => {
    const a = agg.get(key) ?? [0, 0];
    a[1] = (a[1] * a[0] + avg * cnt) / (a[0] + cnt);
    a[0] += cnt;
    agg.set(key, a);
  };
  for (const [exam, data] of [["E8", e8], ["M", matura]] as const)
    for (const [year, bySchool] of Object.entries(data))
      for (const [rspo, sc] of Object.entries(bySchool)) {
        const s = schools.get(+rspo);
        for (const [subj, v] of Object.entries(sc)) {
          if (!(v[0] > 0) || !Number.isFinite(v[1])) continue;
          add(`${exam}|${year}|${subj}`, v[0], v[1]);
          if (s) add(`${exam}|${year}|${subj}|${s.woj.toLowerCase()}|${s.powiat.toLowerCase()}`, v[0], v[1]);
        }
      }
  return agg;
}

async function build(force: boolean): Promise<Dataset> {
  await mkdir(config.dataDir, { recursive: true });
  let c: Compact | null = null;
  try {
    c = JSON.parse(await readFile(cachePath(), "utf8")) as Compact;
  } catch {}
  if (!c || force || (await ageHours(cachePath())) > config.refreshHours) {
    try {
      const [sio, e8f, emf] = await Promise.all([sioUrl(), examFiles("E8", config.e8Years), examFiles("EM2023", config.maturaYears)]);
      const same = c && c.sources.sio === sio && JSON.stringify(c.sources.e8) === JSON.stringify(e8f.map((f) => f.url)) && JSON.stringify(c.sources.matura) === JSON.stringify(emf.map((f) => f.url));
      if (!same) {
        log("info", "downloading school list and exam results…");
        const schools = parseSio(await fetchBuf(sio));
        const e8: ExamYears = {};
        for (const f of e8f) e8[f.year] = parseE8(await fetchBuf(f.url));
        const matura: ExamYears = {};
        for (const f of emf) matura[f.year] = parseMatura(await fetchBuf(f.url));
        c = { version: 1, sources: { sio, e8: e8f.map((f) => f.url), matura: emf.map((f) => f.url) }, schools, e8, matura };
        await writeFile(cachePath() + ".tmp", JSON.stringify(c));
        await rename(cachePath() + ".tmp", cachePath());
        log("info", `data: ${schools.length} schools, E8 ${Object.keys(e8).join(",")}, matura ${Object.keys(matura).join(",")}`);
      } else {
        const now = new Date();
        await (await import("node:fs/promises")).utimes(cachePath(), now, now);
      }
    } catch (e) {
      log("warn", `update failed: ${(e as Error).message}`);
      if (!c) throw e;
    }
  }
  const byRspo = new Map(c!.schools.map((s) => [s.rspo, s]));
  return { schools: c!.schools, byRspo, e8: c!.e8, matura: c!.matura, agg: aggregate(byRspo, c!.e8, c!.matura), sources: c!.sources, loadedAt: new Date().toISOString() };
}

export async function data(): Promise<Dataset> {
  if (current) return current;
  loading ??= build(false).then((d) => (current = d)).finally(() => (loading = null));
  return loading;
}

export function startRefresh() {
  const t = setInterval(() => {
    build(false)
      .then((d) => (current = d))
      .catch((e) => log("warn", `refresh failed: ${(e as Error).message}`));
  }, Math.max(1, config.refreshHours) * 3_600_000);
  t.unref();
}
