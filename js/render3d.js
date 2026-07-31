/**
 * Neon Circuit 2026 — GPU path (macOS Metal/WebGL).
 * Quality presets + adaptive scale; world rebuild only when track/quality needs it.
 * Requires THREE + NeoKartVehicles + NeoKartFX.
 */
(function (root) {
  "use strict";

  var CANVAS_W = 1280;
  var CANVAS_H = 720;

  /**
   * Default = high (fast first paint + stable 60fps).
   * Ultra is opt-in via settings; adaptive can step down under load.
   */
  var QUALITY = {
    preset: "high",
    shadowMap: 2048,
    anisotropy: 8,
    maxDpr: 2,
    renderScale: 1.1,
    bloom: true,
    ssao: false,
    bloomPasses: 2,
    buildingCount: 90,
    streetProps: true,
    trees: true,
    treeCount: 45,
    softShadowRadius: 4,
    particlesBoost: 220,
    particlesSpark: 120,
    logarithmicDepth: true,
  };

  var QUALITY_PRESETS = {
    ultra: {
      preset: "ultra",
      shadowMap: 4096,
      anisotropy: 16,
      maxDpr: 2.5,
      renderScale: 1.35,
      bloom: true,
      ssao: true,
      bloomPasses: 2,
      buildingCount: 140,
      streetProps: true,
      trees: true,
      treeCount: 70,
      softShadowRadius: 6,
      particlesBoost: 360,
      particlesSpark: 200,
      logarithmicDepth: true,
    },
    high: {
      preset: "high",
      shadowMap: 2048,
      anisotropy: 8,
      maxDpr: 2,
      renderScale: 1.1,
      bloom: true,
      ssao: false,
      bloomPasses: 2,
      buildingCount: 90,
      streetProps: true,
      trees: true,
      treeCount: 45,
      softShadowRadius: 4,
      particlesBoost: 220,
      particlesSpark: 120,
      logarithmicDepth: true,
    },
    medium: {
      preset: "medium",
      shadowMap: 1024,
      anisotropy: 4,
      maxDpr: 1.5,
      renderScale: 1,
      bloom: false,
      ssao: false,
      bloomPasses: 1,
      buildingCount: 48,
      streetProps: false,
      trees: true,
      treeCount: 22,
      softShadowRadius: 2,
      particlesBoost: 80,
      particlesSpark: 48,
      logarithmicDepth: false,
    },
  };

  function setQuality(preset) {
    var p = QUALITY_PRESETS[preset] || QUALITY_PRESETS.high;
    var k;
    for (k in p) {
      if (p.hasOwnProperty(k)) QUALITY[k] = p[k];
    }
    return QUALITY;
  }

  /**
   * Runtime-only step-down (no full world rebuild).
   * Used when frame time stays high.
   */
  function adaptQualityDown() {
    var changed = false;
    if (QUALITY.ssao) {
      QUALITY.ssao = false;
      changed = true;
    } else if (QUALITY.bloomPasses > 1) {
      QUALITY.bloomPasses = 1;
      changed = true;
    } else if (QUALITY.bloom) {
      QUALITY.bloom = false;
      if (ctx3d && ctx3d.bloom) ctx3d.bloom.enabled = false;
      changed = true;
    } else if (QUALITY.renderScale > 1.0) {
      QUALITY.renderScale = Math.max(1, +(QUALITY.renderScale - 0.15).toFixed(2));
      changed = true;
    } else if (QUALITY.maxDpr > 1.25) {
      QUALITY.maxDpr = Math.max(1.25, QUALITY.maxDpr - 0.25);
      changed = true;
    }
    if (changed && QUALITY.preset === "ultra") QUALITY.preset = "high";
    else if (changed && QUALITY.preset === "high" && !QUALITY.bloom) {
      QUALITY.preset = "medium";
    }
    return changed;
  }

  function detectDefaultQuality() {
    // Cap auto-detect to "high" — ultra is user opt-in only
    try {
      var glCanvas = document.createElement("canvas");
      var gl =
        glCanvas.getContext("webgl2", { powerPreference: "high-performance" }) ||
        glCanvas.getContext("webgl", { powerPreference: "high-performance" });
      if (!gl) {
        setQuality("medium");
        return;
      }
      var dbg = gl.getExtension("WEBGL_debug_renderer_info");
      var renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "";
      var isWeak =
        /Intel|SwiftShader|Microsoft Basic|llvmpipe|Mali-4|Adreno 3/i.test(
          String(renderer)
        );
      var dpr =
        typeof window !== "undefined" && window.devicePixelRatio
          ? window.devicePixelRatio
          : 1;
      if (isWeak || dpr >= 3) {
        setQuality("medium");
      } else {
        setQuality("high");
      }
      var lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    } catch (e) {
      setQuality("high");
    }
  }
  if (typeof document !== "undefined") {
    try {
      detectDefaultQuality();
    } catch (e2) {}
  }

  var ctx3d = null; // { renderer, scene, camera, root, karts, boxes, hazards, projectiles, particles, ... }

  function Vehicles() {
    return root.NeoKartVehicles;
  }

  function FX() {
    return root.NeoKartFX;
  }

  function canvasTex(THREE, drawFn, size, repeatU, repeatV, isData) {
    size = size || 1024;
    var c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    var ctx = c.getContext("2d");
    drawFn(ctx, size);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatU != null ? repeatU : 4, repeatV != null ? repeatV : 40);
    tex.anisotropy = QUALITY.anisotropy;
    if (!isData && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /** Daytime curtain-wall glass: cool sky reflection + soft interior */
  function makeWindowTexture(THREE) {
    return canvasTex(
      THREE,
      function (ctx, size) {
        var g = ctx.createLinearGradient(0, 0, size, size);
        g.addColorStop(0, "#9ec8e8");
        g.addColorStop(0.45, "#c8dce8");
        g.addColorStop(1, "#7eb0d0");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        var cell = 28;
        var x, y;
        for (y = 2; y < size; y += cell) {
          for (x = 2; x < size; x += cell) {
            var a = 0.15 + Math.random() * 0.35;
            ctx.fillStyle =
              Math.random() > 0.55
                ? "rgba(255,255,255," + a + ")"
                : "rgba(40,70,100," + (0.12 + Math.random() * 0.2) + ")";
            ctx.fillRect(x, y, cell - 6, cell - 8);
          }
        }
        // mullions
        ctx.strokeStyle = "rgba(60,70,80,0.45)";
        ctx.lineWidth = 2;
        for (x = 0; x < size; x += cell) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, size);
          ctx.stroke();
        }
        for (y = 0; y < size; y += cell) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(size, y);
          ctx.stroke();
        }
      },
      512,
      2,
      4
    );
  }

  /** Soft fairway grass — Golf+ style (smooth, saturated, low tile noise) */
  function makeGroundTexture(THREE, theme) {
    var base = theme.ground != null ? theme.ground : 0x4a9a48;
    var alt = theme.groundAlt != null ? theme.groundAlt : 0x5aab55;
    function hex(c) {
      return "#" + (c >>> 0).toString(16).padStart(6, "0");
    }
    return canvasTex(
      THREE,
      function (ctx, size) {
        var g = ctx.createLinearGradient(0, 0, size, size);
        g.addColorStop(0, hex(base));
        g.addColorStop(0.5, hex(alt));
        g.addColorStop(1, hex(base));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        // soft large-scale mottling only (no harsh pixels)
        var i;
        for (i = 0; i < 80; i++) {
          var rg = ctx.createRadialGradient(0, 0, 2, 0, 0, 40 + Math.random() * 60);
          rg.addColorStop(0, "rgba(255,255,255,0.08)");
          rg.addColorStop(1, "rgba(0,0,0,0)");
          ctx.save();
          ctx.translate(Math.random() * size, Math.random() * size);
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(0, 0, 80, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        for (i = 0; i < 40; i++) {
          ctx.fillStyle = "rgba(20,60,20,0.06)";
          ctx.beginPath();
          ctx.ellipse(
            Math.random() * size,
            Math.random() * size,
            20 + Math.random() * 40,
            10 + Math.random() * 20,
            Math.random() * Math.PI,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      },
      512,
      6,
      6
    );
  }

  /** Simple stylized trees (premium VR prop language) */
  function makeTree(THREE, scale) {
    var g = new THREE.Group();
    scale = scale || 1;
    var trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5 * scale, 0.7 * scale, 4 * scale, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.85, metalness: 0.05 })
    );
    trunk.position.y = 2 * scale;
    trunk.castShadow = true;
    g.add(trunk);
    var leafMat = new THREE.MeshStandardMaterial({
      color: 0x3d9a45,
      roughness: 0.75,
      metalness: 0.02,
    });
    var canopy = new THREE.Mesh(new THREE.SphereGeometry(3.2 * scale, 14, 12), leafMat);
    canopy.position.y = 5.5 * scale;
    canopy.scale.y = 0.85;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    g.add(canopy);
    var canopy2 = new THREE.Mesh(new THREE.SphereGeometry(2.4 * scale, 12, 10), leafMat);
    canopy2.position.set(1.2 * scale, 6.2 * scale, 0.4 * scale);
    canopy2.castShadow = true;
    g.add(canopy2);
    return g;
  }

  /**
   * Photoreal asphalt albedo: binder, aggregate, tire polish, patches, cracks, oil.
   * UV: U = across road, V = along road (set by ribbon builder).
   */
  function makeAsphaltTexture(THREE) {
    return canvasTex(
      THREE,
      function (ctx, size) {
        // Dark warm-gray binder base
        var base = ctx.createLinearGradient(0, 0, size, 0);
        base.addColorStop(0, "#3a3c40");
        base.addColorStop(0.5, "#2e3034");
        base.addColorStop(1, "#3a3c40");
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, size, size);

        var i, x, y, v, s;
        // Stone aggregate (speckled)
        for (i = 0; i < 28000; i++) {
          x = Math.random() * size;
          y = Math.random() * size;
          v = 45 + Math.random() * 70;
          s = 0.5 + Math.random() * 2.2;
          var warm = Math.random() * 12;
          ctx.fillStyle =
            "rgba(" +
            Math.min(255, v + warm) +
            "," +
            Math.min(255, v + warm * 0.5) +
            "," +
            Math.min(255, v) +
            "," +
            (0.2 + Math.random() * 0.45) +
            ")";
          ctx.fillRect(x, y, s, s);
        }
        // Darker tar pockets
        for (i = 0; i < 3500; i++) {
          ctx.fillStyle = "rgba(18,18,20," + (0.1 + Math.random() * 0.25) + ")";
          ctx.beginPath();
          ctx.arc(Math.random() * size, Math.random() * size, 0.8 + Math.random() * 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Longitudinal tire polish (darker/smoother bands)
        for (i = 0; i < 5; i++) {
          var lx = size * (0.18 + i * 0.16);
          var band = ctx.createLinearGradient(lx - 12, 0, lx + 12, 0);
          band.addColorStop(0, "rgba(0,0,0,0)");
          band.addColorStop(0.5, "rgba(25,26,28,0.35)");
          band.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = band;
          ctx.fillRect(lx - 14, 0, 28, size);
        }
        // Asphalt repair patches
        for (i = 0; i < 18; i++) {
          ctx.fillStyle = "rgba(36,38,42," + (0.35 + Math.random() * 0.35) + ")";
          ctx.fillRect(
            Math.random() * size,
            Math.random() * size,
            18 + Math.random() * 55,
            10 + Math.random() * 40
          );
        }
        // Oil spots
        for (i = 0; i < 14; i++) {
          x = Math.random() * size;
          y = Math.random() * size;
          var og = ctx.createRadialGradient(x, y, 1, x, y, 8 + Math.random() * 22);
          og.addColorStop(0, "rgba(30,40,50,0.45)");
          og.addColorStop(0.5, "rgba(40,50,55,0.2)");
          og.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = og;
          ctx.fillRect(x - 30, y - 30, 60, 60);
        }
        // Fine cracks
        ctx.strokeStyle = "rgba(12,12,14,0.35)";
        ctx.lineWidth = 1;
        for (i = 0; i < 60; i++) {
          ctx.beginPath();
          x = Math.random() * size;
          y = Math.random() * size;
          ctx.moveTo(x, y);
          ctx.lineTo(x + (Math.random() - 0.5) * 50, y + Math.random() * 70);
          ctx.stroke();
        }
        // Subtle edge wear (lighter at U edges)
        var edge = ctx.createLinearGradient(0, 0, size, 0);
        edge.addColorStop(0, "rgba(70,72,76,0.25)");
        edge.addColorStop(0.08, "rgba(0,0,0,0)");
        edge.addColorStop(0.92, "rgba(0,0,0,0)");
        edge.addColorStop(1, "rgba(70,72,76,0.25)");
        ctx.fillStyle = edge;
        ctx.fillRect(0, 0, size, size);
      },
      1024,
      2.2,
      48
    );
  }

  function makeAsphaltNormal(THREE) {
    return canvasTex(
      THREE,
      function (ctx, size) {
        // Flat normal base
        ctx.fillStyle = "#8080ff";
        ctx.fillRect(0, 0, size, size);
        var i, n, x, y;
        // Aggregate bump noise
        for (i = 0; i < 22000; i++) {
          n = 105 + Math.random() * 50;
          x = Math.random() * size;
          y = Math.random() * size;
          ctx.fillStyle = "rgb(" + n + "," + (n - 4 + Math.random() * 8) + ",255)";
          ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
        }
        // Tire groove striations along V
        ctx.strokeStyle = "rgba(95,95,255,0.4)";
        ctx.lineWidth = 1;
        for (i = 0; i < 90; i++) {
          x = Math.random() * size;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + (Math.random() - 0.5) * 3, size);
          ctx.stroke();
        }
      },
      512,
      2.2,
      48,
      true
    );
  }

  function makeAsphaltRoughness(THREE) {
    return canvasTex(
      THREE,
      function (ctx, size) {
        ctx.fillStyle = "#b0b0b0";
        ctx.fillRect(0, 0, size, size);
        var i, x;
        // Polished wheel paths = lower roughness (darker in roughness map)
        for (i = 0; i < 5; i++) {
          x = size * (0.18 + i * 0.16);
          var g = ctx.createLinearGradient(x - 16, 0, x + 16, 0);
          g.addColorStop(0, "rgba(176,176,176,0)");
          g.addColorStop(0.5, "rgba(70,70,70,0.9)");
          g.addColorStop(1, "rgba(176,176,176,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x - 16, 0, 32, size);
        }
        for (i = 0; i < 4000; i++) {
          var v = 140 + Math.random() * 80;
          ctx.fillStyle = "rgba(" + v + "," + v + "," + v + ",0.3)";
          ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
        }
      },
      512,
      2.2,
      48,
      true
    );
  }

  function makeGravelTexture(THREE) {
    return canvasTex(
      THREE,
      function (ctx, size) {
        ctx.fillStyle = "#6a6558";
        ctx.fillRect(0, 0, size, size);
        var i, v;
        for (i = 0; i < 16000; i++) {
          v = 80 + Math.random() * 90;
          ctx.fillStyle =
            "rgb(" +
            Math.min(255, v + 15) +
            "," +
            Math.min(255, v + 8) +
            "," +
            Math.min(255, v - 5) +
            ")";
          ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3.5, 1 + Math.random() * 3.5);
        }
        // Larger stones
        for (i = 0; i < 800; i++) {
          v = 90 + Math.random() * 60;
          ctx.fillStyle = "rgba(" + v + "," + (v - 5) + "," + (v - 15) + ",0.7)";
          ctx.beginPath();
          ctx.arc(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      512,
      3,
      20
    );
  }

  function makeWornPaintTexture(THREE, hexRgb) {
    return canvasTex(
      THREE,
      function (ctx, size) {
        ctx.fillStyle = hexRgb || "#f4f4ee";
        ctx.fillRect(0, 0, size, size);
        var i;
        // Wear chips
        for (i = 0; i < 400; i++) {
          ctx.fillStyle = "rgba(40,40,40," + (0.15 + Math.random() * 0.4) + ")";
          ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 4, 1 + Math.random() * 8);
        }
        // Fade streaks along V
        for (i = 0; i < 20; i++) {
          ctx.fillStyle = "rgba(30,30,30," + (0.08 + Math.random() * 0.12) + ")";
          ctx.fillRect(Math.random() * size, 0, 2 + Math.random() * 6, size);
        }
      },
      128,
      1,
      8
    );
  }

  function makeConcreteTexture(THREE) {
    return canvasTex(
      THREE,
      function (ctx, size) {
        ctx.fillStyle = "#8a8c90";
        ctx.fillRect(0, 0, size, size);
        var i;
        for (i = 0; i < 5000; i++) {
          var v = 120 + Math.random() * 40;
          ctx.fillStyle = "rgba(" + v + "," + v + "," + (v + 2) + ",0.35)";
          ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
        }
        // formwork seams
        ctx.strokeStyle = "rgba(60,60,65,0.4)";
        ctx.lineWidth = 2;
        for (i = 0; i < 6; i++) {
          var y = ((i + 1) / 7) * size;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(size, y);
          ctx.stroke();
        }
      },
      256,
      2,
      16
    );
  }

  function hexCss(c) {
    return "#" + (c >>> 0).toString(16).padStart(6, "0");
  }

  /** Premium VR sky — soft blue, gentle sun (Golf+ language) */
  function makeSkyDome(THREE, theme) {
    var group = new THREE.Group();
    var geo = new THREE.SphereGeometry(1100, 48, 24);
    geo.scale(-1, 1, 1);
    var c = document.createElement("canvas");
    c.width = 8;
    c.height = 512;
    var ctx = c.getContext("2d");
    // Always clean sky for VR polish (ignore dark theme tops)
    var zenith = "#3d9aef";
    var mid = "#6eb6f5";
    var horizon = "#d4ecff";
    var groundHaze = "#eef6ff";
    var g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, zenith);
    g.addColorStop(0.4, mid);
    g.addColorStop(0.68, horizon);
    g.addColorStop(0.85, groundHaze);
    g.addColorStop(1, "#f5fafc");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 512);
    // soft white cloud puffs
    var i;
    ctx.globalAlpha = 0.2;
    for (i = 0; i < 12; i++) {
      var cy = 200 + Math.random() * 120;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(4, cy, 1.5 + Math.random() * 2, 6 + Math.random() * 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    var tex = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    var mat = new THREE.MeshBasicMaterial({ map: tex, depthWrite: false });
    var dome = new THREE.Mesh(geo, mat);
    dome.renderOrder = -20;
    group.add(dome);

    // Sun disc + corona (world-space; positioned in buildWorld)
    var sunColor = theme.sunColor != null ? theme.sunColor : 0xfff8e0;
    var sunCore = new THREE.Mesh(
      new THREE.SphereGeometry(28, 24, 16),
      new THREE.MeshBasicMaterial({ color: sunColor, fog: false })
    );
    var sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(55, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffe8a0,
        transparent: true,
        opacity: 0.35,
        fog: false,
        depthWrite: false,
      })
    );
    var sunHalo = new THREE.Mesh(
      new THREE.SphereGeometry(95, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0xfff0c8,
        transparent: true,
        opacity: 0.12,
        fog: false,
        depthWrite: false,
      })
    );
    var sun = new THREE.Group();
    sun.add(sunCore);
    sun.add(sunGlow);
    sun.add(sunHalo);
    sun.userData.isSun = true;
    group.add(sun);
    group.userData.sun = sun;
    group.renderOrder = -10;
    return group;
  }

  function ensureSize(canvas) {
    if (!canvas) return;
    var dpr = Math.min(
      typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1,
      QUALITY.maxDpr
    );
    var scale = QUALITY.renderScale != null ? QUALITY.renderScale : 1;
    var w = canvas.clientWidth || CANVAS_W;
    var h = canvas.clientHeight || CANVAS_H;
    // Supersampled internal buffer — GPU fills more pixels (macOS retina++)
    var bw = Math.floor(w * dpr * scale);
    var bh = Math.floor(h * dpr * scale);
    // Cap extreme buffers (~16MP) to avoid OOM
    var maxPx = 16 * 1024 * 1024;
    if (bw * bh > maxPx) {
      var k = Math.sqrt(maxPx / (bw * bh));
      bw = Math.floor(bw * k);
      bh = Math.floor(bh * k);
    }
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      if (ctx3d && ctx3d.renderer) {
        // Drawing buffer is supersampled; CSS size stays w×h
        ctx3d.renderer.setSize(bw, bh, false);
        ctx3d.renderer.setPixelRatio(1);
        ctx3d.camera.aspect = w / h;
        ctx3d.camera.updateProjectionMatrix();
        if (ctx3d.bloom) ctx3d.bloom.setSize(bw, bh);
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
      }
    }
    return { w: w, h: h, dpr: dpr, scale: scale, bw: bw, bh: bh };
  }

  function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(function (child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(function (m) {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        } else {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      }
    });
  }

  function disposeScene() {
    if (!ctx3d) return;
    if (ctx3d.root) {
      disposeObject(ctx3d.root);
      ctx3d.scene.remove(ctx3d.root);
    }
    if (ctx3d.rain) {
      disposeObject(ctx3d.rain);
      ctx3d.scene.remove(ctx3d.rain);
    }
    if (ctx3d.stars) {
      disposeObject(ctx3d.stars);
      ctx3d.scene.remove(ctx3d.stars);
    }
    if (ctx3d.sky) {
      disposeObject(ctx3d.sky);
      ctx3d.scene.remove(ctx3d.sky);
      ctx3d.sky = null;
    }
    ctx3d.kartMeshes = [];
    ctx3d.boxMeshes = [];
    ctx3d.hazardMeshes = [];
    ctx3d.projMeshes = [];
    ctx3d.boostTrails = [];
    ctx3d.cockpit = null;
  }

  function to3(x, y, elev) {
    // sim x,y plane → Three x, y-up, z
    return { x: x, y: elev != null ? elev : 0, z: y };
  }

  /**
   * Catmull-Rom densify of a closed path for silky road/line curves.
   * samplesPerSeg subdivides each existing segment.
   */
  function subdivideClosedPath(waypoints, samplesPerSeg) {
    samplesPerSeg = Math.max(1, samplesPerSeg | 0);
    if (!waypoints || waypoints.length < 3 || samplesPerSeg === 1) {
      return (waypoints || []).map(function (p) {
        return { x: p.x, y: p.y, z: p.z || 0 };
      });
    }
    var n = waypoints.length;
    var out = [];
    var i, j, t, tt, ttt, p0, p1, p2, p3, x, y, z;
    function get(k) {
      var p = waypoints[(k + n) % n];
      return { x: p.x, y: p.y, z: p.z || 0 };
    }
    for (i = 0; i < n; i++) {
      p0 = get(i - 1);
      p1 = get(i);
      p2 = get(i + 1);
      p3 = get(i + 2);
      for (j = 0; j < samplesPerSeg; j++) {
        t = j / samplesPerSeg;
        tt = t * t;
        ttt = tt * t;
        x =
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * ttt);
        y =
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * ttt);
        z =
          0.5 *
          (2 * p1.z +
            (-p0.z + p2.z) * t +
            (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * tt +
            (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * ttt);
        if (z < 0) z = 0;
        out.push({ x: x, y: y, z: z });
      }
    }
    return out;
  }

  /**
   * Smooth lateral normals at each station (averaged tangents + miter).
   * Prevents faceted "polygon" edges on curves.
   */
  function pathFrame(waypoints) {
    var n = waypoints.length;
    var tangents = new Array(n);
    var normals = new Array(n);
    var i, prev, next, tx, ty, len, nx, ny;
    for (i = 0; i < n; i++) {
      prev = waypoints[(i - 1 + n) % n];
      next = waypoints[(i + 1) % n];
      tx = next.x - prev.x;
      ty = next.y - prev.y;
      len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      tangents[i] = { x: tx, y: ty };
      // left-hand normal of forward tangent
      normals[i] = { x: -ty, y: tx };
    }
    // Blend normals with neighbors for C1-ish edges
    var smooth = new Array(n);
    for (i = 0; i < n; i++) {
      var a = normals[(i - 1 + n) % n];
      var b = normals[i];
      var c = normals[(i + 1) % n];
      nx = a.x * 0.25 + b.x * 0.5 + c.x * 0.25;
      ny = a.y * 0.25 + b.y * 0.5 + c.y * 0.25;
      len = Math.hypot(nx, ny) || 1;
      smooth[i] = { x: nx / len, y: ny / len };
    }
    return { tangents: tangents, normals: normals, smooth: smooth };
  }

  /**
   * Continuous closed ribbon between lateral offsets [offA, offB].
   * Shared vertices + mitered smooth normals → perfectly curved road surface.
   */
  function buildRibbonGeo(THREE, waypoints, offA, offB, elevBase, vScale) {
    var n = waypoints.length;
    if (n < 3) {
      return new THREE.BufferGeometry();
    }
    elevBase = elevBase != null ? elevBase : 0.06;
    vScale = vScale || 0.08;

    var frame = pathFrame(waypoints);
    var positions = [];
    var normals3 = [];
    var uvs = [];
    var indices = [];
    var cum = 0;
    var i, a, sn, raw, miter, za, crownA, crownB, maxOff;
    maxOff = Math.max(Math.abs(offA), Math.abs(offB), 1);

    for (i = 0; i < n; i++) {
      a = waypoints[i];
      if (i > 0) {
        var prev = waypoints[i - 1];
        cum += Math.hypot(a.x - prev.x, a.y - prev.y);
      }
      sn = frame.smooth[i];
      raw = frame.normals[i];
      // Keep constant width through miter: scale by 1 / cos(half angle)
      miter = 1 / Math.max(0.35, sn.x * raw.x + sn.y * raw.y);
      za = (a.z || 0) + elevBase;
      crownA = za + 0.12 * (1 - Math.min(1, Math.abs(offA) / maxOff));
      crownB = za + 0.12 * (1 - Math.min(1, Math.abs(offB) / maxOff));

      // Two verts per station: edge A then edge B
      positions.push(
        a.x + sn.x * offA * miter,
        crownA,
        a.y + sn.y * offA * miter,
        a.x + sn.x * offB * miter,
        crownB,
        a.y + sn.y * offB * miter
      );
      normals3.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, cum * vScale, 1, cum * vScale);
    }

    // Close loop: add first point arc length for last segment UV via indices only
    for (i = 0; i < n; i++) {
      var i0 = i * 2;
      var i1 = ((i + 1) % n) * 2;
      // quad: A0, B0, A1, B1
      indices.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals3, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Bridge pillars — sparse, OUTSIDE the carriageway only.
   * Never place under long-jump hang (z very high mid-span) so the road stays clear.
   */
  function makeBridgeSupports(THREE, waypoints, halfW) {
    var g = new THREE.Group();
    var pierMat = new THREE.MeshStandardMaterial({
      color: 0x8a9098,
      metalness: 0.35,
      roughness: 0.55,
    });
    var railMat = new THREE.MeshStandardMaterial({
      color: 0xc8ccd0,
      metalness: 0.5,
      roughness: 0.4,
    });
    var i, a, b, ang, nx, ny, z, h, prevZ, nextZ;
    var n = waypoints.length;
    for (i = 0; i < n; i += 5) {
      a = waypoints[i];
      z = a.z || 0;
      // Only real elevated decks (bridges), not dense jump piers
      if (z < 16 || z > 48) continue;
      prevZ = waypoints[(i - 3 + n) % n].z || 0;
      nextZ = waypoints[(i + 3) % n].z || 0;
      // Skip long-jump hang where neighbors are also sky-high
      if (z > 36 && prevZ > 30 && nextZ > 30) continue;
      b = waypoints[(i + 1) % n];
      ang = Math.atan2(b.y - a.y, b.x - a.x);
      nx = Math.cos(ang + Math.PI / 2);
      ny = Math.sin(ang + Math.PI / 2);
      h = z + 0.5;
      // Piers clearly outside the road half-width
      [-1, 1].forEach(function (side) {
        var px = a.x + nx * side * (halfW + 8);
        var pz = a.y + ny * side * (halfW + 8);
        var pier = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, h, 2.4),
          pierMat
        );
        pier.position.set(px, h / 2, pz);
        pier.castShadow = true;
        pier.receiveShadow = true;
        g.add(pier);
      });
      // Side rails on elevated deck edge (not mid-road)
      if (z > 18 && z < 42) {
        [-1, 1].forEach(function (side) {
          var rx = a.x + nx * side * (halfW + 1.2);
          var rz = a.y + ny * side * (halfW + 1.2);
          var rail = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.0, 0.3), railMat);
          rail.position.set(rx, z + 0.95, rz);
          rail.rotation.y = -ang;
          g.add(rail);
        });
      }
    }
    return g;
  }

  function roadMat(THREE, map, normalMap, color, rough, metal, envInt, roughMap) {
    var mat = new THREE.MeshStandardMaterial({
      color: color != null ? color : 0xffffff,
      map: map || null,
      normalMap: normalMap || null,
      roughnessMap: roughMap || null,
      roughness: rough != null ? rough : 0.85,
      metalness: metal != null ? metal : 0.05,
      envMapIntensity: envInt != null ? envInt : 0.3,
    });
    if (normalMap) mat.normalScale = new THREE.Vector2(0.85, 0.85);
    if (ctx3d && ctx3d.envMap) mat.envMap = ctx3d.envMap;
    return mat;
  }

  /**
   * Solid or dashed paint as continuous curved ribbons (not box segments).
   * Follows the smooth centerline with mitered normals.
   */
  function makePaintStrip(THREE, waypoints, centerOff, width, elevBase, color, dashed, dashLen, gapLen) {
    var g = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.62,
      metalness: 0.02,
      emissive: color,
      emissiveIntensity: 0.015,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    elevBase = elevBase != null ? elevBase : 0.1;
    dashLen = dashLen || 6;
    gapLen = gapLen || 4.5;
    var halfW = width * 0.5;
    var offA = centerOff + halfW;
    var offB = centerOff - halfW;

    if (!dashed) {
      var solid = new THREE.Mesh(
        buildRibbonGeo(THREE, waypoints, offA, offB, elevBase, 0.08),
        mat
      );
      solid.receiveShadow = true;
      solid.renderOrder = 3;
      g.add(solid);
      return g;
    }

    // Dashed: walk arc length on the smooth path; emit short curved ribbon spans
    var n = waypoints.length;
    var frame = pathFrame(waypoints);
    var positions = [];
    var normals3 = [];
    var uvs = [];
    var indices = [];
    var along = 0;
    var i, a, b, segLen, t, dist, sn, miter, raw, elev, v;
    var vertCount = 0;

    function pushStation(pt, snorm, rawN, elevY, vCoord) {
      miter = 1 / Math.max(0.35, snorm.x * rawN.x + snorm.y * rawN.y);
      positions.push(
        pt.x + snorm.x * offA * miter,
        elevY,
        pt.y + snorm.y * offA * miter,
        pt.x + snorm.x * offB * miter,
        elevY,
        pt.y + snorm.y * offB * miter
      );
      normals3.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, vCoord, 1, vCoord);
      vertCount += 2;
    }

    var dashRun = []; // station indices in current dash
    function flushDash() {
      if (dashRun.length < 2) {
        dashRun = [];
        return;
      }
      var s, base;
      for (s = 0; s < dashRun.length - 1; s++) {
        base = dashRun[s];
        // each station stored as base vertex index (even)
        indices.push(base, dashRun[s + 1], base + 1, base + 1, dashRun[s + 1], dashRun[s + 1] + 1);
      }
      dashRun = [];
    }

    for (i = 0; i < n; i++) {
      a = waypoints[i];
      b = waypoints[(i + 1) % n];
      segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 0.001) continue;

      // Sample along this segment at ~0.9 unit steps so dashes bend with the curve
      var steps = Math.max(1, Math.ceil(segLen / 0.9));
      var s;
      for (s = 0; s < steps; s++) {
        t = s / steps;
        dist = along + segLen * t;
        var cycle = dist % (dashLen + gapLen);
        var inDash = cycle < dashLen;
        var px = a.x + (b.x - a.x) * t;
        var py = a.y + (b.y - a.y) * t;
        elev = elevBase + (a.z || 0) * (1 - t) + (b.z || 0) * t;
        // Blend neighboring station normals for smooth dashes
        sn = {
          x: frame.smooth[i].x * (1 - t) + frame.smooth[(i + 1) % n].x * t,
          y: frame.smooth[i].y * (1 - t) + frame.smooth[(i + 1) % n].y * t,
        };
        var sl = Math.hypot(sn.x, sn.y) || 1;
        sn.x /= sl;
        sn.y /= sl;
        raw = {
          x: frame.normals[i].x * (1 - t) + frame.normals[(i + 1) % n].x * t,
          y: frame.normals[i].y * (1 - t) + frame.normals[(i + 1) % n].y * t,
        };
        var rl = Math.hypot(raw.x, raw.y) || 1;
        raw.x /= rl;
        raw.y /= rl;
        v = dist * 0.08;

        if (inDash) {
          var baseIdx = vertCount;
          pushStation({ x: px, y: py }, sn, raw, elev, v);
          dashRun.push(baseIdx);
        } else {
          flushDash();
        }
      }
      along += segLen;
    }
    flushDash();

    if (positions.length >= 12) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals3, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      var dashMesh = new THREE.Mesh(geo, mat);
      dashMesh.receiveShadow = true;
      dashMesh.renderOrder = 3;
      g.add(dashMesh);
    }
    return g;
  }

  /** Continuous curved curb ribbons (top face + outer face). */
  function makeCurb(THREE, waypoints, offset, sideSign, concreteMap) {
    var g = new THREE.Group();
    var mat = roadMat(THREE, concreteMap, null, 0xb0b2b6, 0.78, 0.08, 0.2);
    var curbW = 0.7;
    var curbH = 0.55;
    var inner = offset;
    var outer = offset + sideSign * curbW;
    // Top of curb as ribbon slightly raised
    var top = new THREE.Mesh(
      buildRibbonGeo(THREE, waypoints, Math.max(inner, outer), Math.min(inner, outer), 0.12 + curbH * 0.35, 0.1),
      mat
    );
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);

    // Outer vertical face as a thin ribbon standing up via extruded edge samples
    var n = waypoints.length;
    var frame = pathFrame(waypoints);
    var positions = [];
    var normals3 = [];
    var uvs = [];
    var indices = [];
    var i, a, sn, miter, raw, ox, oz, elev, base;
    for (i = 0; i < n; i++) {
      a = waypoints[i];
      sn = frame.smooth[i];
      raw = frame.normals[i];
      miter = 1 / Math.max(0.35, sn.x * raw.x + sn.y * raw.y);
      ox = a.x + sn.x * outer * miter;
      oz = a.y + sn.y * outer * miter;
      elev = a.z || 0;
      positions.push(ox, elev + 0.08, oz, ox, elev + 0.08 + curbH, oz);
      normals3.push(sn.x * sideSign, 0, sn.y * sideSign, sn.x * sideSign, 0, sn.y * sideSign);
      uvs.push(0, i * 0.1, 1, i * 0.1);
    }
    for (i = 0; i < n; i++) {
      base = i * 2;
      var b1 = ((i + 1) % n) * 2;
      indices.push(base, b1, base + 1, base + 1, b1, b1 + 1);
    }
    var faceGeo = new THREE.BufferGeometry();
    faceGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    faceGeo.setAttribute("normal", new THREE.Float32BufferAttribute(normals3, 3));
    faceGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    faceGeo.setIndex(indices);
    faceGeo.computeVertexNormals();
    var face = new THREE.Mesh(
      faceGeo,
      new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide })
    );
    face.castShadow = true;
    g.add(face);
    return g;
  }

  /** Manholes stay on the shoulder only — never mid-carriageway. */
  function makeManholes(THREE, waypoints, halfW) {
    var g = new THREE.Group();
    var iron = new THREE.MeshStandardMaterial({
      color: 0x2a2c30,
      metalness: 0.85,
      roughness: 0.4,
    });
    var i, a, b, ang, nx, ny, t;
    for (i = 8; i < waypoints.length; i += 22) {
      a = waypoints[i];
      if ((a.z || 0) > 6) continue; // no lids on bridges/jumps
      b = waypoints[(i + 1) % waypoints.length];
      ang = Math.atan2(b.y - a.y, b.x - a.x);
      nx = Math.cos(ang + Math.PI / 2);
      ny = Math.sin(ang + Math.PI / 2);
      // Shoulder only
      t = (i % 2 === 0 ? 1 : -1) * (halfW + 4.5);
      var hole = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 16), iron);
      hole.position.set(a.x + nx * t, (a.z || 0) + 0.06, a.y + ny * t);
      hole.receiveShadow = true;
      g.add(hole);
    }
    return g;
  }

  function makeCatEyes(THREE, waypoints, halfW) {
    // raised pavement markers along edge lines
    var g = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({
      color: 0xf0f0e8,
      emissive: 0x888870,
      emissiveIntensity: 0.35,
      metalness: 0.3,
      roughness: 0.4,
    });
    var ymat = new THREE.MeshStandardMaterial({
      color: 0xffcc33,
      emissive: 0xaa7700,
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.4,
    });
    var i, a, b, ang, nx, ny, side;
    for (i = 0; i < waypoints.length; i += 2) {
      a = waypoints[i];
      b = waypoints[(i + 1) % waypoints.length];
      ang = Math.atan2(b.y - a.y, b.x - a.x);
      nx = Math.cos(ang + Math.PI / 2);
      ny = Math.sin(ang + Math.PI / 2);
      for (side = -1; side <= 1; side += 2) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.35), side > 0 ? mat : ymat);
        m.position.set(a.x + nx * side * (halfW - 0.9), (a.z || 0) + 0.12, a.y + ny * side * (halfW - 0.9));
        m.rotation.y = -ang;
        g.add(m);
      }
    }
    return g;
  }

  /**
   * Realistic carriageway: detailed asphalt PBR, dual tire wear, shoulders,
   * curbs, worn lane paint, RPMs, manholes, bridge supports.
   * Path is Catmull-Rom subdivided so asphalt + paint stay perfectly curved.
   */
  function makeRoadMesh(waypoints, halfW, theme) {
    var THREE = root.THREE;
    var group = new THREE.Group();
    var elev = 0.06;
    var shoulder = 11;
    var paintElev = elev + 0.04;

    // Dense smooth centerline for meshes (gameplay waypoints stay coarser)
    var smooth = subdivideClosedPath(waypoints, 6);
    // Props can use a medium density path
    var med = subdivideClosedPath(waypoints, 2);

    var asphaltMap = makeAsphaltTexture(THREE);
    var asphaltN = makeAsphaltNormal(THREE);
    var asphaltR = makeAsphaltRoughness(THREE);
    var gravelMap = makeGravelTexture(THREE);
    var concreteMap = makeConcreteTexture(THREE);

    // --- Main asphalt deck ---
    var asphaltGeo = buildRibbonGeo(THREE, smooth, halfW, -halfW, elev, 0.07);
    var asphaltMat = roadMat(
      THREE,
      asphaltMap,
      asphaltN,
      0xc8ccd0,
      0.82,
      0.06,
      0.38,
      asphaltR
    );
    asphaltMat.side = THREE.DoubleSide;
    asphaltMat.polygonOffset = true;
    asphaltMat.polygonOffsetFactor = -1;
    asphaltMat.polygonOffsetUnits = -1;
    if (asphaltMat.normalScale) asphaltMat.normalScale.set(1.1, 1.1);
    var asphalt = new THREE.Mesh(asphaltGeo, asphaltMat);
    asphalt.receiveShadow = true;
    asphalt.castShadow = false;
    asphalt.renderOrder = 1;
    group.add(asphalt);

    // Under-deck dark rim (gives thickness on bridges / camera angles)
    var underGeo = buildRibbonGeo(THREE, smooth, halfW * 0.98, -halfW * 0.98, elev - 0.55, 0.07);
    var under = new THREE.Mesh(
      underGeo,
      new THREE.MeshStandardMaterial({
        color: 0x2a2c30,
        roughness: 0.9,
        metalness: 0.05,
        side: THREE.DoubleSide,
      })
    );
    under.receiveShadow = true;
    group.add(under);

    // Dual polished wheel paths (left + right of center)
    var wearMat = new THREE.MeshStandardMaterial({
      color: 0x1e2024,
      transparent: true,
      opacity: 0.32,
      roughness: 0.28,
      metalness: 0.18,
      envMap: ctx3d && ctx3d.envMap ? ctx3d.envMap : null,
      envMapIntensity: 0.45,
    });
    var laneOff = halfW * 0.28;
    var wearW = halfW * 0.14;
    [-1, 1].forEach(function (side) {
      var wear = new THREE.Mesh(
        buildRibbonGeo(
          THREE,
          smooth,
          side * laneOff + wearW,
          side * laneOff - wearW,
          elev + 0.015,
          0.07
        ),
        wearMat
      );
      wear.renderOrder = 2;
      wear.receiveShadow = true;
      group.add(wear);
    });

    // Soft edge fade strips (asphalt → shoulder)
    var edgeMat = new THREE.MeshStandardMaterial({
      color: 0x4a4e54,
      transparent: true,
      opacity: 0.4,
      roughness: 0.9,
      metalness: 0.02,
    });
    group.add(
      new THREE.Mesh(
        buildRibbonGeo(THREE, smooth, halfW + 0.8, halfW - 1.5, elev + 0.01, 0.08),
        edgeMat
      )
    );
    group.add(
      new THREE.Mesh(
        buildRibbonGeo(THREE, smooth, -(halfW - 1.5), -(halfW + 0.8), elev + 0.01, 0.08),
        edgeMat
      )
    );

    // --- Gravel / crushed-stone shoulders ---
    var gravelMat = roadMat(THREE, gravelMap, null, 0xddd8c8, 0.96, 0.02, 0.12);
    var shL = new THREE.Mesh(
      buildRibbonGeo(THREE, smooth, halfW + shoulder, halfW + 0.5, elev - 0.05, 0.1),
      gravelMat
    );
    shL.receiveShadow = true;
    group.add(shL);
    var shR = new THREE.Mesh(
      buildRibbonGeo(THREE, smooth, -(halfW + 0.5), -(halfW + shoulder), elev - 0.05, 0.1),
      gravelMat
    );
    shR.receiveShadow = true;
    group.add(shR);

    // --- Concrete curbs (follow smooth curve) ---
    group.add(makeCurb(THREE, smooth, halfW + 0.25, 1, concreteMap));
    group.add(makeCurb(THREE, smooth, -halfW - 0.25, -1, concreteMap));

    // Lane paint — continuous curved ribbons (white edges, double yellow, dashed lanes)
    var whitePaint = 0xecece6;
    var yellowPaint = 0xe0b820;
    group.add(makePaintStrip(THREE, smooth, halfW - 1.15, 0.55, paintElev, whitePaint, false));
    group.add(makePaintStrip(THREE, smooth, -(halfW - 1.15), 0.55, paintElev, whitePaint, false));
    group.add(makePaintStrip(THREE, smooth, 0.48, 0.28, paintElev, yellowPaint, false));
    group.add(makePaintStrip(THREE, smooth, -0.48, 0.28, paintElev, yellowPaint, false));
    group.add(
      makePaintStrip(THREE, smooth, halfW * 0.4, 0.32, paintElev, whitePaint, true, 5.5, 4)
    );
    group.add(
      makePaintStrip(THREE, smooth, -halfW * 0.4, 0.32, paintElev, whitePaint, true, 5.5, 4)
    );

    // Edge markers + sparse shoulder lids + bridge supports (never mid-road)
    group.add(makeCatEyes(THREE, med, halfW));
    group.add(makeManholes(THREE, med, halfW));
    group.add(makeBridgeSupports(THREE, med, halfW));

    return group;
  }

  function seeded(n) {
    var s = (n * 16807 + 11) % 2147483647;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  /**
   * True if axis-aligned footprint (half-width hw, half-depth hd) stays outside
   * the road corridor. Samples center, corners, and edge midpoints so large
   * buildings can't straddle a curved track segment.
   */
  function isFootprintOffRoad(cx, cz, hw, hd, waypoints, minClear) {
    var TrackApi = root.NeoKartTrack;
    if (!TrackApi || !waypoints || !waypoints.length) return true;
    var samples = [
      [0, 0],
      [hw, hd],
      [hw, -hd],
      [-hw, hd],
      [-hw, -hd],
      [hw, 0],
      [-hw, 0],
      [0, hd],
      [0, -hd],
    ];
    var i, sx, sz;
    for (i = 0; i < samples.length; i++) {
      sx = cx + samples[i][0];
      sz = cz + samples[i][1];
      if (TrackApi.distToTrack(sx, sz, waypoints) < minClear) return false;
    }
    return true;
  }

  function isPointOffRoad(x, z, waypoints, minClear) {
    var TrackApi = root.NeoKartTrack;
    if (!TrackApi || !waypoints || !waypoints.length) return true;
    return TrackApi.distToTrack(x, z, waypoints) >= minClear;
  }

  /**
   * City landmarks — placed by course fraction so they match menu blurbs.
   * span:true landmarks decorate elevated road segments (bridges / water).
   */
  function makeLandmarks(THREE, track, theme, rng) {
    var g = new THREE.Group();
    var list = track.landmarks || [];
    var wps = track.waypoints;
    var half = track.halfWidth;
    var TrackApi = root.NeoKartTrack;
    // Landmarks must sit well past the carriageway + shoulders
    var minClear = half + 130;
    var n = wps.length;

    function atFraction(frac) {
      var idx = Math.floor(((frac % 1) + 1) % 1 * n) % n;
      return idx;
    }

    function offRoadPoint(frac, side, distWant, footprintR) {
      var wpIdx = atFraction(frac);
      var a = wps[wpIdx];
      var b = wps[(wpIdx + 1) % n];
      var ang = Math.atan2(b.y - a.y, b.x - a.x);
      var nx = Math.cos(ang + Math.PI / 2);
      var ny = Math.sin(ang + Math.PI / 2);
      var need = minClear + (footprintR || 20);
      var d = Math.max(distWant || half + 160, need);
      var tries = 0;
      var bx, bz;
      side = side === 0 ? 1 : side;
      do {
        bx = a.x + nx * side * d;
        bz = a.y + ny * side * d;
        d += 18;
        tries++;
      } while (
        (!isFootprintOffRoad(bx, bz, footprintR || 20, footprintR || 20, wps, minClear) ||
          (TrackApi && TrackApi.distToTrack(bx, bz, wps) < need)) &&
        tries < 28
      );
      return { x: bx, z: bz, ang: ang, elev: a.z || 0 };
    }

    /** Water under elevated span + optional suspension towers at span ends */
    function decorateSpan(frac, withTowers, rainbow) {
      var center = atFraction(frac);
      // Find contiguous elevated region around frac
      var i, z;
      var start = center;
      var end = center;
      while ((wps[(start - 1 + n) % n].z || 0) >= 18 && start > center - 20) start--;
      while ((wps[(end + 1) % n].z || 0) >= 18 && end < center + 20) end++;
      start = (start + n) % n;
      end = (end + n) % n;

      var waterMat = new THREE.MeshStandardMaterial({
        color: rainbow ? 0x2a6a9a : 0x3a7aaa,
        metalness: 0.55,
        roughness: 0.18,
        transparent: true,
        opacity: 0.88,
      });
      // Water strip under elevated segments
      var wi = start;
      var guard = 0;
      while (guard < 40) {
        var wa = wps[wi];
        var wb = wps[(wi + 1) % n];
        if ((wa.z || 0) < 12 && (wb.z || 0) < 12 && guard > 2) break;
        var mx = (wa.x + wb.x) / 2;
        var mz = (wa.y + wb.y) / 2;
        var ang = Math.atan2(wb.y - wa.y, wb.x - wa.x);
        var segLen = Math.hypot(wb.x - wa.x, wb.y - wa.y) + 4;
        var water = new THREE.Mesh(
          new THREE.PlaneGeometry(segLen, half * 4.5),
          waterMat
        );
        water.rotation.x = -Math.PI / 2;
        water.rotation.z = -ang;
        water.position.set(mx, 0.12, mz);
        g.add(water);
        wi = (wi + 1) % n;
        guard++;
        if (wi === end) break;
      }

      if (withTowers) {
        var steel = new THREE.MeshStandardMaterial({
          color: rainbow ? 0xc0c8d0 : 0xa8b0b8,
          metalness: 0.75,
          roughness: 0.28,
        });
        var cableMat = new THREE.MeshStandardMaterial({
          color: rainbow ? 0xe8a0b0 : 0x889098,
          metalness: 0.6,
          roughness: 0.4,
        });
        [start, end].forEach(function (ti, tiIdx) {
          var tw = wps[ti];
          var elev = tw.z || 28;
          var tAng = Math.atan2(
            wps[(ti + 1) % n].y - tw.y,
            wps[(ti + 1) % n].x - tw.x
          );
          var tnx = Math.cos(tAng + Math.PI / 2);
          var tny = Math.sin(tAng + Math.PI / 2);
          [-1, 1].forEach(function (side) {
            var tx = tw.x + tnx * side * (half + 6);
            var tz = tw.y + tny * side * (half + 6);
            var towerH = elev + 38;
            var tower = new THREE.Mesh(new THREE.BoxGeometry(5, towerH, 5), steel);
            tower.position.set(tx, towerH / 2, tz);
            tower.castShadow = true;
            g.add(tower);
            // cable down to deck midspan
            var mid = wps[atFraction(frac)];
            var cable = new THREE.Mesh(
              new THREE.CylinderGeometry(0.35, 0.35, 42, 6),
              cableMat
            );
            cable.position.set((tx + mid.x) / 2, elev + 18, (tz + mid.y) / 2);
            cable.lookAt(mid.x, elev + 2, mid.y);
            cable.rotateX(Math.PI / 2);
            g.add(cable);
          });
        });
      }
    }

    function placeLandmark(name, x, z) {
      if (name === "tokyo-tower") {
        // Lattice tower (Tokyo Tower)
        var red = new THREE.MeshStandardMaterial({ color: 0xc41e3a, metalness: 0.4, roughness: 0.4 });
        var white = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, metalness: 0.3, roughness: 0.5 });
        var base = new THREE.Mesh(new THREE.CylinderGeometry(8, 14, 12, 6), red);
        base.position.set(x, 6, z);
        g.add(base);
        var mid = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 7, 45, 6), white);
        mid.position.set(x, 32, z);
        g.add(mid);
        var top = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 3, 38, 6), red);
        top.position.set(x, 72, z);
        g.add(top);
        var tip = new THREE.Mesh(new THREE.ConeGeometry(1.2, 14, 6), white);
        tip.position.set(x, 96, z);
        g.add(tip);
      } else if (name === "torii") {
        var wood = new THREE.MeshStandardMaterial({ color: 0xb01020, roughness: 0.6 });
        var postL = new THREE.Mesh(new THREE.BoxGeometry(2.2, 22, 2.2), wood);
        postL.position.set(x - 8, 11, z);
        var postR = new THREE.Mesh(new THREE.BoxGeometry(2.2, 22, 2.2), wood);
        postR.position.set(x + 8, 11, z);
        var beam = new THREE.Mesh(new THREE.BoxGeometry(22, 2.2, 3.5), wood);
        beam.position.set(x, 22, z);
        var lintel = new THREE.Mesh(new THREE.BoxGeometry(26, 1.6, 2.5), wood);
        lintel.position.set(x, 25, z);
        g.add(postL);
        g.add(postR);
        g.add(beam);
        g.add(lintel);
      } else if (name === "rainbow-bridge" || name === "suspension-towers") {
        // Suspension towers beside course (visual only; road has its own piers)
        var steel = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.7, roughness: 0.3 });
        [-18, 18].forEach(function (ox) {
          var t1 = new THREE.Mesh(new THREE.BoxGeometry(4, 70, 4), steel);
          t1.position.set(x + ox, 35, z);
          g.add(t1);
          var cross = new THREE.Mesh(new THREE.BoxGeometry(ox > 0 ? 36 : 36, 2, 2), steel);
          cross.position.set(x, 55, z);
          g.add(cross);
        });
      } else if (name === "bullet-arch") {
        var archMat = new THREE.MeshStandardMaterial({ color: 0x2a6fd4, metalness: 0.5, roughness: 0.35 });
        var arch = new THREE.Mesh(new THREE.TorusGeometry(18, 2.2, 10, 28, Math.PI), archMat);
        arch.position.set(x, 2, z);
        arch.rotation.z = Math.PI / 2;
        arch.rotation.y = Math.PI / 2;
        g.add(arch);
      } else if (name === "burj") {
        // Stepped needle spire
        var gold = new THREE.MeshStandardMaterial({ color: 0xd4c4a0, metalness: 0.65, roughness: 0.25 });
        var tiers = [18, 14, 10, 7, 4.5, 2.5, 1.2];
        var yy = 0;
        tiers.forEach(function (tw, ti) {
          var hh = 22 - ti * 2;
          var block = new THREE.Mesh(new THREE.CylinderGeometry(tw * 0.35, tw * 0.45, hh, 8), gold);
          block.position.set(x, yy + hh / 2, z);
          g.add(block);
          yy += hh;
        });
        var needle = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.2, 40, 6), gold);
        needle.position.set(x, yy + 20, z);
        g.add(needle);
      } else if (name === "sail-hotel") {
        // Sail / Burj Al Arab silhouette
        var sail = new THREE.MeshStandardMaterial({ color: 0xf0f4f8, metalness: 0.4, roughness: 0.3 });
        var mast = new THREE.Mesh(new THREE.BoxGeometry(3, 70, 3), sail);
        mast.position.set(x, 35, z);
        g.add(mast);
        var wing = new THREE.Mesh(new THREE.BoxGeometry(28, 55, 2), sail);
        wing.position.set(x + 10, 32, z);
        wing.rotation.z = -0.25;
        g.add(wing);
      } else if (name === "palm-isles") {
        // Palm frond islands
        var sand = new THREE.MeshStandardMaterial({ color: 0xe8d4a0, roughness: 0.9 });
        var green = new THREE.MeshStandardMaterial({ color: 0x3a9a50, roughness: 0.8 });
        var isle = new THREE.Mesh(new THREE.CylinderGeometry(22, 24, 2, 12), sand);
        isle.position.set(x, 1, z);
        g.add(isle);
        for (var fi = 0; fi < 8; fi++) {
          var fa = (fi / 8) * Math.PI * 2;
          var frond = new THREE.Mesh(new THREE.BoxGeometry(18, 1.2, 4), green);
          frond.position.set(x + Math.cos(fa) * 16, 2, z + Math.sin(fa) * 16);
          frond.rotation.y = -fa;
          g.add(frond);
        }
      } else if (name === "dune") {
        var duneMat = new THREE.MeshStandardMaterial({ color: 0xd4b87a, roughness: 0.95 });
        var dune = new THREE.Mesh(new THREE.SphereGeometry(35, 16, 10), duneMat);
        dune.scale.set(1.4, 0.35, 1);
        dune.position.set(x, 4, z);
        g.add(dune);
      } else if (name === "oriental-pearl") {
        // Stacked spheres + stem
        var pearl = new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.55, roughness: 0.3 });
        var pink = new THREE.MeshStandardMaterial({ color: 0xe8a0b0, metalness: 0.4, roughness: 0.35 });
        var stem = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 4, 55, 10), pearl);
        stem.position.set(x, 28, z);
        g.add(stem);
        var s1 = new THREE.Mesh(new THREE.SphereGeometry(10, 20, 16), pink);
        s1.position.set(x, 18, z);
        g.add(s1);
        var s2 = new THREE.Mesh(new THREE.SphereGeometry(7, 18, 14), pink);
        s2.position.set(x, 42, z);
        g.add(s2);
        var s3 = new THREE.Mesh(new THREE.SphereGeometry(3.5, 14, 12), pearl);
        s3.position.set(x, 58, z);
        g.add(s3);
      } else if (name === "bund-gate") {
        var stone = new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.7 });
        var colL = new THREE.Mesh(new THREE.BoxGeometry(4, 28, 4), stone);
        colL.position.set(x - 10, 14, z);
        var colR = new THREE.Mesh(new THREE.BoxGeometry(4, 28, 4), stone);
        colR.position.set(x + 10, 14, z);
        var topB = new THREE.Mesh(new THREE.BoxGeometry(28, 4, 6), stone);
        topB.position.set(x, 30, z);
        g.add(colL);
        g.add(colR);
        g.add(topB);
      } else if (name === "river") {
        var water = new THREE.Mesh(
          new THREE.PlaneGeometry(90, 40),
          new THREE.MeshStandardMaterial({
            color: 0x3a7aaa,
            metalness: 0.6,
            roughness: 0.2,
            transparent: true,
            opacity: 0.85,
          })
        );
        water.rotation.x = -Math.PI / 2;
        water.position.set(x, 0.15, z);
        g.add(water);
      } else if (name === "pagoda") {
        var tile = new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 0.55 });
        var wood2 = new THREE.MeshStandardMaterial({ color: 0xc4a060, roughness: 0.6 });
        for (var pi = 0; pi < 4; pi++) {
          var pw = 14 - pi * 2.5;
          var floor = new THREE.Mesh(new THREE.BoxGeometry(pw, 4, pw), wood2);
          floor.position.set(x, 4 + pi * 8, z);
          g.add(floor);
          var roof = new THREE.Mesh(new THREE.ConeGeometry(pw * 0.75, 3.5, 4), tile);
          roof.position.set(x, 7.5 + pi * 8, z);
          roof.rotation.y = Math.PI / 4;
          g.add(roof);
        }
      } else if (name === "statue-torch") {
        var greenOx = new THREE.MeshStandardMaterial({ color: 0x4a8a70, metalness: 0.5, roughness: 0.4 });
        var robe = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 28, 10), greenOx);
        robe.position.set(x, 16, z);
        g.add(robe);
        var head = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 10), greenOx);
        head.position.set(x, 34, z);
        g.add(head);
        var arm = new THREE.Mesh(new THREE.BoxGeometry(2, 16, 2), greenOx);
        arm.position.set(x + 6, 36, z);
        arm.rotation.z = -0.5;
        g.add(arm);
        var flame = new THREE.Mesh(
          new THREE.SphereGeometry(2.5, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0xff6600, emissiveIntensity: 0.8 })
        );
        flame.position.set(x + 11, 44, z);
        g.add(flame);
      } else if (name === "ferry") {
        var hull = new THREE.Mesh(
          new THREE.BoxGeometry(28, 6, 10),
          new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 })
        );
        hull.position.set(x, 4, z);
        g.add(hull);
        var cabin = new THREE.Mesh(
          new THREE.BoxGeometry(14, 6, 8),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
        );
        cabin.position.set(x - 2, 10, z);
        g.add(cabin);
        var stack = new THREE.Mesh(
          new THREE.CylinderGeometry(1.5, 1.8, 8, 10),
          new THREE.MeshStandardMaterial({ color: 0x222222 })
        );
        stack.position.set(x + 4, 16, z);
        g.add(stack);
      } else if (name === "harbor-crane") {
        var yellow = new THREE.MeshStandardMaterial({ color: 0xe8b020, metalness: 0.5, roughness: 0.4 });
        var leg = new THREE.Mesh(new THREE.BoxGeometry(3, 40, 3), yellow);
        leg.position.set(x, 20, z);
        g.add(leg);
        var boom = new THREE.Mesh(new THREE.BoxGeometry(50, 2.5, 2.5), yellow);
        boom.position.set(x + 18, 40, z);
        g.add(boom);
      } else if (name === "long-jump") {
        // Side barriers only — well clear of the driving line
        var jumpSteel = new THREE.MeshStandardMaterial({
          color: 0xc8ccd0,
          metalness: 0.55,
          roughness: 0.35,
        });
        var jumpAccent = new THREE.MeshStandardMaterial({
          color: theme.accent || 0xe6304a,
          metalness: 0.35,
          roughness: 0.4,
        });
        var jHalf = (track && track.halfWidth) || half || 50;
        [-1, 1].forEach(function (side) {
          var wall = new THREE.Mesh(new THREE.BoxGeometry(28, 5, 1.0), jumpSteel);
          wall.position.set(x + side * (jHalf + 14), 3.2, z);
          wall.castShadow = true;
          g.add(wall);
          var stripe = new THREE.Mesh(new THREE.BoxGeometry(22, 0.9, 0.35), jumpAccent);
          stripe.position.set(x + side * (jHalf + 14), 5.5, z);
          g.add(stripe);
        });
      }
    }

    list.forEach(function (lm) {
      var name = typeof lm === "string" ? lm : lm.id;
      var at = typeof lm === "string" ? 0.25 : lm.at != null ? lm.at : 0.25;
      var side = typeof lm === "string" ? 1 : lm.side != null ? lm.side : 1;
      var dist = typeof lm === "string" ? 130 : lm.dist != null ? lm.dist : 130;
      var span = typeof lm === "string" ? false : !!lm.span;

      // Bridges / water / long-jump: decorate elevated span from course fraction
      if (
        span ||
        name === "rainbow-bridge" ||
        name === "suspension-towers" ||
        name === "river" ||
        name === "bay-water" ||
        name === "long-jump"
      ) {
        var towers =
          name === "rainbow-bridge" || name === "suspension-towers";
        if (name !== "long-jump") {
          decorateSpan(at, towers, name === "rainbow-bridge");
        }
        if (
          name === "river" ||
          name === "bay-water" ||
          name === "rainbow-bridge" ||
          name === "suspension-towers"
        ) {
          return;
        }
        // long-jump: place ramp props at launch fraction (on elevated road center)
        if (name === "long-jump") {
          var jIdx = atFraction(at);
          var jwp = wps[jIdx];
          placeLandmark(name, jwp.x, jwp.y);
          return;
        }
      }

      // Large landmarks need extra standoff so mass never clips the road
      var footprintR = 22;
      if (name === "palm-isles" || name === "dune") footprintR = 40;
      else if (name === "burj" || name === "oriental-pearl") footprintR = 28;
      else if (name === "sail-hotel" || name === "harbor-crane") footprintR = 36;
      else if (name === "torii" || name === "bund-gate") footprintR = 24;
      var p = offRoadPoint(at, side === 0 ? 1 : side, dist, footprintR);
      placeLandmark(name, p.x, p.z);
    });

    return g;
  }

  function buildCity(track, theme) {
    var THREE = root.THREE;
    var group = new THREE.Group();
    var rng = seeded(track.id.length * 997 + theme.accent);
    var wps = track.waypoints;
    var half = track.halfWidth;
    var TrackApi = root.NeoKartTrack;
    var i, a, b, ang, nx, ny, side, distOut, h, w, d, bx, bz, col;
    // Carriageway + shoulders + generous buffer so no structure sits in-road
    // even when the loop folds back near a placement site
    var roadClear = half + 125;

    // Ground — sunlit grass / landscaping around the circuit
    var groundMap = makeGroundTexture(THREE, theme);
    var groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: groundMap,
      roughness: 0.92,
      metalness: 0.02,
    });
    if (ctx3d && ctx3d.envMap) {
      groundMat.envMap = ctx3d.envMap;
      groundMat.envMapIntensity = 0.15;
    }
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(track.worldW * 3.5, track.worldH * 3.5),
      groundMat
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    group.add(ground);

    // City landmarks first (iconic, off-road)
    group.add(makeLandmarks(THREE, track, theme, rng));

    // Clean architecture — never on the road
    var winTex = makeWindowTexture(THREE);
    var cleanPalette = (theme.building && theme.building.length
      ? theme.building
      : [0xf2f4f6, 0xe8ecf0, 0xffffff, 0xdde3ea, 0xf7f8fa]
    ).map(function (c) {
      return typeof c === "number" ? c : 0xf0f0f0;
    });
    var buildingMats = cleanPalette.map(function (c) {
      var m = new THREE.MeshStandardMaterial({
        color: c,
        roughness: 0.42,
        metalness: 0.18,
      });
      if (ctx3d && ctx3d.envMap) {
        m.envMap = ctx3d.envMap;
        m.envMapIntensity = 0.55;
      }
      return m;
    });
    var winMat = new THREE.MeshPhysicalMaterial
      ? new THREE.MeshPhysicalMaterial({
          color: 0xb8d8f0,
          map: winTex,
          metalness: 0.2,
          roughness: 0.12,
          transparent: true,
          opacity: 0.88,
          envMap: ctx3d && ctx3d.envMap ? ctx3d.envMap : null,
          envMapIntensity: 1.1,
          clearcoat: 0.8,
          clearcoatRoughness: 0.08,
        })
      : new THREE.MeshStandardMaterial({
          color: 0xb8d8f0,
          map: winTex,
          metalness: 0.35,
          roughness: 0.18,
          envMap: ctx3d && ctx3d.envMap ? ctx3d.envMap : null,
          envMapIntensity: 1.0,
        });

    var count =
      QUALITY.buildingCount +
      (track.skyline === "towers" ? 30 : track.skyline === "dense" ? 25 : 15);
    var placed = 0;
    var attempts = 0;
    while (placed < count && attempts < count * 14) {
      attempts++;
      var wi = Math.floor(rng() * wps.length);
      a = wps[wi];
      b = wps[(wi + 1) % wps.length];
      ang = Math.atan2(b.y - a.y, b.x - a.x);
      nx = Math.cos(ang + Math.PI / 2);
      ny = Math.sin(ang + Math.PI / 2);
      side = rng() > 0.5 ? 1 : -1;
      // Push well past clearance so curved track segments don't re-intersect
      distOut = roadClear + 70 + rng() * 260;
      bx = a.x + nx * side * distOut;
      bz = a.y + ny * side * distOut;
      w = 12 + rng() * 28;
      d = 12 + rng() * 28;
      var halfW = w * 0.55;
      var halfD = d * 0.55;
      // Entire footprint must stay outside road corridor (handles hairpins)
      if (!isFootprintOffRoad(bx, bz, halfW, halfD, wps, roadClear)) continue;

      h =
        track.skyline === "towers"
          ? 55 + rng() * 200
          : track.skyline === "harbor"
            ? 30 + rng() * 120
            : 35 + rng() * 150;
      col = buildingMats[Math.floor(rng() * buildingMats.length)];
      var bldg = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 1, 1, 1), col);
      bldg.position.set(bx, h / 2, bz);
      bldg.castShadow = true;
      bldg.receiveShadow = true;
      group.add(bldg);

      if (rng() > 0.15) {
        var face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, h * 0.88), winMat);
        face.position.set(
          bx + nx * side * (d * 0.51 + 0.08),
          h * 0.5,
          bz + ny * side * (d * 0.02)
        );
        face.rotation.y = Math.atan2(nx * side, ny * side);
        group.add(face);
      }

      if (rng() > 0.5) {
        var ac = new THREE.Mesh(
          new THREE.BoxGeometry(3 + rng() * 5, 2 + rng() * 2, 3 + rng() * 4),
          new THREE.MeshStandardMaterial({ color: 0x8a9098, metalness: 0.55, roughness: 0.4 })
        );
        ac.position.set(bx + (rng() - 0.5) * w * 0.3, h + 1.2, bz + (rng() - 0.5) * d * 0.3);
        ac.castShadow = true;
        group.add(ac);
      }
      placed++;
    }

    // Edge barriers only at ground-level sections (not mid-bridge)
    if (QUALITY.streetProps) {
      var curbMat = new THREE.MeshStandardMaterial({
        color: 0xf0f2f4,
        roughness: 0.55,
        metalness: 0.08,
      });
      for (i = 0; i < wps.length; i += 3) {
        a = wps[i];
        if ((a.z || 0) > 12) continue;
        b = wps[(i + 1) % wps.length];
        ang = Math.atan2(b.y - a.y, b.x - a.x);
        nx = Math.cos(ang + Math.PI / 2);
        ny = Math.sin(ang + Math.PI / 2);
        for (side = -1; side <= 1; side += 2) {
          if (rng() > 0.4) continue;
          var jx = a.x + nx * side * (half + 2.8);
          var jz = a.y + ny * side * (half + 2.8);
          var curb = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.7, 0.85), curbMat);
          curb.position.set(jx, (a.z || 0) + 0.4, jz);
          curb.rotation.y = -ang;
          curb.castShadow = true;
          curb.receiveShadow = true;
          group.add(curb);
        }
      }
    }

    // Landscaping trees — only off the road
    if (QUALITY.trees) {
      var treeN = QUALITY.treeCount || 55;
      var treesPlaced = 0;
      var tAttempt = 0;
      while (treesPlaced < treeN && tAttempt < treeN * 10) {
        tAttempt++;
        var ti = Math.floor(rng() * wps.length);
        a = wps[ti];
        b = wps[(ti + 1) % wps.length];
        ang = Math.atan2(b.y - a.y, b.x - a.x);
        nx = Math.cos(ang + Math.PI / 2);
        ny = Math.sin(ang + Math.PI / 2);
        side = rng() > 0.5 ? 1 : -1;
        var distT = roadClear + 30 + rng() * 120;
        var tx = a.x + nx * side * distT + (rng() - 0.5) * 12;
        var tz = a.y + ny * side * distT + (rng() - 0.5) * 12;
        if (!isPointOffRoad(tx, tz, wps, roadClear + 8)) continue;
        var tree = makeTree(THREE, 0.85 + rng() * 0.7);
        tree.position.set(tx, 0, tz);
        tree.rotation.y = rng() * Math.PI * 2;
        group.add(tree);
        treesPlaced++;
      }
    }

    // Distant mega-towers — MUST stay off the circuit (tracks can loop near world center)
    var megaPlaced = 0;
    var megaTry = 0;
    while (megaPlaced < 12 && megaTry < 80) {
      megaTry++;
      var angT = (megaTry / 12) * Math.PI * 2 + rng() * 0.4;
      var rad = 420 + rng() * 280 + megaTry * 4;
      var cx = track.worldW * 0.5 + Math.cos(angT) * rad;
      var cz = track.worldH * 0.5 + Math.sin(angT) * rad;
      var tw = 20 + rng() * 40;
      var halfMega = tw * 0.6;
      if (!isFootprintOffRoad(cx, cz, halfMega, halfMega, wps, roadClear + 40)) continue;
      var th = 120 + rng() * 220;
      var mega = new THREE.Mesh(
        new THREE.BoxGeometry(tw, th, tw),
        buildingMats[megaPlaced % buildingMats.length]
      );
      mega.position.set(cx, th / 2, cz);
      group.add(mega);
      var spire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 2, 40 + rng() * 60, 6),
        new THREE.MeshBasicMaterial({ color: theme.accent })
      );
      spire.position.set(cx, th + 20, cz);
      group.add(spire);
      megaPlaced++;
    }

    // Daytime street furniture — poles, unlit fixtures
    var lampMat = new THREE.MeshStandardMaterial({
      color: 0xe8e4d8,
      metalness: 0.35,
      roughness: 0.45,
    });
    var poleMat = new THREE.MeshStandardMaterial({ color: 0x5a5e64, metalness: 0.75, roughness: 0.35 });
    for (i = 0; i < wps.length; i += 3) {
      a = wps[i];
      b = wps[(i + 1) % wps.length];
      ang = Math.atan2(b.y - a.y, b.x - a.x);
      nx = Math.cos(ang + Math.PI / 2);
      ny = Math.sin(ang + Math.PI / 2);
      for (side = -1; side <= 1; side += 2) {
        var lx = a.x + nx * side * (half + 6);
        var lz = a.y + ny * side * (half + 6);
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 12, 8), poleMat);
        pole.position.set(lx, 6, lz);
        pole.castShadow = true;
        group.add(pole);
        var lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.2), lampMat);
        lamp.position.set(lx, 12.2, lz);
        group.add(lamp);
      }
    }

    // Commercial billboards (print, not neon) — off carriageway only
    var billColors = [0xf0f0f0, 0xe8f0ff, 0xfff0e0, 0xe0f0e8];
    var billsPlaced = 0;
    var billTry = 0;
    while (billsPlaced < 8 && billTry < 48) {
      billTry++;
      var bi = Math.floor(rng() * wps.length);
      a = wps[bi];
      b = wps[(bi + 1) % wps.length];
      ang = Math.atan2(b.y - a.y, b.x - a.x);
      nx = Math.cos(ang + Math.PI / 2);
      ny = Math.sin(ang + Math.PI / 2);
      side = rng() > 0.5 ? 1 : -1;
      var billDist = roadClear + 25 + rng() * 40;
      var billX = a.x + nx * side * billDist;
      var billZ = a.y + ny * side * billDist;
      if (!isFootprintOffRoad(billX, billZ, 16, 4, wps, roadClear)) continue;
      var bill = new THREE.Mesh(
        new THREE.BoxGeometry(28, 16, 1.2),
        new THREE.MeshStandardMaterial({
          color: billColors[billsPlaced % billColors.length],
          roughness: 0.55,
          metalness: 0.1,
        })
      );
      bill.position.set(billX, 28, billZ);
      bill.rotation.y = -ang + (side > 0 ? 0 : Math.PI);
      bill.castShadow = true;
      bill.receiveShadow = true;
      group.add(bill);
      var frame = new THREE.Mesh(
        new THREE.BoxGeometry(30, 18, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.6, roughness: 0.4 })
      );
      frame.position.copy(bill.position);
      frame.position.y -= 0.5;
      frame.rotation.y = bill.rotation.y;
      group.add(frame);
      billsPlaced++;
    }

    // Start/finish gantry
    var s0 = wps[0];
    var s1 = wps[1];
    ang = Math.atan2(s1.y - s0.y, s1.x - s0.x);
    nx = Math.cos(ang + Math.PI / 2);
    ny = Math.sin(ang + Math.PI / 2);
    var gateMat = new THREE.MeshStandardMaterial({
      color: 0xe8e8e8,
      metalness: 0.5,
      roughness: 0.35,
    });
    var checkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    var postL = new THREE.Mesh(new THREE.BoxGeometry(2, 22, 2), gateMat);
    var postR = new THREE.Mesh(new THREE.BoxGeometry(2, 22, 2), gateMat);
    postL.position.set(s0.x + nx * half, 11, s0.y + ny * half);
    postR.position.set(s0.x - nx * half, 11, s0.y - ny * half);
    postL.castShadow = true;
    postR.castShadow = true;
    var beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 4, 2.5, 2.5), gateMat);
    beam.position.set(s0.x, 21, s0.y);
    beam.castShadow = true;
    // checkered banner
    var banner = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2, 1.8, 0.3),
      checkMat
    );
    banner.position.set(s0.x, 19.5, s0.y);
    group.add(postL);
    group.add(postR);
    group.add(beam);
    group.add(banner);

    return group;
  }

  function makeKartMesh(colorHex, kartId, vehicleType) {
    var V = Vehicles();
    if (V && ctx3d && ctx3d.envMap) {
      return V.makeVehicle(colorHex, kartId, ctx3d.envMap, {
        vehicleType: vehicleType || "model3",
      });
    }
    // minimal fallback
    var THREE = root.THREE;
    var g = new THREE.Group();
    var isBus = vehicleType === "bus";
    var isTruck = vehicleType === "truck";
    var bw = isBus ? 22 : isTruck ? 18 : 12;
    var bh = isBus ? 5 : isTruck ? 5 : 3;
    var bd = isBus || isTruck ? 7 : 6;
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(bw, bh, bd),
      new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.85, roughness: 0.25 })
    );
    body.position.y = bh * 0.55;
    body.castShadow = true;
    g.add(body);
    g.userData.wheels = [];
    g.userData.thrusters = [];
    g.userData.glow = null;
    g.userData.vehicleType = vehicleType || "model3";
    return g;
  }

  /**
   * First-person cabin — local space matches Model 3 (+X forward, +Y up, +Z right).
   * Shown only in WHEEL camera so the view reads as inside the car, not floating ahead.
   */
  function makeCockpitInterior(THREE) {
    var g = new THREE.Group();
    g.name = "cockpitInterior";
    g.visible = false;
    g.renderOrder = 2;

    var dashMat = new THREE.MeshStandardMaterial({
      color: 0x1a1c20,
      roughness: 0.72,
      metalness: 0.12,
    });
    var softMat = new THREE.MeshStandardMaterial({
      color: 0x2a2e34,
      roughness: 0.85,
      metalness: 0.05,
    });
    var trimMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0c,
      roughness: 0.45,
      metalness: 0.35,
    });
    var paintMat = new THREE.MeshStandardMaterial({
      color: 0x1a3a6e,
      roughness: 0.35,
      metalness: 0.55,
    });
    var glassDark = new THREE.MeshStandardMaterial({
      color: 0x101418,
      roughness: 0.15,
      metalness: 0.4,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    var screenMat = new THREE.MeshStandardMaterial({
      color: 0x0e1828,
      roughness: 0.25,
      metalness: 0.2,
      emissive: 0x1a4060,
      emissiveIntensity: 0.45,
    });
    var wheelMat = new THREE.MeshStandardMaterial({
      color: 0x111214,
      roughness: 0.55,
      metalness: 0.15,
    });

    function box(w, h, d, mat, x, y, z, rx, ry, rz) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      if (ry) m.rotation.y = ry;
      if (rz) m.rotation.z = rz;
      m.frustumCulled = false;
      g.add(m);
      return m;
    }

    // Cabin floor / carpet
    box(6.5, 0.12, 5.2, softMat, 0.2, 1.05, 0);

    // Seat cushion + back (behind / under driver eye)
    box(1.6, 0.35, 1.5, softMat, -0.15, 1.55, -0.55);
    box(0.55, 1.6, 1.45, softMat, -1.05, 2.45, -0.55);
    box(1.5, 0.28, 1.4, softMat, -0.1, 1.55, 0.55); // passenger seat hint

    // Door panels (left driver / right)
    box(5.2, 1.5, 0.22, dashMat, 0.6, 2.0, -2.55);
    box(5.2, 1.5, 0.22, dashMat, 0.6, 2.0, 2.55);
    // Window sills
    box(4.8, 0.14, 0.35, trimMat, 0.7, 2.85, -2.45);
    box(4.8, 0.14, 0.35, trimMat, 0.7, 2.85, 2.45);

    // A-pillars framing the windshield
    box(0.35, 2.4, 0.38, trimMat, 2.55, 3.55, -2.15, 0, 0, -0.35);
    box(0.35, 2.4, 0.38, trimMat, 2.55, 3.55, 2.15, 0, 0, 0.35);

    // Roof header / headliner edge (top of windshield)
    box(1.2, 0.28, 5.0, softMat, 2.0, 4.55, 0, 0, 0, -0.25);
    // Rear bulkhead hint
    box(0.35, 2.2, 5.0, softMat, -2.4, 2.6, 0);

    // Main dash — low so eyes look over it onto the road
    box(1.0, 0.55, 5.4, dashMat, 2.2, 1.55, 0, 0, 0, -0.06);
    box(0.85, 0.38, 5.2, dashMat, 2.7, 1.28, 0, 0, 0, -0.05);
    // Thin cowl lip
    box(0.4, 0.1, 5.0, trimMat, 3.1, 1.85, 0, 0, 0, -0.18);

    // Center screen (Model 3 style) — low on dash
    box(0.1, 0.65, 1.1, screenMat, 2.1, 1.75, 0.12, 0, 0, -0.1);
    box(0.15, 0.72, 1.2, trimMat, 2.02, 1.75, 0.12, 0, 0, -0.1);

    // ---- Steering column + wheel assembly (faces driver) ----
    // Local: +X forward, +Y up, +Z right. Driver left at z≈-0.5
    var skinMat = new THREE.MeshStandardMaterial({
      color: 0xd4a574,
      roughness: 0.75,
      metalness: 0.05,
    });
    var sleeveMat = new THREE.MeshStandardMaterial({
      color: 0x1a2230,
      roughness: 0.7,
      metalness: 0.08,
    });
    var gripMat = new THREE.MeshStandardMaterial({
      color: 0x0c0d10,
      roughness: 0.5,
      metalness: 0.12,
    });

    var colGroup = new THREE.Group();
    colGroup.position.set(1.15, 1.55, -0.52);
    // Tilt column toward driver (back toward -X a bit) — wheel faces cabin
    colGroup.rotation.z = 0.28;
    colGroup.frustumCulled = false;
    g.add(colGroup);

    var column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 1.1, 12),
      trimMat
    );
    column.rotation.z = Math.PI / 2;
    column.position.set(-0.35, 0, 0);
    column.frustumCulled = false;
    colGroup.add(column);

    // Wheel spins around column axis (local X)
    var wheelGroup = new THREE.Group();
    wheelGroup.position.set(0.35, 0.02, 0);
    wheelGroup.frustumCulled = false;
    colGroup.add(wheelGroup);

    // Rim faces driver: torus in plane perpendicular to column (YZ after column setup)
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 12, 36), gripMat);
    rim.rotation.y = Math.PI / 2;
    rim.frustumCulled = false;
    wheelGroup.add(rim);

    // Hub
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.12, 16), wheelMat);
    hub.rotation.z = Math.PI / 2;
    hub.frustumCulled = false;
    wheelGroup.add(hub);

    // Three spokes
    var si;
    for (si = 0; si < 3; si++) {
      var spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.55, 0.1),
        wheelMat
      );
      spoke.rotation.x = (si / 3) * Math.PI * 2 + 0.4;
      spoke.position.set(0.02, 0, 0);
      // offset spoke along rotation so it sits on rim plane
      var sa = (si / 3) * Math.PI * 2 + Math.PI / 2;
      spoke.position.y = Math.cos(sa) * 0.22;
      spoke.position.z = Math.sin(sa) * 0.22;
      spoke.rotation.x = sa;
      spoke.frustumCulled = false;
      wheelGroup.add(spoke);
    }
    // Horizontal bar (Model 3 style)
    var bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.95), wheelMat);
    bar.position.set(0.04, -0.08, 0);
    bar.frustumCulled = false;
    wheelGroup.add(bar);

    /** Build a simple hand (palm + fingers) gripping the rim */
    function makeHand(isLeft) {
      var hand = new THREE.Group();
      hand.frustumCulled = false;
      var palm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.22), skinMat);
      palm.frustumCulled = false;
      hand.add(palm);
      var fi;
      for (fi = 0; fi < 4; fi++) {
        var finger = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.07, 0.16),
          skinMat
        );
        finger.position.set(0.05, 0.02, -0.1 + fi * 0.06);
        finger.rotation.y = isLeft ? 0.35 : -0.35;
        finger.frustumCulled = false;
        hand.add(finger);
      }
      var thumb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.12), skinMat);
      thumb.position.set(0.08, -0.04, isLeft ? 0.08 : -0.08);
      thumb.rotation.z = isLeft ? 0.6 : -0.6;
      thumb.frustumCulled = false;
      hand.add(thumb);
      // Forearm sleeve
      var sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 0.55, 10),
        sleeveMat
      );
      sleeve.rotation.z = Math.PI / 2;
      sleeve.position.set(-0.28, -0.02, 0);
      sleeve.frustumCulled = false;
      hand.add(sleeve);
      return hand;
    }

    // Hands at 9 and 3 on the wheel (parented so they turn with it)
    var handL = makeHand(true);
    handL.position.set(0.08, 0.05, -0.58);
    handL.rotation.x = 0.15;
    handL.rotation.y = 0.4;
    wheelGroup.add(handL);

    var handR = makeHand(false);
    handR.position.set(0.08, 0.05, 0.58);
    handR.rotation.x = -0.15;
    handR.rotation.y = -0.4;
    wheelGroup.add(handR);

    // Side mirrors
    box(0.15, 0.28, 0.55, trimMat, 2.4, 3.35, -2.85);
    box(0.15, 0.28, 0.55, trimMat, 2.4, 3.35, 2.85);
    box(0.04, 0.22, 0.42, glassDark, 2.5, 3.35, -2.85);
    box(0.04, 0.22, 0.42, glassDark, 2.5, 3.35, 2.85);

    // Rear-view mirror
    box(0.12, 0.18, 0.85, trimMat, 1.9, 4.55, 0);
    box(0.04, 0.14, 0.75, glassDark, 1.97, 4.55, 0);

    // Hood — thin frame at bottom of windshield
    box(4.8, 0.08, 5.0, paintMat, 5.8, 1.15, 0, 0, 0, -0.04);
    box(2.0, 0.06, 4.7, paintMat, 7.8, 0.98, 0, 0, 0, -0.06);
    box(0.18, 0.04, 4.5, trimMat, 3.5, 1.72, 0);

    // Door glass tint (peripheral)
    box(3.5, 1.4, 0.06, glassDark, 0.8, 3.4, -2.35);
    box(3.5, 1.4, 0.06, glassDark, 0.8, 3.4, 2.35);

    g.userData.steeringWheel = wheelGroup;
    g.userData.wheelColumn = colGroup;
    g.userData.handL = handL;
    g.userData.handR = handR;
    g.userData.steerSmooth = 0;
    return g;
  }

  function makeItemBox() {
    var THREE = root.THREE;
    var g = new THREE.Group();
    // Soft candy-like pickup (clean VR arcade, not neon nightclub)
    var cube = new THREE.Mesh(
      new THREE.BoxGeometry(7, 7, 7),
      new THREE.MeshPhysicalMaterial
        ? new THREE.MeshPhysicalMaterial({
            color: 0x5b8def,
            metalness: 0.15,
            roughness: 0.25,
            clearcoat: 1,
            clearcoatRoughness: 0.1,
            transparent: true,
            opacity: 0.92,
          })
        : new THREE.MeshStandardMaterial({
            color: 0x5b8def,
            metalness: 0.2,
            roughness: 0.3,
            transparent: true,
            opacity: 0.92,
          })
    );
    cube.castShadow = true;
    g.add(cube);
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(6, 0.35, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.35 })
    );
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.userData.cube = cube;
    g.userData.ring = ring;
    return g;
  }

  function makeRain(theme) {
    var THREE = root.THREE;
    var count = 4000;
    var positions = new Float32Array(count * 3);
    var i;
    for (i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 600;
      positions[i * 3 + 1] = Math.random() * 200;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 600;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: theme.accent,
      size: 0.6,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    var pts = new THREE.Points(geo, mat);
    pts.userData.vel = 80;
    return pts;
  }

  function makeStars() {
    var THREE = root.THREE;
    var count = 2500;
    var positions = new Float32Array(count * 3);
    var i;
    for (i = 0; i < count; i++) {
      var r = 500 + Math.random() * 400;
      var th = Math.random() * Math.PI * 2;
      var ph = Math.random() * Math.PI * 0.45;
      positions[i * 3] = r * Math.sin(ph) * Math.cos(th);
      positions[i * 3 + 1] = 80 + r * Math.cos(ph) * 0.5;
      positions[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, transparent: true, opacity: 0.85 })
    );
  }

  function init(canvas, state, opts) {
    var THREE = root.THREE;
    if (!THREE) throw new Error("THREE not loaded");
    if (!canvas) throw new Error("canvas required");
    opts = opts || {};

    // Reuse built world when restarting the same course (big win on R / cup)
    if (
      ctx3d &&
      ctx3d.renderer &&
      ctx3d.ready &&
      state &&
      state.track &&
      ctx3d.trackId === state.track.id &&
      !opts.force
    ) {
      ensureSize(canvas);
      return ctx3d;
    }

    if (ctx3d && ctx3d.renderer) {
      disposeScene();
    } else {
      // Supersampling already softens edges — skip MSAA when scaled (cheaper)
      var wantAA = !(QUALITY.renderScale > 1.05);
      var renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: wantAA,
        alpha: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
        logarithmicDepthBuffer: !!QUALITY.logarithmicDepth,
        precision: "highp",
      });
      renderer.setClearColor(0xd4ecff, 1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type =
        THREE.VSMShadowMap && false ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;
      renderer.physicallyCorrectLights = true;
      if (renderer.outputColorSpace !== undefined) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
      if (THREE.ACESFilmicToneMapping !== undefined) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.22;
      }
      try {
        var info = renderer.getContext().getExtension("WEBGL_debug_renderer_info");
        if (info) {
          var gl = renderer.getContext();
          console.info(
            "[NeoKart] GPU:",
            gl.getParameter(info.UNMASKED_RENDERER_WEBGL),
            "|",
            QUALITY.preset,
            "shadow",
            QUALITY.shadowMap,
            "scale",
            QUALITY.renderScale
          );
        }
      } catch (e0) {}

      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(50, CANVAS_W / CANVAS_H, 0.35, 2800);
      camera.position.set(0, 40, 80);

      var envMap = null;
      var V = Vehicles();
      if (V && V.makeEnvMap) {
        try {
          envMap = V.makeEnvMap(THREE);
          scene.environment = envMap;
          scene.environmentIntensity = 1.15;
        } catch (e) {
          console.warn("envMap failed", e);
        }
      }

      var bloom = null;
      var fx = FX();
      if (QUALITY.bloom && fx) {
        try {
          if (fx.createUltraPipeline) {
            bloom = fx.createUltraPipeline(renderer, CANVAS_W * 2, CANVAS_H * 2, {
              ssao: QUALITY.ssao,
              bloomPasses: QUALITY.bloomPasses,
            });
          } else if (fx.createBloomPipeline) {
            bloom = fx.createBloomPipeline(renderer, CANVAS_W * 2, CANVAS_H * 2);
          }
          if (bloom) bloom.setSize(CANVAS_W * 2, CANVAS_H * 2);
        } catch (e) {
          console.warn("postFX init failed", e);
          bloom = null;
        }
      }

      ctx3d = {
        renderer: renderer,
        scene: scene,
        camera: camera,
        root: null,
        kartMeshes: [],
        boxMeshes: [],
        hazardMeshes: [],
        projMeshes: [],
        rain: null,
        stars: null,
        sky: null,
        envMap: envMap,
        bloom: bloom,
        boostParticles: null,
        sparkParticles: null,
        skids: null,
        headLights: [],
        camSmooth: { x: 0, y: 40, z: 80 },
        lookSmooth: { x: 0, y: 0, z: 0 },
        ready: true,
        quality: QUALITY,
        cameraMode: "chase",
        trackId: null,
        frameN: 0,
      };
    }
    if (ctx3d && !ctx3d.cameraMode) ctx3d.cameraMode = "chase";

    disposeScene();
    buildWorld(state);
    if (state && state.track) ctx3d.trackId = state.track.id;
    ensureSize(canvas);
    return ctx3d;
  }

  function buildWorld(state) {
    var THREE = root.THREE;
    var track = state.track;
    var theme = track.theme || {
      timeOfDay: "day",
      skyTop: 0x4aa3ff,
      skyZenith: 0x1a6fd4,
      skyHorizon: 0xc8e4ff,
      skyBottom: 0xe8f2ff,
      fog: 0xd0e4f5,
      fogNear: 220,
      fogFar: 1100,
      accent: 0x2a6fd4,
      asphalt: 0x4a4e54,
      asphaltEdge: 0xf5f5f0,
      ambient: 0xc8d8e8,
      hemiSky: 0xa8c8ff,
      hemiGround: 0x8a9070,
      dirLight: 0xfff4e0,
      sunColor: 0xfff8e8,
      sunIntensity: 2.4,
      ground: 0x5a6a48,
      building: [0xb8c0c8],
      window: 0x7ec8ff,
      emissive: 0xffcc66,
      accent2: 0x5a8f40,
    };

    // Soft bright haze — keeps distant city readable like Golf+
    ctx3d.scene.fog = new THREE.Fog(0xe2f0fa, 180, 980);
    ctx3d.scene.background = new THREE.Color(0xd4ecff);
    ctx3d.renderer.setClearColor(0xd4ecff, 1);
    ctx3d.renderer.toneMappingExposure = 1.22;

    if (ctx3d.sky) {
      ctx3d.scene.remove(ctx3d.sky);
      disposeObject(ctx3d.sky);
    }
    ctx3d.sky = makeSkyDome(THREE, theme);
    ctx3d.scene.add(ctx3d.sky);

    var worldRoot = new THREE.Group();
    ctx3d.root = worldRoot;
    ctx3d.scene.add(worldRoot);

    // Golf+ lighting: bright ambient, soft sun, gentle sky fill
    var amb = new THREE.AmbientLight(0xe8f2ff, 0.88);
    worldRoot.add(amb);
    var hemi = new THREE.HemisphereLight(0xb8d8ff, 0x88b070, 1.05);
    worldRoot.add(hemi);

    var sunIntensity = 1.85;
    var sunCol = 0xfff6e8;
    var sunDir = new THREE.Vector3(0.45, 0.88, 0.28).normalize();
    var dir = new THREE.DirectionalLight(sunCol, sunIntensity);
    dir.position.copy(sunDir).multiplyScalar(400);
    dir.castShadow = true;
    dir.shadow.mapSize.set(QUALITY.shadowMap, QUALITY.shadowMap);
    dir.shadow.bias = -0.00008;
    dir.shadow.normalBias = 0.04;
    dir.shadow.camera.near = 20;
    dir.shadow.camera.far = 1000;
    dir.shadow.camera.left = -300;
    dir.shadow.camera.right = 300;
    dir.shadow.camera.top = 300;
    dir.shadow.camera.bottom = -300;
    dir.shadow.radius = QUALITY.softShadowRadius;
    dir.shadow.blurSamples = 12;
    worldRoot.add(dir);
    ctx3d.sunLight = dir;
    ctx3d.sunDir = sunDir;

    var fill = new THREE.DirectionalLight(0xd8eaff, 0.55);
    fill.position.set(-sunDir.x * 200, 100, -sunDir.z * 200);
    worldRoot.add(fill);

    // Place sun disc on sky dome
    if (ctx3d.sky && ctx3d.sky.userData.sun) {
      ctx3d.sky.userData.sun.position.copy(sunDir).multiplyScalar(900);
    }

    worldRoot.add(makeRoadMesh(track.waypoints, track.halfWidth, theme));
    worldRoot.add(buildCity(track, theme));

    // Tesla-inspired fleet + headlight spots on player
    ctx3d.kartMeshes = [];
    ctx3d.headLights = [];
    var i;
    for (i = 0; i < state.karts.length; i++) {
      var hex = parseInt(String(state.karts[i].color).replace("#", ""), 16);
      if (isNaN(hex)) hex = 0x3dffe8;
      var km = makeKartMesh(
        hex,
        state.karts[i].id,
        state.karts[i].vehicleType || "model3"
      );
      worldRoot.add(km);
      ctx3d.kartMeshes.push(km);
      if (state.karts[i].isPlayer) {
        // Day: subtle DRL-style spots (not night high beams)
        var spotL = new THREE.SpotLight(0xfff8f0, 0.85, 55, 0.42, 0.5, 1.2);
        var spotR = new THREE.SpotLight(0xfff8f0, 0.85, 55, 0.42, 0.5, 1.2);
        spotL.castShadow = false;
        spotR.castShadow = false;
        worldRoot.add(spotL);
        worldRoot.add(spotR);
        worldRoot.add(spotL.target);
        worldRoot.add(spotR.target);
        ctx3d.headLights = [spotL, spotR];
      }
    }

    // Ghost PB car (translucent) — pose updated each frame from state.ghostPose
    if (ctx3d.ghostMesh) {
      worldRoot.remove(ctx3d.ghostMesh);
      disposeObject(ctx3d.ghostMesh);
      ctx3d.ghostMesh = null;
    }
    if (state.ghostPbTime) {
      var ghostHex = 0x88ccff;
      var gm = makeKartMesh(ghostHex, 99, "model3");
      gm.traverse(function (ch) {
        if (ch.material) {
          var mats = Array.isArray(ch.material) ? ch.material : [ch.material];
          mats.forEach(function (m) {
            if (!m) return;
            m.transparent = true;
            m.opacity = 0.38;
            m.depthWrite = false;
            if (m.emissive) m.emissive.setHex(0x2266aa);
          });
        }
      });
      gm.visible = false;
      worldRoot.add(gm);
      ctx3d.ghostMesh = gm;
    }

    // In-car cabin for WHEEL camera (driver seat view)
    if (ctx3d.cockpit) {
      worldRoot.remove(ctx3d.cockpit);
      disposeObject(ctx3d.cockpit);
    }
    ctx3d.cockpit = makeCockpitInterior(THREE);
    worldRoot.add(ctx3d.cockpit);

    // High particle counts — keeps GPU updating large buffers
    var fxApi = FX();
    if (fxApi) {
      if (ctx3d.boostParticles) {
        worldRoot.remove(ctx3d.boostParticles);
      }
      ctx3d.boostParticles = fxApi.createParticlePool(
        THREE,
        QUALITY.particlesBoost || 480,
        0x66eeff,
        1.6
      );
      worldRoot.add(ctx3d.boostParticles);
      ctx3d.sparkParticles = fxApi.createParticlePool(
        THREE,
        QUALITY.particlesSpark || 280,
        0xffaa44,
        1.1
      );
      worldRoot.add(ctx3d.sparkParticles);
      ctx3d.skids = fxApi.createSkidSystem(THREE);
      worldRoot.add(ctx3d.skids);
    }

    // Item boxes
    ctx3d.boxMeshes = [];
    for (i = 0; i < state.itemBoxes.length; i++) {
      var bm = makeItemBox();
      worldRoot.add(bm);
      ctx3d.boxMeshes.push(bm);
    }

    ctx3d.hazardMeshes = [];
    ctx3d.projMeshes = [];
    ctx3d.explosionMeshes = [];
    // Orange fireball particle pool for missile blasts
    if (fxApi) {
      ctx3d.explodeParticles = fxApi.createParticlePool(THREE, 420, 0xff6622, 3.2);
      worldRoot.add(ctx3d.explodeParticles);
      ctx3d.smokeParticles = fxApi.createParticlePool(THREE, 280, 0x444448, 2.4);
      worldRoot.add(ctx3d.smokeParticles);
    }

    // Weather layers — rain for wet courses, stars for night
    if (ctx3d.rain) {
      ctx3d.scene.remove(ctx3d.rain);
      disposeObject(ctx3d.rain);
      ctx3d.rain = null;
    }
    if (ctx3d.stars) {
      ctx3d.scene.remove(ctx3d.stars);
      disposeObject(ctx3d.stars);
      ctx3d.stars = null;
    }
    var weather = (track && track.weather) || "clear";
    var tod = theme.timeOfDay || "day";
    if (weather === "rain") {
      ctx3d.rain = makeRain(theme);
      ctx3d.scene.add(ctx3d.rain);
    }
    if (tod === "night") {
      ctx3d.stars = makeStars();
      ctx3d.scene.add(ctx3d.stars);
    }

    ctx3d.theme = theme;
  }

  function syncHazards(state) {
    var THREE = root.THREE;
    var worldRoot = ctx3d.root;
    while (ctx3d.hazardMeshes.length < state.hazards.length) {
      // Flat oil slick disc — never a vertical cylinder in the road
      var m = new THREE.Mesh(
        new THREE.CircleGeometry(11, 28),
        new THREE.MeshStandardMaterial({
          color: 0x1a1028,
          emissive: 0x6a40a0,
          emissiveIntensity: 0.35,
          transparent: true,
          opacity: 0.72,
          roughness: 0.25,
          metalness: 0.4,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      m.rotation.x = -Math.PI / 2;
      worldRoot.add(m);
      ctx3d.hazardMeshes.push(m);
    }
    var i;
    for (i = 0; i < ctx3d.hazardMeshes.length; i++) {
      var mesh = ctx3d.hazardMeshes[i];
      if (i < state.hazards.length) {
        var h = state.hazards[i];
        mesh.visible = true;
        mesh.position.set(h.x, (h.elev != null ? h.elev : 0) + 0.12, h.y);
      } else {
        mesh.visible = false;
      }
    }
  }

  function makeMissileMesh(THREE) {
    var g = new THREE.Group();
    // Long bright rocket so flight is obvious in air
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 1.05, 9.5, 12),
      new THREE.MeshBasicMaterial({ color: 0xff3a5a })
    );
    body.rotation.z = Math.PI / 2;
    g.add(body);
    var nose = new THREE.Mesh(
      new THREE.ConeGeometry(1.05, 3.2, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd040 })
    );
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 6.2;
    g.add(nose);
    var glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.8, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffaa33,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      })
    );
    glow.position.x = -4.5;
    g.add(glow);
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.25, 8, 16),
      new THREE.MeshBasicMaterial({
        color: 0xff6622,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      })
    );
    ring.rotation.y = Math.PI / 2;
    ring.position.x = -3.2;
    g.add(ring);
    g.userData.glow = glow;
    g.userData.ring = ring;
    return g;
  }

  function syncProjectiles(state, dt) {
    var THREE = root.THREE;
    var worldRoot = ctx3d.root;
    dt = dt || 1 / 60;
    while (ctx3d.projMeshes.length < state.projectiles.length) {
      var g = makeMissileMesh(THREE);
      worldRoot.add(g);
      ctx3d.projMeshes.push(g);
    }
    var i;
    for (i = 0; i < ctx3d.projMeshes.length; i++) {
      var mesh = ctx3d.projMeshes[i];
      if (i < state.projectiles.length) {
        var p = state.projectiles[i];
        mesh.visible = true;
        var pe = p.elev != null ? p.elev : 3.5;
        mesh.position.set(p.x, pe, p.y);
        // Point +X nose along flight heading (sim angle)
        mesh.rotation.y = -p.angle;
        if (mesh.userData.glow) {
          mesh.userData.glow.scale.setScalar(1 + Math.sin(state.time * 40) * 0.25);
        }
        if (mesh.userData.ring) {
          mesh.userData.ring.rotation.z += dt * 18;
        }
        // Exhaust trail particles so you see it streak through the air
        if (ctx3d.explodeParticles && ctx3d.explodeParticles.userData.emit) {
          var bx = p.x - Math.cos(p.angle) * 5;
          var bz = p.y - Math.sin(p.angle) * 5;
          ctx3d.explodeParticles.userData.emit(
            bx,
            pe,
            bz,
            -Math.cos(p.angle) * 40,
            4,
            -Math.sin(p.angle) * 40,
            10
          );
        }
        if (ctx3d.sparkParticles && ctx3d.sparkParticles.userData.emit) {
          ctx3d.sparkParticles.userData.emit(
            p.x,
            pe,
            p.y,
            Math.cos(p.angle) * 20,
            2,
            Math.sin(p.angle) * 20,
            4
          );
        }
      } else {
        mesh.visible = false;
      }
    }
  }

  /** Fireball + flash spheres for missile detonations */
  function makeExplosionMesh(THREE) {
    var g = new THREE.Group();
    var fire = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xff6622,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    g.add(fire);
    var core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0xfff0a0,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      })
    );
    g.add(core);
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.18, 8, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffaa44,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      })
    );
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.userData.fire = fire;
    g.userData.core = core;
    g.userData.ring = ring;
    g.visible = false;
    return g;
  }

  function syncExplosions(state, dt) {
    var THREE = root.THREE;
    if (!ctx3d.explosionMeshes) ctx3d.explosionMeshes = [];
    var list = state.explosions || [];
    var worldRoot = ctx3d.root;
    while (ctx3d.explosionMeshes.length < list.length) {
      var em = makeExplosionMesh(THREE);
      worldRoot.add(em);
      ctx3d.explosionMeshes.push(em);
    }
    var i, mesh, ex, t, scale, elev;
    for (i = 0; i < ctx3d.explosionMeshes.length; i++) {
      mesh = ctx3d.explosionMeshes[i];
      if (i < list.length) {
        ex = list[i];
        t = 1 - ex.life / (ex.maxLife || 1);
        elev = (ex.elev || 0) + 2.2;
        mesh.visible = true;
        mesh.position.set(ex.x, elev, ex.y);
        // Expand then fade
        scale = 2.5 + t * 18;
        mesh.scale.set(scale, scale * (0.75 + t * 0.4), scale);
        if (mesh.userData.fire) {
          mesh.userData.fire.material.opacity = Math.max(0, 0.95 * (1 - t));
        }
        if (mesh.userData.core) {
          mesh.userData.core.material.opacity = Math.max(0, 1 - t * 1.4);
          mesh.userData.core.scale.setScalar(1 + t * 2);
        }
        if (mesh.userData.ring) {
          mesh.userData.ring.scale.setScalar(1 + t * 3.5);
          mesh.userData.ring.material.opacity = Math.max(0, 0.8 * (1 - t));
        }
        // Burst particles on first frames of each explosion
        if (ex.life > (ex.maxLife || 1) - dt * 2.5) {
          if (ctx3d.explodeParticles && ctx3d.explodeParticles.userData.emit) {
            ctx3d.explodeParticles.userData.emit(
              ex.x,
              elev,
              ex.y,
              0,
              28,
              0,
              48
            );
          }
          if (ctx3d.smokeParticles && ctx3d.smokeParticles.userData.emit) {
            ctx3d.smokeParticles.userData.emit(ex.x, elev + 1, ex.y, 0, 10, 0, 22);
          }
        }
      } else {
        mesh.visible = false;
      }
    }
  }

  /**
   * cameraMode: "chase" (3rd person) | "cockpit" (behind the wheel / hood)
   */
  function setCameraMode(mode) {
    if (!ctx3d) return;
    if (mode !== "chase" && mode !== "cockpit") return;
    ctx3d.cameraMode = mode;
  }

  function toggleCameraMode() {
    if (!ctx3d) return "chase";
    ctx3d.cameraMode = ctx3d.cameraMode === "cockpit" ? "chase" : "cockpit";
    return ctx3d.cameraMode;
  }

  function getCameraMode() {
    return (ctx3d && ctx3d.cameraMode) || "chase";
  }

  /** Sample track elevation at a world XY (for hill-aware camera look). */
  function sampleElevAt(state, x, y) {
    if (!state || !state.track || !state.metrics) return 0;
    var Engine = root.NeoKartEngine;
    if (Engine && Engine.projectOnTrack) {
      var pr = Engine.projectOnTrack(x, y, state.track.waypoints, state.metrics);
      return pr && pr.elev != null ? pr.elev : 0;
    }
    var TrackApi = root.NeoKartTrack;
    if (!TrackApi) return 0;
    // Fallback: nearest waypoint elev
    var wps = state.track.waypoints;
    var best = 0;
    var bestD = Infinity;
    var i, d;
    for (i = 0; i < wps.length; i++) {
      d = (wps[i].x - x) * (wps[i].x - x) + (wps[i].y - y) * (wps[i].y - y);
      if (d < bestD) {
        bestD = d;
        best = wps[i].z || 0;
      }
    }
    return best;
  }

  function updateCamera(player, dt, state) {
    var elev = player.elev || 0;
    var mode = ctx3d.cameraMode || "chase";
    var cx, cy, cz, lx, ly, lz, targetFov;
    var fx = Math.cos(player.angle);
    var fz = Math.sin(player.angle);
    // Right vector in world XZ (matches car local +Z)
    var rx = -Math.sin(player.angle);
    var rz = Math.cos(player.angle);

    // Instant-replay: slight cinematic pull-back while scrubbing buffer
    if (state && state.phase === "replay") {
      var backR = 26;
      var ht = elev + 9;
      cx = player.x - fx * backR;
      cz = player.y - fz * backR;
      cy = ht;
      lx = player.x + fx * 20;
      ly = elev + 2;
      lz = player.y + fz * 20;
      targetFov = 52;
      var kr = 1 - Math.pow(0.001, Math.max(dt, 0.001));
      kr = Math.min(1, kr * 6);
      ctx3d.camSmooth.x += (cx - ctx3d.camSmooth.x) * kr;
      ctx3d.camSmooth.y += (cy - ctx3d.camSmooth.y) * kr;
      ctx3d.camSmooth.z += (cz - ctx3d.camSmooth.z) * kr;
      ctx3d.lookSmooth.x += (lx - ctx3d.lookSmooth.x) * kr;
      ctx3d.lookSmooth.y += (ly - ctx3d.lookSmooth.y) * kr;
      ctx3d.lookSmooth.z += (lz - ctx3d.lookSmooth.z) * kr;
      ctx3d.camera.position.set(
        ctx3d.camSmooth.x,
        ctx3d.camSmooth.y,
        ctx3d.camSmooth.z
      );
      ctx3d.camera.lookAt(
        ctx3d.lookSmooth.x,
        ctx3d.lookSmooth.y,
        ctx3d.lookSmooth.z
      );
      ctx3d.camera.fov += (targetFov - ctx3d.camera.fov) * 0.12;
      ctx3d.camera.updateProjectionMatrix();
      return;
    }

    // Podium orbit after finish — slow circle around the player
    if (state && state.phase === "results") {
      var pt = state.podiumT || 0;
      var orbit = pt * 0.55;
      var rad = 28;
      cx = player.x + Math.cos(orbit) * rad;
      cz = player.y + Math.sin(orbit) * rad;
      cy = elev + 10 + Math.sin(pt * 0.8) * 1.2;
      lx = player.x;
      ly = elev + 2.5;
      lz = player.y;
      targetFov = 48;
      var kp = 1 - Math.pow(0.001, Math.max(dt, 0.001));
      kp = Math.min(1, kp * 4);
      ctx3d.camSmooth.x += (cx - ctx3d.camSmooth.x) * kp;
      ctx3d.camSmooth.y += (cy - ctx3d.camSmooth.y) * kp;
      ctx3d.camSmooth.z += (cz - ctx3d.camSmooth.z) * kp;
      ctx3d.lookSmooth.x += (lx - ctx3d.lookSmooth.x) * kp;
      ctx3d.lookSmooth.y += (ly - ctx3d.lookSmooth.y) * kp;
      ctx3d.lookSmooth.z += (lz - ctx3d.lookSmooth.z) * kp;
      ctx3d.camera.position.set(
        ctx3d.camSmooth.x,
        ctx3d.camSmooth.y,
        ctx3d.camSmooth.z
      );
      ctx3d.camera.lookAt(
        ctx3d.lookSmooth.x,
        ctx3d.lookSmooth.y,
        ctx3d.lookSmooth.z
      );
      ctx3d.camera.fov += (targetFov - ctx3d.camera.fov) * 0.1;
      ctx3d.camera.updateProjectionMatrix();
      return;
    }

    // Road elev ahead — look uphill/downhill along the surface, not the horizon
    var lookDistNear = 18;
    var lookDistFar = 48;
    var elevNear = sampleElevAt(
      state,
      player.x + fx * lookDistNear,
      player.y + fz * lookDistNear
    );
    var elevFar = sampleElevAt(
      state,
      player.x + fx * lookDistFar,
      player.y + fz * lookDistFar
    );
    // Grade: positive = climbing, negative = descending
    var grade = elevFar - elev;
    var gradeNear = elevNear - elev;

    if (mode === "cockpit") {
      // Driver eyes: over the wheel, clear view of the road ahead
      var seatFwd = 0.15;
      var seatSide = -0.48;
      var seatUp = 3.85;
      cx = player.x + fx * seatFwd + rx * seatSide;
      cz = player.y + fz * seatFwd + rz * seatSide;
      cy = elev + seatUp;
      // Aim at road surface ahead so hills pitch the view naturally
      lx = player.x + fx * lookDistFar + rx * seatSide * 0.15;
      lz = player.y + fz * lookDistFar + rz * seatSide * 0.15;
      // Look slightly above asphalt; blend near/far elev so grade is readable
      ly = elevFar * 0.65 + elevNear * 0.35 + 1.35;
      // On steep climb, lift look a touch; on descent, track the falling road
      if (grade > 4) ly += Math.min(8, grade * 0.12);
      if (grade < -4) ly += Math.max(-6, grade * 0.1);
      targetFov = 68 + Math.min(12, Math.abs(player.speed) * 0.04);
      if (player.boostT > 0) targetFov += 5;
      if (ctx3d.camera.near !== 0.05) {
        ctx3d.camera.near = 0.05;
        ctx3d.camera.far = 2800;
      }
    } else {
      // Chase cam — also follows grade so hills read correctly
      var back = 22;
      var height = 8.5 + Math.max(-2, Math.min(4, gradeNear * 0.08));
      var lookAhead = 36;
      cx = player.x - fx * back;
      cz = player.y - fz * back;
      cy = elev + height + Math.min(4, Math.abs(player.speed) * 0.012);
      lx = player.x + fx * lookAhead;
      lz = player.y + fz * lookAhead;
      ly = elevFar + 2.2 + Math.max(-3, Math.min(5, grade * 0.15));
      targetFov = 50 + Math.min(16, Math.abs(player.speed) * 0.045);
      if (player.boostT > 0) targetFov += 8;
      if (ctx3d.camera.near !== 0.35) {
        ctx3d.camera.near = 0.35;
        ctx3d.camera.far = 2800;
      }
    }

    // Cockpit: lock hard to the seat
    var k;
    if (mode === "cockpit") {
      k = 1;
    } else {
      k = 1 - Math.pow(0.001, Math.max(dt, 0.001));
      k = Math.min(1, k * 8);
    }
    // High-speed FOV punch + landing flash + impact camera punch
    var speedFrac = state && state._speedFrac != null ? state._speedFrac : 0;
    if (speedFrac > 0.55) {
      targetFov += (speedFrac - 0.55) * 18;
    }
    if (state && state._landingFlash > 0) {
      targetFov += state._landingFlash * 8;
    }
    var punch = state && state.cameraPunch ? state.cameraPunch : 0;
    if (punch > 0) {
      targetFov += punch * 10;
      // Kick camera up/back on impact
      cy += punch * 1.8;
      cx -= fx * punch * 2.5;
      cz -= fz * punch * 2.5;
    }

    // Look target can ease slightly on hills for less nauseating pitch
    var kLook = mode === "cockpit" ? 0.55 : k;
    var kY = mode === "cockpit" ? 1 : Math.min(1, k * 1.35);
    ctx3d.camSmooth.x += (cx - ctx3d.camSmooth.x) * k;
    ctx3d.camSmooth.y += (cy - ctx3d.camSmooth.y) * kY;
    ctx3d.camSmooth.z += (cz - ctx3d.camSmooth.z) * k;
    ctx3d.lookSmooth.x += (lx - ctx3d.lookSmooth.x) * kLook;
    ctx3d.lookSmooth.y += (ly - ctx3d.lookSmooth.y) * Math.min(1, kLook * 1.2);
    ctx3d.lookSmooth.z += (lz - ctx3d.lookSmooth.z) * kLook;

    ctx3d.camera.position.set(ctx3d.camSmooth.x, ctx3d.camSmooth.y, ctx3d.camSmooth.z);
    ctx3d.camera.lookAt(ctx3d.lookSmooth.x, ctx3d.lookSmooth.y, ctx3d.lookSmooth.z);

    ctx3d.camera.fov += (targetFov - ctx3d.camera.fov) * (mode === "cockpit" ? 0.35 : 0.12);
    ctx3d.camera.updateProjectionMatrix();
  }

  function render(canvas, state, dt) {
    if (!root.THREE) return false;
    if (!ctx3d || !ctx3d.ready) {
      try {
        init(canvas, state);
      } catch (e) {
        console.error("render3d init failed", e);
        return false;
      }
    }
    if (!state || !ctx3d) return false;

    // rebuild if track changed
    if (ctx3d.trackId !== state.track.id) {
      disposeScene();
      buildWorld(state);
      ctx3d.trackId = state.track.id;
    }

    ensureSize(canvas);
    dt = dt || 1 / 60;

    var i, k, mesh;
    var V = Vehicles();
    var playerKart = state.karts[0];
    var playerIdx = 0;
    for (i = 0; i < state.karts.length; i++) {
      if (state.karts[i].isPlayer) {
        playerKart = state.karts[i];
        playerIdx = i;
      }
    }

    var cockpit = (ctx3d.cameraMode || "chase") === "cockpit";
    for (i = 0; i < state.karts.length; i++) {
      k = state.karts[i];
      mesh = ctx3d.kartMeshes[i];
      if (!mesh) continue;
      // Blown up: hide the car (fireball takes over). Cockpit also hides exterior.
      var blown = k.explodedT > 0;
      var hideBody = blown || (cockpit && i === playerIdx);
      mesh.visible = !hideBody;
      // elev already includes road surface pad — sit tires on asphalt
      mesh.position.set(k.x, k.elev || 0, k.y);
      // YXZ: heading then pitch with road grade (nose follows hills)
      mesh.rotation.order = "YXZ";
      mesh.rotation.y = -k.angle;
      var roadPitch = k.pitch || 0;
      // Positive pitch = climb → tip nose up (negative local X in Three after yaw)
      mesh.rotation.x = -roadPitch + Math.min(0.04, Math.abs(k.speed) * 0.00005);
      // light body roll
      mesh.rotation.z = Math.sin(state.time * 4 + i) * 0.01;
      if (blown) {
        // Spinning wreckage orientation (still tracked for when it reappears)
        mesh.rotation.y = -k.angle;
        mesh.rotation.z = Math.sin(state.time * 22 + i) * 1.2;
        mesh.rotation.x = Math.cos(state.time * 18 + i) * 0.8;
        // Continuous smoke while wrecked
        if (ctx3d.smokeParticles && ctx3d.smokeParticles.userData.emit) {
          ctx3d.smokeParticles.userData.emit(
            k.x,
            (k.elev || 0) + 2.5,
            k.y,
            (Math.random() - 0.5) * 4,
            6 + Math.random() * 8,
            (Math.random() - 0.5) * 4,
            4
          );
        }
        if (ctx3d.explodeParticles && ctx3d.explodeParticles.userData.emit && k.explodedT > 1.1) {
          ctx3d.explodeParticles.userData.emit(
            k.x,
            (k.elev || 0) + 2,
            k.y,
            0,
            12,
            0,
            6
          );
        }
      }
      if (V && V.spinWheels) V.spinWheels(mesh, k.speed, dt);
      if (V && V.setBoostVisual) V.setBoostVisual(mesh, k.boostT > 0);
      else if (mesh.userData.glow && mesh.userData.glow.material) {
        mesh.userData.glow.material.opacity = k.boostT > 0 ? 0.55 : 0;
      }
      if (!blown && k.stunT > 0) {
        mesh.rotation.y += Math.sin(state.time * 30) * 0.35;
        if (ctx3d.sparkParticles && ctx3d.sparkParticles.userData.emit) {
          ctx3d.sparkParticles.userData.emit(k.x, (k.elev || 0) + 1.5, k.y, 0, 8, 0, 3);
        }
      }
      // Distance-cull FX for non-player cars (big CPU win in traffic packs)
      var nearPlayer =
        i === playerIdx ||
        (playerKart &&
          Math.abs(k.x - playerKart.x) < 140 &&
          Math.abs(k.y - playerKart.y) < 140);

      // Damage smoke after hits
      if (
        nearPlayer &&
        !blown &&
        k.damage > 0.2 &&
        ctx3d.smokeParticles &&
        ctx3d.smokeParticles.userData.emit &&
        Math.random() < k.damage * 0.28
      ) {
        ctx3d.smokeParticles.userData.emit(
          k.x,
          (k.elev || 0) + 2.2,
          k.y,
          (Math.random() - 0.5) * 2,
          4,
          (Math.random() - 0.5) * 2,
          2
        );
      }
      // Shield bubble hint
      if (k.shieldT > 0 && mesh.userData.glow && mesh.userData.glow.material) {
        mesh.userData.glow.material.opacity = 0.35 + Math.sin(state.time * 8) * 0.1;
        mesh.userData.glow.material.color.setHex(0x44ffaa);
      }
      // boost exhaust particles
      if (
        nearPlayer &&
        k.boostT > 0 &&
        ctx3d.boostParticles &&
        ctx3d.boostParticles.userData.emit
      ) {
        var bx = k.x - Math.cos(k.angle) * 7;
        var bz = k.y - Math.sin(k.angle) * 7;
        ctx3d.boostParticles.userData.emit(
          bx,
          (k.elev || 0) + 1.2,
          bz,
          -Math.cos(k.angle) * 30,
          4,
          -Math.sin(k.angle) * 30,
          6
        );
      }
      // skid marks when braking / sliding (player + nearby only)
      if (nearPlayer && ctx3d.skids && ctx3d.skids.userData.stamp) {
        var brakeHard = k.speed > 80 && k.slowT > 0;
        if (brakeHard || (k.speed > 100 && Math.abs(mesh.rotation.z) > 0.02)) {
          ctx3d.skids.userData.stamp(k.x, k.y, k.angle, k.speed / 220);
        }
      }
    }

    // Ghost PB car follows recorded pace pose (lazy-create if PB set after world build)
    if (state.ghostPbTime && !ctx3d.ghostMesh && ctx3d.root) {
      var gHex = 0x88ccff;
      var gNew = makeKartMesh(gHex, 99, "model3");
      gNew.traverse(function (ch) {
        if (ch.material) {
          var mats = Array.isArray(ch.material) ? ch.material : [ch.material];
          mats.forEach(function (m) {
            if (!m) return;
            m.transparent = true;
            m.opacity = 0.38;
            m.depthWrite = false;
            if (m.emissive) m.emissive.setHex(0x2266aa);
          });
        }
      });
      ctx3d.root.add(gNew);
      ctx3d.ghostMesh = gNew;
    }
    if (ctx3d.ghostMesh) {
      var gp = state.ghostPose;
      if (gp && state.phase === "racing") {
        ctx3d.ghostMesh.visible = true;
        ctx3d.ghostMesh.position.set(gp.x, gp.elev || 0, gp.y);
        ctx3d.ghostMesh.rotation.order = "YXZ";
        ctx3d.ghostMesh.rotation.y = -gp.angle;
        ctx3d.ghostMesh.rotation.x = 0;
        ctx3d.ghostMesh.rotation.z = 0;
      } else {
        ctx3d.ghostMesh.visible = false;
      }
    }

    // player headlights
    if (ctx3d.headLights && ctx3d.headLights.length === 2) {
      var fx = Math.cos(playerKart.angle);
      var fz = Math.sin(playerKart.angle);
      var sx = -Math.sin(playerKart.angle);
      var sz = Math.cos(playerKart.angle);
      var hl = ctx3d.headLights[0];
      var hr = ctx3d.headLights[1];
      var pe = playerKart.elev || 0;
      hl.position.set(playerKart.x + fx * 6 + sx * 1.6, pe + 2.2, playerKart.y + fz * 6 + sz * 1.6);
      hr.position.set(playerKart.x + fx * 6 - sx * 1.6, pe + 2.2, playerKart.y + fz * 6 - sz * 1.6);
      hl.target.position.set(playerKart.x + fx * 40 + sx * 1.6, pe + 1.2, playerKart.y + fz * 40 + sz * 1.6);
      hr.target.position.set(playerKart.x + fx * 40 - sx * 1.6, pe + 1.2, playerKart.y + fz * 40 - sz * 1.6);
      hl.intensity = playerKart.boostT > 0 ? 1.6 : 0.85;
      hr.intensity = hl.intensity;
    }

    if (ctx3d.boostParticles && ctx3d.boostParticles.userData.step) {
      ctx3d.boostParticles.userData.step(dt);
    }
    if (ctx3d.sparkParticles && ctx3d.sparkParticles.userData.step) {
      ctx3d.sparkParticles.userData.step(dt);
    }
    if (ctx3d.skids && ctx3d.skids.userData.step) {
      ctx3d.skids.userData.step(dt);
    }
    if (ctx3d.explodeParticles && ctx3d.explodeParticles.userData.step) {
      ctx3d.explodeParticles.userData.step(dt);
    }
    if (ctx3d.smokeParticles && ctx3d.smokeParticles.userData.step) {
      ctx3d.smokeParticles.userData.step(dt);
    }

    for (i = 0; i < state.itemBoxes.length; i++) {
      var box = state.itemBoxes[i];
      mesh = ctx3d.boxMeshes[i];
      if (!mesh) continue;
      mesh.visible = !!box.active;
      if (!box.active) continue;
      mesh.position.set(box.x, 6 + Math.sin(state.time * 4 + i) * 1.2, box.y);
      mesh.rotation.y = state.time * 2 + i;
      if (mesh.userData.ring) mesh.userData.ring.rotation.z = state.time * 3;
    }

    syncHazards(state);
    syncProjectiles(state, dt);
    syncExplosions(state, dt);

    // weather anim — every other frame is enough at high rain counts
    ctx3d.frameN = (ctx3d.frameN || 0) + 1;
    if (ctx3d.rain && (ctx3d.frameN & 1) === 0) {
      var pos = ctx3d.rain.geometry.attributes.position.array;
      var rainDt = dt * 2;
      for (i = 0; i < pos.length; i += 3) {
        pos[i + 1] -= 120 * rainDt;
        if (pos[i + 1] < 0) {
          pos[i + 1] = 120 + Math.random() * 40;
          pos[i] = playerKart.x + (Math.random() - 0.5) * 420;
          pos[i + 2] = playerKart.y + (Math.random() - 0.5) * 420;
        }
      }
      ctx3d.rain.geometry.attributes.position.needsUpdate = true;
    }

    // Cabin rides with the player car; only visible in WHEEL mode (and not when blown up)
    if (ctx3d.cockpit) {
      if (cockpit && !(playerKart.explodedT > 0)) {
        ctx3d.cockpit.visible = true;
        ctx3d.cockpit.position.set(
          playerKart.x,
          (playerKart.elev || 0) + 0.02,
          playerKart.y
        );
        // Pitch cabin slightly with road grade so wheel/hood match the hill
        var elevAheadCab = sampleElevAt(
          state,
          playerKart.x + Math.cos(playerKart.angle) * 30,
          playerKart.y + Math.sin(playerKart.angle) * 30
        );
        var pitch =
          Math.atan2(
            elevAheadCab - (playerKart.elev || 0),
            30
          ) * 0.85;
        pitch = Math.max(-0.35, Math.min(0.4, pitch));
        // YXZ: yaw with heading, then pitch with road grade (local after yaw)
        ctx3d.cockpit.rotation.order = "YXZ";
        ctx3d.cockpit.rotation.y = -playerKart.angle;
        ctx3d.cockpit.rotation.x = pitch;
        ctx3d.cockpit.rotation.z = 0;

        // Steering wheel + hands from input (A/D or arrows)
        var steerTarget = 0;
        var InputApi = root.NeoKartInput;
        if (InputApi && InputApi.getPlayerInput) {
          var pin = InputApi.getPlayerInput();
          if (pin.left) steerTarget += 1;
          if (pin.right) steerTarget -= 1;
        } else if (playerKart._lastAngle != null) {
          var dAng = playerKart.angle - playerKart._lastAngle;
          while (dAng > Math.PI) dAng -= Math.PI * 2;
          while (dAng < -Math.PI) dAng += Math.PI * 2;
          steerTarget = Math.max(-1, Math.min(1, -dAng * 12));
        }
        playerKart._lastAngle = playerKart.angle;
        if (ctx3d.cockpit.userData.steerSmooth == null) {
          ctx3d.cockpit.userData.steerSmooth = 0;
        }
        ctx3d.cockpit.userData.steerSmooth +=
          (steerTarget - ctx3d.cockpit.userData.steerSmooth) * Math.min(1, dt * 10);
        var steer = ctx3d.cockpit.userData.steerSmooth;
        if (ctx3d.cockpit.userData.steeringWheel) {
          // Spin around column axis (local X after column tilt)
          ctx3d.cockpit.userData.steeringWheel.rotation.x = steer * 0.95;
        }
      } else {
        ctx3d.cockpit.visible = false;
      }
    }

    updateCamera(playerKart, dt, state);

    // snap cam on first frames (include elevation)
    if (state.time < 0.05) {
      var e0 = playerKart.elev || 0;
      if (cockpit) {
        var sfx = Math.cos(playerKart.angle);
        var sfz = Math.sin(playerKart.angle);
        var srx = -Math.sin(playerKart.angle);
        var srz = Math.cos(playerKart.angle);
        ctx3d.camSmooth.x = playerKart.x + sfx * 0.15 + srx * -0.48;
        ctx3d.camSmooth.y = e0 + 3.85;
        ctx3d.camSmooth.z = playerKart.y + sfz * 0.15 + srz * -0.48;
        var eFar = sampleElevAt(
          state,
          playerKart.x + sfx * 48,
          playerKart.y + sfz * 48
        );
        ctx3d.lookSmooth.x = playerKart.x + sfx * 48;
        ctx3d.lookSmooth.y = eFar + 1.35;
        ctx3d.lookSmooth.z = playerKart.y + sfz * 48;
      } else {
        ctx3d.camSmooth.x = playerKart.x - Math.cos(playerKart.angle) * 22;
        ctx3d.camSmooth.y = e0 + 8.5;
        ctx3d.camSmooth.z = playerKart.y - Math.sin(playerKart.angle) * 22;
        ctx3d.lookSmooth.x = playerKart.x;
        ctx3d.lookSmooth.y = e0 + 2.5;
        ctx3d.lookSmooth.z = playerKart.y;
      }
    }

    // Minimal camera motion — premium VR sports feel (no nauseating shake)

    // sky + sun follow player so dome stays centered
    if (ctx3d.sky) {
      ctx3d.sky.position.set(playerKart.x, 0, playerKart.y);
      if (ctx3d.sky.userData.sun && ctx3d.sunDir) {
        ctx3d.sky.userData.sun.position
          .copy(ctx3d.sunDir)
          .multiplyScalar(900)
          .add(ctx3d.sky.position);
      }
    }
    // sun light tracks player — throttle matrix updates (shadow map is expensive)
    if (ctx3d.sunLight && ctx3d.sunDir && (ctx3d.frameN & 1) === 0) {
      ctx3d.sunLight.position.set(
        playerKart.x + ctx3d.sunDir.x * 400,
        ctx3d.sunDir.y * 400,
        playerKart.y + ctx3d.sunDir.z * 400
      );
      ctx3d.sunLight.target.position.set(playerKart.x, 0, playerKart.y);
      if (!ctx3d.sunLight.target.parent && ctx3d.root) {
        ctx3d.root.add(ctx3d.sunLight.target);
      }
      ctx3d.sunLight.target.updateMatrixWorld();
    }

    // Bloom HDR composite (Xbox 360 night-race look) or direct render
    if (ctx3d.bloom && ctx3d.bloom.enabled) {
      try {
        if (!ctx3d.bloom.render(ctx3d.renderer, ctx3d.scene, ctx3d.camera)) {
          ctx3d.renderer.render(ctx3d.scene, ctx3d.camera);
        }
      } catch (e) {
        ctx3d.bloom.enabled = false;
        ctx3d.renderer.render(ctx3d.scene, ctx3d.camera);
      }
    } else {
      ctx3d.renderer.render(ctx3d.scene, ctx3d.camera);
    }
    return true;
  }

  function destroy() {
    if (!ctx3d) return;
    disposeScene();
    if (ctx3d.renderer) {
      ctx3d.renderer.dispose();
    }
    ctx3d = null;
  }

  function isReady() {
    return !!(root.THREE && ctx3d && ctx3d.ready);
  }

  var api = {
    init: init,
    render: render,
    destroy: destroy,
    isReady: isReady,
    ensureSize: ensureSize,
    setCameraMode: setCameraMode,
    toggleCameraMode: toggleCameraMode,
    getCameraMode: getCameraMode,
    getQuality: function () {
      return QUALITY;
    },
    setQuality: setQuality,
    adaptQualityDown: adaptQualityDown,
    QUALITY_PRESETS: QUALITY_PRESETS,
    CANVAS_W: CANVAS_W,
    CANVAS_H: CANVAS_H,
  };

  root.NeoKartRender3D = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
