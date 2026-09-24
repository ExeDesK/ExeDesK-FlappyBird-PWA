# Leaderboard - contrat v0.2.7.7b-hotfix3

## Objectif

Le classement global est consultable par tous les visiteurs, avec ou sans session authentifiée. Il ne fait jamais confiance au record local ni au champ historique `profiles.best_score`. Depuis `v0.2.7.7b-hotfix3`, son chemin de lecture utilise `public.player_stats`, agrégat serveur privé dérivé exclusivement des transitions `verified` de `public.verified_runs`.

## Source de données

La migration historique `supabase/004_leaderboard.sql` construisait le Top 100 directement depuis `verified_runs`. `supabase/015_replay_rpc_perf.sql` remplace ce chemin de lecture sans modifier le contrat RPC :

1. `player_stats` contient déjà pour chaque joueur `best_score`, `best_run_id` et `best_score_at`, mis à jour uniquement par les triggers autoritaires de runs vérifiées ;
2. un index couvrant partiel ordonne directement ces agrégats par `best_score DESC`, `best_score_at ASC`, `player_id ASC` ;
3. `get_leaderboard()` lit uniquement les `limit_count` premiers agrégats (100 maximum), puis joint les champs publics du profil (`username`, `display_name`, `avatar_url`) ;
4. le `run_id` exposé est `player_stats.best_run_id`, choisi avec le tie-break déterministe score/date/run_id lors de l'agrégation ;
5. aucun payload de replay n'est exposé dans la liste.

La table `verified_runs` reste sans privilège direct pour `anon` et `authenticated`. La fonction `security definer` n'expose que :

```text
rank
run_id
player_id
username
display_name
avatar_url
score
achieved_at
```

La liste principale ne publie toujours aucune seed, liste de taps, collision, empreinte de replay ou raison de rejet.

Depuis `v0.2.7.6b`, `get_leaderboard_replay(target_run_id)` permet ensuite de récupérer les seules entrées nécessaires au visionnage du record affiché. Le RPC refuse implicitement tout run qui n'est plus le meilleur run vérifié de son joueur et n'accorde aucun `SELECT` direct sur `verified_runs`. Voir [`REPLAYS.md`](./REPLAYS.md).

Depuis `v0.2.7.7b-hotfix3`, `get_leaderboard()` et cette autorisation s'appuient sur la même source autoritaire `player_stats`. Le replay ne réexécute plus le RPC leaderboard : il lit directement les 100 premiers `best_run_id` via le même index couvrant. Le contrat public et l'ordre du classement restent inchangés.

## Accès public

`get_leaderboard()` est exécutable par `anon` et `authenticated`. Le frontend l'appelle volontairement avec la publishable key, sans JWT utilisateur, ce qui garantit que le chemin de lecture fonctionne aussi pour un visiteur non connecté.

Un visiteur sans session voit la mention :

> Se connecter pour apparaître sur le classement.

La consultation reste disponible. Pour apparaître, un joueur doit se connecter puis produire au moins un run vérifié.

## Interface

Le bouton SCORES du menu Flappy Bird 1.3 reste le point d'entrée naturel. Depuis `v0.2.7.3b-dev2`, il ouvre une modale `CLASSEMENT` dédiée : le leaderboard n'est plus mélangé aux options, au compte ou aux réglages. La modale reprend les bordures, ombres, palette crème/brun et typographie pixel de l'interface existante.

Le Top 100 possède son propre scroll interne afin que le header, l'état de chargement, l'action `ACTUALISER`, la mention de connexion et la provenance des scores restent lisibles. La modale est responsive sur mobile et bloque les entrées/simulation de jeu tant qu'elle est ouverte.

Le joueur courant est surligné lorsqu'il apparaît dans le Top 100. Un bouton `ACTUALISER` force une nouvelle lecture; sinon un classement chargé depuis moins d'une minute est réutilisé pendant la session de page.

Chaque ligne possède également un bouton **VOIR** lorsque son `run_id` est disponible. Il ouvre une modale Replay au-dessus du leaderboard et lance automatiquement la relecture déterministe. Le bouton est désactivé hors connexion.

## Hors connexion réseau

La PWA reste jouable hors connexion, mais le classement global est une donnée communautaire distante et ne peut pas être actualisé sans réseau. Le terme "déconnecté" pour cette phase signifie donc principalement "sans session authentifiée". Un cache persistant du dernier classement pourra être ajouté ultérieurement si ce comportement est souhaité.


## Statistiques lifetime autoritaires

Depuis `v0.2.7.3b-dev3`, `supabase/005_player_stats.sql` maintient une mémoire longue par joueur dans `public.player_stats`. Depuis `v0.2.7.7b-hotfix3`, cette table sert aussi de chemin de lecture du Top 100 ; elle reste dérivée exclusivement des runs vérifiées et n'est jamais writable par le navigateur. Depuis `dev4`, le meilleur run reste explicitement conservé par la rétention, ce qui maintient le classement exact tout en bornant l'historique détaillé.

Le navigateur n'envoie aucune statistique. `run-submit` ne reçoit que les entrées du replay ; après relecture autoritaire, la transition de la ligne `verified_runs` vers `verified` déclenche PostgreSQL, qui agrège lui-même le score et la collision recalculés. `player_stats` reste inaccessible directement à `anon` et `authenticated`.


## Rétention des runs vérifiées

Depuis `v0.2.7.3b-dev4`, `supabase/006_verified_run_retention.sql` borne l'historique détaillé à **50 runs vérifiées récentes + le record historique**. Le Top 100 reste exact : le meilleur run de chaque joueur est toujours préservé, même lorsqu'il est sorti de la fenêtre récente.

La fenêtre récente est ordonnée par `issued_at`, c'est-à-dire le moment où le ticket a été créé et la partie réellement démarrée. Une soumission différée après une période hors ligne ne modifie donc pas artificiellement l'ordre des parties récentes.


## Contexte personnel — v0.2.7.3b-dev5

Un joueur connecté voit une carte `VOTRE CLASSEMENT` au-dessus du Top 100 avec :

- son rang global réel, même s'il est hors du Top 100 ;
- son meilleur score vérifié historique ;
- son nombre lifetime de runs vérifiées ;
- la date de son record.

Ces données proviennent de `public.player_stats` via `public.get_my_leaderboard_context()`. La RPC ne prend **aucun `player_id` en paramètre** : elle déduit exclusivement le joueur courant avec `auth.uid()`. Elle est exécutable par `authenticated` et `service_role`, jamais par `anon`.

Le rang utilise le même ordre global que le leaderboard : `best_score DESC`, `best_score_at ASC`, puis `player_id ASC`. Un joueur connecté sans aucune run vérifiée reçoit un contexte non classé (`verified_runs_count = 0`, rang/record/date nuls) et l'interface affiche `Pas encore classé`.

Le Top 100 reste public et indépendant de cette RPC personnelle. La table `player_stats` reste inaccessible directement au navigateur.


## Statistiques personnelles — dev6

La modale classement affiche désormais, pour le joueur connecté, un bloc `VOS STATISTIQUES` alimenté par `get_my_player_performance_stats()`. Il compare la carrière aux fenêtres 10 / 25 / 50 de runs vérifiées, sans rendre ces statistiques accessibles anonymement.


## Architecture frontend depuis v0.2.7.3b-dev6.3.4

Les RPC du classement sont appelées par `site/src/api/leaderboard-client.js` (`LeaderboardClient`). Le cache de session, le chargement et le rendu de la modale appartiennent à `site/src/ui/leaderboard-ui.js` (`LeaderboardUI`). `AuthClient` ne contient plus de méthode leaderboard ; il fournit uniquement le token quand une RPC authentifiée en a besoin.

Cette séparation ne change aucun contrat SQL/RPC.

## Identité publique personnalisable

Le leaderboard continue de lire `profiles.display_name` et `profiles.avatar_url`. En `v0.2.7.5b`, le pseudo reste indépendant des providers liés et l'avatar peut provenir de Discord, Google ou du fallback généré localement lorsqu'aucune URL n'est disponible. Après une sauvegarde de profil, la ligne du joueur déjà chargée est mise à jour immédiatement et le cache mémoire est invalidé ; la prochaine lecture distante reprend les valeurs de `profiles`. Cette personnalisation ne modifie ni le rang, ni l'UUID du joueur, ni les runs vérifiées.
