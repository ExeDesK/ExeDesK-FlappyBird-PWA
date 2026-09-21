# Leaderboard - contrat v0.2.7.3b-dev5.5

## Objectif

Le classement global est consultable par tous les visiteurs, avec ou sans session Discord. Il ne fait jamais confiance au record local ou au champ historique `profiles.best_score` : sa seule source d'autorité est `public.verified_runs`.

## Source de données

La migration `supabase/004_leaderboard.sql` crée `public.get_leaderboard(limit_count integer)`. La fonction :

1. sélectionne uniquement les lignes `status = 'verified'`;
2. conserve pour chaque `player_id` le plus grand `verified_score`;
3. en cas de plusieurs runs au même meilleur score, conserve le plus ancien `resolved_at`;
4. joint uniquement les champs publics du profil (`username`, `display_name`, `avatar_url`);
5. classe les joueurs par score décroissant puis date d'accomplissement croissante;
6. limite la réponse à 100 joueurs.

La table `verified_runs` reste sans privilège direct pour `anon` et `authenticated`. La fonction `security definer` n'expose que :

```text
rank
player_id
username
display_name
avatar_url
score
achieved_at
```

Aucune seed, liste de taps, collision, empreinte de replay ou raison de rejet n'est publiée.

## Accès public

`get_leaderboard()` est exécutable par `anon` et `authenticated`. Le frontend l'appelle volontairement avec la publishable key, sans JWT utilisateur, ce qui garantit que le chemin de lecture fonctionne aussi pour un visiteur non connecté.

Un visiteur sans session voit la mention :

> Se connecter pour apparaître sur le classement.

La consultation reste disponible. Pour apparaître, un joueur doit se connecter puis produire au moins un run vérifié.

## Interface

Le bouton SCORES du menu Flappy Bird 1.3 reste le point d'entrée naturel. Depuis `v0.2.7.3b-dev2`, il ouvre une modale `CLASSEMENT` dédiée : le leaderboard n'est plus mélangé aux options, au compte ou aux réglages. La modale reprend les bordures, ombres, palette crème/brun et typographie pixel de l'interface existante.

Le Top 100 possède son propre scroll interne afin que le header, l'état de chargement, l'action `ACTUALISER`, la mention de connexion et la provenance des scores restent lisibles. La modale est responsive sur mobile et bloque les entrées/simulation de jeu tant qu'elle est ouverte.

Le joueur courant est surligné lorsqu'il apparaît dans le Top 100. Un bouton `ACTUALISER` force une nouvelle lecture; sinon un classement chargé depuis moins d'une minute est réutilisé pendant la session de page.

## Hors connexion réseau

La PWA reste jouable hors connexion, mais le classement global est une donnée communautaire distante et ne peut pas être actualisé sans réseau. Le terme "déconnecté" pour cette phase signifie donc principalement "sans session Discord". Un cache persistant du dernier classement pourra être ajouté ultérieurement si ce comportement est souhaité.


## Statistiques lifetime autoritaires

Depuis `v0.2.7.3b-dev3`, `supabase/005_player_stats.sql` maintient une mémoire longue par joueur dans `public.player_stats`. Cette table ne remplace pas la source du Top 100 : `get_leaderboard()` continue de lire les meilleurs `verified_runs`. Depuis `dev4`, le meilleur run reste explicitement conservé par la rétention, ce qui maintient le classement exact tout en bornant l'historique détaillé.

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
