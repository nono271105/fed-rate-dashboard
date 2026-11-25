// server/_core/vercel.ts
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
var ECB_WATCH_URL = "https://ecb-watch.eu/probabilities";
var MARKET_PRICING_URL = "https://rateprobability.com/ecb";
var CACHE_DIR = path.join(os.tmpdir(), "rates-cache");
var CACHE_FILE = path.join(CACHE_DIR, "ecb-cache.json");
var ECB_CACHE_TTL_MS = 15 * 60 * 1e3;
function readPersistentStore() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    }
  } catch {
  }
  return {};
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
function parseEcbWatchProbabilities(payload, depositRate) {
  const absData = payload?.abs_data;
  if (!absData || typeof absData !== "object") return [];
  const today = todayIso();
  const meetings = [];
  for (const [date, dist] of Object.entries(absData)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || !dist || typeof dist !== "object") continue;
    let impliedRate = 0;
    const rawScenarios = [];
    for (const [rateLabel, rawProb] of Object.entries(dist)) {
      const targetRate = number(rateLabel);
      if (targetRate === null || typeof rawProb !== "number" || !Number.isFinite(rawProb)) continue;
      impliedRate += targetRate * rawProb;
      const probPct = Math.round(rawProb * 1e3) / 10;
      if (probPct <= 0) continue;
      const moveBps2 = Math.round((targetRate - depositRate) * 100);
      rawScenarios.push({
        label: moveBps2 > 0 ? `Hausse de ${moveBps2} bp` : moveBps2 < 0 ? `Baisse de ${Math.abs(moveBps2)} bp` : "Maintien",
        probability: probPct,
        moveBps: moveBps2,
        targetRate
      });
    }
    if (!rawScenarios.length) continue;
    rawScenarios.sort((a, b) => b.probability - a.probability);
    const roundedImplied = Math.round(impliedRate * 1e3) / 1e3;
    const moveBps = Math.round((roundedImplied - depositRate) * 100);
    const dominant = rawScenarios[0];
    meetings.push({
      date,
      impliedRate: roundedImplied,
      moveBps,
      moveProbability: dominant.probability,
      scenarios: rawScenarios
    });
  }
  return meetings.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
}
async function createLiveSnapshot() {
  const [rates, estr] = await Promise.all([fetchOfficialRates(), fetchEstr()]);
  let meetings = [];
  let isExternalMarketSource = false;
  let marketSourceDesc = "";
  try {
    const res = await fetch(ECB_WATCH_URL, { headers: { "User-Agent": "RateSignals/1.0", Accept: "application/json" } });
    if (res.ok) {
      const payload = await res.json();
      meetings = parseEcbWatchProbabilities(payload, rates.depositRate);
      if (meetings.length > 0) {
        isExternalMarketSource = true;
        marketSourceDesc = "ECB Watch (\u20ACSTR futures)";
      }
    }
  } catch {
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
    }
  }
  const currentYear = todayIso().slice(0, 4);
  const yearEnd = meetings.find((meeting) => meeting.date.startsWith(currentYear) && meeting.date.slice(5, 7) === "12") ?? meetings[meetings.length - 1];
  const marketPricingAvailable = meetings.length > 0;
  return {
    asOfDate: todayIso(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: isExternalMarketSource ? "ecb+market" : "ecb",
    sourceLabel: isExternalMarketSource ? `ECB SDMX officiel + ${marketSourceDesc}` : "ECB SDMX officiel (pricing march\xE9 indisponible)",
    marketPricingAvailable,
    ...rates,
    ...estr,
    meetings,
    yearEndMoves: yearEnd ? Math.round((yearEnd.impliedRate - rates.depositRate) / 0.25 * 100) / 100 : null,
    yearEndDate: yearEnd?.date ?? null,
    dataNote: isExternalMarketSource ? `Taux directeurs et \u20ACSTR : API SDMX officielle de l\u2019ECB. Probabilit\xE9s par r\xE9union : ${marketSourceDesc}.` : "Taux directeurs et \u20ACSTR en direct via l\u2019API SDMX officielle de l\u2019ECB. Les probabilit\xE9s de march\xE9 sont temporairement indisponibles."
  };
}
async function refreshEcbDashboard() {
  const snapshot = await createLiveSnapshot();
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
  const snapshot = await createLiveSnapshot2();
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

// server/_core/vercel.ts
function handler(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path3 = url.pathname.replace(/^\/api\/trpc\/?/, "");
  return nodeHTTPRequestHandler({
    req,
    res,
    path: path3,
    router: appRouter,
    createContext: () => ({ req })
  });
}
export {
  handler as default
};
