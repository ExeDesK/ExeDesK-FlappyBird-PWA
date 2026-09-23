# Architecture frontend

## Objectif

Depuis `v0.2.7.3b-dev6.3.4`, le frontend reste volontairement **sans framework et sans build**, mais n'utilise plus `main.js` ni `AuthClient` comme contrôleurs universels. Le projet conserve des modules ES natifs chargés directement par le navigateur et sépare désormais orchestration, transport réseau, état de session et rendu UI.

Cette refactorisation est **structurelle uniquement** : elle ne modifie ni `flappy13-physics-v1`, ni les hitboxes, ni le RNG, ni les contrats Verified Runs, ni les RPC/Edge Functions Supabase.

## Composition

`site/src/main.js` est le **composition root**. Il crée les dépendances partagées (`AuthClient`, clients API, contrôleurs UI/session/PWA), leur fournit les callbacks liés au moteur, puis conserve uniquement ce qui nécessite réellement une vue globale de l'application : boucle de jeu, entrées, affichage, thèmes/diagnostic, audio et connexion entre le moteur et l'interface.

```text
main.js
├── AuthClient
├── api/
│   ├── BestScoreClient
│   ├── LeaderboardClient
│   └── VerifiedRunClient
├── replay/
│   └── VerifiedRunRecorder
├── session/
│   ├── ScoreSyncController
│   ├── VerifiedPlayController
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

- OAuth Discord via Supabase Auth ;
- restauration / rafraîchissement / suppression de session ;
- récupération du `user` courant ;
- lecture/création du profil ;
- exposition d'un `accessToken()` valide aux clients authentifiés ;
- notification des changements d'état d'authentification.

Il **ne** contient plus : leaderboard, Verified Runs, soumission de replay ou RPC de synchronisation du record.

### `api/http.js`

Helpers communs aux clients Supabase : validation de la configuration, headers et normalisation des erreurs HTTP.

### `api/best-score-client.js` — `BestScoreClient`

Ne fait qu'une chose : appeler atomiquement `sync_best_score` et retourner le meilleur score distant normalisé. La décision de mettre à jour l'état local appartient à `ScoreSyncController` / `main.js`.

### `api/leaderboard-client.js` — `LeaderboardClient`

Transport des RPC de classement :

- `get_leaderboard` public ;
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

Possède l'état d'affichage du classement : cache court, chargement, contexte personnel, statistiques et rendu de la modale. Les appels réseau restent dans `LeaderboardClient`.

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

- `main.js` doit rester sous 1600 lignes ;
- `auth.js` doit rester sous 450 lignes ;
- `session/verified-play.js` doit rester sous 300 lignes ;
- `AuthClient` ne doit pas réabsorber `get_leaderboard`, `run-start`, `run-submit` ou `sync_best_score` ;
- les modules dédiés doivent continuer à exister/importés depuis le composition root.

Ces seuils ne sont pas des objectifs de qualité absolus : ils servent à détecter rapidement une régression vers le monolithe qui avait motivé la refactorisation.

## Cycle de vie serveur des Verified Runs

Depuis `v0.2.7.3b-dev6.3.6`, `run-start` ne possède plus la décision d'insertion : l'Edge Function authentifie le joueur, génère la seed cryptographique, puis délègue l'émission à la RPC `issue_verified_run()`. La fonction PostgreSQL prend un advisory lock par `player_id`, supprime les vieux tickets `issued` du joueur, applique le cap de 10 tickets ouverts et la fenêtre glissante de 30 créations/minute, puis insère le ticket de façon atomique.

La maintenance globale reste en base avec `cleanup_stale_verified_run_tickets()` : `issued` > 7 jours et `rejected` > 30 jours sont purgés par un job Supabase Cron horaire. Les runs `verified` restent exclusivement régies par la rétention 50 + record de `006_verified_run_retention.sql`.

## Hors ligne

Tous les nouveaux modules runtime sont précachés par `site/sw.js`. `v0.2.7.3b-dev6.3.6` contient **51 ressources de précache** : la modularisation ne retire donc aucune capacité offline.

## Évolution future

Les prochaines fonctionnalités importantes (multijoueur, replay leaderboard, contrôles de replay) peuvent désormais obtenir leurs propres contrôleurs / clients sans grossir `AuthClient` ou réintroduire leur cycle complet dans `main.js`. Le même principe doit être conservé : transport réseau séparé de l'état UI/session, moteur déterministe séparé de l'orchestration navigateur.
