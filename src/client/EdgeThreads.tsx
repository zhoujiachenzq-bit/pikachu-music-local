// React Bits Threads shader, adapted to the existing Three.js runtime.
// See third_party/react-bits-LICENSE.md. Only the two edge strips are shaded.
import { useEffect, useRef, useState } from 'react';
import type { ToneThemeId } from './visualTheme';
import { threadsFragment } from './threadsShader';

export function EdgeThreads({ theme, enabled }: { theme: ToneThemeId; enabled: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!enabled || !host.current || (theme !== 'night' && theme !== 'cobalt')) return;
    const element = host.current;
    let disposed = false; let cleanup = () => {};
    void import('three').then(THREE => {
      if (disposed) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' }); }
      catch { return; } // Keep the original particle layer if WebGL is unavailable.
      const geometry = new THREE.PlaneGeometry(2, 2);
      const material = new THREE.RawShaderMaterial({
        vertexShader: 'attribute vec3 position; void main() { gl_Position = vec4(position, 1.0); }',
        fragmentShader: threadsFragment, depthTest: false, depthWrite: false,
        uniforms: {
          iTime: { value: 0 }, iResolution: { value: new THREE.Vector3(1, 1, 1) },
          uColor: { value: new THREE.Color(theme === 'night' ? '#d2af65' : '#72e4ff') },
          uAmplitude: { value: .65 }, uDistance: { value: .42 },
          uMouse: { value: new THREE.Vector2(.5, .5) }, uOffset: { value: 0 }, uMirror: { value: 0 },
        },
      });
      const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material));
      const camera = new THREE.Camera();
      renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
      element.appendChild(renderer.domElement);
      let frame = 0; let lastFrame = -Infinity; let width = 0; let height = 0; let edge = 0;
      const size = new THREE.Vector2();
      const resize = () => {
        width = element.clientWidth; height = element.clientHeight;
        edge = Math.min(160, Math.max(24, (width - 1680) / 2 + 24));
        renderer.setPixelRatio(Math.min(1, 1920 / Math.max(1, width), 1080 / Math.max(1, height)));
        renderer.setSize(width, height, false); lastFrame = -Infinity;
      };
      const draw = (time: number) => {
        frame = 0;
        if (disposed || document.hidden) return;
        frame = requestAnimationFrame(draw);
        if (time - lastFrame < 1000 / 24 || !width || !height) return;
        lastFrame = time;
        renderer.getDrawingBufferSize(size);
        const dpr = renderer.getPixelRatio();
        material.uniforms.iTime.value = time * .00035;
        material.uniforms.iResolution.value.set(size.y, Math.floor(edge * dpr), 1);
        renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
        for (const side of [0, 1]) {
          const x = side ? width - edge : 0;
          material.uniforms.uOffset.value = Math.floor(x * dpr);
          material.uniforms.uMirror.value = side;
          renderer.setViewport(x, 0, edge, height); renderer.setScissor(x, 0, edge, height);
          renderer.render(scene, camera);
        }
      };
      const visibility = () => {
        cancelAnimationFrame(frame); frame = 0;
        if (!document.hidden) { lastFrame = -Infinity; frame = requestAnimationFrame(draw); }
      };
      const contextLost = (event: Event) => {
        event.preventDefault(); cancelAnimationFrame(frame); setReady(false); cleanup();
      };
      const observer = new ResizeObserver(resize); observer.observe(element);
      document.addEventListener('visibilitychange', visibility);
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      let cleaned = false;
      cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        cancelAnimationFrame(frame); observer.disconnect();
        document.removeEventListener('visibilitychange', visibility);
        renderer.domElement.removeEventListener('webglcontextlost', contextLost);
        geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      };
      resize(); visibility(); setReady(true);
    }).catch(() => { cleanup(); if (!disposed) setReady(false); });
    return () => { disposed = true; cleanup(); };
  }, [enabled, theme]);
  return <div ref={host} className="edge-threads" data-ready={ready && enabled} aria-hidden="true"/>;
}
