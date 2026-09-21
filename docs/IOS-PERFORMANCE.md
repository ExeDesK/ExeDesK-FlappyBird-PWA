# iOS Performance — v0.2.7.3b-dev5.3

Cette version cible une micro-saccade perceptible sur iOS au moment de chaque flap, absente sur Android et desktop.

## dev5.2 : focus et default actions WebKit

Le profil iPhone du dev5.1 montrait un handler de tap et un rendu quasi nuls, mais des frames longues exactement au contact. Le dev5.2 cible donc le travail interne WebKit qui peut arriver **après** le retour du handler JavaScript :

- le canvas n'est plus focusable (`tabindex` supprimé) ;
- un PointerEvent tactile n'appelle plus `preventDefault()` ;
- `touch-action: none` bloque déjà pan/zoom sur le canvas ;
- souris et stylet conservent la capture de pointeur ;
- le profiler mesure maintenant `tap → prochain rAF` et le `delta` de la frame contenant le tap.

Le moteur logique, la cadence 60 Hz et `flappy13-physics-v1` ne changent pas.

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


## dev5.3 — contournement du scheduler WebKit

Les mesures `dev5.2` sur iPhone ont montré une corrélation 1:1 : chaque tap observé appartenait à une frame > 25 ms, typiquement 30–31 ms, alors que le handler de tap et `render()` restaient quasi nuls. Ce profil correspond au bug WebKit public où les événements tactiles retardent `requestAnimationFrame`.

Le mode `AUTO` utilise donc un timer 60 Hz comme pilote sur iOS WebKit uniquement. La simulation ne dépend pas de ce timer : `FixedClock(60)` reste l'unique horloge physique et les Verified Runs continuent d'enregistrer les taps par tick. Les autres plateformes restent sur `requestAnimationFrame`.

Le panneau diagnostic permet de forcer `rAF` ou `TIMER 60 Hz` pour réaliser un A/B dans la même build. Le profiler exporte `frameDriver` et `driverFps`; les champs historiques `rafFps`/`tapRafCount` sont conservés pour compatibilité des exports, mais l'affichage parle désormais de frame/driver.
