// Single source of truth for the finger-to-band mapping and look of each band.
//
// ---------------------------------------------------------------------------
// TUNING — the knobs you'll most likely want to play with. Any of these can
// also be overridden from the URL while the app is running, e.g.
//   http://localhost:5173/?threshold=0.3&grain=0.5&dotScale=70
// ---------------------------------------------------------------------------
export const TUNING = withUrlOverrides({
  // Band A (blue/cream): luminance cut between dark and light, 0..1.
  // Lower = more of the frame goes cream; higher = more goes blue.
  threshold: 0.35,
  // Band A: grain/dither strength around that cut, 0..1.
  grain: 0.35,
  // Band B: RGB-split fringe width in UV units.
  rgbSplit: 0.006,
  // Band C: halftone dots across the viewport height.
  dotScale: 90,
  // Landmark smoothing, 0..1, applied every render frame. 0 = raw and
  // twitchy, 0.9 = very floaty. Around 0.85 hides most tracking jitter.
  smoothing: 0.85,
  // How many detection frames a hand may go missing before the panels hide.
  // Higher = fewer flickers when tracking briefly drops, but more lag on exit.
  holdFrames: 12,
  // Show thin white lines at the band boundaries.
  edges: false,
  // 'window'    = each band stylizes only the video directly behind it.
  // 'projected' = the whole camera frame is squashed into each band.
  panelMode: 'window',
});

function withUrlOverrides(obj) {
  if (typeof location === 'undefined') return obj;
  const params = new URLSearchParams(location.search);
  for (const key of Object.keys(obj)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    const cur = obj[key];
    obj[key] = typeof cur === 'number' ? Number(raw)
      : typeof cur === 'boolean' ? raw !== 'false' && raw !== '0'
      : raw;
  }
  return obj;
}

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
    top: LANDMARK.PINKY_TIP,
    bottom: LANDMARK.MIDDLE_TIP,
    shader: 'threshold',
    uniforms: {
      colorDark: '#1d4f91',
      colorLight: '#f4efe4',
      threshold: TUNING.threshold,
      grain: TUNING.grain,
    },
  },
  {
    id: 'B',
    top: LANDMARK.MIDDLE_TIP,
    bottom: LANDMARK.INDEX_TIP,
    shader: 'posterize',
    uniforms: {
      colorDark: '#1f6b2e',
      colorMid: '#e8d63a',
      colorLight: '#f4efe4',
      rgbSplit: TUNING.rgbSplit,
    },
  },
  {
    id: 'C',
    top: LANDMARK.INDEX_TIP,
    bottom: LANDMARK.THUMB_TIP,
    shader: 'halftone',
    uniforms: {
      colorDot: '#d8322a',
      colorPaper: '#ffffff',
      dotScale: TUNING.dotScale,
    },
  },
];

// Thin white separator drawn along the shared edge between adjacent bands,
// in normalized screen units (fraction of viewport height).
export const EDGE = {
  enabled: TUNING.edges,
  color: '#ffffff',
  thickness: 0.006,
};

export const PANEL = {
  mode: TUNING.panelMode,
};

export const TRACKING = {
  numHands: 2,
  // 0 = no smoothing, 1 = frozen. Applied per-landmark every render frame.
  smoothing: TUNING.smoothing,
  holdFrames: TUNING.holdFrames,
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
