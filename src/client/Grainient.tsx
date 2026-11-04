// React Bits Grainient adapted to our existing Three.js runtime.
// Source supplied by the user; license in third_party/react-bits-LICENSE.md.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from './motionEffects';
import { grainientFragment } from './grainientShader';
import type { ToneThemeId } from './visualTheme';

export type GrainientTone = ToneThemeId | 'login';
const COLORS: Record<GrainientTone, readonly [string, string, string]> = {
  login: ['#846039', '#26334e', '#090e1a'],
  burgundy: ['#b792c9', '#6571b2', '#303455'],
  harbor: ['#2b5d9a', '#14204a', '#0b1430'],
  comet: ['#1f5f73', '#0c1d2b', '#060c15'],
  miku: ['#39d5c9', '#7a2a9e', '#0e0820'],
  paper: ['#fff3d1', '#e6a36f', '#edcf99'],
  night: ['#cceaf1', '#a7dbe8', '#f4e9ce'],
  cobalt: ['#569ab5', '#23499d', '#071c52'],
};

/** Decorative only. Static gradient fallback when motion/WebGL is unavailable. */
export function Grainient({ tone, motionEnabled, active = true, className = '' }: {
  tone: GrainientTone; motionEnabled: boolean; active?: boolean; className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  const colors = COLORS[tone];
  const canAnimate = motionEnabled && !reduced && active;
  useEffect(() => {
    setReady(false);
    if (!canAnimate || !host.current) return;
    const element = host.current;
    let disposed = false;
    let destroy = () => {};
    void import('three').then(THREE => {
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: false, powerPreference: 'low-power' });
      const geometry = new THREE.PlaneGeometry(2, 2);
      const color = (hex: string) => new THREE.Vector3(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]);
      const light = tone === 'paper';
      const uniforms = {
        iTime: { value: 0 }, iResolution: { value: new THREE.Vector2(1, 1) },
        uTimeSpeed: { value: .075 }, uColorBalance: { value: 0 },
        uWarpStrength: { value: .65 }, uWarpFrequency: { value: 5 }, uWarpSpeed: { value: 2 }, uWarpAmplitude: { value: 50 },
        uBlendAngle: { value: -15 }, uBlendSoftness: { value: .18 }, uRotationAmount: { value: 300 }, uNoiseScale: { value: 2 },
        uGrainAmount: { value: light ? .045 : .055 }, uGrainScale: { value: 2 }, uGrainAnimated: { value: 0 },
        uContrast: { value: 1.04 }, uGamma: { value: 1 }, uSaturation: { value: .85 },
        uCenterOffset: { value: new THREE.Vector2(0, 0) }, uZoom: { value: .95 },
        uColor1: { value: color(colors[0]) }, uColor2: { value: color(colors[1]) }, uColor3: { value: color(colors[2]) }, uLightMode: { value: 0 },
      };
      const material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: 'in vec3 position; void main() { gl_Position = vec4(position, 1.0); }',
        fragmentShader: grainientFragment, uniforms, depthTest: false, depthWrite: false,
      });
      const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material));
      const camera = new THREE.Camera();
      let frame = 0; let last = 0; let elapsed = 0; let visible = false; let cleaned = false; let failed = false;
      let resizeObserver: ResizeObserver | undefined; let intersectionObserver: IntersectionObserver | undefined;
      const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; };
      const draw = (stamp: number) => {
        frame = 0;
        if (disposed || cleaned || failed || !visible || document.hidden) return;
        const interval = window.innerWidth <= 760 ? 1000 / 18 : 1000 / 24;
        if (!last || stamp - last >= interval) {
          elapsed += last ? Math.min(stamp - last, 100) / 1000 : 0;
          last = stamp; uniforms.iTime.value = elapsed;
          renderer.render(scene, camera);
        }
        if (!failed && !cleaned) frame = requestAnimationFrame(draw);
      };
      const sync = () => { stop(); if (visible && !document.hidden && !cleaned && !failed) frame = requestAnimationFrame(draw); };
      const fail = () => { failed = true; stop(); setReady(false); };
      const contextLost = (event: Event) => { event.preventDefault(); fail(); destroy(); };
      destroy = () => {
        if (cleaned) return; cleaned = true; stop();
        resizeObserver?.disconnect(); intersectionObserver?.disconnect();
        document.removeEventListener('visibilitychange', sync);
        renderer.domElement.removeEventListener('webglcontextlost', contextLost);
        geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      };
      renderer.debug.onShaderError = fail;
      element.append(renderer.domElement);
      const resize = () => {
        if (cleaned || failed) return;
        const width = Math.max(1, element.clientWidth); const height = Math.max(1, element.clientHeight);
        renderer.setPixelRatio(Math.min(1, 1280 / width, 900 / height));
        renderer.setSize(width, height, false); renderer.getDrawingBufferSize(uniforms.iResolution.value);
      };
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element); resize();
      intersectionObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
      intersectionObserver.observe(element);
      document.addEventListener('visibilitychange', sync);
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      renderer.render(scene, camera);
      if (failed) destroy(); else setReady(true);
    }).catch(() => { destroy(); if (!disposed) setReady(false); });
    return () => { disposed = true; destroy(); };
  }, [canAnimate, colors, tone]);
  return <div ref={host} className={`grainient ${className}`} data-grainient-tone={tone} data-ready={ready && canAnimate} aria-hidden="true"
    style={{ '--grainient-a': colors[0], '--grainient-b': colors[1], '--grainient-c': colors[2] } as CSSProperties}/>;
}
