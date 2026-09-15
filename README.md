<h1 align="center">
  Rate Signals — Fed & BCE
</h1>

<p align="center">
  <a href="https://github.com/nono271105/fed-rate-dashboard"><img src="https://img.shields.io/badge/status-Active-brightgreen.svg" alt="Active"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT"></a>
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/tRPC-11-2596BE?logo=trpc&logoColor=white" alt="tRPC">
  <br>
  <img src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Drizzle-ORM-C5F74F?logo=drizzle&logoColor=black" alt="Drizzle">
  <img src="https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white" alt="MySQL">
</p>

<p align="center">
  Probabilités implicites des décisions de taux de la <strong>Fed</strong> et de la <strong>BCE</strong>, calculées en temps réel à partir de données de marché publiques.<br>
  Méthode CME FedWatch pour la Fed · OIS implicites pour la BCE.
</p>

---

## Fonctionnalités

### Fed — Réserve fédérale

| Donnée | Source |
|:---|:---|
| **Probabilités FOMC** réunion par réunion | CME 30-Day Fed Funds settlements (ZQ) |
| **Taux effectif EFFR** et fourchette cible | FRED (DFEDTARL / DFEDTARU) |
| **Mouvements implicites** d'ici fin d'année (× 25 bp) | Calculé |
| **Historique 30 jours** des probabilités par scénario | Base de données locale |

### BCE — Banque centrale européenne

| Donnée | Source |
|:---|:---|
| **Taux directeurs officiels** (dépôt, MRO, marginal) | Site ECB officiel |
| **€STR** Euro Short-Term Rate | Site ECB officiel |
| **Pricing par réunion** Governing Council | Agrégateur public OIS |
| **Calendrier des réunions** en temps réel | Calendrier ECB officiel |

### Interface

- Basculement **Fed / BCE** avec onglets dédiés
- Cards métriques, cards de réunion avec scénarios détaillés (hausse / maintien / baisse)
- Graphique **historique des probabilités** par cible de taux sur 30 jours
- Actualisation manuelle à la demande
- Design responsive, typographie **DM Sans**

---

## Méthodologie mathématique

### Fed — méthode CME FedWatch

La méthode reproduit fidèlement la méthodologie officielle publiée par le CME Group.

#### 1. Taux implicite mensuel

Pour chaque contrat 30-Day Fed Funds du mois M (prix coté 100 − r) :

$$r_M = 100 - \text{settle}_M$$

#### 2. Décomposition avant / après réunion

Soit `D` le jour de la réunion FOMC dans le mois et `N` le nombre total de jours du mois :

$$r_{\text{pre}} = r_{M-1}$$

$$r_{\text{post}} = \frac{r_M \cdot N - r_{\text{pre}} \cdot (D - 1)}{N - D + 1}$$

> **Cas limite :** si la réunion tombe dans les 3 derniers jours du mois, `r_post` est lu directement sur le contrat du mois suivant M+1 pour éviter le bruit statistique dû à un faible nombre de jours post-réunion.

#### 3. Probabilités des scénarios

Le nombre implicite de mouvements de 25 bp :

$$n = \frac{r_{\text{post}} - r_{\text{pre}}}{0.25}$$

Les deux scénarios adjacents et leurs probabilités :

$$P(\text{scénario haut}) = n - \lfloor n \rfloor \qquad P(\text{scénario bas}) = 1 - P(\text{scénario haut})$$

#### 4. Horizon fin d'année

$$\text{moves}_{\text{year-end}} = \frac{r_{\text{post, déc}} - \text{EFFR}}{0.25}$$

---

### BCE — OIS implicites

#### 1. Mouvement implicite par réunion

$$\Delta_{\text{bps}} = \text{round}\!\left((\text{implied\_rate} - \text{deposit\_rate}) \times 100\right)$$

#### 2. Probabilités

La probabilité du scénario dominant `P` est extraite directement de l'agrégateur OIS. Le scénario alternatif :

$$P(\text{hold}) = \max(0,\ 100 - P)$$

#### 3. Horizon fin d'année

$$\text{moves}_{\text{year-end}} = \frac{\text{implied\_rate}_{\text{déc}} - \text{deposit\_rate}}{0.25}$$

---

## Architecture

```
fed-rate-dashboard/
├── client/                        # Front-end React + Vite
│   ├── index.html                 # Point d'entrée HTML (favicon, SEO)
│   ├── public/
│   │   └── logo.ico               # Favicon
│   └── src/
│       ├── pages/
│       │   └── Home.tsx           # Dashboard principal (Fed + BCE)
│       ├── components/            # DashboardLayout, LoginDialog…
│       └── _core/                 # Auth, hooks, client tRPC
├── server/                        # Back-end Express + tRPC
│   ├── fedwatch.ts                # Logique Fed (CME + FRED)
│   ├── ecb.ts                     # Logique BCE (ECB + OIS)
│   ├── routers.ts                 # Routes tRPC
│   └── db.ts                      # Accès BDD (Drizzle + MySQL)
├── shared/                        # Types et constantes partagés
└── drizzle/                       # Schéma et migrations SQL
```

---

## Installation

### Prérequis

- Node.js ≥ 18
- pnpm ≥ 10
- MySQL 8+

### Étapes

```bash
# 1. Cloner le dépôt
git clone https://github.com/nono271105/fed-rate-dashboard.git
cd fed-rate-dashboard

# 2. Installer les dépendances
pnpm install

# 3. Créer le fichier d'environnement
cp .env.example .env   # puis éditer .env

# 4. Initialiser la base de données
pnpm db:push

# 5. Lancer en développement
pnpm dev
```

### Variables d'environnement (`.env`)

```env
# Base de données
DATABASE_URL=mysql://user:password@localhost:3306/fed_rate_dashboard

# Auth OAuth
VITE_OAUTH_PORTAL_URL=https://...
VITE_APP_ID=your-app-id
COOKIE_SECRET=your-secret-at-least-32-chars

# Optionnel – Analytics
VITE_ANALYTICS_ENDPOINT=https://...
VITE_ANALYTICS_WEBSITE_ID=...
```

### Scripts disponibles

| Commande | Description |
|---|---|
| `pnpm dev` | Serveur de développement |
| `pnpm build` | Build de production |
| `pnpm start` | Démarrer en production |
| `pnpm test` | Lancer les tests |
| `pnpm db:push` | Générer et appliquer les migrations |
| `pnpm check` | Vérification TypeScript |

---

## Sources de données

| Source | Usage |
|:---|:---|
| [CME Group – settlements ZQ](https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html) | Contrats 30-Day Fed Funds |
| [FRED – St. Louis Fed](https://fred.stlouisfed.org/) | EFFR, fourchette cible Fed |
| [ECB – taux directeurs](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/) | Taux dépôt, MRO, marginal |
| [ECB – €STR](https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_short-term_rate/) | Euro Short-Term Rate |
| Agrégateur public OIS | Pricing BCE par réunion |

> ⚠️ **Avertissement** — Les données affichées sont à titre informatif uniquement. Elles ne constituent pas un conseil en investissement.

---

## Licence

MIT — voir [`LICENSE`](LICENSE).

---

*Dernière mise à jour : septembre 2026*
