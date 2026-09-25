// Wraps @mediapipe/tasks-vision HandLandmarker into a simple polling API:
// `init()` loads the model, `update(nowMs)` runs detection at most once per
// new video frame and returns smoothed, identity-stable hand landmarks.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const lerp = (a, b, t) => a + (b - a) * t;

// Exponential smoothing of one hand's 21 landmarks toward a new raw reading.
function smoothLandmarks(prev, raw, t) {
  return raw.map((p, i) => ({
    x: lerp(prev[i].x, p.x, t),
    y: lerp(prev[i].y, p.y, t),
    z: lerp(prev[i].z, p.z, t),
  }));
}

// Squared distance between two hands' wrist landmarks (index 0).
function wristDist(a, b) {
  const dx = a[0].x - b[0].x;
  const dy = a[0].y - b[0].y;
  const dz = (a[0].z ?? 0) - (b[0].z ?? 0);
  return dx * dx + dy * dy + dz * dz;
}

export function createHandTracker({ video, config }) {
  const holdFrames = config.holdFrames ?? 3;
  let landmarker = null;
  let lastTimestamp = -1; // last timestamp fed to detectForVideo (must strictly increase)
  let lastVideoTime = -1; // video.currentTime we last ran detection on
  let warned = false;
  let result = []; // last returned (smoothed) hands, cached between calls

  // Fixed-size slots (config.numHands) tracking identity across frames.
  // Each slot is null (empty) or { landmarks, missing } where `missing` is
  // the number of consecutive frames since it was last actually detected.
  let slots = new Array(config.numHands).fill(null);

  async function init() {
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(config.wasmBase);
    } catch (err) {
      if (!config.wasmBaseFallback) throw err;
      console.warn('Local WASM unavailable, falling back to CDN:', err);
      vision = await FilesetResolver.forVisionTasks(config.wasmBaseFallback);
    }
    const options = {
      baseOptions: { modelAssetPath: config.modelAssetPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: config.numHands,
      minHandDetectionConfidence: config.minHandDetectionConfidence,
      minHandPresenceConfidence: config.minHandPresenceConfidence,
      minTrackingConfidence: config.minTrackingConfidence,
    };
    try {
      landmarker = await HandLandmarker.createFromOptions(vision, options);
    } catch {
      // GPU delegate unavailable in this browser/context — fall back to CPU.
      options.baseOptions.delegate = 'CPU';
      landmarker = await HandLandmarker.createFromOptions(vision, options);
    }
  }

  // Match freshly detected hands to existing slots by nearest wrist, then
  // fold in smoothing / hold-over. Mutates `slots`.
  function assignSlots(rawHands) {
    const n = slots.length;
    const usedRaw = new Array(rawHands.length).fill(false);
    const matchedRaw = new Array(n).fill(-1); // slot index -> raw index, or -1
    const activeSlots = [];
    for (let i = 0; i < n; i++) if (slots[i]) activeSlots.push(i);

    if (n === 2 && rawHands.length === 2 && activeSlots.length === 2) {
      // Simple case called out by spec: compare identity vs swapped cost.
      const [s0, s1] = [slots[0].landmarks, slots[1].landmarks];
      const costIdentity = wristDist(s0, rawHands[0]) + wristDist(s1, rawHands[1]);
      const costSwap = wristDist(s0, rawHands[1]) + wristDist(s1, rawHands[0]);
      if (costSwap < costIdentity) {
        matchedRaw[0] = 1;
        matchedRaw[1] = 0;
      } else {
        matchedRaw[0] = 0;
        matchedRaw[1] = 1;
      }
      usedRaw[0] = usedRaw[1] = true;
    } else {
      // General case: greedy nearest-neighbor matching, active slots first.
      for (const si of activeSlots) {
        let best = -1;
        let bestDist = Infinity;
        for (let ri = 0; ri < rawHands.length; ri++) {
          if (usedRaw[ri]) continue;
          const d = wristDist(slots[si].landmarks, rawHands[ri]);
          if (d < bestDist) {
            bestDist = d;
            best = ri;
          }
        }
        if (best >= 0) {
          matchedRaw[si] = best;
          usedRaw[best] = true;
        }
      }
    }

    // Drop any leftover raw hands into empty slots first, then any slot that
    // didn't get matched above (e.g. still being held over).
    for (let ri = 0; ri < rawHands.length; ri++) {
      if (usedRaw[ri]) continue;
      let slotIdx = slots.findIndex((s, i) => matchedRaw[i] === -1 && !s);
      if (slotIdx === -1) slotIdx = matchedRaw.findIndex((m) => m === -1);
      if (slotIdx === -1) continue; // no room (shouldn't happen: numHands caps rawHands)
      matchedRaw[slotIdx] = ri;
      usedRaw[ri] = true;
    }

    const nextSlots = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const ri = matchedRaw[i];
      if (ri === -1) {
        // Not seen this frame: hold over briefly to avoid flicker, else drop.
        if (slots[i] && slots[i].missing < holdFrames) {
          nextSlots[i] = { landmarks: slots[i].landmarks, missing: slots[i].missing + 1 };
        } else {
          nextSlots[i] = null;
        }
        continue;
      }
      const raw = rawHands[ri];
      const landmarks = slots[i]
        ? smoothLandmarks(slots[i].landmarks, raw, 1 - config.smoothing)
        : raw; // first sighting of this slot: snap directly, no lerp
      nextSlots[i] = { landmarks, missing: 0 };
    }
    slots = nextSlots;
  }

  function update(nowMs) {
    if (!landmarker) return result;
    // Avoid re-running detection on the same video frame.
    if (video.currentTime === lastVideoTime) return result;
    lastVideoTime = video.currentTime;

    // MediaPipe requires strictly increasing timestamps per call.
    const ts = Math.max(nowMs, lastTimestamp + 1);
    lastTimestamp = ts;

    let detection;
    try {
      detection = landmarker.detectForVideo(video, ts);
    } catch (err) {
      if (!warned) {
        console.warn('HandLandmarker.detectForVideo failed:', err);
        warned = true;
      }
      return result;
    }

    const rawHands = (detection.landmarks || []).map((lm) =>
      lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    );
    assignSlots(rawHands);
    result = slots.filter(Boolean).map((s) => s.landmarks);
    return result;
  }

  function destroy() {
    landmarker?.close();
    landmarker = null;
  }

  return { init, update, destroy };
}
