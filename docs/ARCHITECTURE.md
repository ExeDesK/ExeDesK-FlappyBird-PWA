# Architecture frontend

### Abandon de ticket Verified Run — v0.2.7.4b-dev5

`session/verified-run-abandon.js` possède le lifecycle d’un ticket préparé mais abandonné avant gameplay. `VerifiedPlayController` reste l’orchestrateur : Home depuis READY détache immédiatement le recorder local puis délègue l’annulation serveur à `VerifiedRunAbandoner`. Cette séparation garde `verified-play.js` sous le garde-fou de 300 lignes.


## Objectif

Depuis `v0.2.7.3b-dev6.3.4`, le frontend reste volontairement **sans framework et sans build**, mais n'utilise plus `main.js` ni `AuthClient` comme contrôleurs universels. Le projet conserve des modules ES natifs chargés directement par le navigateur et sépare désormais orchestration, transport réseau, état de session et rendu UI.

Cette refactorisation est **structurelle uniquement** : elle ne modifie ni `flappy13-physics-v1`, ni les hitboxes, ni le RNG, ni les contrats Verified Runs. Depuis `v0.2.7.4b`, le dashboard Admin Analytics ajoute ses propres RPC privées et reste séparé du runtime gameplay.

## Shell utilisateur — depuis v0.2.7.4b-dev3

Le profil et toute l'authentification utilisateur sont séparés des Options. `main.js` orchestre une modale `#profile-dialog` distincte et `AccountUI` y rend identité, synchronisation, connexion Discord et déconnexion. `#options` ne contient plus aucun contrôle ni état d'authentification. Sur HOME, deux utilitaires coexistent : Profil à gauche et Menu à droite. READY / GAME OVER réutilisent uniquement le bouton de droite comme Home.

Les sprites `button_home`, `button_options` et `button_profile` sont rendus en x1,75 depuis le custom atlas. `button_close` est rendu en x1 sur Options, Profil et Classement. Le panneau diagnostic conserve volontairement son bouton de fermeture utilitaire natif afin de rester visuellement séparé de l'interface utilisateur. Depuis `v0.2.7.4b-dev6`, le press-state atlas est géré dans `main.js` par Pointer Events : une classe temporaire reste visible au moins 70 ms, tandis que le CSS décale le sprite d'un pixel source vers le bas et clippe sa dernière ligne sans changer son axe X.

Depuis `v0.2.7.4b-dev10`, Discord et Google sont exposés dans Profil. L'architecture Auth conserve une couche d'identity linking générique : un provider ajouté depuis un profil connecté est rattaché au même `auth.users.id`, sans duplication ni migration des données de jeu.

## Composition

`site/src/main.js` est le **composition root**. Il crée les dépendances partagées (`AuthClient`, clients API, contrôleurs UI/session/PWA), leur fournit les callbacks liés au moteur, puis conserve uniquement ce qui nécessite réellement une vue globale de l'application : boucle de jeu, entrées, affichage, thèmes/diagnostic, audio et connexion entre le moteur et l'interface.

```text
main.js
├── AuthClient
│   └── auth/IdentityLinkingController
├── api/
│   ├── BestScoreClient
│   ├── LeaderboardClient
│   └── VerifiedRunClient
├── replay/
│   └── VerifiedRunRecorder
├── session/
│   ├── ScoreSyncController
│   ├── VerifiedPlayController
│   ├── VerifiedRunAbandoner
│   ├── VerifiedRunQueue
│   └── VerifiedRunSubmitter
├── ui/
│   ├── AccountUI
│   ├── GameTransitionController
│   ├── LeaderboardUI
│   ├── ToastController
│   └── UnrankedWarningDialog
└── pwa/
    └── PwaUpdateManager
```

## Responsabilités

### `auth.js` — `AuthClient`

Responsabilités conservées :

- OAuth de connexion via Supabase Auth (`signInWithProvider()` pour Discord et Google) ;
- restauration / rafraîchissement / suppression de session ;
- récupération du `user` courant ;
- lecture/création du profil ;
- exposition d'un `accessToken()` valide aux clients authentifiés ;
- orchestration du retour OAuth de connexion ou de linking ;
- notification des changements d'état d'authentification.

La gestion détaillée des identités est déléguée à `auth/identity-linking.js`, ce qui maintient `auth.js` sous son garde-fou de 450 lignes. `IdentityLinkingController` normalise `user.identities`, démarre les liaisons OAuth authentifiées, conserve l'intention de linking pendant la redirection et gère le unlink avec interdiction de supprimer le dernier moyen de connexion.

Il **ne** contient plus : leaderboard, Verified Runs, soumission de replay ou RPC de synchronisation du record.

### `api/http.js`

Helpers communs aux clients Supabase : validation de la configuration, headers et normalisation des erreurs HTTP. Depuis `v0.2.7.7b-hotfix4`, les erreurs conservent aussi `code`, `details` et `Retry-After` afin que les RPC rate-limitées puissent fournir un retour utilisateur précis.

### `api/best-score-client.js` — `BestScoreClient`

Ne fait qu'une chose : appeler atomiquement `sync_best_score` et retourner le meilleur score distant normalisé. La décision de mettre à jour l'état local appartient à `ScoreSyncController` / `main.js`.

### `api/leaderboard-client.js` — `LeaderboardClient`

Transport des RPC de classement :

- `get_leaderboard` public pour la lecture initiale ;
- `get_leaderboard_refresh` authentifié et rate-limité pour les actualisations live après la lecture initiale ;
- `get_leaderboard_replay` authentifié et rate-limité pour les seed/taps ;
- contexte personnel authentifié ;
- statistiques de performance authentifiées.

La présentation et le cache de session sont gérés séparément par `LeaderboardUI`.

### `api/verified-run-api.js` — `VerifiedRunClient`

Transport HTTP des deux Edge Functions :

- `run-start` ;
- `run-submit`.

Le client valide/normalise les contrats réseau mais ne pilote ni l'écran, ni le recorder, ni la file locale.

### `session/verified-play.js` — `VerifiedPlayController`

Orchestre le scénario côté navigateur d'une partie classée : interception de PLAY, obtention du ticket, installation du `Game` canonique, branchement du recorder, fallback non classé et application des résultats au meilleur score / leaderboard. Depuis `v0.2.7.3b-dev6.3.5`, il ne possède plus l'implémentation du storage, du retry ou du fade.

### `replay/verified-run-recorder.js` — `VerifiedRunRecorder`

Capture les taps effectifs par tick et construit la soumission canonique au tick terminal. Ce module ne connaît ni Supabase, ni l'UI, ni la file locale et peut être réutilisé par les futurs outils de replay.

### `replay/replay-viewer.js` — `ReplayViewer`

Lecteur visuel des runs leaderboard. Il reconstruit un `Game` canonique depuis la seed, rejoue les taps à 60 Hz, rend le résultat dans un canvas dédié et vérifie le score terminal. Il applique le contexte visuel enregistré lorsqu'il existe ; les runs legacy utilisent un thème + jour/nuit aléatoires. Le transport reste dans `LeaderboardClient.fetchReplay()`, qui exige désormais un token Supabase avant tout accès au payload déterministe.

### `session/verified-run-abandon.js` — `VerifiedRunAbandoner`

Isole l’abandon d’un ticket préparé mais non joué : capture du `run_id`, annulation owner-only via `VerifiedRunClient.cancel()`, journalisation et fallback non bloquant si le réseau est indisponible. Il ne touche jamais à une soumission déjà terminée/queueée.

### `session/verified-run-queue.js` — `VerifiedRunQueue`

Repository local des soumissions terminées : ownership joueur, normalisation/réparation des entrées legacy, déduplication par `run_id`, borne à 50, lecture par joueur et suppression d'un run résolu. L'accès à `localStorage` est résolu paresseusement afin qu'un contexte qui l'interdit ne fasse pas échouer l'initialisation de l'application.

### `session/verified-run-submit.js` — `VerifiedRunSubmitter`

Applique la politique d'envoi FIFO à `run-submit` : suppression des résultats résolus, abandon des erreurs permanentes connues, arrêt et conservation de la file sur erreur transitoire, remontée du meilleur score vérifié et du dernier résultat. Le transport HTTP reste dans `api/verified-run-api.js`.

### `ui/game-transition.js` — `GameTransitionController`

Possède le mécanisme de fade PLAY (durée minimale, attente du noir complet, restauration du menu) sans connaître les Verified Runs.

### `ui/unranked-warning.js` — `UnrankedWarningDialog`

Possède le dialogue de confirmation du fallback non classé et son cycle `showModal` / résolution. Le contrôleur de session choisit seulement quand le demander.

### `session/score-sync.js` — `ScoreSyncController`

Maintient l'état de synchronisation du record et décide quand appeler `BestScoreClient`, sans mélanger cette responsabilité à la session OAuth.

### `ui/leaderboard-ui.js` — `LeaderboardUI`

Possède l'état d'affichage du classement : cache court, chargement, contexte personnel, statistiques et rendu de la modale. Depuis `v0.2.8b`, chaque ligne affiche aussi `achieved_at` avec date+heure et le rang #1 affiche `record_held_since`, alimenté par l’état serveur privé `leaderboard_record_state`. Sans session, le Top 100 reste lisible mais **VOIR** / `ACTUALISER` sont désactivés. Avec session, les refresh forcés passent par le chemin authentifié/rate-limité. Les appels réseau restent dans `LeaderboardClient`.

### `ui/account.js` — `AccountUI`

Rend l'état connecté/déconnecté, le profil et le statut de synchronisation sans posséder la logique OAuth.

### `ui/toast.js` — `ToastController`

Centralise le toast Top Layer et son timer.

### `pwa/update-manager.js` — `PwaUpdateManager`

Centralise l'enregistrement du Service Worker, la détection de version, l'état `waiting`, la vérification du cache et l'activation contrôlée d'une mise à jour.

## Flux de dépendances

La règle recherchée est :

```text
UI / session controllers
        ↓
focused API clients
        ↓
Supabase HTTP endpoints
```

`AuthClient` fournit l'identité et le token, mais n'est plus la façade universelle de toutes les fonctions communautaires. Les clients authentifiés reçoivent un callback `getAccessToken`, ce qui évite une dépendance forte à l'implémentation interne de l'auth.

## Garde-fous de tests

`tests/ci.test.mjs` contient un test de non-régression architectural :

- `main.js` doit rester sous 1650 lignes ;
- `auth.js` doit rester sous 450 lignes ;
- `session/verified-play.js` doit rester sous 300 lignes ;
- `AuthClient` ne doit pas réabsorber `get_leaderboard`, `run-start`, `run-submit` ou `sync_best_score` ;
- les modules dédiés doivent continuer à exister/importés depuis le composition root.

Ces seuils ne sont pas des objectifs de qualité absolus : ils servent à détecter rapidement une régression vers le monolithe qui avait motivé la refactorisation.

## Cycle de vie serveur des Verified Runs

Depuis `v0.2.7.3b-dev6.3.6`, `run-start` ne possède plus la décision d'insertion : l'Edge Function authentifie le joueur, génère la seed cryptographique, puis délègue l'émission à la RPC `issue_verified_run()`. La fonction PostgreSQL prend un advisory lock par `player_id`, supprime les vieux tickets `issued` du joueur, applique le cap de 10 tickets ouverts et la fenêtre glissante de 30 créations/minute, puis insère le ticket de façon atomique.

La maintenance globale reste en base avec `cleanup_stale_verified_run_tickets()` : `issued` > 7 jours et `rejected` > 30 jours sont purgés par un job Supabase Cron horaire. Les runs `verified` restent exclusivement régies par la rétention 50 + record de `006_verified_run_retention.sql`.

## Admin Analytics — v0.2.7.9b

Le dashboard d'administration est une application légère séparée sous `site/admin/`. Il réutilise `AuthClient` pour la session OAuth Supabase, puis appelle uniquement des RPC Analytics authentifiées via un client dédié :

```text
site/admin/
├── index.html
└── admin.css

site/src/admin/
├── analytics-client.js   # transport RPC + JWT utilisateur
├── charts.js             # graphiques SVG natifs
├── day-view.js           # vue Journée / pics horaires / top du jour
├── player-detail.js      # drill-down joueur / providers / stats détaillées
└── dashboard.js          # composition / rendu des vues admin
```

Le navigateur n'accède jamais directement aux tables privées `analytics_admins`, `analytics_meta`, `player_activity_daily`, `run_metrics_daily`, `player_activity_hourly` ou `run_metrics_hourly`. L'autorisation est vérifiée côté PostgreSQL par `is_analytics_admin()` / `require_analytics_admin()` avant chaque RPC `admin_analytics_*`. Aucune clé `service_role` n'est embarquée dans le site.

Côté serveur, `010_admin_analytics.sql` étend les triggers autoritaires existants afin d'agréger le temps de jeu, l'activité quotidienne et le lifecycle des tickets avant que les politiques de rétention ne suppriment les détails. `017_admin_analytics_ranges.sql` ajoute les plages explicites `Du → Au`. `018_admin_player_daily_insights.sql` ajoute les agrégats horaires et les RPC de drill-down : la fiche joueur peut lire des métadonnées sûres dans `auth.identities`, mais ne renvoie ni token OAuth ni matériau de replay ; la vue Journée utilise les totaux quotidiens existants et les buckets horaires uniquement à partir du début réel du suivi `018`. Les signatures de `issue_verified_run()` et `cleanup_stale_verified_run_tickets()` restent compatibles avec la `6.3.6`.

## Hors ligne

Les **57 ressources runtime du jeu** sont précachées par `site/sw.js` en `v0.2.8b-hotfix2`, dont le lecteur de replay et ses contrôles. Le dashboard `site/admin/` et ses modules restent volontairement **online-only** et ne sont pas ajoutés au précache : une indisponibilité de l'administration ne peut donc pas empêcher l'installation ou le fonctionnement hors ligne du gameplay.

## Évolution future

Les prochaines fonctionnalités importantes (multijoueur, historique/replay sharing, contrôles avancés de replay) peuvent continuer à obtenir leurs propres contrôleurs / clients sans grossir `AuthClient` ou réintroduire leur cycle complet dans `main.js`. Le même principe doit être conservé : transport réseau séparé de l'état UI/session, moteur déterministe séparé de l'orchestration navigateur.

## Account linking

La stratégie complète de conservation de l'UUID joueur, de compatibilité avec les comptes Discord existants et de future liaison d'un second provider est décrite dans [`ACCOUNT-LINKING.md`](./ACCOUNT-LINKING.md).

### Accounts & Profiles — v0.2.7.5b

`auth/provider-profile.js` normalise les métadonnées publiques renvoyées par les identités OAuth (pseudo provider, avatar, date de liaison) sans les confondre avec l'UUID canonique du joueur. `api/profile-client.js` possède la lecture/écriture de `public.profiles`, dont le pseudo public et le provider d'avatar sélectionné. `AuthClient` orchestre seulement la session et délègue ces opérations au client de profil. Après un unlink, il force une resynchronisation `/auth/v1/user` afin de réconcilier les providers réellement présents.

`ui/account.js` expose le linking/unlink avec confirmation et protège le dernier provider Discord/Google. `ui/avatar-fallback.js` fournit un avatar généré déterministe lorsque les providers ne donnent aucune image. Le leaderboard applique immédiatement le profil à sa ligne déjà chargée puis invalide son cache ; Admin Analytics continue de lire `profiles.display_name` et `profiles.avatar_url` directement. Aucun changement de clé étrangère ni de modèle d'ownership n'est nécessaire.

### Isolement du bookkeeping leaderboard

`leaderboard_record_state` est volontairement hors du chemin critique de
validation : `020_record_tenure_resilience.sql` encapsule sa synchronisation dans
un trigger best-effort. Une panne de ce bookkeeping peut rendre temporairement la
durée de détention obsolète, mais ne doit jamais empêcher `run-submit` de résoudre
une run vérifiée. Les soumissions différées remontent en outre leur vraie classe
d'erreur au frontend (offline, auth, 429, 5xx) au lieu d'être toutes présentées
comme une perte d'Internet.
