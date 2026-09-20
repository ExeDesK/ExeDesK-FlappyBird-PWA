# Authentification Discord / Supabase

La v0.2.7b ajoute une connexion Discord facultative via Supabase Auth.
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

Dans Supabase > SQL Editor, exécuter le fichier :

```text
supabase/001_profiles.sql
```

Le script :

- crée/complète `public.profiles` ;
- active RLS ;
- autorise la lecture publique des profils ;
- limite l'insertion et la modification au propriétaire du profil ;
- crée automatiquement un profil lors d'un nouvel utilisateur Auth ;
- accorde explicitement les droits Data API nécessaires aux rôles `anon` et `authenticated`.

## Flux navigateur

La PWA utilise directement l'API HTTP Supabase Auth afin de ne pas ajouter de dépendance distante au démarrage :

1. `/auth/v1/authorize?provider=discord` ;
2. retour vers la PWA avec la session dans le fragment URL ;
3. session persistée localement ;
4. validation via `/auth/v1/user` ;
5. chargement du profil via `/rest/v1/profiles` ;
6. renouvellement via `/auth/v1/token?grant_type=refresh_token`.

Aucun token utilisateur n'est ajouté aux diagnostics du jeu.
