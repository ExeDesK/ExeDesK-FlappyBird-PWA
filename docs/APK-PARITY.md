# APK 1.3 parity CI

Depuis la v0.2.6b, le dépôt PWA vérifie automatiquement que le moteur déterministe reste identique aux traces de référence produites à partir de l'APK Android 1.3.

## Référence

La CI utilise le dépôt :

- `ExeDesK/Flappy13-APK-TestHarness`
- tag figé : `v3.2.2`

Aucun APK n'est téléchargé ni stocké dans ce dépôt ou dans la CI. Le harness ne fournit que les scénarios, le comparateur et les golden traces déjà validées.

## Scénarios

- `01-ground` : mort au sol
- `02-score10` : score 10 puis mort
- `03-sky-pipe` : collision avec un tuyau supérieur
- `04-long20` : partie longue, score 20 puis mort

La comparaison porte sur les états déterministes tick par tick, avec comparaison float32 bit à bit pour les champs flottants.

## Exécution automatique

`.github/workflows/apk-parity.yml` s'exécute sur chaque `push`, chaque pull request et manuellement.

Le déploiement GitHub Pages exécute lui aussi la parité avant publication. Une divergence bloque donc le déploiement de `main`.

## Exécution locale

Depuis le dépôt du harness :

### Windows

```powershell
.\compare-suite.ps1 -PwaRepo "C:\chemin\vers\FlappyBird-PWA"
```

### Linux

```bash
./compare-suite.sh /chemin/vers/FlappyBird-PWA
```

## Mise à jour de la référence

Le tag du harness est volontairement figé. Une nouvelle version du harness ou de nouvelles golden traces doivent être validées séparément, taguées, puis le champ `HARNESS_REF` des workflows PWA peut être mis à jour explicitement.
