import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { sceneVariantForTheme, selectSceneQuality, shouldAnimateCssScene, type ToneThemeId } from './visualTheme';
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
  const variant = sceneVariantForTheme(theme);
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
      let seed = palette.seed || 1;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0xffffffff;
      };
      const ringCount = variant === 'vinyl' ? 8 : variant === 'arcade' ? 0 : 3;
      const ringGeometry = new THREE.TorusGeometry(1.4, variant === 'vinyl' ? .008 : .014, 6, quality === 'desktop' ? 120 : 72);
      geometries.push(ringGeometry);
      const ringColors = variant === 'vinyl'
        ? [palette.glow, palette.secondary, palette.glow]
        : [palette.primary, palette.secondary, palette.glow];
      const rings = Array.from({ length: ringCount }, (_, index) => {
        const material = new THREE.MeshBasicMaterial({
          color: ringColors[index % ringColors.length],
          transparent: true,
          opacity: variant === 'vinyl' ? Math.max(.08, .31 - index * .027) : [.62, .38, .22][index] || .16,
        });
        materials.push(material);
        const ring = new THREE.Mesh(ringGeometry, material);
        const baseScale = variant === 'vinyl' ? .72 + index * .15 : 1 + index * .34;
        if (variant === 'vinyl') {
          ring.scale.set(baseScale * (1 + ((index % 3) - 1) * .025), baseScale * (.73 + (index % 2) * .035), baseScale);
        } else {
          ring.scale.setScalar(baseScale);
        }
        ring.userData.baseScale = baseScale;
        if (variant === 'vinyl') {
          ring.rotation.z = index * .07;
          ring.position.z = -.45 - index * .025;
        } else {
          ring.rotation.x = .5 + index * .18;
          ring.rotation.y = index * .54;
        }
        group.add(ring);
        return ring;
      });

      const energyMaterials: Array<{ opacity: number; dispose: () => void }> = [];
      if (variant === 'energy') {
        const boltPositions: number[] = [];
        for (let bolt = 0; bolt < 9; bolt += 1) {
          const angle = random() * Math.PI * 2;
          let x = Math.cos(angle) * (1.15 + random() * .35);
          let y = Math.sin(angle) * (1.15 + random() * .35);
          let z = -.35 + random() * .3;
          for (let segment = 0; segment < 5; segment += 1) {
            const distance = .22 + random() * .34;
            const nextX = x + Math.cos(angle + (random() - .5) * .7) * distance;
            const nextY = y + Math.sin(angle + (random() - .5) * .7) * distance;
            const nextZ = z + (random() - .5) * .18;
            boltPositions.push(x, y, z, nextX, nextY, nextZ);
            x = nextX; y = nextY; z = nextZ;
          }
        }
        const boltGeometry = new THREE.BufferGeometry();
        boltGeometry.setAttribute('position', new THREE.Float32BufferAttribute(boltPositions, 3));
        geometries.push(boltGeometry);
        const boltMaterial = new THREE.LineBasicMaterial({ color: palette.primary, transparent: true, opacity: .3 });
        materials.push(boltMaterial); energyMaterials.push(boltMaterial);
        group.add(new THREE.LineSegments(boltGeometry, boltMaterial));
      }

      if (variant === 'arcade') {
        const frameMaterial = new THREE.LineBasicMaterial({ color: palette.glow, transparent: true, opacity: .24 });
        materials.push(frameMaterial);
        for (let index = 0; index < 3; index += 1) {
          const boxGeometry = new THREE.BoxGeometry(2.4 + index * .72, 1.45 + index * .48, .32 + index * .22);
          const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
          geometries.push(boxGeometry, edgesGeometry);
          const frame = new THREE.LineSegments(edgesGeometry, frameMaterial);
          frame.rotation.z = index * .13;
          frame.position.z = -.45 - index * .28;
          group.add(frame);
        }
      }

      const baseParticleCount = quality === 'desktop' ? 180 : 84;
      const particleCount = variant === 'arcade' ? Math.round(baseParticleCount * .82) : variant === 'vinyl' ? Math.round(baseParticleCount * .7) : baseParticleCount;
      const positions = new Float32Array(particleCount * 3);
      for (let index = 0; index < particleCount; index += 1) {
        if (variant === 'energy') {
          const angle = random() * Math.PI * 2; const radius = .9 + random() * 3.1;
          positions[index * 3] = Math.cos(angle) * radius;
          positions[index * 3 + 1] = Math.sin(angle) * radius * .72;
          positions[index * 3 + 2] = (random() - .5) * 4.2;
        } else if (variant === 'arcade') {
          positions[index * 3] = Math.round((random() - .5) * 20) / 2.5;
          positions[index * 3 + 1] = Math.round((random() - .5) * 14) / 2.5;
          positions[index * 3 + 2] = Math.round((random() - .5) * 12) / 2.5;
        } else {
          positions[index * 3] = (random() - .5) * (variant === 'vinyl' ? 5.8 : 7.2);
          positions[index * 3 + 1] = (random() - .5) * (variant === 'vinyl' ? 4 : 4.8);
          positions[index * 3 + 2] = (random() - .5) * (variant === 'vinyl' ? 3.2 : 5.8);
        }
      }
      const particleGeometry = new THREE.BufferGeometry();
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometries.push(particleGeometry);
      const particleMaterial = new THREE.PointsMaterial({
        color: variant === 'arcade' ? palette.secondary : palette.glow,
        size: quality === 'desktop' ? (variant === 'arcade' ? .052 : .038) : .05,
        transparent: true,
        opacity: variant === 'vinyl' ? .36 : .58,
        sizeAttenuation: true,
      });
      materials.push(particleMaterial);
      const particles = new THREE.Points(particleGeometry, particleMaterial);
      scene.add(particles);

      const grid = new THREE.GridHelper(12, quality === 'desktop' ? 24 : 14, variant === 'arcade' ? palette.glow : palette.secondary, palette.primary);
      if (variant === 'vinyl') {
        grid.position.set(0, 0, -1.8);
        grid.rotation.x = Math.PI / 2;
        grid.scale.setScalar(.72);
      } else {
        grid.position.set(0, -1.62, -1.8);
      }
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMaterials.forEach(material => {
        material.transparent = true;
        material.opacity = variant === 'arcade' ? .16 : variant === 'vinyl' ? .035 : .095;
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
        if (variant === 'energy') {
          rings.forEach((ring, index) => {
            ring.rotation.z += (.0025 + index * .001) * speed;
            ring.rotation.y += (.0014 + index * .0007) * speed;
            const pulse = ring.userData.baseScale * (1 + Math.sin(stamp * .0022 + index) * .018 * speed);
            ring.scale.setScalar(pulse);
          });
          energyMaterials.forEach((material, index) => { material.opacity = .18 + Math.abs(Math.sin(stamp * .004 + index)) * (live.current.playing ? .42 : .12); });
          particles.rotation.y += .0008 * speed;
          particles.scale.setScalar(1 + Math.sin(stamp * .0016) * .025 * speed);
          group.rotation.z = live.current.progress * Math.PI * .16 + (live.current.stage === 'daily' ? .08 : 0);
        } else if (variant === 'vinyl') {
          rings.forEach((ring, index) => { ring.rotation.z += (.0005 + index * .00008) * speed; });
          particles.rotation.z -= .00022 * speed;
          particles.position.y = Math.sin(stamp * .00034) * .05;
          group.rotation.z += .00032 * speed;
        } else if (variant === 'arcade') {
          group.rotation.y = Math.sin(stamp * .00042) * .12;
          group.rotation.z = live.current.progress * Math.PI * .06 + Math.sin(stamp * .0003) * .025;
          particles.position.y = Math.sin(stamp * .0011) * .08;
          particles.rotation.y += .0003 * speed;
        } else {
          rings.forEach((ring, index) => {
            ring.rotation.z += (.0019 + index * .0008) * speed;
            ring.rotation.y += (.0011 + index * .0005) * speed;
          });
          particles.rotation.y += .0005 * speed;
          particles.rotation.z = Math.sin(stamp * .00012) * .055;
          group.rotation.z = live.current.progress * Math.PI * .12 + (live.current.stage === 'daily' ? .08 : 0);
        }
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
  }, [motionEnabled, palette.glow, palette.primary, palette.secondary, palette.seed, quality, variant]);

  return <div
    className={`immersive-backdrop scene-${variant} quality-${quality} ${webglReady ? 'webgl-ready' : 'css-fallback'} ${cssMotionActive ? 'motion-active' : 'motion-still'} ${playing ? 'is-playing' : 'is-paused'} stage-${stage}`}
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
    <div className="css-theme-motif"><i/><span/><b/></div>
    <div className="immersive-webgl-host" ref={hostRef}/>
  </div>;
}
