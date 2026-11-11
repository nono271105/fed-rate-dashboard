import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronRight, CircleHelp, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

type Scenario = { probability: number; moveBps: number; label: string; targetRate?: number };
type FedMeeting = { date: string; contract: string; preRate: number; postRate: number; expectedMoves: number; dominantScenario: string; scenarios: Scenario[] };
type EcbMeeting = { date: string; impliedRate: number; moveBps: number; moveProbability: number; scenarios: Array<Scenario & { targetRate: number }> };

function dateLabel(date: string | null | undefined) { return date ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00Z`)) : " - "; }
function rateLabel(value: number | null | undefined) { return typeof value === "number" ? `${value.toFixed(2)} %` : " - "; }
function cleanLabel(value: string) { return value.replace(/[\u2014\u2013\u00b7]/g, " - ").replace(/\s+/g, " ").replace(/\s+-\s+/g, " - ").trim(); }
function moveLabel(moveBps: number) { return moveBps > 0 ? `+${moveBps} bp` : moveBps < 0 ? `${moveBps} bp` : "0 bp"; }
function moveName(moveBps: number) { return moveBps > 0 ? "Hausse" : moveBps < 0 ? "Baisse" : "Maintien"; }
function moveIcon(moveBps: number) { return moveBps > 0 ? <ArrowUpRight size={14} /> : moveBps < 0 ? <ArrowDownRight size={14} /> : <span className="hold-symbol" />; }

function ScenarioRows({ scenarios, accent }: { scenarios: Scenario[]; accent: "fed" | "ecb" }) {
  return <div className="scenario-list">{scenarios.map((scenario, index) => <div className="scenario-row" key={`${scenario.moveBps}-${index}`}><div className="scenario-label"><span className={`scenario-icon scenario-icon--${scenario.moveBps > 0 ? "up" : scenario.moveBps < 0 ? "down" : "hold"}`}>{moveIcon(scenario.moveBps)}</span><span>{moveName(scenario.moveBps)}</span><b>{moveLabel(scenario.moveBps)}</b></div><div className="scenario-track"><span className={`scenario-fill scenario-fill--${accent}`} style={{ width: `${Math.min(100, scenario.probability)}%` }} /></div><strong>{scenario.probability.toFixed(1)}%</strong></div>)}</div>;
}

function SourceNote({ children, accent }: { children: React.ReactNode; accent: "fed" | "ecb" }) { return <div className={`source-note source-note--${accent}`}><Info size={17} /><p>{children}</p></div>; }

function FedView({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const query = trpc.fed.dashboard.useQuery(undefined, { staleTime: 60_000 });
  const snapshot = query.data?.snapshot;
  if (query.isLoading) return <LoadingState label="Récupération des probabilités Fed…" />;
  if (!snapshot) return <ErrorState label="Les données Fed ne sont pas disponibles." onRefresh={onRefresh} />;
  const next = snapshot.meetings[0] as FedMeeting | undefined;
  const following = snapshot.meetings[1] as FedMeeting | undefined;
  const hike = next?.scenarios.find((scenario) => scenario.moveBps > 0)?.probability ?? 0;
  const hold = next?.scenarios.find((scenario) => scenario.moveBps === 0)?.probability ?? 0;
  const cut = next?.scenarios.find((scenario) => scenario.moveBps < 0)?.probability ?? 0;
  return <>
    <HeaderBlock eyebrow="Fed - Réserve fédérale" title={<>Ce que le marché <em>price</em> pour la Fed.</>} description="Probabilités implicites des décisions du FOMC, calculées à partir des contrats 30-Day Fed Funds." />
    <section className="metric-grid" aria-label="Résumé Fed">
      <Metric label="Taux effectif EFFR" value={rateLabel(snapshot.effr)} detail={`Target range - ${rateLabel(snapshot.targetLower)} - ${rateLabel(snapshot.targetUpper)}`} />
      <Metric label="Prochaine réunion" value={dateLabel(next?.date)} detail={`${next?.contract ?? " - "} - ${next ? `${next.expectedMoves >= 0 ? "+" : ""}${next.expectedMoves.toFixed(2)} mouvement(s)` : " - "}`} />
      <Metric label="Horizon global" value={`${snapshot.yearEndMoves.toFixed(2)} × 25 bp`} detail={`Jusqu’au ${dateLabel(snapshot.yearEndDate)}`} accent="orange" />
    </section>
    <SectionHeading eyebrow="01 - Réunions" title="Trois niveaux de lecture" />
    <section className="meeting-grid">
      {next && <MeetingCard accent="fed" eyebrow="Prochaine réunion" title={dateLabel(next.date)} code={next.contract} before={next.preRate} after={next.postRate} scenarios={next.scenarios} dominant={cleanLabel(next.dominantScenario)} />}
      {following && <MeetingCard accent="fed" eyebrow="Réunion suivante" title={dateLabel(following.date)} code={following.contract} before={following.preRate} after={following.postRate} scenarios={following.scenarios} dominant={cleanLabel(following.dominantScenario)} />}
      <HorizonCard accent="fed" reference={`Target ${rateLabel(snapshot.targetLower)} - ${rateLabel(snapshot.targetUpper)}`} title="Fin d’année" value={snapshot.yearEndMoves} date={snapshot.yearEndDate} description="Une moyenne de marché : le nombre de hausses ou baisses de 25 bp équivalentes intégrées dans la courbe." />
    </section>
    <section className="detail-grid">
      <DistributionCard title="Prochaine décision" eyebrow="Lecture immédiate" scenarios={[{ moveBps: 25, probability: hike, label: "" }, { moveBps: 0, probability: hold, label: "" }, { moveBps: -25, probability: cut, label: "" }]} accent="fed" />
    </section>
    <SourceNote accent="fed"><strong>{snapshot.sourceLabel}.</strong> {snapshot.dataNote} <a href="https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html" target="_blank" rel="noreferrer">Méthode CME FedWatch <ChevronRight size={14} /></a></SourceNote>
    {refreshing && <span className="refresh-status"><RefreshCw size={14} className="spin" /> Actualisation…</span>}
  </>;
}

function EcbView({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const query = trpc.ecb.dashboard.useQuery(undefined, { staleTime: 60_000 });
  const snapshot = query.data?.snapshot;
  if (query.isLoading) return <LoadingState label="Récupération des taux BCE et du pricing…" />;
  if (!snapshot) return <ErrorState label="Les données BCE ne sont pas disponibles." onRefresh={onRefresh} />;
  const next = snapshot.meetings[0] as EcbMeeting | undefined;
  const following = snapshot.meetings[1] as EcbMeeting | undefined;
  return <>
    <HeaderBlock eyebrow="BCE - Banque centrale européenne" title={<>Ce que le marché <em className="ecb-ink">price</em> pour la BCE.</>} description={snapshot.marketPricingAvailable ? "Taux officiels de l’ECB et trajectoire implicite du taux de dépôt, réunion par réunion." : "Taux officiels de l’ECB à jour. Les probabilités de marché ne sont pas disponibles actuellement."} />
    <section className="metric-grid" aria-label="Résumé BCE">
      <Metric label="Taux de dépôt" value={rateLabel(snapshot.depositRate)} detail={`MRO ${rateLabel(snapshot.refinancingRate)} - facilité marginale ${rateLabel(snapshot.marginalRate)}`} accent="violet" />
      <Metric label="Dernier €STR" value={rateLabel(snapshot.estr)} detail={`Référence ECB - ${dateLabel(snapshot.estrDate)}`} />
      <Metric label="Horizon global" value={snapshot.yearEndMoves === null ? "Indisponible" : `${snapshot.yearEndMoves.toFixed(2)} × 25 bp`} detail={snapshot.yearEndDate ? `Jusqu’au ${dateLabel(snapshot.yearEndDate)}` : "Pricing OIS indisponible"} accent="violet" />
    </section>
    {snapshot.marketPricingAvailable && <>
      <SectionHeading eyebrow="01 - Réunions" title="Trajectoire implicite BCE" />
      <section className="meeting-grid">
        {next && <MeetingCard accent="ecb" eyebrow="Prochaine réunion" title={dateLabel(next.date)} code="ECB" before={snapshot.depositRate} after={next.impliedRate} scenarios={next.scenarios} dominant={`${next.moveProbability.toFixed(1)}% - ${moveName(next.moveBps)}`} />}
        {following && <MeetingCard accent="ecb" eyebrow="Réunion suivante" title={dateLabel(following.date)} code="ECB" before={snapshot.depositRate} after={following.impliedRate} scenarios={following.scenarios} dominant={`${following.moveProbability.toFixed(1)}% - ${moveName(following.moveBps)}`} />}
        {snapshot.yearEndMoves !== null && <HorizonCard accent="ecb" reference={`Taux de dépôt ${rateLabel(snapshot.depositRate)}`} title="Fin d’année" value={snapshot.yearEndMoves} date={snapshot.yearEndDate} description="Variation cumulée équivalente de 25 bp, déduite du taux de dépôt implicite pour la réunion de décembre." />}
      </section>
      <section className="detail-grid">
        <DistributionCard title="Prochaine décision" eyebrow="Lecture immédiate" scenarios={next?.scenarios ?? []} accent="ecb" />
      </section>
    </>}
    <SourceNote accent="ecb"><strong>{snapshot.sourceLabel}.</strong> {snapshot.dataNote} <a href="https://data.ecb.europa.eu/help/api/overview" target="_blank" rel="noreferrer">API SDMX ECB <ChevronRight size={14} /></a></SourceNote>
    {refreshing && <span className="refresh-status"><RefreshCw size={14} className="spin" /> Actualisation…</span>}
  </>;
}

function HeaderBlock({ eyebrow, title, description }: { eyebrow: string; title: React.ReactNode; description: string }) { return <section className="hero-row"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="hero-copy">{description}</p></div></section>; }
function Metric({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: "orange" | "violet" }) { return <Card className={`metric-card ${accent ? `metric-card--${accent}` : ""}`}><span className="metric-label">{label}</span><strong>{value}</strong><small>{detail}</small></Card>; }
function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) { return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>; }
function MeetingCard({ accent, eyebrow, title, code, before, after, scenarios, dominant }: { accent: "fed" | "ecb"; eyebrow: string; title: string; code: string; before: number; after: number; scenarios: Scenario[]; dominant: string }) { return <Card className={`meeting-card meeting-card--${accent}`}><div className="meeting-top"><div><p className="card-kicker">{eyebrow}</p><h3>{title}</h3></div><span className="code-chip">{code}</span></div><div className="rate-pair"><div><span>Avant</span><strong>{rateLabel(before)}</strong></div><ChevronRight size={17} /><div><span>Implicite après</span><strong className="accent-value">{rateLabel(after)}</strong></div></div><ScenarioRows scenarios={scenarios} accent={accent} /><div className="dominant"><span>Scénario dominant</span><strong>{dominant}</strong></div></Card>; }
function HorizonCard({ accent, reference, title, value, date, description }: { accent: "fed" | "ecb"; reference: string; title: string; value: number; date: string | null; description: string }) { return <Card className={`horizon-card horizon-card--${accent}`}><span className="horizon-reference">{reference}</span><p className="card-kicker">Horizon global</p><h3>{title}</h3><strong className="horizon-value">{value.toFixed(2)} <small>x 25 bp</small></strong><p>{description}</p><span className="horizon-date"><CalendarDays size={15} /> {dateLabel(date)}</span></Card>; }
function DistributionCard({ title, eyebrow, scenarios, accent }: { title: string; eyebrow: string; scenarios: Scenario[]; accent: "fed" | "ecb" }) { const dominant = scenarios.length ? Math.max(...scenarios.map((s) => s.probability)) : 0; return <Card className="distribution-card"><div className="card-head"><div><p className="card-kicker">{eyebrow}</p><h3>{title}</h3></div><CircleHelp size={17} /></div><div className={`dominant-number dominant-number--${accent}`}>{dominant.toFixed(1)}% <small>scénario dominant</small></div><ScenarioRows scenarios={scenarios} accent={accent} /></Card>; }
function LoadingState({ label }: { label: string }) { return <div className="state-panel"><RefreshCw size={20} className="spin" /><span>{label}</span></div>; }
function ErrorState({ label, onRefresh }: { label: string; onRefresh: () => void }) { return <div className="state-panel state-panel--error"><Info size={20} /><span>{label}</span><Button variant="outline" onClick={onRefresh}>Réessayer</Button></div>; }

export default function Home() {
  const [market, setMarket] = useState<"fed" | "ecb">("fed");
  const fedRefresh = trpc.fed.refresh.useMutation({ onSuccess: () => toast.success("Données Fed actualisées"), onError: () => toast.error("Actualisation Fed impossible") });
  const ecbRefresh = trpc.ecb.refresh.useMutation({ onSuccess: () => toast.success("Données BCE actualisées"), onError: () => toast.error("Actualisation BCE impossible") });
  const refreshing = fedRefresh.isPending || ecbRefresh.isPending;
  const refresh = () => market === "fed" ? fedRefresh.mutate() : ecbRefresh.mutate();
  return <div className="app-shell"><header className="topbar"><a className="brand-lockup" href="/" aria-label="Rate Signals, accueil"><span className="brand-mark">RS</span><span><strong>Rate Signals</strong><small>Market-implied rates</small></span></a><nav className="market-tabs" aria-label="Marchés" role="tablist"><button role="tab" aria-selected={market === "fed"} className={market === "fed" ? "market-tab market-tab--active" : "market-tab"} onClick={() => setMarket("fed")}><span className="tab-icon tab-icon--fed" />Fed</button><button role="tab" aria-selected={market === "ecb"} className={market === "ecb" ? "market-tab market-tab--active market-tab--ecb" : "market-tab market-tab--ecb"} onClick={() => setMarket("ecb")}><span className="tab-icon tab-icon--ecb" />BCE</button></nav><div className="topbar-actions"><Button className="refresh-button" onClick={refresh} disabled={refreshing} aria-label="Actualiser les données"><RefreshCw size={16} className={refreshing ? "spin" : ""} /><span>Actualiser</span></Button></div></header><main className={`dashboard-content dashboard-content--${market}`}>{market === "fed" ? <FedView onRefresh={refresh} refreshing={refreshing} /> : <EcbView onRefresh={refresh} refreshing={refreshing} />}</main><footer className="footer"><span><a href="https://www.ecb.europa.eu/" target="_blank" rel="noreferrer">ECB</a> - <a href="https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html" target="_blank" rel="noreferrer">CME FedWatch</a></span></footer></div>;
}
