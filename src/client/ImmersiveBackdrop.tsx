import { useEffect, useRef, useState } from 'react';
import { selectSceneQuality, type SceneQuality, type ToneThemeId } from './visualTheme';
import type { StageMode, VisualPalette } from './visualState';

interface SharedSceneProps {
  motionEnabled: boolean;
  palette: VisualPalette;
  playing: boolean;
  progress: number;
  stage: StageMode;
  theme: ToneThemeId;
}

function capability(): { width: number; reducedMotion: boolean } {
  return { width: window.innerWidth, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
}

export function ImmersiveWorkspaceScene({ motionEnabled, palette, playing, progress, stage, theme }: SharedSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const live = useRef({ playing, progress, stage });
  const [webglReady, setWebglReady] = useState(false);
  const [device, setDevice] = useState(capability);
  const quality = selectSceneQuality({ ...device, motionEnabled });

  useEffect(() => { live.current = { playing, progress, stage }; }, [playing, progress, stage]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setDevice(capability()));
    };
    window.addEventListener('resize', update);
    media.addEventListener('change', update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); media.removeEventListener('change', update); };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const workspace = host?.parentElement;
    if (!host || !workspace || quality === 'off') { setWebglReady(false); return; }
    let disposed = false;
    let destroy: (() => void) | undefined;
    setWebglReady(false);

    void import('three').then(THREE => {
      if (disposed || !hostRef.current) return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: quality === 'desktop', powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'desktop' ? 1.5 : 1.25));
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = false;
      renderer.domElement.className = 'immersive-shared-canvas immersive-webgl-canvas';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      host.append(renderer.domElement);

      const geometries: Array<{ dispose: () => void }> = [];
      const materials: Array<{ dispose: () => void }> = [];
      const makeMaterial = (color: string, opacity: number) => {
        const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity }); materials.push(material); return material;
      };
      const makePoints = (count: number, spreadX: number, spreadY: number, depth: number, color: string, seedStart: number) => {
        let seed = seedStart || 1;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0xffffffff; };
        const positions = new Float32Array(count * 3);
        for (let index = 0; index < count; index += 1) {
          positions[index * 3] = (random() - .5) * spreadX;
          positions[index * 3 + 1] = (random() - .5) * spreadY;
          positions[index * 3 + 2] = (random() - .5) * depth;
        }
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometries.push(geometry);
        const material = new THREE.PointsMaterial({ color, size: quality === 'desktop' ? .035 : .05, transparent: true, opacity: .46, sizeAttenuation: true }); materials.push(material);
        return new THREE.Points(geometry, material);
      };
      const createCamera = () => { const camera = new THREE.PerspectiveCamera(48, 1, .1, 40); camera.position.set(0, .12, 5.2); return camera; };

      const searchScene = new THREE.Scene(); const searchCamera = createCamera(); const searchGroup = new THREE.Group(); searchScene.add(searchGroup);
      const searchPositions: number[] = [];
      const searchLines = quality === 'desktop' ? 22 : 13;
      for (let index = 0; index < searchLines; index += 1) {
        const y = -2.2 + index * (4.4 / Math.max(1, searchLines - 1));
        searchPositions.push(-3.4, y, -1.1 + index * .025, 3.4, y, -1.1 + index * .025);
      }
      const searchGeometry = new THREE.BufferGeometry(); searchGeometry.setAttribute('position', new THREE.Float32BufferAttribute(searchPositions, 3)); geometries.push(searchGeometry);
      const searchMaterial = new THREE.LineBasicMaterial({ color: palette.secondary, transparent: true, opacity: .12 }); materials.push(searchMaterial);
      searchGroup.add(new THREE.LineSegments(searchGeometry, searchMaterial));
      const searchParticles = makePoints(quality === 'desktop' ? 105 : 54, 5.6, 5.2, 3.4, palette.glow, palette.seed + 31); searchScene.add(searchParticles);
      const scanGeometry = new THREE.PlaneGeometry(5.8, .015); geometries.push(scanGeometry);
      const scanMaterial = makeMaterial(palette.primary, .28); const scanLine = new THREE.Mesh(scanGeometry, scanMaterial); scanLine.position.z = -.2; searchGroup.add(scanLine);

      const playerScene = new THREE.Scene(); const playerCamera = createCamera(); const playerGroup = new THREE.Group(); playerScene.add(playerGroup);
      const ringGeometry = new THREE.TorusGeometry(1.45, .012, 6, quality === 'desktop' ? 120 : 64); geometries.push(ringGeometry);
      const ringMaterials = [makeMaterial(palette.primary, .48), makeMaterial(palette.secondary, .29), makeMaterial(palette.glow, .13)];
      const rings = ringMaterials.map((material, index) => {
        const ring = new THREE.Mesh(ringGeometry, material); ring.scale.setScalar(1 + index * .34); ring.rotation.x = .52 + index * .18; ring.rotation.y = index * .55; playerGroup.add(ring); return ring;
      });
      const playerParticles = makePoints(quality === 'desktop' ? 160 : 76, 7.2, 4.6, 5.6, palette.glow, palette.seed); playerScene.add(playerParticles);
      const grid = new THREE.GridHelper(12, quality === 'desktop' ? 24 : 14, palette.secondary, palette.primary); grid.position.set(0, -1.62, -1.8);
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]; gridMaterials.forEach(material => { material.transparent = true; material.opacity = .065; materials.push(material); }); geometries.push(grid.geometry); playerScene.add(grid);

      const libraryScene = new THREE.Scene(); const libraryCamera = createCamera(); const libraryGroup = new THREE.Group(); libraryScene.add(libraryGroup);
      const barGeometry = new THREE.BoxGeometry(.14, 1, .12); geometries.push(barGeometry);
      const barMaterial = makeMaterial(palette.secondary, .18);
      const bars = Array.from({ length: quality === 'desktop' ? 17 : 11 }, (_, index) => {
        const bar = new THREE.Mesh(barGeometry, barMaterial); bar.position.x = (index - ((quality === 'desktop' ? 17 : 11) - 1) / 2) * .31; bar.position.y = -1.48; bar.position.z = -.7; libraryGroup.add(bar); return bar;
      });
      const libraryParticles = makePoints(quality === 'desktop' ? 92 : 45, 5.4, 5, 3.6, palette.glow, palette.seed + 79); libraryScene.add(libraryParticles);

      const regions = [
        { name: 'search', scene: searchScene, camera: searchCamera },
        { name: 'player', scene: playerScene, camera: playerCamera },
        { name: 'library', scene: libraryScene, camera: libraryCamera },
      ];
      let pointerX = 0; let pointerY = 0; let animationFrame = 0; let lastRender = 0;
      const onPointerMove = (event: PointerEvent) => {
        if (quality !== 'desktop') return;
        const rect = workspace.getBoundingClientRect(); pointerX = ((event.clientX - rect.left) / Math.max(1, rect.width) - .5) * 2; pointerY = ((event.clientY - rect.top) / Math.max(1, rect.height) - .5) * 2;
      };
      const resize = () => renderer.setSize(Math.max(1, workspace.clientWidth), Math.max(1, workspace.clientHeight), false);
      const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(workspace); resize();

      const renderRegion = (name: string, scene: InstanceType<typeof THREE.Scene>, camera: InstanceType<typeof THREE.PerspectiveCamera>) => {
        const panel = workspace.querySelector<HTMLElement>(`[data-scene-region="${name}"]`); if (!panel || panel.offsetParent === null) return;
        const rootRect = workspace.getBoundingClientRect(); const rect = panel.getBoundingClientRect();
        const x = Math.max(0, rect.left - rootRect.left); const top = Math.max(0, rect.top - rootRect.top); const width = Math.min(rect.width, rootRect.width - x); const height = Math.min(rect.height, rootRect.height - top);
        if (width <= 1 || height <= 1) return;
        const y = rootRect.height - top - height;
        renderer.setViewport(x, y, width, height); renderer.setScissor(x, y, width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.render(scene, camera);
      };
      const render = (stamp: number) => {
        animationFrame = requestAnimationFrame(render);
        if (document.visibilityState !== 'visible') return;
        const interval = live.current.playing ? (quality === 'desktop' ? 33 : 50) : (quality === 'desktop' ? 140 : 220);
        if (stamp - lastRender < interval) return; lastRender = stamp;
        const speed = live.current.playing ? 1 : .16;
        scanLine.position.y = ((stamp * .00022) % 4.8) - 2.4; searchParticles.rotation.z = Math.sin(stamp * .00016) * .035; searchParticles.rotation.y += .00035 * speed;
        rings.forEach((ring, index) => { ring.rotation.z += (.0017 + index * .0007) * speed; ring.rotation.y += (.001 + index * .0005) * speed; });
        playerParticles.rotation.y += .00045 * speed; playerParticles.rotation.z = Math.sin(stamp * .00012) * .05; playerGroup.rotation.z = live.current.progress * Math.PI * .12 + (live.current.stage === 'daily' ? .07 : 0);
        bars.forEach((bar, index) => { const pulse = .16 + Math.abs(Math.sin(stamp * .0013 + index * .72 + live.current.progress * 6)) * (live.current.playing ? 1.5 : .35); bar.scale.y = pulse; bar.position.y = -1.68 + pulse / 2; });
        libraryParticles.rotation.y -= .00032 * speed;
        for (const camera of [searchCamera, playerCamera, libraryCamera]) { camera.position.x += (pointerX * .17 - camera.position.x) * .04; camera.position.y += (-pointerY * .12 + .12 - camera.position.y) * .04; camera.lookAt(0, 0, 0); }
        renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true); regions.forEach(region => renderRegion(region.name, region.scene, region.camera)); renderer.setScissorTest(false);
      };
      const onContextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(animationFrame); setWebglReady(false); };
      renderer.domElement.addEventListener('webglcontextlost', onContextLost); workspace.addEventListener('pointermove', onPointerMove, { passive: true });
      animationFrame = requestAnimationFrame(render); setWebglReady(true);

      destroy = () => {
        cancelAnimationFrame(animationFrame); resizeObserver.disconnect(); workspace.removeEventListener('pointermove', onPointerMove); renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        geometries.forEach(resource => resource.dispose()); materials.forEach(resource => resource.dispose()); renderer.dispose(); renderer.domElement.remove();
      };
    }).catch(() => setWebglReady(false));

    return () => { disposed = true; destroy?.(); setWebglReady(false); };
  }, [motionEnabled, palette.glow, palette.primary, palette.secondary, palette.seed, quality, theme]);

  return <div className={`immersive-workspace-scene quality-${quality} ${webglReady ? 'webgl-ready' : 'css-fallback'}`} data-theme={theme} aria-hidden="true"><div className="immersive-webgl-host" ref={hostRef}/></div>;
}

export function PlayerAtmosphere({ coverUrl, palette, stage }: { coverUrl?: string | null; palette: VisualPalette; stage: StageMode }) {
  return <div
    className={`immersive-backdrop css-atmosphere stage-${stage}`}
    aria-hidden="true"
    style={{
      '--scene-primary': palette.primary,
      '--scene-secondary': palette.secondary,
      '--scene-glow': palette.glow,
      '--scene-cover': coverUrl ? `url("${coverUrl.replaceAll('"', '%22')}")` : 'none',
    } as React.CSSProperties}
  ><div className="ambient-cover"/><div className="css-orbit orbit-one"/><div className="css-orbit orbit-two"/><div className="css-scene-grid"/></div>;
}
