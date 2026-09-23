# Verified Runs — contrat v0.2.7.2b

## État de l’implémentation

La phase 1, versionnée sous `v0.2.7.2b-dev1`, pose la fondation commune au client et au futur vérificateur serveur :

- `physics_version` indépendante de la version de l’application ;
- ticket authentifié avec `run_id` et seed choisis côté serveur ;
- état initial canonique reconstruit uniquement depuis cette seed ;
- format minimal de soumission ;
- relecture déterministe qui recalcule le score, le tick terminal et la collision ;
- table Supabase privée réservée aux Edge Functions.

La phase 2, versionnée sous `v0.2.7.2b-dev2`, raccorde cette fondation à l’interface :

- une session Discord en ligne demande un ticket à chaque clic sur PLAY ;
- le jeu actif est remplacé par le départ READY canonique construit depuis la seed serveur ;
- le premier tap efficace devient le tick `0` et les suivants sont enregistrés jusqu’à la collision ;
- la soumission minimale terminée est conservée dans une file locale bornée à 50 runs ;
- une session Discord hors ligne, ou une erreur de ticket, affiche un avertissement avant toute partie locale non classée ;
- un joueur sans session Discord conserve le chemin local historique sans avertissement.

La phase 3, versionnée sous `v0.2.7.2b-dev3`, ferme la boucle de vérification :

- `run-submit` recharge le ticket, la seed et le propriétaire depuis la base privée ;
- le replay est normalisé, hashé en SHA-256 et rejoué sans faire confiance au score client ;
- la ligne passe atomiquement de `issued` à `verified` ou `rejected` ;
- un retry strictement identique renvoie le résultat existant, tandis qu’une seconde soumission différente est refusée ;
- la PWA vide automatiquement la file après la partie, au démarrage connecté et au retour du réseau ;
- les erreurs transitoires conservent le replay localement pour une tentative ultérieure.

La phase 4, versionnée sous `v0.2.7.2b-dev4`, durcit la file locale avant le leaderboard :

- chaque entrée doit appartenir à un `player_id` UUID valide ; les anciennes entrées ownerless sont retirées ;
- la file se répare à la lecture en supprimant les entrées malformées et en gardant uniquement la version la plus récente d’un `run_id` dupliqué ;
- les runs valides d’autres comptes restent stockés sur l’appareil mais ne sont jamais soumis sous le compte actif ;
- `404 run_not_found` est terminal et ne peut plus bloquer les soumissions placées derrière lui ;
- les erreurs réseau, `429` et `5xx` restent différables.

Les runs vérifiés sont désormais persistés comme source d’autorité. La vue et l’interface du leaderboard restent une étape distincte.

## Versions du contrat

```text
physics_version : flappy13-physics-v1
ticket schema   : flappy13-run-ticket-v1
replay schema   : flappy13-verified-run-v1
result schema   : flappy13-run-result-v1
```

`physics_version` ne suit pas `VERSION`. Un correctif d’interface, d’audio ou de PWA ne doit pas invalider les replays. Elle ne change que si une modification affecte la simulation autoritaire.

## Ticket de départ

`POST /functions/v1/run-start` exige le JWT Supabase du joueur. L’Edge Function génère une seed int32 avec `crypto.getRandomValues()`, crée le ticket via le client serveur puis répond :

```json
{
  "schema": "flappy13-run-ticket-v1",
  "run_id": "123e4567-e89b-12d3-a456-426614174000",
  "seed": -123456789,
  "physics_version": "flappy13-physics-v1",
  "issued_at": "2026-09-20T18:00:00.000Z"
}
```

L’identité du joueur reste attachée au ticket en base et n’est jamais fournie par le navigateur.

## Départ canonique

Les parties locales conservent volontairement le comportement APK : le RNG et les positions des tuyaux survivent aux retries. Ce chemin historique n’est pas modifié.

Un run vérifié utilise au contraire un nouveau `Game` :

1. construction avec la seed du ticket ;
2. stabilisation du menu original ;
3. injection du clic PLAY original ;
4. stabilisation de l’écran READY ;
5. début du run au premier tap.

La convention est celle du harness APK :

```text
input du tick N
→ simulation du tick N
→ état N après simulation
```

Le premier tap vaut toujours `0`. Le temps passé par le joueur sur READY n’entre donc pas dans le replay.

## Soumission minimale

```json
{
  "schema": "flappy13-verified-run-v1",
  "run_id": "123e4567-e89b-12d3-a456-426614174000",
  "physics_version": "flappy13-physics-v1",
  "terminal_tick": 953,
  "taps": [0, 35, 70, 105]
}
```

La seed, l’identité et la date d’émission proviennent du ticket stocké côté serveur. Le score et la collision ne figurent pas dans le contrat client : ils sont recalculés.

Les bornes v1 sont :

- `terminal_tick` de `0` à `216000` inclus, soit une heure à 60 Hz ;
- un seul tap par tick ;
- ticks strictement croissants ;
- aucun tap après `terminal_tick`.

## Vérification et résultat

`POST /functions/v1/run-submit` exige le JWT du même joueur que le ticket. Le serveur refuse tout champ réservé (`seed`, `score`, `collision`, `player_id`), recharge la seed en base puis simule chaque tick jusqu’à la collision annoncée.

Une réponse vérifiée contient uniquement le résultat recalculé :

```json
{
  "schema": "flappy13-run-result-v1",
  "run_id": "123e4567-e89b-12d3-a456-426614174000",
  "physics_version": "flappy13-physics-v1",
  "status": "verified",
  "terminal_tick": 953,
  "score": 10,
  "collision": "lower-pipe",
  "rejection_code": null,
  "resolved_at": "2026-09-20T20:00:00.000Z",
  "idempotent": false
}
```

Un replay incohérent est persisté avec `status = rejected`, sans score ni collision. Une mise à jour conditionnelle sur `status = issued` garantit qu’un seul payload peut résoudre le ticket. Le même payload peut néanmoins être renvoyé après une coupure réseau : son hash identique rend l’opération idempotente.

Le code serveur utilise une copie générée du moteur dans `supabase/functions/_shared/physics-v1`. `npm run sync:edge-physics` la régénère et `npm test` échoue si elle diverge des sources de `site/src`.

## Modèle Supabase

La migration [`supabase/003_verified_runs.sql`](../supabase/003_verified_runs.sql) crée `public.verified_runs`.

- `run_id` est la clé primaire ;
- `player_id` référence `auth.users` ;
- les états possibles sont `issued`, `verified` et `rejected` ;
- les champs de résultat sont cohérents avec l’état via une contrainte SQL ;
- RLS est activée ;
- tous les droits directs sont retirés à `public`, `anon` et `authenticated`.
- seul `service_role`, utilisé côté serveur par les Edge Functions, reçoit les droits `select`, `insert` et `update`.
- le cache de schéma PostgREST est rechargé en fin de migration.

Le leaderboard public passe par la RPC dédiée `get_leaderboard()` et n’expose jamais directement les tickets, seeds ou rejets. Depuis `v0.2.7.3b-dev3`, la transition autoritaire vers `verified` alimente aussi `public.player_stats` via trigger PostgreSQL ; le client n’envoie aucune statistique.

## Déploiement

Exécuter les migrations dans l’ordre :

```text
supabase/001_profiles.sql
supabase/002_best_score_sync.sql
supabase/003_verified_runs.sql
supabase/004_leaderboard.sql
supabase/005_player_stats.sql
```

Vérifier ensuite la copie serveur du moteur et déployer les fonctions :

```bash
npm run check:edge-physics
npx supabase@latest functions deploy run-start --project-ref TON_PROJECT_REF
npx supabase@latest functions deploy run-submit --project-ref TON_PROJECT_REF
```

Les deux fonctions conservent la vérification JWT par défaut : ne pas utiliser `--no-verify-jwt`. Les variables Supabase nécessaires au wrapper serveur sont fournies automatiquement par la plateforme.

## Garanties testées

`npm test` vérifie notamment :

- les seeds int32 et tickets invalides ;
- l’absence de `seed` et de `score` dans la soumission normalisée ;
- l’état READY canonique et l’état RNG exact pour les quatre seeds golden ;
- les scores `0`, `10`, `0`, `20` ;
- les collisions `ground`, `lower-pipe`, `upper-pipe`, `lower-pipe` ;
- les ticks terminaux `53`, `953`, `224`, `1733` ;
- le rejet d’une collision antérieure ou d’un faux tick terminal ;
- la résolution `verified/rejected`, le hash canonique et les retries idempotents ;
- la synchronisation exacte du moteur partagé avec l’Edge Function ;
- l’isolation RLS de la table et la génération serveur de la seed.


## Rétention détaillée — v0.2.7.3b-dev4

Les runs `verified` ne sont plus conservées indéfiniment. Après chaque nouvelle validation autoritaire, PostgreSQL conserve pour le joueur :

- les 50 runs vérifiées les plus récemment **commencées** (`issued_at`) ;
- le meilleur run historique avec le même départage déterministe que le leaderboard.

Le résultat est donc de 50 lignes si le record fait partie des 50 dernières, ou 51 lignes au maximum s'il est plus ancien. `player_stats` conserve les agrégats lifetime avant toute purge. Les lignes `issued` et `rejected` ne sont pas concernées par cette politique.


## UX de démarrage (v0.2.7.3b-dev6.2.1)

La récupération du ticket `run-start` est masquée derrière la transition PLAY native :

1. clic PLAY ;
2. fade vers le noir pendant 0,5 s ;
3. `run-start` s’exécute en parallèle ;
4. l’écran reste noir si le serveur n’a pas encore répondu ;
5. le ticket reçu installe la partie canonique ;
6. fade retour pendant 0,5 s vers READY.

Le lancement dure donc au minimum une seconde, comme la transition visuelle d’origine. Aucun toast de succès n’est affiché pendant la création, l’envoi ou la validation normale d’une run. Seuls les problèmes (hors-ligne, rejet, stockage impossible, etc.) sont signalés.


### Hotfix dev6.2.1

`verifiedRunStartMode()` renvoie `ticket` pour un lancement classé connecté. Le hotfix garantit que ce mode déclenche réellement le fade PLAY avant l’attente du ticket serveur et protège aussi le cas où un fade de menu est encore en cours.


### Hotfix dev6.2.2

Lors du remplacement du menu noir par le `Game` canonique, le constructeur du nouveau jeu avait déjà commencé son propre tween de révélation. La première frame pouvait donc être partiellement visible avant le fade attendu. Le client force maintenant le nouveau jeu à un état 100 % noir, rend explicitement cette frame noire, puis démarre le fade retour de 0,5 s.


## Hygiène des tickets et protection de `run-start` (v0.2.7.3b-dev6.3.6)

La durée maximale de simulation (`MAX_VERIFIED_RUN_TICK = 216000`, soit une heure à 60 Hz) n'est **pas** utilisée comme durée de validité du ticket : un run peut être terminé hors ligne puis soumis plus tard. La politique serveur utilise donc une fenêtre distincte :

- `issued` abandonné : purge après **7 jours** ;
- `rejected` : purge après **30 jours** ;
- `verified` : politique historique inchangée, 50 runs récentes + record.

`run-start` génère toujours la seed int32 dans l'Edge Function avec `crypto.getRandomValues()`, mais l'insertion est désormais effectuée par la RPC serveur-only `issue_verified_run()`. Sous un advisory lock par joueur, elle impose :

- maximum **10** lignes `status = 'issued'` ouvertes ;
- maximum **30** tickets créés dans une fenêtre glissante d'une minute, quel que soit leur statut final.

Les dépassements retournent HTTP `429` avec `too_many_pending_runs` ou `rate_limited`. Le client conserve ces métadonnées d'erreur puis utilise le fallback non classé existant ; aucune donnée de score, seed ou identité n'est réinjectée par le navigateur.

La fonction `cleanup_stale_verified_run_tickets()` est exécutée une première fois pendant la migration `009_verified_run_ticket_hygiene.sql`, puis toutes les heures via Supabase Cron / `pg_cron`. Elle n'est exécutable ni par `anon` ni par `authenticated`.

## Architecture frontend depuis v0.2.7.3b-dev6.3.4

Le transport `run-start` / `run-submit` est isolé dans `site/src/api/verified-run-api.js` (`VerifiedRunClient`). En `dev6.3.4`, le cycle navigateur a d'abord été sorti de `main.js` vers `site/src/session/verified-play.js` (`VerifiedPlayController`). `main.js` ne conserve que l'installation du `Game` canonique et les points d'accroche avec la boucle du moteur ; `dev6.3.5` affine ensuite ce découpage en séparant recorder, queue, submitter et UI de transition.

Aucun contrat Verified Runs, payload, version de physique ou Edge Function n'est modifié par cette refactorisation.


### Second découpage v0.2.7.3b-dev6.3.5

Le cycle reste piloté par `VerifiedPlayController`, mais ses mécanismes internes sont désormais séparés :

- `replay/verified-run-recorder.js` capture les taps et produit la soumission canonique ;
- `session/verified-run-queue.js` possède la file locale et sa réparation ;
- `session/verified-run-submit.js` applique la politique FIFO / retry / discard autour de `VerifiedRunClient.submit()` ;
- `ui/game-transition.js` possède le fade noir du démarrage ;
- `ui/unranked-warning.js` possède le dialogue de fallback non classé.

Cette séparation ne change aucun champ envoyé à `run-start` / `run-submit` et ne modifie pas `flappy13-physics-v1`.
