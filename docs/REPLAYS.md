# Replays leaderboard — v0.2.7.7b

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

## Contrôles du lecteur (v0.2.7.7b)

Le lecteur est contrôlable sans modifier le payload autoritaire :

- lecture / pause avec les sprites originaux `button_resume` / `button_pause` ;
- restart avec `button_restart` ;
- vitesses `×1`, `×1,5`, `×2`, `×5` ;
- toggle hitbox via `button_hitbox_off` / `button_hitbox_on` ;
- timeline fixe `240 × 14` utilisant `replay_progress_track` et `replay_progress_filled` ;
- handle = oiseau rouge original `bird2_0`, `bird2_1`, `bird2_2` rendu à 50 %, avec frame déterminée par le tick courant.

Le seek convertit la position de la timeline en nombre de ticks simulés. La reconstruction reste déterministe : un seek arrière recrée le moteur depuis la seed, puis rejoue les taps jusqu'au tick demandé ; un seek avant continue depuis l'état courant. Les événements audio traversés pendant le seek sont volontairement silencieux.

Les hitbox sont un overlay de rendu seulement : 20×20 pour l'oiseau, 52×320 pour chaque demi-tuyau et ligne de sol à `y=400`. Elles ne participent pas à la simulation et ne modifient jamais le résultat vérifié.

## Exposition publique

`get_leaderboard()` expose désormais le `run_id` correspondant au record affiché.

`get_leaderboard_replay(target_run_id)` est un RPC `security definer` public qui ne retourne le payload de replay que si le run demandé est encore présent dans le **top 100 public** renvoyé par `get_leaderboard(100)`. Le classement applique toujours la même règle de tie-break :

1. score décroissant ;
2. `resolved_at` croissant ;
3. `run_id` croissant.

Aucun `SELECT` direct sur `public.verified_runs` n'est accordé aux rôles navigateur.

## Déploiement Supabase

**`v0.2.7.7b` n'ajoute aucune migration ni modification d'Edge Function.** Si `v0.2.7.6b` est déjà déployée, aucune action Supabase n'est nécessaire pour les contrôles de replay.

Pour une installation qui n'aurait pas encore appliqué le backend du visionnage introduit en `v0.2.7.6b`, l'ordre reste :

1. exécuter `supabase/014_replay_viewing.sql` ;
2. redéployer l'Edge Function `run-submit` ;
3. déployer ensuite le frontend.

Cet ordre évite qu'une nouvelle `run-submit` tente d'écrire `visual_theme` / `visual_variant` avant la création des colonnes. `run-start` reste inchangé.

## Hors ligne

Le lecteur leaderboard est online-only car son payload est lu via RPC au moment de l'ouverture. Une partie terminée hors connexion conserve néanmoins son `visual_context` dans la file locale `flappy13-verified-run-queue-v1`; il sera envoyé avec la soumission différée au retour du réseau.
