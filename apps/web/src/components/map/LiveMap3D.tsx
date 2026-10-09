import {
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
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
import { loadRailwaySegments, type RailwaySegment } from "~/lib/map/italy-railways";
import { loadStationMarkers, type StationMarker } from "~/lib/map/italy-stations";

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
// Everything on the map must sit ABOVE the slab top (y = SLAB), otherwise
// it is occluded by the extruded regions.
const TRACK_Y = SLAB + 0.1; // railway lines: just above the slab top
const STATION_Y = SLAB + 0.16; // station markers: a touch higher
const HOVER_Y = 3.6; // train dot altitude: above tracks/stations

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

// Base point sizes in the same units as the station markers (major 2.0,
// minor 1.2): train dots are kept small, with a subtle status bump.
function sizeForStato(stato: string): number {
  switch (stato) {
    case "heavily-delayed":
      return 2.2;
    case "delayed":
    case "partial":
      return 1.8;
    default:
      return 1.4;
  }
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Liang–Barsky clip of segment (x1,z1)→(x2,z2) to an axis-aligned
 * rectangle. Returns the clipped endpoints, or null if fully outside.
 * Used to trim railway lines at the edge of the map bounds.
 */
function clipSegmentToRect(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const p = [-dx, dx, -dz, dz];
  const q = [x1 - minX, maxX - x1, z1 - minZ, maxZ - z1];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null; // parallel and outside this edge
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }

  return [x1 + t0 * dx, z1 + t0 * dz, x1 + t1 * dx, z1 + t1 * dz];
}

export default function LiveMap3D(props: {
  trains: LiveTrain[];
  showTracks?: boolean;
  showStations?: boolean;
  /** Fullscreen mode unlocks pick-to-inspect + panning. */
  fullscreen?: boolean;
  /** Renders the detail HUD for a selected train (anchored to its dot). */
  renderHud?: (train: LiveTrain, close: () => void) => JSX.Element;
  /** Currently selected run id (controlled by the parent). */
  selectedRunId?: number | null;
  /** Notifies the parent when the selected train changes. */
  onSelect?: (train: LiveTrain | null) => void;
}) {
  let canvas: HTMLCanvasElement | undefined;
  let hudAnchor: HTMLDivElement | undefined;
  const dark = useDark();
  const [railwaySegments, setRailwaySegments] = createSignal<RailwaySegment[]>([]);
  const [stationMarkers, setStationMarkers] = createSignal<StationMarker[]>([]);
  const selectedTrain = createMemo(() => {
    const id = props.selectedRunId;
    if (id == null) return null;
    return props.trains.find((t) => t.runId === id) ?? null;
  });
  const clearSelection = () => props.onSelect?.(null);

  onMount(() => {
    let cancelled = false;
    // Disposal for the async-created three.js resources. Registered through
    // the synchronous onCleanup below so it runs inside the reactive owner.
    let disposeScene: (() => void) | undefined;
    const motion = new Map<number, MotionState>();

    // Load railway geometry asynchronously (fetched from /data/railways.json)
    loadRailwaySegments()
      .then((segments) => {
        if (!cancelled) setRailwaySegments(segments);
      })
      .catch((err) => console.error("Failed to load railways:", err));

    // Load station markers asynchronously (fetched from /data/stations.json)
    loadStationMarkers()
      .then((stations) => {
        if (!cancelled) setStationMarkers(stations);
      })
      .catch((err) => console.error("Failed to load stations:", err));

    (async () => {
      const T = await import("three");
      const { OrbitControls } = await import(
        "three/addons/controls/OrbitControls.js"
      );
      if (cancelled || !canvas) return;
      const el = canvas;
      const parent = el.parentElement;

      // WebGL2 renderer. (WebGPU cannot rasterise point primitives larger
      // than 1px, so the glow dots must use GLSL gl_PointSize/gl_PointCoord.)
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

      // Railway tracks: LineSegments colored by nearest train stato.
      // Built lazily in the frame loop when railwaySegments finishes loading.
      let trackLines: THREE.LineSegments | null = null;
      let trackColAttr: THREE.BufferAttribute | null = null;
      let trackPositions: number[] = [];
      let trackColors: number[] = [];

      // Spatial grid + track coloring state (built alongside geometry)
      const GRID_SIZE = 20;
      const gridWorld = WORLD / GRID_SIZE;
      let segmentMidpoints: Array<{ x: number; z: number; segIdx: number }> = [];
      let segmentVertStart: number[] = [];
      let segmentVertCount: number[] = [];
      let gridCells: Map<string, number[]> = new Map();
      let segmentWorstStato: number[] = [];
      let builtSegments: RailwaySegment[] | null = null;
      // Last train array that track colours were computed from (reference check).
      let lastTrains: LiveTrain[] | null = null;

      const statoSeverity: Record<string, number> = {
        ok: 0,
        delayed: 1,
        "heavily-delayed": 3,
        partial: 2,
        cancelled: 4,
        nodata: 4,
      };

      /**
       * Build track geometry + spatial grid from railway segments.
       * Called from the frame loop when the signal reference changes,
       * so no reactive effect is created outside a root.
       */
      function buildTracks(segments: RailwaySegment[]) {
        // Build line geometry + spatial grid in one pass, clipping every
        // segment to the map rectangle so the European connecting lines
        // stop at the edge instead of running off the map.
        const HALF = WORLD / 2;
        trackPositions = [];
        trackColors = [];
        segmentMidpoints = [];
        segmentVertStart = [];
        segmentVertCount = [];
        gridCells = new Map();
        segmentWorstStato = new Array(segments.length).fill(-1);

        let vertOffset = 0;
        for (let segIdx = 0; segIdx < segments.length; segIdx++) {
          const seg = segments[segIdx];
          segmentVertStart.push(vertOffset);

          let pushed = 0;
          let sumX = 0;
          let sumZ = 0;
          let nPts = 0;

          for (let i = 0; i < seg.geom.length - 1; i++) {
            const [lon1, lat1] = seg.geom[i];
            const [lon2, lat2] = seg.geom[i + 1];
            const [x1, z1] = toWorld(lon1, lat1);
            const [x2, z2] = toWorld(lon2, lat2);

            const clipped = clipSegmentToRect(
              x1,
              z1,
              x2,
              z2,
              -HALF,
              HALF,
              -HALF,
              HALF,
            );
            if (!clipped) continue;

            const [cx1, cz1, cx2, cz2] = clipped;
            trackPositions.push(cx1, TRACK_Y, cz1, cx2, TRACK_Y, cz2);
            trackColors.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
            pushed += 2;
            sumX += cx1 + cx2;
            sumZ += cz1 + cz2;
            nPts += 2;
          }

          segmentVertCount.push(pushed);
          vertOffset += pushed;

          // Grid midpoint from the in-bounds clipped geometry only.
          if (nPts > 0) {
            const mx = sumX / nPts;
            const mz = sumZ / nPts;
            segmentMidpoints.push({ x: mx, z: mz, segIdx });
            const gx = Math.floor((mx + HALF) / gridWorld);
            const gz = Math.floor((mz + HALF) / gridWorld);
            const key = `${gx},${gz}`;
            const cell = gridCells.get(key) ?? [];
            cell.push(segIdx);
            gridCells.set(key, cell);
          } else {
            // Fully outside — keep index alignment with segmentVertStart.
            segmentMidpoints.push({ x: 0, z: 0, segIdx });
          }
        }

        if (trackLines) {
          scene.remove(trackLines);
          trackLines.geometry.dispose();
        }

        const trackGeo = new T.BufferGeometry();
        const trackPosAttr = new T.BufferAttribute(new Float32Array(trackPositions), 3);
        trackColAttr = new T.BufferAttribute(new Float32Array(trackColors), 3);
        trackGeo.setAttribute("position", trackPosAttr);
        trackGeo.setAttribute("color", trackColAttr);

        const trackMat = new T.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.7,
        });
        trackLines = new T.LineSegments(trackGeo, trackMat);
        trackLines.frustumCulled = false;
        trackLines.renderOrder = 5;
        trackLines.visible = props.showTracks !== false;
        scene.add(trackLines);
      }

      function updateTrackColors(trains: LiveTrain[]) {
        if (!trackColAttr || trackColors.length === 0) return;

        // Reset all track colors to neutral
        for (let i = 0; i < trackColors.length; i += 3) {
          trackColors[i] = 0.5;
          trackColors[i + 1] = 0.5;
          trackColors[i + 2] = 0.5;
        }
        segmentWorstStato.fill(-1);

        for (const train of trains) {
          const [tx, tz] = toWorld(train.prev.lon, train.prev.lat);
          const [bx, bz] = toWorld(train.next.lon, train.next.lat);
          const nowMs = Date.now();
          const lf = legFrame(train, tx, tz, bx, bz, nowMs);
          const trainX = lf.idealX;
          const trainZ = lf.idealZ;

          const gx = Math.floor((trainX + WORLD / 2) / gridWorld);
          const gz = Math.floor((trainZ + WORLD / 2) / gridWorld);

          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              const key = `${gx + dx},${gz + dz}`;
              const cell = gridCells.get(key);
              if (!cell) continue;

              for (const segIdx of cell) {
                const mid = segmentMidpoints[segIdx];
                const dist = Math.hypot(trainX - mid.x, trainZ - mid.z);
                if (dist > 15) continue;

                const currentSeverity = statoSeverity[train.stato] ?? 0;
                const worstSeverity = segmentWorstStato[segIdx];

                if (worstSeverity >= 0 && currentSeverity <= worstSeverity) continue;

                segmentWorstStato[segIdx] = currentSeverity;
                const [r, g, b] = hexToRgb(statoColor(train.stato));

                const vertStart = segmentVertStart[segIdx];
                const numVerts = segmentVertCount[segIdx];
                for (let v = 0; v < numVerts; v++) {
                  const idx = (vertStart + v) * 3;
                  trackColors[idx] = r;
                  trackColors[idx + 1] = g;
                  trackColors[idx + 2] = b;
                }
              }
            }
          }
        }

        trackColAttr.needsUpdate = true;
      }

      // Station markers: tiny GLSL point sprites (SDF disc, constant screen
      // size). Geometry is built lazily once /data/stations.json loads.
      const stationMat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        uniforms: {
          uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
          uScale: { value: 280 },
          uColor: { value: new T.Color(0xffffff) },
        },
        vertexShader: /* glsl */ `
          attribute float aSize;
          uniform float uPixelRatio;
          uniform float uScale;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 1.0);
            float px = aSize * uPixelRatio * (uScale / dist);
            gl_PointSize = clamp(px, 1.5, 12.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
            if (d > 1.0) discard;
            float aa = fwidth(d) + 1e-4;
            float alpha = 1.0 - smoothstep(0.5 - aa, 0.5 + aa, d);
            if (alpha < 0.02) discard;
            gl_FragColor = vec4(uColor, alpha);
          }
        `,
      });

      let stationDots: THREE.Points | null = null;
      let builtStations: StationMarker[] | null = null;

      function buildStationDots(stations: StationMarker[]) {
        const positions = new Float32Array(stations.length * 3);
        const sizes = new Float32Array(stations.length);
        for (let i = 0; i < stations.length; i++) {
          const s = stations[i];
          const [x, z] = toWorld(s.lon, s.lat);
          positions[i * 3] = x;
          positions[i * 3 + 1] = STATION_Y;
          positions[i * 3 + 2] = z;
          sizes[i] = s.isMajor ? 2.0 : 1.2;
        }
        const geo = new T.BufferGeometry();
        geo.setAttribute("position", new T.BufferAttribute(positions, 3));
        geo.setAttribute("aSize", new T.BufferAttribute(sizes, 1));

        if (stationDots) {
          scene.remove(stationDots);
          stationDots.geometry.dispose();
        }
        stationDots = new T.Points(geo, stationMat);
        stationDots.frustumCulled = false;
        stationDots.renderOrder = 6;
        stationDots.visible = props.showStations !== false;
        scene.add(stationDots);
      }

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

      // Theme state, applied imperatively (no reactive effects outside a root)
      let lastDark: boolean | null = null;
      const applyTheme = (isDark: boolean) => {
        slabMat.color.set(isDark ? 0x232329 : 0xd4d4d8);
        edgeMat.color.set(isDark ? 0x8b8b96 : 0x52525b);
        hemi.color.set(isDark ? 0xe4e4e7 : 0xffffff);
        hemi.groundColor.set(isDark ? 0x09090b : 0xd4d4d8);
        buildGrid(isDark);
      };

      // Train dots: single GLSL point cloud with SDF-crisp discs
      // (hard core + tight halo, AA). Constant screen size via the
      // perspective term — no texture, no mipmap blur.
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

      // GLSL material: per-vertex color + size, SDF disc fragment
      // (hard core + tight halo, 1px fwidth AA, constant screen size).
      const dotsMat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        vertexColors: true,
        uniforms: {
          uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
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
            gl_PointSize = clamp(px, 1.2, 22.0);
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
      controls.minDistance = 14; // allow zooming right down to town level
      controls.maxDistance = 480;
      controls.minPolarAngle = 0.12;
      controls.maxPolarAngle = 1.32;
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      controls.autoRotate = !reduced;
      controls.autoRotateSpeed = 0.9;

      // --- Fullscreen picking: click a train dot to inspect it. ---
      const tmpVec = new T.Vector3();
      let downX = 0;
      let downY = 0;

      const projectToScreen = (x: number, z: number) => {
        tmpVec.set(x, HOVER_Y, z).project(camera);
        return {
          x: (tmpVec.x * 0.5 + 0.5) * el.clientWidth,
          y: (-tmpVec.y * 0.5 + 0.5) * el.clientHeight,
          behind: tmpVec.z > 1,
        };
      };

      const pickTrain = (clientX: number, clientY: number): LiveTrain | null => {
        const rect = el.getBoundingClientRect();
        const px = clientX - rect.left;
        const py = clientY - rect.top;
        let best: LiveTrain | null = null;
        let bestD = 18; // px pick radius
        for (const tr of props.trains.slice(0, MAX)) {
          const st = motion.get(tr.runId);
          if (!st) continue;
          const s = projectToScreen(st.x, st.z);
          if (s.behind) continue;
          const d = Math.hypot(s.x - px, s.y - py);
          if (d < bestD) {
            bestD = d;
            best = tr;
          }
        }
        return best;
      };

      const onPointerDown = (e: PointerEvent) => {
        downX = e.clientX;
        downY = e.clientY;
      };
      const onPointerUp = (e: PointerEvent) => {
        if (!props.fullscreen) return;
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
        props.onSelect?.(pickTrain(e.clientX, e.clientY));
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!props.fullscreen) {
          el.style.cursor = "";
          return;
        }
        el.style.cursor = pickTrain(e.clientX, e.clientY) ? "pointer" : "grab";
      };
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("pointerup", onPointerUp);
      el.addEventListener("pointermove", onPointerMove);

      const fit = () => {
        const cw = parent?.clientWidth ?? 0;
        const ch = parent?.clientHeight ?? 0;
        if (cw === 0 || ch === 0) return;
        const pr = Math.min(window.devicePixelRatio || 1, 2);
        renderer.setPixelRatio(pr);
        dotsMat.uniforms.uPixelRatio.value = pr;
        stationMat.uniforms.uPixelRatio.value = pr;
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

        // Lazily build tracks once railway segments finish loading.
        const segs = railwaySegments();
        if (segs.length > 0 && segs !== builtSegments) {
          buildTracks(segs);
          builtSegments = segs;
          lastTrains = null; // force a recolour on the freshly built buffer
        }

        // Lazily build station markers once they finish loading.
        const sts = stationMarkers();
        if (sts.length > 0 && sts !== builtStations) {
          buildStationDots(sts);
          builtStations = sts;
        }

        // Apply theme changes (no reactive effect; polled per frame).
        const isDark = dark();
        if (isDark !== lastDark) {
          applyTheme(isDark);
          lastDark = isDark;
        }

        // Visibility toggles from props.
        if (trackLines) trackLines.visible = props.showTracks !== false;
        if (stationDots) stationDots.visible = props.showStations !== false;

        const list = props.trains.slice(0, MAX);
        // Fullscreen unlocks panning; clicking is handled by the listeners.
        const selId = props.selectedRunId ?? null;
        controls.enablePan = props.fullscreen === true;
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
          const base = sizeForStato(tr.stato);
          sizes[i] = tr.runId === selId ? base * 1.6 + 2.5 : base;
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

        // Recolour tracks only when the train snapshot changes (12s poll),
        // NOT every frame. The track colour buffer is ~780k floats; uploading
        // it per frame was the main performance bottleneck.
        if (props.trains !== lastTrains) {
          updateTrackColors(list);
          lastTrains = props.trains;
        }

        // Anchor the HUD to the selected train's dot (screen space).
        if (selId != null && hudAnchor) {
          const st = motion.get(selId);
          if (st) {
            const s = projectToScreen(st.x, st.z);
            hudAnchor.style.transform = `translate(${s.x}px, ${s.y}px)`;
            hudAnchor.style.display = s.behind ? "none" : "block";
          }
        }

        controls.update();
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(frame);

      // Expose disposal to the synchronous onCleanup below (this async body
      // runs outside the reactive owner, so onCleanup() here would leak).
      disposeScene = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointerup", onPointerUp);
        el.removeEventListener("pointermove", onPointerMove);
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
        });
        dotsMat.dispose();
        stationMat.dispose();
        if (stationDots) stationDots.geometry.dispose();
        if (trackLines) {
          trackLines.geometry.dispose();
          (trackLines.material as THREE.Material).dispose();
        }
        renderer.dispose();
      };
    })();

    onCleanup(() => {
      cancelled = true;
      disposeScene?.();
    });
  });

  return (
    <>
      <canvas
        ref={canvas}
        aria-label="mappa 3D dell'Italia con treni in viaggio: trascina per ruotare, rotella per zoomare"
        class="absolute inset-0 block h-full w-full touch-pan-y"
      />
      {/* Detail HUD, anchored to the selected dot each frame. */}
      <Show when={selectedTrain()}>
        {(tr) => (
          <div
            ref={hudAnchor}
            class="pointer-events-none absolute left-0 top-0 z-30"
            style={{ display: "none" }}
          >
            <div class="pointer-events-auto -translate-x-1/2 -translate-y-full pb-2">
              {props.renderHud?.(tr(), clearSelection)}
            </div>
          </div>
        )}
      </Show>
    </>
  );
}
