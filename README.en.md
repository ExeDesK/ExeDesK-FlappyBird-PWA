[🇫🇷 Version française](./README.md)

# Flappy Bird 1.3 PWA

An **unofficial** recreation of **Flappy Bird 1.3** as a Progressive Web App (PWA), built from the analysis of the Android 1.3 version provided to the project.

The goal is not to create another Flappy Bird-inspired clone, but to **reproduce the behaviour of version 1.3 as faithfully as possible**: physics, timing, collisions, pipe generation, animations, scoring, transitions and rendering, while adapting the game cleanly to modern browsers and displays.

The game runs entirely client-side, without a framework or backend, and can be installed as an application on Windows, iPhone/iPad and Android.

> **Project status: beta — v0.2.5b**

---

## Features

- Gameplay ported from behaviour found in the analysed Android 1.3 version.
- Logical simulation independent from the display refresh rate.
- Canvas 2D + JavaScript ES modules, with no framework.
- Offline support through a Service Worker.
- Automatic PWA updates downloaded in the background without interrupting an active run.
- Installable PWA on Windows, iOS/iPadOS and Android.
- Local high-score persistence.
- **Original** and **Adapted** display modes.
- Dynamic sky and ground extensions for displays taller than the original aspect ratio.
- Performance mode to limit supersampling on high-DPR devices.
- Visual interpolation to reduce mobile browser `requestAnimationFrame` jitter.
- Supersampled rendering to improve rotated sprites, especially the bird on Retina displays.
- Built-in frame-pacing performance profiler.
- Deterministic replay export for engine comparison.
- Portrait orientation requested by the PWA, with an additional fallback when the browser refuses orientation locking.

---

## Why this project?

Flappy Bird looks extremely simple, but its feel depends on many small implementation details: physics values, integer conversions, update frequency, hitboxes, event ordering, animation timing and pipe generation rules.

Recreating the game by eye quickly produces something that looks like Flappy Bird, but not necessarily **the same game**.

This project therefore follows a different approach:

1. analyse Android version 1.3;
2. document its behaviour;
3. reproduce its rules in a deterministic JavaScript engine;
4. strictly separate the **simulation** from **browser rendering**;
5. adapt only what is necessary for modern displays, PWAs and browser constraints.

---

## Reverse-engineering method

The reconstruction primarily uses:

- the APK `classes.dex`;
- Java reconstructed with **JADX**;
- resources extracted from the APK;
- the texture-atlas description file;
- direct DEX inspection when the Java decompilation is ambiguous;
- JVM/JavaScript tests to verify arithmetic and rounding differences;
- screenshots and runtime profiling on desktop and mobile browsers.

No third-party Flappy Bird implementation was used as the basis of the gameplay engine.

Detailed notes are available in:

- [`docs/REVERSE-ENGINEERING.md`](./docs/REVERSE-ENGINEERING.md)
- [`docs/TESTS.md`](./docs/TESTS.md)

---

## Some parameters recovered from version 1.3

| Item | Ported value |
| --- | ---: |
| Logical resolution | `288 × 512` |
| Texture atlas | `1024 × 1024` |
| Simulation | `60 Hz` |
| Bird hitbox | `20 × 20` |
| Bird sprite | `48 × 48` |
| Flap impulse | `-5 px/tick` |
| Gravity | `+0.3 px/tick²` |
| Maximum falling speed | `+8 px/tick` |
| Pipe speed | `2 px/tick` |
| Pipe gap | `96 px` |
| Horizontal pipe spacing | `157 px` |
| Ground top | `y = 400` |

The engine also preserves several original quirks: tick-based movement, integer conversions at the same stages, the dedicated pseudo-random generator, a non-rotating collision box and the original score-trigger logic.

---

## Architecture

The project is intentionally lightweight.

```text
site/
├── assets/                 Graphics and audio assets
├── icons/                  PWA icons
├── src/
│   ├── atlas.js            Canvas rendering, atlas and interpolation
│   ├── audio.js            Audio handling
│   ├── clock.js            60 Hz simulation clock
│   ├── display.js          Display modes and sizing
│   ├── game.js             Gameplay and state machine
│   ├── main.js             Input, PWA, options and main loop
│   ├── math.js             Math, RNG, animation and tweens
│   └── perf.js             Performance profiler
├── index.html
├── manifest.webmanifest
├── style.css
├── sw.js                   Service Worker / offline cache
└── version.json            Published version / uncached network probe

tests/
├── replay.mjs              Deterministic replay runner
└── …                       Engine, cache and display tests
docs/                       Technical notes and analysis evidence
.github/                     GitHub project automation
CHANGELOG.md                 Version history
README.md                    French documentation
README.en.md                 English documentation
```

The **`site/` directory is self-contained** and is the static root that should be published by an HTTPS host.

No compilation step is required to run the game.

---

## Simulation and rendering

The game logic runs in the original **288 × 512** coordinate space.

The simulation uses a fixed **60 Hz** clock. Browser rendering may however run at a different rate: 60 Hz, 90 Hz, 120 Hz, or occasionally lower on mobile devices.

The project therefore separates:

```text
User input
    ↓
60 Hz simulation
    ↓
Previous state + current state
    ↓
Interpolation
    ↓
requestAnimationFrame
    ↓
Canvas
```

This prevents the physics from changing with the display refresh rate and reduces visible judder when a browser occasionally misses a frame.

### Retina rendering

Sprites remain positioned in the original logical coordinate system, while the Canvas uses a supersampled backing store:

- at least **×2** during normal operation;
- up to **×3** on high-`devicePixelRatio` displays;
- capped at **×2** when Performance mode is enabled.

This adaptation mainly improves rasterisation of rotated sprites, especially the bird, without changing physics or gameplay coordinates.

---

## Display modes

### Adapted

Default on touch devices.

The game keeps its original ratio and geometry while the 288 × 512 scene is vertically centred in the available display. Extra space is extended using matching colours:

- light sky for the day background;
- darker sky for the night background;
- ground below the original scene.

Upper pipes may continue into the added sky when necessary.

### Original

Default on desktop devices.

The original 288 × 512 frame is preserved and centred in the window without altering its composition.

---

## PWA and offline support

A Service Worker caches the application and its resources.

After the initial load has completed, the PWA can run without a network connection as long as the browser has not cleared the site's stored data.

The gameplay itself does not depend on any remote API.

### Installation

**Windows — Edge / Chrome**

Open the site and use the browser's **Install app** option.

**iPhone / iPad — Safari**

Open the site in Safari, then use:

`Share → Add to Home Screen`

Launch the game from the installed icon to use the PWA experience. Depending on the WebKit/iOS version, the system status bar may still remain visible.

**Android — Chrome**

Open the site and use:

`Menu → Install app` or `Add to Home screen`.

> Normal PWA installation requires the site to be served over **HTTPS**, except for development exceptions such as `localhost`.

---

## GitHub Pages deployment

The repository is ready to be published directly with **GitHub Pages**, with no application server or production build step. The [`.github/workflows/pages.yml`](./.github/workflows/pages.yml) workflow:

1. runs the Node test suite;
2. configures GitHub Pages;
3. publishes **only the `site/` directory**;
4. deploys automatically after every push to `main`.

After creating the repository on GitHub, enable this once:

`Settings → Pages → Build and deployment → Source → GitHub Actions`

After that, a simple:

```bash
git push
```

runs the tests and, if they pass, deploys the site over HTTPS. For `ExeDesK/FlappyBird-PWA`, the expected URL is:

```text
https://exedesk.github.io/FlappyBird-PWA/
```

All application paths are relative so the PWA works correctly under the `/FlappyBird-PWA/` project subpath.

### PWA updates

The PWA automatically checks [`site/version.json`](./site/version.json) at launch, when returning to the foreground, when connectivity returns, and periodically. When a new release is published, the new Service Worker and its resources are prepared in the background without interrupting the current run. The update is activated automatically on the next launch, or immediately through **Install now** in the options.

`version.json` deliberately stays outside the Service Worker cache so the check reflects the version currently published on GitHub Pages. Cache installation remains atomic: if any resource from the new build is missing, the currently working version remains active.

---

## Running locally

There is no build step. Serve the `site/` directory with any static HTTP server.

Example with Python 3:

```powershell
py -m http.server 8080 --directory site
```

Then open:

```text
http://localhost:8080/
```

Opening `site/index.html` directly through `file://` is not recommended because Service Workers require a compatible HTTP(S) origin.

---

## Tests and diagnostics

Automated tests cover areas including:

- bird physics;
- Java-compatible conversions and calculations;
- the pseudo-random generator;
- pipes and collisions;
- game-state transitions;
- display sizing and display modes;
- the PWA cache.

Run the Node tests with:

```bash
npm test
```

The **Diagnostics tools**, available from the discreet link at the very bottom of the options screen, can also:

- pause the simulation;
- advance one tick at a time;
- display collision boxes;
- export a replay;
- profile `requestAnimationFrame` for 10 seconds;
- export the resulting performance profile.

---

## Known limitations

Even with a highly accurate simulation, some behaviour remains platform-dependent:

- touch latency;
- Safari / Chromium frame scheduling;
- audio behaviour;
- Canvas rasterisation compared with the original Android OpenGL ES renderer;
- system PWA UI, especially on iOS.

The project aims for a very close behavioural and visual recreation of the analysed version, but does not attempt to reproduce the Android operating environment itself pixel-for-pixel.

---

## Contributing

Contributions are welcome, particularly for:

- browser compatibility;
- reducing measurable differences with version 1.3;
- improving tests and comparison tooling;
- fixing PWA or frame-pacing issues.

Gameplay changes should ideally be backed by evidence from the analysed 1.3 version or by a reproducible test. The goal is to avoid subjective tweaks that would move the engine away from its reference behaviour.

---

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md).

---

## Unofficial project and credits

This is an **unofficial** project and is not affiliated with or endorsed by **.GEARS Studios**.

It is based on the study of the Android **1.3** version of Flappy Bird provided to the project, with the goal of reproducing its behaviour in a modern PWA.

**Flappy Bird**, its visual identity, graphics, sounds and other material originating from the original game remain the property of their respective rights holders. All credits relating to the original game belong to **.GEARS Studios** and its creators.

This repository does not claim to grant any rights to the original assets. Anyone publishing or redistributing a fork containing those assets is responsible for verifying the applicable rights.
