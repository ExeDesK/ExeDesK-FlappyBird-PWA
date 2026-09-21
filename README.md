[🇬🇧 English version](./README.en.md)

# Flappy Bird 1.3 PWA

Recréation **non officielle** de **Flappy Bird 1.3** sous la forme d'une Progressive Web App (PWA), réalisée à partir de l'analyse de la version Android 1.3 fournie au projet.

L'objectif n'est pas de produire un simple clone « inspiré de » Flappy Bird, mais de **reproduire aussi fidèlement que possible le comportement de la version 1.3** : physique, cadence, collisions, génération des tuyaux, animations, score, transitions et rendu, tout en l'adaptant proprement aux navigateurs modernes et aux écrans actuels.

Le gameplay fonctionne entièrement côté client, sans framework, et peut être installé comme une application sur Windows, iPhone/iPad et Android. Les fonctions communautaires utilisent un backend Supabase facultatif : aucun compte n'est nécessaire pour jouer.

> **État du projet : bêta — v0.2.7.3b-dev6.1**

- Statistiques joueur : carrière + fenêtres 10 / 25 / 50 calculées uniquement depuis les runs vérifiées.
> Sur iPhone/iPad ProMotion, un statut dynamique dans les options Performance mesure la cadence rAF sur iOS : il confirme la haute fréquence lorsqu’elle est active, sinon il propose le réglage Safari et un tutoriel au timecode utile.

---

## Fonctionnalités

- Gameplay porté à partir du comportement observé dans la version Android 1.3.
- Simulation logique indépendante du taux de rafraîchissement de l'écran.
- Canvas 2D + JavaScript ES modules, sans framework.
- Fonctionnement hors ligne via Service Worker.
- Mises à jour PWA automatiques, téléchargées en arrière-plan sans interrompre une partie.
- Installation PWA sur Windows, iOS/iPadOS et Android.
- Sauvegarde locale du meilleur score.
- Connexion Discord facultative via Supabase Auth et profil joueur cross-platform.
- Synchronisation du meilleur score entre appareils en conservant toujours la valeur la plus élevée.
- Verified Runs : ticket/seed serveur, capture déterministe, file locale auto-réparante, soumission différée et relecture autoritaire avant validation ou rejet du score.
- Classement global public dans une modale dédiée : consultation sans compte, uniquement des runs vérifiés et un seul meilleur score par joueur.
- Contexte personnel authentifié dans le classement : rang global réel, record vérifié, nombre lifetime de runs vérifiées et date du record, y compris hors Top 100.
- Statistiques lifetime autoritaires côté Supabase (`player_stats`) : parties vérifiées, score cumulé, record historique et causes de mort, sans aucune statistique envoyée par le client.
- Rétention des replays vérifiés : **50 dernières parties + meilleur run historique** par joueur, afin de borner le stockage tout en conservant le record et une fenêtre récente exploitable pour les futures statistiques court terme.
- Affichage **Original** ou **Adapté** selon l'appareil.
- Extension dynamique du ciel et du sol sur les écrans plus hauts que le format original.
- Mode Performance pour limiter le supersampling sur les appareils à fort DPR.
- Interpolation visuelle pour réduire les micro-saccades liées au `requestAnimationFrame` des navigateurs mobiles.
- Supersampling du rendu pour améliorer notamment la rotation de l'oiseau sur les écrans Retina.
- Profiler intégré pour diagnostiquer le frame pacing et les performances.
- Export de replays déterministes pour comparer le comportement du moteur.
- Orientation portrait demandée par la PWA, avec protection supplémentaire si le navigateur refuse le verrouillage.

---

## Pourquoi ce projet ?

Flappy Bird est un jeu extrêmement simple en apparence, mais son ressenti dépend d'une grande quantité de petits détails : valeurs de physique, arrondis, fréquence des mises à jour, hitbox, ordre des événements, cadence des animations, positions de génération des tuyaux, etc.

Recréer le jeu « à l'œil » donne rapidement un résultat ressemblant à Flappy Bird, mais pas nécessairement **le même jeu**.

Ce projet suit donc une approche différente :

1. analyser la version Android 1.3 ;
2. documenter son comportement ;
3. reproduire ses règles dans un moteur JavaScript déterministe ;
4. séparer strictement la **simulation** du **rendu navigateur** ;
5. adapter uniquement ce qui est nécessaire pour les écrans, les PWA et les contraintes des navigateurs modernes.

---

## Méthode de rétro-ingénierie

La reconstruction s'appuie principalement sur :

- le `classes.dex` de l'APK ;
- le Java reconstruit avec **JADX** ;
- les ressources extraites de l'APK ;
- le fichier décrivant l'atlas graphique ;
- la lecture ponctuelle du DEX lorsque la décompilation Java est ambiguë ;
- des tests JVM/JavaScript pour vérifier les différences d'arrondi et de calcul ;
- des captures et profils d'exécution sur navigateurs desktop et mobiles.

Aucune implémentation tierce de Flappy Bird n'a servi de base au moteur de gameplay.

Les notes détaillées sont disponibles dans :

- [`docs/REVERSE-ENGINEERING.md`](./docs/REVERSE-ENGINEERING.md)
- [`docs/TESTS.md`](./docs/TESTS.md)
- [`docs/AUTH-DISCORD.md`](./docs/AUTH-DISCORD.md)
- [`docs/VERIFIED-RUNS.md`](./docs/VERIFIED-RUNS.md)
- [`docs/LEADERBOARD.md`](./docs/LEADERBOARD.md)
- [`docs/PLAYER-STATS.md`](./docs/PLAYER-STATS.md)
- [`docs/RETENTION.md`](./docs/RETENTION.md)

---

## Quelques paramètres retrouvés dans la version 1.3

| Élément | Valeur portée |
| --- | ---: |
| Résolution logique | `288 × 512` |
| Atlas graphique | `1024 × 1024` |
| Simulation | `60 Hz` |
| Hitbox de l'oiseau | `20 × 20` |
| Sprite de l'oiseau | `48 × 48` |
| Impulsion d'un flap | `-5 px/tick` |
| Gravité | `+0.3 px/tick²` |
| Vitesse verticale maximale | `+8 px/tick` |
| Vitesse des tuyaux | `2 px/tick` |
| Ouverture entre les tuyaux | `96 px` |
| Espacement horizontal | `157 px` |
| Haut du sol | `y = 400` |

Le moteur conserve également plusieurs particularités de l'original : calculs basés sur les ticks, conversions vers des entiers aux mêmes étapes, générateur pseudo-aléatoire dédié, hitbox non tournée avec le sprite et logique originale du comptage du score.

---

## Architecture

Le projet est volontairement léger.

```text
site/
├── assets/                 Ressources graphiques et audio
├── icons/                  Icônes de la PWA
├── src/
│   ├── atlas.js            Rendu Canvas, atlas et interpolation
│   ├── audio.js            Gestion audio
│   ├── auth.js             Auth Discord/Supabase et session locale
│   ├── clock.js            Horloge de simulation 60 Hz
│   ├── display.js          Modes d'affichage et dimensions
│   ├── game.js             Gameplay et machine d'états
│   ├── leaderboard.js      Validation des données du classement public
│   ├── main.js             Entrées, PWA, options et cycle principal
│   ├── math.js             Maths, RNG, animations et tweens
│   ├── perf.js             Profiler de performances
│   └── verified-runs.js    Contrat et simulation des runs vérifiés
├── config.example.js      Modèle de configuration runtime (Supabase)
├── index.html
├── manifest.webmanifest
├── style.css
├── sw.js                   Service Worker / cache hors ligne
└── version.json            Version publiée / sonde réseau non mise en cache

tests/
├── replay.mjs              Relecture déterministe des exports
└── …                       Tests du moteur, du cache et de l’affichage
docs/                       Documentation technique et preuves d'analyse
supabase/                   SQL et Edge Functions Supabase versionnés
.github/                     Automatisation GitHub du projet
CHANGELOG.md                 Historique des versions
README.md                    Documentation française
README.en.md                 Documentation anglaise
```

Le dossier **`site/` est autonome** : c'est la racine statique à publier sur un hébergement HTTPS.

Aucune étape de compilation n'est nécessaire pour exécuter le jeu.

---

## Simulation et rendu

La logique du jeu travaille dans l'espace original **288 × 512**.

La simulation est exécutée à **60 Hz** avec une horloge fixe. Le navigateur peut cependant rendre à une fréquence différente : 60 Hz, 90 Hz, 120 Hz ou parfois moins sur mobile.

Le projet sépare donc :

```text
Entrées utilisateur
       ↓
Simulation 60 Hz
       ↓
État précédent + état courant
       ↓
Interpolation
       ↓
requestAnimationFrame
       ↓
Canvas
```

Cette séparation permet d'éviter que la physique change avec la fréquence de l'écran et réduit les saccades lorsqu'un navigateur rate ponctuellement une frame.

### Rendu Retina

Les sprites restent positionnés dans l'espace logique original, mais le Canvas utilise un backing store supersamplé :

- au moins **×2** en fonctionnement normal ;
- jusqu'à **×3** sur les appareils à fort `devicePixelRatio` ;
- limité à **×2** lorsque le mode Performance est activé.

Cette adaptation vise principalement à améliorer la rasterisation des sprites en rotation, en particulier l'oiseau, sans modifier la physique ni les coordonnées du jeu.

---

## Modes d'affichage

### Adapté

Mode par défaut sur les appareils tactiles.

Le jeu conserve son ratio et sa géométrie originale, mais la scène 288 × 512 est centrée dans l'écran. Les zones supplémentaires sont prolongées avec les couleurs correspondantes :

- ciel clair pour le décor de jour ;
- ciel sombre pour le décor de nuit ;
- terre sous la scène.

Les tuyaux supérieurs peuvent se prolonger dans le ciel ajouté lorsque cela est nécessaire.

### Original

Mode par défaut sur desktop.

Le cadre original 288 × 512 est conservé et centré dans la fenêtre sans modifier sa composition.

---

## PWA et fonctionnement hors ligne

Le jeu utilise un Service Worker pour mettre en cache l'application et ses ressources.

Une fois le premier chargement terminé, la PWA peut fonctionner sans connexion réseau tant que les données du site n'ont pas été supprimées par le navigateur.

L'application ne dépend d'aucune API distante pour le gameplay.

### Installation

**Windows — Edge / Chrome**

Ouvrir le site puis utiliser l'option **Installer l'application** du navigateur.

**iPhone / iPad — Safari**

Ouvrir le site dans Safari, puis :

`Partager → Ajouter à l'écran d'accueil`

Lancer ensuite le jeu depuis l'icône installée pour utiliser le mode PWA. iOS peut conserver sa barre d'état système selon la version de WebKit.

**Android — Chrome**

Ouvrir le site puis utiliser :

`Menu → Installer l'application` ou `Ajouter à l'écran d'accueil`.

> Pour une installation PWA normale, le site doit être servi en **HTTPS** (hors exceptions de développement comme `localhost`).

---

## Déploiement GitHub Pages

Le dépôt est prêt à être publié directement avec **GitHub Pages**, sans serveur applicatif. Le workflow [`.github/workflows/pages.yml`](./.github/workflows/pages.yml) :

1. lance les tests Node ;
2. vérifie la parité APK 1.3 ;
3. génère `site/config.js` à partir des secrets GitHub ;
4. prépare GitHub Pages ;
5. publie **uniquement le dossier `site/`** ;
6. déploie automatiquement après chaque push sur `main`.

Avant le premier déploiement, créer dans `Settings → Secrets and variables → Actions` les deux **Repository secrets** suivants :

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

Puis activer une seule fois :

`Settings → Pages → Build and deployment → Source → GitHub Actions`

> La publishable key Supabase et l'URL du projet ne sont pas des secrets de sécurité : toute application web doit les transmettre au navigateur. Les stocker dans GitHub Secrets évite surtout de les versionner en clair dans l'historique Git. La protection réelle repose sur RLS et les politiques Supabase.

Puis un simple :

```bash
git push
```

déclenche les tests et, s’ils passent, le déploiement HTTPS. Pour le dépôt `ExeDesK/FlappyBird-PWA`, l’URL attendue est :

```text
https://exedesk.github.io/FlappyBird-PWA/
```

Tous les chemins de l’application sont relatifs afin de fonctionner correctement sous le sous-chemin `/FlappyBird-PWA/`.

### Mise à jour de la PWA

La PWA vérifie automatiquement [`site/version.json`](./site/version.json) au lancement, au retour au premier plan, après le retour du réseau et périodiquement. Lorsqu’une nouvelle version est publiée, le nouveau Service Worker et ses ressources sont préparés en arrière-plan sans interrompre la partie en cours. La mise à jour est activée automatiquement au lancement suivant, ou immédiatement via **Installer maintenant** dans les options.

`version.json` reste volontairement hors du cache afin que la vérification reflète bien la version publiée sur GitHub Pages. L’installation du cache reste atomique : si une ressource de la nouvelle build manque, la version actuellement fonctionnelle reste active.

---

## Lancer le projet localement

Il n'y a pas de build applicatif à effectuer. Il suffit de servir le dossier `site/` avec un serveur HTTP statique.

Le jeu fonctionne sans configuration communautaire. Pour tester Discord/Supabase en local, copier le modèle puis renseigner les deux valeurs publiques :

```powershell
Copy-Item .\site\config.example.js .\site\config.js
```

`site/config.js` est ignoré par Git.

Exemple avec Python 3 :

```powershell
py -m http.server 8080 --directory site
```

Puis ouvrir :

```text
http://localhost:8080/
```

Il est déconseillé d'ouvrir directement `site/index.html` via `file://`, car les Service Workers nécessitent une origine HTTP(S) compatible.

---

## Tests et diagnostic

Le projet contient des tests automatisés couvrant notamment :

- la physique de l'oiseau ;
- les conversions et calculs issus de Java ;
- le générateur pseudo-aléatoire ;
- les tuyaux et collisions ;
- les transitions d'état ;
- les dimensions et modes d'affichage ;
- le cache PWA.

Pour lancer les tests Node :

```bash
npm test
```

Les **Outils de diagnostic**, accessibles par le lien discret tout en bas des options, permettent également :

- de mettre la simulation en pause ;
- d'avancer tick par tick ;
- d'afficher les hitboxes ;
- d'exporter un replay ;
- de profiler le `requestAnimationFrame` pendant 10 secondes ;
- d'exporter le profil de performances.

---

## Limites connues

Même avec une simulation reproduite très précisément, certains éléments restent dépendants de la plateforme :

- latence du tactile ;
- ordonnancement des frames par Safari / Chromium ;
- comportement audio ;
- rasterisation Canvas par rapport à l'OpenGL ES Android d'origine ;
- interface système des PWA, notamment sous iOS.

Le projet vise une reproduction comportementale et visuelle très proche de la version analysée, mais ne prétend pas reproduire le système Android lui-même pixel par pixel.

---

## Contribuer

Les contributions sont bienvenues, en particulier pour :

- améliorer la compatibilité navigateur ;
- réduire les différences mesurables avec la version 1.3 ;
- améliorer les tests et outils de comparaison ;
- corriger des problèmes de PWA ou de frame pacing.

Pour les modifications du gameplay, l'idéal est d'accompagner le changement d'une référence à l'analyse de la version 1.3 ou d'un test reproductible. Le but est d'éviter les ajustements « au feeling » qui éloigneraient le moteur de la référence.

---

## Changelog

Voir [`CHANGELOG.md`](./CHANGELOG.md).

---

## Projet non officiel et crédits

Ce projet est **non officiel** et n'est ni affilié à, ni approuvé par **.GEARS Studios**.

Il est basé sur l'étude de la version Android **1.3** de Flappy Bird fournie au projet, afin d'en reproduire le comportement dans une PWA moderne.

**Flappy Bird**, son identité visuelle, ses graphismes, ses sons et les autres éléments provenant du jeu original restent la propriété de leurs ayants droit respectifs. Tous les crédits relatifs au jeu original reviennent à **.GEARS Studios** et à ses créateurs.

Ce dépôt ne prétend accorder aucun droit sur les ressources originales. Avant de republier ou redistribuer publiquement un fork contenant ces ressources, il appartient à chacun de vérifier les droits applicables.

## Validation 1:1 continue

Depuis la v0.2.6b, chaque push et chaque pull request compare automatiquement le moteur PWA aux golden traces issues de l'APK Android 1.3 via le harness dédié. Le déploiement GitHub Pages est également bloqué si cette parité diverge. Voir [`docs/APK-PARITY.md`](docs/APK-PARITY.md).


- **dev6.1** : lisibilité accrue des menus sur grands écrans et bloc `VOS STATISTIQUES` repliable par défaut.
