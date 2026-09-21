# Player Stats — contrat v0.2.7.3b-dev5.5

## Objectif

`public.player_stats` fournit la mémoire longue des joueurs sans dépendre de la conservation indéfinie de toutes les runs détaillées. Depuis `v0.2.7.3b-dev4`, cette mémoire longue permet d'appliquer la rétention détaillée : garder les 50 dernières runs vérifiées et le meilleur run historique, tout en conservant les statistiques de carrière complètes.

## Autorité des données

Le client **n'envoie aucune statistique**.

Une soumission classée contient exclusivement :

```text
schema
run_id
physics_version
terminal_tick
taps
```

La seed et l'identité proviennent du ticket serveur. Le score et la collision sont recalculés par `run-submit`. Ce n'est qu'après la transition autoritaire de `public.verified_runs.status` vers `verified` qu'un trigger PostgreSQL met à jour `public.player_stats`.

Ainsi, aucune valeur telle que `best_score`, `total_score`, `verified_runs_count` ou cause de mort ne peut être proposée par le navigateur.

## Données lifetime

Une ligne existe par `player_id` dès qu'au moins une run vérifiée a été agrégée :

```text
verified_runs_count
  Nombre total de runs vérifiées.

total_score
  Somme de tous les verified_score de carrière.

best_score
best_run_id
best_score_at
  Record historique autoritaire et run qui le porte.

first_verified_run_at
last_verified_run_at
  Bornes temporelles de la carrière vérifiée.

deaths_pipe_top
  Collisions autoritaires upper-pipe.

deaths_pipe_bottom
  Collisions autoritaires lower-pipe.

deaths_ground
  Collisions autoritaires ground.
```

La contrainte SQL impose :

```text
deaths_pipe_top + deaths_pipe_bottom + deaths_ground
= verified_runs_count
```

Chaque run vérifiée possède exactement une collision terminale reconnue par le moteur v1.

## Record historique

Le même départage que le leaderboard est utilisé :

1. score le plus élevé ;
2. si égalité, `resolved_at` le plus ancien ;
3. si nécessaire, `run_id` le plus petit pour rendre le choix déterministe.

`best_run_id` référence `verified_runs`. La rétention `006_verified_run_retention.sql` préserve toujours ce record en plus des 50 runs les plus récemment commencées lorsqu’il est plus ancien.

## Idempotence

Le chemin normal est :

```text
issued
  ↓ run-submit + relecture serveur
verified
  ↓ trigger PostgreSQL
player_stats +1
```

Le trigger ne s'exécute pour les statistiques que lors de l'entrée dans l'état `verified`. Une nouvelle lecture ou une retry identique d'un run déjà résolu ne réincrémente donc rien.

## Backfill

`supabase/005_player_stats.sql` initialise les joueurs existants depuis l'ensemble des `verified_runs` présents au moment de la migration.

Le backfill utilise `ON CONFLICT DO NOTHING` volontairement. Une fois la rétention active, réexécuter la migration ne doit jamais recalculer une carrière à partir des seules runs détaillées restantes et écraser les compteurs lifetime.

## Accès

`public.player_stats` :

- RLS activée ;
- aucun droit direct pour `public`, `anon` ou `authenticated` ;
- aucune statistique modifiable par le navigateur ;
- les futures informations de profil/rang seront exposées via des RPC aux champs strictement limités.

## Migration

Après les migrations précédentes, exécuter :

```text
supabase/005_player_stats.sql
```

`v0.2.7.3b-dev4` ajoute ensuite `supabase/006_verified_run_retention.sql`. Aucune nouvelle Edge Function et aucun secret ne sont nécessaires pour cette phase : la rétention est entièrement déclenchée dans PostgreSQL après validation autoritaire.


## Lecture personnelle limitée — v0.2.7.3b-dev5

`supabase/007_personal_leaderboard_context.sql` ajoute `public.get_my_leaderboard_context()`. Cette RPC authentifiée expose uniquement les champs nécessaires à la carte personnelle du leaderboard :

```text
player_id
global_rank
best_score
verified_runs_count
best_score_at
```

Elle n'accepte aucun identifiant joueur fourni par le client et utilise `auth.uid()` comme seule identité. Les autres agrégats lifetime (`total_score`, causes de mort, bornes temporelles, etc.) restent privés pour les phases suivantes.

Un index partiel `player_stats_rank_idx` accélère l'ordre du classement personnel sur les joueurs effectivement classés. Aucun trigger de statistiques, aucune Edge Function et aucun secret ne changent dans cette phase.
