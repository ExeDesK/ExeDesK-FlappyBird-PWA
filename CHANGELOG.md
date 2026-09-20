# Changelog

## v0.2.3b-dev1 - Audio diagnostics

- Ajout d'un journal circulaire des 250 derniers événements audio/lifecycle.
- Trace les ouvertures/fermetures des réglages, debug, focus, visibilité, pageshow/pagehide et réseau.
- Trace la création/reprise de l'AudioContext, son état, le décodage et chaque SFX demandé/joué/ignoré.
- Ajout d'un état audio live dans le panneau debug.
- Ajout de « Copier audio » et « Exporter audio » pour capturer le bug sans recharger l'application.
- Aucun changement volontaire de la logique de jeu ou de la politique audio : cette build sert à identifier le déclencheur exact.


## v0.2.2b - GitHub Pages beta

- Préparation du dépôt pour un hébergement statique sur GitHub Pages.
- Ajout du workflow `.github/workflows/pages.yml` : tests puis publication automatique de `site/` sur chaque push de `main`.
- Ajout d'un workflow de tests dédié aux pull requests.
- Remplacement de la sonde serveur dynamique par `site/version.json`, volontairement non mise en cache par le Service Worker.
- Vérification des chemins relatifs pour supporter l'URL de projet `/<repository>/` de GitHub Pages.
- Suppression des éléments de self-hosting devenus inutiles dans le dépôt : Docker, Caddy, serveur local et scripts associés.
- Déplacement de l'outil de replay déterministe dans `tests/replay.mjs`.
- Nettoyage et réindentation du code JavaScript, CSS, HTML, tests et workflows sans modification volontaire du gameplay.
- Mise à jour du cache PWA et de l'interface vers `0.2.2b`.

## v0.2.1b - beta patch

- Mode Adapté entièrement rendu dans le même Canvas : scène 288 × 512 centrée, ciel complété au-dessus et terre complétée au-dessous.
- Suppression de l'extension CSS séparée qui pouvait laisser un vide ou clignoter lors d'un resize/orientationchange iOS.
- Le ciel ajouté suit automatiquement le fond jour/nuit exact de l'atlas ; les fades noir et flash blanc couvrent aussi les extensions.
- Les tuyaux supérieurs peuvent se prolonger dans le ciel ajouté ; les tuyaux inférieurs restent clipsés au viewport original et ne débordent jamais dans la terre.
- Mode Original maintenu centré dans la fenêtre.
- Préférence PWA `portrait-primary`, tentative de verrouillage via Screen Orientation API et garde-fou plein écran en paysage sur appareils tactiles.
- iOS standalone : status bar opaque noire au lieu de `black-translucent`.
- Mode Performance ne modifie plus la taille CSS du jeu ; il limite uniquement le supersampling interne à ×2.

## v0.2b - beta

- Passage du projet au statut bêta.
- Supersampling du Canvas : ×2 minimum, jusqu'à ×3 sur les écrans à fort DPR.
- Amélioration du rendu de l'oiseau lorsqu'il est incliné, sans modifier la physique ni les coordonnées 288 × 512.
- Mode Performance limité à ×2 sur les appareils à fort DPR.
- Ratio Original par défaut sur desktop ; Adapté par défaut sur mobile.
- Correction de l'interpolation du sol et des apparitions furtives de tuyaux.
- Profiler iOS / rAF et export de performances.
- Bouton de purge/mise à jour conditionné à la joignabilité de l'hébergement.
- Nettoyage des mentions de portage personnel dans l'interface et les métadonnées PWA.
- Footer d'installation PWA Windows / iOS / Android et crédits .GEARS Studios.
