// Shared bake helpers: WebGL backend selection, intermediate frame format, and
// a renderer assertion. Used by bake-map-video.mjs and bake-map-trend-video.mjs.
//
// BAKE_GL controls the WebGL backend:
//   swiftshader (DEFAULT) — software WebGL via ANGLE. Works anywhere (WSL, a
//                           2-core CI runner, no GPU). Slow but portable; this
//                           is what local bakes use.
//   gpu                   — hardware WebGL via ANGLE/desktop-GL, for a GPU
//                           runner (e.g. GitHub's T4 larger runner). Runs HEADED
//                           because headless Chromium can't reliably reach the
//                           GPU, so the caller must provide a display
//                           (`xvfb-run -a …`). See .github/workflows + issue #186.
const GL = process.env.BAKE_GL === "gpu" ? "gpu" : "swiftshader";
export { GL as BAKE_GL };

const COMMON_ARGS = [
  "--use-gl=angle",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  // Headless/containers give /dev/shm only ~64MB; the WebGL map + screenshots
  // overrun it and the renderer dies with "Target crashed". Route it to /tmp.
  "--disable-dev-shm-usage",
  "--no-sandbox",
];

// Pass straight to chromium.launch(). The GPU path is headed (needs a display).
export function launchOptions() {
  if (GL === "gpu") {
    return { headless: false, args: [...COMMON_ARGS, "--use-angle=gl", "--enable-gpu"] };
  }
  return { headless: true, args: [...COMMON_ARGS, "--use-angle=swiftshader"] };
}

// Intermediate frames are JPEG — PNG encoding is the slow path and ffmpeg reads
// JPEG identically for the h264/gif encode. quality 92 is visually lossless for
// this source. (Static .png deliverables are captured separately, still PNG.)
export const FRAME_EXT = "jpg";
export const frameShotOpts = () => ({ type: "jpeg", quality: 92 });

// Log the real WebGL renderer; under BAKE_GL=gpu, FAIL LOUD if Chromium silently
// fell back to software — otherwise we'd burn GPU-runner minutes on a CPU bake.
export async function assertRenderer(page) {
  const renderer = await page.evaluate(() => {
    const gl =
      document.createElement("canvas").getContext("webgl") ||
      document.createElement("canvas").getContext("experimental-webgl");
    if (!gl) return "(no webgl context)";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });
  console.log(`[gl] BAKE_GL=${GL} renderer="${renderer}"`);
  if (GL === "gpu" && /swiftshader|llvmpipe|software|mesa/i.test(renderer)) {
    throw new Error(
      `BAKE_GL=gpu but the WebGL renderer is software ("${renderer}"). ` +
        "The GPU wasn't reached — check the runner's NVIDIA driver, the xvfb display, and the chromium GL flags.",
    );
  }
}
