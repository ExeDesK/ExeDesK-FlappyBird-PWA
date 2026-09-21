# Changelog

## v0.2.7.3b-dev5.1 - iOS input latency hotfix

- Allègement du hot path tactile iOS sans modifier la simulation ni `flappy13-physics-v1`.
- Suppression de `tryLockPortrait()`, `canvas.focus()` et `setPointerCapture()` sur chaque `pointerdown` tactile ; les contrôles desktop conservent focus et capture.
- Mise en cache de la géométrie du canvas lors des resize afin d'éviter `getBoundingClientRect()` à chaque flap.
- Fast-path audio : aucun `unlock()`/diagnostic de reprise lorsque l'`AudioContext` est déjà `running`, et suppression des événements diagnostiques routiniers alloués à chaque SFX réussi ou flap muet.
- Remplacement du `structuredClone(input)` déclenché sur les taps par une copie minimale des coordonnées nécessaires à la trace de replay locale.
- Extension du profiler 10 s avec les mesures `tap` et `audio wing` (moyenne, p95, max) pour diagnostiquer précisément iOS son ON/OFF.
- Aucun changement Supabase, Verified Runs, leaderboard, statistiques joueur ou politique de rétention.
- Validation automatisée : **123/123 tests Node** passent.

## v0.2.7.3b-dev5 - Personal leaderboard context

- Ajout d'une carte `VOTRE CLASSEMENT` dans la modale pour les joueurs connectés, sans modifier l'accès public au Top 100.
- Affichage du rang global réel même hors Top 100, du record vérifié historique, du nombre lifetime de runs vérifiées et de la date du record.
- Un joueur connecté sans run vérifiée est affiché `Pas encore classé` sans créer de faux score ou de faux rang.
- Ajout de la RPC authentifiée `get_my_leaderboard_context()` : aucun `player_id` n'est accepté en entrée, l'identité provient exclusivement de `auth.uid()`.
- La RPC lit uniquement `player_stats`, reste inaccessible à `anon` et n'expose aucun replay, seed, taps, collision détaillée ou autre donnée privée.
- Le rang suit le même ordre déterministe que le leaderboard : score décroissant, date du record croissante, puis `player_id`.
- Ajout de l'index partiel `player_stats_rank_idx` pour le calcul de rang des joueurs classés.
- Rafraîchissement conjoint du Top 100 et du contexte personnel après validation d'un run, retour réseau ou action `ACTUALISER`.
- Ajout de `supabase/007_personal_leaderboard_context.sql` et de tests de sécurité/validation dédiés.
- Validation automatisée : **120/120 tests Node** passent.

## v0.2.7.3b-dev4 - Verified Runs retention

- Activation de la rétention serveur des runs vérifiées : conservation des **50 parties vérifiées les plus récemment commencées** par joueur, plus du **meilleur run historique** lorsqu'il ne fait plus partie de cette fenêtre.
- La notion de « dernière run » utilise `issued_at` (début réel du run) et non `resolved_at`, afin qu'une partie terminée hors ligne puis soumise plus tard ne remonte pas artificiellement dans l'historique récent.
- Le record historique est sélectionné avec le même départage déterministe que le leaderboard : score décroissant, premier `resolved_at`, puis `run_id`.
- La purge est exécutée automatiquement côté PostgreSQL après chaque transition autoritaire vers `verified`; le client ne déclenche ni ne pilote aucune suppression.
- Ajout d'un verrou transactionnel par joueur pour sérialiser deux validations concurrentes et maintenir une borne stable de 50 ou 51 runs vérifiées détaillées.
- Les statistiques lifetime de `player_stats` sont persistées avant la rétention et ne dépendent plus de la présence des anciennes lignes détaillées.
- Migration initiale des historiques existants : chaque joueur déjà présent est ramené à 50 runs récentes, plus son record historique éventuel.
- Les tickets `issued` et les runs `rejected` ne sont jamais touchés par cette politique de rétention.
- Ajout de `supabase/006_verified_run_retention.sql`, de `docs/RETENTION.md` et de tests dédiés.
- Validation automatisée : **116/116 tests Node** passent.

## v0.2.7.3b-dev3 - Persistent authoritative player stats

- Ajout de `public.player_stats`, table privée d'agrégats lifetime dérivés exclusivement des runs autoritairement vérifiés.
- Les compteurs persistants couvrent `verified_runs_count`, `total_score`, le meilleur score/run/date, les première et dernière runs vérifiées, ainsi que les morts par tuyau haut, tuyau bas et sol.
- Ajout d'un backfill initial depuis les `verified_runs` existantes ; il ignore volontairement les joueurs déjà agrégés afin qu'une réexécution future ne puisse pas écraser l'historique après mise en place de la rétention.
- Ajout d'un trigger PostgreSQL sur la transition vers `status = 'verified'` : les statistiques sont mises à jour dans la même transaction que le verdict du run et une retry idempotente ne peut pas recompter la partie.
- Le navigateur n'envoie aucune statistique. Le contrat de soumission est désormais fermé aux cinq champs attendus (`schema`, `run_id`, `physics_version`, `terminal_tick`, `taps`) et rejette tout champ supplémentaire.
- `player_stats` n'accorde aucun accès direct à `anon` ou `authenticated` ; les futurs écrans personnels passeront par des RPC dédiées.
- Préparation de la future rétention `50 dernières runs + meilleur run historique` sans encore supprimer aucune donnée dans cette version.
- Ajout de `supabase/005_player_stats.sql`, de la documentation dédiée et de tests de non-régression.
- Validation automatisée : **110/110 tests Node** passent.

## v0.2.7.3b-dev2 - Dedicated leaderboard modal

- Le bouton SCORES ouvre désormais une modale `CLASSEMENT` dédiée au lieu d'injecter le leaderboard dans les options.
- La modale reprend le langage visuel existant (typographie pixel, palette crème/brun, bordures et ombres) sans mélanger compte, réglages et classement.
- Ajout d'un header et d'un bouton de fermeture dédiés, d'un scroll interne du Top 100 et d'un comportement responsive mobile.
- Le chargement public, l'actualisation manuelle, la mention « Se connecter pour apparaître sur le classement. » et le surlignage du joueur courant sont conservés.
- Les entrées de jeu et la simulation sont suspendues tant que la modale de classement est ouverte.
- Aucun changement de la RPC `get_leaderboard()`, du schéma Supabase, des Verified Runs ni de `flappy13-physics-v1`.
- Validation automatisée : **105/105 tests Node** passent.

## v0.2.7.3b-dev1 - Public verified leaderboard

- Ajout d'un classement global public accessible sans compte Discord via la RPC Supabase `get_leaderboard()`.
- Le classement est construit exclusivement depuis `public.verified_runs` avec `status = 'verified'`; `profiles.best_score` n'est jamais utilisé comme source d'autorité.
- Une seule ligne est conservée par joueur : son meilleur `verified_score`, avec le premier accomplissement comme départage stable en cas d'égalité.
- La table `verified_runs` reste privée : la RPC publique n'expose ni seed, ni taps, ni hash, ni collision, ni donnée interne de vérification.
- Le bouton SCORES du menu original ouvre désormais le classement global dans l'interface existante; les options permettent aussi de l'actualiser manuellement.
- Les visiteurs non connectés voient la mention « Se connecter pour apparaître sur le classement. » tout en conservant un accès complet en lecture.
- Ajout de `supabase/004_leaderboard.sql`, de `site/src/leaderboard.js` et de tests dédiés.
- Validation automatisée : **105/105 tests Node** passent.

## v0.2.7.2b - Verified Runs

- Stabilisation du pipeline Verified Runs après validation en conditions réelles des phases `dev1` à `dev4`.
- `run_id` et seed sont émis côté serveur, avec `physics_version` versionnée (`flappy13-physics-v1`).
- Les taps sont enregistrés par tick puis rejoués autoritairement côté serveur ; score et collision finale sont recalculés sans faire confiance au navigateur.
- Les runs invalides sont rejetés et une seconde soumission différente pour un même `run_id` est refusée ; les retries strictement identiques restent idempotents.
- Un run classé ne nécessite le réseau qu'au démarrage : il peut être terminé hors ligne puis soumis automatiquement au retour de la connexion.
- La file locale est isolée par joueur et auto-réparante : entrées ownerless/malformées/dupliquées nettoyées, `404 run_not_found` terminal, erreurs réseau/`429`/`5xx` conservées pour retry.
- Validation finale : suite automatisée complète réussie et tests live `run-start` → `run-submit` → `verified` concluants, y compris reprise après hors-ligne.
- Aucun changement du moteur déterministe par rapport à `v0.2.7.2b-dev4` et aucune nouvelle migration Supabase pour cette stabilisation.

## v0.2.7.2b-dev4 - Verified Runs queue hardening

- Correction du blocage de la file locale causé par d’anciens runs sans `player_id`, qui pouvaient être renvoyés indéfiniment après un `404 run_not_found`.
- Réparation automatique de la file Verified Runs : suppression des entrées sans propriétaire, malformées ou dupliquées, tout en conservant les runs valides des autres comptes.
- Toute nouvelle entrée de la file exige désormais un `player_id` valide ; un run ne peut plus devenir « ownerless ».
- `404 run_not_found` est désormais une erreur terminale : l’entrée locale est retirée et le flush continue avec les runs suivants au lieu de rester bloqué sur un poison pill.
- Les erreurs transitoires (`429`, `5xx`, réseau) restent différées sans perte du replay local.
- Ajout de tests de non-régression pour la réparation de file, l’isolation multi-compte, les doublons et la classification des erreurs terminales/transitoires.
- Aucun changement du moteur déterministe, de `flappy13-physics-v1`, du schéma SQL Supabase ni des Edge Functions.

## v0.2.7.2b-dev3 - Authoritative run submission

- Ajout de l’Edge Function authentifiée `run-submit`, qui recharge le ticket et sa seed directement depuis `public.verified_runs`.
- Relecture autoritaire du replay côté serveur : le navigateur n’envoie ni seed, ni score, ni collision, ni identité joueur.
- Résolution atomique d’un ticket `issued` vers `verified` ou `rejected`, avec score/collision recalculés, hash SHA-256 et code de rejet.
- Les retries strictement identiques sont idempotents ; toute seconde soumission différente pour le même `run_id` reçoit un conflit.
- Le moteur `flappy13-physics-v1` de l’Edge Function est généré depuis les sources PWA et sa synchronisation est imposée par `npm test`.
- Ajout d’un mode de simulation headless côté vérificateur, sans modifier la physique ni les traces APK.
- Vidange automatique de la file locale après une partie, au démarrage connecté et au retour du réseau.
- Les files sont séparées par identifiant de compte Discord ; un run reste conservé sur l’appareil après une erreur transitoire.
- Le meilleur score local/cross-device est mis à jour depuis le score autoritaire retourné par le serveur.

## v0.2.7.2b-dev2 - Ranked PLAY integration

- Le bouton PLAY demande désormais un ticket `run-start` pour chaque joueur disposant d’une session Discord et encore connecté au réseau.
- Le moteur local est remplacé par un départ canonique construit avec la seed serveur avant l’affichage de READY.
- Les taps efficaces sont enregistrés à partir du tick `0`, puis la soumission minimale est conservée dans une file locale bornée à la collision.
- Un joueur Discord hors ligne reçoit un avertissement explicite avant de pouvoir continuer en partie locale non classée.
- Un échec de création du ticket ne bascule jamais silencieusement en local : le joueur doit confirmer « Jouer quand même ».
- Les joueurs sans compte Discord conservent le chemin local historique, en ligne comme hors ligne.
- `run-submit` et la vidange serveur de la file locale restent à implémenter avant qu’un résultat apparaisse dans le leaderboard.

## v0.2.7.2b-dev1 - Verified Runs foundation

- Ajout du contrat indépendant `flappy13-physics-v1` et des schémas `flappy13-run-ticket-v1` / `flappy13-verified-run-v1`.
- Ajout d’un départ canonique qui reconstruit un moteur neuf depuis la seed serveur, traverse le cycle original MENU → PLAY → READY et ne modifie pas les retries locaux historiques.
- Ajout du cœur de relecture autoritaire : taps strictement croissants par tick, score et collision recalculés, rejet des collisions précoces et faux ticks terminaux.
- Validation du départ et de la relecture sur les quatre scénarios golden APK 1.3 : sol, score 10, tuyau supérieur et partie longue score 20.
- Ajout de `public.verified_runs`, table privée avec RLS et aucun accès direct pour `anon`/`authenticated`.
- Ajout de l’Edge Function authentifiée `run-start`, seule autorisée à créer un `run_id` et une seed int32 cryptographiquement aléatoire.
- Ajout de `AuthClient.startVerifiedRun()` et validation stricte du ticket retourné.
- Cette étape n’active pas encore le mode classé dans l’interface, la file hors ligne ni `run-submit` ; ces éléments arrivent dans les phases suivantes de v0.2.7.2b.

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
