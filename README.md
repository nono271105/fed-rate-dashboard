# Rate Signals

Tableau de bord en français des taux directeurs et des probabilités implicites des prochaines décisions de la Réserve fédérale américaine (Fed) et de la Banque centrale européenne (BCE).

Les probabilités sont des estimations dérivées des prix de marché, pas des prévisions officielles des banques centrales. Le site récupère les données à la demande : il ne conserve ni historique ni cache en base de données.

## Utiliser le site

Choisir **Fed** ou **BCE** pour consulter les taux, les réunions à venir et les scénarios estimés. Le bouton **Actualiser** relance la récupération des données du marché sélectionné.

Si une source est indisponible, le site affiche des valeurs de secours prédéfinies. Elles sont illustratives et ne doivent pas être interprétées comme des cotations actuelles.

## Méthode de calcul

### Fed

Sources : settlements quotidiens des contrats futures 30-Day Fed Funds du [CME](https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html) et séries de taux de la Réserve fédérale publiées par [FRED](https://fred.stlouisfed.org/). Les taux recherchés dans FRED sont l’EFFR (`EFFR`) et les bornes basse et haute de la fourchette cible (`DFEDTARL`, `DFEDTARU`).

1. Le settlement du contrat Fed Funds est converti en taux moyen implicite du mois : `taux implicite = 100 − settlement`.
2. Pour une réunion ayant lieu le jour `d` d’un mois de `N` jours, le taux moyen attendu après la réunion est isolé en pondérant les jours avant et après celle-ci :

   ```text
   taux après = (taux mensuel implicite × N − taux avant × (d − 1)) / (N − d + 1)
   ```

   Le taux avant la réunion vient du contrat du mois précédent quand il est disponible ; sinon, le calcul utilise l’EFFR. Pour une réunion située dans les trois derniers jours du mois, le contrat du mois suivant est utilisé directement si disponible.
3. Le mouvement attendu est exprimé en pas de 25 points de base : `(taux après − taux avant) / 0,25`.
4. Les scénarios encadrent ce mouvement par les deux pas de 25 points de base adjacents. La partie décimale du mouvement détermine la probabilité du scénario supérieur ; le scénario inférieur reçoit le complément pour totaliser 100 %. Les scénarios sont ensuite présentés comme des variations par rapport à la borne basse actuelle de la fourchette cible.

Cette interpolation fournit une distribution simplifiée à deux scénarios à partir du taux moyen implicite. Elle ne reconstitue pas toutes les anticipations possibles ni les conventions détaillées de l’outil CME FedWatch.

### BCE

Les taux directeurs et le dernier €STR proviennent des pages de la [BCE](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html). Le pricing des réunions est lu sur [RateProbability](https://rateprobability.com/ecb), un fournisseur public tiers de données OIS ; il ne s’agit pas de probabilités officielles de la BCE.

Pour chaque réunion fournie par cette source :

1. La variation implicite en points de base est calculée par `(taux implicite − taux de dépôt BCE) × 100`.
2. Cette variation est arrondie au pas de 25 points de base le plus proche pour obtenir le scénario de mouvement affiché.
3. Le scénario de mouvement reprend la probabilité publiée par le fournisseur. Le scénario « maintien / autre » reçoit le complément à 100 %, lorsque celui-ci est positif.
4. L’horizon annuel convertit l’écart entre le taux implicite de fin d’année et le taux de dépôt courant en équivalent de 25 points de base : `(taux implicite − taux de dépôt) / 0,25`.

Le taux implicite et sa probabilité dépendent du fournisseur OIS et de sa méthode. L’arrondi à 25 points de base est une simplification de présentation ; les résultats peuvent différer d’autres sources de marché.

## Données et limites

- Les réunions affichées sont les réunions futures disponibles dans les données reçues.
- Les données CME, FRED, BCE et OIS peuvent être publiées à des heures différentes ou être temporairement indisponibles.
- Les valeurs de secours sont codées dans le projet pour préserver l’affichage en cas d’échec des sources ; elles ne sont pas actualisées automatiquement.
- Aucune base de données ni variable d’environnement n’est nécessaire. Les appels API récupèrent les données à la demande et ne conservent pas d’historique.

## Développement local

Prérequis : Node.js 20.19 ou plus récent et pnpm.

```bash
pnpm install
pnpm dev
```

Le serveur indique l’adresse locale au démarrage (par défaut `http://localhost:3000`).

Commandes utiles :

```bash
pnpm check  # Vérifier les types TypeScript
pnpm test   # Exécuter les tests
pnpm build  # Construire le site et le serveur
```

## Déploiement sur Vercel

1. Importer le dépôt [`nono271105/fed-rate-dashboard`](https://github.com/nono271105/fed-rate-dashboard) dans Vercel.
2. Conserver la racine du dépôt comme **Root Directory**.
3. Garder la configuration de [`vercel.json`](./vercel.json) : installation pnpm, commande `pnpm build` et fichiers statiques dans `dist/public`. L’API est exposée par le dossier [`api/`](./api/).
4. Lancer le déploiement. Aucune variable d’environnement n’est requise pour le fonctionnement de base.

## Organisation du code

- [`client/`](./client/) : interface web et ressources publiques.
- [`server/`](./server/) : API, récupération des sources et calculs Fed/BCE.
- [`api/`](./api/) : point d’entrée API compatible avec les fonctions serverless Vercel.
