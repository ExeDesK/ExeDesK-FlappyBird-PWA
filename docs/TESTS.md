## v0.2.7.7b-hotfix3 — Replay RPC performance

- `tests/leaderboard.test.mjs` vérifie que `015_replay_rpc_perf.sql` remplace le recalcul `get_leaderboard(100)` par un Top 100 sur `player_stats`.
- Le test exige l'index partiel couvrant `best_score DESC, best_score_at ASC, player_id ASC INCLUDE (best_run_id)`.
- Le RPC conserve les grants publics via fonction `security definer`, sans accorder de `SELECT` direct sur `verified_runs` ou `player_stats`.
- Suite complète : `npm test` **204/204** + `python tests/browser_isolated.py` **OK / 0 erreur page** + `python tests/admin_browser_isolated.py` **OK / 0 erreur page** + `git diff --check` **OK**.

## v0.2.7.7b-hotfix2 — Replay Controls visual polish

- `tests/leaderboard.test.mjs` couvre les vitesses autorisées, la conversion ratio↔tick et l'animation cyclique du handle rouge `bird2_0..2`.
- `tests/themes.test.mjs` verrouille le custom atlas **2038×514** et exige tous les sprites replay fournis.
- Le smoke Chromium ouvre un vrai replay déterministe, le met en pause, active les hitbox, seek à 50 %, vérifie le handle rouge, sélectionne ×5 via le bouton atlas, vérifie le press-state d'un pixel puis reprend jusqu'au terminal.
- Suite complète : `npm test` **202/202** + `python tests/browser_isolated.py` **OK / 0 erreur page** + `python tests/admin_browser_isolated.py` **OK / 0 erreur page**.

## v0.2.7.6b — Leaderboard Replay Viewing

- `tests/leaderboard.test.mjs` couvre le `run_id` du leaderboard, le RPC public `get_leaderboard_replay`, la validation du payload déterministe, l'absence d'auth obligatoire, le contexte visuel enregistré et le fallback aléatoire des runs legacy.
- `tests/verified-run-recorder.test.mjs` verrouille l'ajout du `visual_context` sans seed/score client-owned.
- `tests/run-submit.test.mjs` vérifie que le contexte visuel est normalisé, inclus dans le hash idempotent et stocké séparément sans participer à la physique.
- La migration `014_replay_viewing.sql` est testée pour ne jamais accorder de `SELECT` navigateur direct sur `verified_runs` et pour ne rendre que le meilleur run courant.
- Le cache PWA contient **57 ressources runtime**, dont `replay/replay-viewer.js`.
- Suite complète : `npm test` **200/200** + `python tests/browser_isolated.py` **OK / 0 erreur** + `python tests/admin_browser_isolated.py` **OK / 0 erreur**.

## v0.2.7.5b — Accounts & Profiles

- `tests/auth.test.mjs` couvre les deux sens de linking Discord/Google, les comptes Google-first et Discord historiques, la reconnexion via chaque provider, le mode offline avec identités liées, le unlink et la persistance immédiate du profil dans le cache offline.
- `tests/profile-customization.test.mjs` couvre la disparition/révocation du provider sélectionné, le fallback vers l'autre avatar, l'avatar généré et l'absence volontaire de contrainte d'unicité sur le pseudo.
- `tests/leaderboard.test.mjs` verrouille la propagation immédiate d'un profil modifié dans une ligne déjà chargée et l'invalidation du cache. `tests/admin-analytics.test.mjs` verrouille la jointure live sur `public.profiles`.
- `tests/ci.test.mjs` exige les contrôles **DÉLIER / CONFIRMER / ANNULER / DERNIER ACCÈS** et le message de gestion des identités.
- Le cache PWA contient désormais **56 ressources runtime**, dont `ui/avatar-fallback.js`.
- Suite complète : `npm test` **193/193** + `python tests/browser_isolated.py` **OK** + `python tests/admin_browser_isolated.py` **OK**.

## v0.2.7.4b-dev11-hotfix1 — Profile Data API permissions

- `tests/profile-customization.test.mjs` verrouille les grants PostgREST sur `username`, `display_name`, `avatar_url` et `avatar_provider` tout en interdisant toujours l’écriture directe de `best_score`.
- `013_profile_permissions_hotfix.sql` réaffirme le droit `SELECT`, les droits `UPDATE` de colonnes et la policy RLS owner-only pour les bases ayant déjà appliqué dev11.
- Suite complète : `npm test` **181/181** + `python tests/browser_isolated.py` **OK** + `python tests/admin_browser_isolated.py` **OK**.

## v0.2.7.4b-dev11 — Profile personalization

- `tests/profile-customization.test.mjs` couvre l'ordre du premier provider, l'extraction des avatars Discord/Google depuis `identity_data`, la normalisation du pseudo, le PATCH du profil et la migration `012_profile_customization.sql`.
- Le smoke test Chromium rend un profil Discord+Google et vérifie le formulaire de pseudo ainsi que les deux choix d'avatar, avec Discord sélectionné par défaut lorsqu'il est le premier provider lié.
- `auth.js` reste sous **450 lignes** grâce au nouveau `api/profile-client.js`; les métadonnées provider sont isolées dans `auth/provider-profile.js`.
- Le cache PWA contient désormais **55 ressources runtime**.
- Suite complète : `npm test` **180/180** + smoke tests gameplay et Admin **OK**.

## v0.2.7.4b-dev10 — Google OAuth & account linking

- `tests/auth.test.mjs` couvre la connexion Google, les scopes OAuth, la liaison Google depuis un compte Discord existant sans changement d'UUID, les métadonnées de profil Google et les garde-fous de linking.
- Le garde-fou architectural maintient `auth.js` à **450 lignes maximum** et isole toujours la logique provider dans `auth/identity-linking.js` (**320 lignes maximum**).
- Le smoke test Chromium vérifie que Discord et Google sont présents uniquement dans Profil et qu'Options reste totalement exempt d'authentification.
- Admin Analytics expose également les deux providers tout en conservant l'allow-list par `auth.users.id`.
- Le cache PWA reste à **53 ressources runtime** : aucun SDK Google ni asset réseau supplémentaire n'est ajouté.
- Suite complète : `npm test` **173/173** + smoke tests gameplay et Admin **OK**.

## v0.2.7.4b-dev9 — Account linking foundation

- Fondation provider-agnostic de l'identity linking, compatibilité des comptes Discord historiques et conservation de l'UUID canonique.
- Aucun second provider n'était encore exposé dans l'interface.

## v0.2.7.4b-dev8 — RATE unavailable toast

- `tests/core.test.mjs` verrouille que l’événement `about` déclenché par RATE affiche le toast attendu et n’appelle plus `openOptions()`.
- Le smoke test Chromium vérifie que RATE conserve MENU, laisse Options fermé et rend le toast visible.

## v0.2.7.4b-dev6 — Press-state atlas pixel-stable

- Le smoke test Chromium vérifie que `Profil` ne se décale pas horizontalement pendant `pointerdown`, descend exactement de **1,75 px CSS** (un pixel source à x1,75) et clippe **1,75 px** en bas.
- Le même test vérifie `Close` à **1 px** ainsi que la persistance de la classe `atlas-pressed` après un tap tactile très rapide, avant ouverture/fermeture effective de la modale.
- Le délai minimal du press-state est de **70 ms** ; la logique de clic reste identique une fois cet état visuel affiché.

## v0.2.7.4b-dev5 — Verified ticket abandonment recovery

- `tests/run-abandonment.test.mjs` vérifie la RPC owner-only d’annulation, l’appel client sur Home depuis READY, l’absence de blocage par nombre de tickets et la rotation serveur à 100 `issued`.
- `run-start` ne gère plus `too_many_pending_runs`; seul le rate-limit 30/minute peut encore produire un `429`.
- Le cache PWA contient désormais **52 ressources runtime** avec `session/verified-run-abandon.js`.
- Suite complète : `npm test` **164/164** + `python tests/browser_isolated.py` **OK, 0 erreur page**.

- `tests/themes.test.mjs` verrouille le nouvel atlas 1854×514 et exige `button_close`, `button_home`, `button_options` et `button_profile`.
- Le smoke test Chromium vérifie le bouton Profil sur HOME à gauche de Menu, son absence hors HOME, l'absence totale d'auth dans Options, la présence de la connexion/déconnexion dans Profil, les utilitaires en x1,75 et les fermetures atlas en x1.
- Les modales masquent les utilitaires de HOME tant qu'elles sont ouvertes.
- Suite complète : `npm test` **159/159** + `python tests/browser_isolated.py` **OK, 0 erreur page**.

## v0.2.7.4b — Admin Analytics

- Ajout de `tests/admin-analytics.test.mjs` pour verrouiller les tables privées, l'allow-list admin, le suivi du temps de jeu autoritaire, les agrégats quotidiens, les cohortes D0/D1/D7/D30 et les compteurs de lifecycle `run-start`.
- `admin_analytics_daily()` expose une série UTC cohérente incluant DAU, WAU et MAU glissants en plus des runs, scores, temps et compteurs backend.
- Ajout de `tests/admin_browser_isolated.py` : smoke test Chromium du dashboard avec Supabase Auth/RPC mockés, sans accès réseau réel ni secret.
- Le dashboard reste hors précache ; le runtime PWA gameplay reste à **51 ressources**.
- Suite complète : `npm test` (**159/159**) + `python tests/browser_isolated.py` (**OK**) + `python tests/admin_browser_isolated.py` (**OK**).

## v0.2.7.3b-dev6.3.6

- Ajout de `tests/ticket-hygiene.test.mjs` pour vérifier les TTL `issued` / `rejected`, les index partiels, le verrou par joueur, le cap de 10 tickets ouverts, la fenêtre 30/minute, les droits server-only et le job Supabase Cron.
- `tests/verified-runs.test.mjs` impose désormais que `run-start` passe par `issue_verified_run()` et ne fasse plus d'`INSERT` direct dans `verified_runs`.
- `tests/auth.test.mjs` vérifie qu'un `429` de `run-start` conserve `status`, `code`, `retryAfter` et `retryable` côté `VerifiedRunClient`.
- Le cache PWA reste à **51 ressources runtime** : le changement backend n'ajoute aucun asset client, mais le build Service Worker est incrémenté pour publier la nouvelle version.
- Suite complète : `npm test` (**152/152**) + `python tests/browser_isolated.py` (**OK, 0 erreur page**).

# Rapport de tests - v0.2.7.7b-hotfix3

## Résultat

- **204/204 tests Node passent** avec `npm test`.
- Le bundle concaténé utilisé par le smoke test passe le contrôle de syntaxe JavaScript.
- Le smoke test Chromium isolé passe sans erreur page et couvre aussi le lecteur de replay réel sur une run déterministe connue (seed/taps, France nuit, score terminal et événement audio `hit`), la composition des modules ES, le catalogue dynamique, le thème Vietnam jour/nuit, le panneau diagnostic repliable, la modale Profil, les boutons utilitaires x1,75 et le module d’abandon de ticket Verified Run.
- Le smoke test Admin Analytics dédié passe également sans erreur page avec Auth/RPC Supabase mockés et couvre les vues Overview, Joueurs, Rétention et Système.
- Le cache PWA contient **57 ressources** et refuse de se déclarer complet si une ressource de précache manque.
- `version.json` reste volontairement hors du cache du Service Worker afin de servir de sonde réseau réelle pour la mise à jour.
- Les liens et ressources du site utilisent des chemins relatifs compatibles avec un projet GitHub Pages publié sous `/<repository>/`.

## Points couverts

| Domaine | Validation |
| --- | --- |
| PRNG | Comparaison avec 6 graines Java, 500 sorties par graine. |
| Physique de l'oiseau | 2000 updates comparées bit-à-bit avec la référence JVM. |
| États | Menu → Ready → Playing → Game Over → retour accueil / replay. |
| Déterminisme | Deux simulations identiques produisent exactement le même snapshot. |
| Cadence | 60 updates/s validées pour 30, 60, 90, 120, 144 et 240 Hz de présentation. |
| iOS pacing | Rattrapage borné et profiler rAF. |
| Sol | Interpolation cyclique sans rollback lors du wrap 24 px. |
| Tuyaux | Identités de rendu stables lors des recyclages. |
| Ratio Adapté | 288:512 centré ; ciel/terre supplémentaires rendus dans le même Canvas. |
| Ratio Original | 288:512 centré, sans padding de scène. |
| Ciel jour/nuit | Couleurs exactes `(78,192,202)` et `(0,135,147)` tirées de l'atlas. |
| Terre | Couleur originale `(222,216,149)`, dans le même Canvas. |
| Orientation | `portrait-primary` dans le manifeste + garde-fou paysage. |
| iOS status bar | `black` opaque ; aucun `black-translucent`. |
| Supersampling | ×2 minimum, ×3 sur DPR élevé, ×2 en mode Performance. |
| Service Worker | Installation atomique, lecture offline, mise à jour en attente, activation contrôlée et purge des anciens caches de la même portée. |
| GitHub Pages | Chemins relatifs vérifiés ; `version.json` reste network-only. |
| Audio iOS | `interrupted` et `suspended` bloqués, timeout de `resume()`, hard recovery et impulsion silencieuse couverts par des tests dédiés. |
| Verified Runs | Ticket serveur, capture différée, moteur Edge synchronisé, relecture autoritaire et résolution atomique `verified/rejected`. |
| Leaderboard | RPC publique sans session, uniquement runs `verified`, meilleur score unique par joueur et absence de données replay exposées. |
| Player stats | Agrégats lifetime privés, backfill autoritaire, trigger `verified`, causes de mort et absence totale de stats dans la soumission client. |
| Rétention | 50 runs vérifiées les plus récemment commencées + record historique, plus TTL `issued` 7 j / `rejected` 30 j, Cron horaire, cap de 10 tickets ouverts et rate limit 30/min sur `run-start`. |
| Contexte personnel | RPC authentifiée basée sur `auth.uid()`, rang global hors Top 100, record/count/date vérifiés et état non classé. |

## Smoke test navigateur

`tests/browser_isolated.py` vérifie notamment :

- absence d'erreur JavaScript ;
- ratio Original par défaut sur desktop ;
- backing canvas ×2 sur DPR 1 ;
- progression Menu / Ready / Playing / Game Over ;
- bouton Maison sur Ready et Game Over, masqué pendant le gameplay ;
- mention de parité 1:1 et lien GitHub dans les réglages ;
- audio WebAudio avec 5 buffers ;
- passage en mode Adapté et Canvas occupant toute la hauteur du viewport portrait ;
- garde-fou paysage sur contexte mobile tactile ;
- captures de contrôle des principaux états.

Ce test embarque les ressources dans une page Chromium isolée. Il ne remplace pas un vrai déploiement HTTP(S), une installation PWA réelle ou l'exécution du workflow GitHub Pages.

## GitHub Actions

Trois workflows sont présents :

- `.github/workflows/tests.yml` lance `npm test` sur les pull requests et à la demande ;
- `.github/workflows/apk-parity.yml` compare la PWA aux golden traces APK 1.3 sur chaque push et pull request ;
- `.github/workflows/pages.yml` lance les tests et la parité sur `main`, puis publie `site/` avec GitHub Pages uniquement si tout réussit.

Le déploiement GitHub Pages lui-même sera validé par GitHub lors du premier push après activation de **Settings → Pages → Source → GitHub Actions**.

## Limites connues

- Le vrai cycle d'installation PWA et les comportements de barre d'état restent dépendants de WebKit/iOS.
- Safari/iOS ne permet pas à une page web de masquer de façon fiable la barre d'état système.
- `screen.orientation.lock()` a un support limité ; le manifeste et le garde-fou paysage assurent un comportement propre quand le verrouillage natif n'est pas disponible.
- Le smoke test Chromium isolé ne valide pas le Service Worker dans une vraie origine HTTPS.

## Continuous APK 1.3 parity (v0.2.6b)

The GitHub Actions workflow `.github/workflows/apk-parity.yml` checks the deterministic PWA engine against the pinned `v3.2.2` release of `ExeDesK/Flappy13-APK-TestHarness` on every push and pull request.

The four golden scenarios are also executed by the GitHub Pages workflow before deployment, so a deterministic divergence blocks publication from `main`.

The APK itself is never required in CI; only the previously validated golden traces are used.

## Auth Discord / profils et score sync (v0.2.7.1n-hotfix1)

Tests automatiques dédiés :

- génération de l'URL OAuth Discord via Supabase ;
- consommation du fragment OAuth et suppression des tokens de l'URL visible ;
- validation de session `/auth/v1/user` ;
- chargement du profil `public.profiles` ;
- démarrage hors ligne avec profil mis en cache ;
- absence de secret serveur dans le frontend ;
- présence des politiques RLS et grants Data API dans la migration SQL.
- appel RPC `sync_best_score()` avec le record local ;
- migration SQL garantissant un merge atomique `max(local, cloud)` et interdisant l’écriture directe de `best_score`.

## Fondation Verified Runs (v0.2.7.2b-dev1)

Les tests dédiés couvrent le contrat `flappy13-physics-v1`, la validation des tickets, le format de soumission minimal et les limites de ticks/taps.

Le constructeur canonique est comparé aux quatre états START du harness APK. La relecture autoritaire reproduit ensuite exactement leurs scores, collisions et ticks terminaux. Les replays annonçant une collision trop tard ou un tick terminal sans collision sont rejetés.

Des contrôles statiques vérifient également que :

- `public.verified_runs` a `run_id` comme clé primaire ;
- RLS est active et les rôles navigateur n’ont aucun droit direct ;
- `service_role` possède les droits serveur nécessaires sur `public.verified_runs` ;
- la migration demande le rechargement du cache de schéma PostgREST ;
- `run-start` exige un utilisateur authentifié ;
- la seed vient de `crypto.getRandomValues()` côté serveur ;
- la version de physique est identique entre le client et l’Edge Function.

## Intégration PLAY classé (v0.2.7.2b-dev2)

Les tests client vérifient les trois décisions de départ : jeu local sans session, ticket en ligne avec session authentifiée et avertissement hors ligne. Ils couvrent aussi l’interception exacte du relâchement de PLAY, le tick `0` indépendant du temps passé sur READY, la capture jusqu’à la collision et la file locale dédupliquée/bornée.

Un contrôle statique garantit que l’interface appelle bien `run-start`, construit le moteur canonique, attache l’enregistreur et exige une confirmation explicite avant le fallback non classé.

## Soumission autoritaire (v0.2.7.2b-dev3)

Les tests vérifient le contrat de résultat, la suppression des champs réservés au serveur, le hash SHA-256 canonique, un replay accepté et plusieurs motifs de rejet. `run-submit` doit authentifier l’utilisateur, filtrer simultanément `run_id`, `player_id` et `status = issued`, puis accepter uniquement les retries possédant le même hash.

La copie Edge de `math.js`, `game.js` et `verified-runs.js` est comparée octet par octet aux sources PWA avant chaque suite de tests. Les contrôles client couvrent également la séparation de la file par compte, sa vidange automatique et la suppression d’un run seulement après une réponse définitive.

## Durcissement de la file Verified Runs (v0.2.7.2b-dev4)

Les tests client couvrent désormais la migration automatique des anciennes files : les entrées sans `player_id`, les entrées malformées et les doublons sont supprimés, tandis que les runs valides d’un autre compte restent stockés mais isolés.

Ils vérifient aussi qu’une nouvelle soumission ne peut pas être mise en file sans propriétaire valide et qu’un `404 run_not_found` est terminal, alors que les erreurs réseau, `429`, `5xx` et les `404` non liés à un run absent restent différables. Cette protection empêche une entrée irrécupérable en tête de file de bloquer les runs suivants.

## Leaderboard public vérifié (v0.2.7.3b-dev2)

Les tests dédiés valident que la RPC `get_leaderboard()` est appelable sans session authentifiée et n'envoie aucun header `Authorization`. Ils vérifient également que la migration SQL filtre strictement `status = 'verified'`, choisit un seul meilleur score par `player_id`, accorde l'exécution à `anon`/`authenticated` et ne publie aucun champ de replay interne.

Le parser frontend refuse les joueurs dupliqués et les rangs/scores/timestamps invalides. Un contrôle statique garantit enfin que le classement vit dans une modale dédiée, que la mention de connexion reste visible pour les visiteurs et que le bouton SCORES original ouvre directement cette modale.


## Statistiques joueur persistantes (v0.2.7.3b-dev3)

Les tests dédiés valident que `public.player_stats` reste privée, que son backfill ne lit que les runs `status = 'verified'`, et que les compteurs de carrière sont dérivés de `verified_score`, `collision` et `resolved_at` autoritaires. Ils vérifient aussi le trigger sur la transition vers `verified`, l'incrément unique du nombre de parties/score cumulé et les trois causes de mort (`upper-pipe`, `lower-pipe`, `ground`).

Le contrat de soumission classée est désormais fermé : seuls `schema`, `run_id`, `physics_version`, `terminal_tick` et `taps` sont acceptés. Toute tentative d'ajouter une statistique ou un autre champ est rejetée avant la simulation.


## Rétention des Verified Runs (v0.2.7.3b-dev4)

Les tests de rétention vérifient que `006_verified_run_retention.sql` :

- conserve les 50 runs `verified` les plus récentes selon `issued_at` ;
- conserve toujours le meilleur run historique avec le même départage que le leaderboard ;
- ne supprime aucune ligne `issued` ou `rejected` ;
- sérialise la purge par joueur avec un verrou transactionnel afin de gérer les validations concurrentes ;
- déclenche la purge uniquement lors de l'entrée dans l'état `verified` ;
- garde les fonctions de maintenance inaccessibles à `anon` et `authenticated` ;
- applique une fois la même règle aux historiques déjà présents lors de la migration.


## Contexte personnel du leaderboard (v0.2.7.3b-dev5)

Les tests dédiés vérifient que `007_personal_leaderboard_context.sql` calcule le rang depuis `player_stats`, reprend le même tri global que le leaderboard et ne permet jamais à `anon` d'appeler la RPC. La fonction ne prend aucun `player_id` en paramètre : l'identité provient de `auth.uid()`.

Le client valide strictement les deux états autorisés (classé / non classé), envoie le JWT Supabase pour la RPC personnelle et affiche dans la modale la carte `VOTRE CLASSEMENT` avec rang, record, compteur lifetime et date du record.


## v0.2.7.3b-dev6

- Suite Node : **125/125 tests**.
- Nouveau fichier `tests/player-performance.test.mjs`.
- Vérifie la RPC authentifiée, l'absence de `player_id` client, les fenêtres 10/25/50, l'usage exclusif des runs `verified`, l'ordre `issued_at`, médiane/écart-type et l'UI de statistiques.


## v0.2.7.3b-dev6.1

- Le bloc `VOS STATISTIQUES` utilise `details/summary`, est replié par défaut et expose un chevron d’état.
- Les tests de version/cache ont été mis à jour vers `dev6.1`.
- Aucun changement attendu côté Supabase ou moteur physique.


## v0.2.7.3b-dev6.2.1

- Correctif de non-régression du lancement Verified PLAY : le mode `ticket` déclenche bien le fade noir avant l’attente de `run-start`.
- `ensureVerifiedPlayFadeToBlack()` garantit qu’aucune attente ne peut porter sur un fade jamais démarré.
- Suite complète : `npm test`.


## v0.2.7.3b-dev6.2.2

- Non-régression : le remplacement par le jeu vérifié peint d'abord une frame entièrement noire avant de lancer le fade de révélation.


## v0.2.7.3b-dev6.3

- `tests/themes.test.mjs` verrouille le seuil Auto France à `1/30`, les modes forcés Original/France, les variantes Jour/Nuit et le remapping purement visuel des sprites.
- Le test vérifie que `assets/customatlas.json` contient les dix sprites requis (fonds, tuyaux, sol, trois frames oiseau et deux boutons) et référence bien `customatlas.png` en `918 × 514`.
- `tests/cache.test.mjs` vérifie maintenant **35 ressources runtime**, incluant `customatlas.png`, `customatlas.json` et `src/themes.js`, afin que le thème reste disponible hors ligne.
- Les tests de physique et Verified Runs restent inchangés : le thème n’entre jamais dans l’état autoritaire de simulation.

## v0.2.7.3b-dev6.2.3

- Non-régression : les caches d’interpolation `previousCommands` / `currentCommands` sont eux-mêmes initialisés avec un overlay noir opaque avant le fade retour.
- Vérifie que la frame READY préchauffée ne peut pas être présentée entre le swap du `Game` et le début du reveal.
- Suite complète : `npm test`.

- Vérifier manuellement que les boutons atlas `Home`, `Menu`, `Profil` et `Fermer` descendent de **1 px** au clic et perdent visuellement **1 px** en bas pour simuler l’écrasement du sprite.
- Le smoke test desktop vérifie que `Menu` et `Profil` restent dans la largeur réelle du canvas centré et que le bord droit de `Menu` conserve un inset de 10 px par rapport au bord droit du jeu, jamais du viewport.
