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
```

Le script :

- crée/complète `public.profiles` ;
- active RLS ;
- autorise la lecture publique des profils ;
- limite l'insertion et la modification au propriétaire du profil ;
- crée automatiquement un profil lors d'un nouvel utilisateur Auth ;
- accorde explicitement les droits Data API nécessaires aux rôles `anon` et `authenticated`.

La seconde migration ajoute `profiles.best_score` et la fonction RPC `sync_best_score()`. Le RPC effectue un `max(local, cloud)` atomique : un appareil avec un record inférieur récupère le record cloud, tandis qu'un appareil avec un record supérieur fait monter la valeur cloud. La valeur cloud ne peut jamais être diminuée par ce flux.

## Flux navigateur

La PWA utilise directement l'API HTTP Supabase Auth afin de ne pas ajouter de dépendance distante au démarrage :

1. `/auth/v1/authorize?provider=discord` ;
2. retour vers la PWA avec la session dans le fragment URL ;
3. session persistée localement ;
4. validation via `/auth/v1/user` ;
5. chargement du profil via `/rest/v1/profiles` ;
6. renouvellement via `/auth/v1/token?grant_type=refresh_token`.

Aucun token utilisateur n'est ajouté aux diagnostics du jeu.


## Synchronisation du meilleur score

À chaque connexion Discord, retour du réseau et nouveau record local :

1. la PWA envoie son record local à `sync_best_score()` ;
2. PostgreSQL calcule atomiquement le maximum entre le record local et `profiles.best_score` ;
3. la valeur maximale est renvoyée au navigateur ;
4. la PWA met aussi à jour son stockage local avec cette valeur.

Ainsi, un nouvel appareil récupère automatiquement le meilleur score du compte, et un appareil possédant un meilleur record le pousse automatiquement dans le cloud.

Ce champ est un **record personnel synchronisé non vérifié**. Il ne servira pas d'autorité au futur leaderboard : les classements utiliseront exclusivement les Verified Runs validés côté serveur.


## v0.2.7.1n-hotfix1

Le statut du meilleur score est désormais indépendant des erreurs transitoires du profil : une synchronisation de record réussie affiche toujours l'état synchronisé. Les erreurs de profil sont effacées dès qu'une lecture ou création ultérieure réussit.
