## v0.2.7.7b - Replay Controls

- Ajoute les contrôles du lecteur de replay : **lecture/pause**, **recommencer**, vitesses **×1 / ×1,5 / ×2 / ×5**, et affichage/masquage des **hitbox**.
- Ajoute une timeline fixe de **240 px** issue du custom atlas ; elle est cliquable, draggable au pointeur/tactile et pilotable au clavier (`←` / `→` par pas d'une seconde, `Home`, `End`).
- Le seek reconstruit l'état déterministe depuis la seed et les taps sans jouer les sons intermédiaires. Un déplacement vers l'arrière repart du tick 0 ; un déplacement vers l'avant poursuit la simulation déjà reconstruite.
- Le curseur de timeline est l'**oiseau rouge original** (`bird2_0..2`) rendu en ×0,5 ; ses ailes changent de frame avec le tick du replay, y compris après un seek.
- Intègre le nouvel `customatlas.png/json` fourni : `button_restart`, `button_hitbox_off/on`, `button_x1`, `button_x1_5`, `button_x2`, `button_x5`, `replay_progress_track` et `replay_progress_filled`. Play/Pause réutilisent les sprites originaux `button_resume` / `button_pause`.
- Tous les boutons replay reprennent le press-state atlas existant : survol éclairci, déplacement vertical d'un pixel source, clipping inférieur et persistance minimale de 70 ms sur les taps rapides.
- Les hitbox utilisent le renderer de debug existant : oiseau 20×20, tuyaux 52×320 et ligne de sol y=400, sans modifier la physique ni le résultat du replay.
- Aucun changement Supabase, Edge Function, schéma, Verified Runs ou `flappy13-physics-v1`.
- Validation : `npm test` **202/202**, smoke Chromium gameplay **OK / 0 erreur** avec pause, hitbox, seek, vitesse ×5 et press-state atlas ; smoke Admin inchangé.

## v0.2.7.6b - Leaderboard Replay Viewing

- Ajoute un bouton **VOIR** sur chaque ligne du leaderboard afin de visionner le meilleur run vérifié public du joueur.
- Le lecteur reconstruit la partie à 60 ticks/s depuis la `seed`, `tap_ticks` et `terminal_tick` autoritaires déjà stockés ; aucune vidéo n’est enregistrée ni transférée.
- À la fin du replay, le score simulé localement est comparé au score vérifié serveur ; une divergence est signalée comme incompatibilité de build.
- Les nouvelles soumissions transportent un `visual_context` cosmétique (`theme` + variante effective `day`/`night`) sans modifier `flappy13-physics-v1` ni la décision de vérification. La file offline conserve également ce contexte.
- Ajoute `supabase/014_replay_viewing.sql` : colonnes `visual_theme` / `visual_variant`, `run_id` dans `get_leaderboard()` et RPC public restreint `get_leaderboard_replay()` qui n’expose que le record actuellement visible dans le leaderboard. Aucun `SELECT` direct sur `verified_runs` n’est accordé au navigateur.
- Les runs historiques sans contexte visuel restent visionnables ; leur thème et leur variante jour/nuit sont tirés aléatoirement à chaque lecture/relecture.
- Ajoute `replay/replay-viewer.js`, une modale dédiée, les sons natifs déclenchés par les mêmes événements de jeu et le fallback **REVOIR** après fin de lecture. Les contrôles avancés (pause, vitesse, seek) restent hors scope pour une future release.
- Le Service Worker précache désormais **57 ressources runtime**.
- Déploiement requis : migration `014`, redéploiement de `run-submit`, puis frontend. `run-start` reste inchangé.
- Validation : `npm test` **200/200**, smoke tests Chromium gameplay et Admin **OK / 0 erreur**.

## v0.2.7.5b - Accounts & Profiles

- Finalise la gestion des identités Discord/Google dans Profil : chaque provider lié affiche **LIÉ**, le dernier moyen de connexion est marqué **DERNIER ACCÈS**, et `DÉLIER` n'est proposé que lorsqu'un second login Discord/Google reste disponible.
- Ajoute une confirmation inline **CONFIRMER / ANNULER** avant toute déliaison, avec messages explicites sur la conservation du profil, du record et de l'historique. La couche Auth conserve un second garde-fou contre la suppression du dernier provider utilisable.
- Après un unlink, relit systématiquement l'utilisateur autoritaire Supabase puis réconcilie le profil : si la source d'avatar a disparu/révoquée, l'avatar bascule vers l'autre provider disponible ou repasse à un fallback généré sans URL distante.
- Ajoute `ui/avatar-fallback.js` : avatar de secours déterministe, sans requête réseau, partagé entre Profil, Leaderboard et Admin Analytics lorsqu'aucune photo Discord/Google n'est disponible.
- Les mises à jour de pseudo/avatar se propagent immédiatement à une ligne de leaderboard déjà chargée, invalident son cache mémoire et restent persistées dans `flappy13-auth-v1` pour le prochain démarrage hors ligne. Admin Analytics continue de lire `public.profiles` directement à chaque RPC.
- Les pseudos restent volontairement **non uniques** ; aucune contrainte SQL `UNIQUE` n'est ajoutée.
- Étend les tests aux parcours Discord → Google, Google → Discord, Google-only, ancien compte Discord, logout/login avec chaque provider, compte lié hors ligne, unlink, disparition d'un provider, fallback d'avatar, propagation leaderboard/Admin/cache offline et protection de la confirmation UI.
- Le Service Worker précache désormais **56 ressources runtime**.
- Aucun changement SQL, Edge Function, physique, Verified Runs, score, UUID joueur ou ownership.
- Validation : `npm test` **193/193**, smoke tests Chromium gameplay et Admin **OK**.

## v0.2.7.4b-dev11-hotfix1 - Profile Data API permissions

- Corrige l'erreur PostgREST `42501 / permission denied for table profiles` lors de l'enregistrement du pseudo ou de la photo de profil.
- `012_profile_customization.sql` devient autonome et réaccorde explicitement les droits `UPDATE` sur `username`, `display_name`, `avatar_url` et `avatar_provider`, tout en conservant `best_score` hors des écritures directes navigateur.
- Ajoute `013_profile_permissions_hotfix.sql` pour réparer les bases où `012` a déjà été exécutée ; la migration réaffirme aussi la policy RLS owner-only.
- Aucun compte, UUID, record, run ou historique n'est modifié.
- Validation : `npm test` **181/181**, smoke tests Chromium gameplay et Admin **OK**.

## v0.2.7.4b-dev11 - Profile personalization

- Ajoute la personnalisation du **pseudo public** directement dans Profil. Le pseudo initial reste celui créé depuis le premier provider connecté ; le joueur peut ensuite le modifier sans changer son `auth.users.id`, son record ni son historique.
- Ajoute le choix de la **photo de profil** entre les avatars fournis par Discord et Google lorsque les deux identités sont liées. Le provider choisi est mémorisé dans `profiles.avatar_provider` et `avatar_url` continue d'alimenter le leaderboard/Admin.
- Le choix d'avatar est dérivé des `identity_data` Supabase de chaque identité OAuth. Si un provider ne fournit pas d'image, il n'est pas proposé comme source d'avatar.
- Ajoute `supabase/012_profile_customization.sql`, sans backfill destructif : les profils existants gardent leur pseudo et leur avatar actuels ; la nouvelle préférence provider reste `NULL` jusqu'à un choix explicite.
- Ajoute `auth/provider-profile.js` et `api/profile-client.js` pour isoler la lecture des métadonnées provider et les mises à jour de profil. `auth.js` redescend sous son garde-fou architectural.
- Le Service Worker précache désormais **55 ressources runtime**.
- Aucun changement de physique, Verified Runs, score, leaderboard ranking ou ownership joueur.
- Validation : `npm test` **180/180**, `python tests/browser_isolated.py` **OK**, `python tests/admin_browser_isolated.py` **OK**.

## v0.2.7.4b-dev10 - Google OAuth & account linking

- Ajoute **SE CONNECTER AVEC GOOGLE** dans la modale Profil aux côtés de Discord, sans SDK Google ni secret OAuth dans le frontend.
- La section Profil devient **CONNEXIONS** et affiche Discord + Google : le provider déjà présent est marqué **LIÉ**, le provider absent propose **LIER**.
- Le linking Google passe par l’endpoint Supabase Auth authentifié `/auth/v1/user/identities/authorize` et conserve le même `auth.users.id`, donc le même profil, record, historique de runs et Analytics.
- Les comptes Discord existants et la clé locale `flappy13-auth-v1` restent inchangés ; aucune migration de joueur n’est effectuée.
- Ajoute un avertissement visible aux joueurs existants : pour un e-mail Google différent de Discord, il faut d’abord se connecter avec Discord puis utiliser **LIER** afin d’éviter la création d’un second profil.
- Aucun merge destructif : si l’identité Google appartient déjà à un autre UUID Supabase, la liaison échoue et aucun compte n’est écrasé.
- Le unlink reste implémenté côté Auth mais aucun bouton **DÉLIER** n’est encore exposé dans l’UI.
- Verified Runs, score sync, leaderboard et Admin Analytics deviennent explicitement provider-agnostic ; le dashboard Admin propose lui aussi Discord ou Google puis applique la même allow-list par UUID.
- Ajoute `docs/AUTH-GOOGLE.md` et met à jour `ACCOUNT-LINKING.md`, les README, l’architecture et les tests.
- Aucun SQL ni Edge Function supplémentaire ; configuration Google Cloud + provider Google + **Allow manual linking** requise dans Supabase.
- Validation : `npm test` **173/173**, `python tests/browser_isolated.py` **OK**, `python tests/admin_browser_isolated.py` **OK**.

## v0.2.7.4b-dev9 - Account linking foundation

- Ajoute une couche d'**identity linking** provider-agnostic autour de Supabase Auth, sans ajouter de second provider dans l'interface.
- Les comptes Discord existants restent les comptes canoniques : aucun UUID `auth.users.id`, aucune ligne `profiles`, aucun record, aucune statistique et aucune run vérifiée n'est migré ou recréé.
- La clé locale `flappy13-auth-v1` reste inchangée afin de conserver les sessions existantes dans les navigateurs.
- Ajoute `site/src/auth/identity-linking.js` pour isoler la normalisation des identités, l'intention OAuth de linking, `linkIdentity()` / `unlinkIdentity()` et la protection contre la suppression du dernier moyen de connexion.
- `AuthClient` expose désormais `signInWithProvider()`, `linkIdentity()`, `unlinkIdentity()` et `linkedIdentities()` ; `signInWithDiscord()` reste un wrapper compatible.
- La modale Profil affiche une section **COMPTES LIÉS** à partir des identités Supabase. Discord reste le seul provider affiché dans cette version et aucun bouton de liaison vers un second provider n'est exposé.
- Les anciennes sessions Discord ne contenant pas encore le tableau `identities` bénéficient d'un fallback de compatibilité jusqu'à la prochaine synchronisation `/auth/v1/user`.
- Le Service Worker précache le nouveau module d'identité ; le runtime passe à **53 ressources**.
- Aucun changement SQL, Edge Function, physique, Verified Runs, leaderboard ou données joueur.

## v0.2.7.4b-dev8 - Rate button unavailable toast

- Le bouton **RATE** ne redirige plus vers Options / un autre écran.
- Un clic sur RATE conserve le joueur sur l’écran courant et affiche un toast utilisateur : **« La fonctionnalité de notation n’est pas encore disponible. Merci pour ton soutien ! »**.
- Le comportement interne du bouton et les assets du jeu restent inchangés ; seule l’action shell PWA associée à l’événement `about` est adaptée.
- Aucun changement Supabase, physique, Verified Runs ou leaderboard.
- Validation : `npm test` **165/165** et `python tests/browser_isolated.py` **OK / 0 erreur page**.

## v0.2.7.4b-dev7 - Utility buttons constrained to game width

- Les boutons utilitaires `Menu`, `Home` et `Profil` sont désormais positionnés par rapport au bord droit de la **zone de jeu centrée**, et non plus au bord droit du viewport navigateur.
- Sur un écran desktop large, les boutons restent donc à l'intérieur de la largeur rendue du jeu et ne dérivent plus dans les bandes noires latérales.
- Sur mobile / écran étroit, où la zone de jeu occupe déjà toute la largeur disponible, le placement reste inchangé.
- Le calcul utilise la largeur réelle issue de `computeDisplaySize()` à chaque resize, ce qui suit automatiquement les modes Original / Adapté et les changements de taille de fenêtre.
- Aucun changement de gameplay, physique, hitbox de jeu, Verified Runs, authentification ou Supabase.

## v0.2.7.4b-dev6 - Pixel-stable atlas button press

- Corrige l'effet de pression des boutons atlas : **aucun déplacement horizontal** n'est désormais appliqué.
- `Home`, `Menu` et `Profil` descendent d'**un pixel source** du sprite (soit 1,75 px CSS à leur échelle actuelle) et la dernière ligne source est masquée par clipping ; `Close` fait la même chose à x1.
- Le sprite conserve sa largeur et sa hauteur de layout pendant la pression : on ne réduit plus physiquement l'élément, ce qui évite les décalages de rasterisation.
- Ajoute un état `atlas-pressed` piloté par Pointer Events avec une durée minimale de **70 ms** avant l'action, afin que l'effet soit réellement visible sur mobile même pour un tap très rapide.
- Le smoke test Chromium vérifie explicitement l'absence de déplacement horizontal, le déplacement vertical de 1,75 px / 1 px, le clipping de la ligne basse et la persistance du press-state lors d'un tap tactile rapide.
- Aucun changement de gameplay, physique, hitbox, Verified Runs, Supabase ou taille de zone cliquable.
- Validation : `npm test` **164/164**, `python tests/browser_isolated.py` **OK / 0 erreur page**, Admin Analytics **OK**.

## v0.2.7.4b-dev5 - Verified ticket abandonment recovery

- Corrige la fuite de tickets `issued` lorsqu’un joueur utilise **Home depuis READY** : le ticket courant est maintenant annulé côté Supabase via une RPC owner-only `cancel_verified_run()`.
- Ajoute `supabase/011_verified_run_abandonment.sql` et `VerifiedRunClient.cancel()` ; l’annulation ne peut supprimer qu’un ticket `issued` appartenant au joueur authentifié.
- Supprime le blocage serveur à **10 tickets pending** : `run-start` ne retourne plus `too_many_pending_runs`.
- Conserve le rate-limit **30 démarrages/minute** comme protection anti-abus.
- Pour borner le stockage sans bloquer le joueur, `issue_verified_run()` applique désormais une rotation automatique uniquement à partir de **100 tickets `issued`** : les plus anciens sont supprimés avant l’émission du nouveau ticket.
- Le TTL historique reste inchangé : `issued` à **7 jours**, `rejected` à **30 jours**. La possibilité de terminer hors ligne puis soumettre plus tard est conservée.
- Le lifecycle d’abandon est isolé dans `session/verified-run-abandon.js`, afin de maintenir `verified-play.js` à **296 lignes** et préserver le découpage architectural.
- Ajoute `tests/run-abandonment.test.mjs`; le runtime PWA passe à **52 ressources**.

## v0.2.7.4b-dev4 - Atlas button press squash

- Applique l’effet d’écrasement pixel-art sur tous les boutons atlas `button_close`, `button_options`, `button_home` et `button_profile`.
- Lors d’un clic/tap, le sprite descend de **1 px** et sa hauteur visible perd **1 px**, afin de masquer la seconde ligne basse prévue pour l’effet “press”.
- Effet appliqué côté CSS sur les boutons utilitaires et les boutons de fermeture, sans modifier les hitboxes ni la logique d’interface.

## v0.2.7.4b-dev3 - Authentication moved to Profile

- Supprime entièrement la section **Connexion** des Options : aucun bouton, état de session ou action d'authentification n'y reste.
- Déplace **SE CONNECTER AVEC DISCORD** dans la modale Profil lorsque le joueur n'est pas connecté.
- Conserve **SE DÉCONNECTER** en bas de la modale Profil lorsque la session est active.
- L'état de connexion Discord est lui aussi affiché exclusivement dans Profil.
- Aucun account linking ni second provider n'est ajouté à cette étape.
- Aucun changement de gameplay, physique, RNG, Verified Runs, leaderboard ou Supabase.
- Validation : `npm test` **159/159** et `python tests/browser_isolated.py` **OK / 0 erreur page**.

## v0.2.7.4b-dev2 - Profile controls polish

- Réduit légèrement la zone cliquable des boutons utilitaires Home / Menu / Profil : la hitbox passe de **68 × 68** à **60 × 60**.
- Rapproche les boutons **Profil** et **Menu** sur HOME grâce à un espacement horizontal plus compact.
- Déplace le bouton **SE DÉCONNECTER** des Options vers le bas de la modale **Profil**, afin de regrouper les actions liées au compte.
- Aucun changement de gameplay, physique, RNG, Verified Runs, leaderboard ou Supabase.
- Validation : `npm test` **159/159** et `python tests/browser_isolated.py` **OK / 0 erreur page**.

## v0.2.7.4b-dev1 - Profile modal & utility sprites

- Intégration du nouvel `customatlas.png` / `customatlas.json` (1854×514) avec `button_profile` et `button_close`.
- Ajout d'un bouton Profil sur HOME, à gauche de Menu ; il disparaît en READY, GAME OVER et pendant le gameplay.
- Déplacement de la présentation du profil dans une modale dédiée : avatar, identité, état de synchronisation et meilleur score.
- Aucun account linking ni bouton fournisseur n'est ajouté dans la modale Profil ; la connexion Discord existante reste temporairement dans Options.
- Home / Menu / Profil passent d'un rendu x2 à **x1,75** ; `button_close` est rendu en **x1** et remplace les fermetures texte des modales Options, Profil et Classement.
- Les boutons utilitaires sont masqués tant qu'une modale utilisateur est ouverte.
- `atlas.js` accepte maintenant aussi une URL d'image custom fournie sous forme de chaîne, ce qui garde le runtime normal inchangé et fiabilise le smoke test isolé.
- Aucun changement de physique, hitbox, RNG, Verified Runs, leaderboard ou Supabase.
- Validation : `npm test` **159/159** et `python tests/browser_isolated.py` **OK / 0 erreur page**.

## v0.2.7.4b - Admin Analytics

- Ajoute un dashboard privé sous `site/admin/` avec quatre vues : **Vue d'ensemble**, **Joueurs**, **Rétention** et **Système**.
- Ajoute `supabase/010_admin_analytics.sql` : allow-list `analytics_admins`, date de début de tracking, activité quotidienne par joueur et compteurs opérationnels quotidiens durables.
- Étend `player_stats` avec `tracked_play_ticks`, calculé uniquement à partir du `terminal_tick` autoritaire des nouvelles runs vérifiées ; le temps de jeu historique déjà supprimé par la rétention n'est volontairement pas inventé.
- Le dashboard expose joueurs total / actifs, **DAU / WAU / MAU**, nouvelles inscriptions, runs vérifiées, record global, score moyen, temps de jeu suivi, causes de mort, tickets pending/rejected et métriques de rate-limit / abandon.
- Ajoute la table joueurs avec recherche et tri (runs, record, temps suivi, activité récente) ainsi que le nombre de tickets `issued` ouverts par compte.
- Ajoute des cohortes de rétention **D0 / D1 / D7 / D30** basées sur la création du profil et une activité composée exclusivement de runs autoritaires `verified`.
- Les métriques de lifecycle survivent désormais à la purge des lignes détaillées : `run-start`, issued, verified, rejected, issued expirés, rejected purgés, rate-limit et plafond pending sont agrégés par jour UTC.
- L'accès est protégé par une allow-list PostgreSQL et des RPC `security definer`; aucune table Analytics ni clé `service_role` n'est exposée au navigateur.
- Le dashboard reste volontairement online-only et hors du précache PWA, afin de ne pas coupler l'administration à la disponibilité offline du jeu.
- Ajoute `docs/ADMIN-ANALYTICS.md`, `tests/admin-analytics.test.mjs` et un smoke test Chromium dédié avec Supabase mocké.
- Aucun changement de physique, collision, RNG, format de replay, leaderboard public ou contrat Edge `run-start` / `run-submit`.

## v0.2.7.3b-dev6.3.6 - Verified Run ticket hygiene

- Ajoute `supabase/009_verified_run_ticket_hygiene.sql` pour borner le cycle de vie des tickets non vérifiés sans toucher à la rétention 50+record des runs `verified`.
- Les tickets `issued` abandonnés sont supprimés après **7 jours** et les runs `rejected` après **30 jours** ; deux index partiels accélèrent ces purges.
- Le nettoyage global est exécuté **toutes les heures à H:17** via Supabase Cron / `pg_cron`, avec une purge immédiate des anciennes lignes lors de l'application de la migration.
- `run-start` n'insère plus directement dans `verified_runs` : il appelle la RPC serveur-only `issue_verified_run()` qui sérialise les créations par joueur avec un advisory lock.
- Protection anti-croissance sur `run-start` : maximum **10 tickets `issued` non résolus** par joueur et **30 démarrages sur une fenêtre glissante d'une minute**, toutes issues confondues.
- Le plafond `issued` nettoie opportunistiquement les tickets du joueur déjà âgés de plus de 7 jours avant de compter les tickets ouverts.
- Les dépassements retournent un `429` typé (`too_many_pending_runs` ou `rate_limited`) ; `VerifiedRunClient` conserve désormais `status`, `code`, `retryAfter` et `retryable` pour le fallback hors classement.
- La possibilité de terminer hors ligne puis soumettre plus tard est conservée : aucun TTL d'une heure n'est dérivé de `MAX_VERIFIED_RUN_TICK`; la fenêtre d'hygiène `issued` est de 7 jours.
- Ajoute `tests/ticket-hygiene.test.mjs` et étend les tests Edge/client ; suite locale : `npm test` **152/152** + `python tests/browser_isolated.py` **OK, 0 erreur page**.
- Aucun changement de `flappy13-physics-v1`, du format de replay, du score autoritaire, du leaderboard ou de `player_stats`.

## v0.2.7.3b-dev6.3.5 - Verified Play second architecture pass

- Découpe `session/verified-play.js` d'environ **415 à 296 lignes** : il reste le contrôleur d'orchestration du scénario PLAY vérifié au lieu d'implémenter lui-même stockage, retry et animation de transition.
- Déplace le recorder déterministe vers `replay/verified-run-recorder.js`, prêt à être réutilisé par les futurs replays sans dépendre du contrôleur de session.
- Isole la file locale dans `session/verified-run-queue.js` via `VerifiedRunQueue` : réparation des entrées legacy, ownership joueur, déduplication, borne à 50 et suppression des runs résolus.
- Isole la politique d'envoi dans `session/verified-run-submit.js` via `VerifiedRunSubmitter` : FIFO, classification des erreurs permanentes, arrêt sur erreur transitoire, agrégation du meilleur score vérifié.
- Déplace le fade PLAY dans `ui/game-transition.js` et le dialogue de fallback non classé dans `ui/unranked-warning.js`; `VerifiedPlayController` décide désormais **quand** les utiliser sans posséder leur implémentation UI.
- Réduit `verified-run-client.js` à ses deux règles d'interception PLAY (`verifiedRunStartMode` et hitbox de release), au lieu d'en faire un second module fourre-tout.
- Ajoute des tests unitaires dédiés recorder / queue / submitter / transition et verrouille `verified-play.js` à **300 lignes maximum** dans le garde-fou architectural.
- Le Service Worker précache les cinq nouveaux modules ; le bundle offline contient désormais **51 ressources runtime**.
- Suite locale : `npm test` **144/144** + `python tests/browser_isolated.py` **OK, 0 erreur page**.
- Aucun changement Supabase, SQL, Edge Function, physique, collision, RNG, contrat Verified Runs ou format de replay.

## v0.2.7.3b-dev6.3.4 - Frontend architecture split

- Refactorise le frontend sans framework ni étape de build : `main.js` reste l'orchestrateur du jeu mais passe d'environ **2699 à 1411 lignes**, avec les domaines UI, PWA, synchronisation et Verified Play déplacés vers des modules ES natifs dédiés.
- Réduit `auth.js` d'environ **643 à 399 lignes** et recentre `AuthClient` sur OAuth Discord, session Supabase et profil. Les accès leaderboard, Verified Runs et best-score ne font plus partie de cette classe.
- Ajoute des clients réseau ciblés : `api/LeaderboardClient`, `api/VerifiedRunClient` et `api/BestScoreClient`, construits sur les helpers Supabase partagés de `api/http.js`.
- Ajoute les contrôleurs `ui/LeaderboardUI`, `ui/AccountUI`, `ui/ToastController`, `session/VerifiedPlayController`, `session/ScoreSyncController` et `pwa/PwaUpdateManager` afin d'isoler les responsabilités auparavant concentrées dans `main.js`.
- Le cycle Verified Runs, y compris le fade PLAY, la file locale, le fallback hors classement et l'envoi différé, est regroupé dans `VerifiedPlayController` sans modifier le protocole ni `flappy13-physics-v1`.
- Le Service Worker précache les nouveaux modules ; le bundle offline contient désormais **46 ressources runtime**.
- Ajoute `docs/ARCHITECTURE.md` et un test de non-régression architectural qui verrouille la séparation des clients Supabase et empêche `main.js` / `auth.js` de redevenir les deux monolithes d'origine.
- Suite locale : `npm test` **139/139** + `python tests/browser_isolated.py` **OK, 0 erreur page**.
- Aucun changement Supabase, SQL, Edge Function, physique, collision, RNG, replay ou format de Verified Run n'est requis.

## v0.2.7.3b-dev6.3.3 - Vietnam theme & collapsible diagnostics

- Intègre le nouveau `customatlas.png` / `customatlas.json` (1714 × 514) avec les assets **Vietnam / Hanoï** : backgrounds jour/nuit, échafaudages bambou, oiseau dédié et `land_vietnam`.
- Ajoute `vietnam` au pool `country` avec `weight: 1`. Le pool reste globalement à **1/30** ; avec France et Vietnam de même poids, chacun représente donc **1/60** des runs en mode Auto.
- Le thème Vietnam utilise `land.scrollMode: "defilement"` et reste purement visuel : aucune modification de physique, collision, RNG, replay ou Verified Runs.
- Le sélecteur de thème du menu diagnostic est désormais entièrement généré depuis `assets/themes.json` : l'HTML ne contient plus aucune option de thème codée en dur. Tout thème valide ajouté au catalogue apparaît automatiquement au prochain chargement.
- Refonte des outils de diagnostic en **six sections repliables** : état moteur, thème visuel, simulation/replay, performance, audio et raccourcis.
- Ajoute une croix de fermeture directement dans le panneau de diagnostic.
- Retire le style clair spécifique du sélecteur de thème ; le panneau déclare uniquement `color-scheme: dark` afin de conserver les contrôles natifs sombres du navigateur.
- Le smoke test Chromium force également le thème Vietnam en variante Nuit et valide la fermeture interne du panneau.
- Suite locale : `npm test` **138/138** + `python tests/browser_isolated.py` **OK, 0 erreur page**.
- Aucun changement Supabase n'est requis.

## v0.2.7.3b-dev6.3.2 - Theme catalog & larger utility buttons

- Agrandit les boutons utilitaires Home / Options à **x2** : sprites `26 × 28` affichés en `52 × 56`, avec une zone interactive portée à `68 × 68` sans modifier le custom atlas.
- Ajoute `assets/themes.json`, catalogue déclaratif des thèmes. Chaque thème définit son libellé, ses backgrounds jour/nuit, ses tuyaux, ses trois frames d'oiseau, son sol, ses couleurs d'extension et son mode de défilement. Le thème `original` est déclaré comme thème `base` et reste le fallback Auto.
- Le tirage Auto est désormais structuré en **pools** : le pool `country` possède une probabilité globale fixe de **1/30**, indépendante du nombre de pays. Les thèmes d'un pool portent un `weight` relatif (`1` par défaut) ; avec dix pays de même poids, chacun vaut donc `1/300` de l'ensemble des runs tandis que le pool pays reste à `1/30`. Un poids `0` conserve le thème dans le menu debug mais l'exclut du tirage Auto.
- Le menu de diagnostic génère automatiquement la liste `Auto` + thèmes depuis `themes.json`; ajouter un thème ne nécessite plus d'ajouter une option HTML à la main.
- Généralise le rendu du sol avec `land.scrollMode` : `original` conserve le wrap natif 24 px, `defilement` accumule un offset visuel continu et répète la largeur complète du sprite.
- Supprime le remapping France hardcodé du renderer : backgrounds, tuyaux, oiseaux, sol et couleurs d'extension sont résolus depuis le catalogue.
- Ajoute `docs/THEMES.md` pour documenter le schéma et la procédure d'ajout d'un thème.
- Le Service Worker précache désormais `assets/themes.json` ; le bundle offline passe à **36 ressources runtime**.
- Aucun changement de physique, collision, RNG gameplay, Verified Runs ou Supabase.

## v0.2.7.3b-dev6.3.1 - France sewer scroll hotfix

- Corrige le saut visuel du sol « égouts parisiens » : le moteur original remet son offset de sol à zéro tous les 24 px, car le sprite 1.3 est lui-même périodique sur 24 px.
- Le thème France conserve désormais un offset visuel continu côté renderer et fait défiler l'intégralité de la bande `land_france` de 336 px.
- Deux copies adjacentes de la bande sont dessinées pendant le défilement afin d'assurer le bouclage horizontal sans zone vide lorsque la première copie sort de l'écran.
- Le comportement 24 px original reste strictement inchangé pour le thème Original ; aucune donnée de physique, collision, seed ou Verified Run n'est modifiée.
- Ajout de tests de non-régression sur la continuité au wrap 24 px et sur le tiling de la bande France.
- Le smoke test Chromium isolé charge désormais aussi `themes.js` et le custom atlas embarqué, afin de couvrir le runtime ajouté en `dev6.3`.
- Rafraîchit le `customatlas.png` France avec la dernière révision graphique fournie avant publication de `dev6.3.1` ; le manifest `customatlas.json` reste compatible et conserve les mêmes coordonnées de sprites.
- Aucun changement Supabase n'est requis.

## v0.2.7.3b-dev6.3 - Custom atlas & France theme

- Ajout d’un atlas graphique complémentaire `customatlas.png` et de son manifest JSON `customatlas.json`, chargé séparément de l’atlas original afin de préserver les ressources et coordonnées 1:1 de Flappy Bird 1.3.
- Ajout du thème **France** : Tour Eiffel jour/nuit, tuyaux baguette, sol « égouts parisiens » et oiseau dédié. Le changement est strictement visuel : physique, hitboxes, RNG de gameplay, Verified Runs et `flappy13-physics-v1` restent inchangés.
- En mode **Auto**, le thème France est tiré avec une probabilité de **1/30** à chaque nouvelle partie ; sinon le thème original est utilisé. La variante jour/nuit suit alors le fond choisi par le moteur original.
- Les outils de diagnostic permettent de forcer `Auto`, `Original` ou `France`; pour les modes forcés, la variante `Jour` / `Nuit` est sélectionnable.
- Les anciens pictogrammes CSS/SVG du bouton utilitaire ont été supprimés et remplacés par les sprites `button_options` / `button_home` du nouvel atlas.
- Le Service Worker met désormais en cache le custom atlas, son manifest et le module de thèmes pour conserver le fonctionnement PWA hors ligne.
- Ajout de tests sur le seuil 1/30, le remapping des sprites, les variantes forcées, le manifest et le cache PWA.
- Aucun changement Supabase n’est requis.

## v0.2.7.3b-dev6.2.3 - Verified PLAY renderer cache flash fix

- Corrige le flash restant lors du fade retour : les caches `previousCommands` / `currentCommands` contenaient encore une frame READY visible préparée avant le forçage du noir.
- Le swap vers le jeu vérifié construit désormais explicitement une frame de commandes avec overlay noir opaque, utilisée à la fois comme frame précédente et courante avant le premier rendu.
- Le fade retour interpole ensuite depuis cette vraie frame noire vers READY, sans exposer la scène préchauffée.
- Aucun changement de physique, de Verified Runs, de Supabase ni du moteur `flappy13-physics-v1`.

## v0.2.7.3b-dev6.2.2 - Verified PLAY fade flash fix

- Supprime le flash d'une frame lors du fade de retour après réception du ticket Verified Run.
- Le nouveau `Game` est maintenant forcé à 100 % noir et rendu une fois avant de démarrer le fade de révélation de 0,5 s.
- Aucun changement de physique, de Verified Runs, de Supabase ni du moteur `flappy13-physics-v1`.

## v0.2.7.3b-dev6.2.1 - Verified PLAY fade hotfix

- Correction d’un blocage après `run-start` : `verifiedRunStartMode()` renvoie `ticket`, mais `dev6.2` ne démarrait le fade que pour un mode inexistant `verified`.
- Le fade PLAY est maintenant explicitement garanti avant d’être attendu ; un fade de menu encore actif est laissé terminer puis le fade noir PLAY démarre.
- Ajout d’un test de non-régression pour verrouiller le contrat `mode === 'ticket'` et empêcher toute attente d’un fade jamais lancé.
- Aucun changement Supabase, physique, replay autoritaire ou contrat Verified Runs.

## v0.2.7.3b-dev6.2 - Toast & Verified Run start UX

- Les toasts passent dans le Top Layer via `popover=manual`, afin de rester visibles au-dessus des modales.
- Suppression des toasts de succès ou de progression (`Tout est prêt`, préparation/création/validation de run, synchronisation réussie, actualisation réussie, etc.).
- Les toasts sont désormais réservés aux erreurs et états dégradés : hors-ligne/envoi reporté, run rejeté, erreur locale, auth, leaderboard ou mise à jour en échec.
- Le message hors-ligne devient `Pas d’internet · envoi reporté. Le run reste conservé sur cet appareil.`
- Réintroduction de la transition PLAY native pour les Verified Runs : fade noir de 0,5 s dès le clic, `run-start` en parallèle, maintien au noir si le serveur tarde, puis fade retour de 0,5 s une fois le ticket reçu.
- Temps visuel minimum de lancement : 1 seconde, conforme à la cadence de transition originale.
- En cas d’échec de `run-start`, le choix de continuer localement repart depuis l’écran noir avec le fade original ; annuler restaure le menu par fade.
- Aucun changement Supabase, physique, replay autoritaire ou contrat Verified Runs.

## v0.2.7.3b-dev6.1 - UI readability & collapsible stats

- Augmentation modérée des tailles de police des menus, options, cartes et du leaderboard, surtout sur écrans tablette/desktop.
- Les micro-libellés des statistiques ont été agrandis pour rester lisibles sans modifier la densité mobile.
- `VOS STATISTIQUES` devient une section repliable native (`details/summary`), fermée par défaut.
- Ajout d'un chevron qui reflète visuellement l'état ouvert/fermé de la section.
- Le contexte essentiel `VOTRE CLASSEMENT` (rang, record, runs) reste toujours visible.
- Aucun changement Supabase, physique, Verified Runs ou calcul statistique.

## v0.2.7.3b-dev6 - Career & Recent Stats

- Ajout d’une RPC authentifiée `get_my_player_performance_stats()` basée exclusivement sur les données autoritaires.
- Statistiques carrière lifetime depuis `player_stats` : nombre de runs, total de points, moyenne historique et record.
- Statistiques court terme calculées sur les 10, 25 et 50 dernières runs vérifiées retenues : moyenne, meilleur score, médiane et écart-type.
- Ajout d’une tendance `50 dernières vs carrière` exprimée en pourcentage.
- Les fenêtres récentes sont ordonnées par `issued_at`; le vieux record conservé par la rétention ne pollue pas les 50 dernières.
- Nouvelle carte `VOS STATISTIQUES` dans la modale classement, réservée au joueur connecté.
- Aucun score ni statistique n’est envoyé par le client ; tout est dérivé côté Supabase.
- Ajout des tests de sécurité, contrat RPC et affichage des statistiques.

## v0.2.7.3b-dev5.9 - Dynamic iOS ProMotion guidance

- Le conseil ProMotion de `Options → Jeu → Performance` est désormais affiché uniquement sur iPhone/iPad/iPadOS.
- Mesure automatique de la cadence réelle `requestAnimationFrame` côté Safari.
- À partir d'environ 90 Hz, le message d'aide est remplacé par une confirmation `Haute fréquence active` avec la cadence mesurée.
- À environ 60 Hz, le conseil reste affiché avec le chemin du flag `Prefer Page Rendering Updates near 60fps`.
- Ajout du tutoriel vidéo `Enable That Hidden 120 hz Mode On Your iPhone`, directement au timecode 37 s.
- Aucun changement du moteur, des Verified Runs ou du backend Supabase.

## v0.2.7.3b-dev5.8 - iOS ProMotion guidance

- Ajout d'une note explicative dans `Options → Jeu → Performance` pour les appareils iPhone/iPad ProMotion.
- La note explique qu'iOS/WebKit peut limiter les mises à jour de page autour de 60 Hz et indique où désactiver `Prefer Page Rendering Updates near 60fps` pour profiter de la cadence native lorsque l'appareil le permet.
- Aucun popup ni changement automatique de réglage système : l'information reste discrète et non bloquante dans les options.
- Aucun changement de la physique `flappy13-physics-v1`, de `requestAnimationFrame`, des Verified Runs ou de Supabase.

## v0.2.7.3b-dev5.7 - iOS ProMotion / rAF cleanup

- Retour à `requestAnimationFrame` comme unique pilote de présentation sur toutes les plateformes.
- Suppression des contournements worker/timer expérimentaux de la branche iOS.
- Conservation des optimisations hot-path sans impact physique : cache du rectangle canvas, pas de focus/capture inutile sur les taps tactiles, trace replay copiée sans `structuredClone()` au moment du tap.
- Documentation du comportement WebKit ProMotion : le flag Safari `Prefer Page Rendering Updates near 60fps` ne peut pas être désactivé par le code de la PWA ; sur appareil ProMotion, le désactiver permet à rAF de suivre la cadence native quand WebKit l'autorise.
- Aucun changement de `flappy13-physics-v1`, Verified Runs ou Supabase.

# Changelog

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
