# iOS / ProMotion performance

## Architecture retenue

La PWA utilise `requestAnimationFrame` comme unique pilote graphique. La simulation reste découplée via `FixedClock(60)` et `render(alpha)`.

## WebKit ProMotion

Sur les appareils ProMotion, WebKit privilégie par défaut des mises à jour de page proches de 60 Hz lorsque le feature flag Safari `Prefer Page Rendering Updates near 60fps` est activé. Le code web ne dispose actuellement d'aucune API permettant de désactiver ce réglage ou de demander explicitement 120 Hz.

Quand l'utilisateur désactive ce flag et que le matériel/WebKit l'autorise, `requestAnimationFrame` peut suivre la cadence native supérieure à 60 Hz.

## Optimisations conservées

- géométrie canvas mise en cache hors du hot path du tap ;
- pas de focus/pointer capture sur les pointeurs tactiles ;
- pas de `preventDefault()` dans le hot path tactile ;
- copie légère de la trace d'entrée sans `structuredClone()` au tap ;
- physique inchangée à 60 Hz.

## Indication intégrée dans les options

À partir de `v0.2.7.3b-dev5.8`, la section `Options → Jeu → Performance` affiche une note discrète pour les appareils iPhone/iPad ProMotion. Elle indique que WebKit peut préférer des mises à jour de page proches de 60 Hz et précise le chemin du réglage `Prefer Page Rendering Updates near 60fps`.

La PWA ne modifie jamais ce réglage système elle-même.


## Détection dynamique ProMotion (dev5.9)

La PWA ne peut pas lire directement le flag Safari ni la fréquence maximale matérielle de l'écran. Elle mesure donc la cadence `requestAnimationFrame` observée sur les appareils Apple tactiles.

- `>= 90 Hz` : l'interface confirme que la haute fréquence est active et masque le tutoriel.
- `< 90 Hz` : l'interface affiche la cadence mesurée et le conseil pour `Prefer Page Rendering Updates near 60fps`, avec le tutoriel YouTube au timecode 37 s.
- Hors iOS/iPadOS : le bloc est masqué.

Cette détection confirme l'état de rendu réellement observable, mais ne permet pas de distinguer de façon certaine un écran 60 Hz natif d'un écran ProMotion limité à 60 Hz, Safari n'exposant pas cette information matérielle.
