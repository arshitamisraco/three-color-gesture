import * as THREE from 'three';
import { createHandTracker } from './handTracking.js';
import { createPanels } from './panels.js';
import { BANDS, EDGE, PANEL, TRACKING, CAMERA } from './config.js';

// ---------------------------------------------------------------------------
// Coordinate convention used across the app:
//   "screen space"  = normalized viewport coords, x∈[0,1] left→right,
//                     y∈[0,1] top→bottom (so it matches DOM / video pixels).
//   "video space"   = MediaPipe's normalized coords in the *raw* (unmirrored)
//                     video frame, same orientation.
// The orthographic camera below maps screen space 1:1 onto the viewport.
// ---------------------------------------------------------------------------

const statusEl = document.getElementById('status');
const video = document.getElementById('video');
const app = document.getElementById('app');

const setStatus = (msg) => {
  statusEl.textContent = msg;
  statusEl.classList.toggle('hidden', !msg);
};

// --- Three.js setup ---------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// left=0, right=1, top=0, bottom=1 → y grows downward. Winding flips, so
// every material in this app should use THREE.DoubleSide.
const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);

const videoTexture = new THREE.VideoTexture(video);
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;
videoTexture.generateMipmaps = false;
// Keep raw sRGB values: all shaders in this app treat colours as display-ready.
videoTexture.colorSpace = THREE.NoColorSpace;

// --- "Cover" fit of the video into the viewport ------------------------------
// cover = { sx, sy, ox, oy } such that videoUV = screen * s + o (per axis).
const cover = { sx: 1, sy: 1, ox: 0, oy: 0 };

function updateCover() {
  const vw = video.videoWidth || CAMERA.width;
  const vh = video.videoHeight || CAMERA.height;
  const videoAspect = vw / vh;
  const screenAspect = window.innerWidth / window.innerHeight;
  if (screenAspect > videoAspect) {
    // viewport wider than video → crop top/bottom
    cover.sx = 1; cover.ox = 0;
    cover.sy = videoAspect / screenAspect;
    cover.oy = (1 - cover.sy) / 2;
  } else {
    cover.sy = 1; cover.oy = 0;
    cover.sx = screenAspect / videoAspect;
    cover.ox = (1 - cover.sx) / 2;
  }
}

/** video-space normalized point → screen-space normalized point (mirrored). */
function videoToScreen(p) {
  let x = (p.x - cover.ox) / cover.sx;
  const y = (p.y - cover.oy) / cover.sy;
  if (CAMERA.mirrored) x = 1 - x;
  return { x, y, z: p.z ?? 0 };
}

// --- Background: full-screen mirrored video ---------------------------------
const bgMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uVideo: { value: videoTexture },
    uScale: { value: new THREE.Vector2(1, 1) },
    uOffset: { value: new THREE.Vector2(0, 0) },
    uMirror: { value: CAMERA.mirrored ? 1 : 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uVideo;
    uniform vec2 uScale;
    uniform vec2 uOffset;
    uniform float uMirror;
    varying vec2 vUv;
    void main() {
      // The camera is y-flipped (top=0, bottom=1), so the plane's local +y
      // already lands at the screen bottom: vUv *is* screen space (y down).
      vec2 screen = vUv;
      if (uMirror > 0.5) screen.x = 1.0 - screen.x;
      vec2 vid = screen * uScale + uOffset;
      // Texture space has y up, video space has y down.
      gl_FragColor = texture2D(uVideo, vec2(vid.x, 1.0 - vid.y));
    }
  `,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMaterial);
bgMesh.position.set(0.5, 0.5, -5);
bgMesh.renderOrder = -1;
scene.add(bgMesh);

// --- Panels -----------------------------------------------------------------
const panels = createPanels({
  scene,
  videoTexture,
  bands: BANDS,
  edge: EDGE,
  mode: PANEL.mode,
});

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateCover();
  bgMaterial.uniforms.uScale.value.set(cover.sx, cover.sy);
  bgMaterial.uniforms.uOffset.value.set(cover.ox, cover.oy);
  panels.resize(window.innerWidth, window.innerHeight);
  panels.setView({ cover, mirrored: CAMERA.mirrored });
}
window.addEventListener('resize', onResize);

// --- Webcam -----------------------------------------------------------------
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: CAMERA.width },
      height: { ideal: CAMERA.height },
      facingMode: 'user',
    },
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadeddata = () => resolve();
  });
  await video.play();
}

// --- Debug: synthetic hands (open with ?fakehands to test without a webcam) ---
const FAKE_HANDS = new URLSearchParams(location.search).has('fakehands');

function fakeHands(t) {
  // Two hands in video space; fingertips fan out vertically, gently swaying.
  const mk = (cx, phase) => {
    const lm = Array.from({ length: 21 }, () => ({ x: cx, y: 0.5, z: 0 }));
    const sway = Math.sin(t * 0.8 + phase) * 0.04;
    lm[20] = { x: cx + sway, y: 0.18, z: 0 }; // pinky tip
    lm[16] = { x: cx - sway, y: 0.30, z: 0 }; // ring tip
    lm[12] = { x: cx - sway, y: 0.40, z: 0 }; // middle tip
    lm[8]  = { x: cx + sway, y: 0.56, z: 0 }; // index tip
    lm[4]  = { x: cx - sway * 1.5, y: 0.80, z: 0 }; // thumb tip
    return lm;
  };
  return [mk(0.22, 0), mk(0.78, 1.7)];
}

// --- Main loop --------------------------------------------------------------
let tracker = null;
const clock = new THREE.Timer();

function frame() {
  requestAnimationFrame(frame);
  const t = (clock.update(), clock.getElapsed());

  let screenHands = null;
  if (FAKE_HANDS || (tracker && video.readyState >= 2)) {
    const hands = FAKE_HANDS ? fakeHands(t) : tracker.update(performance.now());
    if (hands && hands.length >= 2) {
      // Convert to screen space and order left→right on screen so band corner
      // assignment is stable.
      const converted = hands.slice(0, 2).map((lm) => lm.map(videoToScreen));
      converted.sort((a, b) => meanX(a) - meanX(b));
      screenHands = converted;
    }
  }

  panels.update(screenHands, t);
  renderer.render(scene, camera);
}

function meanX(lm) {
  let s = 0;
  for (const p of lm) s += p.x;
  return s / lm.length;
}

async function main() {
  try {
    setStatus('Starting camera…');
    try {
      await startCamera();
    } catch (err) {
      if (!FAKE_HANDS) throw err;
      console.warn('Camera unavailable, continuing with synthetic hands:', err);
    }
    onResize();

    if (FAKE_HANDS) {
      setStatus('Debug: synthetic hands');
      window.__app = { panels, renderer, scene };
      return;
    }
    setStatus('Loading hand model…');
    tracker = createHandTracker({ video, config: TRACKING });
    await tracker.init();

    setStatus('Show both hands to the camera');
    setTimeout(() => setStatus(''), 4000);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message || err}`);
  }
}

frame();
main();
