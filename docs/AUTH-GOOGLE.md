# Authentification Google / Supabase

## Principe

La PWA ne contient **aucun secret Google**. Le navigateur démarre l'OAuth via Supabase Auth avec `provider=google`; Supabase échange ensuite avec Google et retourne une session Supabase à la PWA.

Le même provider sert à :

- créer/se connecter à un profil Google ;
- lier Google à un profil Discord existant via l'endpoint Auth d'identity linking.

## 1. Google Auth Platform

Créer/configurer un projet Google Cloud puis un client OAuth de type **Web application**.

### Authorized JavaScript origins

Production :

```text
https://exedesk.github.io
```

Google attend ici uniquement l'origine, sans `/FlappyBird-PWA/`.

### Authorized redirect URIs

Ajouter le callback Supabase du projet :

```text
https://<PROJECT_REF>.supabase.co/auth/v1/callback
```

Le Client Secret reste exclusivement dans Google Cloud / Supabase. Il ne doit jamais entrer dans le dépôt GitHub, `config.js`, un secret PWA ou une variable publique.

Si l'application Google est encore en mode Testing, ajouter les comptes Google utilisés pour les essais à la liste des test users.

## 2. Supabase Auth > Providers > Google

Activer Google puis renseigner :

```text
Client ID     = client OAuth Web Google
Client Secret = secret OAuth Google
```

Aucune de ces valeurs n'est nécessaire dans le JavaScript de la PWA.

## 3. Supabase Auth > URL Configuration

Conserver/ajouter :

```text
Site URL
https://exedesk.github.io/FlappyBird-PWA/

Redirect URLs
https://exedesk.github.io/FlappyBird-PWA/
https://exedesk.github.io/FlappyBird-PWA/admin/
```

La PWA utilise l’URL courante comme retour OAuth : la racine pour le jeu et `/admin/` pour le dashboard Analytics.

## 4. Activer Manual Linking

Dans la configuration Auth du projet, activer **Allow manual linking**.

C'est nécessaire pour le parcours :

```text
profil Discord existant
        ↓
LIER GOOGLE
        ↓
OAuth Google
        ↓
même auth.users.id
```

Cette option n'effectue aucune migration de comptes existants.

## 5. Comportement côté PWA

### Connexion directe

```text
/auth/v1/authorize
  provider=google
  redirect_to=https://exedesk.github.io/FlappyBird-PWA/
```

### Linking depuis un profil connecté

```text
/auth/v1/user/identities/authorize
  provider=google
  redirect_to=https://exedesk.github.io/FlappyBird-PWA/
  skip_http_redirect=true
```

La requête de linking contient le JWT Supabase du joueur courant, ce qui permet à Supabase d'attacher l'identité Google au même utilisateur.

## 6. Comptes Discord existants

Aucune migration SQL n'est requise.

Pour un joueur déjà présent, le parcours recommandé est :

```text
Connexion Discord
→ Profil
→ CONNEXIONS
→ Google : LIER
```

Le `profiles.id`, les records, les runs et les Analytics restent rattachés au même UUID.

## 7. Automatic linking Supabase

Supabase peut automatiquement rattacher une nouvelle identité OAuth à un utilisateur existant lorsque les deux providers utilisent la même adresse e-mail vérifiée.

Ce mécanisme est utile mais **ne remplace pas** le linking manuel : si Discord et Google utilisent des e-mails différents, il faut impérativement démarrer depuis le profil existant et utiliser **LIER** pour conserver le même UUID.

## 8. Pseudo et photo de profil

Une identité Google liée expose ses métadonnées publiques à Supabase Auth dans `user.identities[].identity_data`. Lorsque Google fournit `picture`, la PWA peut proposer cette image comme photo de profil, au même titre que l'avatar Discord.

Le joueur choisit la source dans **Profil > Personnalisation**. Le choix est enregistré dans `profiles.avatar_provider` et l'URL correspondante dans `profiles.avatar_url`, afin que le leaderboard et Admin Analytics utilisent la même photo. Le pseudo public (`profiles.display_name`) reste indépendant du provider et peut être modifié sans changer d'identité Auth.
