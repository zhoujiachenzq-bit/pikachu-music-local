import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { selectSceneQuality, shouldAnimateCssScene, type ToneThemeId } from './visualTheme';
import type { StageMode, VisualPalette } from './visualState';

interface ImmersiveBackdropProps {
  coverUrl?: string | null;
  motionEnabled: boolean;
  palette: VisualPalette;
  playing: boolean;
  progress: number;
  stage: StageMode;
  theme: ToneThemeId;
}

function capability(): { width: number; reducedMotion: boolean } {
  return {
    width: window.innerWidth,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

/** A single, focused scene behind the center player stage. */
export function ImmersiveBackdrop({
  coverUrl,
  motionEnabled,
  palette,
  playing,
  progress,
  stage,
  theme,
}: ImmersiveBackdropProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const live = useRef({ playing, progress, stage });
  const [webglReady, setWebglReady] = useState(false);
  const [device, setDevice] = useState(capability);
  const quality = selectSceneQuality({ ...device, motionEnabled, fullMobile: true });
  const cssMotionActive = shouldAnimateCssScene({ motionEnabled, reducedMotion: device.reducedMotion });

  useEffect(() => {
    live.current = { playing, progress, stage };
  }, [playing, progress, stage]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setDevice(capability()));
    };
    window.addEventListener('resize', update);
    media.addEventListener('change', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      media.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || quality === 'off') {
      setWebglReady(false);
      return;
    }

    let disposed = false;
    let destroy: (() => void) | undefined;
    setWebglReady(false);

    void import('three').then(THREE => {
      if (disposed || !hostRef.current) return;

      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: quality === 'desktop',
        powerPreference: 'low-power',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'desktop' ? 1.5 : 1.25));
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.className = 'immersive-webgl-canvas';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      host.append(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(48, 1, .1, 40);
      camera.position.set(0, .12, 5.2);
      const group = new THREE.Group();
      scene.add(group);

      const geometries: Array<{ dispose: () => void }> = [];
      const materials: Array<{ dispose: () => void }> = [];
      const ringGeometry = new THREE.TorusGeometry(1.4, .014, 6, quality === 'desktop' ? 120 : 72);
      geometries.push(ringGeometry);
      const ringColors = [palette.primary, palette.secondary, palette.glow];
      const rings = ringColors.map((color, index) => {
        const material = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: [.58, .34, .2][index],
        });
        materials.push(material);
        const ring = new THREE.Mesh(ringGeometry, material);
        ring.scale.setScalar(1 + index * .34);
        ring.rotation.x = .5 + index * .18;
        ring.rotation.y = index * .54;
        group.add(ring);
        return ring;
      });

      let seed = palette.seed || 1;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0xffffffff;
      };
      const particleCount = quality === 'desktop' ? 180 : 84;
      const positions = new Float32Array(particleCount * 3);
      for (let index = 0; index < particleCount; index += 1) {
        positions[index * 3] = (random() - .5) * 7.2;
        positions[index * 3 + 1] = (random() - .5) * 4.8;
        positions[index * 3 + 2] = (random() - .5) * 5.8;
      }
      const particleGeometry = new THREE.BufferGeometry();
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometries.push(particleGeometry);
      const particleMaterial = new THREE.PointsMaterial({
        color: palette.glow,
        size: quality === 'desktop' ? .038 : .05,
        transparent: true,
        opacity: .58,
        sizeAttenuation: true,
      });
      materials.push(particleMaterial);
      const particles = new THREE.Points(particleGeometry, particleMaterial);
      scene.add(particles);

      const grid = new THREE.GridHelper(12, quality === 'desktop' ? 24 : 14, palette.secondary, palette.primary);
      grid.position.set(0, -1.62, -1.8);
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMaterials.forEach(material => {
        material.transparent = true;
        material.opacity = .095;
        materials.push(material);
      });
      geometries.push(grid.geometry);
      scene.add(grid);

      let pointerX = 0;
      let pointerY = 0;
      let animationFrame = 0;
      let lastRender = 0;
      const onPointerMove = (event: PointerEvent) => {
        if (quality !== 'desktop') return;
        const rect = host.getBoundingClientRect();
        pointerX = ((event.clientX - rect.left) / Math.max(1, rect.width) - .5) * 2;
        pointerY = ((event.clientY - rect.top) / Math.max(1, rect.height) - .5) * 2;
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
        animationFrame = requestAnimationFrame(render);
        if (document.visibilityState !== 'visible') return;
        const interval = live.current.playing
          ? (quality === 'desktop' ? 33 : 50)
          : (quality === 'desktop' ? 140 : 220);
        if (stamp - lastRender < interval) return;
        lastRender = stamp;
        const speed = live.current.playing ? 1 : .16;
        rings.forEach((ring, index) => {
          ring.rotation.z += (.0019 + index * .0008) * speed;
          ring.rotation.y += (.0011 + index * .0005) * speed;
        });
        particles.rotation.y += .0005 * speed;
        particles.rotation.z = Math.sin(stamp * .00012) * .055;
        group.rotation.z = live.current.progress * Math.PI * .12 + (live.current.stage === 'daily' ? .08 : 0);
        camera.position.x += (pointerX * .18 - camera.position.x) * .04;
        camera.position.y += (-pointerY * .13 + .12 - camera.position.y) * .04;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      };
      const onContextLost = (event: Event) => {
        event.preventDefault();
        cancelAnimationFrame(animationFrame);
        setWebglReady(false);
      };
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);
      host.addEventListener('pointermove', onPointerMove, { passive: true });
      animationFrame = requestAnimationFrame(render);
      setWebglReady(true);

      destroy = () => {
        cancelAnimationFrame(animationFrame);
        resizeObserver.disconnect();
        host.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        geometries.forEach(resource => resource.dispose());
        materials.forEach(resource => resource.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => setWebglReady(false));

    return () => {
      disposed = true;
      destroy?.();
    };
  }, [motionEnabled, palette.glow, palette.primary, palette.secondary, palette.seed, quality]);

  return <div
    className={`immersive-backdrop quality-${quality} ${webglReady ? 'webgl-ready' : 'css-fallback'} ${cssMotionActive ? 'motion-active' : 'motion-still'} ${playing ? 'is-playing' : 'is-paused'} stage-${stage}`}
    data-theme={theme}
    aria-hidden="true"
    style={{
      '--scene-primary': palette.primary,
      '--scene-secondary': palette.secondary,
      '--scene-glow': palette.glow,
      '--scene-cover': coverUrl ? `url("${coverUrl.replaceAll('"', '%22')}")` : 'none',
    } as CSSProperties}
  >
    <div className="ambient-cover"/>
    <div className="css-orbit orbit-one"/>
    <div className="css-orbit orbit-two"/>
    <div className="css-scene-grid"/>
    <div className="immersive-webgl-host" ref={hostRef}/>
  </div>;
}
