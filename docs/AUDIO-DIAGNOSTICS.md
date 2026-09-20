# Diagnostic audio - instrumentation et récupération iOS

Le moteur audio conserve un journal circulaire des 250 derniers événements afin de diagnostiquer les problèmes Web Audio, en particulier sur iOS/PWA.

## Quand le bug se reproduit

1. Ne rechargez pas la PWA.
2. Ouvrez **Réglages** puis **Outils de diagnostic** en bas de l'écran.
3. Vérifiez le bloc `AUDIO`.
4. Utilisez **Copier audio** ou **Exporter audio** et conservez le JSON.

Le journal enregistre notamment :

- état de `AudioContext` ;
- focus, blur, `visibilitychange`, `pageshow`, `pagehide` ;
- ouverture/fermeture des réglages et activation du debug ;
- chargement et décodage des buffers ;
- chaque SFX demandé, joué, mis en attente ou ignoré ;
- demandes et résultats de `AudioContext.resume()` ;
- récupération forte par recréation du contexte audio.

## Scénarios utiles

- lancer puis jouer directement ;
- ouvrir/fermer les réglages puis jouer ;
- jouer puis passer l'application en arrière-plan ;
- **verrouiller l'iPhone pendant une partie, attendre quelques secondes, puis déverrouiller** ;
- revenir dans la PWA et toucher immédiatement l'écran.

## Diagnostic établi

Une capture réelle sur iPhone/iOS 18.7 a montré que WebKit peut placer le `AudioContext` dans l'état non standard `interrupted` lorsque l'application perd l'accès à la session audio. Dans certains cas, le contexte revient spontanément à `running`. Dans d'autres, il reste `interrupted` alors que la page est de nouveau visible et focalisée.

La v0.2.6.2b a ajouté une tentative de `resume()` pour cet état. Le verrouillage/déverrouillage du téléphone peut toutefois laisser le contexte irrécupérable avec `resume()` seul, ou laisser la promesse de reprise bloquée.

## Récupération v0.2.6.4b

La stratégie est désormais à deux niveaux :

1. au retour au premier plan, tenter une reprise normale avec `resume()` ;
2. si le contexte reste `interrupted`, le prochain geste utilisateur déclenche une **récupération forte** :
   - création d'un nouvel `AudioContext` pendant le geste utilisateur ;
   - fermeture de l'ancien contexte ;
   - re-décodage des cinq SFX déjà chargés en mémoire ;
   - remise en lecture du premier SFX demandé pendant la récupération.

Un timeout protège aussi contre un `resume()` iOS qui resterait indéfiniment en attente après verrouillage.

Les événements `HARD_RECOVERY_*`, `SFX_QUEUED` et `SFX_FLUSHED` permettent de vérifier précisément ce chemin dans un export diagnostic.


## Correctif v0.2.6.5b

Une seconde capture a montré qu’iOS peut également laisser un `AudioContext` **fraîchement créé** en état `suspended`, avec une promesse `resume()` qui ne se résout jamais. Dans ce cas, le verrou de reprise restait actif et tous les sons suivants étaient mis en attente.

La v0.2.6.5b corrige ce cas en :

- appliquant le timeout de sécurité à toutes les reprises non `running`, y compris `suspended` ;
- libérant le verrou de reprise après timeout ;
- marquant le contexte pour récupération forte au prochain geste ;
- envoyant une impulsion audio silencieuse lors de la création du contexte pour initialiser la session Web Audio iOS pendant le geste utilisateur.

Les événements `UNLOCK_PULSE` et `RESUME_TIMEOUT` permettent de confirmer ce chemin dans les diagnostics.
