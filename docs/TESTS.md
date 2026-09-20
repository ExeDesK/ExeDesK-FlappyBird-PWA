# Rapport de tests - v0.2.6.4b

## Résultat

- **61/61 tests Node passent** avec `npm test`.
- Le smoke test Chromium isolé passe sans erreur JavaScript.
- Les 5 sons sont décodés dans le test navigateur.
- Le garde-fou paysage est visible dans un contexte mobile tactile simulé.
- Le cache PWA contient **28 ressources** et refuse de se déclarer complet si une ressource de précache manque.
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
