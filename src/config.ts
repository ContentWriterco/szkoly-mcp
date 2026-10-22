import { homedir } from "node:os";
import { join } from "node:path";

export const config = {
  /** dane.gov.pl dataset "Wykaz szkół i placówek oświatowych" (MEN, SIO) */
  sioDatasetApi: process.env.SZKOLY_SIO_API ?? "https://api.dane.gov.pl/1.4/datasets/839/resources?per_page=5&sort=-created",
  sioUrl: process.env.SZKOLY_SIO_URL,
  /** CKE / CIE "Mapa wyników egzaminów" – per-school result files */
  examBase: process.env.SZKOLY_EXAM_BASE ?? "https://mapa.wyniki.edu.pl/MapaEgzaminow",
  uugUrl: process.env.SZKOLY_UUG_URL ?? "https://services.gugik.gov.pl/uug/",
  dataDir: process.env.SZKOLY_DATA_DIR ?? join(homedir(), ".cache", "szkoly-mcp"),
  refreshHours: Number(process.env.SZKOLY_REFRESH_HOURS ?? 24),
  e8Years: Number(process.env.SZKOLY_E8_YEARS ?? 3),
  maturaYears: Number(process.env.SZKOLY_MATURA_YEARS ?? 3),
  log: process.env.SZKOLY_LOG ?? "info",
  userAgent: "szkoly-mcp (+https://github.com/ContentWriterco/szkoly-mcp)",
};

export function log(level: "debug" | "info" | "warn" | "error", ...args: unknown[]) {
  const order = { debug: 0, info: 1, warn: 2, error: 3 } as const;
  if (order[level] < (order[config.log as keyof typeof order] ?? 1)) return;
  console.error(`[szkoly-mcp] ${level}:`, ...args);
}

export class UserError extends Error {}
