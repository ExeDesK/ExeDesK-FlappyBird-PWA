# Changelog

## v0.2.1b - beta patch

- Mode Adapte entierement rendu dans le meme Canvas : scene 288 x 512 centree, ciel complete au-dessus et terre complete au-dessous.
- Suppression de l'extension CSS separee qui pouvait laisser un vide ou clignoter lors d'un resize/orientationchange iOS.
- Le ciel ajoute suit automatiquement le fond jour/nuit exact de l'atlas; les fades noir et flash blanc couvrent aussi les extensions.
- Les tuyaux superieurs peuvent se prolonger dans le ciel ajoute; les tuyaux inferieurs restent clipses au viewport original et ne debordent jamais dans la terre.
- Mode Original maintenu centre dans la fenetre.
- Preference PWA `portrait-primary`, tentative de verrouillage via Screen Orientation API et garde-fou plein ecran en paysage sur appareils tactiles.
- iOS standalone : status bar opaque noire au lieu de `black-translucent`, afin d'eviter le flou/translucidite au-dessus du jeu.
- Mode Performance ne modifie plus la taille CSS du jeu; il limite uniquement le supersampling interne a x2.
- Version serveur/health mise a jour vers 0.2.1b.

## v0.2b - beta

- Passage du projet au statut beta.
- Supersampling du Canvas : x2 minimum, jusqu'a x3 sur les ecrans a fort DPR.
- Amelioration nette du rendu de l'oiseau lorsqu'il est incline, sans modifier la physique ni les coordonnees 288 x 512.
- Mode Performance limite le supersampling a x2 sur les appareils a fort DPR.
- Ratio Original par defaut sur desktop; Adapte par defaut sur mobile.
- Mode Adapte : terre prolongee sous la scene, integree au fade et au flash.
- Correction de l'interpolation du sol et des apparitions furtives de tuyaux.
- Profiler iOS / rAF et export de performances.
- Bouton de purge/mise a jour disponible uniquement si le serveur est joignable.
- Nettoyage des mentions de portage personnel dans l'interface et les metadonnees PWA.
- Footer d'installation PWA Windows / iOS / Android et credits .GEARS Studios.
