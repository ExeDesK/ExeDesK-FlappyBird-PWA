# Verified Runs Retention — contrat v0.2.7.3b-dev4

## Objectif

`public.verified_runs` contient les données détaillées nécessaires à la vérification et aux futurs replays. Les conserver sans limite ferait croître la base avec le nombre total de parties jouées.

La politique de rétention borne donc l'historique détaillé tout en gardant :

- une fenêtre récente exploitable pour les statistiques court terme ;
- le record historique nécessaire au leaderboard et au futur replay du record ;
- les statistiques de carrière complètes dans `public.player_stats`.

## Règle par joueur

Après chaque nouvelle run autoritairement vérifiée :

```text
KEEP =
  50 runs verified les plus récemment commencées
  UNION
  meilleur run verified historique
```

Le joueur possède donc :

- **50 runs détaillées** si son record est déjà dans les 50 dernières ;
- **51 runs détaillées maximum** si son record est plus ancien.

Il n'existe aucune duplication : le record reste une ligne normale de `verified_runs`.

## Définition de « récente »

La fenêtre des 50 est triée par :

```text
issued_at DESC
run_id DESC
```

`issued_at` correspond au démarrage serveur du run. C'est volontairement différent de `resolved_at` : une partie commencée plus tôt, terminée hors ligne puis soumise plusieurs heures ou jours après ne doit pas être considérée comme plus récente qu'une partie réellement jouée après elle.

## Définition du record

Le record suit le contrat existant du leaderboard et de `player_stats` :

1. `verified_score` le plus élevé ;
2. en cas d'égalité, `resolved_at` le plus ancien ;
3. en cas d'égalité persistante, `run_id` le plus petit.

Cette règle rend le meilleur run stable et déterministe.

## Ordre avec les statistiques lifetime

Le flux serveur est :

```text
run-submit
   ↓
verified_runs: issued → verified
   ↓
player_stats_* trigger
   ↓
statistiques lifetime persistées
   ↓
zz_verified_run_retention_* trigger
   ↓
purge des anciennes lignes detailed
```

Les triggers de rétention utilisent volontairement le préfixe `zz_` pour être exécutés après les triggers `player_stats_*` du même événement.

La fonction de purge recalcule également le record depuis les runs vérifiées présentes. Elle ne dépend donc pas d'une valeur proposée par le client.

## Concurrence

`prune_verified_runs_for_player()` prend un verrou transactionnel dérivé du `player_id` avant de calculer la fenêtre à conserver.

Deux validations simultanées du même joueur sont ainsi sérialisées pour la partie rétention. Une fois les transactions terminées, l'historique respecte toujours la borne 50/51.

Les joueurs différents ne partagent pas ce verrou et peuvent être traités en parallèle.

## Données non concernées

Cette migration ne supprime jamais :

```text
status = issued
status = rejected
```

Les tickets `issued` peuvent représenter une partie encore en attente de soumission hors ligne. Ils ne doivent donc pas être supprimés par la politique « historique vérifié ».

Les `rejected` restent conservés pour le diagnostic dans cette phase. Leur éventuelle politique de rétention sera indépendante afin de ne pas mélanger données de jeu vérifiées et données d'audit/rejet.

## Migration des données existantes

Après création des fonctions et triggers, `006_verified_run_retention.sql` parcourt une fois les joueurs ayant déjà des runs vérifiées et applique la même politique.

`005_player_stats.sql` doit avoir été exécutée auparavant : les compteurs lifetime ont alors déjà été sauvegardés avant cette première purge.

## Sécurité

Les fonctions de maintenance sont `security definer`, mais :

- `anon` n'a aucun droit d'exécution ;
- `authenticated` n'a aucun droit d'exécution ;
- seul `service_role` peut appeler directement la fonction de purge ;
- le chemin normal reste le trigger PostgreSQL après un verdict serveur.

Le navigateur ne choisit jamais quelles runs conserver ou supprimer.

## Migration

Exécuter après `005_player_stats.sql` :

```text
supabase/006_verified_run_retention.sql
```

Aucune Edge Function ne doit être redéployée pour cette migration et aucun nouveau secret n'est nécessaire.
