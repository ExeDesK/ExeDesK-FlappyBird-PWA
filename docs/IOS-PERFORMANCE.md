# iOS Performance — v0.2.7.3b-dev5.6

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

1. horodater le tap si le profiler est actif ;
2. transformer les coordonnées via une géométrie de canvas mise en cache ;
3. enregistrer le touch/tap pour le prochain tick logique.

Il ne fait ni `preventDefault()` tactile, ni focus, ni capture de pointeur, ni opération audio.

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


## dev5.3 — essai timer thread principal

Les mesures `dev5.2` sur iPhone ont montré une corrélation 1:1 : chaque tap observé appartenait à une frame > 25 ms, typiquement 30–31 ms, alors que le handler de tap et `render()` restaient quasi nuls. Ce profil correspond au bug WebKit public où les événements tactiles retardent `requestAnimationFrame`.

`dev5.3` a testé un timer du thread principal à 60 Hz. Le hitch ponctuel au tap a disparu, mais le profil réel iPhone a montré **500 frames en 10 s**, soit **50 FPS**, avec un delta stable autour de 20 ms. Ce pilote n'est donc pas retenu comme défaut : il transforme un hitch ponctuel en manque de fluidité permanent.

Le mode `TIMER 60 Hz (TEST)` reste disponible dans les diagnostics uniquement pour reproduire ce comportement et comparer les schedulers.

## dev5.4 — ticker Web Worker 60 Hz

Le mode `AUTO` utilise désormais un **Dedicated Web Worker** sur iOS WebKit. Le worker ne contient ni moteur de jeu, ni physique, ni logique Verified Runs : il émet uniquement des messages de cadence vers le thread principal.

Le ticker utilise une échéance absolue (`nextAt += 1000 / 60`) avec correction de dérive. Lors de chaque message, le thread principal appelle exactement le même chemin `animate(performance.now())`, toujours piloté par `FixedClock(60)`. Android et desktop restent sur `requestAnimationFrame`.

Modes de diagnostic disponibles :

- `AUTO (WORKER SUR iOS)` : worker sur iOS, rAF ailleurs ;
- `rAF` : scheduler natif pour reproduire le hitch WebKit ;
- `WORKER 60 Hz` : force le nouveau ticker ;
- `TIMER 60 Hz (TEST)` : ancien essai main-thread, conservé uniquement pour A/B.

Si le worker n'est pas disponible ou échoue à démarrer, le runtime retombe automatiquement sur `requestAnimationFrame` et le profiler rapporte le pilote réellement actif.

Le Service Worker précache également `frame-driver.js` et `frame-ticker.worker.js` afin que ce chemin reste disponible en PWA hors connexion.

## v0.2.7.3b-dev5.6 — worker sur-échantillonné

Le `dev5.5` a démontré qu'un mapping strict `1 message worker = 1 tick` supprimait le motif `0/1/2`, mais dégradait la sensation au flap. Le `dev5.6` repart donc de l'architecture `dev5.4` : `FixedClock(60)` et interpolation restent propriétaires de la simulation/rendu.

Sur iOS uniquement, le worker de présentation passe de 60 à **120 impulsions par seconde**. La physique reste à 60 Hz ; les callbacks supplémentaires servent uniquement à réduire la latence de phase et à fournir un état interpolé plus récent au prochain rafraîchissement physique de l'écran.

Objectifs du profil iOS :

- conserver `tapFramesOver25 = 0` ;
- conserver `render p95 <= 1 ms` ;
- réduire les drops/jitters perceptibles par rapport au worker 60 Hz ;
- ne modifier ni `flappy13-physics-v1`, ni le format des Verified Runs.
