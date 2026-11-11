const ECB_DATA_URL = "https://data-api.ecb.europa.eu/service/data";
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
  source: "ecb+market" | "ecb" | "fallback";
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

function todayIso() { return new Date().toISOString().slice(0, 10); }
function number(value: string) { const normalized = value.replace(/,/g, ".").replace(/[^0-9.-]/g, ""); if (!normalized || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null; const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : null; }
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

async function fetchSdmxObservation(series: string) {
  const url = new URL(`${ECB_DATA_URL}/${series}`);
  url.searchParams.set("lastNObservations", "5");
  url.searchParams.set("format", "csvdata");
  const response = await fetch(url, { headers: { Accept: "text/csv" } });
  if (!response.ok) throw new Error(`ECB SDMX series ${series} returned ${response.status}`);
  const observation = latestSdmxObservation(await response.text());
  if (!observation) throw new Error(`ECB SDMX series ${series} returned no numeric observation`);
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
  const allMeetings: EcbMeeting[] = [
    { date: "2026-10-29", impliedRate: 2.69, moveBps: 19, moveProbability: 74.8, scenarios: [{ label: "Hausse de 25 bp", probability: 74.8, moveBps: 25, targetRate: 2.75 }, { label: "Maintien", probability: 25.2, moveBps: 0, targetRate: 2.5 }] },
    { date: "2026-12-17", impliedRate: 2.89, moveBps: 39, moveProbability: 80.4, scenarios: [{ label: "Hausse de 50 bp", probability: 52.7, moveBps: 50, targetRate: 3 }, { label: "Hausse de 25 bp", probability: 41.6, moveBps: 25, targetRate: 2.75 }, { label: "Maintien", probability: 5.7, moveBps: 0, targetRate: 2.5 }] },
    { date: "2027-02-04", impliedRate: 3.06, moveBps: 56, moveProbability: 69.6, scenarios: [{ label: "Hausse", probability: 69.6, moveBps: 50, targetRate: 3 }, { label: "Maintien / autre scénario", probability: 30.4, moveBps: 0, targetRate: 2.5 }] },
  ];
  const meetings = allMeetings.filter((meeting) => meeting.date >= todayIso());
  const yearEnd = meetings.find((meeting) => meeting.date.startsWith(todayIso().slice(0, 4)) && meeting.date.slice(5, 7) === "12") ?? meetings[meetings.length - 1];
  return { asOfDate: todayIso(), updatedAt: new Date().toISOString(), source: "fallback", sourceLabel: "Données de démonstration - BCE indisponible", marketPricingAvailable: true, depositRate: 2.5, refinancingRate: 2.65, marginalRate: 2.9, estr: 2.189, estrDate: "2026-09-11", meetings, yearEndMoves: yearEnd ? Math.round(((yearEnd.impliedRate - 2.5) / 0.25) * 100) / 100 : 0, yearEndDate: yearEnd?.date ?? null, dataNote: "Valeurs de démonstration prédéfinies : elles ne représentent ni les taux courants ni le pricing actuel du marché." };
}

async function createLiveSnapshot(): Promise<EcbDashboardSnapshot> {
  const [rates, estr] = await Promise.all([fetchOfficialRates(), fetchEstr()]);
  let meetings: EcbMeeting[] = [];
  try {
    const market = await fetchText(MARKET_PRICING_URL);
    if (!/Just a moment|Enable JavaScript|challenge-platform|cloudflare/i.test(market)) {
      meetings = parseMarketMeetings(market, rates.depositRate);
    }
    if (!meetings.length) throw new Error("OIS provider returned no upcoming meetings");
  } catch (error) {
    console.warn("[ECB] Market pricing unavailable:", error instanceof Error ? error.message : error);
  }
  const yearEnd = meetings.find((meeting) => meeting.date.startsWith(todayIso().slice(0, 4)) && meeting.date.slice(5, 7) === "12") ?? meetings[meetings.length - 1];
  const marketPricingAvailable = meetings.length > 0;
  return {
    asOfDate: todayIso(),
    updatedAt: new Date().toISOString(),
    source: marketPricingAvailable ? "ecb+market" : "ecb",
    sourceLabel: marketPricingAvailable ? "ECB SDMX officiel + pricing OIS" : "ECB SDMX officiel - pricing OIS indisponible",
    marketPricingAvailable,
    ...rates,
    ...estr,
    meetings,
    yearEndMoves: yearEnd ? Math.round(((yearEnd.impliedRate - rates.depositRate) / 0.25) * 100) / 100 : null,
    yearEndDate: yearEnd?.date ?? null,
    dataNote: marketPricingAvailable
      ? "Taux directeurs et €STR : API SDMX officielle de l’ECB. Pricing par réunion : fournisseur OIS tiers, indépendant et non officiel."
      : "Les taux directeurs et le €STR sont à jour via l’API SDMX officielle de l’ECB. Les probabilités de décision ne sont pas publiées par l’ECB : le fournisseur OIS de marché est actuellement indisponible.",
  };
}

export async function refreshEcbDashboard() {
  let snapshot: EcbDashboardSnapshot;
  try { snapshot = await createLiveSnapshot(); } catch (error) { console.warn("[ECB] Live provider unavailable:", error instanceof Error ? error.message : error); snapshot = fallbackSnapshot(); }
  return { snapshot };
}

export const ecbTest = { latestSdmxObservation, parseMarketMeetings, fallbackSnapshot };
