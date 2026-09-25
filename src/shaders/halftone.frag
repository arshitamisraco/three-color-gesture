// Band C: newspaper-style red dot halftone on white paper. Dot size follows
// darkness, on a 15-degree screen-space grid so it stays uniform regardless
// of how the quad is warped between fingertips.

varying vec3 vUvq;          // uv = vUvq.xy / vUvq.z (perspective-correct)
uniform sampler2D uVideo;
uniform vec2 uResolution;
uniform float uTime;

uniform vec3 uColorDot;
uniform vec3 uColorPaper;
uniform float uDotScale;

float luma(vec3 rgb) {
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}

vec2 rotate(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  vec2 uv = vUvq.xy / vUvq.z;

  // uDotScale ~= dots across the viewport height. Grid lives in screen
  // pixels so it does not stretch with the quad's perspective warp.
  float cell = uResolution.y / uDotScale;
  float angle = radians(15.0); // classic halftone screen angle

  vec2 centered = gl_FragCoord.xy - 0.5 * uResolution;
  vec2 rotated = rotate(centered, angle);

  // Position within the current cell, in cell units centered on the cell.
  vec2 cellPos = rotated / cell;
  vec2 cellCenter = floor(cellPos) + 0.5;
  vec2 localPos = cellPos - cellCenter; // fragment offset, range [-0.5, 0.5)

  // Vector from this fragment to its cell's center, in *unrotated* screen
  // pixels, so we can approximate the video uv sampled at that cell center
  // via the uv screen-space derivatives.
  vec2 deltaScreen = rotate(-localPos * cell, -angle);
  vec2 uvCenter = uv + dFdx(uv) * deltaScreen.x + dFdy(uv) * deltaScreen.y;

  float lum = luma(texture2D(uVideo, clamp(uvCenter, 0.0, 1.0)).rgb);
  lum = clamp((lum - 0.5) * 1.2 + 0.5, 0.0, 1.0);

  // Darker cells get bigger dots; gamma keeps midtones from getting heavy.
  float darkness = 1.0 - lum;
  darkness = pow(darkness, 1.3);
  float radius = darkness * 0.75; // in cell units; >0.5 lets shadows merge

  float d = length(localPos);
  float aa = 1.0 / cell; // ~1 screen pixel of antialiasing, in cell units
  float coverage = 1.0 - smoothstep(radius - aa, radius + aa, d);

  gl_FragColor = vec4(mix(uColorPaper, uColorDot, coverage), 1.0);
}
