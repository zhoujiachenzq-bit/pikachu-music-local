// Neon Arcade's depth scene: one full-screen pass, far to near: stars, a cut sunset, neon ridgelines and
// skyline, a grid floor running toward the viewer, a few drifting pixel invaders. Layers shift by depth
// with the pointer, and the floor and sun breathe with playback.
export const ARCADE_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

export const ARCADE_FRAGMENT = `
varying vec2 vUv;
uniform vec2 uRes, uPointer;
uniform float uTime, uPulse, uProgress;
uniform vec3 uPink, uCyan, uGold;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(float x) { float i = floor(x), f = fract(x); f = f * f * (3. - 2. * f); return mix(hash(vec2(i, 1.)), hash(vec2(i + 1., 1.)), f); }
float ridge(float x, float seed) { return noise(x * 3. + seed) * .55 + noise(x * 7.3 + seed * 2.) * .3 + noise(x * 17. + seed) * .15; }
// An 11x8 invader, one row per float, read bit by bit.
float invader(vec2 q, float frame) {
  if (q.x < 0. || q.x >= 11. || q.y < 0. || q.y >= 8.) return 0.;
  float row = floor(q.y), bits = 0.;
  if (row == 7.) bits = 260.; else if (row == 6.) bits = 136.; else if (row == 5.) bits = 508.; else if (row == 4.) bits = 886.;
  else if (row == 3.) bits = 2047.; else if (row == 2.) bits = 1533.; else if (row == 1.) bits = frame > .5 ? 1285. : 1029.; else bits = frame > .5 ? 216. : 1539.;
  return mod(floor(bits / pow(2., floor(q.x))), 2.);
}

void main() {
  vec2 px = vUv * uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2((vUv.x - .5) * aspect, vUv.y);
  float horizon = aspect < 1. ? .24 : .4;
  vec2 par = uPointer * vec2(.04, .02);

  // Sky and stars.
  float sky = smoothstep(horizon, 1., vUv.y);
  vec3 color = mix(vec3(.36, .07, .32), vec3(.03, .02, .1), pow(sky, .55));
  color += uPink * .22 * exp(-abs(vUv.y - horizon) * 18.);
  vec2 sp = (p + par * .3) * 90.;
  float star = hash(floor(sp));
  float twinkle = .5 + .5 * sin(uTime * (1. + star * 3.) + star * 40.);
  color += vec3(.8, .85, 1.) * step(.985, star) * smoothstep(.45, .05, length(fract(sp) - .5)) * twinkle * sky;

  // The sunset, cut by bands that widen toward the horizon.
  vec2 sc = vec2(par.x * .5, horizon + (aspect < 1. ? .07 : .13));
  float r = aspect < 1. ? .15 : .24;
  float d = length(p - sc);
  float t = clamp((p.y - (sc.y - r)) / (2. * r), 0., 1.);
  vec3 sun = mix(uPink, uGold, pow(t, .8));
  float k = (sc.y + r * .25 - p.y) / r;
  float band = k > 0. ? step(fract(k * 5.5 + uTime * .08), k * .5) : 0.;
  float disc = smoothstep(r, r - .004, d) * (1. - band) * step(horizon, p.y);
  color = mix(color, sun * (1. + .25 * uPulse), disc * (aspect < 1. ? .62 : .88));
  color += uPink * .35 * exp(-max(d - r, 0.) * 9.) * step(horizon, p.y) * (.7 + .3 * uPulse);

  // Two ridgelines: far magenta, near cyan with a city skyline cut into it.
  float x1 = p.x + par.x * .6, x2 = p.x + par.x * 1.1;
  float far = horizon + .02 + ridge(x1 * .6, 3.) * (aspect < 1. ? .07 : .09);
  float near = horizon + ridge(x2, 9.) * (aspect < 1. ? .05 : .06);
  float city = horizon + step(.55, hash(vec2(floor(x2 * 26.), 7.))) * hash(vec2(floor(x2 * 26.), 3.)) * .05 * smoothstep(.15, .55, abs(x2));
  near = max(near, city);
  if (p.y > horizon && p.y < far) color = mix(color, vec3(.1, .03, .16), .85);
  color += uPink * .55 * smoothstep(.004, 0., abs(p.y - far)) * step(horizon, p.y);
  if (p.y > horizon && p.y < near) color = vec3(.04, .02, .08);
  color += uCyan * .9 * smoothstep(.003, 0., abs(p.y - near)) * step(horizon, p.y);
  float window = step(.86, hash(floor(vec2(x2 * 140., p.y * 160.)))) * step(horizon + .006, p.y) * step(p.y, city - .004);
  color += uGold * window * .6 * (.6 + .4 * sin(uTime * 2. + hash(floor(vec2(x2 * 140., 1.))) * 30.));

  // The floor: a perspective grid sliding toward the viewer.
  if (vUv.y < horizon) {
    float depth = horizon - vUv.y;
    float z = .32 / depth + uTime * (.6 + uPulse * .5);
    float x = (p.x + par.x * 1.8) / depth * 1.4;
    float w = .035 + depth * .12;
    float lineX = 1. - smoothstep(0., w, .5 - abs(fract(x) - .5));
    float lineZ = 1. - smoothstep(0., w * 1.6, .5 - abs(fract(z) - .5));
    float fade = smoothstep(0., .08, depth);
    vec3 floorColor = mix(vec3(.05, .01, .08), vec3(.12, .02, .14), depth * 2.);
    float glow = max(lineX, lineZ) * fade * (.85 + .4 * uPulse);
    color = floorColor + mix(uCyan, uPink, smoothstep(.0, .25, depth)) * glow;
    color += uPink * .25 * exp(-depth * 22.);
    color += sun * .12 * smoothstep(.06, 0., abs(p.x - sc.x)) * exp(-depth * 6.) * (.6 + .4 * sin(z * 6.));
  }

  // A few invaders drifting high and to the sides, well clear of the middle.
  for (float i = 0.; i < 4.; i += 1.) {
    float side = mod(i, 2.) < .5 ? -1. : 1.;
    vec2 at = vec2(side * (aspect < 1. ? .12 + .02 * i : (.34 + .06 * i) * min(aspect, 1.4)) + sin(uTime * .21 + i) * .03, (aspect < 1. ? .78 : .74) + .08 * hash(vec2(i, 2.)) + sin(uTime * .35 + i * 2.) * .015);
    at += par * (.4 + i * .15);
    float size = (aspect < 1. ? .0042 : .0036) * (1. + i * .12);
    float on = invader((p - at) / size + vec2(5.5, 4.), step(.5, fract(uTime * .9 + i * .3)));
    color = mix(color, i < 2. ? uCyan : uPink, on * (.55 - i * .06));
  }

  // CRT finish: scanlines and a soft vignette.
  color *= .9 + .1 * sin(px.y * 3.14159);
  color *= 1. - .45 * pow(length((vUv - .5) * vec2(1.1, 1.3)), 2.2);
  gl_FragColor = vec4(color, 1.);
}`;
