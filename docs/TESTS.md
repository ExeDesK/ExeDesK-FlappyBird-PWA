## v0.2.7.3b-dev6.3.1

- Non-régression du sol France : l'offset visuel continue au travers du wrap natif `-22 → 0` au lieu de repartir au début de l'image toutes les 24 px.
- Vérifie que `land_france` est rendu en deux tuiles adjacentes lorsque nécessaire, afin que la bande complète de 336 px puisse défiler sans trou.
- Le test historique du `cyclicLerp(..., 24)` original reste inchangé et confirme que le thème Original conserve le comportement APK 1.3.
- Le smoke test Chromium isolé a été remis à niveau pour charger `themes.js` et `customatlas.png`/`customatlas.json` dans son environnement embarqué.
- Suite complète : `npm test` (**134/134**) + `python tests/browser_isolated.py`.

# Rapport de tests - v0.2.7.3b-dev5

## Résultat

- **120/120 tests Node passent** avec `npm test`.
- Le bundle concaténé utilisé par le smoke test passe le contrôle de syntaxe JavaScript.
- Le smoke test Chromium n’a pas été relancé dans cet environnement, où Playwright Python et Chromium ne sont pas installés.
- Le cache PWA contient **32 ressources** et refuse de se déclarer complet si une ressource de précache manque.
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
| Rétention | 50 runs vérifiées les plus récemment commencées + record historique, purge serveur privée et sérialisation concurrente par joueur. |
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

Les tests client vérifient les trois décisions de départ : jeu local sans session, ticket en ligne avec session Discord et avertissement hors ligne. Ils couvrent aussi l’interception exacte du relâchement de PLAY, le tick `0` indépendant du temps passé sur READY, la capture jusqu’à la collision et la file locale dédupliquée/bornée.

Un contrôle statique garantit que l’interface appelle bien `run-start`, construit le moteur canonique, attache l’enregistreur et exige une confirmation explicite avant le fallback non classé.

## Soumission autoritaire (v0.2.7.2b-dev3)

Les tests vérifient le contrat de résultat, la suppression des champs réservés au serveur, le hash SHA-256 canonique, un replay accepté et plusieurs motifs de rejet. `run-submit` doit authentifier l’utilisateur, filtrer simultanément `run_id`, `player_id` et `status = issued`, puis accepter uniquement les retries possédant le même hash.

La copie Edge de `math.js`, `game.js` et `verified-runs.js` est comparée octet par octet aux sources PWA avant chaque suite de tests. Les contrôles client couvrent également la séparation de la file par compte, sa vidange automatique et la suppression d’un run seulement après une réponse définitive.

## Durcissement de la file Verified Runs (v0.2.7.2b-dev4)

Les tests client couvrent désormais la migration automatique des anciennes files : les entrées sans `player_id`, les entrées malformées et les doublons sont supprimés, tandis que les runs valides d’un autre compte restent stockés mais isolés.

Ils vérifient aussi qu’une nouvelle soumission ne peut pas être mise en file sans propriétaire valide et qu’un `404 run_not_found` est terminal, alors que les erreurs réseau, `429`, `5xx` et les `404` non liés à un run absent restent différables. Cette protection empêche une entrée irrécupérable en tête de file de bloquer les runs suivants.

## Leaderboard public vérifié (v0.2.7.3b-dev2)

Les tests dédiés valident que la RPC `get_leaderboard()` est appelable sans session Discord et n'envoie aucun header `Authorization`. Ils vérifient également que la migration SQL filtre strictement `status = 'verified'`, choisit un seul meilleur score par `player_id`, accorde l'exécution à `anon`/`authenticated` et ne publie aucun champ de replay interne.

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
