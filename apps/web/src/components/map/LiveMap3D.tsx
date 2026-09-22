import { createEffect, onCleanup, onMount } from "solid-js";
import type * as THREE from "three";
import { ITALY_REGIONS, MAP_BOUNDS } from "~/lib/map/italy-regions";
import { dissolvedRegion } from "~/lib/map/dissolve";
import { useDark } from "~/lib/theme";
import {
  legFrame,
  retargetMotion,
  stepMotion,
  type LiveTrain,
  type MotionState,
} from "~/lib/map/interpolate";
import { statoColor } from "~/lib/map/colors";

/**
 * Map 2: true 3D Italy. Regions are extruded slabs (real ISTAT
 * boundaries), trains are glow dots hovering above the surface.
 * Drag to rotate, wheel/pinch to zoom, slow auto-spin (off under
 * prefers-reduced-motion). Pan is locked so Italy stays centered.
 *
 * Client-only: three + OrbitControls load dynamically in onMount,
 * nothing ships to SSR.
 */

const MAX = 2048;
const WORLD = 140; // world units across the bounds square
const SLAB = 2.5; // extrusion height
const HOVER_Y = 3.6; // train dot altitude: just above the slab top

function toWorld(lon: number, lat: number): [number, number] {
  const x =
    ((lon - MAP_BOUNDS.minLon) / (MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon)) *
      WORLD -
    WORLD / 2;
  const z =
    ((MAP_BOUNDS.maxLat - lat) / (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat)) *
      WORLD -
    WORLD / 2;
  return [x, z];
}

function sizeForStato(stato: string): number {
  switch (stato) {
    case "heavily-delayed":
      return 3.5;
    case "delayed":
    case "partial":
      return 3;
    default:
      return 2.5;
  }
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export default function LiveMap3D(props: { trains: LiveTrain[] }) {
  let canvas: HTMLCanvasElement | undefined;
  const dark = useDark();

  onMount(() => {
    let cancelled = false;
    const motion = new Map<number, MotionState>();

    (async () => {
      const T = await import("three");
      const { OrbitControls } = await import(
        "three/addons/controls/OrbitControls.js"
      );
      if (cancelled || !canvas) return;
      const el = canvas;
      const parent = el.parentElement;

      const renderer = new T.WebGLRenderer({
        canvas: el,
        alpha: true,
        antialias: true,
      });
      renderer.setClearColor(0x000000, 0);

      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(38, 1, 1, 2000);
      camera.position.set(45, 155, 235);

      const hemi = new T.HemisphereLight(0xe4e4e7, 0x09090b, 0.9);
      scene.add(hemi);
      const sun = new T.DirectionalLight(0xffffff, 1.4);
      sun.position.set(80, 150, 60);
      scene.add(sun);

      // Italy slabs + border edges (dissolved per region: no internal
      // province borders, islands kept as separate slabs).
      const slabMat = new T.MeshStandardMaterial({
        color: 0x232329,
        roughness: 0.85,
        metalness: 0.1,
      });
      const edgeMat = new T.LineBasicMaterial({ color: 0x8b8b96 });
      const italy = new T.Group();
      const toXZ = ([lo, la]: [number, number]): [number, number] => {
        const [x, z] = toWorld(lo, la);
        return [x, -z];
      };
      for (const region of ITALY_REGIONS) {
        for (const poly of dissolvedRegion(region.id)) {
          const outer = poly[0];
          if (!outer || outer.length < 4) continue;
          const shape = new T.Shape();
          outer.forEach((p, i) => {
            const [x, z] = toXZ(p);
            if (i === 0) shape.moveTo(x, z);
            else shape.lineTo(x, z);
          });
          shape.closePath();
          for (const hole of poly.slice(1)) {
            if (hole.length < 4) continue;
            const h = new T.Path();
            hole.forEach((p, i) => {
              const [x, z] = toXZ(p);
              if (i === 0) h.moveTo(x, z);
              else h.lineTo(x, z);
            });
            h.closePath();
            shape.holes.push(h);
          }
          const geo = new T.ExtrudeGeometry(shape, {
            depth: SLAB,
            bevelEnabled: false,
          });
          const mesh = new T.Mesh(geo, slabMat);
          mesh.rotation.x = -Math.PI / 2;
          italy.add(mesh);
          const edges = new T.LineSegments(
            new T.EdgesGeometry(geo, 25),
            edgeMat,
          );
          edges.rotation.x = -Math.PI / 2;
          edges.position.y = 0.15;
          italy.add(edges);
        }
      }
      scene.add(italy);

      // Faint floor grid for depth while rotating. Rebuilt on theme
      // change (GridHelper bakes colors into vertices).
      let grid: THREE.GridHelper | null = null;
      const buildGrid = (isDark: boolean) => {
        if (grid) {
          scene.remove(grid);
          grid.geometry.dispose();
          (grid.material as THREE.Material).dispose();
        }
        grid = new T.GridHelper(
          340,
          26,
          isDark ? 0x3f3f46 : 0xa1a1aa,
          isDark ? 0x232329 : 0xe4e4e7,
        );
        grid.position.y = -4;
        const gridMat = grid.material as THREE.Material;
        gridMat.transparent = true;
        gridMat.opacity = 0.4;
        scene.add(grid);
      };
      createEffect(() => {
        if (cancelled) return;
        const isDark = dark();
        slabMat.color.set(isDark ? 0x232329 : 0xd4d4d8);
        edgeMat.color.set(isDark ? 0x8b8b96 : 0x52525b);
        hemi.color.set(isDark ? 0xe4e4e7 : 0xffffff);
        hemi.groundColor.set(isDark ? 0x09090b : 0xd4d4d8);
        buildGrid(isDark);
      });

      // Train dots: single ShaderMaterial point cloud with SDF-crisp
      // discs (hard core + tight halo, 1px fwidth AA). Constant screen
      // size via uScale perspective term — no texture, no mipmap blur.
      const DOT_SCALE = 280; // ≈ default camera distance: base px at rest
      const positions = new Float32Array(MAX * 3);
      const colors = new Float32Array(MAX * 3);
      const sizes = new Float32Array(MAX);
      const geo = new T.BufferGeometry();
      const posAttr = new T.BufferAttribute(positions, 3);
      const colAttr = new T.BufferAttribute(colors, 3);
      const sizeAttr = new T.BufferAttribute(sizes, 1);
      geo.setAttribute("position", posAttr);
      geo.setAttribute("color", colAttr);
      geo.setAttribute("aSize", sizeAttr);
      const dotsMat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        vertexColors: true,
        uniforms: {
          uPixelRatio: {
            value: Math.min(window.devicePixelRatio || 1, 2),
          },
          uScale: { value: DOT_SCALE },
          uHalo: { value: 0.35 },
        },
        vertexShader: /* glsl */ `
          attribute float aSize;
          varying vec3 vColor;
          uniform float uPixelRatio;
          uniform float uScale;
          void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 1.0);
            float px = aSize * uPixelRatio * (uScale / dist);
            gl_PointSize = clamp(px, 2.0, 28.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          uniform float uHalo;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
            if (d > 1.0) discard;
            float aa = fwidth(d) + 1e-4;
            float core = 1.0 - smoothstep(0.52 - aa, 0.52 + aa, d);
            float halo = (1.0 - smoothstep(0.5, 1.0, d)) * uHalo;
            vec3 col = mix(vColor, vec3(1.0), core * 0.25);
            float alpha = max(core, halo);
            if (alpha < 0.02) discard;
            gl_FragColor = vec4(col, alpha);
          }
        `,
      });
      const dots = new T.Points(geo, dotsMat);
      dots.frustumCulled = false;
      dots.renderOrder = 10;
      scene.add(dots);

      const controls = new OrbitControls(camera, el);
      controls.target.set(0, 0, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.minDistance = 110;
      controls.maxDistance = 480;
      controls.minPolarAngle = 0.12;
      controls.maxPolarAngle = 1.32;
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      controls.autoRotate = !reduced;
      controls.autoRotateSpeed = 0.9;

      const fit = () => {
        const cw = parent?.clientWidth ?? 0;
        const ch = parent?.clientHeight ?? 0;
        if (cw === 0 || ch === 0) return;
        const pr = Math.min(window.devicePixelRatio || 1, 2);
        renderer.setPixelRatio(pr);
        dotsMat.uniforms.uPixelRatio.value = pr;
        renderer.setSize(cw, ch, false);
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
      };
      fit();
      const ro = new ResizeObserver(fit);
      if (parent) ro.observe(parent);

      let raf = 0;
      let last = performance.now();
      const frame = (t: number) => {
        if (cancelled) return;
        raf = requestAnimationFrame(frame);
        const dt = Math.min(t - last, 250);
        last = t;
        const list = props.trains.slice(0, MAX);
        // Wall clock drives the timetable; rAF delta drives integration.
        // rAF stalls when the tab is hidden, dt clamp covers the gap.
        const nowMs = Date.now();
        const seen = new Set<number>();
        for (let i = 0; i < list.length; i++) {
          const tr = list[i];
          seen.add(tr.runId);
          const [ax, az] = toWorld(tr.prev.lon, tr.prev.lat);
          const [bx, bz] = toWorld(tr.next.lon, tr.next.lat);
          // Interpolate in world XZ so long legs keep constant speed
          // in screen space instead of raw lat/lon.
          const lf = legFrame(tr, ax, az, bx, bz, nowMs);
          let st = motion.get(tr.runId);
          st = retargetMotion(st, tr, lf);
          st = stepMotion(st, dt / 1000);
          motion.set(tr.runId, st);
          positions[i * 3] = st.x;
          positions[i * 3 + 1] = HOVER_Y;
          positions[i * 3 + 2] = st.z;
          sizes[i] = sizeForStato(tr.stato);
          const [r, gg, b] = hexToRgb(statoColor(tr.stato));
          colors[i * 3] = r;
          colors[i * 3 + 1] = gg;
          colors[i * 3 + 2] = b;
        }
        if (motion.size > list.length * 2) {
          for (const id of [...motion.keys()]) {
            if (!seen.has(id)) motion.delete(id);
          }
        }
        geo.setDrawRange(0, list.length);
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
        controls.update();
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(frame);

      onCleanup(() => {
        cancelled = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
        });
        dotsMat.dispose();
        renderer.dispose();
      });
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  return (
    <canvas
      ref={canvas}
      aria-label="mappa 3D dell'Italia con treni in viaggio: trascina per ruotare, rotella per zoomare"
      class="absolute inset-0 block h-full w-full touch-pan-y"
    />
  );
}
