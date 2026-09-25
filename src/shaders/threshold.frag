// Band A: risograph / photocopy look — hard blue/cream threshold with
// animated film grain and a 4x4 ordered dither so edges break up like print
// dots instead of a clean vector edge.

varying vec3 vUvq;          // uv = vUvq.xy / vUvq.z (perspective-correct)
uniform sampler2D uVideo;
uniform vec2 uResolution;
uniform float uTime;

uniform vec3 uColorDark;
uniform vec3 uColorLight;
uniform float uThreshold;
uniform float uGrain;

float luma(vec3 rgb) {
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}

// Cheap hash noise for grain.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Standard 4x4 Bayer matrix (values 0..15), as flattened conditionals since
// GLSL ES 1.00 has no array-constant initializers.
float bayer4x4(vec2 fragCoord) {
  ivec2 p = ivec2(mod(fragCoord, 4.0));
  int idx = p.y * 4 + p.x;
  if (idx == 0) return 0.0;
  if (idx == 1) return 8.0;
  if (idx == 2) return 2.0;
  if (idx == 3) return 10.0;
  if (idx == 4) return 12.0;
  if (idx == 5) return 4.0;
  if (idx == 6) return 14.0;
  if (idx == 7) return 6.0;
  if (idx == 8) return 3.0;
  if (idx == 9) return 11.0;
  if (idx == 10) return 1.0;
  if (idx == 11) return 9.0;
  if (idx == 12) return 15.0;
  if (idx == 13) return 7.0;
  if (idx == 14) return 5.0;
  return 13.0;
}

void main() {
  vec2 uv = vUvq.xy / vUvq.z;
  vec3 sampleColor = texture2D(uVideo, clamp(uv, 0.0, 1.0)).rgb;

  // Contrast boost so the two-tone split reads as bold print, not gray mush.
  float lum = luma(sampleColor);
  lum = (lum - 0.5) * 1.4 + 0.5;

  // Grain noise animated at ~12fps (stepped time keeps it from smearing).
  float frame = floor(uTime * 12.0);
  float grainNoise = hash(gl_FragCoord.xy + frame * 17.0) - 0.5;

  // Ordered dither, blended in at ~30% so the pattern reads as print dots
  // rather than pure random noise.
  float ditherNoise = (bayer4x4(gl_FragCoord.xy) / 16.0) - 0.5;
  float noise = mix(grainNoise, ditherNoise, 0.3) * uGrain;

  float v = step(uThreshold + noise, lum);
  gl_FragColor = vec4(mix(uColorDark, uColorLight, v), 1.0);
}
