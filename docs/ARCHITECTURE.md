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
├── session/
│   ├── ScoreSyncController
│   └── VerifiedPlayController
├── ui/
│   ├── AccountUI
│   ├── LeaderboardUI
│   └── ToastController
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

Orchestre le cycle côté navigateur d'une partie classée :

- interception de PLAY lorsqu'une session Discord existe ;
- fade natif pendant `run-start` ;
- fallback explicite non classé hors ligne / en cas d'erreur ;
- création et alimentation du `VerifiedRunRecorder` ;
- ajout à la file locale ;
- envoi différé à `run-submit` ;
- retrait des soumissions résolues ou définitivement invalides ;
- invalidation du leaderboard après une nouvelle run vérifiée.

Le moteur autoritaire, les contrats et la logique de replay restent dans les modules Verified Runs existants.

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
- `AuthClient` ne doit pas réabsorber `get_leaderboard`, `run-start`, `run-submit` ou `sync_best_score` ;
- les modules dédiés doivent continuer à exister/importés depuis le composition root.

Ces seuils ne sont pas des objectifs de qualité absolus : ils servent à détecter rapidement une régression vers le monolithe qui avait motivé la refactorisation.

## Hors ligne

Tous les nouveaux modules runtime sont précachés par `site/sw.js`. `v0.2.7.3b-dev6.3.4` contient **46 ressources de précache** : la modularisation ne retire donc aucune capacité offline.

## Évolution future

Les prochaines fonctionnalités importantes (multijoueur, replay leaderboard, contrôles de replay) peuvent désormais obtenir leurs propres contrôleurs / clients sans grossir `AuthClient` ou réintroduire leur cycle complet dans `main.js`. Le même principe doit être conservé : transport réseau séparé de l'état UI/session, moteur déterministe séparé de l'orchestration navigateur.
