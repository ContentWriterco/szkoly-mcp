import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UserError, log } from "./config.js";
import { findSchools, schoolDetails, LEVELS, type Level } from "./schools.js";
import { data } from "./data.js";
import { VERSION } from "./version.js";
import { usage, classify } from "./usage.js";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(tool: string, fn: () => Promise<string>): Promise<Text> {
  const t0 = performance.now();
  let res: Text;
  let userErr = false;
  try {
    res = { content: [{ type: "text", text: await fn() }] };
  } catch (e) {
    userErr = e instanceof UserError;
    const msg = userErr ? (e as Error).message : `Internal error: ${(e as Error).message}`;
    if (!userErr) log("error", (e as Error).stack);
    res = { content: [{ type: "text", text: msg }], isError: true };
  }
  if (usage.enabled) {
    const text = res.content[0].text;
    void usage.tool(tool, /^Nie znaleziono/.test(text) ? "not_found" : classify(text, !!res.isError, userErr), performance.now() - t0);
  }
  return res;
}

export const INSTRUCTIONS = `Schools in Poland for parents: the official register of schools and kindergartens (MEN, SIO) with addresses, public/non-public status, number of pupils and teachers, and per-school results of the eighth-grade exam (egzamin ósmoklasisty) and the matura (CKE), compared with county and national averages.
Use find_schools with a town, a gmina or an address (then sorted by distance) and a level (przedszkole, podstawowa, liceum, technikum, branzowa...). Use school_details with an RSPO number (from find_schools) for the multi-year results by subject.
Explain that exam averages depend a lot on who the pupils are and do not measure everything about a school; primary school admission depends on the catchment area (obwód) set by the gmina. Answer in the user's language.`;

const level = z.enum(LEVELS as [Level, ...Level[]]).optional().describe("przedszkole, podstawowa, liceum, technikum, branzowa, policealna, artystyczna or dowolna (default)");

export function createServer(): McpServer {
  const server = new McpServer({ name: "szkoly-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true, openWorldHint: true } as const;
  server.registerTool(
    "find_schools",
    {
      title: "Find schools and kindergartens (Poland)",
      description:
        "Schools or kindergartens in a Polish town / gmina or near an address: type, public or non-public, address, number of pupils, RSPO id, website and the latest exam results (eighth-grade exam for primary schools, matura pass rate and averages for licea/technika) vs the national average. " +
        "place: town \"Kórnik\", gmina, address \"Kraków, Długa 5\" (sorted by distance) or 'lat,lon'.",
      inputSchema: {
        place: z.string().describe("Town, gmina, address or 'lat,lon' in Poland"),
        level,
        public_only: z.boolean().optional().describe("Only public schools"),
        radius_km: z.number().min(0.5).max(30).optional().describe("Only within this distance from the address"),
        sort: z.enum(["distance", "results", "name"]).optional().describe("Default: distance for addresses, results for school levels with exams"),
        max: z.number().int().min(1).max(30).optional().describe("How many to list (default 12)"),
      },
      annotations: ro,
    },
    async (a) => run("find_schools", () => findSchools({ place: a.place, level: a.level, publicOnly: a.public_only, radiusKm: a.radius_km, sort: a.sort, max: a.max })),
  );
  server.registerTool(
    "school_details",
    {
      title: "School details and exam results (Poland)",
      description:
        "One school: register data (type, address, governing body, pupils, teachers, pupils per teacher) and exam results for the last years by subject – eighth-grade exam or matura (pass rate, basic and extended subjects) – compared with the county and national averages. school: RSPO number or name; town helps to disambiguate.",
      inputSchema: { school: z.string().describe("RSPO number or school name"), town: z.string().optional().describe("Town or gmina") },
      annotations: ro,
    },
    async (a) => run("school_details", () => schoolDetails({ school: a.school, town: a.town })),
  );
  server.registerTool(
    "data_sources",
    { title: "Data sources", description: "Where the data comes from and caveats.", inputSchema: {}, annotations: ro },
    async () =>
      run("data_sources", async () => {
        const d = await data();
        return [
          `Wykaz szkół i placówek oświatowych – MEN, System Informacji Oświatowej, dane.gov.pl (CC BY 4.0): ${d.sources.sio} (${d.schools.length} szkół i przedszkoli; stan na 30 września).`,
          `Wyniki egzaminów – Centralna Komisja Egzaminacyjna, Mapa wyników egzaminów (mapa.wyniki.edu.pl): egzamin ósmoklasisty ${Object.keys(d.e8).sort().join(", ")}; matura (formuła 2023) ${Object.keys(d.matura).sort().join(", ")}. Średnie pokazywane dla co najmniej 5 zdających.`,
          "Adresy i odległości: GUGiK (państwowy rejestr adresów).",
          `Dane załadowane: ${d.loadedAt}; sprawdzane raz na dobę.`,
          `szkoly-mcp ${VERSION} · https://github.com/ContentWriterco/szkoly-mcp`,
        ].join("\n");
      }),
  );
  return server;
}
