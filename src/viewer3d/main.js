import {
  resolveMediaUrl,
  eyeAspect,
  formatTime,
  mediaErrorMessage,
} from "./media.js";
import { StereoPreview } from "./preview.js";
import { ImmersivePlayer } from "./xr.js";
import { analyzeStereo } from "./analysis.js";
import { LookAroundPlayer, tiltView } from "./lookaround.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const depthDemoUrl = new URL(
  '/viewer3d/flower-rgbd.mp4',
  parent.location.href,
).href;
const demoUrl = new URL(
  '/viewer3d/flower-sbs.mp4',
  parent.location.href,
).href;
const calibrationUrl = new URL(
  '/viewer3d/stereo-check.mp4',
  parent.location.href,
).href;
let currentUrl = "",
  localUrl = "",
  title = "",
  ready = false,
  layout = "sbs",
  lookaround,
  lookaroundUnavailable = false,
  tiltEnabled = false,
  tiltOrigin = null;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const support = { "immersive-vr": false, "immersive-ar": false };

function status(message = "", error = false) {
  $("media-status").textContent = message;
  $("media-status").classList.toggle("error", error);
}

const preview = new StereoPreview(video, $("preview"), () => {
  status(
    "This server blocks video pixel access. Enable CORS (Access-Control-Allow-Origin) or open a local file.",
    true,
  );
});
const immersive = new ImmersivePlayer(video, $("xr-overlay"), () => {
  updateButtons();
  $("enter-vr").textContent = "Enter VR";
  $("enter-ar").textContent = "Open in AR";
});

function updateButtons() {
  $("play").disabled = !ready;
  $("seek").disabled = !ready;
  $("check-stereo").disabled = !ready || layout !== "sbs";
  document.querySelector(".stereo-check").hidden = layout !== "sbs";
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const needsDepth = button.dataset.mode === "lookaround";
    const needsStereo = ["wiggle", "anaglyph"].includes(button.dataset.mode);
    button.disabled = !ready || (needsDepth && (layout !== "rgbd" || lookaroundUnavailable)) || (needsStereo && layout !== "sbs");
    button.title = needsDepth && layout !== "rgbd" ? "Open an RGB + depth video for look-around (try the demo above)." : needsStereo && layout !== "sbs" ? "Open a stereo clip for this mode." : "";
  });
  $("lookaround-toolbar").hidden = !ready || preview.mode !== "lookaround";
  $("lookaround-hint").hidden = !ready || preview.mode !== "lookaround";
  $("enter-vr").disabled =
    !ready ||
    layout !== "sbs" ||
    !support["immersive-vr"] ||
    !!immersive.session ||
    immersive.entering;
  $("enter-ar").disabled =
    !ready ||
    layout !== "sbs" ||
    !support["immersive-ar"] ||
    !!immersive.session ||
    immersive.entering;
  $("share").disabled = !!localUrl || !ready;
}

function loadClip(url, clipTitle, isLocal = false, format = "sbs") {
  video.pause();
  ready = false;
  preview.failed = false;
  preview.reset();
  lookaround?.clear();
  stopTilt();
  layout = format;
  $("source-layout").value = layout;
  currentUrl = url;
  title = clipTitle || "Your stereo clip";
  $("clip-title").textContent = title;
  $("stage-message").textContent = "Loading clip…";
  $("stage-message").hidden = false;
  $("media-info").textContent = "Full-width side-by-side video";
  $("check-result").textContent =
    "Check the current frame for eye differences and horizontal disparity.";
  $("duration").textContent = "0:00";
  $("current-time").textContent = "0:00";
  $("seek").value = 0;
  status();
  video.src = url;
  video.load();
  if (localUrl && localUrl !== url) URL.revokeObjectURL(localUrl);
  localUrl = isLocal ? url : "";
  $("source-url").value = isLocal || [demoUrl, depthDemoUrl, calibrationUrl].includes(url) ? "" : url;
  selectMode(layout === "rgbd" ? "lookaround" : reducedMotion ? "left" : "wiggle");
  updateButtons();
}

video.addEventListener("loadedmetadata", () => {
  const aspect = eyeAspect(video.videoWidth, video.videoHeight);
  if (video.videoWidth % 2 !== 0 || !Number.isFinite(video.duration)) {
    status(
      "Expected a finite side-by-side clip with an even video width.",
      true,
    );
    return;
  }
  $("stage").style.aspectRatio = Math.min(2.4, Math.max(0.8, aspect));
  $("duration").textContent = formatTime(video.duration);
  $("seek").max = video.duration;
  $("media-info").textContent =
    `${video.videoWidth} × ${video.videoHeight} · ${layout === "rgbd" ? "RGB + depth · white = near" : "side-by-side · left eye first"}`;
  immersive.resizeScreen();
  lookaround?.resize();
});

video.addEventListener("loadeddata", () => {
  ready =
    video.videoWidth > 0 &&
    video.videoWidth % 2 === 0 &&
    Number.isFinite(video.duration);
  $("stage-message").hidden = ready;
  if (lookaround) {
    lookaround.ready = ready && layout === "rgbd";
    lookaround.auto = ready && layout === "rgbd" && !reducedMotion;
    syncOrbit();
  }
  updateButtons();
});

video.addEventListener("error", () => {
  ready = false;
  preview.failed = true;
  preview.reset();
  lookaround?.clear();
  $("stage-message").textContent = "Couldn’t open this clip";
  $("stage-message").hidden = false;
  status(mediaErrorMessage(video.error), true);
  updateButtons();
});

async function togglePlayback() {
  if (!ready) return;
  if (!video.paused) video.pause();
  else {
    if (video.ended) video.currentTime = 0;
    try {
      await video.play();
    } catch {
      status(
        "Playback was blocked. Press play again or try another browser.",
        true,
      );
    }
  }
}

function syncPlayback() {
  $("play").innerHTML =
    `<span aria-hidden="true">${video.paused ? "▶" : "Ⅱ"}</span>`;
  $("play").setAttribute("aria-label", video.paused ? "Play" : "Pause");
  $("current-time").textContent = formatTime(video.currentTime);
  $("seek").value = video.currentTime;
  $("look-play").textContent = video.paused ? "Play clip" : "Pause clip";
}
["play", "pause", "ended", "timeupdate", "seeked"].forEach((event) =>
  video.addEventListener(event, syncPlayback),
);
$("play").addEventListener("click", togglePlayback);
$("xr-play").addEventListener("click", togglePlayback);
$("look-play").addEventListener("click", togglePlayback);
$("seek").addEventListener("input", () => {
  video.currentTime = Number($("seek").value);
});
$("mute").addEventListener("click", () => {
  video.muted = !video.muted;
  $("mute").textContent = video.muted ? "Muted" : "Sound on";
  $("mute").setAttribute(
    "aria-label",
    video.muted ? "Unmute audio" : "Mute audio",
  );
});
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($("stage").requestFullscreen) await $("stage").requestFullscreen();
    else
      status(
        "Fullscreen is unavailable in this browser. Rotate your phone for a larger preview.",
      );
  } catch {
    status("Fullscreen is unavailable in this browser.");
  }
}
$("fullscreen").addEventListener("click", toggleFullscreen);
$("look-fullscreen").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  const full = !!document.fullscreenElement;
  $("fullscreen").setAttribute("aria-label", full ? "Exit fullscreen" : "Enter fullscreen");
  $("look-fullscreen").textContent = full ? "Exit fullscreen" : "Fullscreen";
  lookaround?.resize();
});

const modeHelp = {
  lookaround: "Drag to change perspective. Auto orbit makes a hands-free projector demo.",
  left: "One eye, natural proportions.",
  wiggle: "Alternates eyes ~3 times/sec. Look for depth, not scene jumps.",
  anaglyph: "Red lens: left eye. Cyan lens: right eye.",
};
function selectMode(mode) {
  if (mode === "lookaround" && (layout !== "rgbd" || lookaroundUnavailable)) mode = "left";
  if (layout === "rgbd" && ["wiggle", "anaglyph"].includes(mode)) mode = "left";
  if (mode === "lookaround" && !lookaround) {
    try {
      lookaround = new LookAroundPlayer(video, $("lookaround"), $("stage"), () => { stopTilt(); syncOrbit(); }, () => {
        lookaroundUnavailable = true;
        selectMode("left");
        status("3D rendering is unavailable. Showing the flat RGB view; try a browser with WebGL enabled.", true);
      });
    } catch {
      lookaroundUnavailable = true;
      mode = "left";
      status("3D rendering is unavailable. Showing the flat RGB view; try a browser with WebGL enabled.", true);
    }
  }
  lookaround?.setActive(mode === "lookaround");
  if (mode !== "lookaround") stopTilt();
  preview.setMode(mode);
  $("preview").hidden = mode === "lookaround";
  $("lookaround").hidden = mode !== "lookaround";
  $("lookaround-settings").hidden = mode !== "lookaround";
  document
    .querySelectorAll("[data-mode]")
    .forEach((item) =>
      item.setAttribute("aria-pressed", String(item.dataset.mode === mode)),
    );
  $("mode-help").textContent = modeHelp[mode];
  document.querySelector(".mode-label").textContent =
    mode === "lookaround" ? "3D surface · look around" : mode === "wiggle"
      ? "Depth preview · wiggle"
      : mode === "anaglyph"
        ? "3D glasses · red / cyan"
        : "2D preview · left eye";
  if (layout === "rgbd" && mode === "left") {
    $("mode-help").textContent = "Original RGB frame. Compare with Look around to see the depth relief.";
    document.querySelector(".mode-label").textContent = "2D preview · original RGB";
  }
  updateButtons();
}
document
  .querySelectorAll("[data-mode]")
  .forEach((button) =>
    button.addEventListener("click", () => selectMode(button.dataset.mode)),
  );
function syncOrbit() {
  $("orbit").setAttribute("aria-pressed", String(!!lookaround?.auto));
}
function stopTilt() {
  tiltEnabled = false;
  tiltOrigin = null;
  $("tilt").setAttribute("aria-pressed", "false");
  $("tilt").textContent = "Enable tilt";
}
$("orbit").addEventListener("click", () => {
  if (!lookaround) return;
  stopTilt();
  lookaround.auto = !lookaround.auto;
  syncOrbit();
});
$("reset-view").addEventListener("click", () => {
  lookaround?.reset();
  stopTilt();
  syncOrbit();
});
$("depth-strength").addEventListener("input", () => {
  if (lookaround) lookaround.surface.uniforms.depthStrength.value = Number($("depth-strength").value);
});
$("tilt").addEventListener("click", async () => {
  if (tiltEnabled) { stopTilt(); return; }
  if (!window.DeviceOrientationEvent || !window.isSecureContext) {
    $("motion-status").textContent = "Phone tilt is unavailable here. Drag or use arrow keys instead.";
    return;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function" && await DeviceOrientationEvent.requestPermission() !== "granted") throw new Error("denied");
    tiltEnabled = true;
    tiltOrigin = null;
    lookaround.auto = false;
    syncOrbit();
    $("tilt").setAttribute("aria-pressed", "true");
    $("tilt").textContent = "Disable tilt";
    $("motion-status").textContent = "Tilt your phone gently. Drag still works if no motion sensor is available.";
  } catch {
    stopTilt();
    $("motion-status").textContent = "Motion permission was declined. Drag or use arrow keys instead.";
  }
});
window.addEventListener("deviceorientation", (event) => {
  if (!tiltEnabled || !lookaround?.active || ![event.beta, event.gamma].every(Number.isFinite)) return;
  tiltOrigin ??= { beta: event.beta, gamma: event.gamma };
  lookaround.target = tiltView(event.beta, event.gamma, tiltOrigin, screen.orientation?.angle || 0);
});

$("check-stereo").addEventListener("click", () => {
  try {
    const { left, right, width, height } = preview.sampleEyes();
    const result = analyzeStereo(left, right, width, height);
    $("check-result").textContent = result.message;
    $("check-result").dataset.result = result.kind;
  } catch {
    $("check-result").textContent =
      "Pixel access was blocked. Enable CORS on the video server or use a local file.";
  }
});

$("source-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    loadClip(
      resolveMediaUrl($("source-url").value, parent.location.href),
      "Your stereo clip",
      false,
      $("source-layout").value,
    );
  } catch (error) {
    status(error.message, true);
  }
});
$("file").addEventListener("change", () => {
  const file = $("file").files[0];
  if (file) loadClip(URL.createObjectURL(file), file.name, true, $("source-layout").value);
  $("file").value = "";
});
$("sample").addEventListener("click", () =>
  loadClip(demoUrl, "Generated flower clip · AI depth conversion"),
);
$("lookaround-sample").addEventListener("click", () => loadClip(depthDemoUrl, "Flower · AI depth look-around", false, "rgbd"));
$("calibration").addEventListener("click", () =>
  loadClip(calibrationUrl, "Calibration cube · synthetic stereo"),
);
$("share").addEventListener("click", async () => {
  const url = new URL(parent.location.href);
  url.search = "";
  url.searchParams.set(layout === "rgbd" ? "rgbd" : "src", currentUrl);
  url.searchParams.set("title", title);
  try {
    await navigator.clipboard.writeText(url.href);
    status(
      "Viewer link copied. Anyone opening it needs access to the video URL.",
    );
  } catch {
    status(
      "Copying is unavailable here. The share link is selected in the Video URL field.",
    );
    $("source-url").value = url.href;
    $("source-url").select();
  }
});

for (const [buttonId, mode] of [
  ["enter-vr", "immersive-vr"],
  ["enter-ar", "immersive-ar"],
]) {
  $(buttonId).addEventListener("click", async () => {
    const request = immersive.enter(mode);
    updateButtons();
    try {
      await request;
    } catch (error) {
      status(
        error.name === "NotAllowedError"
          ? "Headset permission was declined. You can still use the preview modes."
          : "Couldn’t start immersive playback. Check headset access, HTTPS, and WebXR browser support.",
        true,
      );
    } finally {
      updateButtons();
    }
  });
}
$("xr-exit").addEventListener("click", () =>
  immersive
    .exit()
    .catch(() => status("Use the headset’s system menu to exit.")),
);
$("xr-recenter").addEventListener("click", () => immersive.recenter());

async function detectXR() {
  if (!window.isSecureContext || !navigator.xr) {
    $("xr-status").textContent = !window.isSecureContext
      ? "Headset mode needs HTTPS (or localhost). Preview modes work here."
      : "No WebXR headset detected here. Try wiggle or red/cyan mode, or open this page in a headset browser.";
    return;
  }
  await Promise.all(
    Object.keys(support).map(async (mode) => {
      try {
        support[mode] = await navigator.xr.isSessionSupported(mode);
      } catch {
        support[mode] = false;
      }
    }),
  );
  $("xr-status").textContent = Object.values(support).some(Boolean)
    ? "Headset ready. Press a button above to grant access. Use a controller trigger to pause or play."
    : "No compatible headset session available. Preview modes still work.";
  updateButtons();
}
detectXR();
const params = new URLSearchParams(parent.location.search);
try {
  loadClip(
    params.has("rgbd")
      ? resolveMediaUrl(params.get("rgbd"), parent.location.href)
      : params.has("src")
      ? resolveMediaUrl(params.get("src"), parent.location.href)
      : depthDemoUrl,
    params.get("title") ||
      (params.has("rgbd") ? "Your depth video" : params.has("src")
        ? "Your stereo clip"
        : "Flower · AI depth look-around"),
    false,
    params.has("src") && !params.has("rgbd") ? "sbs" : "rgbd",
  );
} catch (error) {
  status(error.message, true);
  $("stage-message").textContent = "Open a stereo clip to start";
}

window.addEventListener('pagehide', () => {
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (localUrl) URL.revokeObjectURL(localUrl);
  cancelAnimationFrame(preview.animation);
  lookaround?.observer.disconnect();
  lookaround?.renderer.setAnimationLoop(null);
  lookaround?.surface.dispose();
  lookaround?.renderer.dispose();
  void immersive.exit();
});
