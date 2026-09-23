# Account linking

## État actuel — v0.2.7.4b-dev9

Le frontend possède désormais une couche d'**identity linking** générique autour de Supabase Auth, mais **Discord reste le seul provider exposé dans l'interface**. Aucun bouton ni configuration Google n'est ajouté dans cette version.

L'objectif est de pouvoir ajouter un second fournisseur plus tard sans créer un second profil de jeu ni déplacer les données existantes.

## Identifiant canonique du joueur

Le joueur reste identifié partout par le même UUID Supabase :

```text
auth.users.id
    ├── profiles.id
    ├── player_stats.player_id
    ├── verified_runs.player_id
    └── analytics / leaderboard / records
```

Le linking ajoute ou retire uniquement des **identités Auth** rattachées à cet UUID. Il ne change pas la clé du profil et ne déplace aucune donnée de jeu.

Les comptes Discord créés avant cette version restent donc inchangés. La clé locale `flappy13-auth-v1` est volontairement conservée pour ne pas invalider les sessions déjà présentes dans le navigateur.

## Architecture frontend

`site/src/auth.js` reste propriétaire de la session et du profil. La gestion spécifique des identités est isolée dans :

```text
site/src/auth/identity-linking.js
```

Ce module fournit :

- normalisation des identités retournées par `/auth/v1/user` ;
- compatibilité avec les anciennes sessions Discord en cache ;
- découverte des providers déjà liés ;
- préparation d'une liaison OAuth authentifiée ;
- suivi du provider en cours de liaison pendant la redirection OAuth ;
- suppression d'une identité existante ;
- garde-fou empêchant de délier le dernier moyen de connexion.

`AuthClient` expose désormais une API provider-agnostic :

```js
signInWithProvider(provider, options)
linkIdentity(provider, options)
unlinkIdentity(identityId)
linkedIdentities()
```

`signInWithDiscord()` reste disponible comme wrapper de compatibilité.

## Interface Profil

Lorsque le joueur est connecté, la modale Profil affiche une section **COMPTES LIÉS** construite depuis les identités du `user` Supabase.

Dans cette version, elle affiche uniquement Discord. Il n'y a volontairement :

- aucun second provider ;
- aucun bouton de linking ;
- aucun bouton de unlink tant qu'un second moyen de connexion n'existe pas.

Le bouton **SE DÉCONNECTER** reste une déconnexion de session complète et ne supprime aucune identité.

## Compatibilité des comptes existants

Aucune migration SQL n'est nécessaire et aucune ligne de `profiles`, `player_stats` ou `verified_runs` n'est recréée.

Pour une ancienne session mise en cache sans tableau `identities`, le client considère temporairement Discord comme identité historique. Dès la prochaine synchronisation en ligne, `/auth/v1/user` fournit la liste canonique gérée par Supabase.

## Future activation d'un second provider

Le parcours prévu est :

1. le joueur se connecte à son profil existant ;
2. il choisit **Lier <provider>** dans Profil ;
3. `linkIdentity()` démarre l'OAuth authentifié ;
4. le provider est rattaché au **même `auth.users.id`** ;
5. retour sur la PWA et resynchronisation du même profil / record / historique.

Si l'identité cible appartient déjà à un autre utilisateur Supabase, le linking doit échouer : cette version ne tente aucun merge destructif entre deux UUID existants.

## Configuration Supabase

Le linking manuel doit être activé dans la configuration Auth du projet avant d'exposer un bouton de liaison. Cette option peut être activée dès maintenant : elle ne migre ni ne modifie les comptes Discord existants.
