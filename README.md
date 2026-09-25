# three-color-gesture

Hand-tracked camera art piece: hold up both hands and three stylized bands of the
live webcam feed stretch between your fingertips.

- Vite + vanilla JS + Three.js
- MediaPipe Tasks Vision `HandLandmarker` (two hands, lerp-smoothed)
- Each band is a perspective-textured quad driven by a fingertip pair on each hand

```sh
npm install
npm run dev
```

Open the printed URL in a browser, allow camera access, and show both hands.
The bands appear only while two hands are visible.

## Bands

Configured in `src/config.js` (`BANDS`): each entry names the top/bottom landmark
pair, the fragment shader in `src/shaders/`, and its colours.

| Band | Finger pair            | Look                                   |
| ---- | ---------------------- | -------------------------------------- |
| A    | pinky → middle tips    | blue / cream threshold + grainy dither |
| B    | middle → index tips    | green / yellow / cream posterize + RGB split |
| C    | index → thumb tips     | red dot halftone on white              |
