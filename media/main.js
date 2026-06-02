// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {Record<string, HTMLElement>} */
  const $ = {};
  [
    "toolbar",
    "slider-group",
    "slider-label",
    "slider",
    "slider-value",
    "onion-group",
    "onion-play",
    "onion-speed",
    "redline-group",
    "threshold",
    "threshold-value",
    "diff-only",
    "changed-pct",
    "swap",
    "fit",
    "zoom-out",
    "zoom-in",
    "zoom-level",
    "status-banner",
    "viewport",
    "stage",
    "img-before",
    "img-after",
    "diff-canvas",
    "swipe-handle",
    "label-before",
    "label-after",
  ].forEach((id) => ($[id] = /** @type {HTMLElement} */ (document.getElementById(id))));

  const imgBefore = /** @type {HTMLImageElement} */ ($["img-before"]);
  const imgAfter = /** @type {HTMLImageElement} */ ($["img-after"]);
  const canvas = /** @type {HTMLCanvasElement} */ ($["diff-canvas"]);

  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 32;
  const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

  const state = {
    /** @type {string|null} */ before: null,
    /** @type {string|null} */ after: null,
    swapped: false,
    mode: "swipe",
    zoom: 1,
    naturalW: 0,
    naturalH: 0,
    position: 50, // swipe %
    opacity: 50, // opacity %
    threshold: 16,
    highlightColor: "#ff2d55",
    onionSpeed: 1.2,
    diffOnly: false,
    hasBefore: false,
    /** @type {number|undefined} */ onionRAF: undefined,
  };

  // ---- effective sources honoring swap ----
  function effBefore() {
    return state.swapped ? state.after : state.before;
  }
  function effAfter() {
    return state.swapped ? state.before : state.after;
  }

  // ---------------------------------------------------------------- messaging
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === "load") {
      applyConfig(msg.config || {});
      state.before = msg.before;
      state.after = msg.after;
      state.hasBefore = !!msg.before && msg.status === "changed";
      setBanner(msg.status, msg.fileName);
      loadImages();
    } else if (msg.type === "after") {
      state.after = msg.after;
      loadImages();
    }
  });

  function applyConfig(cfg) {
    if (typeof cfg.diffThreshold === "number") state.threshold = cfg.diffThreshold;
    if (typeof cfg.highlightColor === "string") state.highlightColor = cfg.highlightColor;
    if (typeof cfg.onionSpeed === "number") state.onionSpeed = cfg.onionSpeed;
    if (typeof cfg.startupMode === "string") state.mode = cfg.startupMode;

    /** @type {HTMLInputElement} */ ($["threshold"]).value = String(state.threshold);
    $["threshold-value"].textContent = String(state.threshold);
    /** @type {HTMLInputElement} */ ($["onion-speed"]).value = String(state.onionSpeed);
  }

  function setBanner(status, fileName) {
    const banner = $["status-banner"];
    if (status === "changed") {
      banner.classList.add("hidden");
      return;
    }
    let text = "";
    if (status === "unchanged") text = `“${fileName}” has no uncommitted changes — showing current version.`;
    else if (status === "untracked") text = `“${fileName}” is not committed yet — nothing to compare against.`;
    else if (status === "not-in-repo") text = `“${fileName}” is not inside a Git repository — showing current version.`;
    banner.textContent = text;
    banner.classList.toggle("hidden", !text);
  }

  // ---------------------------------------------------------------- image load
  function loadImages() {
    const before = effBefore();
    const after = effAfter();

    const tasks = [];
    if (after) tasks.push(loadInto(imgAfter, after));
    if (state.hasBefore && before) tasks.push(loadInto(imgBefore, before));

    Promise.all(tasks).then(() => {
      const aw = imgAfter.naturalWidth || 0;
      const ah = imgAfter.naturalHeight || 0;
      const bw = state.hasBefore ? imgBefore.naturalWidth || 0 : 0;
      const bh = state.hasBefore ? imgBefore.naturalHeight || 0 : 0;
      state.naturalW = Math.max(aw, bw) || aw || bw;
      state.naturalH = Math.max(ah, bh) || ah || bh;

      if (!state.zoomInitialized) {
        zoomToFit(false);
        state.zoomInitialized = true;
      } else {
        applyZoom();
      }
      configureForCapability();
      setMode(state.mode);
    });
  }

  function loadInto(img, src) {
    return new Promise((resolve) => {
      img.onload = () => resolve(undefined);
      img.onerror = () => resolve(undefined);
      img.src = src;
    });
  }

  // Hide comparison controls when there's no "before" to compare against.
  function configureForCapability() {
    const single = !state.hasBefore;
    document.querySelectorAll(".mode-btn").forEach((b) => {
      /** @type {HTMLButtonElement} */ (b).disabled = single;
    });
    $["swap"].classList.toggle("hidden", single);
    $["label-before"].classList.toggle("hidden", single);
    $["label-after"].classList.toggle("hidden", single);
    if (single) {
      $["slider-group"].classList.add("hidden");
      $["onion-group"].classList.add("hidden");
      $["redline-group"].classList.add("hidden");
      $["swipe-handle"].classList.add("hidden");
      canvas.classList.add("hidden");
      imgBefore.classList.add("hidden");
      imgAfter.classList.remove("hidden");
      imgAfter.style.opacity = "1";
      imgAfter.style.clipPath = "none";
    }
  }

  // ---------------------------------------------------------------- zoom/layout
  function applyZoom() {
    const w = Math.round(state.naturalW * state.zoom);
    const h = Math.round(state.naturalH * state.zoom);
    $["stage"].style.width = w + "px";
    $["stage"].style.height = h + "px";

    sizeLayer(imgAfter, state.zoom);
    if (state.hasBefore) sizeLayer(imgBefore, state.zoom);

    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    updateZoomIndicator();
  }

  function sizeLayer(img, zoom) {
    if (!img.naturalWidth) return;
    img.style.width = Math.round(img.naturalWidth * zoom) + "px";
    img.style.height = Math.round(img.naturalHeight * zoom) + "px";
  }

  function updateZoomIndicator() {
    $["zoom-level"].textContent = Math.round(state.zoom * 100) + "%";
  }

  // Zoom while keeping the content point under (clientX, clientY) fixed.
  function setZoomAtClient(nextZoom, clientX, clientY) {
    nextZoom = clampZoom(nextZoom);
    const vp = $["viewport"];
    const stage = $["stage"];
    const vpRect = vp.getBoundingClientRect();
    const px = clientX - vpRect.left;
    const py = clientY - vpRect.top;
    const prevZoom = state.zoom || 1;
    // content coords (natural px) currently under the cursor
    const contentX = (vp.scrollLeft + px - stage.offsetLeft) / prevZoom;
    const contentY = (vp.scrollTop + py - stage.offsetTop) / prevZoom;

    state.zoom = nextZoom;
    applyZoom();

    // re-anchor: offsetLeft/Top are re-read post-layout (margins may recenter)
    vp.scrollLeft = stage.offsetLeft + contentX * nextZoom - px;
    vp.scrollTop = stage.offsetTop + contentY * nextZoom - py;
  }

  // Zoom anchored on the center of the viewport (used by buttons).
  function zoomBy(factor) {
    const vp = $["viewport"];
    const vpRect = vp.getBoundingClientRect();
    setZoomAtClient(
      state.zoom * factor,
      vpRect.left + vp.clientWidth / 2,
      vpRect.top + vp.clientHeight / 2
    );
  }

  // allowUpscale=false on first open (don't enlarge small images past 100%);
  // the Fit button passes true so it truly fills the viewport.
  function zoomToFit(allowUpscale) {
    const vp = $["viewport"];
    const pad = 32;
    const availW = vp.clientWidth - pad;
    const availH = vp.clientHeight - pad;
    let z = 1;
    if (state.naturalW > 0 && state.naturalH > 0) {
      z = Math.min(availW / state.naturalW, availH / state.naturalH);
      if (!allowUpscale) z = Math.min(1, z);
      if (!isFinite(z) || z <= 0) z = 1;
    }
    state.zoom = clampZoom(z);
    applyZoom();
    vp.scrollTop = 0;
    vp.scrollLeft = 0;
  }

  // ---------------------------------------------------------------- modes
  function setMode(mode) {
    if (!state.hasBefore) return; // single view: nothing to switch
    state.mode = mode;
    stopOnion();

    document.querySelectorAll(".mode-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-mode") === mode);
    });

    const showImgs = mode !== "redline";
    imgBefore.classList.toggle("hidden", !showImgs);
    imgAfter.classList.toggle("hidden", !showImgs);
    canvas.classList.toggle("hidden", mode !== "redline");

    $["slider-group"].classList.toggle("hidden", !(mode === "swipe" || mode === "opacity"));
    $["onion-group"].classList.toggle("hidden", mode !== "onion");
    $["redline-group"].classList.toggle("hidden", mode !== "redline");
    $["swipe-handle"].classList.toggle("hidden", mode !== "swipe");

    // reset after-layer transforms and label opacities
    imgAfter.style.opacity = "1";
    imgAfter.style.clipPath = "none";
    $["label-before"].style.opacity = "1";
    $["label-after"].style.opacity = "1";

    if (mode === "swipe") {
      $["slider-label"].textContent = "Position";
      setSlider(state.position);
      renderSwipe();
    } else if (mode === "opacity") {
      $["slider-label"].textContent = "Opacity";
      setSlider(state.opacity);
      renderOpacity();
    } else if (mode === "onion") {
      startOnion();
    } else if (mode === "redline") {
      renderDiff();
    }
  }

  function setSlider(v) {
    /** @type {HTMLInputElement} */ ($["slider"]).value = String(v);
    $["slider-value"].textContent = Math.round(v) + "%";
  }

  function renderSwipe() {
    const pos = state.position;
    imgAfter.style.opacity = "1";
    imgAfter.style.clipPath = `inset(0 0 0 ${100 - pos}%)`;
    $["swipe-handle"].style.left = pos + "%";
    $["label-before"].style.opacity = "1";
    $["label-after"].style.opacity = "1";
  }

  function renderOpacity() {
    imgAfter.style.clipPath = "none";
    const o = state.opacity / 100;
    imgAfter.style.opacity = String(o);
    $["label-after"].style.opacity = String(o);
    $["label-before"].style.opacity = "1";
  }

  // ---- onion skin: ping-pong cross-fade ----
  let onionStart = 0;
  let onionPlaying = false;

  function startOnion() {
    imgAfter.style.clipPath = "none";
    onionPlaying = true;
    $["onion-play"].textContent = "⏸ Pause";
    onionStart = performance.now();
    const tick = (now) => {
      if (!onionPlaying) return;
      const cyclesPerSec = state.onionSpeed;
      const phase = ((now - onionStart) / 1000) * cyclesPerSec * Math.PI * 2;
      const o = (1 - Math.cos(phase)) / 2;
      imgAfter.style.opacity = String(o);
      $["label-after"].style.opacity = String(o);
      $["label-before"].style.opacity = "1";
      state.onionRAF = requestAnimationFrame(tick);
    };
    state.onionRAF = requestAnimationFrame(tick);
  }

  function stopOnion() {
    onionPlaying = false;
    if (state.onionRAF) cancelAnimationFrame(state.onionRAF);
    state.onionRAF = undefined;
  }

  function toggleOnion() {
    if (onionPlaying) {
      stopOnion();
      $["onion-play"].textContent = "▶ Play";
    } else {
      startOnion();
    }
  }

  // ---- redline / difference ----
  function renderDiff() {
    const w = state.naturalW;
    const h = state.naturalH;
    if (w <= 0 || h <= 0) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const beforeData = rasterize(imgBefore, w, h);
    const afterData = rasterize(imgAfter, w, h);
    if (!beforeData || !afterData) return;

    const out = ctx.createImageData(w, h);
    const b = beforeData.data;
    const a = afterData.data;
    const o = out.data;
    const thr = state.threshold;
    const [hr, hg, hb] = hexToRgb(state.highlightColor);
    const diffOnly = state.diffOnly;

    let changed = 0;
    const total = w * h;
    for (let i = 0; i < o.length; i += 4) {
      const dr = Math.abs(a[i] - b[i]);
      const dg = Math.abs(a[i + 1] - b[i + 1]);
      const db = Math.abs(a[i + 2] - b[i + 2]);
      const da = Math.abs(a[i + 3] - b[i + 3]);
      const delta = Math.max(dr, dg, db, da);
      if (delta > thr) {
        changed++;
        o[i] = hr;
        o[i + 1] = hg;
        o[i + 2] = hb;
        o[i + 3] = 255;
      } else if (diffOnly) {
        o[i + 3] = 0; // transparent → shows checker
      } else {
        // dim the unchanged "after" pixel as context
        o[i] = a[i] * 0.35;
        o[i + 1] = a[i + 1] * 0.35;
        o[i + 2] = a[i + 2] * 0.35;
        o[i + 3] = a[i + 3];
      }
    }
    ctx.putImageData(out, 0, 0);

    const pct = total ? (changed / total) * 100 : 0;
    $["changed-pct"].textContent = `${pct.toFixed(2)}% changed`;
  }

  /** Draw an image into an offscreen canvas of size w×h, top-left aligned. */
  function rasterize(img, w, h) {
    if (!img.naturalWidth) return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d", { willReadFrequently: true });
    if (!cx) return null;
    cx.clearRect(0, 0, w, h);
    cx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
    return cx.getImageData(0, 0, w, h);
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    if (!m) return [255, 45, 85];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  // ---------------------------------------------------------------- events
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.addEventListener("click", () => setMode(b.getAttribute("data-mode")));
  });

  $["slider"].addEventListener("input", (e) => {
    const v = Number(/** @type {HTMLInputElement} */ (e.target).value);
    $["slider-value"].textContent = Math.round(v) + "%";
    if (state.mode === "swipe") {
      state.position = v;
      renderSwipe();
    } else if (state.mode === "opacity") {
      state.opacity = v;
      renderOpacity();
    }
  });

  $["onion-play"].addEventListener("click", toggleOnion);
  $["onion-speed"].addEventListener("input", (e) => {
    state.onionSpeed = Number(/** @type {HTMLInputElement} */ (e.target).value);
  });

  $["threshold"].addEventListener("input", (e) => {
    state.threshold = Number(/** @type {HTMLInputElement} */ (e.target).value);
    $["threshold-value"].textContent = String(state.threshold);
    if (state.mode === "redline") renderDiff();
  });
  $["diff-only"].addEventListener("change", (e) => {
    state.diffOnly = /** @type {HTMLInputElement} */ (e.target).checked;
    if (state.mode === "redline") renderDiff();
  });

  $["swap"].addEventListener("click", () => {
    state.swapped = !state.swapped;
    $["label-before"].textContent = state.swapped ? "Modified" : "Original";
    $["label-after"].textContent = state.swapped ? "Original" : "Modified";
    loadImages();
  });

  $["fit"].addEventListener("click", () => zoomToFit(true));
  $["zoom-in"].addEventListener("click", () => zoomBy(1.25));
  $["zoom-out"].addEventListener("click", () => zoomBy(1 / 1.25));
  $["zoom-level"].addEventListener("click", () => {
    const vp = $["viewport"];
    const vpRect = vp.getBoundingClientRect();
    setZoomAtClient(1, vpRect.left + vp.clientWidth / 2, vpRect.top + vp.clientHeight / 2);
  });

  // Ctrl/Cmd + wheel zooms toward the cursor; plain wheel scrolls normally.
  $["viewport"].addEventListener(
    "wheel",
    (e) => {
      const we = /** @type {WheelEvent} */ (e);
      if (!(we.ctrlKey || we.metaKey)) return;
      we.preventDefault();
      const factor = Math.exp(-we.deltaY * 0.0015);
      setZoomAtClient(state.zoom * factor, we.clientX, we.clientY);
    },
    { passive: false }
  );

  // ---- swipe drag on the stage ----
  let dragging = false;
  function updatePositionFromEvent(clientX) {
    const rect = $["stage"].getBoundingClientRect();
    if (rect.width <= 0) return;
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(0, Math.min(100, pct));
    state.position = pct;
    setSlider(pct);
    renderSwipe();
  }
  $["stage"].addEventListener("pointerdown", (e) => {
    if (state.mode !== "swipe") return;
    dragging = true;
    $["stage"].setPointerCapture(/** @type {PointerEvent} */ (e).pointerId);
    updatePositionFromEvent(/** @type {PointerEvent} */ (e).clientX);
  });
  $["stage"].addEventListener("pointermove", (e) => {
    if (dragging) updatePositionFromEvent(/** @type {PointerEvent} */ (e).clientX);
  });
  $["stage"].addEventListener("pointerup", () => (dragging = false));
  $["stage"].addEventListener("pointercancel", () => (dragging = false));

  window.addEventListener("resize", () => {
    if (!state.zoomInitialized) return;
    // keep current zoom; nothing required, scrollbars adjust
  });

  // tell the host we're ready for data
  vscode.postMessage({ type: "ready" });
})();
