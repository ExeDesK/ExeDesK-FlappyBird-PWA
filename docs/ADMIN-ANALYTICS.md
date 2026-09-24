# Admin Analytics — v0.2.7.9b

Le projet possède un dashboard d'administration séparé du jeu, publié sous `site/admin/` et accessible sur GitHub Pages via le chemin `/admin/` du dépôt.

L'objectif est de conserver des métriques utiles **sans exposer `verified_runs` au navigateur** et sans conserver indéfiniment tous les replays détaillés.

## Sécurité

Le dashboard réutilise l'authentification OAuth Supabase existante (Discord ou Google), mais une session authentifiée ne suffit pas.

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

Les tables Analytics sont privées : `anon` et `authenticated` n'ont aucun droit de lecture direct sur `analytics_admins`, `analytics_meta`, `player_activity_daily`, `run_metrics_daily`, `player_activity_hourly` ou `run_metrics_hourly`.

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

Le compte peut ensuite se connecter via Discord ou Google sur `/admin/`. L’autorisation reste fondée uniquement sur le même `auth.users.id` présent dans `analytics_admins`.

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
- événements de rotation lorsque le compte atteint le seuil de tickets `issued` ;
- ticks de gameplay vérifié ;
- score cumulé et meilleur score du jour.

Ces compteurs survivent à la purge des tickets détaillés.

### `player_stats.tracked_play_ticks`

`player_stats` conserve les compteurs lifetime autoritaires (runs, score cumulé, record, causes de mort). `010` ajoute `tracked_play_ticks`, alimenté à chaque nouvelle run vérifiée.

Le temps de jeu est calculé à partir du `terminal_tick` autoritaire :

```text
temps vérifié = tracked_play_ticks / 60
```


### Suivi horaire — `018_admin_player_daily_insights.sql`

`018` ajoute deux agrégats privés destinés à la vue **Journée** :

- `player_activity_hourly` : joueurs actifs, runs vérifiées, ticks joués, scores et causes de mort par joueur / heure UTC ;
- `run_metrics_hourly` : `run-start`, tickets émis, vérifications, rejets, expirations, purges et événements de protection par heure UTC.

Ces agrégats sont alimentés par les mêmes chemins autoritaires que leurs équivalents quotidiens : une run n'alimente le gameplay horaire qu'après vérification serveur, et les métriques de lifecycle sont incrémentées par les fonctions PostgreSQL serveur.

Le début du suivi horaire est mémorisé dans `analytics_meta.hourly_tracking_started_at`. **Aucun backfill horaire n'est tenté** : les anciennes runs détaillées peuvent déjà avoir été supprimées par la rétention 50 + record, donc reconstruire des pics historiques produirait des données trompeuses.

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

Le dashboard affiche explicitement la date de début du suivi Analytics. Une plage qui commence avant cette date reste sélectionnable, mais les séries quotidiennes antérieures restent vides : aucune donnée historique n'est inventée.

## Périodes — `v0.2.7.8b`

Le dashboard ne dépend plus d'un simple nombre de jours. Toute l'interface utilise une **plage UTC inclusive** :

```text
Du YYYY-MM-DD
Au YYYY-MM-DD
```

Raccourcis disponibles :

- **Aujourd'hui** ;
- **Hier** ;
- **7 jours** ;
- **30 jours** ;
- **90 jours** ;
- **1 an** ;
- **Tout** (maximum 3650 jours).

La plage sélectionnée est aussi inscrite dans l'URL via `?from=YYYY-MM-DD&to=YYYY-MM-DD`, afin qu'un rechargement conserve le contexte d'analyse.

Le même intervalle pilote :

- la vue d'ensemble ;
- les graphiques ;
- la table Joueurs ;
- les cohortes de rétention ;
- les métriques Système.

`DAU`, `WAU` et `MAU` sont calculés **à la date `Au` sélectionnée**. Exemple : avec `Hier`, le dashboard affiche l'audience telle qu'elle était hier, et non l'audience courante.

## RPC privées

Les anciennes RPC à fenêtre (`admin_analytics_overview(window_days)`, etc.) restent présentes pour compatibilité. Le dashboard `v0.2.7.9b` utilise les RPC explicites ajoutées par `017_admin_analytics_ranges.sql`.

### `admin_analytics_overview_range(date_from, date_to)`

Expose les KPI de la période :

- joueurs inscrits à la date de fin ;
- nouveaux comptes ;
- joueurs actifs ;
- nouveaux actifs / revenants ;
- DAU / WAU / MAU à la date de fin ;
- runs vérifiées ;
- temps de jeu vérifié ;
- score moyen et record de période ;
- runs moyennes / joueur actif ;
- temps moyen / joueur actif ;
- run-start, tickets émis, rejets, expirations, purges, rate-limits ;
- taux d'émission, de vérification et de rejet ;
- états courants `issued` / `rejected` ;
- contexte lifetime : runs, temps suivi, record global et causes de mort.

### `admin_analytics_daily_range(date_from, date_to)`

Série journalière UTC utilisée pour les graphiques :

- joueurs actifs ;
- nouveaux joueurs actifs ;
- joueurs revenants ;
- DAU / WAU / MAU ;
- créations de profils ;
- runs ;
- temps de jeu ;
- score moyen / record du jour ;
- métriques du backend.

### `admin_analytics_players_range(...)`

La table Joueurs devient **spécifique à la période** :

- rang global lifetime ;
- runs de la période ;
- record de la période ;
- score moyen de la période ;
- temps de jeu de la période ;
- nombre de jours actifs ;
- première / dernière run de la période ;
- record global lifetime ;
- tickets `issued` actuellement ouverts.

Recherche : pseudo, display name ou UUID.

Tri :

```text
runs
record
playtime
active_days
recent
```

### `admin_analytics_retention_range(date_from, date_to)`

La plage sélectionne les **dates de création des cohortes**. Le calcul conserve :

- D0 ;
- D1 ;
- D7 ;
- D30.

Un joueur est considéré actif un jour donné s'il possède au moins une run autoritaire `verified` dans `player_activity_daily` ce jour-là.

Les cohortes trop jeunes affichent D1/D7/D30 comme non mûrs plutôt que comme `0 %`.


### `admin_analytics_player_detail(target_player_id, date_from, date_to)`

La fiche ouverte en cliquant sur un joueur regroupe, sans exposer de secret :

- profil public et UUID canonique ;
- providers OAuth liés issus de `auth.identities` (Discord / Google, dates de liaison et dernière connexion, libellé public provider si disponible) ;
- statistiques lifetime : rang global, runs, score moyen, record, temps vérifié suivi, jours actifs et causes de mort ;
- statistiques strictement limitées à la plage `Du → Au` : runs, score moyen / record, temps de jeu, durée moyenne d'une run, jours actifs, première / dernière run ;
- rétention D0 / D1 / D7 / D30 du joueur ;
- activité quotidienne de la plage ;
- états `issued` / `rejected` encore présents ;
- jusqu'à 20 runs récentes encore conservées par la politique de rétention.

La RPC **ne renvoie jamais** de token OAuth, email provider, seed, taps ou payload permettant de rejouer arbitrairement les runs. La liste des runs est explicitement une fenêtre d'inspection des lignes encore retenues, pas un historique lifetime exhaustif.

### Vue Journée — RPC `018`

Trois RPC admin-only alimentent l'onglet **Journée** :

- `admin_analytics_day_overview(target_date)` : totaux journaliers autoritaires et dates de début de suivi ;
- `admin_analytics_day_hourly(target_date)` : exactement 24 buckets UTC combinant gameplay, lifecycle serveur et créations de profils ;
- `admin_analytics_day_recent_runs(target_date, limit_count)` : échantillon des runs du jour encore conservées pour inspection.

La vue Journée peut donc afficher pour une date précise : joueurs actifs / nouveaux comptes, runs, temps de jeu, score, émission / vérification / rejet, événements de protection, pics horaires, causes de mort horaires, Top joueurs et runs récentes retenues.

Pour une journée antérieure au début du suivi horaire, le dashboard conserve les **totaux quotidiens historiques** disponibles mais n'invente aucun pic par heure. Le premier jour de `018` peut naturellement n'avoir qu'une journée horaire partielle.

## Interface

Le dashboard est volontairement distinct du pixel-art du jeu : interface sombre d'administration, responsive, sans framework et sans CDN.

### Vue d'ensemble

```text
KPI
├─ joueurs inscrits / nouveaux comptes
├─ actifs / nouveaux actifs / revenants
├─ DAU / WAU / MAU à la fin de période
├─ runs / joueur actif
├─ temps de jeu / joueur actif
├─ score moyen / records période + global
├─ vérification
└─ acquisition

Graphiques
├─ runs vérifiées / tickets émis
├─ joueurs actifs / nouveaux comptes
├─ temps de jeu vérifié
└─ score moyen / meilleur score

Synthèse période
├─ jours avec activité
├─ pic de joueurs actifs
├─ pic de runs
├─ taux d'émission
└─ taux de rejet

Gameplay
└─ causes de mort lifetime
```

### Joueurs

Table filtrée par période avec recherche, tri, activité, score, temps de jeu et contexte lifetime. Chaque ligne est cliquable et ouvre une fiche joueur détaillée avec comptes liés, statistiques lifetime / période, temps de jeu suivi, activité, rétention, causes de mort et runs récentes encore conservées.

### Journée

Vue opérationnelle indépendante de la plage globale : **Aujourd'hui**, **Hier**, date précise et navigation jour précédent / suivant. Elle expose les KPI du jour, quatre courbes horaires, les pics d'utilisation, la distribution horaire des collisions, le Top joueurs du jour et les runs retenues disponibles pour inspection.

### Rétention

Cohortes D0 / D1 / D7 / D30 dont la date de création tombe dans la plage sélectionnée.

### Système

```text
run-start
├─ tickets émis
├─ runs vérifiées
├─ runs rejetées
├─ issued expirés / abandonnés
├─ rejected purgés
├─ rate-limit
└─ rotation pending
```

Les graphiques sont rendus en SVG natif par `site/src/admin/charts.js`, sans Chart.js ni dépendance externe.

## Online-only

Le dashboard nécessite Supabase et reste volontairement **hors du précache PWA du jeu**. Les **57 ressources runtime du jeu** continuent d'être précachées séparément ; une panne du dashboard ne peut donc pas compromettre l'installation ou le mode hors ligne du gameplay.

## Déploiement

Pour une installation neuve :

1. exécuter `supabase/010_admin_analytics.sql` ;
2. appliquer les migrations suivantes dans l'ordre jusqu'à `017_admin_analytics_ranges.sql` ;
3. appliquer `supabase/018_admin_player_daily_insights.sql` ;
4. ajouter au moins un UUID dans `public.analytics_admins` ;
5. pousser `site/` sur GitHub Pages ;
6. ouvrir `/admin/` et se connecter avec le compte autorisé.

Pour une base déjà à jour en `v0.2.7.8b`, seule la migration suivante est nouvelle :

```text
supabase/018_admin_player_daily_insights.sql
```

Aucune Edge Function n'a besoin d'être redéployée.

## Identité affichée

Les vues joueurs utilisent `profiles.display_name` et `profiles.avatar_url` directement lors des RPC. Il n'existe aucun snapshot séparé de pseudo/avatar à synchroniser. Une modification de profil est donc visible dès le prochain rafraîchissement de l'Admin sans changer l'allow-list, qui reste basée exclusivement sur `auth.users.id`. Sans URL d'avatar, le dashboard utilise le même fallback généré déterministe que le jeu.
