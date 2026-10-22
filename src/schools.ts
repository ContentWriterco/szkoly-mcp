import { config, UserError } from "./config.js";
import { geocode } from "./geocode.js";
import { data, type Dataset, type School, type Scores } from "./data.js";

export type Level = "przedszkole" | "podstawowa" | "liceum" | "technikum" | "branzowa" | "policealna" | "artystyczna" | "dowolna";
const LEVEL_TYPES: Record<Exclude<Level, "dowolna">, number[]> = {
  przedszkole: [1, 80, 81],
  podstawowa: [3],
  liceum: [14],
  technikum: [16],
  branzowa: [93, 94],
  policealna: [19],
  artystyczna: [21, 24, 27, 85, 86],
};

const fold = (s: string) => s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
const pct = (v: number) => `${Math.round(v)}%`;
const E8_MAIN = ["język polski", "matematyka", "język angielski"];
const M_MAIN = ["język polski poziom podstawowy (M)", "matematyka poziom podstawowy (M)", "język angielski poziom podstawowy (M)"];
const short = (s: string) =>
  s
    .replace(/ poziom podstawowy \(M\)/, " pp")
    .replace(/ poziom rozszerzony \(M\)/, " rozsz.")
    .replace(/ poziom dwujęzyczny \(M\)/, " dwujęz.")
    .replace(/ ustny \(M\)/, " ustny")
    .replace(/^język /, "j. ");

function latestYear(exam: Dataset["e8"]): string | undefined {
  return Object.keys(exam).sort().pop();
}

function natAvg(d: Dataset, exam: "E8" | "M", year: string, subj: string): number | undefined {
  return d.agg.get(`${exam}|${year}|${subj}`)?.[1];
}
function powAvg(d: Dataset, exam: "E8" | "M", year: string, subj: string, s: School): number | undefined {
  return d.agg.get(`${exam}|${year}|${subj}|${s.woj.toLowerCase()}|${s.powiat.toLowerCase()}`)?.[1];
}

/** one-line exam summary for lists */
function examLine(d: Dataset, s: School): string {
  if (s.typeId === 3) {
    const y = latestYear(d.e8);
    const sc = y ? d.e8[y]?.[s.rspo] : undefined;
    if (!y || !sc) return "";
    const parts = E8_MAIN.filter((k) => sc[k]).map((k) => `${short(k).replace("j. ", "")} ${pct(sc[k][1])} (kraj ${pct(natAvg(d, "E8", y, k) ?? NaN)})`);
    return parts.length ? `Egzamin ósmoklasisty ${y} (${sc["język polski"]?.[0] ?? "?"} uczniów): ${parts.join(", ")}` : "";
  }
  if ([14, 16, 27].includes(s.typeId)) {
    const y = latestYear(d.matura);
    const sc = y ? d.matura[y]?.[s.rspo] : undefined;
    if (!y || !sc) return "";
    const all = sc["egzamin (całość)"];
    const parts = M_MAIN.filter((k) => sc[k] && Number.isFinite(sc[k][1])).map((k) => `${short(k)} ${pct(sc[k][1])}`);
    return `Matura ${y}: ${all ? `zdawalność ${pct(all[2])} (${all[0]} zdających)` : ""}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
  }
  return "";
}

function score(d: Dataset, s: School): number {
  if (s.typeId === 3) {
    const y = latestYear(d.e8);
    const sc = y ? d.e8[y]?.[s.rspo] : undefined;
    if (!sc) return -1;
    const v = E8_MAIN.map((k) => sc[k]?.[1]).filter((x): x is number => Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : -1;
  }
  const y = latestYear(d.matura);
  const sc = y ? d.matura[y]?.[s.rspo] : undefined;
  if (!sc) return -1;
  const v = M_MAIN.map((k) => sc[k]?.[1]).filter((x): x is number => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : -1;
}

// ------------------------------------------------------------------ geocoding school addresses (cached)

const geo = new Map<number, { lat: number; lon: number } | null>();
async function locateSchool(s: School): Promise<{ lat: number; lon: number } | null> {
  if (geo.has(s.rspo)) return geo.get(s.rspo)!;
  let r: { lat: number; lon: number } | null = null;
  const town = s.town.split("-")[0].trim();
  const street = s.street.replace(/^(ul\.|al\.|pl\.|os\.|rondo)\s*/i, "").trim();
  const last = street.split(/\s+/).pop() ?? "";
  const variants = street ? [`${town}, ${street} ${s.house}`, `${town}, ${last} ${s.house}`] : [`${town} ${s.house}`, town];
  for (const v of variants) {
    try {
      const p = (await geocode(v))[0];
      if (p && (p.precision === "address" || v === variants[variants.length - 1])) {
        r = { lat: p.lat, lon: p.lon };
        break;
      }
    } catch {
      /* next variant */
    }
  }
  geo.set(s.rspo, r);
  if (geo.size > 50_000) geo.delete(geo.keys().next().value!);
  return r;
}
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

/** "Poznań" also matches district towns like "Poznań-Grunwald"; a gmina name matches its villages */
function townMatch(s: School, f: string): boolean {
  return fold(s.town) === f || fold(s.town.split("-")[0]) === f || fold(s.gmina) === f;
}

// ------------------------------------------------------------------ find_schools

export interface FindQuery {
  place: string;
  level?: Level;
  publicOnly?: boolean;
  radiusKm?: number;
  sort?: "distance" | "results" | "name";
  max?: number;
}

function schoolLine(d: Dataset, s: School, dist?: number): string[] {
  const addr = `${s.street ? `${s.street} ${s.house}` : s.house}, ${s.postal} ${s.town}`.replace(/^ ,/, "").trim();
  const head = `${titleCase(s.name)} · ${s.type.toLowerCase()} · ${s.pub}${s.cat && !/dzieci lub młodzież|bez kategorii/i.test(s.cat) ? ` · ${s.cat.toLowerCase()}` : ""}${s.spec && !/brak specyfiki/i.test(s.spec) ? ` · ${s.spec.toLowerCase()}` : ""}`;
  const L = [`- ${head}`, `  ${addr}${dist !== undefined ? ` · ${dist < 10 ? dist.toFixed(1).replace(".", ",") : Math.round(dist)} km` : ""}${Number.isFinite(s.students) ? ` · uczniów: ${s.students}` : ""} · RSPO ${s.rspo}${s.www ? ` · ${s.www}` : ""}`];
  const ex = examLine(d, s);
  if (ex) L.push(`  ${ex}`);
  return L;
}

const ROMAN = /^(?=[ivxlcdm])m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const small = new Set(["w", "z", "i", "im", "im.", "nr", "na", "we", "ze", "dla", "oraz", "pod", "przy", "do", "o"]);
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i, all) =>
      w === "i" && i === all.length - 1
        ? "I"
        : i > 0 && small.has(w)
          ? w
          : w !== "i" && ROMAN.test(w)
            ? w.toUpperCase()
            : w.replace(/(^|-)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()),
    )
    .join(" ")
    .replace(/\bNr\b/, "nr")
    .replace(/\b([Ii]m)\.(\p{L})/gu, (_, a: string, b: string) => `${a.toLowerCase()}. ${b.toUpperCase()}`);
}

export async function findSchools(q: FindQuery): Promise<string> {
  const d = await data();
  const level = q.level ?? "dowolna";
  const types = level === "dowolna" ? null : new Set(LEVEL_TYPES[level]);
  let pool0 = d.schools.filter((s) => (!types || types.has(s.typeId)) && (!q.publicOnly || s.pub === "publiczna"));
  // a town / gmina name without street -> text match first
  const raw = q.place.trim();
  const coord = /^-?\d{1,2}\.\d+\s*[,;\s]\s*-?\d{1,3}\.\d+$/.test(raw);
  let center: { lat: number; lon: number; label: string } | null = null;
  let cands: School[] = [];
  const f = fold(raw.split(",")[0]);
  if (!coord && !raw.includes(",") && !/\d/.test(raw)) {
    cands = pool0.filter((s) => townMatch(s, f));
  }
  if (!cands.length) {
    const places = await geocode(raw).catch(() => {
      throw new UserError(`Nie znaleziono miejsca "${q.place}". Podaj miejscowość, gminę, adres („Kraków, Długa 5”) albo „lat,lon”.`);
    });
    const p = places[0];
    center = { lat: p.lat, lon: p.lon, label: p.label };
    const ter = p.teryt?.slice(0, 6);
    if (p.precision === "town" || !ter) cands = pool0.filter((s) => townMatch(s, fold(p.label.split(",")[0])));
    if (ter && (!cands.length || p.precision !== "town")) {
      // same gmina (and for big cities all districts of the city)
      const city = ter.slice(0, 4);
      const isCity = /^\d{2}6\d/.test(city);
      cands = pool0.filter((s) => (isCity ? s.teryt.startsWith(city) : s.teryt.startsWith(ter)));
    }
    if (!cands.length && ter) cands = pool0.filter((s) => s.teryt.startsWith(ter.slice(0, 4)));
  }
  if (!cands.length) return `Nie znaleziono szkół (${level}) dla "${q.place}".`;
  const max = Math.max(1, Math.min(30, q.max ?? 12));
  let rows: { s: School; dist?: number }[] = cands.map((s) => ({ s }));
  const sort = q.sort ?? (center ? "distance" : level === "dowolna" || level === "przedszkole" ? "name" : "results");
  if (center && (sort === "distance" || q.radiusKm)) {
    const lim = cands.slice(0, 150);
    const locs = await pool(lim, 6, (s) => locateSchool(s));
    rows = lim.map((s, i) => ({ s, dist: locs[i] ? km(center!, locs[i]!) : undefined }));
    if (q.radiusKm) rows = rows.filter((r) => r.dist === undefined || r.dist <= q.radiusKm!);
  }
  if (sort === "distance") rows.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
  else if (sort === "results") rows.sort((a, b) => score(d, b.s) - score(d, a.s));
  else rows.sort((a, b) => a.s.name.localeCompare(b.s.name, "pl"));
  const L = [`Szkoły i placówki (${level === "dowolna" ? "wszystkie typy" : level}${q.publicOnly ? ", tylko publiczne" : ""}) – ${center ? center.label : q.place}: ${rows.length}${rows.length > max ? `, pokazuję ${max} (${sort === "distance" ? "najbliższe" : sort === "results" ? "najlepsze wyniki egzaminu" : "alfabetycznie"})` : ""}`, ""];
  for (const r of rows.slice(0, max)) L.push(...schoolLine(d, r.s, r.dist));
  L.push(
    "",
    "Wyniki: średni wynik procentowy szkoły na egzaminie (CKE, sesja główna); „kraj” = średnia w Polsce. Wynik egzaminu nie mierzy wszystkiego, co ważne w szkole – przy wyborze warto zobaczyć ją na dniach otwartych.",
    "Rejonizacja: o przydziale do szkoły podstawowej decyduje obwód szkoły (uchwała gminy) – sprawdź w urzędzie gminy lub w szkole.",
    "Dane: Wykaz szkół i placówek oświatowych (MEN, SIO, dane.gov.pl), wyniki egzaminów – CKE / Mapa wyników egzaminów (mapa.wyniki.edu.pl).",
  );
  return L.join("\n");
}

// ------------------------------------------------------------------ school_details

function resolveSchool(d: Dataset, query: string, town?: string): School[] {
  const q = query.trim();
  if (/^\d{2,7}$/.test(q)) {
    const s = d.byRspo.get(+q);
    return s ? [s] : [];
  }
  const words = fold(q).split(" ").filter((w) => w.length > 1);
  const tf = town ? fold(town) : "";
  return d.schools.filter((s) => {
    const hay = fold(`${s.name} ${s.town} ${s.gmina}`);
    return words.every((w) => hay.includes(w)) && (!tf || fold(s.town) === tf || fold(s.gmina) === tf);
  });
}

function trend(d: Dataset, exam: "E8" | "M", years: Record<string, Record<number, Scores>>, s: School, subjects: string[]): string[] {
  const ys = Object.keys(years).sort();
  const L: string[] = [];
  for (const subj of subjects) {
    const cells = ys
      .map((y) => {
        const v = years[y]?.[s.rspo]?.[subj];
        if (!v || !Number.isFinite(v[1])) return null;
        const nat = natAvg(d, exam, y, subj);
        const pw = powAvg(d, exam, y, subj, s);
        return `${y}: ${pct(v[1])} (${v[0]} zd.; powiat ${pw !== undefined ? pct(pw) : "–"}, kraj ${nat !== undefined ? pct(nat) : "–"})`;
      })
      .filter(Boolean);
    if (cells.length) L.push(`  ${short(subj)}: ${cells.join(" · ")}`);
  }
  return L;
}

export async function schoolDetails(a: { school: string; town?: string }): Promise<string> {
  const d = await data();
  const hits = resolveSchool(d, a.school, a.town);
  if (!hits.length) throw new UserError(`Nie znaleziono szkoły "${a.school}". Podaj numer RSPO albo nazwę z miejscowością (np. "SP 3 Kórnik", town: "Kórnik").`);
  if (hits.length > 1) {
    return [`Pasuje kilka placówek (${hits.length}) – podaj numer RSPO albo doprecyzuj:`, ...hits.slice(0, 15).map((s) => `- RSPO ${s.rspo}: ${titleCase(s.name)} · ${s.type.toLowerCase()} · ${s.town}`)].join("\n");
  }
  const s = hits[0];
  const L: string[] = [
    `${titleCase(s.name)} (RSPO ${s.rspo})`,
    `Typ: ${s.type} · ${s.pub}${s.cat ? ` · uczniowie: ${s.cat.toLowerCase()}` : ""}${s.spec && !/brak specyfiki/i.test(s.spec) ? ` · ${s.spec}` : ""}`,
    `Adres: ${s.street ? `${s.street} ${s.house}` : s.house}, ${s.postal} ${s.town} (gm. ${s.gmina}, pow. ${s.powiat}, woj. ${s.woj.toLowerCase()})`,
    `Organ prowadzący: ${s.organ}${s.www ? ` · www: ${s.www}` : ""}`,
    `Uczniów: ${Number.isFinite(s.students) ? s.students : "–"} · nauczycieli: ${Number.isFinite(s.teachers) ? s.teachers : "–"}${Number.isFinite(s.students) && s.teachers > 0 ? ` (≈ ${(s.students / s.teachers).toFixed(1).replace(".", ",")} ucznia na nauczyciela)` : ""} – stan z SIO na 30 września`,
  ];
  const parent = s.parent ? d.byRspo.get(s.parent) : undefined;
  if (parent && parent.rspo !== s.rspo) L.push(`Wchodzi w skład: ${titleCase(parent.name)} (RSPO ${parent.rspo})`);
  if (s.typeId === 3) {
    const t = trend(d, "E8", d.e8, s, [...E8_MAIN, "język niemiecki", "język rosyjski", "język francuski", "język hiszpański", "język włoski"]);
    L.push("", t.length ? "Egzamin ósmoklasisty – średni wynik (%):" : "Brak wyników egzaminu ósmoklasisty dla tej szkoły (mniej niż 5 zdających albo brak klasy 8).", ...t);
  } else if ([14, 16, 27, 93].includes(s.typeId)) {
    const ys = Object.keys(d.matura).sort();
    const all = ys.map((y) => [y, d.matura[y]?.[s.rspo]?.["egzamin (całość)"]] as const).filter(([, v]) => v);
    if (all.length) {
      L.push("", "Matura (formuła 2023) – zdawalność:", `  ${all.map(([y, v]) => `${y}: ${pct(v![2])} (${v![0]} zdających, świadectwo: ${v![3] ?? "–"})`).join(" · ")}`);
      const latest = ys[ys.length - 1];
      const sc = d.matura[latest]?.[s.rspo] ?? {};
      const ext = Object.entries(sc)
        .filter(([k, v]) => /rozszerzony|dwujęzyczny/.test(k) && v[0] >= 5 && Number.isFinite(v[1]))
        .sort((x, y) => y[1][0] - x[1][0])
        .slice(0, 8)
        .map(([k]) => k);
      L.push("Średni wynik (%):", ...trend(d, "M", d.matura, s, [...M_MAIN, ...ext]));
    } else L.push("", "Brak wyników matury dla tej szkoły (np. brak klas maturalnych albo mniej niż 5 zdających).");
  }
  L.push(
    "",
    "Wyniki: CKE / Mapa wyników egzaminów (sesja główna; „zd.” = liczba zdających); średnie powiatu i kraju liczone z wyników szkół. Dane szkoły: Wykaz szkół i placówek oświatowych (MEN, SIO).",
  );
  return L.join("\n");
}

export const LEVELS = Object.keys(LEVEL_TYPES).concat("dowolna") as Level[];
void config;
