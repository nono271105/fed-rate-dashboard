# Rate Signals

Dashboard en français des probabilités implicites de décisions de la Fed et de la BCE.

## Développement local

Prérequis : Node.js 20.19+ et pnpm.

```bash
pnpm install
pnpm dev
```

Le site s'ouvre à l'adresse indiquée par le serveur local (par défaut `http://localhost:3000`).

## Déploiement sur Vercel

1. Importer `nono271105/fed-rate-dashboard` dans Vercel.
2. Garder la racine du dépôt comme **Root Directory**.
3. Vercel utilise `vercel.json` : installation avec pnpm, commande `pnpm build`, sortie statique dans `dist/public` et API dans `api/`.
4. Déployer. Aucune variable d'environnement n'est nécessaire pour le fonctionnement de base.

`DATABASE_URL` est facultative. Sans base MySQL, le site interroge les sources de données à la demande et affiche les valeurs de secours si elles sont indisponibles, mais ne conserve pas l'historique entre les invocations. Pour conserver le cache et l'historique, configurer `DATABASE_URL` avec une base MySQL compatible, puis appliquer le schéma avec `pnpm db:push`.

Les données sont calculées à partir de sources publiques (CME/FRED pour la Fed, ECB et pricing OIS public pour la BCE). Elles peuvent être indisponibles ou différer des fournisseurs de marché.
