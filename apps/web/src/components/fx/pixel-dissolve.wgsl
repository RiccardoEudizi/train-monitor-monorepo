// Future WebGPU backend for `PixelValue` / region titles.
//
// Planned pipeline (client-only):
//   1. Rasterize old + new strings to offscreen 2D canvases (same font,
//      tabular-nums, theme colors as the DOM node).
//   2. Upload both as GPU textures.
//   3. Fullscreen quad samples both with PIXEL block size + threshold noise
//      dissolve driven by `u_progress` (0 -> 1 over ~260ms).
//   4. Blit to a canvas overlaying the DOM node; remove overlay on finish
//      and commit the new DOM text.
//
// Interface contract:
//   bindings: 0 = texOld, 1 = texNew, uniform = { progress, pixel, seed }
//   vertex: fullscreen triangle; fragment: pixelate UV, hash-noise threshold,
//   mix(texOld, texNew, step(threshold, progress)).
//
// The CSS implementation in `fx.tsx` stays as fallback for SSR, no-GPU,
// and `prefers-reduced-motion`. Do not wire this shader until the raster +
// device-lost + DPR + theme-parity path is implemented and tested.

struct FxUniforms {
  progress: f32,
  pixel: f32,
  seed: f32,
  _pad: f32,
};

@group(0) @binding(0) var texOld: texture_2d<f32>;
@group(0) @binding(1) var texNew: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> u: FxUniforms;

fn hash12(p: vec2<f32>, seed: f32) -> f32 {
  var p3 = fract(vec3<f32>(p, seed) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@vertex
fn vsMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  return vec4<f32>(pos[i], 0.0, 1.0);
}

@fragment
fn fsMain(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = vec2<f32>(textureDimensions(texOld, 0));
  let px = max(u.pixel, 1.0);
  let block = floor(frag.xy / px);
  let uv = (block * px + px * 0.5) / res;
  let a = textureSample(texOld, samp, uv);
  let b = textureSample(texNew, samp, uv);
  let n = hash12(block, u.seed);
  // Slight ease on progress so end state fully commits to new.
  let t = step(n, clamp(u.progress * 1.08 - 0.04, 0.0, 1.0));
  return mix(a, b, t);
}
