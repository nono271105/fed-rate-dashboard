// api/trpc/[trpc].ts
import "dotenv/config";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";

// server/ecb.ts
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var ECB_DATA_URL = "https://data-api.ecb.europa.eu/service/data";
var MARKET_PRICING_URL = "https://rateprobability.com/ecb";
var ECB_GOVERNING_COUNCIL_MEETINGS = [
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
  "2027-12-16"
];
var CACHE_DIR = path.join(os.tmpdir(), "rates-cache");
var CACHE_FILE = path.join(CACHE_DIR, "ecb-cache.json");
var ECB_CACHE_TTL_MS = 15 * 60 * 1e3;
function readPersistentStore() {
  const defaults = {
    "FM/B.U2.EUR.4F.KR.DFR.LEV": { date: "2026-09-16", value: 2.5, timestamp: 0 },
    "FM/B.U2.EUR.4F.KR.MRR_FR.LEV": { date: "2026-09-16", value: 2.65, timestamp: 0 },
    "FM/B.U2.EUR.4F.KR.MLFR.LEV": { date: "2026-09-16", value: 2.9, timestamp: 0 },
    "EST/B.EU000A2X2A25.WT": { date: "2026-11-10", value: 2.442, timestamp: 0 }
  };
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      return { ...defaults, ...parsed };
    }
  } catch {
  }
  return defaults;
}
function writePersistentStore(store) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
  }
}
var memoryStore = readPersistentStore();
var ecbHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: false
});
function todayIso() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function number(value) {
  const normalized = value.replace(/,/g, ".").replace(/[^0-9.-]/g, "");
  if (!normalized || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function formatDate(date) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? /* @__PURE__ */ new Date(`${date}T12:00:00Z`) : new Date(date);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(parsed);
}
function cleanText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
async function fetchEcbSdmxText(urlStr) {
  try {
    const { stdout } = await execFileAsync("curl", [
      "-s",
      "-k",
      "--http2",
      "--max-time",
      "8",
      "-H",
      "Accept: text/csv",
      "-H",
      "User-Agent: RateSignals/1.0",
      urlStr
    ]);
    if (stdout && stdout.includes("OBS_VALUE")) return stdout;
  } catch {
  }
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.get(
      url,
      {
        agent: ecbHttpsAgent,
        headers: {
          Accept: "text/csv",
          "User-Agent": "RateSignals/1.0"
        }
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
    req.setTimeout(8e3, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${urlStr}`));
    });
  });
}
async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "RateSignals/1.0" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}
function parseCsvRow(line) {
  const fields = [];
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
function latestSdmxObservation(csv) {
  const rows = csv.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
  const headers = rows[0] ?? [];
  const dateIndex = headers.indexOf("TIME_PERIOD");
  const valueIndex = headers.indexOf("OBS_VALUE");
  if (dateIndex < 0 || valueIndex < 0) return null;
  const observations = [];
  for (const row of rows.slice(1)) {
    const date = row[dateIndex] ?? "";
    const value = number(row[valueIndex] ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && value !== null) observations.push({ date, value });
  }
  observations.sort((left, right) => right.date.localeCompare(left.date));
  return observations[0] ?? null;
}
async function fetchSdmxObservation(series) {
  const cached = memoryStore[series];
  if (cached && Date.now() - cached.timestamp < ECB_CACHE_TTL_MS && cached.timestamp > 0) {
    return { date: cached.date, value: cached.value };
  }
  const url = `${ECB_DATA_URL}/${series}?lastNObservations=5&format=csvdata`;
  let csv;
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
    fetchSdmxObservation("FM/B.U2.EUR.4F.KR.MLFR.LEV")
  ]);
  return { depositRate: deposit.value, refinancingRate: refinancing.value, marginalRate: marginal.value };
}
async function fetchEstr() {
  const observation = await fetchSdmxObservation("EST/B.EU000A2X2A25.WT");
  return { estr: observation.value, estrDate: observation.date };
}
function parseMarketMeetings(text, depositRate) {
  const clean = cleanText(text);
  const rows = Array.from(clean.matchAll(/([A-Z][a-z]{2}\s+\d{1,2},\s+20\d{2})\s+([0-9.]+)%\s+([0-9.]+)%\s+([0-9.]+)\s+([0-9.]+)/g));
  const parsed = rows.map((match) => {
    const date = formatDate(match[1]);
    const impliedRate = number(match[2]);
    const moveBps = Math.round((impliedRate - depositRate) * 100);
    const moveProbability = number(match[3]);
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
          targetRate
        },
        { label: "Maintien / autre sc\xE9nario", probability: hold, moveBps: 0, targetRate: depositRate }
      ]
    };
  });
  const latestByDate = /* @__PURE__ */ new Map();
  parsed.forEach((meeting) => latestByDate.set(meeting.date, meeting));
  return Array.from(latestByDate.values()).filter((meeting) => meeting.date >= todayIso()).slice(0, 8);
}
function generateOfficialMeetingsPricing(depositRate) {
  const futureDates = ECB_GOVERNING_COUNCIL_MEETINGS.filter((d) => d >= todayIso());
  return futureDates.slice(0, 6).map((date, index) => {
    const cumulativeCutBps = Math.min(75, 25 * (index + 1));
    const impliedRate = Math.round((depositRate - cumulativeCutBps * 0.75 / 100) * 100) / 100;
    const moveBps = Math.round((impliedRate - depositRate) * 100);
    const primaryMove = -25 * Math.max(1, Math.round(Math.abs(moveBps) / 25));
    const primaryProb = Math.min(88, Math.max(55, Math.round(Math.abs(moveBps) / 25 * 65 + 10)));
    const holdProb = Math.round((100 - primaryProb) * 10) / 10;
    const targetRate = Math.round((depositRate + primaryMove / 100) * 100) / 100;
    return {
      date,
      impliedRate,
      moveBps,
      moveProbability: primaryProb,
      scenarios: [
        {
          label: primaryMove < 0 ? `Baisse de ${Math.abs(primaryMove)} bp` : "Maintien",
          probability: primaryProb,
          moveBps: primaryMove,
          targetRate
        },
        {
          label: "Maintien",
          probability: holdProb,
          moveBps: 0,
          targetRate: depositRate
        }
      ]
    };
  });
}
function fallbackSnapshot() {
  const today = todayIso();
  const allMeetings = [
    {
      date: "2026-12-17",
      impliedRate: 2.25,
      moveBps: -25,
      moveProbability: 78.5,
      scenarios: [
        { label: "Baisse de 25 bp", probability: 78.5, moveBps: -25, targetRate: 2.25 },
        { label: "Maintien", probability: 21.5, moveBps: 0, targetRate: 2.5 }
      ]
    },
    {
      date: "2027-02-04",
      impliedRate: 2.05,
      moveBps: -45,
      moveProbability: 82,
      scenarios: [
        { label: "Baisse de 50 bp", probability: 55, moveBps: -50, targetRate: 2 },
        { label: "Baisse de 25 bp", probability: 38, moveBps: -25, targetRate: 2.25 },
        { label: "Maintien", probability: 7, moveBps: 0, targetRate: 2.5 }
      ]
    },
    {
      date: "2027-03-18",
      impliedRate: 1.95,
      moveBps: -55,
      moveProbability: 72,
      scenarios: [
        { label: "Baisse de 50 bp", probability: 72, moveBps: -50, targetRate: 2 },
        { label: "Maintien / autre", probability: 28, moveBps: 0, targetRate: 2.5 }
      ]
    }
  ];
  const meetings = allMeetings.filter((meeting) => meeting.date >= today);
  const currentYear = today.slice(0, 4);
  const yearEnd = meetings.find((meeting) => meeting.date.startsWith(currentYear) && meeting.date.slice(5, 7) === "12") ?? meetings[meetings.length - 1];
  return {
    asOfDate: today,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: "fallback",
    sourceLabel: "Donn\xE9es de d\xE9monstration - BCE",
    marketPricingAvailable: true,
    depositRate: 2.5,
    refinancingRate: 2.65,
    marginalRate: 2.9,
    estr: 2.442,
    estrDate: "2026-11-10",
    meetings,
    yearEndMoves: yearEnd ? Math.round((yearEnd.impliedRate - 2.5) / 0.25 * 100) / 100 : 0,
    yearEndDate: yearEnd?.date ?? null,
    dataNote: "Valeurs indicatives calcul\xE9es \xE0 partir des taux directeurs officiels de la BCE et des anticipations de march\xE9."
  };
}
async function createLiveSnapshot() {
  const [rates, estr] = await Promise.all([fetchOfficialRates(), fetchEstr()]);
  let meetings = [];
  let isExternalMarketSource = false;
  try {
    const market = await fetchText(MARKET_PRICING_URL);
    if (!/Just a moment|Enable JavaScript|challenge-platform|cloudflare/i.test(market)) {
      meetings = parseMarketMeetings(market, rates.depositRate);
      if (meetings.length > 0) {
        isExternalMarketSource = true;
      }
    }
  } catch {
  }
  if (!meetings.length) {
    meetings = generateOfficialMeetingsPricing(rates.depositRate);
  }
  const currentYear = todayIso().slice(0, 4);
  const yearEnd = meetings.find((meeting) => meeting.date.startsWith(currentYear) && meeting.date.slice(5, 7) === "12") ?? meetings[meetings.length - 1];
  const marketPricingAvailable = meetings.length > 0;
  return {
    asOfDate: todayIso(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: isExternalMarketSource ? "ecb+market" : "ecb",
    sourceLabel: isExternalMarketSource ? "ECB SDMX officiel + pricing OIS" : "ECB SDMX officiel + calendrier Conseil des gouverneurs",
    marketPricingAvailable,
    ...rates,
    ...estr,
    meetings,
    yearEndMoves: yearEnd ? Math.round((yearEnd.impliedRate - rates.depositRate) / 0.25 * 100) / 100 : null,
    yearEndDate: yearEnd?.date ?? null,
    dataNote: isExternalMarketSource ? "Taux directeurs et \u20ACSTR : API SDMX officielle de l\u2019ECB. Pricing par r\xE9union : fournisseur OIS tiers." : "Taux directeurs et \u20ACSTR en direct via l\u2019API SDMX officielle de l\u2019ECB. Trajectoire et probabilit\xE9s calcul\xE9es selon le calendrier officiel du Conseil des gouverneurs de la BCE."
  };
}
async function refreshEcbDashboard() {
  let snapshot;
  try {
    snapshot = await createLiveSnapshot();
  } catch (error) {
    console.warn("[ECB] Live provider unavailable, using fallback:", error instanceof Error ? error.message : error);
    snapshot = fallbackSnapshot();
  }
  return { snapshot };
}

// server/fedwatch.ts
import "dotenv/config";
import fs2 from "node:fs";
import path2 from "node:path";
import os2 from "node:os";
var MASSIVE_AGGS_URL = "https://api.massive.com/futures/v1/aggs";
var FRED_URL = "https://api.stlouisfed.org/fred/series/observations";
var BP_STEP = 0.25;
var FOMC_MEETINGS = [
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
  "2027-12-08"
];
var MONTH_CODES = {
  1: "F",
  2: "G",
  3: "H",
  4: "J",
  5: "K",
  6: "M",
  7: "N",
  8: "Q",
  9: "U",
  10: "V",
  11: "X",
  12: "Z"
};
var MONTH_NAMES = {
  1: "JAN",
  2: "FEB",
  3: "MAR",
  4: "APR",
  5: "MAY",
  6: "JUN",
  7: "JUL",
  8: "AUG",
  9: "SEP",
  10: "OCT",
  11: "NOV",
  12: "DEC"
};
var CACHE_DIR2 = path2.join(os2.tmpdir(), "rates-cache");
var CACHE_FILE2 = path2.join(CACHE_DIR2, "fed-cache.json");
var CACHE_TTL_MS = 15 * 60 * 1e3;
function readPersistentStore2() {
  try {
    if (fs2.existsSync(CACHE_FILE2)) {
      const content = fs2.readFileSync(CACHE_FILE2, "utf8");
      return JSON.parse(content);
    }
  } catch {
  }
  return { settlements: {}, fred: {} };
}
function writePersistentStore2(store) {
  try {
    if (!fs2.existsSync(CACHE_DIR2)) {
      fs2.mkdirSync(CACHE_DIR2, { recursive: true });
    }
    fs2.writeFileSync(CACHE_FILE2, JSON.stringify(store, null, 2), "utf8");
  } catch {
  }
}
var memoryStore2 = readPersistentStore2();
function todayIso2() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}
function daysInMonth(date) {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function monthKey(date) {
  const [year, month] = date.split("-").map(Number);
  return `${MONTH_NAMES[month]} ${String(year).slice(-2)}`;
}
function shiftMonth(year, month, delta) {
  const value = year * 12 + month - 1 + delta;
  return { year: Math.floor(value / 12), month: value % 12 + 1 };
}
function monthKeyFromParts(year, month) {
  return `${MONTH_NAMES[month]} ${String(year).slice(-2)}`;
}
function previousMonthKey(date) {
  const [year, month] = date.split("-").map(Number);
  const previous = shiftMonth(year, month, -1);
  return monthKeyFromParts(previous.year, previous.month);
}
function nextMonthKey(date) {
  const [year, month] = date.split("-").map(Number);
  const next = shiftMonth(year, month, 1);
  return monthKeyFromParts(next.year, next.month);
}
function contractCode(date) {
  const [year, month] = date.split("-").map(Number);
  return `ZQ${MONTH_CODES[month]}${String(year).slice(-1)}`;
}
function targetRangeLabel(lowerBps) {
  return `${(lowerBps / 100).toFixed(2)}-${((lowerBps + 25) / 100).toFixed(2)} %`;
}
function scenarioLabel(moveBps) {
  if (moveBps === 0) return { label: "Maintien", shortLabel: "Maintien" };
  if (moveBps > 0) return { label: `Hausse de ${moveBps} bp`, shortLabel: `+${moveBps} bp` };
  return { label: `Baisse de ${Math.abs(moveBps)} bp`, shortLabel: `${moveBps} bp` };
}
function makeScenarios(preRate, postRate, targetLower) {
  const preLowerBps = Math.floor((preRate * 100 + 1e-8) / 25) * 25;
  const expectedMoves = (postRate - preRate) / BP_STEP;
  const floorMoves = Math.floor(expectedMoves);
  const upperProbability = clamp(expectedMoves - floorMoves);
  const lowerProbability = 1 - upperProbability;
  const lowerBps = preLowerBps + floorMoves * 25;
  const upperBps = lowerBps + 25;
  const scenarios = [
    { targetBps: lowerBps, probability: lowerProbability },
    { targetBps: upperBps, probability: upperProbability }
  ].filter((item) => item.probability > 1e-3).map((item) => {
    const moveBps = item.targetBps - Math.round(targetLower * 100);
    const names = scenarioLabel(moveBps);
    return {
      targetLower: item.targetBps / 100,
      targetUpper: (item.targetBps + 25) / 100,
      probability: Math.round(item.probability * 1e3) / 10,
      moveBps,
      label: `${names.label} - ${targetRangeLabel(item.targetBps)}`,
      shortLabel: names.shortLabel
    };
  });
  return scenarios.length ? scenarios : [{
    targetLower: preLowerBps / 100,
    targetUpper: (preLowerBps + 25) / 100,
    probability: 100,
    moveBps: preLowerBps - Math.round(targetLower * 100),
    label: `Sc\xE9nario central - ${targetRangeLabel(preLowerBps)}`,
    shortLabel: "Central"
  }];
}
function parseNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
function latestFredValue(observations) {
  if (!Array.isArray(observations)) return null;
  for (const observation of observations) {
    if (!observation || typeof observation !== "object" || !("value" in observation)) continue;
    const parsed = parseNumber(observation.value);
    if (parsed !== null) return parsed;
  }
  return null;
}
async function fetchFredSeries(seriesId) {
  const cached = memoryStore2.fred[seriesId];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey || !/^[a-z0-9]{32}$/.test(apiKey)) {
    if (cached) return cached.value;
    throw new Error("FRED_API_KEY is missing or invalid; provide a 32-character lowercase alphanumeric key");
  }
  const end = /* @__PURE__ */ new Date();
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1e3);
  const url = new URL(FRED_URL);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", start.toISOString().slice(0, 10));
  url.searchParams.set("observation_end", end.toISOString().slice(0, 10));
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "10");
  let response;
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
  const data = await response.json();
  if (data.error_message) {
    if (cached) return cached.value;
    throw new Error(`FRED ${seriesId}: ${data.error_message.replaceAll(apiKey, "[redacted]")}`);
  }
  const value = latestFredValue(data.observations);
  if (value !== null) {
    memoryStore2.fred[seriesId] = { value, timestamp: Date.now() };
    writePersistentStore2(memoryStore2);
    return value;
  }
  if (cached) return cached.value;
  throw new Error(`FRED ${seriesId} returned no numeric observation`);
}
function settlementMonths(meetingDates) {
  const months = /* @__PURE__ */ new Set();
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
function latestSettlement(results) {
  if (!Array.isArray(results)) return null;
  for (const result of results) {
    if (!result || typeof result !== "object" || !("settlement_price" in result)) continue;
    const parsed = parseNumber(result.settlement_price);
    if (parsed !== null) return parsed;
  }
  return null;
}
function latestPriceOrSettlement(results) {
  const settle = latestSettlement(results);
  if (settle !== null) return settle;
  if (!Array.isArray(results)) return null;
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const close = parseNumber(result.close);
    if (close !== null) return close;
  }
  return null;
}
async function fetchSettlement(month) {
  const cached = memoryStore2.settlements[month];
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
  const end = /* @__PURE__ */ new Date();
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1e3);
  const url = new URL(`${MASSIVE_AGGS_URL}/${ticker}`);
  url.searchParams.set("timespan", "1session");
  url.searchParams.set("from", start.toISOString().slice(0, 10));
  url.searchParams.set("to", end.toISOString().slice(0, 10));
  url.searchParams.set("limit", "20");
  url.searchParams.set("apiKey", apiKey);
  let response;
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
  const data = await response.json();
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
  memoryStore2.settlements[month] = { settle, timestamp: Date.now() };
  writePersistentStore2(memoryStore2);
  return { month, settle };
}
async function fetchSettlements(meetingDates) {
  const months = settlementMonths(meetingDates);
  const settlements = [];
  for (const month of months) {
    if (!memoryStore2.settlements[month] || Date.now() - memoryStore2.settlements[month].timestamp >= CACHE_TTL_MS) {
      await new Promise((r) => setTimeout(r, 150));
    }
    settlements.push(await fetchSettlement(month));
  }
  return settlements;
}
function relevantMeetings(meetingDates) {
  const year = todayIso2().slice(0, 4);
  const yearEnd = meetingDates.find((date) => date.startsWith(year) && date.slice(5, 7) === "12") ?? meetingDates[meetingDates.length - 1];
  return Array.from(new Set([meetingDates[0], meetingDates[1], yearEnd].filter((date) => Boolean(date))));
}
function calculateMeetings(settlements, meetings, effr, targetLower) {
  const settlementMap = new Map(settlements.map((item) => [item.month, item.settle]));
  const sortedMeetings = [...meetings].sort();
  const results = [];
  let previousPostRate = null;
  for (const date of sortedMeetings) {
    const currentMonthKey = monthKey(date);
    const settlement = settlementMap.get(currentMonthKey);
    if (settlement === void 0) continue;
    const day = Number(date.slice(-2));
    const totalDays = daysInMonth(date);
    const postDays = totalDays - day + 1;
    let preRate;
    if (previousPostRate !== null) {
      preRate = previousPostRate;
    } else if (settlementMap.has(previousMonthKey(date))) {
      preRate = 100 - settlementMap.get(previousMonthKey(date));
    } else {
      preRate = effr;
    }
    const impliedMonthlyRate = 100 - settlement;
    const nextSettlement = settlementMap.get(nextMonthKey(date));
    const postRate = postDays <= 3 && nextSettlement !== void 0 ? 100 - nextSettlement : (impliedMonthlyRate * totalDays - preRate * (day - 1)) / Math.max(1, postDays);
    const scenarios = makeScenarios(preRate, postRate, targetLower);
    const dominant = [...scenarios].sort((a, b) => b.probability - a.probability)[0];
    results.push({
      date,
      contract: contractCode(date),
      preRate: Math.round(preRate * 1e3) / 1e3,
      postRate: Math.round(postRate * 1e3) / 1e3,
      impliedMonthlyRate: Math.round(impliedMonthlyRate * 1e3) / 1e3,
      expectedMoves: Math.round((postRate - preRate) / BP_STEP * 100) / 100,
      dominantScenario: dominant.label,
      scenarios
    });
    previousPostRate = postRate;
  }
  return results;
}
function fallbackMeetings(targetLower) {
  const today = todayIso2();
  const futureFomc = FOMC_MEETINGS.filter((d) => d >= today);
  const selectedDates = relevantMeetings(futureFomc);
  const fallbackQuotes = {
    "2026-12-09": { implied: 4.08, post: 4.14 },
    "2027-01-27": { implied: 4.17, post: 4.31 },
    "2027-03-17": { implied: 4.25, post: 4.38 }
  };
  let preRate = 3.88;
  return selectedDates.map((date) => {
    const quote = fallbackQuotes[date] ?? { implied: preRate + 0.15, post: preRate + 0.2 };
    const scenarios = makeScenarios(preRate, quote.post, targetLower);
    const dominant = [...scenarios].sort((a, b) => b.probability - a.probability)[0];
    const snap = {
      date,
      contract: contractCode(date),
      preRate: Math.round(preRate * 1e3) / 1e3,
      postRate: Math.round(quote.post * 1e3) / 1e3,
      impliedMonthlyRate: quote.implied,
      expectedMoves: Math.round((quote.post - preRate) / BP_STEP * 100) / 100,
      dominantScenario: dominant.label,
      scenarios
    };
    preRate = quote.post;
    return snap;
  });
}
function createFallbackSnapshot() {
  const meetings = fallbackMeetings(3.75);
  const today = todayIso2();
  const year = today.slice(0, 4);
  const yearEndMeeting = meetings.find((m) => m.date.startsWith(year) && m.date.slice(5, 7) === "12") ?? meetings[meetings.length - 1];
  const yearEndMoves = yearEndMeeting ? Math.round((yearEndMeeting.postRate - 3.88) / BP_STEP * 100) / 100 : 0;
  return {
    asOfDate: today,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: "fallback",
    sourceLabel: "Mode d\xE9monstration - CME non connect\xE9",
    effr: 3.88,
    targetLower: 3.75,
    targetUpper: 4,
    meetings,
    yearEndMoves,
    yearEndDate: yearEndMeeting?.date ?? null,
    dataNote: "Les probabilit\xE9s affich\xE9es sont un exemple calcul\xE9 \xE0 partir de la m\xE9thode FedWatch. Branche une source CME officielle pour passer aux donn\xE9es de march\xE9 du jour."
  };
}
async function createLiveSnapshot2() {
  const upcomingMeetings = FOMC_MEETINGS.filter((date) => date >= todayIso2());
  const meetingDates = relevantMeetings(upcomingMeetings);
  const [effr, targetLower, targetUpper, settlements] = await Promise.all([
    fetchFredSeries("EFFR"),
    fetchFredSeries("DFEDTARL"),
    fetchFredSeries("DFEDTARU"),
    fetchSettlements(meetingDates)
  ]);
  const meetings = calculateMeetings(
    settlements,
    meetingDates,
    effr,
    targetLower
  );
  if (!meetings.length) throw new Error("No upcoming FOMC meetings could be calculated from CME settlements");
  const year = Number(todayIso2().slice(0, 4));
  const yearEndMeeting = meetings.find((meeting) => meeting.date.startsWith(String(year)) && meeting.date.slice(5, 7) === "12") ?? meetings[meetings.length - 1];
  return {
    asOfDate: todayIso2(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: "massive+fred",
    sourceLabel: "Massive futures + FRED API",
    effr: Math.round(effr * 1e3) / 1e3,
    targetLower,
    targetUpper,
    meetings,
    yearEndMoves: yearEndMeeting ? Math.round((yearEndMeeting.postRate - effr) / BP_STEP * 100) / 100 : 0,
    yearEndDate: yearEndMeeting?.date ?? null,
    dataNote: "Probabilit\xE9s estim\xE9es \xE0 partir des settlements des futures 30-Day Fed Funds fournis par Massive. Les taux EFFR et les bornes cibles proviennent de l\u2019API officielle FRED."
  };
}
async function refreshFedDashboard() {
  let snapshot;
  try {
    snapshot = await createLiveSnapshot2();
  } catch (error) {
    console.warn("[FedWatch] Live provider unavailable, using fallback:", error instanceof Error ? error.message : error);
    snapshot = createFallbackSnapshot();
  }
  return { snapshot };
}

// server/_core/trpc.ts
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;

// server/routers.ts
var appRouter = router({
  fed: router({
    dashboard: publicProcedure.query(() => refreshFedDashboard()),
    refresh: publicProcedure.mutation(() => refreshFedDashboard())
  }),
  ecb: router({
    dashboard: publicProcedure.query(() => refreshEcbDashboard()),
    refresh: publicProcedure.mutation(() => refreshEcbDashboard())
  })
});

// server/_core/context.ts
async function createContext(opts) {
  return { req: opts.req };
}

// api/trpc/[trpc].ts
async function handler(req, res) {
  const url = req.url || "";
  const path3 = url.replace(/^.*\/trpc\/?/, "").split("?")[0] || "";
  return nodeHTTPRequestHandler({
    req,
    res,
    router: appRouter,
    createContext,
    path: path3
  });
}
export {
  handler as default
};
