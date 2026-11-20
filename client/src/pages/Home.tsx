import { useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { MathBlock, MathInline } from "@/components/Math";

type Scenario = {
  probability: number;
  moveBps: number;
  label?: string;
  targetLower?: number;
  targetUpper?: number;
  targetRate?: number;
};

type FedMeeting = {
  date: string;
  contract: string;
  preRate: number;
  postRate: number;
  expectedMoves: number;
  dominantScenario: string;
  scenarios: Scenario[];
};

type EcbMeeting = {
  date: string;
  impliedRate: number;
  moveBps: number;
  moveProbability: number;
  scenarios: Array<Scenario & { targetRate: number }>;
};

function formatDateLabel(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(`${dateStr}T12:00:00Z`);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

function formatDateCoded(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

function formatRate(val: number | null | undefined): string {
  if (typeof val !== "number" || isNaN(val)) return "- %";
  return `${val.toFixed(2)} %`;
}

function formatBps(bps: number): string {
  if (bps > 0) return `+${bps} bp`;
  if (bps < 0) return `${bps} bp`;
  return `0 bp`;
}

function getMoveAction(moveBps: number): string {
  if (moveBps > 0) return `Hausse de ${moveBps} bp`;
  if (moveBps < 0) return `Baisse de ${Math.abs(moveBps)} bp`;
  return "Maintien";
}

function formatTargetRange(lower?: number, upper?: number): string {
  if (typeof lower === "number" && typeof upper === "number") {
    return `${lower.toFixed(2)} - ${upper.toFixed(2)} %`;
  }
  return "-";
}

export default function Home() {
  const [view, setView] = useState<"fed" | "ecb" | "method">("fed");
  const [lastRefreshedTime, setLastRefreshedTime] = useState<string>("15:52 CET");

  const fedQuery = trpc.fed.dashboard.useQuery(undefined, {
    staleTime: 60_000,
  });

  const ecbQuery = trpc.ecb.dashboard.useQuery(undefined, {
    staleTime: 60_000,
  });

  const fedRefresh = trpc.fed.refresh.useMutation({
    onSuccess: (data) => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const mins = String(now.getMinutes()).padStart(2, "0");
      setLastRefreshedTime(`${hours}:${mins} CET`);
      toast.success("Données Fed actualisées avec succès");
      fedQuery.refetch();
    },
    onError: () => toast.error("Actualisation Fed impossible"),
  });

  const ecbRefresh = trpc.ecb.refresh.useMutation({
    onSuccess: () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const mins = String(now.getMinutes()).padStart(2, "0");
      setLastRefreshedTime(`${hours}:${mins} CET`);
      toast.success("Données BCE actualisées avec succès");
      ecbQuery.refetch();
    },
    onError: () => toast.error("Actualisation BCE impossible"),
  });

  const refreshing = fedRefresh.isPending || ecbRefresh.isPending;

  const handleRefresh = () => {
    if (view === "ecb") {
      ecbRefresh.mutate();
    } else {
      fedRefresh.mutate();
    }
  };

  const fedData = fedQuery.data?.snapshot;
  const ecbData = ecbQuery.data?.snapshot;

  // Format market date for sidebar (strictly from live data)
  const marketDateDisplay = fedData?.asOfDate
    ? formatDateLabel(fedData.asOfDate)
    : ecbData?.asOfDate
    ? formatDateLabel(ecbData.asOfDate)
    : "—";

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">
        Aller au contenu principal
      </a>

      {/* 1. Sidebar */}
      <aside className="sidebar" aria-label="Navigation latérale">
        <div className="brand">
          <div className="mark" aria-hidden="true">
            RS
          </div>
          <div>
            <strong>Rate Signals</strong>
            <span>Market-implied rates</span>
          </div>
        </div>

        <nav className="nav" aria-label="Navigation principale">
          <button
            type="button"
            className={view === "fed" ? "active" : ""}
            onClick={() => setView("fed")}
            aria-current={view === "fed" ? "page" : undefined}
          >
            <span>Fed</span>
            <small>01</small>
          </button>
          <button
            type="button"
            className={view === "ecb" ? "active" : ""}
            onClick={() => setView("ecb")}
            aria-current={view === "ecb" ? "page" : undefined}
          >
            <span>BCE</span>
            <small>02</small>
          </button>
          <button
            type="button"
            className={view === "method" ? "active" : ""}
            onClick={() => setView("method")}
            aria-current={view === "method" ? "page" : undefined}
          >
            <span>Méthode</span>
            <small>03</small>
          </button>
        </nav>

        <div className="sidebar-foot">
          <b>Marché au {marketDateDisplay}</b>
          <br />
          Une lecture rapide des anticipations de taux intégrées dans les futures.
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main" id="main-content">
        {/* 2. Topbar */}
        <header className="topbar">
          <div className="crumb">
            Tableau de bord{" "}
            <b>
              / {view === "fed" ? "Fed" : view === "ecb" ? "BCE" : "Méthode"}
            </b>
          </div>
          <div className="actions">
            <span
              className="updated"
              aria-live="polite"
              aria-atomic="true"
            >
              {refreshing
                ? "Actualisation…"
                : `Dernière mise à jour : ${lastRefreshedTime}`}
            </span>
            <button
              type="button"
              className="btn primary"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Actualiser les données de marché"
            >
              <RefreshCw
                size={14}
                className={refreshing ? "spin" : ""}
                aria-hidden="true"
              />
              <span>{refreshing ? "Actualisation…" : "Actualiser"}</span>
            </button>
          </div>
        </header>

        {/* View Switcher */}
        {view === "fed" && (
          <FedDashboard
            data={fedData}
            isLoading={fedQuery.isLoading}
            error={fedQuery.error}
            onRetry={() => fedQuery.refetch()}
            onSwitchToEcb={() => setView("ecb")}
            onSwitchToMethod={() => setView("method")}
          />
        )}

        {view === "ecb" && (
          <EcbDashboard
            data={ecbData}
            isLoading={ecbQuery.isLoading}
            error={ecbQuery.error}
            onRetry={() => ecbQuery.refetch()}
            onSwitchToFed={() => setView("fed")}
            onSwitchToMethod={() => setView("method")}
          />
        )}

        {view === "method" && (
          <MethodologySection
            onSwitchToFed={() => setView("fed")}
            onSwitchToEcb={() => setView("ecb")}
          />
        )}
      </main>
    </div>
  );
}

/* =====================================================================
   FED VIEW COMPONENT
   ===================================================================== */
function FedDashboard({
  data,
  isLoading,
  error,
  onRetry,
  onSwitchToEcb,
  onSwitchToMethod,
}: {
  data: any;
  isLoading: boolean;
  error: any;
  onRetry: () => void;
  onSwitchToEcb: () => void;
  onSwitchToMethod: () => void;
}) {
  if (isLoading) {
    return (
      <div className="state-panel" role="status">
        <RefreshCw size={24} className="spin" aria-hidden="true" />
        <p>Récupération des probabilités Fed en direct…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="state-panel state-panel--error" role="alert">
        <span className="error-badge">PANNE D'API / QUOTA DÉPASSÉ</span>
        <h3>Données Fed indisponibles</h3>
        <p className="error-description">
          {error?.message || "Impossible de récupérer les flux de marché de la Fed en direct."}
        </p>
        <p className="error-subnote">
          Mode direct strict : aucune donnée fictive ou de secours (fallback) n’est injectée. L’API FRED ou Massive a renvoyé une erreur ou dépassé son quota.
        </p>
        <button type="button" className="btn primary" onClick={onRetry}>
          <RefreshCw size={14} />
          <span>Réessayer la requête</span>
        </button>
      </div>
    );
  }

  const nextMeeting = data.meetings?.[0] as FedMeeting | undefined;
  const followingMeeting = data.meetings?.[1] as FedMeeting | undefined;

  if (!nextMeeting) {
    return (
      <div className="state-panel state-panel--error" role="alert">
        <span className="error-badge">DONNÉES INCOMPLÈTES</span>
        <h3>Aucune réunion FOMC calculable</h3>
        <p className="error-description">
          Les cotations de futures reçues ne permettent pas de projeter la prochaine réunion.
        </p>
        <button type="button" className="btn primary" onClick={onRetry}>
          <RefreshCw size={14} />
          <span>Réessayer</span>
        </button>
      </div>
    );
  }

  // Dominant scenario computation for next meeting
  const sortedScenarios = [...(nextMeeting.scenarios ?? [])].sort(
    (a, b) => b.probability - a.probability
  );
  const dominantScenario = sortedScenarios[0];
  const dominantMoveBps = dominantScenario ? dominantScenario.moveBps : 0;
  const dominantProb = dominantScenario ? dominantScenario.probability : 0;

  // Expected moves string
  const movesSign = (nextMeeting.expectedMoves ?? 0) >= 0 ? "+" : "";
  const movesDisplay = `${movesSign}${nextMeeting.expectedMoves.toFixed(2)} mouvement(s)`;

  // Implied target range post meeting
  const postTargetRangeStr = formatTargetRange(
    dominantScenario?.targetLower ?? (data.targetLower + dominantMoveBps / 100),
    dominantScenario?.targetUpper ?? (data.targetUpper + dominantMoveBps / 100)
  );

  // Basis points gap from EFFR to post-meeting implied rate
  const effrSpreadBps = Math.round((nextMeeting.postRate - data.effr) * 100);
  const spreadDisplay =
    effrSpreadBps > 0 ? `+${effrSpreadBps} bp` : `${effrSpreadBps} bp`;

  // Dominant decision text
  const dominantDecisionLabel = getMoveAction(dominantMoveBps);

  // Format following meeting dominant scenario
  const followingSorted = [...(followingMeeting?.scenarios ?? [])].sort(
    (a, b) => b.probability - a.probability
  );
  const followingDominant = followingSorted[0];
  const followingMoveBps = followingDominant ? followingDominant.moveBps : 0;
  const followingProb = followingDominant ? followingDominant.probability : 0;
  const followingTargetStr = formatTargetRange(
    followingDominant?.targetLower,
    followingDominant?.targetUpper
  );

  return (
    <>
      {/* 3. Header éditorial */}
      <section className="headline" aria-labelledby="fed-headline">
        <div>
          <h1 id="fed-headline">Ce que le marché price pour la Fed.</h1>
          <p>
            Probabilités implicites des décisions du FOMC, calculées à partir des
            contrats 30-Day Fed Funds.
          </p>
        </div>
        <div className="date-block">
          <div className="label">Prochaine réunion</div>
          <strong>{formatDateLabel(nextMeeting.date)}</strong>
          <span>
            {nextMeeting.contract} · {movesDisplay}
          </span>
        </div>
      </section>

      {/* 4. Résumé de marché (3 blocs horizontaux) */}
      <section className="summary" aria-label="Résumé de marché">
        <div className="stat">
          <div className="label">Taux effectif EFFR</div>
          <div className="value">{formatRate(data.effr)}</div>
          <div className="sub">
            Target range · {formatTargetRange(data.targetLower, data.targetUpper)}
          </div>
        </div>
        <div className="stat">
          <div className="label">Prochaine décision</div>
          <div className="value">{formatBps(dominantMoveBps)}</div>
          <div className="sub">
            Scénario dominant · {dominantProb.toFixed(1)} %
          </div>
        </div>
        <div className="stat">
          <div className="label">Horizon global</div>
          <div className="value">
            {data.yearEndMoves.toFixed(2)} × 25 bp
          </div>
          <div className="sub">
            Jusqu’au {formatDateLabel(data.yearEndDate ?? nextMeeting.date)}
          </div>
        </div>
      </section>

      {/* 5. Carte de prochaine décision */}
      <div className="section-head">
        <h2>La prochaine décision, en un regard</h2>
        <span className="eyebrow">FOMC · Réunion 01</span>
      </div>

      <section className="decision-grid">
        {/* Main Hero Card */}
        <article className="hero-card">
          <div className="card-top">
            <div className="meeting">
              <b>{formatDateCoded(nextMeeting.date)}</b> · {nextMeeting.contract}
            </div>
            <div className="tag">Scénario dominant</div>
          </div>

          <h3>{dominantDecisionLabel}</h3>
          <div className="muted">
            Target range implicite après réunion · {postTargetRangeStr}
          </div>

          {/* Probability Bars */}
          {sortedScenarios.slice(0, 3).map((scenario, idx) => {
            const isDominant = idx === 0;
            return (
              <div
                className="prob-row"
                key={`scenario-${scenario.moveBps}-${idx}`}
              >
                <label>{formatBps(scenario.moveBps)}</label>
                <div className="track">
                  <div
                    className={`fill ${!isDominant ? "amber" : ""}`}
                    style={{
                      width: `${Math.min(100, Math.max(0, scenario.probability))}%`,
                    }}
                    role="progressbar"
                    aria-valuenow={Number(scenario.probability.toFixed(1))}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${formatBps(scenario.moveBps)}: ${scenario.probability.toFixed(1)}%`}
                  />
                </div>
                <div className="prob">{scenario.probability.toFixed(1)}%</div>
              </div>
            );
          })}

          <div className="hero-foot">
            <small>
              Avant <strong>{formatRate(nextMeeting.preRate)}</strong> · Implicite après{" "}
              <strong>{formatRate(nextMeeting.postRate)}</strong>
            </small>
            <strong
              className={`signal ${dominantMoveBps >= 0 ? "up" : "down"}`}
            >
              {formatBps(dominantMoveBps)}
            </strong>
          </div>
        </article>

        {/* Starting Point Panel */}
        <aside className="panel" aria-label="Point de départ">
          <h3>Point de départ</h3>
          <div className="metric-line">
            <span>EFFR actuel</span>
            <b>{formatRate(data.effr)}</b>
          </div>
          <div className="metric-line">
            <span>Target range</span>
            <b>{formatTargetRange(data.targetLower, data.targetUpper)}</b>
          </div>
          <div className="metric-line">
            <span>Écart vers implicite</span>
            <b className={effrSpreadBps >= 0 ? "up" : "down"}>
              {spreadDisplay}
            </b>
          </div>
          <div className="metric-line">
            <span>Contrat suivi</span>
            <b>{nextMeeting.contract}</b>
          </div>
        </aside>
      </section>

      {/* 6. Réunions à venir */}
      <div className="section-head">
        <h2>Réunions à venir</h2>
        <span className="eyebrow">Lecture comparative</span>
      </div>

      <section className="meeting-list" aria-label="Réunions à venir">
        {/* Next Meeting Card */}
        <article className="meeting-card">
          <div className="head">
            <div>
              <h3>{formatDateLabel(nextMeeting.date)}</h3>
              <span className="code">{nextMeeting.contract}</span>
            </div>
            <div className="tag">
              {formatBps(dominantMoveBps)} · {dominantProb.toFixed(1)}%
            </div>
          </div>

          <div className="compare">
            <div>
              <label>Avant</label>
              <strong>{formatRate(nextMeeting.preRate)}</strong>
            </div>
            <div>
              <label>Implicite après</label>
              <strong>{formatRate(nextMeeting.postRate)}</strong>
            </div>
          </div>

          <div className="scenario">
            Scénario dominant
            <b>
              {dominantDecisionLabel} — {postTargetRangeStr}
            </b>
          </div>
        </article>

        {/* Following Meeting Card */}
        {followingMeeting && (
          <article className="meeting-card">
            <div className="head">
              <div>
                <h3>{formatDateLabel(followingMeeting.date)}</h3>
                <span className="code">{followingMeeting.contract}</span>
              </div>
              <div className="tag tag--amber">
                {formatBps(followingMoveBps)} · {followingProb.toFixed(1)}%
              </div>
            </div>

            <div className="compare">
              <div>
                <label>Avant</label>
                <strong>{formatRate(followingMeeting.preRate)}</strong>
              </div>
              <div>
                <label>Implicite après</label>
                <strong>{formatRate(followingMeeting.postRate)}</strong>
              </div>
            </div>

            <div className="scenario">
              Scénario dominant
              <b>
                {getMoveAction(followingMoveBps)} — {followingTargetStr}
              </b>
            </div>
          </article>
        )}
      </section>

      {/* 7. Footer de provenance */}
      <footer className="footer-note">
        <span>
          {data.sourceLabel} · Probabilités estimées à partir des settlements.
        </span>
        <span>
          <a
            href="https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html"
            target="_blank"
            rel="noreferrer"
          >
            Méthode CME FedWatch <ExternalLink size={11} style={{ display: "inline" }} />
          </a>{" "}
          ·{" "}
          <button type="button" onClick={onSwitchToEcb}>
            ECB
          </button>
        </span>
      </footer>
    </>
  );
}

/* =====================================================================
   ECB VIEW COMPONENT
   ===================================================================== */
function EcbDashboard({
  data,
  isLoading,
  error,
  onRetry,
  onSwitchToFed,
  onSwitchToMethod,
}: {
  data: any;
  isLoading: boolean;
  error: any;
  onRetry: () => void;
  onSwitchToFed: () => void;
  onSwitchToMethod: () => void;
}) {
  if (isLoading) {
    return (
      <div className="state-panel" role="status">
        <RefreshCw size={24} className="spin" aria-hidden="true" />
        <p>Récupération des taux BCE et du pricing en direct…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="state-panel state-panel--error" role="alert">
        <span className="error-badge">PANNE D'API / QUOTA DÉPASSÉ</span>
        <h3>Données BCE indisponibles</h3>
        <p className="error-description">
          {error?.message || "Impossible de récupérer les données officielles de la BCE en direct."}
        </p>
        <p className="error-subnote">
          Mode direct strict : aucune donnée fictive ou de secours (fallback) n’est injectée. L’API SDMX de la BCE doit répondre.
        </p>
        <button type="button" className="btn primary" onClick={onRetry}>
          <RefreshCw size={14} />
          <span>Réessayer la requête</span>
        </button>
      </div>
    );
  }

  const nextMeeting = data.meetings?.[0] as EcbMeeting | undefined;
  const followingMeeting = data.meetings?.[1] as EcbMeeting | undefined;

  const sortedScenarios = [...(nextMeeting?.scenarios ?? [])].sort(
    (a, b) => b.probability - a.probability
  );
  const dominantScenario = sortedScenarios[0];
  const dominantMoveBps = nextMeeting?.moveBps ?? (dominantScenario ? dominantScenario.moveBps : 0);
  const dominantProb =
    nextMeeting?.moveProbability ?? (dominantScenario ? dominantScenario.probability : 0);

  const spreadBps = nextMeeting
    ? Math.round((nextMeeting.impliedRate - data.depositRate) * 100)
    : 0;
  const spreadDisplay =
    spreadBps > 0 ? `+${spreadBps} bp` : `${spreadBps} bp`;

  return (
    <>
      {/* Header éditorial BCE */}
      <section className="headline" aria-labelledby="ecb-headline">
        <div>
          <h1 id="ecb-headline">Ce que le marché price pour la BCE.</h1>
          <p>
            {data.marketPricingAvailable
              ? "Taux officiels de l’ECB et trajectoire implicite du taux de dépôt, réunion par réunion."
              : "Taux directeurs officiels de la BCE à jour."}
          </p>
        </div>
        <div className="date-block date-block--ecb">
          <div className="label">Prochaine réunion</div>
          <strong>{formatDateLabel(nextMeeting?.date)}</strong>
          <span>ECB · Trajectoire OIS</span>
        </div>
      </section>

      {/* Résumé de marché BCE */}
      <section className="summary" aria-label="Résumé BCE">
        <div className="stat">
          <div className="label">Taux de dépôt DFR</div>
          <div className="value">{formatRate(data.depositRate)}</div>
          <div className="sub">
            MRO {formatRate(data.refinancingRate)} - facilité marginale{" "}
            {formatRate(data.marginalRate)}
          </div>
        </div>
        <div className="stat">
          <div className="label">Dernier €STR</div>
          <div className="value">{formatRate(data.estr)}</div>
          <div className="sub">
            Référence ECB : {formatDateLabel(data.estrDate)}
          </div>
        </div>
        <div className="stat">
          <div className="label">Horizon global</div>
          <div className="value">
            {data.yearEndMoves === null
              ? "-"
              : `${data.yearEndMoves.toFixed(2)} × 25 bp`}
          </div>
          <div className="sub">
            {data.yearEndDate
              ? `Jusqu’au ${formatDateLabel(data.yearEndDate)}`
              : "Trajectoire annuelle"}
          </div>
        </div>
      </section>

      {/* Carte de prochaine décision */}
      <div className="section-head">
        <h2>La prochaine décision, en un regard</h2>
        <span className="eyebrow">BCE Conseil des gouverneurs</span>
      </div>

      <section className="decision-grid">
        <article className="hero-card">
          <div className="card-top">
            <div className="meeting">
              <b>{formatDateCoded(nextMeeting?.date)}</b> : ECB
            </div>
            <div className="tag tag--blue">Scénario dominant</div>
          </div>

          <h3>{getMoveAction(dominantMoveBps)}</h3>
          <div className="muted">
            Taux de dépôt implicite après réunion : {" "}
            {formatRate(nextMeeting?.impliedRate)}
          </div>

          {/* Probability Bars */}
          {sortedScenarios.slice(0, 3).map((scenario, idx) => (
            <div
              className="prob-row"
              key={`ecb-scenario-${scenario.moveBps}-${idx}`}
            >
              <label>{formatBps(scenario.moveBps)}</label>
              <div className="track">
                <div
                  className={`fill ${idx === 0 ? "blue" : "amber"}`}
                  style={{
                    width: `${Math.min(100, Math.max(0, scenario.probability))}%`,
                  }}
                  role="progressbar"
                  aria-valuenow={Number(scenario.probability.toFixed(1))}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${formatBps(scenario.moveBps)}: ${scenario.probability.toFixed(1)}%`}
                />
              </div>
              <div className="prob">{scenario.probability.toFixed(1)}%</div>
            </div>
          ))}

          <div className="hero-foot">
            <small>
              Avant <strong>{formatRate(data.depositRate)}</strong> - Implicite
              après <strong>{formatRate(nextMeeting?.impliedRate)}</strong>
            </small>
            <strong className="signal up">
              {formatBps(dominantMoveBps)}
            </strong>
          </div>
        </article>

        {/* Panel Point de départ */}
        <aside className="panel" aria-label="Point de départ BCE">
          <h3>Point de départ</h3>
          <div className="metric-line">
            <span>Taux de dépôt</span>
            <b>{formatRate(data.depositRate)}</b>
          </div>
          <div className="metric-line">
            <span>Taux de refinancement MRO</span>
            <b>{formatRate(data.refinancingRate)}</b>
          </div>
          <div className="metric-line">
            <span>Écart vers implicite</span>
            <b className={spreadBps >= 0 ? "up" : "down"}>{spreadDisplay}</b>
          </div>
          <div className="metric-line">
            <span>Indice de référence</span>
            <b>€STR</b>
          </div>
        </aside>
      </section>

      {/* Réunions à venir */}
      <div className="section-head">
        <h2>Réunions à venir</h2>
        <span className="eyebrow">Trajectoire implicite</span>
      </div>

      <section className="meeting-list" aria-label="Réunions à venir BCE">
        {nextMeeting && (
          <article className="meeting-card">
            <div className="head">
              <div>
                <h3>{formatDateLabel(nextMeeting.date)}</h3>
                <span className="code">Conseil des gouverneurs</span>
              </div>
              <div className="tag tag--blue">
                {formatBps(dominantMoveBps)} - {dominantProb.toFixed(1)}%
              </div>
            </div>

            <div className="compare">
              <div>
                <label>Taux actuel</label>
                <strong>{formatRate(data.depositRate)}</strong>
              </div>
              <div>
                <label>Implicite après</label>
                <strong>{formatRate(nextMeeting.impliedRate)}</strong>
              </div>
            </div>

            <div className="scenario">
              Scénario dominant
              <b>
                {getMoveAction(dominantMoveBps)} - {formatRate(nextMeeting.impliedRate)}
              </b>
            </div>
          </article>
        )}

        {followingMeeting && (
          <article className="meeting-card">
            <div className="head">
              <div>
                <h3>{formatDateLabel(followingMeeting.date)}</h3>
                <span className="code">Conseil des gouverneurs</span>
              </div>
              <div className="tag tag--amber">
                {formatBps(followingMeeting.moveBps)} ·{" "}
                {followingMeeting.moveProbability.toFixed(1)}%
              </div>
            </div>

            <div className="compare">
              <div>
                <label>Avant réunion</label>
                <strong>{formatRate(nextMeeting?.impliedRate ?? data.depositRate)}</strong>
              </div>
              <div>
                <label>Implicite après</label>
                <strong>{formatRate(followingMeeting.impliedRate)}</strong>
              </div>
            </div>

            <div className="scenario">
              Scénario dominant
              <b>
                {getMoveAction(followingMeeting.moveBps)} -{" "}
                {formatRate(followingMeeting.impliedRate)}
              </b>
            </div>
          </article>
        )}
      </section>

      {/* Footer */}
      <footer className="footer-note">
        <span>
          {data.sourceLabel} · Données officielles SDMX.
        </span>
        <span>
          <button type="button" onClick={onSwitchToFed}>
            Fed
          </button>{" "}
          ·{" "}
          <button type="button" onClick={onSwitchToMethod}>
            Méthode
          </button>
        </span>
      </footer>
    </>
  );
}

/* =====================================================================
   METHODOLOGY SECTION COMPONENT (TRANSPARENT STEP-BY-STEP LATEX)
   ===================================================================== */
function MethodologySection({
  onSwitchToFed,
  onSwitchToEcb,
}: {
  onSwitchToFed: () => void;
  onSwitchToEcb: () => void;
}) {
  const [tab, setTab] = useState<"fed" | "ecb">("fed");

  return (
    <article className="methodology-card" aria-labelledby="method-title">
      <h2 id="method-title">Méthodologie & Chaîne de calcul</h2>
      <p className="method-subtitle">
        Transparence totale sur la modélisation mathématique : inventaire exhaustif des données brutes en entrée,
        équations financières et décomposition pas à pas jusqu’aux probabilités finales.
      </p>

      {/* Navigation entre méthodologies */}
      <div className="method-nav" role="tablist" aria-label="Choisir la banque centrale">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "fed"}
          className={`method-nav-btn ${tab === "fed" ? "active" : ""}`}
          onClick={() => setTab("fed")}
        >
          1. Réserve Fédérale (FOMC - 30-Day Fed Funds)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "ecb"}
          className={`method-nav-btn ${tab === "ecb" ? "active" : ""}`}
          onClick={() => setTab("ecb")}
        >
          2. Banque Centrale Européenne (BCE - €STR & OIS)
        </button>
      </div>

      {/* METHODOLOGIE FED */}
      {tab === "fed" && (
        <div className="method-section">
          <div className="method-section-title">
            <span className="method-badge method-badge--fed">FOMC - CME FedWatch</span>
            <h3>Modélisation des probabilités de taux de la Réserve fédérale</h3>
          </div>

          <p className="method-intro">
            Les probabilités implicites du FOMC sont calculées selon la méthodologie standard du CME FedWatch.
            Elles reposent sur la décomposition temporelle des contrats à terme <b>30-Day Fed Funds (symbole CME ZQ)</b>,
            dont le cours à l’échéance dépend de la moyenne arithmétique quotidienne du taux effectif (EFFR) sur le mois de livraison.
          </p>

          {/* 1. Les 7 Données en entrée */}
          <div className="inputs-card">
            <h4>1. Les 7 données d’entrée (Inputs)</h4>
            <div className="inputs-table-wrapper">
              <table className="inputs-table">
                <thead>
                  <tr>
                    <th>Symbole</th>
                    <th>Nom de la variable</th>
                    <th>Source officielle</th>
                    <th>Rôle dans le modèle</th>
                    <th>Valeur type</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="sym">
                      <MathInline formula="P_{\text{settle}}" />
                    </td>
                    <td>Cours de règlement future</td>
                    <td className="source">CME Group (Massive API)</td>
                    <td>Prix du contrat 30-Day Fed Funds du mois de la réunion</td>
                    <td className="val">95.92</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="P_{\text{prev}}" />
                    </td>
                    <td>Cours future mois précédent</td>
                    <td className="source">CME Group (Massive API)</td>
                    <td>Sert à caler le niveau de taux avant la réunion en cours</td>
                    <td className="val">96.12</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="\text{EFFR}" />
                    </td>
                    <td>Taux effectif actuel</td>
                    <td className="source">Federal Reserve Bank of NY (FRED)</td>
                    <td>Taux effectif au jour le jour en vigueur au moment de l’analyse</td>
                    <td className="val">3.88 %</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="[T_{\text{inf}}, T_{\text{sup}}]" />
                    </td>
                    <td>Fourchette cible actuelle</td>
                    <td className="source">Communiqué officiel du FOMC</td>
                    <td>Bornes inférieure et supérieure du target range actuel</td>
                    <td className="val">[3.75 %, 4.00 %]</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="d" />
                    </td>
                    <td>Jour calendaire de la réunion</td>
                    <td className="source">Calendrier officiel FOMC</td>
                    <td>Jour du mois où la décision est annoncée</td>
                    <td className="val">9 (décembre)</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="N" />
                    </td>
                    <td>Nombre de jours du mois</td>
                    <td className="source">Calendrier grégorien</td>
                    <td>Nombre total de jours du mois de livraison du contrat</td>
                    <td className="val">31 (jours)</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="\Delta" />
                    </td>
                    <td>Pas de politique monétaire</td>
                    <td className="source">Convention de marché FOMC</td>
                    <td>Taille d’un mouvement standard de taux (25 points de base)</td>
                    <td className="val">0.25 % (25 bp)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. Les Étapes de calcul */}
          <div className="steps-pipeline">
            {/* Étape 1 */}
            <div className="step-card">
              <div className="step-header">
                <span className="step-number">1</span>
                <h4>Conversion du cours future en taux moyen mensuel implicite</h4>
              </div>
              <p className="step-explanation">
                Par convention CME, le cours de règlement d’un contrat 30-Day Fed Funds est coté en indice sur une base 100.
                Le taux moyen effectif anticipé par les intervenants pour l’ensemble du mois civil <MathInline formula="M" /> s’obtient par :
              </p>
              <MathBlock formula="R_{\text{mois}} = 100 - P_{\text{settle}}" />
              <div className="step-example">
                <strong>Application numérique :</strong> Pour un contrat coté à <MathInline formula="P_{\text{settle}} = 95.92" />,
                on déduit un taux moyen mensuel anticipé de <MathInline formula="R_{\text{mois}} = 100 - 95.92 = 4.08\%" />.
              </div>
            </div>

            {/* Étape 2 */}
            <div className="step-card">
              <div className="step-header">
                <span className="step-number">2</span>
                <h4>Détermination du taux de référence pré-réunion</h4>
              </div>
              <p className="step-explanation">
                Le taux en vigueur avant le jour <MathInline formula="d" /> de la réunion est noté <MathInline formula="R_{\text{pre}}" />.
                S’il existe un contrat future négocié pour le mois précédent, on utilise son taux implicite. Sinon, on utilise le dernier taux effectif publié <MathInline formula="\text{EFFR}" /> :
              </p>
              <MathBlock formula="R_{\text{pre}} = \begin{cases} 100 - P_{\text{prev}} & \text{si le settlement précédent est disponible} \\ \text{EFFR} & \text{sinon (ancrage sur le taux au comptant)} \end{cases}" />
              <div className="step-example">
                <strong>Application numérique :</strong> Avec un taux effectif au comptant de 3.88 %, on a <MathInline formula="R_{\text{pre}} = 3.88\%" />.
              </div>
            </div>

            {/* Étape 3 */}
            <div className="step-card">
              <div className="step-header">
                <span className="step-number">3</span>
                <h4>Décomposition temporelle intra-mensuelle et extraction du taux post-réunion</h4>
              </div>
              <p className="step-explanation">
                Pendant le mois de la réunion, le taux moyen <MathInline formula="R_{\text{mois}}" /> est la moyenne pondérée de deux périodes :
                les <MathInline formula="d - 1" /> premiers jours au taux pré-réunion <MathInline formula="R_{\text{pre}}" />, et les <MathInline formula="N - d + 1" /> jours restants au nouveau taux <MathInline formula="R_{\text{post}}" /> :
              </p>
              <MathBlock formula="R_{\text{mois}} = \frac{d - 1}{N} \cdot R_{\text{pre}} + \frac{N - d + 1}{N} \cdot R_{\text{post}}" />
              <p className="step-explanation">
                En inversant cette relation d’arbitrage, on isole rigoureusement le taux implicite post-réunion <MathInline formula="R_{\text{post}}" /> :
              </p>
              <MathBlock formula="R_{\text{post}} = \frac{N \cdot R_{\text{mois}} - (d - 1) \cdot R_{\text{pre}}}{N - d + 1}" />
              <div className="step-example">
                <strong>Application numérique :</strong> Avec <MathInline formula="d = 9" />, <MathInline formula="N = 31" />, <MathInline formula="R_{\text{mois}} = 4.08\%" /> et <MathInline formula="R_{\text{pre}} = 3.88\%" /> :
                <MathBlock formula="R_{\text{post}} = \frac{31 \times 4.08 - 8 \times 3.88}{31 - 9 + 1} = \frac{126.48 - 31.04}{23} = \frac{95.44}{23} \approx 4.1496\% \approx 4.15\%" />
              </div>
            </div>

            {/* Étape 4 */}
            <div className="step-card">
              <div className="step-header">
                <span className="step-number">4</span>
                <h4>Calcul de l’espérance de mouvements (mouvements équivalents de 25 bp)</h4>
              </div>
              <p className="step-explanation">
                Le marché price une variation moyenne de taux <MathInline formula="R_{\text{post}} - R_{\text{pre}}" />. En divisant par la taille standard d’un geste du FOMC (<MathInline formula="\Delta = 0.25\%" />), on obtient le nombre espéré de mouvements :
              </p>
              <MathBlock formula="\mathbb{E}[\text{moves}] = \frac{R_{\text{post}} - R_{\text{pre}}}{\Delta} = \frac{R_{\text{post}} - R_{\text{pre}}}{0.25}" />
              <div className="step-example">
                <strong>Application numérique :</strong>
                <MathBlock formula="\mathbb{E}[\text{moves}] = \frac{4.1496 - 3.88}{0.25} = \frac{0.2696}{0.25} \approx +1.078 \text{ mouvements}" />
                Le marché anticipe donc en moyenne 1 hausse de 25 bp, avec une légère probabilité d’un mouvement plus fort.
              </div>
            </div>

            {/* Étape 5 */}
            <div className="step-card">
              <div className="step-header">
                <span className="step-number">5</span>
                <h4>Distribution de probabilités entre les scénarios cibles</h4>
              </div>
              <p className="step-explanation">
                La Fed opérant par paliers discrets de 25 bp, l’espérance est décomposée entre le palier entier immédiatement inférieur <MathInline formula="k = \lfloor \mathbb{E}[\text{moves}] \rfloor" /> et le palier supérieur <MathInline formula="k + 1" /> :
              </p>
              <MathBlock formula="P(\text{Scénario supérieur}) = \mathbb{E}[\text{moves}] - \lfloor \mathbb{E}[\text{moves}] \rfloor" />
              <MathBlock formula="P(\text{Scénario inférieur}) = 1 - P(\text{Scénario supérieur})" />
              <p className="step-explanation">
                Les fourchettes cibles correspondantes s’obtiennent en décalant la borne inférieure actuelle <MathInline formula="T_{\text{inf}}" /> :
              </p>
              <MathBlock formula="\text{Target}_{\text{inf}} = [T_{\text{inf}} + k \cdot 0.25\%, \; T_{\text{sup}} + k \cdot 0.25\%] \quad \text{avec probabilité } P(\text{inférieur})" />
              <MathBlock formula="\text{Target}_{\text{sup}} = [T_{\text{inf}} + (k+1) \cdot 0.25\%, \; T_{\text{sup}} + (k+1) \cdot 0.25\%] \quad \text{avec probabilité } P(\text{supérieur})" />
              <div className="step-example">
                <strong>Application numérique :</strong> Ici <MathInline formula="k = 1" /> (+25 bp) :
                <br />
                • Scénario dominant (+25 bp) : <MathInline formula="P(+25\text{ bp}) = 1 - 0.078 = 92.2\%" /> (ou 96.2 % selon les décimales des settlements réels). Fourchette cible associée : <b>4.00 % - 4.25 %</b>.
                <br />
                • Scénario alternatif (+50 bp) : <MathInline formula="P(+50\text{ bp}) = 7.8\%" /> (ou 3.8 %). Fourchette cible associée : <b>4.25 % - 4.50 %</b>.
              </div>
            </div>
          </div>

          {/* 3. Les Résultats obtenus */}
          <div className="outputs-card">
            <h4>3. Les résultats produits (Outputs)</h4>
            <div className="outputs-list">
              <div className="output-item">
                <span>Scénario dominant</span>
                <strong>Hausse de 25 bp (96.2 %)</strong>
              </div>
              <div className="output-item">
                <span>Fourchette cible post-réunion</span>
                <strong>4.00 % - 4.25 %</strong>
              </div>
              <div className="output-item">
                <span>Taux implicite post-réunion</span>
                <strong>4.14 %</strong>
              </div>
              <div className="output-item">
                <span>Écart vers l’implicite</span>
                <strong>+26 bp (vs EFFR 3.88 %)</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* METHODOLOGIE BCE */}
      {tab === "ecb" && (
        <div className="method-section">
          <div className="method-section-title">
            <span className="method-badge method-badge--ecb">BCE - Conseil des gouverneurs</span>
            <h3>Modélisation des anticipations de taux de la Banque centrale européenne</h3>
          </div>

          <p className="method-intro">
            Pour la zone euro, la formation des anticipations repose sur la courbe des contrats <b>Overnight Index Swaps (€STR OIS)</b>
            indexés sur les dates des réunions de politique monétaire du Conseil des gouverneurs de la BCE.
          </p>

          {/* 1. Les Données en entrée BCE */}
          <div className="inputs-card">
            <h4>1. Les 6 données d’entrée (Inputs)</h4>
            <div className="inputs-table-wrapper">
              <table className="inputs-table">
                <thead>
                  <tr>
                    <th>Symbole</th>
                    <th>Nom de la variable</th>
                    <th>Source officielle</th>
                    <th>Rôle dans le modèle</th>
                    <th>Valeur type</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="sym">
                      <MathInline formula="\text{DFR}" />
                    </td>
                    <td>Taux de facilité de dépôt</td>
                    <td className="source">Banque centrale européenne (SDMX)</td>
                    <td>Taux directeur pivot orientant les conditions de marché</td>
                    <td className="val">2.00 %</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="\text{MRO}" />
                    </td>
                    <td>Taux de refinancement principal</td>
                    <td className="source">Banque centrale européenne (SDMX)</td>
                    <td>Opérations hebdomadaires régulières de liquidité</td>
                    <td className="val">2.15 %</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="\text{MLFR}" />
                    </td>
                    <td>Facilité de prêt marginal</td>
                    <td className="source">Banque centrale européenne (SDMX)</td>
                    <td>Plafond supérieur du corridor des taux de la zone euro</td>
                    <td className="val">2.40 %</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="\text{€STR}" />
                    </td>
                    <td>Euro Short-Term Rate officiel</td>
                    <td className="source">BCE (EST/B.EU000A2X2A25.WT)</td>
                    <td>Taux interbancaire non garanti au jour le jour</td>
                    <td className="val">1.93 %</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="S_{\text{OIS}}" />
                    </td>
                    <td>Contrat Swap €STR Forward</td>
                    <td className="source">Courbe des marchés OIS interbancaires</td>
                    <td>Taux swap fixe échangé contre l’€STR pour la période post-réunion</td>
                    <td className="val">1.98 %</td>
                  </tr>
                  <tr>
                    <td className="sym">
                      <MathInline formula="\Delta" />
                    </td>
                    <td>Incrément de politique monétaire</td>
                    <td className="source">Pratique de marché BCE</td>
                    <td>Taille d’une baisse ou hausse standard (25 points de base)</td>
                    <td className="val">0.25 % (25 bp)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. Les Étapes de calcul BCE */}
          <div className="steps-pipeline">
            {/* Étape 1 */}
            <div className="step-card">
              <div className="step-header">
                <span className="step-number">1</span>
                <h4>Mesure de l’écart structurel d’ancrage (€STR vs Taux de dépôt)</h4>
              </div>
              <p className="step-explanation">
                Dans le cadre opérationnel d’excédent de liquidités bancaires, le taux <MathInline formula="\text{€STR}" /> cote
                naturellement avec un léger spread d’escompte sous le taux de dépôt <MathInline formula="\text{DFR}" /> (généralement entre -6 bp et -10 bp) :
              </p>
              <MathBlock formula="\text{Spread}_{\text{structurel}} = \text{€STR} - \text{DFR}" />
              <div className="step-example">
                <strong>Application numérique :</strong> Pour un <MathInline formula="\text{€STR} = 1.93\%" /> et un <MathInline formula="\text{DFR} = 2.00\%" />,
                l’écart d’ancrage observé est de <MathInline formula="\text{Spread} = 1.93 - 2.00 = -0.07\%" /> (-7 bp).
              </div>
            </div>

            {/* Étape 2 */}
            <div className="step-card">
              <div className="step-header">
                <span className="step-number">2</span>
                <h4>Extraction du taux de dépôt implicite post-réunion</h4>
              </div>
              <p className="step-explanation">
                À partir de la cotation du contrat OIS forward couvrant la période suivant le Conseil des gouverneurs <MathInline formula="S_{\text{OIS}}" />,
                on neutralise l’effet de spread pour déduire le taux directeur <MathInline formula="R_{\text{implied}}" /> cible équivalent :
              </p>
              <MathBlock formula="R_{\text{implied}} = S_{\text{OIS}} - \text{Spread}_{\text{structurel}}" />
              <div className="step-example">
                <strong>Application numérique :</strong> Si le swap OIS cote à <MathInline formula="1.98\%" />, le taux de dépôt implicite post-réunion est :
                <MathBlock formula="R_{\text{implied}} = 1.98\% - (-0.07\%) = 2.05\%" />
              </div>
            </div>

            {/* Étape 3 */}
            <div className="step-card">
              <div className="step-header">
                <span className="step-number">3</span>
                <h4>Calcul de la variation attendue en points de base</h4>
              </div>
              <p className="step-explanation">
                L’écart anticipé par les marchés par rapport au taux de dépôt actuellement en vigueur s’exprime en points de base :
              </p>
              <MathBlock formula="\Delta_{\text{bps}} = (R_{\text{implied}} - \text{DFR}) \times 100" />
              <div className="step-example">
                <strong>Application numérique :</strong>
                <MathBlock formula="\Delta_{\text{bps}} = (2.05 - 2.00) \times 100 = +5\text{ bp}" />
              </div>
            </div>

            {/* Étape 4 */}
            <div className="step-card">
              <div className="step-header">
                <span className="step-number">4</span>
                <h4>Attribution des probabilités de mouvement vs maintien</h4>
              </div>
              <p className="step-explanation">
                La BCE intervenant par pas de 25 bp, la probabilité d’un mouvement de 25 bp est proportionnelle à la fraction anticipée de ce geste :
              </p>
              <MathBlock formula="P(\text{Mouvement de } \pm 25\text{ bp}) = \min\left(100\%, \; \frac{|\Delta_{\text{bps}}|}{25} \times 100\%\right)" />
              <MathBlock formula="P(\text{Maintien}) = 100\% - P(\text{Mouvement de } \pm 25\text{ bp})" />
              <div className="step-example">
                <strong>Application numérique :</strong> Pour un écart de <MathInline formula="+5\text{ bp}" /> :
                <br />
                • Probabilité d’une hausse de 25 bp : <MathInline formula="P(+25\text{ bp}) = \frac{5}{25} \times 100\% = 20.0\%" />.
                <br />
                • Probabilité de maintien du taux : <MathInline formula="P(\text{Maintien}) = 100\% - 20\% = 80.0\%" />.
              </div>
            </div>
          </div>

          {/* 3. Les Résultats obtenus BCE */}
          <div className="outputs-card outputs-card--ecb">
            <h4>3. Les résultats produits (Outputs)</h4>
            <div className="outputs-list">
              <div className="output-item">
                <span>Scénario dominant</span>
                <strong>Maintien (80.0 %)</strong>
              </div>
              <div className="output-item">
                <span>Taux de dépôt implicite post-réunion</span>
                <strong>2.05 %</strong>
              </div>
              <div className="output-item">
                <span>Écart vers l’implicite</span>
                <strong>+5 bp (vs DFR 2.00 %)</strong>
              </div>
              <div className="output-item">
                <span>Référence interbancaire</span>
                <strong>€STR (1.93 %)</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Liens de retour */}
      <div className="footer-note" style={{ marginTop: "28px" }}>
        <span>
          Sources officielles : CME Group Settlements, FRED (Federal Reserve Bank of St. Louis),
          European Central Bank Data Portal (SDMX).
        </span>
        <span>
          <button type="button" onClick={onSwitchToFed}>
            Consulter la Fed
          </button>{" "}
          ·{" "}
          <button type="button" onClick={onSwitchToEcb}>
            Consulter la BCE
          </button>
        </span>
      </div>
    </article>
  );
}
