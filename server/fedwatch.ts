import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const MASSIVE_AGGS_URL = "https://api.massive.com/futures/v1/aggs";
const FRED_URL = "https://api.stlouisfed.org/fred/series/observations";
const BP_STEP = 0.25;

type Settlement = { month: string; settle: number };

type Scenario = {
  targetLower: number;
  targetUpper: number;
  probability: number;
  moveBps: number;
  label: string;
  shortLabel: string;
};

export type MeetingSnapshot = {
  date: string;
  contract: string;
  preRate: number;
  postRate: number;
  impliedMonthlyRate: number;
  expectedMoves: number;
  dominantScenario: string;
  scenarios: Scenario[];
};

export type FedDashboardSnapshot = {
  asOfDate: string;
  updatedAt: string;
  source: "massive+fred" | "fallback";
  sourceLabel: string;
  effr: number;
  targetLower: number;
  targetUpper: number;
  meetings: MeetingSnapshot[];
  yearEndMoves: number;
  yearEndDate: string | null;
  dataNote: string;
};

const FOMC_MEETINGS = [
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
  "2026-09-16",
  "2026-10-28",
  "2026-12-09",
  "2027-01-27",
  "2027-03-17",
  "2027-04-28",
  "2027-06-09",
  "2027-07-28",
  "2027-09-15",
  "2027-10-27",
  "2027-12-08",
];

const MONTH_CODES: Record<number, string> = {
  1: "F", 2: "G", 3: "H", 4: "J", 5: "K", 6: "M",
  7: "N", 8: "Q", 9: "U", 10: "V", 11: "X", 12: "Z",
};

const MONTH_NAMES: Record<number, string> = {
  1: "JAN", 2: "FEB", 3: "MAR", 4: "APR", 5: "MAY", 6: "JUN",
  7: "JUL", 8: "AUG", 9: "SEP", 10: "OCT", 11: "NOV", 12: "DEC",
};

// Persistent disk + memory cache to withstand server restarts and 5 req/min rate limits
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "fed-cache.json");
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

type CacheStore = {
  settlements: Record<string, { settle: number; timestamp: number }>;
  fred: Record<string, { value: number; timestamp: number }>;
};

function readPersistentStore(): CacheStore {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const content = fs.readFileSync(CACHE_FILE, "utf8");
      return JSON.parse(content) as CacheStore;
    }
  } catch {
    // Ignore read errors
  }
  return { settlements: {}, fred: {} };
}

function writePersistentStore(store: CacheStore) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Ignore write errors (e.g. read-only filesystem)
  }
}

const memoryStore: CacheStore = readPersistentStore();

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function daysInMonth(date: string) {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthKey(date: string) {
  const [year, month] = date.split("-").map(Number);
  return `${MONTH_NAMES[month]} ${String(year).slice(-2)}`;
}

function shiftMonth(year: number, month: number, delta: number) {
  const value = year * 12 + month - 1 + delta;
  return { year: Math.floor(value / 12), month: (value % 12) + 1 };
}

function monthKeyFromParts(year: number, month: number) {
  return `${MONTH_NAMES[month]} ${String(year).slice(-2)}`;
}

function previousMonthKey(date: string) {
  const [year, month] = date.split("-").map(Number);
  const previous = shiftMonth(year, month, -1);
  return monthKeyFromParts(previous.year, previous.month);
}

function nextMonthKey(date: string) {
  const [year, month] = date.split("-").map(Number);
  const next = shiftMonth(year, month, 1);
  return monthKeyFromParts(next.year, next.month);
}

function contractCode(date: string) {
  const [year, month] = date.split("-").map(Number);
  return `ZQ${MONTH_CODES[month]}${String(year).slice(-1)}`;
}

function targetRangeLabel(lowerBps: number) {
  return `${(lowerBps / 100).toFixed(2)}-${((lowerBps + 25) / 100).toFixed(2)} %`;
}

function scenarioLabel(moveBps: number) {
  if (moveBps === 0) return { label: "Maintien", shortLabel: "Maintien" };
  if (moveBps > 0) return { label: `Hausse de ${moveBps} bp`, shortLabel: `+${moveBps} bp` };
  return { label: `Baisse de ${Math.abs(moveBps)} bp`, shortLabel: `${moveBps} bp` };
}

export function makeScenarios(preRate: number, postRate: number, targetLower: number): Scenario[] {
  const preLowerBps = Math.floor((preRate * 100 + 1e-8) / 25) * 25;
  const expectedMoves = (postRate - preRate) / BP_STEP;
  const floorMoves = Math.floor(expectedMoves);
  const upperProbability = clamp(expectedMoves - floorMoves);
  const lowerProbability = 1 - upperProbability;
  const lowerBps = preLowerBps + floorMoves * 25;
  const upperBps = lowerBps + 25;
  const scenarios = [
    { targetBps: lowerBps, probability: lowerProbability },
    { targetBps: upperBps, probability: upperProbability },
  ]
    .filter((item) => item.probability > 0.001)
    .map((item) => {
      const moveBps = item.targetBps - Math.round(targetLower * 100);
      const names = scenarioLabel(moveBps);
      return {
        targetLower: item.targetBps / 100,
        targetUpper: (item.targetBps + 25) / 100,
        probability: Math.round(item.probability * 1000) / 10,
        moveBps,
        label: `${names.label} - ${targetRangeLabel(item.targetBps)}`,
        shortLabel: names.shortLabel,
      };
    });
  return scenarios.length ? scenarios : [{
    targetLower: preLowerBps / 100,
    targetUpper: (preLowerBps + 25) / 100,
    probability: 100,
    moveBps: preLowerBps - Math.round(targetLower * 100),
    label: `Scénario central - ${targetRangeLabel(preLowerBps)}`,
    shortLabel: "Central",
  }];
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function latestFredValue(observations: unknown) {
  if (!Array.isArray(observations)) return null;
  for (const observation of observations) {
    if (!observation || typeof observation !== "object" || !("value" in observation)) continue;
    const parsed = parseNumber(observation.value);
    if (parsed !== null) return parsed;
  }
  return null;
}

async function fetchFredSeries(seriesId: string): Promise<number> {
  const cached = memoryStore.fred[seriesId];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey || !/^[a-z0-9]{32}$/.test(apiKey)) {
    if (cached) return cached.value;
    throw new Error("FRED_API_KEY is missing or invalid; provide a 32-character lowercase alphanumeric key");
  }
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
  const url = new URL(FRED_URL);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", start.toISOString().slice(0, 10));
  url.searchParams.set("observation_end", end.toISOString().slice(0, 10));
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "10");

  let response: Response;
  try {
    response = await fetch(url, { headers: { "User-Agent": "FedRateDashboard/1.0" } });
  } catch {
    if (cached) return cached.value;
    throw new Error(`FRED ${seriesId} network request failed`);
  }
  if (!response.ok) {
    if (cached) return cached.value;
    throw new Error(`FRED ${seriesId} returned ${response.status}`);
  }
  const data = await response.json() as { observations?: unknown; error_message?: string };
  if (data.error_message) {
    if (cached) return cached.value;
    throw new Error(`FRED ${seriesId}: ${data.error_message.replaceAll(apiKey, "[redacted]")}`);
  }
  const value = latestFredValue(data.observations);
  if (value !== null) {
    memoryStore.fred[seriesId] = { value, timestamp: Date.now() };
    writePersistentStore(memoryStore);
    return value;
  }
  if (cached) return cached.value;
  throw new Error(`FRED ${seriesId} returned no numeric observation`);
}

function settlementMonths(meetingDates: string[]) {
  const months = new Set<string>();
  for (const date of meetingDates) {
    const [year, month, day] = date.split("-").map(Number);
    months.add(monthKey(date));
    months.add(previousMonthKey(date));
    if (daysInMonth(date) - day + 1 <= 3) {
      const next = shiftMonth(year, month, 1);
      months.add(monthKeyFromParts(next.year, next.month));
    }
  }
  return Array.from(months);
}

function latestSettlement(results: unknown) {
  if (!Array.isArray(results)) return null;
  for (const result of results) {
    if (!result || typeof result !== "object" || !("settlement_price" in result)) continue;
    const parsed = parseNumber(result.settlement_price);
    if (parsed !== null) return parsed;
  }
  return null;
}

function latestPriceOrSettlement(results: unknown): number | null {
  const settle = latestSettlement(results);
  if (settle !== null) return settle;
  if (!Array.isArray(results)) return null;
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const close = parseNumber((result as Record<string, unknown>).close);
    if (close !== null) return close;
  }
  return null;
}

async function fetchSettlement(month: string): Promise<Settlement> {
  const cached = memoryStore.settlements[month];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { month, settle: cached.settle };
  }

  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) {
    if (cached) return { month, settle: cached.settle };
    throw new Error("MASSIVE_API_KEY is required to fetch Fed Funds futures");
  }
  const [monthName, yearSuffix] = month.split(" ");
  const monthNumberValue = Object.entries(MONTH_NAMES).find(([, name]) => name === monthName)?.[0];
  if (!monthName || !yearSuffix || !monthNumberValue) throw new Error(`Invalid futures month: ${month}`);
  const ticker = `ZQ${MONTH_CODES[Number(monthNumberValue)]}${yearSuffix.slice(-1)}`;
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
  const url = new URL(`${MASSIVE_AGGS_URL}/${ticker}`);
  url.searchParams.set("timespan", "1session");
  url.searchParams.set("from", start.toISOString().slice(0, 10));
  url.searchParams.set("to", end.toISOString().slice(0, 10));
  url.searchParams.set("limit", "20");
  url.searchParams.set("apiKey", apiKey);

  let response: Response;
  try {
    response = await fetch(url, { headers: { "User-Agent": "FedRateDashboard/1.0" } });
  } catch (error) {
    if (cached) return { month, settle: cached.settle };
    throw new Error(`Massive ${ticker} network request failed`);
  }

  if (response.status === 429) {
    if (cached) {
      console.warn(`[Massive] Rate limited on ${ticker}, using cached settlement: ${cached.settle}`);
      return { month, settle: cached.settle };
    }
    throw new Error(`Massive ${ticker} rate limit exceeded (429)`);
  }

  if (!response.ok) {
    if (cached) return { month, settle: cached.settle };
    throw new Error(`Massive ${ticker} settlements returned ${response.status}`);
  }

  const data = await response.json() as { results?: unknown; status?: string; error?: string };
  if (data.status === "ERROR" || data.error) {
    if (cached) {
      console.warn(`[Massive] API error on ${ticker}, using cached settlement: ${cached.settle}`);
      return { month, settle: cached.settle };
    }
    throw new Error(`Massive ${ticker}: ${data.error ?? "API error"}`);
  }

  const settle = latestPriceOrSettlement(data.results);
  if (settle === null) {
    if (cached) return { month, settle: cached.settle };
    throw new Error(`Massive ${ticker} returned no recent settlement price`);
  }

  memoryStore.settlements[month] = { settle, timestamp: Date.now() };
  writePersistentStore(memoryStore);
  return { month, settle };
}

async function fetchSettlements(meetingDates: string[]) {
  const months = settlementMonths(meetingDates);
  const settlements: Settlement[] = [];
  for (const month of months) {
    if (!memoryStore.settlements[month] || Date.now() - memoryStore.settlements[month].timestamp >= CACHE_TTL_MS) {
      await new Promise((r) => setTimeout(r, 150));
    }
    settlements.push(await fetchSettlement(month));
  }
  return settlements;
}

function relevantMeetings(meetingDates: string[]) {
  const year = todayIso().slice(0, 4);
  const yearEnd = meetingDates.find((date) => date.startsWith(year) && date.slice(5, 7) === "12")
    ?? meetingDates[meetingDates.length - 1];
  return Array.from(new Set([meetingDates[0], meetingDates[1], yearEnd].filter((date): date is string => Boolean(date))));
}

export function calculateMeetings(settlements: Settlement[], meetings: string[], effr: number, targetLower: number) {
  const settlementMap = new Map(settlements.map((item) => [item.month, item.settle]));
  const sortedMeetings = [...meetings].sort();
  const results: MeetingSnapshot[] = [];
  let previousPostRate: number | null = null;

  for (const date of sortedMeetings) {
    const currentMonthKey = monthKey(date);
    const settlement = settlementMap.get(currentMonthKey);
    if (settlement === undefined) continue;
    const day = Number(date.slice(-2));
    const totalDays = daysInMonth(date);
    const postDays = totalDays - day + 1;

    let preRate: number;
    if (previousPostRate !== null) {
      preRate = previousPostRate;
    } else if (settlementMap.has(previousMonthKey(date))) {
      preRate = 100 - (settlementMap.get(previousMonthKey(date)) as number);
    } else {
      preRate = effr;
    }

    const impliedMonthlyRate = 100 - settlement;
    const nextSettlement = settlementMap.get(nextMonthKey(date));
    const postRate = postDays <= 3 && nextSettlement !== undefined
      ? 100 - nextSettlement
      : (impliedMonthlyRate * totalDays - preRate * (day - 1)) / Math.max(1, postDays);

    const scenarios = makeScenarios(preRate, postRate, targetLower);
    const dominant = [...scenarios].sort((a, b) => b.probability - a.probability)[0];

    results.push({
      date,
      contract: contractCode(date),
      preRate: Math.round(preRate * 1000) / 1000,
      postRate: Math.round(postRate * 1000) / 1000,
      impliedMonthlyRate: Math.round(impliedMonthlyRate * 1000) / 1000,
      expectedMoves: Math.round(((postRate - preRate) / BP_STEP) * 100) / 100,
      dominantScenario: dominant.label,
      scenarios,
    });

    previousPostRate = postRate;
  }

  return results;
}

function fallbackMeetings(targetLower: number): MeetingSnapshot[] {
  const today = todayIso();
  const futureFomc = FOMC_MEETINGS.filter((d) => d >= today);
  const selectedDates = relevantMeetings(futureFomc);

  const fallbackQuotes: Record<string, { implied: number; post: number }> = {
    "2026-12-09": { implied: 4.08, post: 4.14 },
    "2027-01-27": { implied: 4.17, post: 4.31 },
    "2027-03-17": { implied: 4.25, post: 4.38 },
  };

  let preRate = 3.88;
  return selectedDates.map((date) => {
    const quote = fallbackQuotes[date] ?? { implied: preRate + 0.15, post: preRate + 0.20 };
    const scenarios = makeScenarios(preRate, quote.post, targetLower);
    const dominant = [...scenarios].sort((a, b) => b.probability - a.probability)[0];
    const snap: MeetingSnapshot = {
      date,
      contract: contractCode(date),
      preRate: Math.round(preRate * 1000) / 1000,
      postRate: Math.round(quote.post * 1000) / 1000,
      impliedMonthlyRate: quote.implied,
      expectedMoves: Math.round(((quote.post - preRate) / BP_STEP) * 100) / 100,
      dominantScenario: dominant.label,
      scenarios,
    };
    preRate = quote.post;
    return snap;
  });
}

function createFallbackSnapshot(): FedDashboardSnapshot {
  const meetings = fallbackMeetings(3.75);
  const today = todayIso();
  const year = today.slice(0, 4);
  const yearEndMeeting = meetings.find((m) => m.date.startsWith(year) && m.date.slice(5, 7) === "12") ?? meetings[meetings.length - 1];
  const yearEndMoves = yearEndMeeting ? Math.round(((yearEndMeeting.postRate - 3.88) / BP_STEP) * 100) / 100 : 0;
  return {
    asOfDate: today,
    updatedAt: new Date().toISOString(),
    source: "fallback",
    sourceLabel: "Mode démonstration - CME non connecté",
    effr: 3.88,
    targetLower: 3.75,
    targetUpper: 4.0,
    meetings,
    yearEndMoves,
    yearEndDate: yearEndMeeting?.date ?? null,
    dataNote: "Les probabilités affichées sont un exemple calculé à partir de la méthode FedWatch. Branche une source CME officielle pour passer aux données de marché du jour.",
  };
}

async function createLiveSnapshot(): Promise<FedDashboardSnapshot> {
  const upcomingMeetings = FOMC_MEETINGS.filter((date) => date >= todayIso());
  const meetingDates = relevantMeetings(upcomingMeetings);
  const [effr, targetLower, targetUpper, settlements] = await Promise.all([
    fetchFredSeries("EFFR"),
    fetchFredSeries("DFEDTARL"),
    fetchFredSeries("DFEDTARU"),
    fetchSettlements(meetingDates),
  ]);
  const meetings = calculateMeetings(
    settlements,
    meetingDates,
    effr,
    targetLower,
  );
  if (!meetings.length) throw new Error("No upcoming FOMC meetings could be calculated from CME settlements");
  const year = Number(todayIso().slice(0, 4));
  const yearEndMeeting = meetings.find((meeting) => meeting.date.startsWith(String(year)) && meeting.date.slice(5, 7) === "12") ?? meetings[meetings.length - 1];
  return {
    asOfDate: todayIso(),
    updatedAt: new Date().toISOString(),
    source: "massive+fred",
    sourceLabel: "Massive futures + FRED API",
    effr: Math.round(effr * 1000) / 1000,
    targetLower,
    targetUpper,
    meetings,
    yearEndMoves: yearEndMeeting ? Math.round(((yearEndMeeting.postRate - effr) / BP_STEP) * 100) / 100 : 0,
    yearEndDate: yearEndMeeting?.date ?? null,
    dataNote: "Probabilités estimées à partir des settlements des futures 30-Day Fed Funds fournis par Massive. Les taux EFFR et les bornes cibles proviennent de l’API officielle FRED.",
  };
}

export const fedTest = { latestFredValue, latestSettlement, latestPriceOrSettlement, settlementMonths, relevantMeetings };

export async function refreshFedDashboard() {
  let snapshot: FedDashboardSnapshot;
  try {
    snapshot = await createLiveSnapshot();
  } catch (error) {
    console.warn("[FedWatch] Live provider unavailable, using fallback:", error instanceof Error ? error.message : error);
    snapshot = createFallbackSnapshot();
  }
  return { snapshot };
}
