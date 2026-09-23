# Admin Analytics — v0.2.7.4b

Le projet possède un dashboard d'administration séparé du jeu, publié sous `site/admin/` et accessible sur GitHub Pages via le chemin `/admin/` du dépôt.

L'objectif est de conserver des métriques utiles **sans exposer `verified_runs` au navigateur** et sans conserver indéfiniment tous les replays détaillés.

## Sécurité

Le dashboard réutilise l'authentification Discord/Supabase existante, mais une session authentifiée ne suffit pas.

L'accès est validé côté PostgreSQL par :

```text
analytics_admins
       ↓
is_analytics_admin()
       ↓
require_analytics_admin()
       ↓
RPC admin_analytics_*
```

Les tables Analytics sont privées : `anon` et `authenticated` n'ont aucun droit de lecture direct sur `analytics_admins`, `analytics_meta`, `player_activity_daily` ou `run_metrics_daily`.

Le navigateur utilise uniquement le **publishable key** déjà utilisé par le jeu et son JWT utilisateur. Aucun `service_role` ou secret serveur n'est livré dans `site/`.

## Provisionner un administrateur

Après avoir appliqué `supabase/010_admin_analytics.sql`, récupérer l'UUID du compte Supabase Auth à autoriser :

```sql
select
  id,
  email,
  raw_user_meta_data ->> 'user_name' as discord_username,
  created_at
from auth.users
order by created_at desc;
```

Puis l'ajouter à l'allow-list depuis le SQL Editor :

```sql
insert into public.analytics_admins (user_id, note)
values ('UUID_DU_COMPTE', 'Admin principal')
on conflict (user_id) do update
set note = excluded.note;
```

Le compte doit ensuite se connecter via Discord sur `/admin/`.

## Tables de collecte

### `player_activity_daily`

Une ligne maximum par joueur et par jour UTC :

- `verified_runs` ;
- `play_ticks` ;
- `score_sum` ;
- `best_score` ;
- premier / dernier run du jour.

Cette table est alimentée uniquement lorsqu'un run devient `verified`, donc depuis le résultat de la relecture serveur autoritaire.

### `run_metrics_daily`

Une ligne par jour UTC avec les compteurs opérationnels :

- requêtes `run-start` ;
- tickets émis ;
- runs vérifiées ;
- runs rejetées ;
- tickets `issued` expirés ;
- lignes `rejected` purgées ;
- réponses rate-limit ;
- refus liés au plafond de 10 tickets ouverts ;
- ticks de gameplay vérifié ;
- score cumulé et meilleur score du jour.

Ces compteurs survivent à la purge des tickets détaillés.

### `player_stats.tracked_play_ticks`

`player_stats` conserve déjà les compteurs lifetime autoritaires (runs, score cumulé, record, causes de mort). `010` ajoute `tracked_play_ticks`, alimenté à chaque nouvelle run vérifiée.

Le temps de jeu est calculé à partir du `terminal_tick` autoritaire :

```text
temps vérifié = tracked_play_ticks / 60
```

## Limite historique volontaire

La collecte quotidienne et le temps de jeu commencent **à la première application de `010_admin_analytics.sql`**.

Les anciennes runs détaillées ont pu être supprimées par la politique 50 + record avant l'arrivée des Analytics. Il est donc impossible de reconstruire proprement l'ancien temps de jeu ou les anciennes cohortes. La migration n'invente pas de backfill à partir d'un historique incomplet.

En revanche, les compteurs déjà présents dans `player_stats` restent valides et servent toujours pour :

- nombre lifetime de runs vérifiées ;
- score cumulé ;
- record ;
- date du record ;
- causes de mort ;
- première / dernière run vérifiée.

Le dashboard affiche explicitement la date de début du suivi Analytics.

## RPC privées

### `is_analytics_admin()`

Retourne si `auth.uid()` est présent dans l'allow-list.

### `admin_analytics_overview(window_days)`

Expose les KPI agrégés :

- joueurs total / nouveaux / actifs ;
- DAU / WAU / MAU ;
- runs vérifiées période + lifetime ;
- temps de jeu vérifié suivi ;
- record global et score moyen ;
- tickets pending/rejected encore présents ;
- émissions, rejets, abandons, rate limits ;
- causes de mort lifetime.

### `admin_analytics_daily(window_days)`

Série journalière UTC utilisée pour les graphiques : joueurs actifs, nouveaux comptes, runs, temps, scores et métriques du backend.

### `admin_analytics_players(...)`

Table par joueur avec :

- rang global ;
- pseudo / display name / avatar ;
- nombre lifetime de runs ;
- record ;
- score moyen ;
- temps de jeu suivi ;
- première / dernière activité ;
- causes de mort ;
- tickets `issued` actuellement ouverts.

La table accepte recherche et tri (`runs`, `record`, `playtime`, `recent`).

### `admin_analytics_retention(cohort_days)`

Rétention par cohorte de création de profil, uniquement pour les cohortes postérieures au début du tracking Analytics :

- D0 ;
- D1 ;
- D7 ;
- D30.

Un joueur est considéré actif un jour donné s'il possède au moins une run autoritaire `verified` dans `player_activity_daily` ce jour-là.

Les cohortes trop jeunes affichent D1/D7/D30 comme non mûrs plutôt que comme `0 %`.

## Interface

Le dashboard est volontairement distinct du pixel-art du jeu : interface sombre d'administration, responsive, sans framework et sans CDN.

Sections :

```text
Vue d'ensemble
├─ KPI
├─ runs / jour
├─ joueurs actifs / jour
├─ causes de mort
└─ résumé du pipeline

Joueurs
└─ table recherchable / triable

Rétention
└─ cohortes D0 / D1 / D7 / D30

Système
├─ run-start
├─ tickets émis
├─ rejected
├─ issued expirés
├─ rate-limit
└─ plafond pending
```

Les graphiques sont rendus en SVG natif par `site/src/admin/charts.js`, sans Chart.js ni dépendance externe.

## Online-only

Le dashboard nécessite Supabase et reste volontairement **hors du précache PWA du jeu**. Le Service Worker continue de précacher uniquement les 51 ressources runtime du jeu ; une panne du dashboard ne peut donc pas compromettre l'installation ou le mode hors ligne du gameplay.

## Déploiement

1. Exécuter `supabase/010_admin_analytics.sql` dans le SQL Editor Supabase.
2. Ajouter au moins un UUID dans `public.analytics_admins`.
3. Pousser le contenu `site/` sur GitHub Pages comme d'habitude.
4. Ouvrir `https://<pages>/<repo>/admin/` et se connecter avec le compte autorisé.

Aucune Edge Function n'a besoin d'être redéployée : la migration remplace les fonctions PostgreSQL `issue_verified_run()` et `cleanup_stale_verified_run_tickets()` **sans changer leur signature**, donc le `run-start` déjà déployé en `6.3.6` reste compatible.
