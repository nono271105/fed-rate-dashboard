# Rate Signals — Fed & BCE

> Probabilités implicites de marché pour les décisions de la Fed et de la BCE, en temps réel.

**Rate Signals** est un dashboard full-stack qui calcule et affiche les probabilités implicites des décisions de taux directeurs de la **Réserve fédérale américaine (Fed)** et de la **Banque centrale européenne (BCE)**, à partir de données de marché publiques.

---

## Fonctionnalités

### Fed – Réserve fédérale
- Probabilités **réunion par réunion** calculées à partir des settlements des contrats **30-Day Fed Funds (ZQ)** du CME
- Taux effectif **EFFR** et fourchette cible (DFEDTARL / DFEDTARU) via **FRED** (St. Louis Fed)
- **Nombre de mouvements implicites** d'ici fin d'année (équivalent × 25 bp)
- Historique glissant des probabilités sur 30 jours

### BCE – Banque centrale européenne
- Taux directeurs officiels (**dépôt, MRO, marginal**) scrappés depuis le site ECB
- Taux **€STR** (Euro Short-Term Rate) du jour
- Pricing par réunion à partir d'un agrégateur public d'OIS européens
- Calendrier des réunions Governing Council en temps réel

### Interface
- Basculement **Fed / BCE** avec onglets
- Cards métriques, cards de réunion avec scénarios (hausse / maintien / baisse)
- Graphique d'historique des probabilités par cible de taux (30 j)
- Actualisation manuelle à la demande
- Design responsive, mode clair, typographie DM Sans

---

## Architecture

```
fed-rate-dashboard/
├── client/                  # Front-end React + Vite
│   ├── src/
│   │   ├── pages/Home.tsx   # Dashboard principal (Fed + BCE)
│   │   ├── components/      # DashboardLayout, LoginDialog, AIChatBox…
│   │   └── _core/           # Auth, hooks, tRPC client
│   └── public/
│       └── logo.ico         # Favicon
├── server/                  # Back-end Express + tRPC
│   ├── fedwatch.ts          # Logique Fed (CME + FRED)
│   ├── ecb.ts               # Logique BCE (ECB + OIS)
│   ├── routers.ts           # Routes tRPC
│   └── db.ts                # Accès base de données (Drizzle + MySQL)
├── shared/                  # Types et constantes partagés
└── drizzle/                 # Migrations SQL
```

**Stack :** React 19 · TypeScript · tRPC · Drizzle ORM · MySQL · Vite · Express · Tailwind CSS v4

---

## Méthodologie de calcul

### Fed — méthode CME FedWatch

La méthode est identique à celle publiée par le CME Group dans sa documentation officielle FedWatch.

#### 1. Taux implicite mensuel

Pour chaque contrat 30-Day Fed Funds du mois M :

$$r_M = 100 - \text{settle}_M$$

#### 2. Décomposition avant/après réunion

Soit `D` le jour de la réunion FOMC dans le mois (ex : le 28 pour janvier), et `N` le nombre total de jours du mois :

$$r_{\text{pre}} = r_{M-1} \quad \text{(settlement du mois précédent)}$$

$$r_{\text{post}} = \frac{r_M \cdot N - r_{\text{pre}} \cdot (D-1)}{N - D + 1}$$

> **Cas limite :** Si la réunion tombe dans les 3 derniers jours du mois (peu de jours post-réunion), le taux post est lu directement sur le contrat du mois suivant M+1 pour éviter le bruit statistique.

#### 3. Probabilités des scénarios

Le nombre de mouvements de 25 bp implicite est :

$$n = \frac{r_{\text{post}} - r_{\text{pre}}}{0.25}$$

En décomposant `n` en sa partie entière et fractionnaire :

$$P(\text{scénario haut}) = n - \lfloor n \rfloor$$
$$P(\text{scénario bas}) = 1 - P(\text{scénario haut})$$

Les deux scénarios correspondent aux deux fourchettes cibles adjacentes les plus proches du taux actuel.

#### 4. Horizon fin d'année

$$\text{moves\_year\_end} = \frac{r_{\text{post, déc}} - \text{EFFR}}{0.25}$$

---

### BCE — méthode OIS implicite

#### 1. Données sources
- **Taux de dépôt officiel** : scrappe en temps réel le site ECB
- **Pricing par réunion** : agrégateur public d'OIS (Overnight Index Swap) européens

#### 2. Mouvement implicite

$$\Delta_{\text{bps}} = \text{round}((\text{implied\_rate} - \text{deposit\_rate}) \times 100)$$

#### 3. Probabilités

La probabilité du mouvement dominant `P` est lue directement depuis la source OIS. La probabilité du scénario alternatif (maintien ou autre) est :

$$P(\text{hold}) = \max(0,\ 100 - P)$$

#### 4. Horizon fin d'année

$$\text{moves\_year\_end} = \frac{\text{implied\_rate\_déc} - \text{deposit\_rate}}{0.25}$$

---

## Variables d'environnement

Créer un fichier `.env` à la racine :

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

---

## Lancer le projet

### Prérequis
- Node.js ≥ 18
- pnpm ≥ 10
- MySQL 8+

### Installation

```bash
pnpm install
```

### Base de données

```bash
pnpm db:push
```

### Développement

```bash
pnpm dev
```

### Production

```bash
pnpm build
pnpm start
```

### Tests

```bash
pnpm test
```

---

## Sources de données

| Source | Usage | Licence |
|---|---|---|
| [CME Group Settlements](https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html) | Contracts ZQ 30-Day Fed Funds | Publique (usage non-commercial) |
| [FRED – St. Louis Fed](https://fred.stlouisfed.org/) | EFFR, DFEDTARL, DFEDTARU | Publique |
| [ECB – taux directeurs](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/) | Dépôt, MRO, marginal | Publique |
| [ECB – €STR](https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_short-term_rate/) | Euro Short-Term Rate | Publique |
| Agrégateur OIS public | Pricing BCE par réunion | Publique |

> ⚠️ **Avertissement** : Les données affichées sont à titre informatif uniquement. Elles ne constituent pas un conseil financier ou d'investissement.

---

## Licence

MIT
