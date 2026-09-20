# Diagnostic audio - v0.2.3b-dev1

Cette build instrumente le moteur audio sans modifier volontairement son comportement.

## Quand le bug se reproduit

1. Ne rechargez pas la PWA.
2. Ouvrez les options et activez **Hitboxes et diagnostic** si nécessaire.
3. Fermez les options.
4. Vérifiez le bloc `AUDIO` dans le panneau diagnostic.
5. Cliquez sur **Copier audio** puis conservez le JSON, ou utilisez **Exporter audio**.

Le journal garde les 250 derniers événements et enregistre notamment :

- état de `AudioContext` ;
- ouverture/fermeture des réglages ;
- activation/désactivation du debug ;
- focus, blur, `visibilitychange`, `pageshow`, `pagehide` ;
- passage online/offline ;
- chargement et décodage des buffers ;
- chaque SFX demandé, joué, ignoré ou en erreur ;
- demandes et résultats de `AudioContext.resume()`.

## Scénarios utiles

- lancer puis jouer directement ;
- ouvrir/fermer les réglages puis jouer ;
- activer/désactiver le debug puis jouer ;
- jouer puis passer l'application en arrière-plan ;
- verrouiller/déverrouiller l'iPhone ;
- revenir dans la PWA puis jouer immédiatement.

Si le son disparaît, le JSON produit par **Copier audio** est le diagnostic à conserver.
