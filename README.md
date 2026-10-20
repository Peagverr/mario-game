# Okno

A 3D browser game you play with a webcam. Move your head to look into the world, use your hands to walk, jump and turn it. No keyboard, mouse or controller. "Okno" means "window" in Russian.

Play: https://mariogame-gilt.vercel.app

Code: https://github.com/Peagverr/mario-game

You need Chrome or Edge, a webcam and light on your face. Sit in front of the camera and click the start button. That is the only click, after it the game reads your head and hands. The video is processed in the browser and is not sent anywhere.

Team null pointers. Russian version of this file: [README.ru.md](README.ru.md).

## Controls

| Gesture | What it does |
|---|---|
| Right palm, low on the right | A joystick circle sits in the bottom right corner of the screen. Put the red dot (your palm) into the yellow centre and the hero stands still |
| Move the palm out of the centre | The hero walks that way |
| Right fist | Jump |
| Left fist, then move the hand | Rotate and tilt the world in any direction. Move the fist past the circle and the world keeps turning by itself. Fist towards or away from the camera zooms in or out |
| Move your head | The screen works like a window: look around the hero or down from above |
| Two open palms | Menu. The game and the timer pause |

A short tutorial runs first, you can skip it. The voice of Okno explains each gesture and says what to fix.

## Levels

1. Lobby: portals to the levels. The tutorial runs here.
2. Islands: walking and jumping.
3. Peek: stars hide in yards behind walls. Raise your head to look over a wall, or pull the world down with the left fist.
4. Turn the World: a bridge comes together from floating planks only at the right angle.

## Error mode

When a gesture is almost right, the game says what to fix, for example "To jump, make a full fist. Not bent: ring, little", and the camera window marks those fingers. A hint shows up only if the problem lasts longer than its threshold (0 to 1.2 s, set per hint), the screen shows one hint at a time, and the same hint stays away for 8 s after it goes. After each level the results screen lists the mistakes with a tip for each one.

## How it works

- Every camera frame goes to three MediaPipe Tasks Vision models running in the browser (WebAssembly, GPU with CPU fallback): Gesture Recognizer (21 points per hand, up to 2 hands), Face Landmarker (478 points) and Pose Landmarker lite. Code: `src/input/tracker.ts`.
- Gestures are our own rules on the 3D hand points. Each finger is rated extended, half or curled by how far it bends, and fist, open palm and pointing are built from that (`src/input/gestures.ts`). The palm joystick and the left-fist grab are in `src/input/palmJoystick.ts` and `src/input/worldGrab.ts`.
- MediaPipe often swaps the left and right label on a fist. We decide the side when a hand appears (body pose, memory, MediaPipe label, position relative to the face) and then follow the hand by its continuous motion (`src/input/handIdentity.ts`).
- A One Euro filter (Casiez et al., 2012) removes jitter (`src/input/oneEuro.ts`).
- The window effect is head-coupled perspective, as in Johnny Lee's 2007 demo. The head position relative to the screen sets an off-axis projection matrix (`src/game/WindowCamera.tsx`, `src/game/windowParams.ts`).
- Hints: `src/input/errors.ts`. Voice lines: `src/game/voiceLines.json`, audio files in `public/voice`.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome. `npm install` also copies the MediaPipe wasm files into `public/mediapipe/wasm` (`scripts/copy-mediapipe-wasm.mjs`). The three model files (about 18 MB) download from Google storage on the first start.

Tests, type check and production build:

```bash
npm test
npm run typecheck
npm run build
```

`npm test` runs 151 Vitest tests. Add `?debug` to the URL to see tracking numbers under the camera window.

## Stack

TypeScript, React 19, Three.js, React Three Fiber, Rapier, MediaPipe Tasks Vision, Zustand, Vite, Vitest. The world was modelled and rendered in Blender, the voice was generated with ElevenLabs.

## Assets and libraries

- Textures and models from [Poly Haven](https://polyhaven.com), CC0: rock_surface, stone_brick_wall_001, aerial_rocks_02, forest_leaves_02, weathered_planks, wooden_lantern_01. The sky qwantani_dusk_2_puresky was used only for rendering in Blender.
- The hero, lobby, towers and sky panoramas were built and rendered by us in [Blender](https://www.blender.org). The scene is `art/lobby.blend`, the panoramas come from `art/pano_tools.py`.
- Hand, face and pose tracking: [MediaPipe](https://ai.google.dev/edge/mediapipe) (Apache 2.0).
- 3D and physics: [Three.js](https://threejs.org) and [React Three Fiber](https://r3f.docs.pmnd.rs) (MIT), [Rapier](https://rapier.rs) (Apache 2.0).
- Voice: [ElevenLabs](https://elevenlabs.io).

## Built during the event

The first commit is [e0d1073](https://github.com/Peagverr/mario-game/commit/e0d1073), 28 Sep 2026, 22:34 (UTC+5). We built Okno for Admit Hackathon 2026 (case Motion, started 28 Sep 2026, final on 4 Oct 2026) and made the English version for EurekaDev 2026.

## Limitations

- Chrome or Edge, a webcam and light on the face are required.
- The window effect is correct for one viewer.
- The deployed build has no keyboard mode. Without a webcam the game cannot be played.
