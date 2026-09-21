import { createEffect, onCleanup, onMount } from "solid-js";
import { useDark } from "~/lib/theme";

/**
 * Ordered-dithering shader overlay, clipped to the map panel only
 * (parent must be `relative overflow-hidden`). A transparent WebGL
 * canvas renders a Bayer 4×4 threshold field + faint grain over the
 * map — the print-like stylized finish. Map stays fully readable
 * underneath; zero pointer interference.
 *
 * SSR-safe: canvas + WebGL are touched in onMount only. No WebGL →
 * renders nothing, map still fine.
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uAmount;
uniform float uCell;
uniform vec3 uInk;
uniform float uAlpha;

float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int idx = y * 4 + x;
  // 4x4 Bayer matrix / 16
  if (idx == 0) return 0.0;
  if (idx == 1) return 0.5;
  if (idx == 2) return 0.125;
  if (idx == 3) return 0.625;
  if (idx == 4) return 0.75;
  if (idx == 5) return 0.25;
  if (idx == 6) return 0.875;
  if (idx == 7) return 0.375;
  if (idx == 8) return 0.1875;
  if (idx == 9) return 0.6875;
  if (idx == 10) return 0.0625;
  if (idx == 11) return 0.5625;
  if (idx == 12) return 0.9375;
  if (idx == 13) return 0.4375;
  if (idx == 14) return 0.8125;
  return 0.3125;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  float b = bayer(cell);
  float g = hash(uv * 913.0 + fract(uTime) * 7.0);
  float m = (b - 0.5) * uAmount + (g - 0.5) * uAmount * 0.45;
  float a = clamp(0.16 + m, 0.0, 0.34) * uAlpha;
  // gentle vignette so panel edges fall off like print
  vec2 d = uv - 0.5;
  a += dot(d, d) * 0.26 * uAlpha;
  gl_FragColor = vec4(uInk, a);
}
`;

export default function DitherOverlay(props: {
  amount?: number;
  animated?: boolean;
  /** screen px per Bayer cell: 2 = chunky, very visible. */
  cell?: number;
}) {
  let canvas: HTMLCanvasElement | undefined;
  const dark = useDark();

  onMount(() => {
    const el = canvas;
    if (!el) return;
    const gl = el.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uAmount = gl.getUniformLocation(prog, "uAmount");
    const uCell = gl.getUniformLocation(prog, "uCell");
    const uInk = gl.getUniformLocation(prog, "uInk");
    const uAlpha = gl.getUniformLocation(prog, "uAlpha");
    gl.uniform1f(uAmount, props.amount ?? 1.6);
    gl.uniform1f(uCell, props.cell ?? 2);
    // Black grain in both themes: on dark maps it deepens the print
    // texture; on light maps a white veil would wash the panel out, so
    // the grain runs much fainter there instead.
    createEffect(() => {
      const isDark = dark();
      gl.uniform3f(uInk, 0, 0, 0);
      gl.uniform1f(uAlpha, isDark ? 1 : 0.35);
    });

    const parent = el.parentElement;
    const fit = () => {
      const w = parent?.clientWidth ?? 0;
      const h = parent?.clientHeight ?? 0;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      gl.viewport(0, 0, el.width, el.height);
      gl.uniform2f(uRes, el.width, el.height);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (parent) ro.observe(parent);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animated = (props.animated ?? true) && !reduced;
    let raf = 0;
    const t0 = performance.now();
    const draw = (t: number) => {
      gl.uniform1f(uTime, (t - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (animated) raf = requestAnimationFrame(draw);
    };
    // Static overlays draw once; re-draw on theme toggle (ink change).
    createEffect(() => {
      dark();
      if (!animated) draw(performance.now());
    });
    raf = requestAnimationFrame(draw);

    onCleanup(() => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    });
  });

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
