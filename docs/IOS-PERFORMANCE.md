# iOS Performance — v0.2.7.3b-dev5.1

Cette version cible une micro-saccade perceptible sur iOS au moment de chaque flap, absente sur Android et desktop.

## Invariants

Le correctif ne modifie ni la physique, ni les ticks, ni le format des Verified Runs, ni les collisions. `flappy13-physics-v1` reste inchangée.

## Hot path tactile

Un `pointerdown` tactile ne fait plus que :

1. `preventDefault()` ;
2. transformer les coordonnées via une géométrie de canvas mise en cache ;
3. enregistrer le touch/tap ;
4. demander un déverrouillage audio uniquement si le contexte n'est pas déjà opérationnel.

Les opérations suivantes ne sont plus effectuées à chaque flap tactile :

- `screen.orientation.lock()` ;
- `canvas.focus()` ;
- `setPointerCapture()` ;
- `getBoundingClientRect()`.

Le verrouillage portrait reste demandé au boot et lors des retours au premier plan/changements d'orientation. Le manifeste PWA reste en `portrait-primary`.

## Audio

Lorsque l'`AudioContext` est déjà `running`, `Audio.needsUnlock()` permet de sortir immédiatement sans créer d'événement diagnostic ni lancer `resume()`.

Les événements exceptionnels (recovery, contexte interrompu, buffer absent, erreur, SFX mis en attente) restent journalisés. Les événements routiniers `SFX_REQUEST`/`SFX_STARTED` et les flaps muets ne créent plus d'objets timestampés à chaque tap.

## Trace locale

La trace de replay locale ne fait plus de `structuredClone(input)` sur les taps. Elle copie uniquement `touches` et `tap` avec leurs coordonnées primitives.

## Profiler iOS

Le profiler 10 s expose désormais :

- frame pacing rAF (`p95`, `p99`, `max`, frames >20/25/33 ms) ;
- coût du rendu ;
- coût synchrone du handler `tap` (`avg`, `p95`, `max`) ;
- coût de `audio.play('wing')` (`avg`, `p95`, `max`).

Pour valider le hotfix sur iPhone :

1. lancer un profil 10 s avec son activé et jouer normalement ;
2. lancer le même profil avec son désactivé ;
3. comparer le ressenti ainsi que `delta`, `tap` et `audio wing` entre les deux captures.
