# Changelog

## v0.2.7.1n-hotfix1 - Score sync status hotfix

- Correction du message « synchronisation à réessayer » qui pouvait rester affiché après une synchronisation de record réussie.
- L'état du record est désormais indépendant d'une ancienne erreur de profil/authentification.
- Une lecture ou création de profil Supabase réussie efface explicitement l'erreur de profil précédente.
- Aucun changement du moteur déterministe, du score lui-même ni de la parité APK 1.3.

## v0.2.7.1b - Cross-device Score Sync

- Synchronisation du meilleur score entre appareils dès qu'un compte Discord est connecté.
- À la connexion, au retour du réseau et après un nouveau record, la PWA conserve automatiquement `max(record local, record cloud)`.
- Ajout de `profiles.best_score` et de la RPC PostgreSQL atomique `sync_best_score()` ; le record cloud ne peut jamais être diminué par la synchronisation.
- Le record cloud récupéré devient aussi le record local de l'appareil, donc il reste disponible hors ligne ensuite.
- Ce record personnel reste non vérifié et ne sera pas utilisé comme source d'autorité par le futur leaderboard.
- Ajout de `supabase/002_best_score_sync.sql`.

## v0.2.7b - Discord Auth & Profiles

- Connexion Discord facultative via Supabase Auth.
- Profil joueur synchronisé (`username`, nom d’affichage, avatar) avec cache local pour l’affichage hors connexion.
- Le jeu reste entièrement jouable sans compte.
- Session OAuth persistée et renouvelée via refresh token, sans dépendance JavaScript distante.
- Ajout de `supabase/001_profiles.sql` avec RLS et droits Data API explicites.
- La configuration Supabase n'est plus versionnée dans le code : GitHub Pages génère `site/config.js` depuis `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`.
- La publishable key reste nécessairement visible côté navigateur ; les contrôles d'accès reposent sur RLS.

## v0.2.6.5b - iOS startup audio recovery

- Correction d’une régression de v0.2.6.4b où un `AudioContext` fraîchement créé pouvait rester `suspended` sur iOS et bloquer tout le son dès le lancement.
- Le timeout de sécurité couvre désormais aussi `suspended`, pas seulement `interrupted`, afin qu’une promesse `resume()` bloquée ne verrouille plus toutes les tentatives suivantes.
- Ajout d’une impulsion audio silencieuse lors de la création/recréation du contexte pour initialiser la session Web Audio pendant le geste utilisateur.
- Si la reprise reste bloquée, le prochain geste utilisateur déclenche toujours la récupération forte par recréation du contexte.
- Ajout de tests de régression dédiés aux `resume()` suspendus indéfiniment sur un contexte initial.
- Aucun changement du moteur déterministe ni de la parité APK 1.3.

## v0.2.6.4b - iOS lock-screen audio hard recovery

- Renforcement de la récupération audio iOS après verrouillage/déverrouillage du téléphone.
- Si WebKit laisse l'`AudioContext` en état `interrupted`, le prochain geste utilisateur recrée entièrement le contexte audio au lieu de dépendre uniquement de `resume()`.
- Re-décodage automatique des cinq SFX après recréation du contexte, sans rechargement de la PWA.
- Le premier son demandé pendant la récupération est mis en attente puis joué dès que le nouveau contexte est prêt.
- Détection des `resume()` qui résolvent sans réellement sortir de `interrupted`, avec bascule vers la récupération forte au geste suivant.
- Ajout d'un timeout de sécurité pour les promesses `resume()` iOS qui resteraient bloquées après verrouillage.
- Diagnostics audio enrichis (`HARD_RECOVERY_*`, `SFX_QUEUED`, `SFX_FLUSHED`) et schéma v2.
- Aucun changement du moteur déterministe ni de la parité APK 1.3.

## v0.2.6.3b - Home icon alignment

- Remplacement du pictogramme Maison en `box-shadow` par une icône SVG pixel-art centrée géométriquement dans le bouton.
- Aucun changement du moteur déterministe ni du correctif audio iOS.

## v0.2.6.2b - iOS audio interruption recovery

- Correction du bug audio reproduit sur iOS/Safari : un `AudioContext` pouvait rester dans l’état WebKit `interrupted` après un retour au premier plan.
- `interrupted` est désormais traité comme un état récupérable, au même titre que `suspended`, et déclenche `AudioContext.resume()`.
- Tentative de récupération au retour de focus, `pageshow` et `visibilitychange`, avec nouvelle tentative garantie au prochain geste utilisateur.
- Un SFX demandé alors que le contexte est interrompu déclenche aussi une tentative de récupération avant d’être ignoré pour ce tick.
- Ajout de tests de régression dédiés à l’état iOS `interrupted`.
- Aucun changement du moteur déterministe ; la parité APK 1.3 reste inchangée.

## v0.2.6.1b - Navigation & settings polish

- Le bouton Maison est désormais disponible sur READY et GAME OVER ; il reste masqué uniquement pendant le gameplay et la phase de mort.
- Correction du centrage pixel-perfect de l’icône Maison dans son bouton.
- Ajout dans les options d’une mention claire de la conformité 1:1 au comportement de la dernière version originale publiée, Flappy Bird 1.3.
- Ajout d’un lien vers le dépôt GitHub en bas des réglages.
- Aucun changement du moteur déterministe : la parité APK 1.3 reste protégée par la CI.

## v0.2.6b - Continuous APK 1.3 parity

- Ajout d'une validation 1:1 APK 1.3 ↔ PWA exécutée automatiquement sur chaque push et chaque pull request.
- Comparaison des quatre scénarios golden : mort au sol, score 10, collision tuyau supérieur et partie longue score 20.
- Validation tick par tick, avec comparaison float32 bit à bit des champs flottants via le harness v3.2.2.
- Le workflow GitHub Pages exécute la parité avant déploiement : une divergence bloque la publication de `main`.
- Aucun APK n'est stocké ou téléchargé par le dépôt PWA ou sa CI.
- Aucun changement volontaire du moteur de jeu : cette version fige et protège la conformité déterministe déjà mesurée.

## v0.2.5.1b - READY home navigation

- Ajout d’un bouton Maison pendant la phase READY pour revenir proprement à l’écran d’accueil sans recharger la PWA.
- Le bouton Réglages reste disponible uniquement sur l’écran d’accueil ; aucun bouton n’est affiché pendant la partie.
- Adaptation de la navigation clavier : Échap revient à l’accueil depuis READY.
- Prépare une navigation cohérente pour les futurs lobbies et modes multijoueur.
- Aucun changement du moteur de jeu, de la physique, de l’audio ou du système de mise à jour.

## v0.2.5b - Flappy-like UI

- Refonte de l'interface HTML/PWA dans un style plus proche du jeu : panneaux carrés, palette jaune pâle, bordures franches et typographie monospace/pixel-like.
- Le bouton Options adopte un look pixel sur le menu principal et disparaît hors de cet écran.
- Suppression de l'accès debug des réglages principaux et du raccourci H.
- Les outils de diagnostic restent inchangés et sont accessibles uniquement par un lien discret tout en bas des options.
- Réorganisation des options en blocs Jeu / Application / Record, avec textes plus courts et plus lisibles.
- Toasts, écran de chargement et garde-fou portrait harmonisés avec la nouvelle identité visuelle.
- Conservation intégrale du moteur de jeu, de la physique, de l'audio instrumenté et du système de mise à jour automatique de v0.2.4b.

## v0.2.4b - Automatic PWA updates

- Remplacement de la purge manuelle du cache par un cycle de mise à jour PWA standard et non destructif.
- Vérification automatique au lancement, au retour au premier plan, au retour du réseau et toutes les 15 minutes.
- Une nouvelle version est téléchargée et mise en attente sans interrompre une partie en cours.
- Une mise à jour déjà prête est activée automatiquement au lancement suivant, avec rechargement contrôlé.
- Le bouton des options devient une action de vérification / installation manuelle de secours.
- Le Service Worker expose son numéro de build pour fiabiliser l’échange avec la page active.
- Conservation de l’installation atomique : une build incomplète n’écrase jamais la build fonctionnelle.
- Toast de démarrage simplifié : « Tout est prêt · vous pouvez jouer même hors connexion. »
- Les diagnostics audio de v0.2.3b-dev1 restent présents pour continuer à capturer le bug intermittent.

## v0.2.3b-dev1 - Audio diagnostics

- Ajout d'un journal circulaire des 250 derniers événements audio/lifecycle.
- Trace les ouvertures/fermetures des réglages, debug, focus, visibilité, pageshow/pagehide et réseau.
- Trace la création/reprise de l'AudioContext, son état, le décodage et chaque SFX demandé/joué/ignoré.
- Ajout d'un état audio live dans le panneau debug.
- Ajout de « Copier audio » et « Exporter audio » pour capturer le bug sans recharger l'application.
- Aucun changement volontaire de la logique de jeu ou de la politique audio : cette build sert à identifier le déclencheur exact.


## v0.2.2b - GitHub Pages beta

- Préparation du dépôt pour un hébergement statique sur GitHub Pages.
- Ajout du workflow `.github/workflows/pages.yml` : tests puis publication automatique de `site/` sur chaque push de `main`.
- Ajout d'un workflow de tests dédié aux pull requests.
- Remplacement de la sonde serveur dynamique par `site/version.json`, volontairement non mise en cache par le Service Worker.
- Vérification des chemins relatifs pour supporter l'URL de projet `/<repository>/` de GitHub Pages.
- Suppression des éléments de self-hosting devenus inutiles dans le dépôt : Docker, Caddy, serveur local et scripts associés.
- Déplacement de l'outil de replay déterministe dans `tests/replay.mjs`.
- Nettoyage et réindentation du code JavaScript, CSS, HTML, tests et workflows sans modification volontaire du gameplay.
- Mise à jour du cache PWA et de l'interface vers `0.2.2b`.

## v0.2.1b - beta patch

- Mode Adapté entièrement rendu dans le même Canvas : scène 288 × 512 centrée, ciel complété au-dessus et terre complétée au-dessous.
- Suppression de l'extension CSS séparée qui pouvait laisser un vide ou clignoter lors d'un resize/orientationchange iOS.
- Le ciel ajouté suit automatiquement le fond jour/nuit exact de l'atlas ; les fades noir et flash blanc couvrent aussi les extensions.
- Les tuyaux supérieurs peuvent se prolonger dans le ciel ajouté ; les tuyaux inférieurs restent clipsés au viewport original et ne débordent jamais dans la terre.
- Mode Original maintenu centré dans la fenêtre.
- Préférence PWA `portrait-primary`, tentative de verrouillage via Screen Orientation API et garde-fou plein écran en paysage sur appareils tactiles.
- iOS standalone : status bar opaque noire au lieu de `black-translucent`.
- Mode Performance ne modifie plus la taille CSS du jeu ; il limite uniquement le supersampling interne à ×2.

## v0.2b - beta

- Passage du projet au statut bêta.
- Supersampling du Canvas : ×2 minimum, jusqu'à ×3 sur les écrans à fort DPR.
- Amélioration du rendu de l'oiseau lorsqu'il est incliné, sans modifier la physique ni les coordonnées 288 × 512.
- Mode Performance limité à ×2 sur les appareils à fort DPR.
- Ratio Original par défaut sur desktop ; Adapté par défaut sur mobile.
- Correction de l'interpolation du sol et des apparitions furtives de tuyaux.
- Profiler iOS / rAF et export de performances.
- Bouton de purge/mise à jour conditionné à la joignabilité de l'hébergement.
- Nettoyage des mentions de portage personnel dans l'interface et les métadonnées PWA.
- Footer d'installation PWA Windows / iOS / Android et crédits .GEARS Studios.
