import * as THREE from 'three';
import thresholdFrag from './shaders/threshold.frag?raw';
import posterizeFrag from './shaders/posterize.frag?raw';
import halftoneFrag from './shaders/halftone.frag?raw';

const SHADERS = {
  threshold: thresholdFrag,
  posterize: posterizeFrag,
  halftone: halftoneFrag,
};

// Shared vertex shader for every band material. `uvq` carries the
// perspective-corrected texture coordinates (see buildQuadUvq below); the
// fragment shader divides vUvq.xy by vUvq.z to undo the projective warp.
const VERTEX_SHADER = /* glsl */ `
  attribute vec3 uvq;
  varying vec3 vUvq;
  void main() {
    vUvq = uvq;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EPS = 1e-6;

/**
 * Convert a config uniform key (e.g. "colorDark") to its GLSL uniform name
 * (e.g. "uColorDark").
 */
function uniformName(key) {
  return 'u' + key[0].toUpperCase() + key.slice(1);
}

/**
 * Intersection of the two diagonals of a (possibly non-planar-in-2D, but
 * here always 2D) quad P0-P1-P2-P3, using the standard two-line intersection
 * formula. Returns null if the diagonals are parallel (degenerate quad).
 */
function diagonalIntersection(p0, p2, p1, p3) {
  const x1 = p0.x, y1 = p0.y, x2 = p2.x, y2 = p2.y;
  const x3 = p1.x, y3 = p1.y, x4 = p3.x, y4 = p3.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < EPS) return null;
  const a = x1 * y2 - y1 * x2;
  const b = x3 * y4 - y3 * x4;
  const px = (a * (x3 - x4) - (x1 - x2) * b) / denom;
  const py = (a * (y3 - y4) - (y1 - y2) * b) / denom;
  return { x: px, y: py };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Compute the per-corner uvq attribute (perspective-correct UVs) for a
 * convex quad with corners corners[0..3] (TL, TR, BR, BL) and matching base
 * (u, v) texture coordinates baseUv[0..3].
 *
 * Standard "uvq" trick: for each corner i, find the intersection C of the
 * two diagonals, then weight q_i = (d_i + d_opposite) / d_opposite, where
 * d_i = |corner_i - C| and d_opposite is the same distance for the corner
 * across the quad (i+2 mod 4). Interpolating (u*q, v*q, q) linearly across
 * the two triangles and dividing u*q/q, v*q/q in the fragment shader
 * reproduces the true projective mapping of a quad, avoiding the
 * "tearing"/warping you get from plain affine-interpolated UVs.
 */
function computeQ(corners) {
  const c = diagonalIntersection(corners[0], corners[2], corners[1], corners[3]);
  const q = [1, 1, 1, 1];
  if (!c) return q;
  const d = [dist(corners[0], c), dist(corners[1], c), dist(corners[2], c), dist(corners[3], c)];
  if (d[0] < EPS || d[1] < EPS || d[2] < EPS || d[3] < EPS) return q;
  q[0] = (d[0] + d[2]) / d[2];
  q[1] = (d[1] + d[3]) / d[3];
  q[2] = (d[2] + d[0]) / d[0];
  q[3] = (d[3] + d[1]) / d[1];
  return q;
}

function makeQuadGeometry() {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  const uvq = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
  uvq.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('uvq', uvq);
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function setQuadPositions(geometry, corners) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < 4; i++) {
    pos.setXYZ(i, corners[i].x, corners[i].y, 0);
  }
  pos.needsUpdate = true;
}

function setQuadUvq(geometry, baseUv, q) {
  const attr = geometry.attributes.uvq;
  for (let i = 0; i < 4; i++) {
    attr.setXYZ(i, baseUv[i][0] * q[i], baseUv[i][1] * q[i], q[i]);
  }
  attr.needsUpdate = true;
}

function buildBandMaterial(band, videoTexture) {
  const fragmentShader = SHADERS[band.shader];
  const uniforms = {
    uVideo: { value: videoTexture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
  };
  const extra = band.uniforms || {};
  for (const key of Object.keys(extra)) {
    const value = extra[key];
    const name = uniformName(key);
    if (typeof value === 'string' && value.startsWith('#')) {
      uniforms[name] = { value: new THREE.Color(value) };
    } else {
      uniforms[name] = { value };
    }
  }
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: false,
  });
}

/** Mirrored (u flipped) base UVs, texture-space y-up, per corner [TL, TR, BR, BL]. */
function bandBaseUv(uvRect) {
  const { x, y, w, h } = uvRect;
  return [
    [x + w, y + h], // top-left    -> mirrored u=1,v=1 (scaled to rect)
    [x, y + h],     // top-right   -> mirrored u=0,v=1
    [x, y],         // bottom-right-> mirrored u=0,v=0
    [x + w, y],     // bottom-left -> mirrored u=1,v=0
  ];
}

export function createPanels({ scene, videoTexture, bands, edge }) {
  let aspect = 1;

  // --- Band quads ------------------------------------------------------
  const bandMeshes = bands.map((band, i) => {
    const geometry = makeQuadGeometry();
    const material = buildBandMaterial(band, videoTexture);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = i;
    mesh.visible = false;
    mesh.frustumCulled = false;
    const uvRect = band.uvRect || { x: 0, y: 0, w: 1, h: 1 };
    mesh.userData.baseUv = bandBaseUv(uvRect);
    mesh.userData.band = band;
    scene.add(mesh);
    return mesh;
  });

  // --- Edge separator lines --------------------------------------------
  // One edge per boundary: the outer top of band 0, every shared boundary
  // between adjacent bands, and the outer bottom of the last band.
  const edgeLandmarks = [bands[0].top, ...bands.map((b) => b.bottom)];
  const edgeMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(edge.color),
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const edgeMeshes = edgeLandmarks.map(() => {
    const geometry = makeQuadGeometry();
    // Edges don't need texturing; drop the unused uvq attribute so the
    // basic material doesn't try to use it as UVs (it just ignores extra
    // attributes, but keep geometry minimal/clear).
    const mesh = new THREE.Mesh(geometry, edgeMaterial);
    mesh.renderOrder = 10;
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  });

  function updateBand(mesh, h0, h1) {
    const band = mesh.userData.band;
    const corners = [h0[band.top], h1[band.top], h1[band.bottom], h0[band.bottom]];
    setQuadPositions(mesh.geometry, corners);
    const q = computeQ(corners);
    setQuadUvq(mesh.geometry, mesh.userData.baseUv, q);
  }

  function updateEdge(mesh, landmark, h0, h1) {
    const a = h0[landmark];
    const b = h1[landmark];
    // Work in aspect-corrected ("square") space so the line has uniform
    // thickness in actual screen pixels regardless of viewport aspect.
    const ax = a.x * aspect, ay = a.y;
    const bx = b.x * aspect, by = b.y;
    let dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    let nx, ny;
    if (len < EPS) {
      nx = 0; ny = 1;
    } else {
      nx = -dy / len;
      ny = dx / len;
    }
    const half = edge.thickness / 2;
    const offX = (nx * half) / aspect;
    const offY = ny * half;
    const corners = [
      { x: a.x + offX, y: a.y + offY }, // TL-ish
      { x: b.x + offX, y: b.y + offY }, // TR-ish
      { x: b.x - offX, y: b.y - offY }, // BR-ish
      { x: a.x - offX, y: a.y - offY }, // BL-ish
    ];
    setQuadPositions(mesh.geometry, corners);
  }

  function update(screenHands, t) {
    for (const mesh of bandMeshes) {
      mesh.material.uniforms.uTime.value = t;
    }

    const visible = Array.isArray(screenHands) && screenHands.length >= 2;
    for (const mesh of bandMeshes) mesh.visible = visible;
    for (const mesh of edgeMeshes) mesh.visible = visible;
    if (!visible) return;

    const [h0, h1] = screenHands;
    for (const mesh of bandMeshes) updateBand(mesh, h0, h1);
    for (let i = 0; i < edgeMeshes.length; i++) {
      updateEdge(edgeMeshes[i], edgeLandmarks[i], h0, h1);
    }
  }

  function resize(w, h) {
    aspect = w / h;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const resolution = new THREE.Vector2(w * dpr, h * dpr);
    for (const mesh of bandMeshes) {
      mesh.material.uniforms.uResolution.value.copy(resolution);
    }
  }

  function dispose() {
    for (const mesh of bandMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const mesh of edgeMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    edgeMaterial.dispose();
  }

  return {
    update,
    resize,
    meshes: { bands: bandMeshes, edges: edgeMeshes },
    dispose,
  };
}
