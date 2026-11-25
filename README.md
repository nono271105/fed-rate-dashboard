<h1 align="center">
  <img src="client/public/favicon.svg" alt="logo" width="80" style="vertical-align: middle; margin-right: 8px;">
  Rate Signals
</h1>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT"></a>
  <img src="https://img.shields.io/badge/status-Active-brightgreen.svg" alt="Active">
  <br>
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="Reacts">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vercel-Deployed-000000?logo=vercel&logoColor=white" alt="Vercel">
</p>

<p align="center">
  Tableau de bord en temps réel des taux directeurs et des anticipations de politique monétaire.<br>
  Frontend React 19 statique avec backend tRPC / Express sans état, déployable sur Vercel. Données de marché en direct (Massive, FRED & BCE SDMX).
</p>

---

## Fonctionnalités

### Modèles et banques centrales

| Institution                                 | Marché & Sous-jacent                     | Méthode & Source                                                                     |
| :------------------------------------------ | :---------------------------------------- | :------------------------------------------------------------------------------------ |
| **Réserve Fédérale (Fed)**         | Futures 30-Day Fed Funds (`ZQ`) & EFFR  | Décomposition séquentielle des settlements CME, interpolation par pas de 25 bps     |
| **Banque Centrale Européenne (BCE)** | Futures €STR datés & SDMX BCE | Probabilités dérivées des futures €STR (ECB Watch) & taux officiels SDMX |

### Données de marché en temps réel

- **Futures 30-Day Fed Funds (`ZQ`)** via l’API [Massive](https://massive.com/docs) : cours de règlement quotidiens du CME pour déduire le taux moyen anticipé de chaque mois contractuel.
- **Séries officielles de la Réserve fédérale** via l’API [FRED](https://fred.stlouisfed.org/docs/api/fred/) : taux effectif des fonds fédéraux (`EFFR`) et bornes basse et haute de la fourchette cible (`DFEDTARL`, `DFEDTARU`).
- **Taux directeurs et séries monétaires de la BCE** via l’API REST SDMX officielle du [portail de données de la BCE](https://data.ecb.europa.eu/help/api/overview) : facilité de dépôt (DFR), opérations principales de refinancement (MRO), facilité de prêt marginal (MLF) et dernier fixing €STR.
- **Pricing des réunions BCE** s'appuyant sur les futures €STR datés via [ECB Watch](https://ecb-watch.eu) (et fournisseur OIS de secours).
- **Système de résilience et cache multi-niveaux** : cache TTL en mémoire et persistant (15 minutes) protégeant les quotas d'API (notamment Massive à 5 req/min) avec valeurs de secours déterministes pour assurer la continuité de service sans état.

---

## Méthode de calcul

### Réserve Fédérale (Fed)

Les sources de calcul sont les settlements quotidiens des contrats futures 30-Day Fed Funds (API **Massive**, produit `ZQ`) et les séries de la Réserve fédérale (API **FRED**). Les taux sont exprimés en pourcentage (ex. $3{,}63\,\%$) et $P$ désigne le prix du future. Le taux moyen implicite du mois $r_m$ est :

$$
r_m = 100 - P
$$

Pour une réunion du FOMC le jour $j$ d’un mois comptant $D$ jours, le modèle applique le taux pré-réunion $r_0$ sur $j-1$ jours et le taux post-réunion $r_1$ sur $D-j+1$ jours :

$$
r_m = \frac{(j-1)r_0 + (D-j+1)r_1}{D}
\qquad\Longrightarrow\qquad
r_1 = \frac{D r_m - (j-1)r_0}{D-j+1}
$$

- $r_0$ est le taux en vigueur avant la décision : lors d’une séquence de réunions, $r_0$ correspond au taux post-réunion de la précédente ; pour la première décision, il est déduit du future du mois précédent ou de l’EFFR.
- Si la réunion tombe dans les trois derniers jours du mois, le contrat du mois suivant est utilisé directement lorsqu'il est disponible.

Le mouvement attendu en nombre de pas de 25 points de base est $m = (r_1 - r_0) / 0{,}25$. Pour $n = \lfloor m\rfloor$ pas, la probabilité $q$ du scénario à $n+1$ pas et celle du scénario à $n$ pas sont :

$$
n = \lfloor m\rfloor,\qquad q = m - n,\qquad p_n = 1 - q,\qquad p_{n+1} = q
$$

À l’horizon annuel, le nombre moyen de variations de 25 bps intégrées au pricing de marché est calculé par :

$$
N = \frac{r_{\mathrm{horizon}} - \mathrm{EFFR}}{0{,}25}
$$

### Banque Centrale Européenne (BCE)

Les taux directeurs et le fixing €STR proviennent de l’API SDMX de la BCE. Le pricing des réunions s’appuie sur les anticipations OIS (€STR).

Pour chaque réunion, la variation implicite en points de base est calculée à partir du taux de facilité de dépôt actuel $r_D$ et du taux OIS implicite $r_I$ :

$$
\Delta r_{\mathrm{bp}} = 100(r_I - r_D)
$$

Le scénario dominant affiché est arrondi au pas de 25 points de base le plus proche, le taux implicite représentant l'espérance pondérée des scénarios :

$$
r_I = \sum_{i=1}^{n} p_i r_i,\qquad \sum_{i=1}^{n} p_i = 1
$$

L’équivalent en mouvements de 25 points de base à l’horizon annuel est :

$$
N_{\mathrm{BCE}} = \frac{r_{\mathrm{horizon}} - r_D}{0{,}25\,\%}
$$

---

## Architecture

L'application est architecturée pour un déploiement unifié sur **Vercel** : frontend statique React 19 servi via CDN global et API Serverless exécutée par **tRPC** et **Express**.

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend React 19                        │
│   TypeScript 5 - Vite 7 - Tailwind CSS 4 - Radix UI - Lucide│
│   TanStack Query v5 - KaTeX - Wouter                        │
│   2 vues dédiées (Fed & BCE) avec bascule instantanée       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ fetch() HTTP / tRPC client typé
                               ▼
                    ┌─────────────────────┐
                    │ Proxy /api/ (Vite)  │
                    │  ou Vercel Rewrites │
                    └──────────┬──────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Backend tRPC / Express Serverless             │
│   api/trpc/[...trpc].ts (Vercel) / server/_core/index.ts    │
│   Architecture 100 % stateless                              │
│   Gestionnaire de cache TTL & fallbacks résilients          │
└──────────────┬──────────────┬──────────────┬────────────────┘
               │              │              │
               ▼              ▼              ▼
           API Massive     API FRED       API BCE (SDMX)
           Futures ZQ     EFFR & Cible   Taux & OIS (€STR)
```

---

## Interface et Tableaux de bord

### 1 - Tableau de bord Fed (Réserve fédérale)

- **Indicateurs de référence** : Taux effectif EFFR, fourchette cible officielle, projection de la prochaine réunion FOMC et cumul des mouvements attendus jusqu'à l'horizon annuel.
- **Grille des réunions** : Décomposition détaillée pour la prochaine décision et la suivante (taux pré et post-décision, contrat CME associé, probabilités de hausse, baisse ou statu quo).
- **Distribution des probabilités** : Jauges visuelles par scénario et vue consolidée de fin d'année.

### 2 - Tableau de bord BCE (Banque centrale européenne)

- **Taux directeurs en vigueur** : Taux de facilité de dépôt (DFR), taux des opérations principales de refinancement (MRO) et taux de prêt marginal (MLF).
- **Taux au jour le jour €STR** : Dernier fixing publié par la Banque centrale européenne.
- **Anticipations du Conseil des gouverneurs** : Mouvements implicites en points de base, probabilités associées et calendrier des prochaines réunions de politique monétaire.

---

## Installation et Lancement

### Prérequis

- **Node.js 20.19+**
- **pnpm 10+** (ou `npm`)
- Clés d'API gratuites :
  - **FRED API Key** (pour l'EFFR et la target range) : [Obtenir une clé FRED](https://fred.stlouisfed.org/docs/api/api_key.html)
  - **Massive API Key** (pour les futures CME 30-Day Fed Funds) : [Obtenir une clé Massive](https://massive.com/docs)

### Configuration des variables d'environnement

Renseignez vos clés dans un fichier `.env` à la racine :

```env
FRED_API_KEY=votre_cle_fred_ici
MASSIVE_API_KEY=votre_cle_massive_ici
```

> [!NOTE]
> Les taux officiels de la BCE sont accessibles publiquement sans clé d'API. En cas d'absence des clés FRED ou Massive, le volet Fed utilise automatiquement des données de secours cohérentes.

---

### Lancement en développement local

```bash
# 1. Installer les dépendances
pnpm install

# 2. Lancer le serveur de développement fullstack
pnpm dev
```

L'application est accessible sur `http://localhost:3000` (ou le port indiqué dans le terminal).

---

## Structure du projet

```
fed-rate-dashboard/
├── api/
│   └── trpc/
│       └── [...trpc].ts              # Routeur Serverless tRPC Vercel
│
├── client/                           # Frontend React 19
│   ├── public/
│   │   ├── favicon.svg               # Logo et icône de l'application
│   │   └── site.webmanifest          # Manifest PWA
│   ├── src/
│   │   ├── components/               # Composants graphiques et blocs métier
│   │   │   ├── ui/                   # Composants UI utilisés (Button, Card, Sonner, Tooltip)
│   │   │   └── ErrorBoundary.tsx     # Gestionnaire d'erreurs d'affichage
│   │   ├── contexts/                 # Contexte de thème et état global
│   │   ├── lib/                      # Configuration du client tRPC et helpers
│   │   ├── pages/
│   │   │   ├── Home.tsx              # Page principale (Vues Fed et BCE)
│   │   │   └── NotFound.tsx          # Page 404
│   │   ├── App.tsx                   # Racine de l'application et routage Wouter
│   │   ├── index.css                 # Feuilles de style Tailwind CSS 4
│   │   └── main.tsx                  # Montage React 19
│   └── index.html                    # HTML racine
│
├── server/                           # Backend Node.js / Express / tRPC
│   ├── _core/
│   │   ├── api.ts                    # Handler pour l'environnement Serverless
│   │   ├── context.ts                # Contexte d'exécution tRPC
│   │   ├── index.ts                  # Point d'entrée serveur Express local
│   │   ├── trpc.ts                   # Initialisation et procédures tRPC
│   │   └── vite.ts                   # Intégration Vite SSR / Dev middleware
│   ├── ecb.ts                        # Module d'intégration BCE (SDMX) et OIS
│   ├── ecb.test.ts                   # Tests unitaires des calculs BCE
│   ├── fedwatch.ts                   # Module d'intégration Fed, Massive et FRED
│   ├── fedwatch.test.ts              # Tests de pricing et décomposition Fed Funds
│   └── routers.ts                    # Routeurs d'API tRPC (fed, ecb)
│
├── vercel.json                       # Configuration de déploiement Vercel
├── vite.config.ts                    # Configuration Vite 7 et Tailwind CSS 4
├── vitest.config.ts                  # Configuration des tests Vitest
├── tsconfig.json                     # Configuration TypeScript
├── package.json                      # Dépendances et scripts npm
└── README.md
```

---

## Licence

MIT : voir [`package.json`](package.json).
