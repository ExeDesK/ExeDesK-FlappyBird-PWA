# Account linking

## État actuel — v0.2.7.4b-dev11-hotfix1

Discord et Google sont maintenant tous les deux exposés dans la modale **Profil**. Le joueur peut :

- se connecter directement avec Discord ;
- se connecter directement avec Google ;
- lorsqu'il est déjà connecté, lier le provider manquant au profil courant.

Le principe fondamental reste inchangé : **le profil de jeu est attaché à `auth.users.id`, pas à Discord ni à Google**.

## Identifiant canonique du joueur

```text
auth.users.id
    ├── profiles.id
    ├── player_stats.player_id
    ├── verified_runs.player_id
    └── analytics / leaderboard / records
```

Le linking ajoute une identité OAuth à cet UUID. Il ne change pas la clé du profil et ne déplace aucune donnée de jeu.

Les comptes Discord existants conservent donc exactement leur UUID, leur record, leurs runs, leurs statistiques et leur historique. La clé locale `flappy13-auth-v1` est volontairement conservée afin de ne pas invalider les sessions déjà stockées.

## Parcours recommandé pour un joueur Discord existant

Pour garantir que Google est ajouté au profil déjà existant :

1. ouvrir **Profil** ;
2. se connecter avec **Discord** ;
3. dans **CONNEXIONS**, cliquer sur **LIER** en face de Google ;
4. terminer le consentement Google ;
5. revenir sur la PWA : Discord et Google sont alors rattachés au **même `auth.users.id`**.

Le frontend conserve une intention temporaire `flappy13-auth-link-intent-v1` pendant la redirection afin de distinguer une liaison d'une connexion normale.


## Personnalisation du profil

Le linking ne dicte plus l'identité visuelle publique du joueur. `profiles.display_name` est le **pseudo public** et reste initialisé depuis le provider d'inscription du compte (`app_metadata.provider`, donc le premier moyen de connexion). Lier Google à un profil Discord existant ne remplace donc jamais automatiquement ce pseudo.

`profiles.avatar_provider` mémorise la source de la photo de profil (`discord` ou `google`) et `profiles.avatar_url` conserve l'URL effectivement publiée au leaderboard/Admin. Les avatars disponibles sont lus depuis `user.identities[].identity_data`; si une identité ne fournit pas d'image, elle n'est pas proposée comme source.

La migration `012_profile_customization.sql` ajoute uniquement `avatar_provider` et ne réécrit aucun profil existant. Les anciens comptes conservent ainsi leur pseudo et leur avatar actuels jusqu'à ce que le joueur enregistre explicitement ses préférences.

## Connexion Google directe

Un joueur sans profil peut utiliser **SE CONNECTER AVEC GOOGLE** et obtenir un profil normal.

Supabase Auth peut également effectuer un **automatic linking** si le compte Google utilise la même adresse e-mail vérifiée qu'un utilisateur OAuth existant. Ce comportement appartient à Supabase Auth.

En revanche, si les adresses Discord et Google sont différentes, une connexion Google effectuée alors que le joueur est déconnecté peut créer un second `auth.users.id`. C'est pourquoi l'interface indique explicitement aux joueurs possédant déjà un profil Discord de se reconnecter d'abord avec Discord puis d'utiliser **LIER**.

## Aucun merge destructif

Si l'identité Google choisie appartient déjà à un autre utilisateur Supabase, la liaison échoue. La PWA :

- ne remplace aucun UUID ;
- ne transfère aucun record automatiquement ;
- ne fusionne pas deux lignes `profiles` ;
- ne déplace aucune Verified Run.

Un message utilisateur indique que ce compte Google appartient déjà à un autre profil.

## Interface Profil

Déconnecté :

```text
SE CONNECTER AVEC DISCORD
SE CONNECTER AVEC GOOGLE
```

Connecté avec Discord seulement :

```text
CONNEXIONS
DISCORD    LIÉ
GOOGLE     [ LIER ]
```

Connecté avec Google seulement :

```text
CONNEXIONS
DISCORD    [ LIER ]
GOOGLE     LIÉ
```

Connecté avec les deux :

```text
CONNEXIONS
DISCORD    LIÉ
GOOGLE     LIÉ
```

Le unlink reste pris en charge par la couche Auth mais **aucun bouton DÉLIER n'est encore exposé dans l'interface**. Cela évite les suppressions accidentelles pendant cette première intégration Google.

## Architecture frontend

`site/src/auth.js` conserve la session, le callback OAuth et le profil. Les identités sont isolées dans :

```text
site/src/auth/identity-linking.js
```

API principale :

```js
signInWithProvider(provider, options)
linkIdentity(provider, options)
unlinkIdentity(identityId)
linkedIdentities()
```

`signInWithDiscord()` reste un wrapper de compatibilité pour le code historique. Google utilise directement l'API provider-agnostic.

## Configuration Supabase requise

Pour que le linking fonctionne réellement :

- le provider **Google** doit être activé dans Supabase Auth ;
- son Client ID et son Client Secret doivent être configurés côté Supabase ;
- **Allow manual linking** doit être activé ;
- l'URL GitHub Pages doit être autorisée comme URL de redirection Supabase.

Voir [`AUTH-GOOGLE.md`](./AUTH-GOOGLE.md) pour la configuration complète.

> Hotfix permissions : après `012_profile_customization.sql`, exécuter aussi `supabase/013_profile_permissions_hotfix.sql` sur une base déjà déployée en dev11 afin de rétablir les grants PostgREST nécessaires à la personnalisation du profil.
