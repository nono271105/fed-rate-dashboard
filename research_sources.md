# Sources vérifiées — Fed/BCE

- ECB key rates: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html
  - Page officielle : deposit facility 2.50 %, MRO 2.65 %, marginal lending 2.90 % avec effet au 16 Sep. 2026.
- ECB €STR: https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_short-term_rate/html/index.en.html
  - Page officielle : €STR 2.189 %, date de référence 11-09-2026, publication chaque jour TARGET2.
- ECB calendar: https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html
  - Prochaines réunions monétaires 2026 : 28-29 Oct., 16-17 Dec.; 2027 : 3-4 Feb., 17-18 Mar., 28-29 Apr., etc.
- CME €STRWatch: https://www.cmegroup.com/markets/interest-rates/cme-estrwatch.html
  - Confirme que les contrats futures €STR sont la source de marché à suivre, mais la page publique décrit l’outil et non un flux de probabilités directement accessible.
- Pricing public BCE consulté : https://rateprobability.com/ecb
  - Affiche au 14-09-2026 : taux de dépôt 2.50 %, dernier €STR 2.189 %, réunion du 29-10-2026 : taux implicite 2.69 %, 74.8 % de hausse, +18.7 bp. Décembre 2026 : 2.89 %, 80.4 %, 1.55 hausse équivalente.
  - La page indique explicitement que ses probabilités sont dérivées d’OIS et non directement des futures €STR, et qu’il s’agit d’un pricing indépendant, non d’une donnée officielle ECB.
- ECB Watch consulté : https://ecb-watch.eu/
  - Confirme une méthode alternative basée sur les ECB Dated €STR Futures : au 11-09-2026, 62.0 % de hausse à la réunion du 29-10-2026.

Décision produit : le panneau BCE distingue les taux officiels ECB (€STR et taux directeurs) du pricing de marché public OIS, avec une note de transparence. Le code prévoit un repli en cache si la source de marché n’est pas accessible.

Références Apple utilisées pour la refonte :
- accessibility.md : perceptible, adaptable, ne pas dépendre de la couleur seule, contrastes AA, cibles et clavier.
- layout.md : grouper les éléments liés, espace suffisant pour l’essentiel, ordre de lecture et adaptation aux tailles.
- typography.md : lisibilité, poids réguliers, hiérarchie, limiter les familles, adaptation aux grandes tailles.
- color.md : couleurs sémantiques, variantes d’apparence, ne pas utiliser une couleur pour plusieurs rôles, alternatives au codage par couleur.
- tab-bars.md : onglets pour navigation top-level, visibles, libellés, peu nombreux, ne pas masquer les onglets indisponibles.
- loading.md : afficher quelque chose rapidement, feedback clair, progress indéterminé si durée inconnue.
