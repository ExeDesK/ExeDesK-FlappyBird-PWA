# Verified Runs Retention — verified history + ticket hygiene

## Objectif

`public.verified_runs` contient à la fois les runs autoritairement vérifiés, les tickets `issued` encore non résolus et les rejets conservés pour diagnostic. Deux politiques indépendantes bornent désormais la table :

1. `006_verified_run_retention.sql` borne l'historique détaillé `verified` ;
2. `009_verified_run_ticket_hygiene.sql` borne le cycle de vie `issued` / `rejected` et protège `run-start` contre la création non maîtrisée de tickets.

Aucune des deux politiques n'utilise une valeur fournie par le navigateur.

## Runs `verified`

Après chaque nouvelle run autoritairement vérifiée :

```text
KEEP =
  50 runs verified les plus récemment commencées
  UNION
  meilleur run verified historique
```

Le joueur possède donc 50 lignes détaillées si son record est déjà dans les 50 dernières, ou 51 maximum si son record est plus ancien. La fenêtre récente est triée par `issued_at DESC, run_id DESC`; le record suit `verified_score DESC, resolved_at ASC, run_id ASC`.

La purge est déclenchée après la transition vers `verified`, avec un advisory lock par joueur. Les triggers `player_stats_*` sont exécutés avant les triggers `zz_verified_run_retention_*`, de sorte que les agrégats lifetime sont persistés avant suppression des anciennes lignes détaillées.

## Tickets `issued`

Un ticket `issued` peut correspondre à une partie commencée en ligne puis terminée hors ligne. Il ne faut donc pas confondre la borne de simulation (`MAX_VERIFIED_RUN_TICK = 216000`, une heure de ticks) avec un TTL réseau.

La politique `dev6.3.6` est :

```text
issued_at < now() - 7 jours  => suppression
```

La purge globale est horaire. En complément, `issue_verified_run()` supprime opportunistiquement les vieux `issued` du joueur avant de compter ses tickets ouverts.

## Runs `rejected`

Les rejets restent disponibles suffisamment longtemps pour l'audit et le diagnostic, mais ne sont plus conservés indéfiniment :

```text
resolved_at < now() - 30 jours  => suppression
```

Les lignes `verified` ne sont jamais supprimées par cette fonction d'hygiène.

## Protection de `run-start`

`run-start` n'effectue plus un `INSERT` direct. Après authentification, l'Edge Function génère la seed int32 avec `crypto.getRandomValues()` puis appelle la RPC server-only `issue_verified_run()`.

Sous un advisory lock dérivé du `player_id`, la RPC applique atomiquement :

```text
maximum 10 tickets status=issued non résolus
maximum 30 créations sur une fenêtre glissante d'une minute
```

Le premier plafond bloque le spam de tickets jamais soumis. Le second limite aussi un client qui tenterait de résoudre rapidement ses tickets en `rejected` pour libérer le plafond `issued`.

Un dépassement retourne `429` :

- `too_many_pending_runs` pour le plafond de tickets ouverts ;
- `rate_limited` pour la fenêtre glissante, avec `Retry-After`.

## Nettoyage planifié

`009_verified_run_ticket_hygiene.sql` active `pg_cron` et programme :

```text
job      : flappy13-verified-run-ticket-hygiene
schedule : 17 * * * *
action   : select public.cleanup_stale_verified_run_tickets();
```

Le décalage à H:17 évite de concentrer la maintenance exactement en début d'heure. La migration exécute aussi une purge unique immédiatement afin de traiter les lignes préexistantes.

Deux index partiels accompagnent la maintenance :

- `verified_runs_issued_cleanup_idx (issued_at) WHERE status = 'issued'` ;
- `verified_runs_rejected_cleanup_idx (resolved_at) WHERE status = 'rejected'`.

## Sécurité

`prune_verified_runs_for_player()`, `cleanup_stale_verified_run_tickets()` et `issue_verified_run()` sont des fonctions `security definer` dont l'exécution directe est révoquée à `public`, `anon` et `authenticated`. Les appels applicatifs passent par les Edge Functions avec `service_role`.

Le navigateur ne peut ni choisir quelles lignes supprimer, ni créer directement un ticket, ni fournir sa seed ou son `player_id` à la fonction d'émission.

## Ordre des migrations

Appliquer dans l'ordre :

```text
supabase/006_verified_run_retention.sql
...
supabase/008_player_performance_stats.sql
supabase/009_verified_run_ticket_hygiene.sql
```

Après `009`, redéployer l'Edge Function `run-start`, car elle dépend désormais de `issue_verified_run()`. `run-submit` n'est pas modifiée.
