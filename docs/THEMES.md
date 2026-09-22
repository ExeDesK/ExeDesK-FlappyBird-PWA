# Thèmes visuels

Le système de thèmes est volontairement séparé du moteur de gameplay. Un thème ne doit modifier ni la physique, ni les hitboxes, ni le RNG de gameplay, ni les données des Verified Runs. Il ne fait que résoudre les noms de sprites et les paramètres de rendu visuel.

## Fichiers

- `site/assets/atlas.png` + `atlas.txt` : atlas original Flappy Bird 1.3, conservé comme référence.
- `site/assets/customatlas.png` + `customatlas.json` : sprites complémentaires.
- `site/assets/themes.json` : catalogue déclaratif, thème de base, pools Auto et règles de rendu.
- `site/src/themes.js` : validation et résolution du catalogue.
- `site/src/atlas.js` : application du thème au rendu.

## Principe de sélection Auto

La sélection Auto se fait en deux niveaux :

1. un pool visuel est tiré selon sa probabilité globale ;
2. si un pool est sélectionné, un thème de ce pool est tiré selon son `weight` relatif ;
3. si aucun pool n'est sélectionné, le thème marqué `base: true` est utilisé.

Avec le catalogue actuel, le pool `country` vaut exactement `1/30` et contient **France** et **Vietnam**, chacun avec `weight: 1`. Une fois le pool pays tiré, les deux thèmes ont donc chacun 50 % de chance d'être choisis, soit **1/60 de l'ensemble des runs**. Si dix pays de poids `1` sont présents, le pool reste à `1/30` et chaque pays représente `1/300` de l'ensemble des runs.

Les probabilités des pools sont **absolues** et leur somme ne peut pas dépasser `1`. La partie restante revient automatiquement au thème de base. Cela permet d'ajouter plus tard d'autres pools sans faire varier la probabilité du pool `country`.

## Schéma de `themes.json`

```json
{
  "schemaVersion": 2,
  "selection": {
    "pools": {
      "country": {
        "chance": 0.03333333333333333
      }
    }
  },
  "themes": {
    "original": {
      "label": "Original",
      "base": true,
      "backgroundDay": "bg_day",
      "backgroundNight": "bg_night",
      "pipeUp": "pipe_up",
      "pipeDown": "pipe_down",
      "bird0": "bird{color}_0",
      "bird1": "bird{color}_1",
      "bird2": "bird{color}_2",
      "land": {
        "sprite": "land",
        "scrollMode": "original"
      },
      "fill": {
        "skyDay": "rgb(78, 192, 202)",
        "skyNight": "rgb(0, 135, 147)",
        "land": "rgb(222, 216, 149)"
      }
    },
    "france": {
      "label": "France",
      "pool": "country",
      "weight": 1,
      "backgroundDay": "bg_france_day",
      "backgroundNight": "bg_france_night",
      "pipeUp": "pipe_france_up",
      "pipeDown": "pipe_france_down",
      "bird0": "bird_france_0",
      "bird1": "bird_france_1",
      "bird2": "bird_france_2",
      "land": {
        "sprite": "land_france",
        "scrollMode": "defilement"
      },
      "fill": {
        "skyDay": "rgb(19, 58, 126)",
        "skyNight": "rgb(7, 27, 69)",
        "land": "rgb(42, 49, 39)"
      }
    },
    "vietnam": {
      "label": "Vietnam",
      "pool": "country",
      "weight": 1,
      "backgroundDay": "bg_vietnam_day",
      "backgroundNight": "bg_vietnam_night",
      "pipeUp": "pipe_vietnam_up",
      "pipeDown": "pipe_vietnam_down",
      "bird0": "bird_vietnam_0",
      "bird1": "bird_vietnam_1",
      "bird2": "bird_vietnam_2",
      "land": {
        "sprite": "land_vietnam",
        "scrollMode": "defilement"
      },
      "fill": {
        "skyDay": "rgb(62, 167, 252)",
        "skyNight": "rgb(72, 71, 141)",
        "land": "rgb(100, 89, 73)"
      }
    }
  }
}
```

Le catalogue doit contenir **exactement un** thème `base: true`. Ce thème n'appartient à aucun pool et sert de fallback Auto. Il reste également sélectionnable manuellement dans le menu de diagnostic comme n'importe quel autre thème.

## Pools et poids

`selection.pools.<id>.chance` définit la probabilité globale du pool. Exemple :

```json
"country": {
  "chance": 0.03333333333333333
}
```

Chaque thème membre indique ensuite son pool et son poids :

```json
"france": {
  "pool": "country",
  "weight": 5
},
"japan": {
  "pool": "country",
  "weight": 2
},
"italy": {
  "pool": "country",
  "weight": 1
}
```

Dans cet exemple, le pool pays reste à `1/30`. Une fois ce pool tiré, France reçoit `5/8` des sélections du pool, Japon `2/8` et Italie `1/8`.

Règles :

- `weight` absent vaut `1` ;
- `weight: 0` garde le thème disponible dans le menu debug mais l'exclut du tirage Auto ;
- un poids négatif est invalide ;
- un `pool` inconnu est invalide ;
- un thème sans `pool` et non `base` reste disponible manuellement mais n'est jamais sélectionné en Auto ;
- un pool avec une `chance > 0` doit contenir au moins un thème de poids positif ;
- la somme des `chance` de tous les pools doit rester inférieure ou égale à `1`.

## Oiseaux

Les clés `bird0`, `bird1` et `bird2` correspondent aux trois frames d'animation. La chaîne spéciale `{color}` permet de conserver la couleur d'oiseau choisie par le moteur original :

```json
"bird0": "bird{color}_0"
```

Les thèmes France et Vietnam n'utilisent pas ce placeholder et remplacent toutes les couleurs originales par leur oiseau dédié.

## Défilement du sol

`land.scrollMode` accepte deux valeurs :

- `original` : conserve la phase native du moteur Flappy Bird 1.3, avec wrap tous les 24 px ;
- `defilement` : transforme cette phase native en offset visuel continu, puis répète la largeur complète du sprite de sol. C'est le mode utilisé par l'égout France et le sol ferroviaire Vietnam, tous deux en 336 px.

Le mode `defilement` reste uniquement visuel : la variable `land` du moteur continue à fonctionner exactement comme dans l'APK.

## Ajouter un pays

1. Ajouter ses sprites dans le custom atlas et régénérer `customatlas.json`.
2. Ajouter une entrée dans `themes.json` avec `pool: "country"`.
3. Choisir son `weight` relatif dans le pool (`1` pour une distribution uniforme entre pays).
4. Déclarer ses backgrounds, tuyaux, oiseaux, sol et `land.scrollMode`.
5. Lancer `npm test` et le smoke test Chromium.

Il n'est pas nécessaire de modifier la probabilité `1/30` du pool `country` lorsque de nouveaux pays sont ajoutés. Le menu de diagnostic est généré depuis `themes.json` : tout nouveau thème valide apparaît automatiquement dans le sélecteur sans ajouter une option HTML à la main.

## Menu de diagnostic

Le sélecteur de thème est **entièrement piloté par `themes.json`**. Le HTML ne liste aucun pays : au chargement, `main.js` construit `Auto` puis une option pour chaque entrée valide du catalogue. Ajouter un thème au JSON suffit donc à le rendre disponible dans le menu de diagnostic.

Le panneau de diagnostic est séparé en sections natives `<details>` repliables et dispose de sa propre croix de fermeture. Les `<select>` ne reçoivent pas de skin clair spécifique ; le panneau utilise `color-scheme: dark` afin de laisser le navigateur fournir son contrôle natif sombre.
