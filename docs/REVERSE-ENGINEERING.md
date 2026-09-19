# Notes de portage - source fournie, version de travail 0.1.1

## Base examinée et niveau de preuve

La base est constituée de `dotgears.zip` (Java produit par JADX) et de `raw.zip` (ressources, manifeste Android binaire, classes.dex et bibliothèques). Les empreintes sont consignées dans SOURCE-INVENTORY.json. Aucune autre implémentation de Flappy Bird n'a servi de source au moteur.

Le manifeste binaire **annonce** `com.dotgears.flappybird`, `versionName=1.3`, `versionCode=4`, `minSdkVersion=8`, `targetSdkVersion=23`. Cette lecture ne prouve pas l'authenticité d'un APK distribué historiquement. Le conteneur APK d'origine et sa signature n'ont pas été authentifiés. Le portage vise les fichiers fournis.

Les noms obfusqués sont conservés dans les références ci-dessous. Les affirmations de comportement sont issues de leur lecture ; les comparaisons JVM sont des tests arithmétiques indépendants, pas une exécution du jeu Android. Une ambiguïté significative de surcharge Java a été résolue par les instructions du DEX.

## Horloges : ne pas tout convertir en deltaTime

Source : `com/dotgears/GameActivity.java`, `com/dotgears/g.java`, `com/dotgears/d.java`, `com/dotgears/r.java` et DEX `Lorg/andengine/b/e;`.

Le constructeur du moteur reçoit 60. La classe du moteur dans le DEX calcule `1_000_000_000 / fps`, dort lorsque la durée est trop courte, puis appelle **une seule fois** le moteur parent. Il s'agit d'une limitation de cadence, pas d'un accumulateur avec plusieurs mises à jour de rattrapage.

Le portage effectue au plus une mise à jour par callback d'affichage, vise 60 mises à jour/s sur les écrans plus rapides et ne rattrape pas un retard prolongé. Le cadencement Android exact (ordonnancement de Thread.sleep, traitement du temps par le système) n'est pas émulé : la comparaison temporelle sur appareil reste nécessaire.

Trois compteurs différents sont conservés :

| Mécanisme | Comportement lu |
|---|---|
| Déplacement/rotation | Une opération par mise à jour, sans multiplication par le temps réel. |
| Animation des sprites | Ajout de 15 ; seuil entier `1000 / framerate` ; remise à zéro au seuil. |
| File d'événements | Retrait de 30 par mise à jour. Un délai de 500 prend 17 mises à jour, un délai de 1000 en prend 34. |
| Interpolations | Nombre de pas dérivé de `60 * durée`, avec les tables originales. |

`g.java` transmet aussi `0.015f` aux objets ; ce n'est pas une raison de remplacer tous les compteurs par 1/60. Les identifiants d'interpolation 5 et 11 correspondent respectivement à cubic-out et quintic-out dans la table fournie.

## Coordonnées et ressources

Source : `GameActivity.java`, `res/raw/atlas.txt`, `assets/gfx/atlas.png`, DEX `Lorg/andengine/opengl/c/f;` et `Lorg/andengine/b/c/a/b;`.

La caméra logique est de **288 x 512**, l'atlas vérifié fait **1024 x 1024**. L'atlas et sa description sont copiés sans modification. Les rectangles UV sont convertis en pixels entiers avec arrondi ; les noms et dimensions sont ceux du fichier fourni.

Le constructeur des options de texture associées à `f.i` utilise 9728 pour les filtres min/mag : le rendu du portage n'applique pas de lissage des images. La rotation utilise la table de sinus/cosinus avec la constante `3.1415925f` lue dans le code. Cela ne garantit pas une rasterisation Canvas strictement identique à OpenGL ES aux pixels de bord.

La politique de dimensions Android examinée remplit la surface, quitte à déborder et recadrer. **Adaptation explicite :** la PWA affiche initialement toute l'aire de jeu ; l'option Remplissage original remet un agrandissement avec recadrage.

Les cinq sons OGG sont copiés octet pour octet. Des versions WAV PCM16 décodées de ces fichiers sont fournies et utilisées à l'exécution. Il n'y a ni nouveaux effets ni ajustement volontaire du volume. Les icônes sont reprises de la ressource Android ; les tailles manquantes ont été redimensionnées au plus proche voisin.

## Oiseau et collisions

Source : `com/dotgears/flappy/a.java`, `com/dotgears/q.java`, `com/dotgears/j.java`.

| Paramètre | Valeur / règle portée |
|---|---|
| Position après reset | x=80, y=246 ; en menu, la scène la remplace par x=134, y=218. |
| Boîte logique | 20 x 20 ; sprite 48 x 48 dessiné à x-14, y-14. |
| Flap | Vitesse verticale -5 ; gravité +0.3 ; vitesse angulaire -10 ; accélération angulaire +0.4. |
| Intégration | Addition float32, plafonnement de vitesse à +8, puis conversion Java vers entier de y+v. |
| Sol | y de l'oiseau plafonné à 380 ; vitesse et gravité remises à zéro au dépassement. |
| Rotation | Angle += vitesse puis vitesse += accélération ; angle limité à [-20,90] et converti en entier pour le dessin. |
| Attente | Phase +8 degrés par tick ; sin(phase)*4 ; période 45 ticks. |
| Entrée ignorée | Flap ignoré si y<0 ou si l'oiseau est marqué mort. |
| Test de contact | Rectangles alignés sur les axes, bords inclus. La hitbox ne tourne pas avec le sprite. |

**Correction de décompilation :** dans le calcul de flottement, le DEX contient `int-to-float` puis un appel à `j.b(F)F` (sinus). Choisir la surcharge entière en lisant le Java décompilé donnerait un autre calcul. L'extrait correspondant figure dans DEX-PROOFS.txt.

L'animation de battement utilise la séquence `[0,1,2,1,0,1,2,1,0,1,2,1]`. Avec le seuil 33 et les incréments de 15, l'index change toutes les 3 mises à jour, pas à 30 images/s réelles. L'attente utilise un seuil 100, soit 7 mises à jour. L'animation terminée dessine la pose 1.

## Tuyaux, sol, score et hasard

Source : `com/dotgears/flappy/c.java`, `com/dotgears/j.java`.

Les tuyaux font 52 x 320, l'ouverture est 96, la vitesse est 2 pixels par tick. Le haut du sol est y=400 ; son décalage boucle tous les 24 pixels. Les positions de construction des trois tuyaux sont 79,236,393 avec y=274 ; l'espacement de recyclage est 157. Les positions survivent à un redémarrage de partie.

Au recyclage, y est choisi par `j.a(180,360)` (borne supérieure exclue dans le cas ordinaire). La phase masquée initiale et la mise à -52 des premiers tuyaux lors de sa fin sont conservées. Il ne faut pas remplacer cela par un spawn uniforme au bord droit.

Le score s'incrémente lorsque le x du premier tuyau vaut le x de l'oiseau ou ce x moins 1. Ce n'est pas un passage du bord arrière. La scène teste les deux premiers couples de tuyaux. Le contact du sol et celui d'un tuyau ont des branches de sons/événements différentes, reprises du code.

Le générateur utilise deux entiers signés 32 bits, multiplications 36969 et 18000, décalages arithmétiques et `Math.abs`. Le portage conserve débordements, restes signés et le cas particulier du minimum int32 ; il n'utilise pas Math.random pour les tuyaux. La graine initiale est dérivée du temps courant puis exportée pour les replays. Deux lancements indépendants de l'APK et de la PWA n'auront donc pas spontanément la même séquence.

## Menus et fin de partie

Source : `flappy/c.java`, `flappy/e.java`, `flappy/f.java`, `p.java`, `k.java`, `n.java` et `g.java`.

Le titre, boutons, texte de préparation, tutoriel, flash de collision, GAME OVER, panneau de score, médailles et étincelles utilisent l'atlas fourni. Les boutons réagissent au relâchement de la pression échantillonnée. Les seuils de médailles 10,20,30,40 s'associent aux indices d'atlas 3,2,1,0.

Le panneau entre de y=504 à y=193, en x=25. Les interpolations et le comptage du score sont distincts. La zone d'exclusion de toucher en haut à gauche, présente dans la logique de jeu, est conservée même sans bouton pause visible. L'ordre de construction de la liste de dessin suit celui des mises à jour examinées.

## Adaptations et limites volontaires

Le portage fournit une enveloppe PWA, pas une copie du système Android : splash Android et services externes absents, classement remplacé par le record local, RATE remplacé par les informations, pas de publicité. Les options, commandes clavier, diagnostic et export de traces sont ajoutés.

Les pressions très brèves peuvent être retenues jusqu'à un tick pour ne pas être perdues entre deux callbacks navigateur ; cette adaptation d'entrée est explicite. Le changement d'onglet suspend la simulation sans accélération de rattrapage. La latence matérielle du toucher/audio, le mélange audio Android, le compositing OpenGL et l'ordonnancement réel ne sont pas reproduits au niveau système.

Pour annoncer un 1:1 validé, il reste à lancer la référence Android, aligner les entrées et la graine, puis comparer trajectoires, collisions, animations, captures et chronologie audio. Les tests automatiques actuels ne remplacent pas cette étape.
