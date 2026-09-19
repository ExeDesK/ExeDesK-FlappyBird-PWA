# Rapport de tests - v0.2.1b

## Résultat

- **49/49 tests Node passent**.
- Le smoke test Chromium isolé passe sans erreur JavaScript.
- Les 5 sons sont décodés dans le test navigateur.
- Le garde-fou paysage est visible dans un contexte mobile tactile simulé.
- Le cache PWA contient **28 ressources** et refuse de se déclarer complet si une ressource de précache manque.
- Le serveur Node local répond correctement à `/__health`, `index.html`, `src/main.js` et au manifeste sur un port de test.
- Le cycle Docker/Caddy réel n'a pas été exécuté dans cet environnement.

## Points couverts

| Domaine | Validation |
| --- | --- |
| PRNG | Comparaison avec 6 graines Java, 500 sorties par graine. |
| Physique de l'oiseau | 2000 updates comparées bit-à-bit avec la référence JVM. |
| États | Menu -> Ready -> Playing -> Game Over -> replay. |
| Déterminisme | Deux simulations identiques produisent exactement le même snapshot. |
| Cadence | 60 updates/s validées pour 30, 60, 90, 120, 144 et 240 Hz de présentation. |
| iOS pacing | Rattrapage borné et profiler rAF. |
| Sol | Interpolation cyclique sans rollback lors du wrap 24 px. |
| Tuyaux | Identités de rendu stables lors des recyclages. |
| Ratio Adapté | 288:512 centré; padding ciel/terre symétrique et rendu dans le Canvas. |
| Ratio Original | 288:512 centre, sans padding de scène. |
| Ciel jour/nuit | Couleurs exactes `(78,192,202)` et `(0,135,147)` tirées de l'atlas. |
| Terre | Couleur originale `(222,216,149)`, dans le même Canvas. |
| Orientation | `portrait-primary` dans le manifeste + garde-fou paysage. |
| iOS status bar | `black` opaque; aucun `black-translucent`. |
| Supersampling | x2 minimum, x3 sur DPR élevé, x2 en mode Performance. |
| Service Worker | Installation atomique, lecture offline, activation explicite et purge des anciens caches de la même portée. |

## Smoke test navigateur

`tests/browser_isolated.py` vérifie notamment :

- absence d'erreur JavaScript;
- ratio Original par défaut sur desktop;
- backing canvas x2 sur DPR 1;
- progression menu / ready / playing / game over;
- audio WebAudio avec 5 buffers;
- passage en mode Adapté et Canvas occupant toute la hauteur du viewport portrait;
- garde-fou paysage sur contexte mobile tactile;
- captures de contrôle des principaux états.

## Limites connues

- Le vrai cycle d'installation PWA et les comportements de barre d'état restent dépendants de WebKit/iOS.
- Safari/iOS ne permet pas à une page web de masquer de façon fiable la barre d'état système; le projet évite désormais le mode translucide qui floutait la zone supérieure.
- `screen.orientation.lock()` a un support limité; le manifeste et le garde-fou paysage assurent un comportement propre quand le verrouillage natif n'est pas disponible.
- Le déploiement Docker/Caddy est préparé mais n'a pas été lancé dans cet environnement.
