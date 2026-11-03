import { useEffect, useRef } from 'react';

const IMAGE = '/holiday-coast.webp';
// R: where the sea moves. G: where sunlight breaks through the leaves. B: the foreground, which birds pass behind.
const MASK = '/holiday-coast-mask.webp';
const BIRD = '/holiday-coast-bird.webp';
const GARDEN_IMAGE = '/lofi-gate.webp';
// R: the water through the gate. G: the glowing ring. B: canopy drift, grey at rest.
const GARDEN_MASK = '/lofi-gate-mask.webp';
const IMAGE_RATIO = 2912 / 1632;
const GARDEN_RATIO = 16 / 9;
const FRAME_MS = 1000 / 30;
const MAX_PIXELS = 1_800_000;
// The night-sea picture is shown at full resolution, so its canvas may go up to the 4K source.
const CRISP_PIXELS = 3840 * 2160;
const HARBOR_IMAGE = '/harbor-night.jpg';
// R: the water. G: the eyes' highlights. B: hair and collar drift, grey at rest.
const HARBOR_MASK = '/harbor-night-mask.webp';

const VERTEX = `attribute vec2 a; varying vec2 v; void main() { v = vec2(a.x * .5 + .5, .5 - a.y * .5); gl_Position = vec4(a, 0., 1.); }`;
const FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform sampler2D image, mask, bird;
uniform vec2 cover;
uniform float aspect, time;

float wave(vec2 p, vec2 d, float f, float s) { return sin(dot(p, d) * f + time * s * .55); }
float swell(vec2 p) {
  p += .22 * vec2(sin(p.y * 1.7 + time * .17), sin(p.x * 1.3 - time * .15));
  return wave(p, vec2(.94, .34), 5.1, .62) + .7 * wave(p, vec2(-.62, .78), 8.3, -.83) + .5 * wave(p, vec2(.24, -.97), 13.7, 1.12) + .3 * wave(p, vec2(.8, .6), 23.9, -1.6);
}
vec4 flyer(vec2 uv, float period, float phase, vec2 from, vec2 to, float size) {
  float t = fract(time / period + phase);
  vec2 at = mix(from, to, t) + vec2(0., .012 * sin(t * 19. + phase * 9.));
  vec2 q = (uv - at) * vec2(1.7849, 1.) / size + .5;
  if (q.x < 0. || q.x > 1. || q.y < 0. || q.y > 1.) return vec4(0.);
  float frame = floor(mod(time * 9. + phase * 8., 8.));
  return texture2D(bird, vec2((frame + 1. - q.x) / 8., q.y));
}
vec4 leaf(float i) {
  float period = 11. + i * 2.3, t = fract(time / period + i * .173);
  vec2 at = vec2(fract(i * .618 + .11) * 1.1 - t * .16 + .08 * sin(t * 9. + i * 2.), t * 1.15 - .08);
  vec2 q = (v - at) * vec2(aspect, 1.);
  float angle = time * (.7 + i * .09) + i * 2.4, c = cos(angle), s = sin(angle);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y) / (.0052 + .0007 * mod(i, 3.));
  q.y /= .42 + .34 * abs(sin(time * 1.3 + i));
  float a = smoothstep(1.3, .85, length(q)) * smoothstep(0., .08, t) * smoothstep(1., .9, t);
  return vec4(mix(vec3(.45, .68, .24), vec3(.86, .85, .4), fract(i * .37)), a * .9);
}
void main() {
  vec2 uv = (v - .5) * cover + .5;
  vec4 m = texture2D(mask, uv);
  float near = clamp((uv.y - .56) / .44, 0., 1.);
  vec2 sea = vec2((uv.x - .5) / (.16 + near * .84), 1. / (.09 + near * .91) * .34);
  float e = .012, h = swell(sea);
  vec2 slope = vec2(swell(sea + vec2(e, 0.)) - h, swell(sea + vec2(0., e)) - h) / e;
  float breeze = m.b * smoothstep(.1, .3, uv.x) * smoothstep(.55, .12, uv.y);
  vec2 sway = breeze * .0016 * vec2(sin(uv.x * 19. + uv.y * 7. + time * .9), .6 * sin(uv.x * 13. - time * .7));
  vec3 color = texture2D(image, uv + slope * m.r * (.0001 + .0003 * near) + sway).rgb;
  float glint = pow(clamp(dot(normalize(vec3(slope * .16, 1.)), normalize(vec3(.28, -.3, .91))), 0., 1.), 150.);
  color += vec3(1., .98, .9) * glint * m.r * (.22 - .12 * near);
  vec2 ray = (uv - vec2(.91, .04)) * vec2(1.7849, 1.);
  float angle = atan(ray.y, ray.x);
  float beam = .5 + .28 * sin(angle * 23. + time * .23) + .14 * sin(angle * 51. - time * .31) + .08 * sin(angle * 97. + time * .17);
  color += vec3(1., .96, .82) * beam * beam * exp(-length(ray) * 1.05) * m.g * .46;
  vec4 far = flyer(uv, 34., 0., vec2(1.08, .3), vec2(.18, .1), .028), close = flyer(uv, 47., .55, vec2(-.08, .2), vec2(1.1, .34), .036);
  color = mix(color, vec3(.1, .15, .22), (far.a + close.a) * .86 * (1. - m.b));
  for (float i = 0.; i < 6.; i += 1.) { vec4 l = leaf(i); color = mix(color, l.rgb, l.a); }
  gl_FragColor = vec4(color, 1.);
}`;

const GARDEN_FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform sampler2D image, mask;
uniform vec2 cover;
uniform float aspect, time;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec4 petal(float i) {
  float period = 13. + hash(i) * 9., t = fract(time / period + hash(i + 3.));
  vec2 at = vec2(hash(i + 7.) * 1.25 - .12 - t * .2 + .05 * sin(t * 8. + i), t * 1.16 - .08);
  vec2 q = (v - at) * vec2(aspect, 1.);
  float angle = time * (.5 + hash(i) * .7) + i * 2.1, c = cos(angle), s = sin(angle);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y) / (.0062 + .0026 * hash(i + 5.));
  q.y /= .46 + .36 * abs(sin(time * 1.1 + i));
  float a = smoothstep(1.25, .8, length(q)) * smoothstep(0., .06, t) * smoothstep(1., .92, t);
  return vec4(mix(vec3(1., .72, .84), vec3(1., .9, .94), hash(i + 2.)), a * .92);
}
float mote(vec2 uv, float i) {
  float t = fract(time / (9. + hash(i) * 7.) + hash(i + 4.));
  vec2 at = vec2(.5 + (hash(i + 1.) - .5) * .2 + .008 * sin(time * .7 + i), .68 - t * .3);
  return smoothstep(.0048, .0008, length((uv - at) * vec2(1.7778, 1.))) * sin(t * 3.14159);
}
void main() {
  vec2 uv = (v - .5) * cover + .5;
  vec4 m = texture2D(mask, uv);
  vec2 sway = (m.b - .5) * .0032 * vec2(sin(time * .8 + uv.y * 9.), .5 * sin(time * .6 + uv.x * 7.));
  vec2 ripple = m.r * .00055 * vec2(sin(uv.y * 260. + time * .7 + 2. * sin(uv.x * 30.)), sin(uv.x * 90. - time * .5));
  vec3 color = texture2D(image, uv + sway + ripple).rgb;
  color += mix(vec3(.62, .22, 1.), vec3(.2, .85, 1.), smoothstep(.42, .72, uv.y)) * m.g * (.12 + .07 * sin(time * .6));
  for (float i = 0.; i < 8.; i += 1.) color += vec3(.8, .95, 1.) * mote(uv, i) * .8;
  for (float i = 0.; i < 12.; i += 1.) { vec4 p = petal(i); color = mix(color, p.rgb, p.a); }
  gl_FragColor = vec4(color, 1.);
}`;

const HARBOR_FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform sampler2D image, mask;
uniform vec2 cover, shift;
uniform float aspect, time;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec3 bokeh(float i) {
  float t = fract(time / (40. + hash(i) * 30.) + hash(i + 2.));
  vec2 at = vec2(fract(hash(i + 5.) + t * .18 * (hash(i + 9.) - .5)), .08 + hash(i + 7.) * .42 + .03 * sin(time * .2 + i));
  float d = length((v - at) * vec2(aspect, 1.)), r = .018 + hash(i + 1.) * .03;
  float a = smoothstep(r, r * .7, d) * (.05 + .05 * hash(i + 4.)) * sin(t * 3.14159);
  return mix(vec3(1., .78, .88), vec3(.62, .82, 1.), hash(i + 3.)) * a;
}
void main() {
  vec2 uv = (v - .5) * cover + .5 + shift;
  vec4 m = texture2D(mask, uv);
  vec2 sway = (m.b - .5) * .004 * vec2(sin(time * .9 + uv.y * 6.), .4 * sin(time * .7 + uv.x * 5.));
  vec2 ripple = m.r * .0006 * vec2(sin(uv.y * 320. + time * .9 + 2. * sin(uv.x * 40.)), sin(uv.x * 110. - time * .6));
  vec3 color = texture2D(image, uv + sway + ripple).rgb;
  float lum = dot(color, vec3(.299, .587, .114));
  vec2 cell = floor(uv * vec2(420., 300.));
  float seed = hash(cell.x + cell.y * 57.);
  color += m.r * smoothstep(.5, .85, lum) * pow(.5 + .5 * sin(time * (1. + seed * 3.) + seed * 40.), 12.) * .3;
  // The far shore runs at her eye level; keep the twinkle off her, to either side.
  float shore = smoothstep(.455, .47, uv.y) * smoothstep(.535, .52, uv.y) * (1. - smoothstep(.35, .38, uv.x) * smoothstep(.65, .62, uv.x)), lamp = floor(uv.x * 140.);
  color *= 1. + shore * smoothstep(.6, .95, lum) * (sin(time * (1.2 + hash(lamp) * 2.) + hash(lamp + 3.) * 6.28) * .18);
  color += vec3(.75, .9, 1.) * m.g * (.1 + .08 * sin(time * 1.3));
  for (float i = 0.; i < 10.; i += 1.) color += bokeh(i);
  gl_FragColor = vec4(color, 1.);
}`;

function loadTexture(gl: WebGLRenderingContext, unit: number, source: HTMLImageElement, mipmap: boolean) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  // Mipmaps keep a 4K picture from shimmering when it is drawn smaller; WebGL 1 cannot mip a non-power-of-two image.
  const mip = mipmap && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
  });
}

/** A wallpaper, alive. Sits on the static picture and fades in only once it has drawn, so any failure just leaves that picture. */
function LiveCanvas({ fragment, sources, imageRatio, crisp = false }: { fragment: string; sources: string[]; imageRatio: number; crisp?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Made here, not in JSX: releasing a context is final for its canvas, and this effect may run again.
    const element = document.createElement('canvas');
    host.current?.append(element);
    const options: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
    const gl: WebGLRenderingContext | null = (crisp ? element.getContext('webgl2', options) : null) || element.getContext('webgl', options);
    if (!gl) { element.remove(); return; }
    let frame = 0, disposed = false, last = 0, ready = false;
    const lost = () => { disposed = true; cancelAnimationFrame(frame); element.style.opacity = '0'; };
    element.addEventListener('webglcontextlost', lost);
    const compile = (type: number, source: string) => { const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); return shader; };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment)); gl.bindAttribLocation(program, 0, 'a'); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      element.removeEventListener('webglcontextlost', lost);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      element.remove(); return;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const resize = () => {
      const { width, height } = element.getBoundingClientRect(); if (!width || !height) return;
      const scale = crisp ? Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(CRISP_PIXELS / (width * height))) : Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_PIXELS / (width * height)));
      element.width = Math.round(width * scale); element.height = Math.round(height * scale);
      gl.viewport(0, 0, element.width, element.height);
      const ratio = width / height;
      const cover = [Math.min(ratio / imageRatio, 1), Math.min(imageRatio / ratio, 1)];
      gl.uniform2f(uniform('cover'), cover[0], cover[1]);
      // Same framing as the CSS picture underneath: its background-position percentages, read off the stage.
      const stage = host.current?.parentElement;
      const [x, y] = (stage ? getComputedStyle(stage).backgroundPosition : '50% 50%').split(' ').map(part => part.endsWith('%') ? parseFloat(part) / 100 : .5);
      gl.uniform2f(uniform('shift'), (x - .5) * (1 - cover[0]), (y - .5) * (1 - cover[1]));
      gl.uniform1f(uniform('aspect'), ratio);
    };
    const observer = new ResizeObserver(resize);
    const draw = (now: number) => {
      if (disposed || document.hidden) return;
      frame = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      last = now;
      gl.uniform1f(uniform('time'), now / 1000 % 3600);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      element.style.opacity = '1';
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      if (ready && !disposed && !document.hidden) frame = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', visibility);
    void Promise.all(sources.map(loadImage)).then(images => {
      if (disposed) return;
      images.forEach((image, unit) => loadTexture(gl, unit, image, crisp && unit === 0));
      images.forEach((_, unit) => gl.uniform1i(uniform(['image', 'mask', 'bird'][unit]), unit));
      observer.observe(element); resize();
      ready = true; visibility();
    }).catch(() => undefined);
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      element.removeEventListener('webglcontextlost', lost);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      element.remove();
    };
  }, [crisp, fragment, imageRatio, sources]);
  return <div ref={host} className="coast-live-scene"/>;
}

const COAST_SOURCES = [IMAGE, MASK, BIRD];
const GARDEN_SOURCES = [GARDEN_IMAGE, GARDEN_MASK];
export const CoastLiveScene = () => <LiveCanvas fragment={FRAGMENT} sources={COAST_SOURCES} imageRatio={IMAGE_RATIO}/>;
const HARBOR_SOURCES = [HARBOR_IMAGE, HARBOR_MASK];
export const HarborLiveScene = () => <LiveCanvas fragment={HARBOR_FRAGMENT} sources={HARBOR_SOURCES} imageRatio={16 / 9} crisp/>;
export const GardenLiveScene = () => <LiveCanvas fragment={GARDEN_FRAGMENT} sources={GARDEN_SOURCES} imageRatio={GARDEN_RATIO}/>;
