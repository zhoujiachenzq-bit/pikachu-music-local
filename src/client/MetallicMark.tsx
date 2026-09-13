// React Bits MetallicPaint shader, rendered with our existing Three.js runtime.
// Small text masks replace the original large image/depth preprocessing pipeline.
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './motionEffects';
import { metallicFragment } from './metallicShader';

export function MetallicMark({ text, enabled, className = '' }: { text: string; enabled: boolean; className?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  const animate = enabled && !reduced;
  useEffect(() => {
    setReady(false);
    if (!animate || !host.current) return;
    const el = host.current;
    let disposed = false; let destroy = () => {};
    void import('three').then(T => {
      if (disposed) return;
      const renderer = new T.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
      const mask = document.createElement('canvas'); mask.width = 512; mask.height = 128;
      const ctx = mask.getContext('2d');
      if (!ctx) { renderer.dispose(); renderer.forceContextLoss(); return; }
      ctx.font = '900 100px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const size = Math.min(100, 490 / ctx.measureText(text).width * 100);
      ctx.font = `900 ${size}px Arial`; ctx.fillStyle = '#808080'; ctx.fillText(text, 256, 68);
      const texture = new T.CanvasTexture(mask); texture.flipY = false;
      const geometry = new T.PlaneGeometry(2, 2);
      const uniforms = {
        u_tex: { value: texture }, u_time: { value: 0 }, u_ratio: { value: 4 }, u_imgRatio: { value: 4 },
        u_seed: { value: 42 }, u_scale: { value: 2 }, u_refract: { value: .01 }, u_blur: { value: .015 }, u_liquid: { value: .12 },
        u_bright: { value: 1.2 }, u_contrast: { value: .65 }, u_angle: { value: 0 }, u_fresnel: { value: 1 }, u_sharp: { value: 1 },
        u_wave: { value: .6 }, u_noise: { value: .5 }, u_chroma: { value: .7 }, u_distort: { value: .15 }, u_contour: { value: .2 },
        u_lightColor: { value: new T.Vector3(1, .94, .72) }, u_darkColor: { value: new T.Vector3(.18, .11, .04) }, u_tint: { value: new T.Vector3(1, .92, .7) },
      };
      const material = new T.RawShaderMaterial({ glslVersion: T.GLSL3, uniforms, depthTest: false, depthWrite: false,
        vertexShader: 'in vec3 position; out vec2 vP; void main(){vP=position.xy*.5+.5;gl_Position=vec4(position,1.);}', fragmentShader: metallicFragment });
      const scene = new T.Scene(); scene.add(new T.Mesh(geometry, material)); const camera = new T.Camera();
      let frame = 0; let last = 0; let visible = false; let cleaned = false; let failed = false;
      const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; };
      const draw = (now: number) => {
        if (cleaned || failed || !visible || document.hidden) return;
        if (!last || now - last >= 1000 / 18) { uniforms.u_time.value += last ? Math.min(now - last, 100) * .12 : 0; last = now; renderer.render(scene, camera); }
        if (!failed) frame = requestAnimationFrame(draw);
      };
      const sync = () => { stop(); if (visible && !document.hidden && !cleaned && !failed) frame = requestAnimationFrame(draw); };
      const resize = () => { if (cleaned) return; const w = Math.max(1, el.clientWidth); const h = Math.max(1, el.clientHeight); renderer.setPixelRatio(Math.min(1.5, 512 / w, 128 / h)); renderer.setSize(w, h, false); uniforms.u_ratio.value = w / h; };
      const ro = new ResizeObserver(resize); const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
      const fail = () => { failed = true; stop(); setReady(false); };
      const lost = (event: Event) => { event.preventDefault(); fail(); destroy(); };
      destroy = () => { if (cleaned) return; cleaned = true; stop(); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', sync); renderer.domElement.removeEventListener('webglcontextlost', lost); texture.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
      renderer.debug.onShaderError = fail;
      el.append(renderer.domElement); ro.observe(el); io.observe(el); resize();
      document.addEventListener('visibilitychange', sync); renderer.domElement.addEventListener('webglcontextlost', lost);
      renderer.render(scene, camera); if (failed) destroy(); else setReady(true);
    }).catch(() => { destroy(); if (!disposed) setReady(false); });
    return () => { disposed = true; destroy(); };
  }, [animate, text]);
  return <span className={`metal-mark ${className}`} data-ready={ready && animate}><span className="metal-fallback">{text}</span><span className="metal-canvas" ref={host} aria-hidden="true"/></span>;
}
