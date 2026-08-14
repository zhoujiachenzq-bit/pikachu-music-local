import { useEffect, useRef, useState } from 'react';
import { shouldUseDesktopWebgl, type StageMode, type VisualPalette } from './visualState';

interface ImmersiveBackdropProps {
  active: boolean;
  coverUrl?: string | null;
  palette: VisualPalette;
  playing: boolean;
  progress: number;
  stage: StageMode;
}

export function ImmersiveBackdrop({ active, coverUrl, palette, playing, progress, stage }: ImmersiveBackdropProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const live = useRef({ playing, progress });
  const [webglReady, setWebglReady] = useState(false);

  useEffect(() => { live.current = { playing, progress }; }, [playing, progress]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !active) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!shouldUseDesktopWebgl({ width: window.innerWidth, finePointer, reducedMotion: reduced })) return;

    let disposed = false;
    let destroy: (() => void) | undefined;
    setWebglReady(false);

    void import('three').then(THREE => {
      if (disposed || !hostRef.current) return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.className = 'immersive-webgl-canvas';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      host.append(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 40);
      camera.position.set(0, 0.15, 5.3);
      const group = new THREE.Group();
      scene.add(group);

      const ringGeometry = new THREE.TorusGeometry(1.45, 0.012, 6, 120);
      const ringMaterials = [
        new THREE.MeshBasicMaterial({ color: palette.primary, transparent: true, opacity: 0.52 }),
        new THREE.MeshBasicMaterial({ color: palette.secondary, transparent: true, opacity: 0.28 }),
        new THREE.MeshBasicMaterial({ color: palette.glow, transparent: true, opacity: 0.13 }),
      ];
      const rings = ringMaterials.map((material, index) => {
        const ring = new THREE.Mesh(ringGeometry, material);
        ring.scale.setScalar(1 + index * 0.33);
        ring.rotation.x = 0.5 + index * 0.18;
        ring.rotation.y = index * 0.55;
        group.add(ring);
        return ring;
      });

      let seed = palette.seed || 1;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0xffffffff;
      };
      const particleCount = 160;
      const positions = new Float32Array(particleCount * 3);
      for (let index = 0; index < particleCount; index += 1) {
        const radius = 1.9 + random() * 3.8;
        const angle = random() * Math.PI * 2;
        positions[index * 3] = Math.cos(angle) * radius;
        positions[index * 3 + 1] = (random() - 0.5) * 4.4;
        positions[index * 3 + 2] = Math.sin(angle) * radius - 1.5;
      }
      const particleGeometry = new THREE.BufferGeometry();
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const particleMaterial = new THREE.PointsMaterial({ color: palette.glow, size: 0.035, transparent: true, opacity: 0.58, sizeAttenuation: true });
      const particles = new THREE.Points(particleGeometry, particleMaterial);
      scene.add(particles);

      const grid = new THREE.GridHelper(12, 24, palette.secondary, palette.primary);
      grid.position.set(0, -1.62, -1.8);
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMaterials.forEach(material => { material.transparent = true; material.opacity = 0.075; });
      scene.add(grid);

      let pointerX = 0;
      let pointerY = 0;
      let frame = 0;
      let lastRender = 0;
      const pointerTarget = host.parentElement;
      const onPointerMove = (event: PointerEvent) => {
        if (!pointerTarget) return;
        const rect = pointerTarget.getBoundingClientRect();
        pointerX = ((event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5) * 2;
        pointerY = ((event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5) * 2;
      };
      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();

      const render = (stamp: number) => {
        frame = requestAnimationFrame(render);
        if (document.visibilityState !== 'visible') return;
        const interval = live.current.playing ? 33 : 140;
        if (stamp - lastRender < interval) return;
        lastRender = stamp;
        const speed = live.current.playing ? 1 : 0.18;
        rings.forEach((ring, index) => {
          ring.rotation.z += (0.0017 + index * 0.0007) * speed;
          ring.rotation.y += (0.001 + index * 0.0005) * speed;
        });
        particles.rotation.y += 0.00045 * speed;
        particles.rotation.z = Math.sin(stamp * 0.00012) * 0.05;
        group.rotation.z = live.current.progress * Math.PI * 0.12;
        camera.position.x += (pointerX * 0.22 - camera.position.x) * 0.045;
        camera.position.y += (-pointerY * 0.16 + 0.15 - camera.position.y) * 0.045;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      };

      const onContextLost = (event: Event) => {
        event.preventDefault();
        cancelAnimationFrame(frame);
        setWebglReady(false);
      };
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);
      pointerTarget?.addEventListener('pointermove', onPointerMove, { passive: true });
      frame = requestAnimationFrame(render);
      setWebglReady(true);

      destroy = () => {
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        pointerTarget?.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        ringGeometry.dispose();
        ringMaterials.forEach(material => material.dispose());
        particleGeometry.dispose();
        particleMaterial.dispose();
        grid.geometry.dispose();
        gridMaterials.forEach(material => material.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => setWebglReady(false));

    return () => {
      disposed = true;
      destroy?.();
      setWebglReady(false);
    };
  }, [active, palette.glow, palette.primary, palette.secondary, palette.seed]);

  return <div
    className={`immersive-backdrop ${webglReady ? 'webgl-ready' : 'css-fallback'} stage-${stage}`}
    aria-hidden="true"
    style={{
      '--scene-primary': palette.primary,
      '--scene-secondary': palette.secondary,
      '--scene-glow': palette.glow,
      '--scene-cover': coverUrl ? `url("${coverUrl.replaceAll('"', '%22')}")` : 'none',
    } as React.CSSProperties}
  >
    <div className="ambient-cover"/>
    <div className="css-orbit orbit-one"/>
    <div className="css-orbit orbit-two"/>
    <div className="css-scene-grid"/>
    <div className="immersive-webgl-host" ref={hostRef}/>
  </div>;
}
