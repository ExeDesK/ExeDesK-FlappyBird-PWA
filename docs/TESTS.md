# Rapport de tests - v0.2.7.2b

## Résultat

- **101/101 tests Node passent** avec `npm test`.
- Le bundle concaténé utilisé par le smoke test passe le contrôle de syntaxe JavaScript.
- Le smoke test Chromium n’a pas été relancé dans cet environnement, où Playwright Python et Chromium ne sont pas installés.
- Le cache PWA contient **31 ressources** et refuse de se déclarer complet si une ressource de précache manque.
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
