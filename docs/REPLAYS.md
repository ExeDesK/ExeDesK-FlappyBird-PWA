# Replays leaderboard — v0.2.7.6b

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

## Exposition publique

`get_leaderboard()` expose désormais le `run_id` correspondant au record affiché.

`get_leaderboard_replay(target_run_id)` est un RPC `security definer` public qui ne retourne le payload de replay que si le run demandé est encore présent dans le **top 100 public** renvoyé par `get_leaderboard(100)`. Le classement applique toujours la même règle de tie-break :

1. score décroissant ;
2. `resolved_at` croissant ;
3. `run_id` croissant.

Aucun `SELECT` direct sur `public.verified_runs` n'est accordé aux rôles navigateur.

## Déploiement Supabase

Ordre recommandé :

1. exécuter `supabase/014_replay_viewing.sql` ;
2. redéployer l'Edge Function `run-submit` ;
3. déployer ensuite le frontend `v0.2.7.6b`.

Cet ordre évite qu'une nouvelle `run-submit` tente d'écrire `visual_theme` / `visual_variant` avant la création des colonnes.

`run-start` ne change pas et n'a pas besoin d'être redéployé pour cette release.

## Hors ligne

Le lecteur leaderboard est online-only car son payload est lu via RPC au moment de l'ouverture. Une partie terminée hors connexion conserve néanmoins son `visual_context` dans la file locale `flappy13-verified-run-queue-v1`; il sera envoyé avec la soumission différée au retour du réseau.
