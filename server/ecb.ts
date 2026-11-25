import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ECB_DATA_URL = "https://data-api.ecb.europa.eu/service/data";
const ECB_WATCH_URL = "https://ecb-watch.eu/probabilities";
const MARKET_PRICING_URL = "https://rateprobability.com/ecb";

export type EcbMeeting = {
  date: string;
  impliedRate: number;
  moveBps: number;
  moveProbability: number;
  scenarios: Array<{ label: string; probability: number; moveBps: number; targetRate: number }>;
};

export type EcbDashboardSnapshot = {
  asOfDate: string;
  updatedAt: string;
  source: "ecb+market" | "ecb";
  sourceLabel: string;
  marketPricingAvailable: boolean;
  depositRate: number;
  refinancingRate: number;
  marginalRate: number;
  estr: number;
  estrDate: string;
  meetings: EcbMeeting[];
  yearEndMoves: number | null;
  yearEndDate: string | null;
  dataNote: string;
};

export const ECB_GOVERNING_COUNCIL_MEETINGS = [
  "2026-02-05",
  "2026-03-19",
  "2026-04-30",
  "2026-06-11",
  "2026-07-23",
  "2026-09-10",
  "2026-10-29",
  "2026-12-17",
  "2027-02-04",
  "2027-03-18",
  "2027-04-29",
  "2027-06-10",
  "2027-07-22",
  "2027-09-09",
  "2027-10-28",
  "2027-12-16",
];

const CACHE_DIR = path.join(os.tmpdir(), "rates-cache");
const CACHE_FILE = path.join(CACHE_DIR, "ecb-cache.json");
const ECB_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

type EcbCacheStore = Record<string, { date: string; value: number; timestamp: number }>;

function readPersistentStore(): EcbCacheStore {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as EcbCacheStore;
    }
  } catch {
    // Ignore read errors
  }
  return {};
}

function writePersistentStore(store: EcbCacheStore) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Ignore write errors
  }
}

const memoryStore: EcbCacheStore = readPersistentStore();

const ecbHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: false,
});

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function number(value: string) {
  const normalized = value.replace(/,/g, ".").replace(/[^0-9.-]/g, "");
  if (!normalized || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(date: string) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date(date);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(parsed);
}

function cleanText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

async function fetchEcbSdmxText(urlStr: string): Promise<string> {
  // First attempt: curl with HTTP/2 (avoids MyraCloud / ECB CDN stalling on HTTP/1.1)
  try {
    const { stdout } = await execFileAsync("curl", [
      "-s",
      "-k",
      "--http2",
      "--max-time", "8",
      "-H", "Accept: text/csv",
      "-H", "User-Agent: RateSignals/1.0",
      urlStr,
    ]);
    if (stdout && stdout.includes("OBS_VALUE")) return stdout;
  } catch {
    // Fallback to https.get or fetch
  }

  // Second attempt: native node https.get
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.get(
      url,
      {
        agent: ecbHttpsAgent,
        headers: {
          Accept: "text/csv",
          "User-Agent": "RateSignals/1.0",
        },
      },
      (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`ECB API ${urlStr} returned status ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${urlStr}`));
    });
  });
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "RateSignals/1.0" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function parseCsvRow(line: string) {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function latestSdmxObservation(csv: string) {
  const rows = csv.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
  const headers = rows[0] ?? [];
  const dateIndex = headers.indexOf("TIME_PERIOD");
  const valueIndex = headers.indexOf("OBS_VALUE");
  if (dateIndex < 0 || valueIndex < 0) return null;
  const observations: Array<{ date: string; value: number }> = [];
  for (const row of rows.slice(1)) {
    const date = row[dateIndex] ?? "";
    const value = number(row[valueIndex] ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && value !== null) observations.push({ date, value });
  }
  observations.sort((left, right) => right.date.localeCompare(left.date));
  return observations[0] ?? null;
}

async function fetchSdmxObservation(series: string): Promise<{ date: string; value: number }> {
  const cached = memoryStore[series];
  if (cached && Date.now() - cached.timestamp < ECB_CACHE_TTL_MS && cached.timestamp > 0) {
    return { date: cached.date, value: cached.value };
  }

  const url = `${ECB_DATA_URL}/${series}?lastNObservations=5&format=csvdata`;
  let csv: string;
  try {
    csv = await fetchEcbSdmxText(url);
  } catch (error) {
    if (cached) return { date: cached.date, value: cached.value };
    throw error;
  }

  const observation = latestSdmxObservation(csv);
  if (!observation) {
    if (cached) return { date: cached.date, value: cached.value };
    throw new Error(`ECB SDMX series ${series} returned no numeric observation`);
  }

  memoryStore[series] = { date: observation.date, value: observation.value, timestamp: Date.now() };
  writePersistentStore(memoryStore);
  return observation;
}

async function fetchOfficialRates() {
  const [deposit, refinancing, marginal] = await Promise.all([
    fetchSdmxObservation("FM/B.U2.EUR.4F.KR.DFR.LEV"),
    fetchSdmxObservation("FM/B.U2.EUR.4F.KR.MRR_FR.LEV"),
    fetchSdmxObservation("FM/B.U2.EUR.4F.KR.MLFR.LEV"),
  ]);
  return { depositRate: deposit.value, refinancingRate: refinancing.value, marginalRate: marginal.value };
}

async function fetchEstr() {
  const observation = await fetchSdmxObservation("EST/B.EU000A2X2A25.WT");
  return { estr: observation.value, estrDate: observation.date };
}

function parseMarketMeetings(text: string, depositRate: number): EcbMeeting[] {
  const clean = cleanText(text);
  const rows = Array.from(clean.matchAll(/([A-Z][a-z]{2}\s+\d{1,2},\s+20\d{2})\s+([0-9.]+)%\s+([0-9.]+)%\s+([0-9.]+)\s+([0-9.]+)/g));
  const parsed = rows.map((match) => {
    const date = formatDate(match[1]);
    const impliedRate = number(match[2])!;
    const moveBps = Math.round((impliedRate - depositRate) * 100);
    const moveProbability = number(match[3])!;
    const roundedMove = Math.round(moveBps / 25) * 25;
    const targetRate = depositRate + roundedMove / 100;
    const hold = Math.max(0, Math.round((100 - moveProbability) * 10) / 10);
    return {
      date,
      impliedRate,
      moveBps,
      moveProbability,
      scenarios: [
        {
          label: roundedMove > 0 ? `Hausse de ${roundedMove} bp` : roundedMove < 0 ? `Baisse de ${Math.abs(roundedMove)} bp` : "Maintien",
          probability: moveProbability,
          moveBps: roundedMove,
          targetRate,
        },
        { label: "Maintien / autre scénario", probability: hold, moveBps: 0, targetRate: depositRate },
      ],
    };
  });
  const latestByDate = new Map<string, EcbMeeting>();
  parsed.forEach((meeting) => latestByDate.set(meeting.date, meeting));
  return Array.from(latestByDate.values()).filter((meeting) => meeting.date >= todayIso()).slice(0, 8);
}

type EcbWatchResponse = {
  abs_data?: Record<string, Record<string, number>>;
  current_rate?: number;
  metadata?: { as_of?: string; data_sources?: string };
};

function parseEcbWatchProbabilities(payload: EcbWatchResponse, depositRate: number): EcbMeeting[] {
  const absData = payload?.abs_data;
  if (!absData || typeof absData !== "object") return [];

  const today = todayIso();
  const meetings: EcbMeeting[] = [];

  for (const [date, dist] of Object.entries(absData)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || !dist || typeof dist !== "object") continue;

    let impliedRate = 0;
    const rawScenarios: Array<{ label: string; probability: number; moveBps: number; targetRate: number }> = [];

    for (const [rateLabel, rawProb] of Object.entries(dist)) {
      const targetRate = number(rateLabel);
      if (targetRate === null || typeof rawProb !== "number" || !Number.isFinite(rawProb)) continue;
      impliedRate += targetRate * rawProb;
      const probPct = Math.round(rawProb * 1000) / 10;
      if (probPct <= 0) continue;
      const moveBps = Math.round((targetRate - depositRate) * 100);
      rawScenarios.push({
        label: moveBps > 0 ? `Hausse de ${moveBps} bp` : moveBps < 0 ? `Baisse de ${Math.abs(moveBps)} bp` : "Maintien",
        probability: probPct,
        moveBps,
        targetRate,
      });
    }

    if (!rawScenarios.length) continue;
    rawScenarios.sort((a, b) => b.probability - a.probability);
    const roundedImplied = Math.round(impliedRate * 1000) / 1000;
    const moveBps = Math.round((roundedImplied - depositRate) * 100);
    const dominant = rawScenarios[0];

    meetings.push({
      date,
      impliedRate: roundedImplied,
      moveBps,
      moveProbability: dominant.probability,
      scenarios: rawScenarios,
    });
  }

  return meetings.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
}

async function createLiveSnapshot(): Promise<EcbDashboardSnapshot> {
  const [rates, estr] = await Promise.all([fetchOfficialRates(), fetchEstr()]);
  let meetings: EcbMeeting[] = [];
  let isExternalMarketSource = false;
  let marketSourceDesc = "";

  try {
    const res = await fetch(ECB_WATCH_URL, { headers: { "User-Agent": "RateSignals/1.0", Accept: "application/json" } });
    if (res.ok) {
      const payload = (await res.json()) as EcbWatchResponse;
      meetings = parseEcbWatchProbabilities(payload, rates.depositRate);
      if (meetings.length > 0) {
        isExternalMarketSource = true;
        marketSourceDesc = "ECB Watch (€STR futures)";
      }
    }
  } catch {
    // Primary market source unavailable, try secondary
  }

  if (!meetings.length) {
    try {
      const market = await fetchText(MARKET_PRICING_URL);
      if (!/Just a moment|Enable JavaScript|challenge-platform|cloudflare/i.test(market)) {
        meetings = parseMarketMeetings(market, rates.depositRate);
        if (meetings.length > 0) {
          isExternalMarketSource = true;
          marketSourceDesc = "fournisseur OIS tiers";
        }
      }
    } catch {
      // Secondary provider unavailable
    }
  }

  const currentYear = todayIso().slice(0, 4);
  const yearEnd = meetings.find((meeting) => meeting.date.startsWith(currentYear) && meeting.date.slice(5, 7) === "12") ?? meetings[meetings.length - 1];
  const marketPricingAvailable = meetings.length > 0;

  return {
    asOfDate: todayIso(),
    updatedAt: new Date().toISOString(),
    source: isExternalMarketSource ? "ecb+market" : "ecb",
    sourceLabel: isExternalMarketSource
      ? `ECB SDMX officiel + ${marketSourceDesc}`
      : "ECB SDMX officiel (pricing marché indisponible)",
    marketPricingAvailable,
    ...rates,
    ...estr,
    meetings,
    yearEndMoves: yearEnd ? Math.round(((yearEnd.impliedRate - rates.depositRate) / 0.25) * 100) / 100 : null,
    yearEndDate: yearEnd?.date ?? null,
    dataNote: isExternalMarketSource
      ? `Taux directeurs et €STR : API SDMX officielle de l’ECB. Probabilités par réunion : ${marketSourceDesc}.`
      : "Taux directeurs et €STR en direct via l’API SDMX officielle de l’ECB. Les probabilités de marché sont temporairement indisponibles.",
  };
}

export async function refreshEcbDashboard() {
  const snapshot = await createLiveSnapshot();
  return { snapshot };
}

export const ecbTest = { latestSdmxObservation, parseMarketMeetings, parseEcbWatchProbabilities, ECB_GOVERNING_COUNCIL_MEETINGS };
