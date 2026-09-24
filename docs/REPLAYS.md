# Replays leaderboard — v0.2.7.7b-hotfix4

## Objectif

Le bouton **VOIR** de chaque ligne du leaderboard rejoue le meilleur run vérifié public du joueur sans enregistrer de vidéo. Le lecteur reconstruit la partie à partir des données autoritaires déjà conservées par Verified Runs :

- `seed` serveur ;
- `terminal_tick` ;
- `tap_ticks` ;
- `physics_version` ;
- score/collision vérifiés.

Le lecteur utilise `createCanonicalRunGame()` et applique les taps exactement aux mêmes ticks que le vérificateur Edge. Les événements sonores (`wing`, `point`, `hit`, `die`) repassent par le moteur audio normal et respectent donc le réglage muet du joueur. À la fin de la lecture, le score recalculé localement doit correspondre au score serveur ; sinon le lecteur affiche une incompatibilité de build.

## Contexte visuel

Depuis `v0.2.7.6b`, les nouvelles soumissions Verified Runs peuvent contenir :

```json
{
  "visual_context": {
    "theme": "vietnam",
    "variant": "night"
  }
}
```

Ce contexte est **cosmétique uniquement**. Il ne modifie jamais `flappy13-physics-v1`, la simulation autoritaire, le score ou la décision de validation du serveur.

`run-submit` stocke le contexte uniquement lorsqu'une run est vérifiée :

- `verified_runs.visual_theme` ;
- `verified_runs.visual_variant` (`day` / `night`).

Pour les runs historiques qui ne possèdent pas ces colonnes, le lecteur choisit volontairement un thème et une variante jour/nuit aléatoires à chaque ouverture/relecture.

## Contrôles du lecteur (v0.2.7.7b-hotfix2)

Le lecteur est contrôlable sans modifier le payload autoritaire :

- lecture / pause avec les sprites originaux `button_resume` / `button_pause` ;
- restart avec `button_restart` ;
- vitesses `×1`, `×1,5`, `×2`, `×5` ;
- toggle hitbox via `button_hitbox_off` / `button_hitbox_on` ;
- timeline fixe `240 × 14` utilisant `replay_progress_track` et `replay_progress_filled` ;
- handle = oiseau rouge original `bird2_0`, `bird2_1`, `bird2_2` rendu à 75 %, avec frame déterminée par le tick courant.

Le seek convertit la position de la timeline en nombre de ticks simulés. La reconstruction reste déterministe : un seek arrière recrée le moteur depuis la seed, puis rejoue les taps jusqu'au tick demandé ; un seek avant continue depuis l'état courant. Les événements audio traversés pendant le seek sont volontairement silencieux.

Les hitbox sont un overlay de rendu seulement : 20×20 pour l'oiseau, 52×320 pour chaque demi-tuyau et ligne de sol à `y=400`. Elles ne participent pas à la simulation et ne modifient jamais le résultat vérifié.

## Accès authentifié du payload

`get_leaderboard()` expose le `run_id` correspondant au record affiché.

`get_leaderboard_replay(target_run_id)` est un RPC `security definer` qui ne retourne le payload de replay que si le run demandé est encore le **record autoritaire d'un joueur présent dans le Top 100 public**. Depuis `v0.2.7.7b-hotfix3`, cette vérification ne rappelle plus `get_leaderboard(100)` : elle lit directement les agrégats autoritaires de `public.player_stats`, maintenus à chaque run vérifiée.

Depuis `v0.2.7.7b-hotfix4`, le rôle `anon` n'a plus `EXECUTE` sur ce RPC. Le navigateur doit fournir le JWT Supabase du joueur connecté avant que le backend n'expose `seed`, `terminal_tick` et `tap_ticks`. Le bouton **VOIR** est désactivé pour les visiteurs sans session.

La règle reste strictement la même :

- record par joueur : `best_score DESC`, puis `best_score_at ASC`, puis `best_run_id ASC` ;
- classement global : `best_score DESC`, puis `best_score_at ASC`, puis `player_id ASC`.

La migration `015_replay_rpc_perf.sql` ajoute un index couvrant partiel sur cette clé de classement. `get_leaderboard()` l'utilise lui-même pour ne lire que le Top demandé, et le RPC replay ne parcourt que les **100 premiers agrégats** avant de joindre le `run_id` demandé à `verified_runs`. Il n'y a donc plus de `DISTINCT ON` des runs au rafraîchissement du classement, ni de deuxième calcul du leaderboard à chaque clic sur **VOIR**.

Aucun `SELECT` direct sur `public.verified_runs`, `public.player_stats` ou `public.read_rpc_rate_limits` n'est accordé aux rôles navigateur. La migration `016_authenticated_replay_rate_limits.sql` limite en outre les payloads replay à **10 requêtes / 60 s / joueur**. Les compteurs sont mis à jour atomiquement et une limite atteinte renvoie `429` avec `Retry-After`.

## Déploiement Supabase

Pour une base déjà à jour jusqu'à `015_replay_rpc_perf.sql`, `v0.2.7.7b-hotfix4` demande uniquement :

1. exécuter `supabase/016_authenticated_replay_rate_limits.sql` ;
2. déployer le frontend.

Aucune Edge Function n'est à redéployer pour ce hotfix.

Pour une installation neuve qui n'aurait pas encore appliqué le backend du visionnage introduit en `v0.2.7.6b`, l'ordre complet reste :

1. exécuter `supabase/014_replay_viewing.sql` ;
2. redéployer l'Edge Function `run-submit` ;
3. exécuter `supabase/015_replay_rpc_perf.sql` ;
4. exécuter `supabase/016_authenticated_replay_rate_limits.sql` ;
5. déployer ensuite le frontend.

`run-start` reste inchangé.

## Hors ligne

Le lecteur leaderboard est online-only car son payload est lu via RPC au moment de l'ouverture. Une partie terminée hors connexion conserve néanmoins son `visual_context` dans la file locale `flappy13-verified-run-queue-v1`; il sera envoyé avec la soumission différée au retour du réseau.
