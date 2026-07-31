/**
 * Neon Circuit 2026 — boot, menus, HUD, pause, cup, audio wiring.
 * Fast first paint: menu without WebGL; heavy 3D assets load on first race.
 */
(function (root) {
  "use strict";

  var Engine = root.NeoKartEngine;
  var Input = root.NeoKartInput;
  var Render2D = root.NeoKartRender;
  var Render3D = root.NeoKartRender3D;
  var Track = root.NeoKartTrack;
  var Audio = root.NeoKartAudio;
  var Storage = root.NeoKartStorage;

  var ASSET_VER = "next710-1";
  var HEAVY_SCRIPTS = [
    "vendor/three.min.js",
    "js/vehicles.js?v=" + ASSET_VER,
    "js/fx.js?v=" + ASSET_VER,
    "js/render3d.js?v=" + ASSET_VER,
  ];

  var state = null;
  var running = false;
  var paused = false;
  var lastTs = 0;
  var rafId = 0;
  var canvas = null;
  var use3D = true;
  var courseId = null;
  var hudEls = null;
  var settings = null;
  var paintIndex = 0;
  var cupMode = false;
  var timeTrialMode = false;
  var raceDifficulty = "normal";
  var raceStartTime = 0;
  var tipsVisible = false;
  var prevElev = 0;
  var landingFlash = 0;
  var wrongWayBeepT = 0;
  /** Results-phase bookkeeping — run once per finish, not every HUD frame */
  var resultsHandledKey = null;
  var heavyReady = !!(root.THREE && root.NeoKartRender3D);
  var heavyLoading = null;
  var menuOpen = true;
  var hudCache = {};
  var minimapFrame = 0;
  var minimapBounds = null;
  var minimapTrackId = null;
  var slowFrames = 0;
  var hudFrame = 0;
  var hitStopLeft = 0;

  function refreshModules() {
    Engine = root.NeoKartEngine;
    Input = root.NeoKartInput;
    Render2D = root.NeoKartRender;
    Render3D = root.NeoKartRender3D;
    Track = root.NeoKartTrack;
    Audio = root.NeoKartAudio;
    Storage = root.NeoKartStorage;
    use3D = !!(root.THREE && Render3D);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var bare = src.split("?")[0];
      var existing = document.querySelector(
        'script[src="' + src + '"],script[src^="' + bare + '"]'
      );
      if (existing) {
        // Already present (static HTML load or prior inject)
        if (bare.indexOf("three") >= 0 && root.THREE) return resolve();
        if (bare.indexOf("render3d") >= 0 && root.NeoKartRender3D) return resolve();
        if (bare.indexOf("vehicles") >= 0 && root.NeoKartVehicles) return resolve();
        if (bare.indexOf("fx.js") >= 0 && root.NeoKartFX) return resolve();
        // Script tag exists but may still be loading
        existing.addEventListener("load", function () {
          resolve();
        });
        existing.addEventListener("error", reject);
        // If already complete
        if (existing.dataset && existing.dataset.loaded === "1") resolve();
        else if (existing.readyState === "complete") resolve();
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = function () {
        s.dataset.loaded = "1";
        resolve();
      };
      s.onerror = function () {
        reject(new Error("Failed to load " + src));
      };
      document.head.appendChild(s);
    });
  }

  function ensureHeavyAssets() {
    refreshModules();
    // Already inlined / CDN-preloaded (share build) or previously loaded
    if (root.THREE && root.NeoKartRender3D) {
      heavyReady = true;
      return Promise.resolve();
    }
    if (heavyReady && root.THREE && root.NeoKartRender3D) {
      return Promise.resolve();
    }
    if (heavyLoading) return heavyLoading;
    showLoading(true, "Loading 3D…");
    heavyLoading = HEAVY_SCRIPTS.reduce(function (chain, src) {
      return chain.then(function () {
        return loadScript(src);
      });
    }, Promise.resolve())
      .then(function () {
        refreshModules();
        heavyReady = !!(root.THREE && Render3D);
        if (!heavyReady) {
          console.warn("3D stack incomplete — 2D fallback");
          use3D = false;
        }
        showLoading(false);
      })
      .catch(function (err) {
        console.warn("Heavy asset load failed", err);
        heavyLoading = null;
        use3D = false;
        showLoading(false);
      });
    return heavyLoading;
  }

  function showLoading(show, msg) {
    var el = document.getElementById("load-overlay");
    if (!el) return;
    if (show) {
      el.classList.add("show");
      var t = el.querySelector(".msg");
      if (t) t.textContent = msg || "Loading…";
    } else {
      el.classList.remove("show");
    }
  }

  function getCourseId(opts) {
    if (opts && opts.courseId) return opts.courseId;
    if (courseId) return courseId;
    return Track.DEFAULT_COURSE_ID || "neo-tokyo";
  }

  function applySettingsToSystems() {
    if (!settings) return;
    if (Audio) {
      if (Audio.setSfxVolume) Audio.setSfxVolume(settings.volume);
      else if (Audio.setVolume) Audio.setVolume(settings.volume);
      if (Audio.setMusicVolume) {
        Audio.setMusicVolume(
          settings.musicVolume != null ? settings.musicVolume : 0.35
        );
      }
    }
    if (Input && Input.setStickSettings) {
      Input.setStickSettings({
        deadzone: settings.stickDeadzone != null ? settings.stickDeadzone : 0.22,
        sensitivity:
          settings.stickSensitivity != null ? settings.stickSensitivity : 1,
      });
    }
    if (Render3D && Render3D.setQuality) {
      Render3D.setQuality(settings.quality || "high");
    }
    if (Render3D && Render3D.setCameraMode && settings.camera) {
      Render3D.setCameraMode(settings.camera);
    }
  }

  function startRaceSync(opts) {
    opts = opts || {};
    courseId = getCourseId(opts);
    var track = Track.getTrack(courseId);
    if (settings && settings.paintIndex != null) paintIndex = settings.paintIndex;
    var ghostPb =
      Storage && Storage.getBestTime ? Storage.getBestTime(courseId) : null;
    var tt = !!(opts.timeTrial || timeTrialMode);
    state = Engine.createRace({
      numKarts: tt ? 1 : opts.numKarts || 4,
      numTraffic: tt
        ? 0
        : opts.numTraffic != null
          ? opts.numTraffic
          : track.numTraffic != null
            ? track.numTraffic
            : 6,
      numLaps:
        opts.numLaps != null ? opts.numLaps : track.numLaps != null ? track.numLaps : 6,
      seed: opts.seed != null ? opts.seed : Date.now() % 100000,
      track: track,
      paintIndex: paintIndex,
      ghostPbTime: ghostPb,
      // EA start-lights (tests leave countdown off via default)
      countdown: opts.countdown !== false,
      timeTrial: tt,
      difficulty: opts.difficulty || raceDifficulty || "normal",
    });
    if (Input && Input.reset) Input.reset();
    running = true;
    paused = false;
    menuOpen = false;
    lastTs = 0;
    raceStartTime = 0;
    prevElev = 0;
    landingFlash = 0;
    resultsHandledKey = null;
    hudCache = {};
    minimapBounds = null;
    minimapTrackId = null;
    slowFrames = 0;
    // Keep engine phase (countdown or racing) — do not force racing

    refreshModules();
    if (use3D && Render3D && root.THREE && canvas) {
      try {
        if (settings && settings.quality) Render3D.setQuality(settings.quality);
        else if (Render3D.setQuality) Render3D.setQuality("high");
        Render3D.init(canvas, state, { force: !!opts.forceRebuild });
        if (settings && settings.camera) Render3D.setCameraMode(settings.camera);
      } catch (e) {
        console.warn("3D init failed, falling back to 2D", e);
        use3D = false;
      }
    }

    updateHudChrome();
    hidePause();
    if (Audio && Audio.resume) Audio.resume();
    if (Audio && Audio.startMusic) Audio.startMusic();
    setTouchControlsVisible(
      !menuOpen && (isCoarsePointer() || (settings && settings.forceTouch))
    );
    return state;
  }

  /**
   * Start a race — loads Three.js stack on first play, reuses world on restart.
   * Returns a Promise for callers that need to wait.
   */
  function startRace(opts) {
    opts = opts || {};
    if (opts.force2D) {
      use3D = false;
      return Promise.resolve(startRaceSync(opts));
    }
    // Load heavy GPU stack once when 3D is desired but not ready yet
    if (use3D && (!root.THREE || !root.NeoKartRender3D)) {
      return ensureHeavyAssets().then(function () {
        return startRaceSync(opts);
      });
    }
    return Promise.resolve(startRaceSync(opts));
  }

  function updateHudChrome() {
    if (!hudEls || !state) return;
    if (hudEls.courseName) {
      var t = state.track;
      var bits = [t.city || "", t.name || ""];
      if (state.mode === "timeTrial" || state.timeTrial) bits.push("TIME TRIAL");
      if (state.difficulty && state.difficulty !== "normal") {
        bits.push(String(state.difficulty).toUpperCase());
      }
      if (t.difficulty) bits.push(t.difficulty);
      if (t.numLaps) bits.push(t.numLaps + " laps");
      if (t.weather === "rain") bits.push("WET");
      var best = Storage && Storage.getBestTime ? Storage.getBestTime(t.id) : null;
      if (best != null) bits.push("PB " + best.toFixed(1) + "s");
      hudEls.courseName.textContent = bits.filter(Boolean).join(" · ");
    }
  }

  function drawMinimap() {
    if (!hudEls || !hudEls.minimap || !state || !state.track) return;
    // ~15fps is plenty for circuit dots
    minimapFrame++;
    if ((minimapFrame & 3) !== 0 && minimapBounds) return;

    var c = hudEls.minimap;
    var ctx = c.getContext("2d");
    if (!ctx) return;
    var w = c.width;
    var h = c.height;
    var wps = state.track.waypoints;
    var halfW = state.track.halfWidth || 50;
    if (!wps || !wps.length) return;

    var i, minX, maxX, minY, maxY, spanX, spanY, scale, ox, oy, pad, margin;
    if (!minimapBounds || minimapTrackId !== state.track.id) {
      minX = Infinity;
      maxX = -Infinity;
      minY = Infinity;
      maxY = -Infinity;
      for (i = 0; i < wps.length; i++) {
        if (wps[i].x < minX) minX = wps[i].x;
        if (wps[i].x > maxX) maxX = wps[i].x;
        if (wps[i].y < minY) minY = wps[i].y;
        if (wps[i].y > maxY) maxY = wps[i].y;
      }
      pad = halfW + 28;
      minX -= pad;
      maxX += pad;
      minY -= pad;
      maxY += pad;
      spanX = Math.max(1, maxX - minX);
      spanY = Math.max(1, maxY - minY);
      margin = 10;
      scale = Math.min((w - margin * 2) / spanX, (h - margin * 2) / spanY);
      ox = (w - spanX * scale) * 0.5;
      oy = (h - spanY * scale) * 0.5;
      minimapBounds = {
        minX: minX,
        maxX: maxX,
        minY: minY,
        maxY: maxY,
        scale: scale,
        ox: ox,
        oy: oy,
      };
      minimapTrackId = state.track.id;
    } else {
      minX = minimapBounds.minX;
      maxX = minimapBounds.maxX;
      minY = minimapBounds.minY;
      maxY = minimapBounds.maxY;
      scale = minimapBounds.scale;
      ox = minimapBounds.ox;
      oy = minimapBounds.oy;
    }

    function sx(x) {
      return ox + (x - minX) * scale;
    }
    function sy(y) {
      return oy + (maxY - y) * scale;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, w, h, 12);
    else ctx.rect(0, 0, w, h);
    ctx.fill();

    var roadPx = Math.max(3.5, halfW * scale * 0.85);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(60, 68, 78, 0.55)";
    ctx.lineWidth = roadPx;
    ctx.beginPath();
    ctx.moveTo(sx(wps[0].x), sy(wps[0].y));
    for (i = 1; i < wps.length; i++) ctx.lineTo(sx(wps[i].x), sy(wps[i].y));
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = Math.max(1.2, roadPx * 0.12);
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(sx(wps[0].x), sy(wps[0].y));
    for (i = 1; i < wps.length; i++) ctx.lineTo(sx(wps[i].x), sy(wps[i].y));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    function drawDot(k, r, fill, stroke, label) {
      var px = sx(k.x);
      var py = sy(k.y);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      var len = r + 3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(k.angle) * len, py - Math.sin(k.angle) * len);
      ctx.strokeStyle = stroke || fill;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (label) {
        ctx.fillStyle = "rgba(28,36,48,0.9)";
        ctx.font = "bold 8px -apple-system, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, px, py - r - 3);
      }
    }

    for (i = 0; i < state.karts.length; i++) {
      var kt = state.karts[i];
      if (!kt.isTraffic) continue;
      var tr =
        kt.vehicleType === "bus" ? 4.2 : kt.vehicleType === "truck" ? 3.6 : 2.6;
      var tcol =
        kt.vehicleType === "bus"
          ? "#d4a820"
          : kt.vehicleType === "truck"
            ? "#6a90b8"
            : "#d4882a";
      drawDot(kt, tr, tcol, "rgba(80,40,0,0.5)", null);
    }
    var placeById = {};
    var ranks = state.rankings || [];
    for (i = 0; i < ranks.length; i++) placeById[ranks[i].id] = ranks[i].place;
    for (i = 0; i < state.karts.length; i++) {
      var kr = state.karts[i];
      if (kr.isTraffic || kr.isPlayer) continue;
      drawDot(kr, 3.4, kr.color || "#5a6a7c", "rgba(255,255,255,0.85)", String(placeById[kr.id] || ""));
    }
    for (i = 0; i < state.karts.length; i++) {
      var kp = state.karts[i];
      if (!kp.isPlayer) continue;
      var pPlace = placeById[kp.id] != null ? placeById[kp.id] : 1;
      ctx.beginPath();
      ctx.arc(sx(kp.x), sy(kp.y), 7.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(43, 125, 233, 0.28)";
      ctx.fill();
      drawDot(kp, 4.6, "#2b7de9", "#ffffff", "P" + pPlace);
    }
  }

  function setText(el, key, value) {
    if (!el) return;
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    el.textContent = value;
  }

  function setHtml(el, key, value) {
    if (!el) return;
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    el.innerHTML = value;
  }

  function setWidth(el, key, value) {
    if (!el) return;
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    el.style.width = value;
  }

  function setDisplay(el, key, value) {
    if (!el) return;
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    el.style.display = value;
  }

  function updateHud() {
    if (!hudEls || !state) return;
    // HUD at half rate is plenty; still 30fps feel
    hudFrame++;
    if ((hudFrame & 1) === 1 && state.phase === "racing") {
      // still draw minimap on alternate cadence via its own throttle
      if ((hudFrame & 3) === 1) drawMinimap();
      return;
    }

    var ranks = state.rankings || [];
    var player = null;
    var i;
    for (i = 0; i < state.karts.length; i++) {
      if (state.karts[i].isPlayer) {
        player = state.karts[i];
        break;
      }
    }

    if (hudEls.standings) {
      var html = "";
      for (i = 0; i < ranks.length; i++) {
        var r = ranks[i];
        var cls = r.isPlayer ? "you" : "";
        var label = r.isPlayer
          ? "YOU"
          : r.name ||
            (function () {
              var kk;
              for (kk = 0; kk < state.karts.length; kk++) {
                if (state.karts[kk].id === r.id) {
                  return state.karts[kk].displayName || "CPU" + r.id;
                }
              }
              return "CPU" + r.id;
            })();
        var lap = Math.min(r.laps + 1, state.numLaps);
        html +=
          '<div class="row ' +
          cls +
          '"><span class="place">' +
          r.place +
          "</span> " +
          label +
          ' <span class="lap">L' +
          lap +
          "/" +
          state.numLaps +
          (r.finished ? " ✓" : "") +
          "</span></div>";
      }
      setHtml(hudEls.standings, "standings", html);
    }

    if (hudEls.item && player) {
      var item;
      var itemCls;
      if (player.itemSpinT > 0) {
        // Roulette tension — flash previews until settle
        item = (player.itemPreview || "???").toUpperCase();
        itemCls = "item-chip spin has";
      } else if (player.item) {
        item = player.item.toUpperCase();
        itemCls = "item-chip has";
      } else {
        item = "—";
        itemCls = "item-chip";
      }
      setText(hudEls.item, "item", item);
      if (hudCache.itemCls !== itemCls) {
        hudCache.itemCls = itemCls;
        hudEls.item.className = itemCls;
      }
    }

    if (hudEls.speed && player) {
      var mph = Math.round(Math.abs(player.speed) * 0.59);
      setText(hudEls.speed, "speed", mph + " mph");
      if (hudEls.speedBar) {
        var pct = Math.min(100, (Math.abs(player.speed) / 340) * 100) | 0;
        setWidth(hudEls.speedBar, "speedBar", pct + "%");
      }
    }

    if (hudEls.draft && player) {
      if (player.drafting && player.draftStrength > 0.08) {
        setDisplay(hudEls.draft, "draftDisp", "block");
        setText(
          hudEls.draft,
          "draftTxt",
          "DRAFT " + Math.round(player.draftStrength * 100) + "%"
        );
        var dcol = player.draftStrength > 0.55 ? "#0a9a4a" : "#1a7acc";
        if (hudCache.draftCol !== dcol) {
          hudCache.draftCol = dcol;
          hudEls.draft.style.color = dcol;
        }
      } else {
        setDisplay(hudEls.draft, "draftDisp", "none");
      }
    }

    if (hudEls.drift && player) {
      var dm = player.driftMeter || 0;
      if (player.drifting || dm > 0.05) {
        setDisplay(hudEls.drift, "driftDisp", "block");
        setWidth(hudEls.driftBar, "driftBar", Math.round(dm * 100) + "%");
        var dcls = "item-panel drift-panel" + (dm >= 0.45 ? " ready" : "");
        if (hudCache.driftCls !== dcls) {
          hudCache.driftCls = dcls;
          hudEls.drift.className = dcls;
        }
      } else {
        setDisplay(hudEls.drift, "driftDisp", "none");
      }
    }

    if (hudEls.shield && player) {
      if (player.shieldT > 0) {
        setDisplay(hudEls.shield, "shieldDisp", "block");
        setText(
          hudEls.shield,
          "shieldTxt",
          "SHIELD " + player.shieldT.toFixed(1) + "s"
        );
      } else {
        setDisplay(hudEls.shield, "shieldDisp", "none");
      }
    }

    if (hudEls.camMode && Render3D && Render3D.getCameraMode) {
      var mode = Render3D.getCameraMode();
      setText(hudEls.camMode, "cam", mode === "cockpit" ? "WHEEL" : "CHASE");
    }

    if (hudEls.wrongWay) {
      var ww = !!(state.wrongWay || (player && player.wrongWay));
      if (hudCache.wrongWay !== ww) {
        hudCache.wrongWay = ww;
        if (ww) hudEls.wrongWay.classList.add("show");
        else hudEls.wrongWay.classList.remove("show");
      }
    }

    if (hudEls.nextDir && player && Engine.getNextDirectionHint) {
      var hint = Engine.getNextDirectionHint(player, state);
      setText(hudEls.nextDir, "nextDir", hint.label || "↑");
      var nop =
        player.wrongWay || state.wrongWay ? "0.25" : "0.9";
      if (hudCache.nextOp !== nop) {
        hudCache.nextOp = nop;
        hudEls.nextDir.style.opacity = nop;
      }
    }

    // Speed lines motion cue (cached node)
    if (!hudEls.speedLines) hudEls.speedLines = document.getElementById("speed-lines");
    if (hudEls.speedLines && player) {
      var sf = Math.abs(player.speed) / (Engine.constants.MAX_SPEED || 220);
      var hot = sf > 0.72 && player.boostT <= 0;
      var boost = player.boostT > 0 || player.fever;
      if (hudCache.linesHot !== hot) {
        hudCache.linesHot = hot;
        hudEls.speedLines.classList.toggle("hot", hot);
      }
      if (hudCache.linesBoost !== boost) {
        hudCache.linesBoost = boost;
        hudEls.speedLines.classList.toggle("boost", boost);
      }
    }

    // Style toast + combo score
    if (hudEls.styleToast && player) {
      if (player.styleLabel && player.styleLabelT > 0) {
        setText(hudEls.styleToast, "styleToast", player.styleLabel);
        if (!hudCache.styleToastShow) {
          hudCache.styleToastShow = true;
          hudEls.styleToast.classList.add("show");
        }
        hudEls.styleToast.classList.toggle("fever", !!player.fever);
      } else if (hudCache.styleToastShow) {
        hudCache.styleToastShow = false;
        hudEls.styleToast.classList.remove("show");
      }
    }
    if (hudEls.styleScore && player) {
      var sc = Math.round(player.styleScore || 0);
      var mult = (player.styleMult || 1).toFixed(1);
      if (sc > 5 || player.fever) {
        if (!hudCache.styleScoreShow) {
          hudCache.styleScoreShow = true;
          hudEls.styleScore.classList.add("show");
        }
        hudEls.styleScore.classList.toggle("fever", !!player.fever);
        setText(
          hudEls.styleScore,
          "styleScore",
          player.fever
            ? "FEVER ×" + mult + "  " + sc
            : "STYLE " + sc + "  ×" + mult
        );
      } else if (hudCache.styleScoreShow) {
        hudCache.styleScoreShow = false;
        hudEls.styleScore.classList.remove("show");
      }
    }

    // Rival hunt / missile lock / ghost PB / pass chain pressure
    if (hudEls.rival && player) {
      var lockId = state.missileLockId;
      if (lockId != null) {
        hudEls.rival.classList.add("show", "lock");
        var lockName = "CPU" + lockId;
        var li;
        for (li = 0; li < state.karts.length; li++) {
          if (state.karts[li].id === lockId) {
            lockName = state.karts[li].displayName || lockName;
            break;
          }
        }
        setText(hudEls.rival, "rival", "🔒 LOCK " + lockName);
      } else if ((player.passChain || state.passChain || 0) >= 2) {
        hudEls.rival.classList.add("show");
        hudEls.rival.classList.remove("lock");
        setText(
          hudEls.rival,
          "rival",
          "CHAIN ×" + (player.passChain || state.passChain)
        );
      } else if (state.ghostDelta != null && Math.abs(state.ghostDelta) > 8) {
        hudEls.rival.classList.add("show");
        hudEls.rival.classList.remove("lock");
        var gd = Math.round(state.ghostDelta);
        setText(
          hudEls.rival,
          "rival",
          gd >= 0 ? "GHOST +" + gd + "m" : "GHOST " + gd + "m"
        );
      } else if (state.rivalId != null && state.rivalGap != null) {
        hudEls.rival.classList.add("show");
        hudEls.rival.classList.remove("lock");
        var gapM = Math.round(state.rivalGap);
        setText(
          hudEls.rival,
          "rival",
          "RIVAL P" +
            Math.max(1, (state.playerPlace || 2) - 1) +
            "  ·  " +
            gapM +
            "m"
        );
      } else {
        hudEls.rival.classList.remove("show", "lock");
      }
    }

    // Comeback charge bar
    if (hudEls.comeback && hudEls.comebackBar && player) {
      var cm = player.comebackMeter || 0;
      if (cm > 0.04 && (state.playerPlace || 1) >= 3) {
        hudEls.comeback.style.display = "block";
        hudEls.comebackBar.style.width = Math.round(cm * 100) + "%";
      } else {
        hudEls.comeback.style.display = "none";
      }
    }

    // Final lap banner
    if (hudEls.lastLap) {
      if (state.lastLap && state.phase === "racing") {
        hudEls.lastLap.classList.add("show");
      } else {
        hudEls.lastLap.classList.remove("show");
      }
    }

    if (hudEls.cockpitReadout && player) {
      var mph2 = Math.round(Math.abs(player.speed) * 0.59);
      var lapN = Math.min((player.laps || 0) + 1, state.numLaps);
      var feverTag = player.fever ? " · FEVER" : "";
      hudEls.cockpitReadout.textContent =
        mph2 +
        " mph · L" +
        lapN +
        "/" +
        state.numLaps +
        " · P" +
        (state.playerPlace || "—") +
        feverTag;
    }

    // Live race clock + place flash (presentation juice)
    if (hudEls.raceClock && player) {
      if (state.phase === "racing" || state.phase === "countdown") {
        var clock =
          state.phase === "countdown"
            ? "0.00"
            : (state.raceClock != null ? state.raceClock : state.time || 0).toFixed(
                2
              );
        setText(hudEls.raceClock, "clock", clock + "s");
        setDisplay(hudEls.raceClock, "clockDisp", "block");
      } else {
        setDisplay(hudEls.raceClock, "clockDisp", "none");
      }
    }
    if (hudEls.placeFlash) {
      if (state.placeFlash && state.placeFlashT > 0) {
        setText(hudEls.placeFlash, "pflash", state.placeFlash);
        if (!hudCache.pflashShow) {
          hudCache.pflashShow = true;
          hudEls.placeFlash.classList.add("show");
        }
      } else if (hudCache.pflashShow) {
        hudCache.pflashShow = false;
        hudEls.placeFlash.classList.remove("show");
      }
    }

    // Instant-replay banner
    if (hudEls.replayBanner) {
      if (state.phase === "replay") {
        hudEls.replayBanner.classList.add("show");
        var rf =
          state.replayFrac != null
            ? Math.round(state.replayFrac * 100)
            : 0;
        setText(hudEls.replayBanner, "replay", "REPLAY " + rf + "%");
      } else {
        hudEls.replayBanner.classList.remove("show");
      }
    }
    // Rival taunt toast
    if (hudEls.taunt) {
      if (state.taunt && state.tauntT > 0) {
        setText(hudEls.taunt, "taunt", state.taunt);
        if (!hudCache.tauntShow) {
          hudCache.tauntShow = true;
          hudEls.taunt.classList.add("show");
        }
      } else if (hudCache.tauntShow) {
        hudCache.tauntShow = false;
        hudEls.taunt.classList.remove("show");
      }
    }

    // Start-lights ceremony banner
    if (hudEls.countdown) {
      if (state.phase === "countdown" && state.countdownLabel) {
        setText(hudEls.countdown, "cd", state.countdownLabel);
        if (!hudCache.cdShow) {
          hudCache.cdShow = true;
          hudEls.countdown.classList.add("show");
        }
        hudEls.countdown.classList.toggle("go", state.countdownLabel === "GO");
      } else if (hudCache.cdShow) {
        hudCache.cdShow = false;
        hudEls.countdown.classList.remove("show", "go");
      }
    }

    if (hudEls.results) {
      if (state.phase === "results") {
        hudEls.results.classList.add("show");
        var finishKey =
          (state.track && state.track.id) +
          ":" +
          state.time +
          ":" +
          (state.finishCount || 0);
        // Once per finish — never re-award cup points / PB toast every frame
        if (resultsHandledKey !== finishKey) {
          resultsHandledKey = finishKey;
          var pr = Engine.playerResult(state);
          var placeLabel =
            (state.resultsDetail && state.resultsDetail.placeLabel) ||
            (pr.place === 1
              ? "1ST"
              : pr.place === 2
                ? "2ND"
                : pr.place === 3
                  ? "3RD"
                  : (pr.place || "?") + "TH");
          var msg = state.message || "FINISHED " + placeLabel;
          var rematchHint = null;
          var rewards = null;
          if (Storage && state.track && Storage.applyFinishRewards) {
            rewards = Storage.applyFinishRewards(state.track.id, state.time, {
              cupMode: cupMode,
              place: pr.place || 4,
              finishKey:
                state.track.id +
                ":" +
                Math.round(state.time * 100) +
                ":" +
                (pr.place || 0),
            });
            if (rewards.messageBits && rewards.messageBits.length) {
              msg = rewards.messageBits.join(" · ");
            }
            rematchHint = rewards.rematchHint;
            state._cupNextCourse = cupMode ? rewards.nextCourse : null;
            state._rematchHint = rematchHint;
            state._rewards = rewards;
            refreshMetaPanels();
            refreshPaintOptions();
            buildLevelSelect();
          }
          var placeEl = hudEls.results.querySelector(".place");
          if (placeEl) placeEl.textContent = placeLabel;
          var rewardEl = hudEls.results.querySelector(".rewards");
          if (rewardEl) {
            rewardEl.textContent =
              rewards && rewards.messageBits
                ? rewards.messageBits.slice(1).join(" · ")
                : "";
          }
          var sub = hudEls.results.querySelector(".sub");
          if (sub && cupMode && state._cupNextCourse) {
            sub.innerHTML =
              "Press <b>R</b> for next cup race (" +
              state._cupNextCourse +
              ") · <b>Esc</b> courses";
          } else if (sub && rewards && rewards.nextAction) {
            sub.textContent = rewards.nextAction;
          } else if (sub) {
            var hintBit = rematchHint ? rematchHint + " · " : "";
            sub.innerHTML =
              hintBit +
              "Press <b>R</b> to race again · <b>Esc</b> for courses";
          }
          hudEls.results.querySelector(".msg").textContent = msg;
        }
      } else {
        hudEls.results.classList.remove("show");
        resultsHandledKey = null;
      }
    }

    drawMinimap();
  }

  function showPause(show) {
    var el = document.getElementById("pause-overlay");
    if (!el) return;
    if (show) el.classList.add("show");
    else el.classList.remove("show");
  }

  function hidePause() {
    showPause(false);
  }

  function togglePause() {
    if (!state || state.phase === "results") return;
    if (document.getElementById("level-select") &&
        document.getElementById("level-select").classList.contains("show")) {
      return;
    }
    paused = !paused;
    if (Engine.setPaused) Engine.setPaused(state, paused);
    else state.phase = paused ? "paused" : "racing";
    showPause(paused);
    if (!paused) lastTs = 0;
  }

  function frame(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    // Menu idle — no sim/render (instant battery + free GPU)
    if (menuOpen || !state) {
      rafId = requestAnimationFrame(frame);
      return;
    }

    if (Input.consumeCameraToggle && Input.consumeCameraToggle()) {
      if (Render3D && Render3D.toggleCameraMode) {
        var m = Render3D.toggleCameraMode();
        if (settings && Storage) {
          settings.camera = m;
          Storage.saveSettings({ camera: m });
        }
      }
    }
    if (Input.consumePauseToggle && Input.consumePauseToggle()) {
      togglePause();
    }

    // Instant replay: advance scrub without player control
    if (state.phase === "replay" && !paused) {
      Engine.step(state, Engine.buildInputs(state, Engine.emptyInput()), dt);
      if (Audio && state.events && state.events.length) {
        Audio.consumeEvents(state.events);
      }
      if (Audio && Audio.updateEngine) Audio.updateEngine(0.2, false);
    } else if (state.phase !== "results" && state.phase !== "paused" && !paused) {
      // Hit-stop: brief slow-mo when sim flags impact (or residual from last hit)
      var simDt = dt;
      if (state.hitStop > 0 || hitStopLeft > 0) {
        hitStopLeft = Math.max(hitStopLeft, state.hitStop || 0);
        simDt = dt * 0.22;
        hitStopLeft = Math.max(0, hitStopLeft - dt);
      }
      var playerInput = Input.getPlayerInput();
      var inputs = Engine.buildInputs(state, playerInput);
      Engine.step(state, inputs, simDt);

      // Adaptive quality when frame budget is exceeded
      if (dt > 0.022) slowFrames++;
      else slowFrames = Math.max(0, slowFrames - 2);
      if (slowFrames > 40 && Render3D && Render3D.adaptQualityDown) {
        if (Render3D.adaptQualityDown()) {
          slowFrames = 0;
          if (settings && Storage && Render3D.getQuality) {
            var q = Render3D.getQuality();
            if (q && q.preset && q.preset !== settings.quality) {
              settings.quality = q.preset;
              Storage.saveSettings({ quality: q.preset });
              var qualSel = document.getElementById("set-quality");
              if (qualSel) qualSel.value = q.preset;
            }
          }
        }
      }

      if (Audio) {
        if (state.events && state.events.length) Audio.consumeEvents(state.events);
        var player = null;
        var pi;
        for (pi = 0; pi < state.karts.length; pi++) {
          if (state.karts[pi].isPlayer) {
            player = state.karts[pi];
            break;
          }
        }
        if (player) {
          Audio.updateEngine(
            Math.abs(player.speed) / (Engine.constants.MAX_SPEED || 220),
            player.boostT > 0
          );
          var elev = player.elev || 0;
          if (prevElev - elev > 8 && Math.abs(player.speed) > 60) {
            landingFlash = 0.35;
            if (Audio.play) Audio.play("hit");
          }
          prevElev = elev;
          if (player.wrongWay) {
            wrongWayBeepT -= dt;
            if (wrongWayBeepT <= 0) {
              Audio.play("wrongWay");
              wrongWayBeepT = 1.2;
            }
          }
        }
      }
      if (landingFlash > 0) landingFlash -= dt;
    }

    if (canvas && state) {
      var ok = false;
      if (use3D && Render3D) {
        state._landingFlash = landingFlash;
        state._speedFrac = 0;
        var pl;
        for (pl = 0; pl < state.karts.length; pl++) {
          if (state.karts[pl].isPlayer) {
            state._speedFrac =
              Math.abs(state.karts[pl].speed) /
              (Engine.constants.MAX_SPEED || 220);
            break;
          }
        }
        ok = Render3D.render(canvas, state, dt);
        if (!ok) use3D = false;
      }
      if (!ok && Render2D) {
        Render2D.render(canvas, state);
      }
    }

    updateHud();
    rafId = requestAnimationFrame(frame);
  }

  function onKeyRestart(e) {
    if (!state) return;
    if (state.phase === "results" && (e.key === "r" || e.key === "R" || e.code === "KeyR")) {
      // Cup progression: R loads next cup course when queued
      if (cupMode && state._cupNextCourse) {
        courseId = state._cupNextCourse;
        startRace({ courseId: courseId });
      } else if (cupMode && Storage && Storage.nextCupCourse()) {
        courseId = Storage.nextCupCourse();
        startRace({ courseId: courseId });
      } else {
        startRace({ courseId: courseId });
      }
    }
    if (e.key === "Escape" || e.code === "Escape") {
      if (paused) {
        togglePause();
        return;
      }
      if (document.getElementById("level-select") &&
          !document.getElementById("level-select").classList.contains("show")) {
        showLevelSelect(true);
      }
    }
  }

  function showLevelSelect(show) {
    var sel = document.getElementById("level-select");
    var wrap = document.getElementById("game-wrap");
    if (!sel) return;
    if (show) {
      sel.classList.add("show");
      if (wrap) wrap.classList.add("dim");
      menuOpen = true;
      paused = false;
      hidePause();
      setTouchControlsVisible(false);
      if (Audio && Audio.stopEngine) Audio.stopEngine();
      if (Audio && Audio.stopMusic) Audio.stopMusic();
      refreshMetaPanels();
      // Keep RAF alive for resume, but frame() idles while menuOpen
      running = true;
      if (!rafId) rafId = requestAnimationFrame(frame);
    } else {
      sel.classList.remove("show");
      if (wrap) wrap.classList.remove("dim");
      menuOpen = false;
      running = true;
      lastTs = 0;
      setTouchControlsVisible(
        isCoarsePointer() || (settings && settings.forceTouch)
      );
      if (!rafId) rafId = requestAnimationFrame(frame);
    }
  }

  function refreshMetaPanels() {
    var bestEl = document.getElementById("meta-best");
    if (bestEl && Storage) {
      var all = Storage.getAllBestTimes();
      var lines = [];
      var id;
      for (id in all) {
        if (all.hasOwnProperty(id)) lines.push(id + ": " + all[id].toFixed(1) + "s");
      }
      bestEl.textContent = lines.length ? lines.join(" · ") : "No PBs yet — finish a race!";
    }
    var cupEl = document.getElementById("meta-cup");
    if (cupEl && Storage) {
      var cup = Storage.getCupState();
      var sess = Storage.getSessionState ? Storage.getSessionState() : null;
      var career = Storage.getCareer ? Storage.getCareer() : null;
      var sessBit =
        sess && sess.races
          ? " · Session " +
            sess.races +
            " (" +
            (sess.wins || 0) +
            "W" +
            (sess.winStreak ? " · streak " + sess.winStreak : "") +
            ")"
          : "";
      var careerBit =
        career
          ? " · Career L" +
            (career.level || 1) +
            " · " +
            (career.xp || 0) +
            " XP · " +
            (career.totalWins || 0) +
            " wins"
          : "";
      cupEl.textContent =
        "Cup pts: " +
        (cup.points.player || 0) +
        " · races " +
        (cup.racesDone ? cup.racesDone.length : 0) +
        "/" +
        Storage.CUP_COURSES.length +
        (cupMode ? " · ACTIVE" : "") +
        sessBit +
        careerBit;
    }
  }

  function buildLevelSelect() {
    var sel = document.getElementById("level-select");
    var grid = document.getElementById("course-grid");
    if (!sel || !grid || !Track.listCourses) return;
    var courses = Track.listCourses();
    grid.innerHTML = "";
    courses.forEach(function (c) {
      var locked =
        Storage &&
        Storage.isCourseUnlocked &&
        !Storage.isCourseUnlocked(c.id);
      var card = document.createElement("button");
      card.type = "button";
      card.className = "course-card" + (locked ? " locked" : "");
      card.style.setProperty("--accent", c.accent);
      card.style.setProperty("--accent2", c.accent2);
      if (locked) card.disabled = true;
      var wet = c.weather === "rain" ? " · WET" : "";
      var lockBit = locked
        ? " · LOCKED (win " +
          ((Storage.COURSE_UNLOCKS[c.id] &&
            Storage.COURSE_UNLOCKS[c.id].requiresWins) ||
            2) +
          ")"
        : "";
      card.innerHTML =
        '<div class="city">' +
        c.city +
        '</div><div class="name">' +
        c.name +
        '</div><div class="blurb">' +
        c.blurb +
        '</div><div class="diff">' +
        c.difficulty +
        " · " +
        (c.numLaps || "?") +
        " laps" +
        wet +
        lockBit +
        "</div>";
      card.addEventListener("click", function () {
        if (locked) return;
        courseId = c.id;
        // Manual course pick exits cup only if this isn't the active next cup leg
        if (cupMode && Storage) {
          var nextLeg = Storage.nextCupCourse();
          if (nextLeg && c.id !== nextLeg) {
            cupMode = false;
          }
        } else {
          cupMode = false;
        }
        showLevelSelect(false);
        startRace({
          courseId: c.id,
          timeTrial: timeTrialMode,
          difficulty: raceDifficulty,
        }).then(function () {
          running = true;
          lastTs = 0;
          if (!rafId) rafId = requestAnimationFrame(frame);
          if (Audio) Audio.resume();
        });
      });
      grid.appendChild(card);
    });
    refreshMetaPanels();
    refreshPaintOptions();
  }

  function bindHud() {
    hudEls = {
      standings: document.getElementById("hud-standings"),
      item: document.getElementById("hud-item"),
      speed: document.getElementById("hud-speed"),
      speedBar: document.getElementById("hud-speed-bar"),
      results: document.getElementById("hud-results"),
      courseName: document.getElementById("hud-course"),
      draft: document.getElementById("hud-draft"),
      camMode: document.getElementById("hud-cam-mode"),
      minimap: document.getElementById("hud-minimap"),
      drift: document.getElementById("hud-drift"),
      driftBar: document.getElementById("hud-drift-bar"),
      shield: document.getElementById("hud-shield"),
      wrongWay: document.getElementById("hud-wrong-way"),
      nextDir: document.getElementById("hud-next-dir"),
      cockpitReadout: document.getElementById("hud-cockpit-readout"),
      styleToast: document.getElementById("hud-style-toast"),
      styleScore: document.getElementById("hud-style-score"),
      rival: document.getElementById("hud-rival"),
      comeback: document.getElementById("hud-comeback"),
      comebackBar: document.getElementById("hud-comeback-bar"),
      lastLap: document.getElementById("hud-last-lap"),
      countdown: document.getElementById("hud-countdown"),
      raceClock: document.getElementById("hud-race-clock"),
      placeFlash: document.getElementById("hud-place-flash"),
      taunt: document.getElementById("hud-taunt"),
      replayBanner: document.getElementById("hud-replay"),
      touchRoot: document.getElementById("touch-controls"),
    };
  }

  function isCoarsePointer() {
    try {
      return (
        (typeof window !== "undefined" &&
          window.matchMedia &&
          window.matchMedia("(pointer: coarse)").matches) ||
        (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
      );
    } catch (e) {
      return false;
    }
  }

  function setTouchControlsVisible(show) {
    if (!hudEls || !hudEls.touchRoot) return;
    if (show) hudEls.touchRoot.classList.add("show");
    else hudEls.touchRoot.classList.remove("show");
  }

  /**
   * Bind on-screen GO/BRAKE/DRIFT/ITEM + virtual steer stick.
   */
  function wireTouchControls() {
    var root = document.getElementById("touch-controls");
    if (!root || !Input || !Input.setTouchState) return;
    var stick = document.getElementById("touch-stick");
    var knob = document.getElementById("touch-stick-knob");
    var stickId = null;

    function bindHold(btn, field) {
      if (!btn) return;
      var down = function (e) {
        if (e.cancelable) e.preventDefault();
        btn.classList.add("active");
        var o = {};
        o[field] = true;
        Input.setTouchState(o);
      };
      var up = function (e) {
        if (e && e.cancelable) e.preventDefault();
        btn.classList.remove("active");
        var o = {};
        o[field] = false;
        Input.setTouchState(o);
      };
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointerleave", up);
      btn.addEventListener("pointercancel", up);
    }
    bindHold(document.getElementById("touch-accel"), "accel");
    bindHold(document.getElementById("touch-brake"), "brake");
    bindHold(document.getElementById("touch-drift"), "drift");
    bindHold(document.getElementById("touch-item"), "useItem");

    if (stick) {
      var moveStick = function (clientX, clientY) {
        var rect = stick.getBoundingClientRect();
        var cx = rect.left + rect.width * 0.5;
        var cy = rect.top + rect.height * 0.5;
        var dx = clientX - cx;
        var dy = clientY - cy;
        var maxR = rect.width * 0.38;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        if (len > maxR) {
          dx = (dx / len) * maxR;
          dy = (dy / len) * maxR;
        }
        if (knob) {
          knob.style.transform =
            "translate(" + dx + "px," + dy + "px)";
        }
        // Horizontal axis only for steer
        Input.setTouchState({ steerAxis: dx / maxR });
      };
      var endStick = function () {
        stickId = null;
        if (knob) knob.style.transform = "translate(0,0)";
        Input.setTouchState({
          steerAxis: 0,
          left: false,
          right: false,
        });
      };
      stick.addEventListener("pointerdown", function (e) {
        stickId = e.pointerId;
        stick.setPointerCapture(e.pointerId);
        moveStick(e.clientX, e.clientY);
      });
      stick.addEventListener("pointermove", function (e) {
        if (stickId !== e.pointerId) return;
        moveStick(e.clientX, e.clientY);
      });
      stick.addEventListener("pointerup", endStick);
      stick.addEventListener("pointercancel", endStick);
    }
  }

  function refreshPaintOptions() {
    var paintSel = document.getElementById("set-paint");
    if (!paintSel || !Storage || !Storage.PAINT_CATALOG) return;
    var catalog = Storage.PAINT_CATALOG;
    var i, p, unlocked, opt;
    paintSel.innerHTML = "";
    for (i = 0; i < catalog.length; i++) {
      p = catalog[i];
      unlocked = !Storage.isPaintUnlocked || Storage.isPaintUnlocked(p.id);
      opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = unlocked
        ? p.name
        : p.name + " (win " + p.requiresWins + ")";
      opt.disabled = !unlocked;
      paintSel.appendChild(opt);
    }
    if (settings && settings.paintIndex != null) {
      if (Storage.isPaintUnlocked && !Storage.isPaintUnlocked(settings.paintIndex)) {
        settings.paintIndex = 0;
        paintIndex = 0;
      }
      paintSel.value = String(settings.paintIndex || 0);
    }
  }

  function wireMenus() {
    var btnPauseResume = document.getElementById("btn-resume");
    var btnPauseRestart = document.getElementById("btn-restart");
    var btnPauseCourses = document.getElementById("btn-pause-courses");
    if (btnPauseResume) {
      btnPauseResume.addEventListener("click", function () {
        if (paused) togglePause();
      });
    }
    if (btnPauseRestart) {
      btnPauseRestart.addEventListener("click", function () {
        startRace({ courseId: courseId }).then(function () {
          running = true;
          lastTs = 0;
        });
      });
    }
    if (btnPauseCourses) {
      btnPauseCourses.addEventListener("click", function () {
        paused = false;
        hidePause();
        showLevelSelect(true);
      });
    }

    var vol = document.getElementById("set-volume");
    if (vol) {
      vol.value = settings.volume;
      vol.addEventListener("input", function () {
        settings.volume = parseFloat(vol.value);
        if (Audio) {
          if (Audio.setSfxVolume) Audio.setSfxVolume(settings.volume);
          else Audio.setVolume(settings.volume);
        }
        if (Storage) Storage.saveSettings({ volume: settings.volume });
      });
    }
    var mus = document.getElementById("set-music");
    if (mus) {
      mus.value =
        settings.musicVolume != null ? settings.musicVolume : 0.35;
      mus.addEventListener("input", function () {
        settings.musicVolume = parseFloat(mus.value);
        if (Audio && Audio.setMusicVolume) {
          Audio.setMusicVolume(settings.musicVolume);
        }
        if (Storage) Storage.saveSettings({ musicVolume: settings.musicVolume });
      });
    }
    var stickSens = document.getElementById("set-stick-sens");
    if (stickSens) {
      stickSens.value =
        settings.stickSensitivity != null ? settings.stickSensitivity : 1;
      stickSens.addEventListener("input", function () {
        settings.stickSensitivity = parseFloat(stickSens.value);
        applySettingsToSystems();
        if (Storage) {
          Storage.saveSettings({ stickSensitivity: settings.stickSensitivity });
        }
      });
    }
    var stickDz = document.getElementById("set-stick-dz");
    if (stickDz) {
      stickDz.value =
        settings.stickDeadzone != null ? settings.stickDeadzone : 0.22;
      stickDz.addEventListener("input", function () {
        settings.stickDeadzone = parseFloat(stickDz.value);
        applySettingsToSystems();
        if (Storage) {
          Storage.saveSettings({ stickDeadzone: settings.stickDeadzone });
        }
      });
    }
    var camSel = document.getElementById("set-camera");
    if (camSel) {
      camSel.value = settings.camera || "chase";
      camSel.addEventListener("change", function () {
        settings.camera = camSel.value;
        if (Render3D && Render3D.setCameraMode) Render3D.setCameraMode(settings.camera);
        if (Storage) Storage.saveSettings({ camera: settings.camera });
      });
    }
    var qualSel = document.getElementById("set-quality");
    if (qualSel) {
      qualSel.value = settings.quality || "high";
      qualSel.addEventListener("change", function () {
        settings.quality = qualSel.value;
        if (Render3D && Render3D.setQuality) Render3D.setQuality(settings.quality);
        if (Storage) Storage.saveSettings({ quality: settings.quality });
        // Rebuild world to apply building density
        if (state && use3D && Render3D && canvas) {
          try {
            Render3D.init(canvas, state, { force: true });
          } catch (e) {}
        }
      });
    }
    var paintSel = document.getElementById("set-paint");
    if (paintSel) {
      paintSel.value = String(settings.paintIndex || 0);
      paintSel.addEventListener("change", function () {
        paintIndex = parseInt(paintSel.value, 10) || 0;
        settings.paintIndex = paintIndex;
        if (Storage) Storage.saveSettings({ paintIndex: paintIndex });
      });
    }
    var diffSel = document.getElementById("set-difficulty");
    if (diffSel) {
      diffSel.value = raceDifficulty || "normal";
      diffSel.addEventListener("change", function () {
        raceDifficulty = diffSel.value || "normal";
        if (settings && Storage) {
          settings.difficulty = raceDifficulty;
          Storage.saveSettings({ difficulty: raceDifficulty });
        }
      });
    }
    var btnCup = document.getElementById("btn-cup");
    if (btnCup && Storage) {
      btnCup.addEventListener("click", function () {
        // Resume unfinished cup if still active; only startCup when idle/complete
        var cup = Storage.getCupState();
        if (!cup.active || !cup.racesDone || cup.racesDone.length === 0) {
          Storage.startCup();
        }
        cupMode = true;
        timeTrialMode = false;
        var next = Storage.nextCupCourse() || Storage.CUP_COURSES[0];
        courseId = next;
        showLevelSelect(false);
        startRace({ courseId: next, difficulty: raceDifficulty }).then(function () {
          running = true;
          lastTs = 0;
          if (!rafId) rafId = requestAnimationFrame(frame);
          refreshMetaPanels();
        });
      });
    }
    var btnTT = document.getElementById("btn-time-trial");
    if (btnTT) {
      btnTT.addEventListener("click", function () {
        timeTrialMode = true;
        cupMode = false;
        courseId = courseId || Track.DEFAULT_COURSE_ID;
        showLevelSelect(false);
        startRace({
          courseId: courseId,
          timeTrial: true,
          difficulty: raceDifficulty,
        }).then(function () {
          running = true;
          lastTs = 0;
          if (!rafId) rafId = requestAnimationFrame(frame);
          refreshMetaPanels();
        });
      });
    }
    var tipClose = document.getElementById("tips-close");
    if (tipClose) {
      tipClose.addEventListener("click", function () {
        var tips = document.getElementById("tips-panel");
        if (tips) tips.classList.remove("show");
        tipsVisible = false;
        if (Storage) Storage.saveSettings({ tipsDismissed: true });
        settings.tipsDismissed = true;
      });
    }
  }

  function showTipsIfNeeded() {
    if (settings && settings.tipsDismissed) return;
    var tips = document.getElementById("tips-panel");
    if (tips) {
      tips.classList.add("show");
      tipsVisible = true;
    }
  }

  function boot(opts) {
    opts = opts || {};
    if (typeof document === "undefined") {
      throw new Error("NeoKart.boot requires a browser document");
    }
    canvas = opts.canvas || document.getElementById("game");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "game";
      document.body.appendChild(canvas);
    }

    settings = Storage
      ? Storage.loadSettings()
      : {
          volume: 0.7,
          camera: "chase",
          quality: "high",
          paintIndex: 0,
          difficulty: "normal",
        };
    if (!settings.quality) settings.quality = "high";
    paintIndex = settings.paintIndex || 0;
    raceDifficulty = settings.difficulty || "normal";

    // Prefer 3D when stack already present; else load on first race
    use3D = opts.force2D !== true;
    heavyReady = !!(root.THREE && root.NeoKartRender3D);
    if (heavyReady) {
      refreshModules();
      applySettingsToSystems();
    }
    courseId = opts.courseId || Track.DEFAULT_COURSE_ID;

    bindHud();
    buildLevelSelect();
    wireMenus();
    wireTouchControls();
    Input.attach(window);
    window.addEventListener("keydown", onKeyRestart);
    window.addEventListener(
      "pointerdown",
      function () {
        if (Audio) Audio.resume();
      },
      { once: true }
    );

    var menuBtn = document.getElementById("btn-courses");
    if (menuBtn) {
      menuBtn.addEventListener("click", function () {
        showLevelSelect(true);
      });
    }

    showTipsIfNeeded();

    // Prefetch 3D stack in background after first paint (non-blocking)
    if (use3D && !heavyReady && typeof requestIdleCallback === "function") {
      requestIdleCallback(function () {
        ensureHeavyAssets();
      }, { timeout: 2500 });
    } else if (use3D && !heavyReady) {
      setTimeout(function () {
        ensureHeavyAssets();
      }, 600);
    }

    if (opts.skipMenu) {
      showLevelSelect(false);
      startRace(opts).then(function () {
        running = true;
        lastTs = 0;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(frame);
      });
    } else {
      // Fast menu: no race sim / WebGL until course pick
      showLevelSelect(true);
      running = true;
      lastTs = 0;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(frame);
    }

    window.addEventListener("resize", function () {
      if (use3D && Render3D && canvas) Render3D.ensureSize(canvas);
    });

    return {
      getState: function () {
        return state;
      },
      restart: startRace,
      selectCourse: function (id) {
        courseId = id;
        return startRace({ courseId: id });
      },
      canvas: canvas,
      listCourses: function () {
        return Track.listCourses();
      },
      togglePause: togglePause,
    };
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (Audio && Audio.stopEngine) Audio.stopEngine();
    if (Audio && Audio.stopMusic) Audio.stopMusic();
  }

  function stepOnce(playerInput, dt) {
    // Sync path for tests — no WebGL load required
    if (!state) startRaceSync({ skipMenu: true });
    var inputs = Engine.buildInputs(state, playerInput || Engine.emptyInput());
    Engine.step(state, inputs, dt != null ? dt : 1 / 60);
    return state;
  }

  var api = {
    boot: boot,
    startRace: startRace,
    stop: stop,
    stepOnce: stepOnce,
    getState: function () {
      return state;
    },
    version: "2026.12.0",
    name: "Neon Circuit 2026",
  };

  root.NeoKart = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
