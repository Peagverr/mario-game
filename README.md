# Window

A 3D browser game you play with a webcam and nothing else. Your head moves the view, so the laptop screen works like a window into a small floating world. The right hand walks and jumps, the left one turns the world.

Play: https://mariogame-gilt.vercel.app

Code: https://github.com/Peagverr/mario-game

You need a webcam and Chrome or Edge. Light should fall on your face. Click "Turn on camera and play": it is the only click in the game, after it you play with your head and hands. The video is processed in the browser and is not sent anywhere.

The game opens in English. To switch to Russian, press RU on the start screen or open the link with `?lang=ru`; the pause menu has the same switch. In Russian the game is called "Окно" (Okno), which means "window".

Team null pointers. Russian version of this file: [README.ru.md](README.ru.md).

## Controls

| Gesture | What it does |
|---|---|
| Right palm, low on the right | A joystick circle sits in the bottom right corner of the screen. Put the red dot (your palm) into the yellow center and the hero stands still |
| Move the palm out of the center | The hero walks that way |
| Right fist | Jump |
| Left fist, then move the hand | Rotate and tilt the world in any direction. Take the fist past the teal circle and the world keeps turning by itself. Move the fist toward or away from the camera to zoom |
| Move your head | Look around the hero or down from above, as through a window |
| Two open palms | Menu. The game and the timer pause |

A short tutorial runs first, and you can skip it. The voice of Window explains each gesture and says what to fix.

## Levels

1. Lobby: portals to the levels. The tutorial runs here.
2. Islands: walking and jumping.
3. Peek: stars hide in yards behind walls. Raise your head to look over a wall, or pull the world down with the left fist.
4. Turn the World: a bridge comes together from floating planks only at the right angle.

## Error mode

When a gesture is almost right, the game says what to fix, for example "To jump, close your fist all the way. Not bent: ring, pinky". The camera window marks those fingers in red. A hint appears only after the problem has lasted past its threshold, which is set per hint between 0 and 1.2 s. The screen shows one hint at a time. Once a hint goes away, it stays away for 8 s. After each level the results screen lists your mistakes with a tip for each one.

## How it works

- Every camera frame goes to three MediaPipe Tasks Vision models running in the browser (WebAssembly, GPU with CPU fallback): Gesture Recognizer (21 points per hand, up to 2 hands), Face Landmarker (478 points) and Pose Landmarker lite. Code: `src/input/tracker.ts`.
- Gestures are our own rules on the 3D hand points. Each finger is rated extended, half or curled by how far it bends, and fist, open palm and pointing are built from that (`src/input/gestures.ts`). The palm joystick and the left-fist grab are in `src/input/palmJoystick.ts` and `src/input/worldGrab.ts`.
- MediaPipe often swaps the left and right label on a fist. We decide the side when a hand appears (body pose, memory, MediaPipe label, position relative to the face) and then follow the hand by its continuous motion (`src/input/handIdentity.ts`).
- A One Euro filter (Casiez et al., 2012) removes jitter (`src/input/oneEuro.ts`).
- The window effect is head-coupled perspective, as in Johnny Lee's 2007 demo. The head position relative to the screen sets an off-axis projection matrix (`src/game/WindowCamera.tsx`, `src/game/windowParams.ts`).
- Hints: `src/input/errors.ts`.
- All on-screen text is in `src/i18n.ts`: an English and a Russian dictionary with the same keys. If a string is missing in one language, the type check fails.

## Voice

The game has 45 voice lines, their texts in both languages are in `src/game/voiceLines.json`. The Russian audio (`public/voice`) was made with ElevenLabs. The English audio (`public/voice/en`) was generated on our laptop with the open model [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) through [kokoro-js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js), voice `af_bella`. No API key or account is needed for that.

To generate the English files again you need ffmpeg (on Windows: `winget install Gyan.FFmpeg`):

```bash
npm --prefix tools/voice-en install
npm run voice:en
npm run voice:en:check
```

The last command transcribes every English file with Whisper (`Xenova/whisper-small.en`) and compares the words with the text. For the current files all 45 lines match.

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

`npm test` runs 155 Vitest tests. Add `?debug` to the URL to see tracking numbers under the camera window.

## Stack

TypeScript, React 19, Three.js, React Three Fiber, Rapier, MediaPipe Tasks Vision, Zustand, Vite, Vitest. The world was modelled and rendered in Blender.

## Assets and libraries

- Textures and models from [Poly Haven](https://polyhaven.com), CC0: rock_surface, stone_brick_wall_001, aerial_rocks_02, forest_leaves_02, weathered_planks, wooden_lantern_01. The sky qwantani_dusk_2_puresky was used only for rendering in Blender.
- The hero, lobby, towers and sky panoramas were built and rendered by us in [Blender](https://www.blender.org). The scene is `art/lobby.blend`, the panoramas come from `art/pano_tools.py`.
- Hand, face and pose tracking: [MediaPipe](https://ai.google.dev/edge/mediapipe) (Apache 2.0).
- 3D and physics: [Three.js](https://threejs.org) and [React Three Fiber](https://r3f.docs.pmnd.rs) (MIT), [Rapier](https://rapier.rs) (Apache 2.0).
- Russian voice: [ElevenLabs](https://elevenlabs.io). English voice: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad (Apache 2.0).

## Built during the event

The first commit is [e0d1073](https://github.com/Peagverr/mario-game/commit/e0d1073), 28 Sep 2026, 22:34 (UTC+5). We built the game under the name Okno for Admit Hackathon 2026 (case Motion, started 28 Sep 2026, final on 4 Oct 2026). The English version, Window, was made for EurekaDev 2026.

## Limitations

- A webcam is required, and the face needs light.
- The window effect is correct for one viewer.
- The deployed build has no keyboard mode. Without a webcam the game cannot be played.
