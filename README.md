# Rate Signals

Tableau de bord en français des taux directeurs et des probabilités implicites des prochaines décisions de la Réserve fédérale américaine (Fed) et de la Banque centrale européenne (BCE).

Les probabilités sont des estimations dérivées des prix de marché, pas des prévisions officielles des banques centrales. Le site récupère les données à la demande : il ne conserve ni historique ni cache en base de données.

## Utiliser le site

Choisir **Fed** ou **BCE** pour consulter les taux, les réunions à venir et les scénarios estimés. Le bouton **Actualiser** relance la récupération des données du marché sélectionné.

Si une source est indisponible, le site affiche des valeurs de secours prédéfinies. Elles sont illustratives et ne doivent pas être interprétées comme des cotations actuelles.

## Méthode de calcul

### Fed

Sources : settlements quotidiens des contrats futures 30-Day Fed Funds récupérés via l’API [Massive](https://massive.com/docs) (produit `ZQ`) et séries officielles de la Réserve fédérale publiées par l’API [FRED](https://fred.stlouisfed.org/docs/api/fred/). Les séries FRED utilisées sont l’EFFR (`EFFR`) et les bornes basse et haute de la fourchette cible (`DFEDTARL`, `DFEDTARU`).

Les taux ci-dessous sont exprimés en pourcentage (par exemple \(3{,}63\)), et \(P\) est le prix du future. Le taux moyen implicite du mois est :

$$
r_m = 100 - P
$$

Pour une réunion le jour \(j\) d’un mois de \(D\) jours, le code compte \(j-1\) jours avant la réunion et \(D-j+1\) jours à partir de celle-ci. Le taux après réunion \(r_1\) est obtenu à partir de la moyenne mensuelle :

$$
r_m = \frac{(j-1)r_0 + (D-j+1)r_1}{D}
\qquad\Longrightarrow\qquad
r_1 = \frac{D r_m - (j-1)r_0}{D-j+1}
$$

Ici, \(r_0\) est le taux en vigueur avant la réunion : lorsqu’une réunion antérieure a déjà été évaluée dans la séquence, \(r_0\) correspond au taux post-réunion de celle-ci (\(r_1\) de la décision précédente) ; pour la première décision, il provient du future du mois précédent s’il existe sans réunion intermédiaire, sinon du taux effectif EFFR. Si la réunion est dans les trois derniers jours du mois, le future du mois suivant est utilisé directement lorsqu’il est disponible.

Un système de cache en mémoire et persistant (TTL 15 minutes) protège les quotas de l'API Massive (5 requêtes par minute) et assure la continuité de service même en cas de limitations temporaires ou de séances de négociation en cours sans prix de règlement officiel du jour.

Le mouvement attendu en nombre de pas de 25 points de base est \(m=(r_1-r_0)/0{,}25\). Pour \(n=\lfloor m\rfloor\) pas, \(q\) est la probabilité du scénario à \(n+1\) pas ; le scénario à \(n\) pas reçoit le complément :

$$
n=\lfloor m\rfloor,\qquad q=m-n,\qquad
p_n=1-q,\qquad p_{n+1}=q
$$

Les scénarios sont exprimés par rapport à la fourchette cible actuelle. Cette interpolation à deux scénarios est une approximation ; elle ne reproduit pas toute la méthode CME FedWatch.

À l’horizon annuel, le nombre moyen de hausses intégrées au pricing est calculé par \(N=(r_{\mathrm{horizon}}-\mathrm{EFFR})/0{,}25\). Il s’agit d’une moyenne de marché, pas d’un nombre littéral de décisions.

### BCE

Les taux directeurs et le dernier €STR proviennent de l’API SDMX officielle du [portail de données de la BCE](https://data.ecb.europa.eu/help/api/overview). Le pricing des réunions s’appuie sur le fournisseur public tiers de données OIS [RateProbability](https://rateprobability.com/ecb) ou, en cas d’indisponibilité ou de challenge anti-bot, sur le calendrier officiel du Conseil des gouverneurs de la BCE combiné à la structure forward des taux monétaires européens.

Pour chaque réunion, la variation implicite en points de base est calculée à partir du taux de dépôt actuel \(r_D\) et du taux OIS implicite \(r_I\), exprimés en pourcentage :

$$
\Delta r_{\mathrm{bp}} = 100(r_I-r_D)
$$

Le scénario affiché est arrondi au pas de 25 points de base le plus proche ; sa probabilité provient du fournisseur. Le scénario « maintien / autre » reçoit le complément à 100 % lorsqu’il est positif. À titre d’interprétation, un taux implicite peut aussi être vu comme une moyenne pondérée des taux des scénarios :

$$
r_I=\sum_{i=1}^{n}p_i r_i,\qquad \sum_{i=1}^{n}p_i=1
$$

L’équivalent en mouvements de 25 points de base à l’horizon annuel est :

$$
N_{\mathrm{BCE}}=\frac{r_{\mathrm{horizon}}-r_D}{0{,}25\%}
$$

La probabilité publiée et le taux implicite dépendent du fournisseur OIS ; l’arrondi à 25 points de base est une simplification de présentation.

## Données et limites

- Les réunions affichées sont les réunions futures disponibles dans les données reçues.
- Les données Massive, FRED, BCE et OIS peuvent être publiées à des heures différentes ou être temporairement indisponibles. L’API BCE fournit les taux officiels, pas les anticipations de marché par réunion.
- Les valeurs de secours sont codées dans le projet pour préserver l’affichage en cas d’échec des sources ; elles ne sont pas actualisées automatiquement.
- Les taux BCE sont accessibles sans clé. Le volet Fed nécessite `FRED_API_KEY` et `MASSIVE_API_KEY`. Les appels API récupèrent les données à la demande et ne conservent pas d’historique en base.

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
4. Dans **Settings → Environment Variables**, ajouter `FRED_API_KEY` (clé FRED valide de 32 caractères minuscules alphanumériques) et `MASSIVE_API_KEY` (clé Massive avec accès aux futures CME Fed Funds). Ajouter les mêmes variables dans un fichier local `.env` pour le développement ; ne jamais committer ce fichier ni publier les clés.
5. Redéployer après avoir enregistré les variables. Sans l’une de ces clés, le volet Fed utilise ses valeurs de secours. Les taux officiels BCE restent accessibles sans clé, mais les probabilités BCE dépendent de la disponibilité du fournisseur OIS tiers.

## Organisation du code

- [`client/`](./client/) : interface web et ressources publiques.
- [`server/`](./server/) : API, récupération des sources et calculs Fed/BCE.
- [`api/`](./api/) : point d’entrée API compatible avec les fonctions serverless Vercel.
