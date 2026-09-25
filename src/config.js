// Single source of truth for the finger-to-band mapping and look of each band.
//
// MediaPipe hand landmark indices:
//   0 wrist, 4 thumb tip, 8 index tip, 12 middle tip, 16 ring tip, 20 pinky tip
export const LANDMARK = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
};

// Each band is a quad stretched between the two hands:
//   top edge    = landmark `top` on hand 0  <->  landmark `top` on hand 1
//   bottom edge = landmark `bottom` on hand 0 <-> landmark `bottom` on hand 1
// `shader` selects the fragment shader in src/shaders/, `uniforms` are extra
// shader uniforms for that look.
export const BANDS = [
  {
    id: 'A',
    top: LANDMARK.INDEX_TIP,
    bottom: LANDMARK.MIDDLE_TIP,
    shader: 'threshold',
    uniforms: {
      colorDark: '#1d4f91',
      colorLight: '#f4efe4',
      threshold: 0.5,
      grain: 0.35,
    },
  },
  {
    id: 'B',
    top: LANDMARK.MIDDLE_TIP,
    bottom: LANDMARK.RING_TIP,
    shader: 'posterize',
    uniforms: {
      colorDark: '#1f6b2e',
      colorMid: '#e8d63a',
      colorLight: '#f4efe4',
      rgbSplit: 0.006,
    },
  },
  {
    id: 'C',
    top: LANDMARK.RING_TIP,
    bottom: LANDMARK.THUMB_TIP,
    shader: 'halftone',
    uniforms: {
      colorDot: '#d8322a',
      colorPaper: '#ffffff',
      dotScale: 90.0,
    },
  },
];

// Thin white separator drawn along the shared edge between adjacent bands,
// in normalized screen units (fraction of viewport height).
export const EDGE = {
  color: '#ffffff',
  thickness: 0.006,
};

export const TRACKING = {
  numHands: 2,
  // 0 = no smoothing, 1 = frozen. Applied per-landmark each frame.
  smoothing: 0.65,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  // Served from node_modules by the plugin in vite.config.js; CDN is the fallback.
  wasmBase: '/mediapipe/wasm',
  wasmBaseFallback: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
  modelAssetPath:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
};

export const CAMERA = {
  width: 1280,
  height: 720,
  mirrored: true,
};
