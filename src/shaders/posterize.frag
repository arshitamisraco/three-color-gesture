// Band B: green / yellow / cream posterize with an RGB-split fringe, like a
// mis-registered three-color print.

varying vec3 vUvq;          // uv = vUvq.xy / vUvq.z (perspective-correct)
uniform sampler2D uVideo;
uniform vec2 uResolution;
uniform float uTime;

uniform vec3 uColorDark;
uniform vec3 uColorMid;
uniform vec3 uColorLight;
uniform float uRgbSplit;

float luma(vec3 rgb) {
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Quantize luminance to 3 print levels (0, 1, 2), with a slight contrast
// boost so the bands stay bold rather than muddy.
float posterize3(float lum) {
  float boosted = clamp((lum - 0.5) * 1.2 + 0.5, 0.0, 1.0);
  return floor(boosted * 2.999);
}

// Map a quantized level to its ink color: 0 = dark, 1 = mid, 2 = light.
vec3 levelColor(float level) {
  if (level < 0.5) return uColorDark;
  if (level < 1.5) return uColorMid;
  return uColorLight;
}

void main() {
  vec2 uv = vUvq.xy / vUvq.z;

  // Per-channel horizontal offset: R shifted one way, B the other, G stays
  // put, giving a colored fringe at edges once each is posterized.
  vec2 uvR = clamp(uv + vec2(uRgbSplit, 0.0), 0.0, 1.0);
  vec2 uvG = clamp(uv, 0.0, 1.0);
  vec2 uvB = clamp(uv - vec2(uRgbSplit, 0.0), 0.0, 1.0);

  float lumR = luma(texture2D(uVideo, uvR).rgb);
  float lumG = luma(texture2D(uVideo, uvG).rgb);
  float lumB = luma(texture2D(uVideo, uvB).rgb);

  // Light animated grain so the flat posterize bands break up a bit.
  float frame = floor(uTime * 12.0);
  float grain = (hash(gl_FragCoord.xy + frame * 17.0) - 0.5) * 0.06;
  lumR += grain;
  lumG += grain;
  lumB += grain;

  vec3 colR = levelColor(posterize3(lumR));
  vec3 colG = levelColor(posterize3(lumG));
  vec3 colB = levelColor(posterize3(lumB));

  gl_FragColor = vec4(colR.r, colG.g, colB.b, 1.0);
}
