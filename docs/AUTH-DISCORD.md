# Authentification Discord / Supabase

La v0.2.7b ajoute une connexion Discord facultative via Supabase Auth. La v0.2.7.1b ajoute la synchronisation cross-device du meilleur score.
Le jeu reste entièrement jouable sans compte et hors connexion.

## Configuration runtime

Les identifiants publics Supabase ne sont pas stockés dans le code source. Le workflow GitHub Pages génère `site/config.js` au moment du déploiement à partir de deux Repository secrets :

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

Le fichier généré expose volontairement ces deux valeurs au navigateur : une publishable key Supabase n'est pas une clé serveur secrète. La sécurité repose sur RLS et les policies de la base. Ne jamais utiliser de `sb_secret_*`, `service_role`, mot de passe PostgreSQL ou secret OAuth Discord dans la PWA.

Le modèle versionné est `site/config.example.js`. Pour un test local :

```powershell
Copy-Item .\site\config.example.js .\site\config.js
```

`site/config.js` est ignoré par Git.

## OAuth

- Provider : Discord
- Redirect de production : `https://exedesk.github.io/FlappyBird-PWA/`
- Callback Discord : l'URL `/auth/v1/callback` fournie par le projet Supabase

## Initialiser la table `profiles`

Dans Supabase > SQL Editor, exécuter les migrations dans l'ordre :

```text
supabase/001_profiles.sql
supabase/002_best_score_sync.sql
supabase/003_verified_runs.sql
```

Le script :

- crée/complète `public.profiles` ;
- active RLS ;
- autorise la lecture publique des profils ;
- limite l'insertion et la modification au propriétaire du profil ;
- crée automatiquement un profil lors d'un nouvel utilisateur Auth ;
- accorde explicitement les droits Data API nécessaires aux rôles `anon` et `authenticated`.

La seconde migration ajoute `profiles.best_score` et la fonction RPC `sync_best_score()`. Le RPC effectue un `max(local, cloud)` atomique : un appareil avec un record inférieur récupère le record cloud, tandis qu'un appareil avec un record supérieur fait monter la valeur cloud. La valeur cloud ne peut jamais être diminuée par ce flux.

La troisième migration crée la table serveur privée des Verified Runs. Elle ne donne aucun droit direct aux rôles navigateur `anon` et `authenticated` : les tickets passent exclusivement par les Edge Functions. Voir [`VERIFIED-RUNS.md`](./VERIFIED-RUNS.md).

## Flux navigateur

La PWA utilise directement l'API HTTP Supabase Auth afin de ne pas ajouter de dépendance distante au démarrage :

1. `/auth/v1/authorize?provider=discord` ;
2. retour vers la PWA avec la session dans le fragment URL ;
3. session persistée localement ;
4. validation via `/auth/v1/user` ;
5. chargement du profil via `/rest/v1/profiles` ;
6. renouvellement via `/auth/v1/token?grant_type=refresh_token`.

Aucun token utilisateur n'est ajouté aux diagnostics du jeu.


## Présentation du profil — v0.2.7.4b-dev1

Les données de profil (avatar, nom, username, état de synchronisation et meilleur score) sont désormais affichées dans une modale **Profil** dédiée, accessible depuis HOME par le bouton `button_profile`. La modale est volontairement informative dans cette étape : elle ne contient ni bouton Discord, ni second provider, ni account linking.

Pour ne pas supprimer le flux OAuth existant avant l'arrivée de l'interface multi-provider, les actions de connexion/déconnexion Discord restent temporairement dans **Options > Connexion**. Le retour OAuth réussi ouvre la modale Profil afin de montrer immédiatement l'identité chargée.

## Synchronisation du meilleur score

À chaque connexion Discord, retour du réseau et nouveau record local :

1. la PWA envoie son record local à `sync_best_score()` ;
2. PostgreSQL calcule atomiquement le maximum entre le record local et `profiles.best_score` ;
3. la valeur maximale est renvoyée au navigateur ;
4. la PWA met aussi à jour son stockage local avec cette valeur.

Ainsi, un nouvel appareil récupère automatiquement le meilleur score du compte, et un appareil possédant un meilleur record le pousse automatiquement dans le cloud.

Ce champ est un **record personnel synchronisé non vérifié**. Il ne servira pas d'autorité au futur leaderboard : les classements utiliseront exclusivement les Verified Runs validés côté serveur.

## PLAY et Verified Runs (v0.2.7.2b-dev2)

- sans session Discord, PLAY lance immédiatement le jeu local historique ;
- avec une session Discord et du réseau, PLAY appelle `run-start`, puis ouvre un READY canonique construit depuis la seed serveur ;
- avec une session Discord hors ligne, un avertissement impose de confirmer une partie locale non classée ;
- si `run-start` échoue, le fallback local exige la même confirmation et n’est jamais silencieux ;
- une fois le ticket obtenu, la capture du run continue même si la connexion disparaît.

Depuis `v0.2.7.2b-dev3`, la file est envoyée automatiquement à `run-submit` après la collision, au démarrage connecté et au retour du réseau. Seules les entrées appartenant au compte Discord actif sont traitées. Une erreur réseau ou serveur conserve le run pour une nouvelle tentative ; un résultat `verified` ou `rejected` retire définitivement l’entrée locale.

Depuis `v0.2.7.2b-dev4`, la file est auto-réparante : les anciennes entrées sans `player_id`, les entrées malformées et les doublons sont nettoyés. Un `404 run_not_found` est considéré comme terminal et retiré afin de ne jamais bloquer les runs suivants ; les erreurs réseau, `429` et `5xx` restent conservées pour retry.


## v0.2.7.1n-hotfix1

Le statut du meilleur score est désormais indépendant des erreurs transitoires du profil : une synchronisation de record réussie affiche toujours l'état synchronisé. Les erreurs de profil sont effacées dès qu'une lecture ou création ultérieure réussit.


## Architecture client depuis v0.2.7.3b-dev6.3.4

`AuthClient` est désormais limité à OAuth Discord, session Supabase et profil. La synchronisation du meilleur score utilise `api/BestScoreClient` + `session/ScoreSyncController`; le leaderboard utilise `api/LeaderboardClient`; les Verified Runs utilisent `api/VerifiedRunClient` et `session/VerifiedPlayController`. Le token utilisateur est fourni à ces clients via `AuthClient.accessToken()` au lieu de faire transiter toutes les fonctionnalités communautaires par la classe d'authentification.

Voir [`ARCHITECTURE.md`](./ARCHITECTURE.md) pour la séparation complète des responsabilités.


## Réutilisation pour Admin Analytics — v0.2.7.4b

Le dashboard `/admin/` réutilise exactement la même session Discord/Supabase et le même `AuthClient`. Une session authentifiée **ne donne pas** automatiquement accès aux statistiques : après connexion, le frontend appelle `is_analytics_admin()`, puis les RPC `admin_analytics_*` vérifient à nouveau l'allow-list privée `analytics_admins` côté PostgreSQL.

Le navigateur continue d'utiliser uniquement la publishable key et le JWT utilisateur. Aucune clé `service_role` ni secret d'administration n'est exposé dans GitHub Pages.
