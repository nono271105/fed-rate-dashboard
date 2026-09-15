import { getEcbSnapshotHistory, getLatestEcbSnapshot, saveEcbSnapshot } from "./db";

const ECB_RATES_URL = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html";
const ECB_ESTR_URL = "https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_short-term_rate/html/index.en.html";
const ECB_CALENDAR_URL = "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html";
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
  source: "ecb+market" | "fallback";
  sourceLabel: string;
  depositRate: number;
  refinancingRate: number;
  marginalRate: number;
  estr: number;
  estrDate: string;
  meetings: EcbMeeting[];
  yearEndMoves: number;
  yearEndDate: string | null;
  dataNote: string;
};

function todayIso() { return new Date().toISOString().slice(0, 10); }
function number(value: string) { const parsed = Number(value.replace(/,/g, ".").replace(/[^0-9.-]/g, "")); return Number.isFinite(parsed) ? parsed : null; }
function formatDate(date: string) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date(date);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(parsed);
}
function cleanText(html: string) { return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " "); }

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "RateSignals/1.0" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function fetchOfficialRates() {
  const text = cleanText(await fetchText(ECB_RATES_URL));
  const match = text.match(/2026\s*16\s*Sep\.?\s*([0-9.]+)\s*([0-9.]+)\s*-\s*([0-9.]+)/i);
  if (!match) throw new Error("ECB current policy rates not found");
  return { depositRate: number(match[1])!, refinancingRate: number(match[2])!, marginalRate: number(match[3])! };
}

async function fetchEstr() {
  const text = cleanText(await fetchText(ECB_ESTR_URL));
  const match = text.match(/Rate\s+([0-9.]+)\s+Reference date\s+([0-9-]+)/i);
  if (!match) throw new Error("ECB €STR value not found");
  return { estr: number(match[1])!, estrDate: match[2] };
}

async function fetchOfficialMeetings() {
  const text = cleanText(await fetchText(ECB_CALENDAR_URL));
  const matches = Array.from(text.matchAll(/(\d{2})\/(\d{2})\/(20\d{2})\s+Governing Council of the ECB: monetary policy meeting[\s\S]{0,180}?Day 1[\s\S]{0,180}?\n?\s*(\d{2})\/(\d{2})\/(20\d{2})/gi));
  const dates = matches.map((match) => `${match[6]}-${match[5]}-${match[4]}`);
  const simpler = Array.from(text.matchAll(/(\d{2})\/(\d{2})\/(20\d{2})\s+Governing Council of the ECB: monetary policy meeting/gi)).map((match) => `${match[3]}-${match[2]}-${match[1]}`);
  return Array.from(new Set([...dates, ...simpler])).filter((date) => date >= todayIso()).slice(0, 10);
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
        { label: roundedMove > 0 ? `Hausse de ${roundedMove} bp` : roundedMove < 0 ? `Baisse de ${Math.abs(roundedMove)} bp` : "Maintien", probability: moveProbability, moveBps: roundedMove, targetRate },
        { label: "Maintien / autre scénario", probability: hold, moveBps: 0, targetRate: depositRate },
      ],
    };
  });
  const latestByDate = new Map<string, EcbMeeting>();
  parsed.forEach((meeting) => latestByDate.set(meeting.date, meeting));
  return Array.from(latestByDate.values()).filter((meeting) => meeting.date >= todayIso()).slice(0, 8);
}

function fallbackSnapshot(): EcbDashboardSnapshot {
  const meetings: EcbMeeting[] = [
    { date: "2026-10-29", impliedRate: 2.69, moveBps: 19, moveProbability: 74.8, scenarios: [{ label: "Hausse de 25 bp", probability: 74.8, moveBps: 25, targetRate: 2.75 }, { label: "Maintien", probability: 25.2, moveBps: 0, targetRate: 2.5 }] },
    { date: "2026-12-17", impliedRate: 2.89, moveBps: 39, moveProbability: 80.4, scenarios: [{ label: "Hausse de 50 bp", probability: 52.7, moveBps: 50, targetRate: 3 }, { label: "Hausse de 25 bp", probability: 41.6, moveBps: 25, targetRate: 2.75 }, { label: "Maintien", probability: 5.7, moveBps: 0, targetRate: 2.5 }] },
    { date: "2027-02-04", impliedRate: 3.06, moveBps: 56, moveProbability: 69.6, scenarios: [{ label: "Hausse", probability: 69.6, moveBps: 50, targetRate: 3 }, { label: "Maintien / autre scénario", probability: 30.4, moveBps: 0, targetRate: 2.5 }] },
  ];
  return { asOfDate: todayIso(), updatedAt: new Date().toISOString(), source: "fallback", sourceLabel: "ECB officiel + pricing public en cache", depositRate: 2.5, refinancingRate: 2.65, marginalRate: 2.9, estr: 2.189, estrDate: "2026-09-11", meetings, yearEndMoves: 1.55, yearEndDate: "2026-12-17", dataNote: "Les taux directeurs et €STR sont officiels ECB. Le pricing par réunion provient d’un agrégateur public OIS et reste une approximation indépendante de l’ECB." };
}

async function createLiveSnapshot(): Promise<EcbDashboardSnapshot> {
  const [rates, estr, calendar, market] = await Promise.all([fetchOfficialRates(), fetchEstr(), fetchOfficialMeetings(), fetchText(MARKET_PRICING_URL)]);
  if (/Just a moment|Enable JavaScript|challenge-platform|cloudflare/i.test(market)) throw new Error("Public ECB pricing provider is behind an anti-bot challenge");
  const meetings = parseMarketMeetings(market, rates.depositRate);
  const filtered = meetings.length ? meetings : calendar.slice(0, 4).map((date) => ({ date, impliedRate: rates.depositRate, moveBps: 0, moveProbability: 0, scenarios: [{ label: "Pricing indisponible", probability: 0, moveBps: 0, targetRate: rates.depositRate }] }));
  const yearEnd = filtered.find((meeting) => meeting.date.startsWith(todayIso().slice(0, 4)) && meeting.date.slice(5, 7) === "12") ?? filtered[filtered.length - 1];
  return { asOfDate: todayIso(), updatedAt: new Date().toISOString(), source: "ecb+market", sourceLabel: "ECB officiel + OIS public", ...rates, ...estr, meetings: filtered, yearEndMoves: yearEnd ? Math.round(((yearEnd.impliedRate - rates.depositRate) / 0.25) * 100) / 100 : 0, yearEndDate: yearEnd?.date ?? null, dataNote: "Taux directeurs et €STR : ECB. Pricing : agrégateur public d’OIS, actualisé indépendamment et susceptible de différer d’autres fournisseurs." };
}

export async function refreshEcbDashboard(force = false) {
  const date = todayIso();
  if (!force) {
    const cached = await getLatestEcbSnapshot();
    if (cached?.snapshotDate === date) return { snapshot: JSON.parse(cached.payload) as EcbDashboardSnapshot, history: await getEcbSnapshotHistory(30) };
  }
  let snapshot: EcbDashboardSnapshot;
  try { snapshot = await createLiveSnapshot(); } catch (error) { console.warn("[ECB] Live provider unavailable:", error instanceof Error ? error.message : error); snapshot = fallbackSnapshot(); }
  await saveEcbSnapshot({ snapshotDate: date, source: snapshot.source, payload: JSON.stringify(snapshot) });
  return { snapshot, history: await getEcbSnapshotHistory(30) };
}

export const ecbTest = { parseMarketMeetings };
