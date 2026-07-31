/**
 * Tesla Model 3 fleet — original high-detail procedural meshes.
 * Proportions and styling match public Model 3 design language.
 * Not affiliated with, endorsed by, or using assets from Tesla, Inc.
 */
(function (root) {
  "use strict";

  /**
   * Factory-style Model 3 paint codes (approximated hex for PBR).
   * Order used for kart 0..n
   */
  var MODEL3_PAINTS = [
    { id: "deep-blue", name: "Deep Blue Metallic", hex: 0x1a3a6e },
    { id: "red", name: "Red Multi-Coat", hex: 0xa01820 },
    { id: "pearl-white", name: "Pearl White Multi-Coat", hex: 0xf0f0ec },
    { id: "solid-black", name: "Solid Black", hex: 0x0e0e10 },
    { id: "midnight-silver", name: "Midnight Silver Metallic", hex: 0x4a5058 },
    { id: "stealth-grey", name: "Stealth Grey", hex: 0x5c6168 },
    { id: "quicksilver", name: "Quicksilver", hex: 0xb0b4b8 },
    { id: "ultra-red", name: "Ultra Red", hex: 0x8b1020 },
  ];

  var BODY_STYLES = ["model3", "model3", "model3", "model3"];

  function paintForKart(kartId) {
    return MODEL3_PAINTS[kartId % MODEL3_PAINTS.length].hex;
  }

  function paintForColor(colorHex) {
    // Prefer mapping sim colors onto factory paints for consistency
    var c = colorHex & 0xffffff;
    var r = (c >> 16) & 255;
    var g = (c >> 8) & 255;
    var b = c & 255;
    if (r > 200 && g < 100) return MODEL3_PAINTS[1].hex;
    if (b > 150 && r < 80) return MODEL3_PAINTS[0].hex;
    if (r > 200 && g > 200 && b > 200) return MODEL3_PAINTS[2].hex;
    if (r < 40 && g < 40 && b < 40) return MODEL3_PAINTS[3].hex;
    if (Math.abs(r - g) < 30 && Math.abs(g - b) < 30) return MODEL3_PAINTS[4].hex;
    return c;
  }

  function makeEnvMap(THREE) {
    var size = 512;
    var faces = [];
    var specs = [
      { top: "#6ab0ff", bot: "#c8dce8", sun: false },
      { top: "#5aa0f0", bot: "#b8d0e0", sun: false },
      { top: "#3a88e8", bot: "#8ec0f0", sun: true },
      { top: "#6a7a50", bot: "#4a5a38", sun: false },
      { top: "#70b4ff", bot: "#d0e4f0", sun: false },
      { top: "#68a8f0", bot: "#c0d8e8", sun: false },
    ];
    var i, j;
    for (i = 0; i < 6; i++) {
      var c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      var ctx = c.getContext("2d");
      var g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, specs[i].top);
      g.addColorStop(1, specs[i].bot);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      if (specs[i].sun) {
        var sg = ctx.createRadialGradient(size * 0.55, size * 0.35, 4, size * 0.55, size * 0.35, 50);
        sg.addColorStop(0, "rgba(255,252,240,1)");
        sg.addColorStop(0.25, "rgba(255,236,180,0.85)");
        sg.addColorStop(1, "rgba(255,220,140,0)");
        ctx.fillStyle = sg;
        ctx.fillRect(0, 0, size, size);
      }
      ctx.globalAlpha = 0.12;
      for (j = 0; j < 10; j++) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.ellipse(
          Math.random() * size,
          Math.random() * size * 0.55,
          8 + Math.random() * 20,
          3 + Math.random() * 8,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      faces.push(c);
    }
    var tex = new THREE.CubeTexture(faces);
    tex.needsUpdate = true;
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function carPaint(THREE, color, envMap) {
    if (THREE.MeshPhysicalMaterial) {
      return new THREE.MeshPhysicalMaterial({
        color: color,
        metalness: 0.88,
        roughness: 0.28,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        envMap: envMap,
        envMapIntensity: 1.35,
      });
    }
    return new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.9,
      roughness: 0.22,
      envMap: envMap,
      envMapIntensity: 1.3,
    });
  }

  function glassMat(THREE, envMap) {
    if (THREE.MeshPhysicalMaterial) {
      return new THREE.MeshPhysicalMaterial({
        color: 0x0c1218,
        metalness: 0.05,
        roughness: 0.04,
        transparent: true,
        opacity: 0.55,
        envMap: envMap,
        envMapIntensity: 1.8,
        side: THREE.DoubleSide,
        transmission: 0.45,
        thickness: 0.4,
      });
    }
    return new THREE.MeshStandardMaterial({
      color: 0x101820,
      metalness: 0.2,
      roughness: 0.08,
      transparent: true,
      opacity: 0.55,
      envMap: envMap,
      envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    });
  }

  function blackTrim(THREE, envMap) {
    return new THREE.MeshStandardMaterial({
      color: 0x0a0a0c,
      metalness: 0.65,
      roughness: 0.35,
      envMap: envMap,
      envMapIntensity: 0.6,
    });
  }

  function rubberMat(THREE) {
    return new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      metalness: 0.02,
      roughness: 0.94,
    });
  }

  function lightMat(THREE, color, intensity) {
    return new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: intensity != null ? intensity : 2.2,
      metalness: 0.3,
      roughness: 0.25,
    });
  }

  /**
   * Model 3 aero wheel (Gemini-style disc cover)
   * Real-ish 18–19" proportions at game scale
   */
  function makeModel3Wheel(THREE, radius, width) {
    var g = new THREE.Group();
    var tire = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, width, 48),
      rubberMat(THREE)
    );
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    g.add(tire);

    // sidewall detail
    var sidewall = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.92, width * 0.12, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, metalness: 0.05 })
    );
    sidewall.rotation.y = Math.PI / 2;
    g.add(sidewall);

    // aero disc cover
    var disc = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, width * 0.35, 40),
      new THREE.MeshStandardMaterial({
        color: 0x2c2e32,
        metalness: 0.75,
        roughness: 0.35,
      })
    );
    disc.rotation.z = Math.PI / 2;
    g.add(disc);

    // 5-spoke under disc (visible at edge)
    var i;
    for (i = 0; i < 5; i++) {
      var spoke = new THREE.Mesh(
        new THREE.BoxGeometry(radius * 0.55, width * 0.12, radius * 0.14),
        new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.85, roughness: 0.25 })
      );
      spoke.rotation.z = Math.PI / 2;
      spoke.rotation.x = (i / 5) * Math.PI * 2;
      spoke.position.x = width * 0.05;
      g.add(spoke);
    }

    var hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, width * 0.5, 16),
      new THREE.MeshStandardMaterial({ color: 0xc0c4c8, metalness: 0.95, roughness: 0.15 })
    );
    hub.rotation.z = Math.PI / 2;
    g.add(hub);

    // center cap
    var cap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.12, radius * 0.12, width * 0.52, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5, roughness: 0.4 })
    );
    cap.rotation.z = Math.PI / 2;
    g.add(cap);

    g.userData.spin = tire;
    return g;
  }

  function addWheels(THREE, group, positions, radius, width) {
    var wheels = [];
    var i;
    for (i = 0; i < positions.length; i++) {
      var w = makeModel3Wheel(THREE, radius, width);
      w.position.set(positions[i].x, positions[i].y, positions[i].z);
      group.add(w);
      wheels.push(w);
    }
    group.userData.wheels = wheels;
    return wheels;
  }

  function mesh(THREE, geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx) m.rotation.x = rx;
    if (ry) m.rotation.y = ry;
    if (rz) m.rotation.z = rz;
    if (sx || sy || sz) m.scale.set(sx != null ? sx : 1, sy != null ? sy : 1, sz != null ? sz : 1);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function sgn(v) {
    return v < 0 ? -1 : 1;
  }

  /**
   * Smooth car loft. stations: { x, halfW, y0, y1, pinch? }
   * Superellipse cross-section (soft, Model 3-like, not boxy).
   */
  function loftBody(THREE, stations, mat, segs) {
    segs = segs || 36;
    var positions = [];
    var uvs = [];
    var indices = [];
    var si, s, t, ang, px, py, pz, ring = segs;
    var rings = [];
    var power = 0.38; // lower = rounder, more sedan-like
    for (si = 0; si < stations.length; si++) {
      s = stations[si];
      var ringIdx = [];
      var pinch = s.pinch != null ? s.pinch : 1;
      for (t = 0; t < ring; t++) {
        ang = (t / ring) * Math.PI * 2;
        var ca = Math.cos(ang);
        var sa = Math.sin(ang);
        // Superellipse → smooth shoulders, soft rocker
        var rx = Math.pow(Math.abs(ca), power) * sgn(ca);
        var ry = Math.pow(Math.abs(sa), power * 1.05) * sgn(sa);
        // Flatten bottom slightly (road contact) / keep roof soft
        if (ry < 0) ry *= 0.88;
        var midY = (s.y0 + s.y1) * 0.5;
        var halfH = (s.y1 - s.y0) * 0.5;
        px = s.x;
        py = midY + ry * halfH;
        pz = rx * s.halfW * pinch;
        ringIdx.push(positions.length / 3);
        positions.push(px, py, pz);
        uvs.push(si / Math.max(1, stations.length - 1), t / ring);
      }
      rings.push(ringIdx);
    }
    var r, k, ia, ib, ic, id;
    for (r = 0; r < rings.length - 1; r++) {
      for (k = 0; k < ring; k++) {
        var k2 = (k + 1) % ring;
        ia = rings[r][k];
        ib = rings[r][k2];
        ic = rings[r + 1][k2];
        id = rings[r + 1][k];
        indices.push(ia, ib, ic, ia, ic, id);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    var m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /** Catmull-style densify of loft stations for silky body curves. */
  function densifyStations(ctrl, steps) {
    steps = steps || 3;
    var out = [];
    var n = ctrl.length;
    var i, j, t, p0, p1, p2, p3;
    function get(k) {
      return ctrl[Math.max(0, Math.min(n - 1, k))];
    }
    function lerpS(a, b, u) {
      return {
        x: a.x + (b.x - a.x) * u,
        halfW: a.halfW + (b.halfW - a.halfW) * u,
        y0: a.y0 + (b.y0 - a.y0) * u,
        y1: a.y1 + (b.y1 - a.y1) * u,
        pinch: (a.pinch != null ? a.pinch : 1) + ((b.pinch != null ? b.pinch : 1) - (a.pinch != null ? a.pinch : 1)) * u,
      };
    }
    for (i = 0; i < n - 1; i++) {
      p1 = get(i);
      p2 = get(i + 1);
      for (j = 0; j < steps; j++) {
        t = j / steps;
        // Smoothstep for body continuity
        var u = t * t * (3 - 2 * t);
        out.push(lerpS(p1, p2, u));
      }
    }
    out.push(get(n - 1));
    return out;
  }

  /**
   * Tesla Model 3 — public proportions ≈4694×1849×1443 mm.
   * Game scale ≈ 18.4 L × 7.25 W × 5.5 H. +X forward.
   * Smooth continuous loft (Highland cues: sealed face, thin LEDs, glass roof).
   */
  function buildModel3(THREE, paint, envMap) {
    var g = new THREE.Group();
    var body = carPaint(THREE, paint, envMap);
    var glass = glassMat(THREE, envMap);
    var trim = blackTrim(THREE, envMap);

    // Body shell — smooth beltline from rear bumper to sealed nose
    var bodyCtrl = [
      { x: -9.05, halfW: 2.85, y0: 0.85, y1: 2.15, pinch: 0.92 }, // rear tip
      { x: -8.55, halfW: 3.25, y0: 0.72, y1: 2.55 },
      { x: -7.6, halfW: 3.5, y0: 0.68, y1: 2.95 },
      { x: -6.2, halfW: 3.58, y0: 0.65, y1: 3.15 }, // trunk
      { x: -4.4, halfW: 3.62, y0: 0.62, y1: 3.28 },
      { x: -2.4, halfW: 3.64, y0: 0.6, y1: 3.32 }, // rear door
      { x: -0.4, halfW: 3.64, y0: 0.6, y1: 3.3 }, // B
      { x: 1.6, halfW: 3.62, y0: 0.62, y1: 3.22 }, // front door
      { x: 3.4, halfW: 3.55, y0: 0.65, y1: 3.05 }, // A / cowl
      { x: 5.0, halfW: 3.42, y0: 0.7, y1: 2.7 }, // hood start
      { x: 6.4, halfW: 3.28, y0: 0.75, y1: 2.35 }, // hood mid
      { x: 7.55, halfW: 3.1, y0: 0.82, y1: 2.05 }, // nose
      { x: 8.45, halfW: 2.85, y0: 0.9, y1: 1.75, pinch: 0.95 }, // front tip
      { x: 8.85, halfW: 2.45, y0: 0.95, y1: 1.55, pinch: 0.88 }, // sealed face
    ];
    var hull = loftBody(THREE, densifyStations(bodyCtrl, 4), body, 40);
    g.add(hull);

    // Greenhouse / panoramic roof — soft teardrop, continuous with body
    var greenCtrl = [
      { x: -5.4, halfW: 3.05, y0: 3.05, y1: 4.15, pinch: 0.96 },
      { x: -4.0, halfW: 3.18, y0: 3.1, y1: 4.75 },
      { x: -2.2, halfW: 3.25, y0: 3.15, y1: 5.15 },
      { x: -0.4, halfW: 3.28, y0: 3.18, y1: 5.28 }, // roof peak
      { x: 1.4, halfW: 3.22, y0: 3.12, y1: 5.15 },
      { x: 3.0, halfW: 3.05, y0: 3.0, y1: 4.65 },
      { x: 4.3, halfW: 2.75, y0: 2.85, y1: 3.95 }, // into windshield
      { x: 5.1, halfW: 2.35, y0: 2.7, y1: 3.35, pinch: 0.9 },
    ];
    var green = loftBody(THREE, densifyStations(greenCtrl, 4), glass, 36);
    g.add(green);

    // Soft rocker cladding (thin, follows sill)
    g.add(mesh(THREE, new THREE.BoxGeometry(15.6, 0.32, 7.05), trim, 0.0, 0.88, 0));

    // Sealed front fascia — subtle curves via thin layers
    g.add(mesh(THREE, new THREE.BoxGeometry(0.55, 0.95, 5.9), body, 8.55, 1.55, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.4, 0.35, 6.1), trim, 8.65, 0.95, 0));

    // Highland thin LED headlights
    var hl = lightMat(THREE, 0xf8faff, 4.5);
    var hlL = mesh(THREE, new THREE.BoxGeometry(0.14, 0.14, 1.85), hl, 8.72, 2.05, 2.15);
    var hlR = mesh(THREE, new THREE.BoxGeometry(0.14, 0.14, 1.85), hl, 8.72, 2.05, -2.15);
    g.add(hlL);
    g.add(hlR);
    var amber = lightMat(THREE, 0xffa020, 1.3);
    g.add(mesh(THREE, new THREE.BoxGeometry(0.1, 0.12, 0.28), amber, 8.5, 1.85, 3.25));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.1, 0.12, 0.28), amber, 8.5, 1.85, -3.25));

    // Slim black pillars (not full-width slabs)
    g.add(mesh(THREE, new THREE.BoxGeometry(0.28, 1.55, 0.55), trim, 3.55, 3.95, 2.95, 0, 0, -0.35));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.28, 1.55, 0.55), trim, 3.55, 3.95, -2.95, 0, 0, 0.35));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.26, 1.65, 0.5), trim, 0.15, 4.05, 3.05));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.26, 1.65, 0.5), trim, 0.15, 4.05, -3.05));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.28, 1.45, 0.5), trim, -3.7, 3.95, 2.95, 0, 0, 0.3));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.28, 1.45, 0.5), trim, -3.7, 3.95, -2.95, 0, 0, -0.3));

    // Raked windshield / rear glass as thin shells
    g.add(mesh(THREE, new THREE.BoxGeometry(3.2, 1.55, 5.6), glass, 3.85, 3.85, 0, 0, 0, -0.48));
    g.add(mesh(THREE, new THREE.BoxGeometry(2.7, 1.3, 5.5), glass, -5.15, 3.85, 0, 0, 0, 0.42));

    // Continuous LED tail light bar
    var tl = lightMat(THREE, 0xff0a18, 3.8);
    var tail = mesh(THREE, new THREE.BoxGeometry(0.12, 0.18, 6.35), tl, -8.95, 2.25, 0);
    g.add(tail);
    g.add(
      mesh(
        THREE,
        new THREE.BoxGeometry(0.08, 0.32, 6.4),
        new THREE.MeshBasicMaterial({ color: 0xff1828, transparent: true, opacity: 0.3 }),
        -8.88,
        2.25,
        0
      )
    );

    // Soft rear bumper volume
    g.add(mesh(THREE, new THREE.BoxGeometry(1.0, 0.95, 6.6), body, -8.65, 1.45, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.7, 0.35, 6.5), trim, -8.8, 0.9, 0));

    // Flush door handles
    g.add(mesh(THREE, new THREE.BoxGeometry(0.75, 0.08, 0.1), trim, 1.55, 2.65, 3.55));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.75, 0.08, 0.1), trim, 1.55, 2.65, -3.55));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.75, 0.08, 0.1), trim, -1.55, 2.65, 3.55));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.75, 0.08, 0.1), trim, -1.55, 2.65, -3.55));

    // Subtle door gaps
    var gap = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 });
    g.add(mesh(THREE, new THREE.BoxGeometry(0.03, 1.45, 7.0), gap, 2.45, 2.15, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.03, 1.45, 7.0), gap, -0.65, 2.15, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.03, 1.3, 7.0), gap, -3.65, 2.1, 0));

    // Side mirrors — compact
    g.add(mesh(THREE, new THREE.BoxGeometry(0.55, 0.08, 0.08), trim, 2.65, 3.45, 3.5));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.42, 0.28, 0.72), body, 2.3, 3.45, 3.85));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.55, 0.08, 0.08), trim, 2.65, 3.45, -3.5));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.42, 0.28, 0.72), body, 2.3, 3.45, -3.85));

    // Charge port
    g.add(mesh(THREE, new THREE.CircleGeometry(0.38, 20), trim, -5.0, 2.4, 3.55, 0, Math.PI / 2, 0));

    // Autopilot nub
    g.add(mesh(THREE, new THREE.SphereGeometry(0.1, 10, 10), trim, 8.35, 2.25, 0));

    // Contact shadow
    var shadow = new THREE.Mesh(
      new THREE.CircleGeometry(6.2, 48),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    g.add(shadow);

    // Wheelbase ≈ 2.875 m → game ≈ 9.0; track width ≈ 6.4
    addWheels(
      THREE,
      g,
      [
        { x: 4.65, y: 1.12, z: 3.15 },
        { x: 4.65, y: 1.12, z: -3.15 },
        { x: -4.25, y: 1.12, z: 3.15 },
        { x: -4.25, y: 1.12, z: -3.15 },
      ],
      1.18,
      0.9
    );

    // Soft arch lips (thin, body color)
    g.add(mesh(THREE, new THREE.BoxGeometry(2.5, 0.55, 0.22), body, 4.65, 1.85, 3.45));
    g.add(mesh(THREE, new THREE.BoxGeometry(2.5, 0.55, 0.22), body, 4.65, 1.85, -3.45));
    g.add(mesh(THREE, new THREE.BoxGeometry(2.5, 0.55, 0.22), body, -4.25, 1.85, 3.45));
    g.add(mesh(THREE, new THREE.BoxGeometry(2.5, 0.55, 0.22), body, -4.25, 1.85, -3.45));

    g.userData.headlights = [hlL, hlR];
    g.userData.taillight = tail;
    g.userData.style = "model3";
    g.userData.modelName = "Model 3";
    return g;
  }

  var TRAFFIC_PAINTS = {
    bus: [0xe8e0c8, 0xd4a820, 0x2a6fd4, 0xc03040],
    truck: [0xf0f0f0, 0x3a7acc, 0x4a5058, 0xc47820],
    van: [0xe8ecf0, 0x5c6168, 0x1a3a6e, 0xa01820],
    sedan: [0x2a2e34, 0xb0b4b8, 0x8b1020, 0x4a9a48],
  };

  /** City bus — long box body you must weave past */
  function buildBus(THREE, paint, envMap) {
    var g = new THREE.Group();
    var body = carPaint(THREE, paint, envMap);
    var glass = glassMat(THREE, envMap);
    var trim = blackTrim(THREE, envMap);
    // Main coach body
    g.add(mesh(THREE, new THREE.BoxGeometry(22, 5.2, 7.2), body, 0, 3.4, 0));
    // Rounded nose / tail caps
    g.add(mesh(THREE, new THREE.BoxGeometry(2.2, 4.6, 6.8), body, 11.2, 3.2, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(2.0, 4.4, 6.6), body, -11.0, 3.1, 0));
    // Windows band
    g.add(mesh(THREE, new THREE.BoxGeometry(18, 1.8, 7.35), glass, 0.5, 4.6, 0));
    // Windshield
    g.add(mesh(THREE, new THREE.BoxGeometry(0.2, 2.4, 6.4), glass, 12.1, 4.2, 0));
    // Destination board
    g.add(mesh(THREE, new THREE.BoxGeometry(0.15, 0.9, 5.5), trim, 12.2, 5.6, 0));
    // Doors
    g.add(mesh(THREE, new THREE.BoxGeometry(2.8, 3.6, 0.15), glass, 4.5, 2.8, 3.65));
    g.add(mesh(THREE, new THREE.BoxGeometry(2.8, 3.6, 0.15), glass, -2.5, 2.8, 3.65));
    // Roof A/C
    g.add(mesh(THREE, new THREE.BoxGeometry(8, 0.7, 4.5), trim, -1, 6.2, 0));
    // Wheels (6)
    addWheels(
      THREE,
      g,
      [
        { x: 7.5, y: 1.15, z: 3.1 },
        { x: 7.5, y: 1.15, z: -3.1 },
        { x: 0, y: 1.15, z: 3.1 },
        { x: 0, y: 1.15, z: -3.1 },
        { x: -7.5, y: 1.15, z: 3.1 },
        { x: -7.5, y: 1.15, z: -3.1 },
      ],
      1.15,
      0.85
    );
    g.userData.style = "bus";
    g.userData.modelName = "City Bus";
    return g;
  }

  /** Box truck / lorry */
  function buildTruck(THREE, paint, envMap) {
    var g = new THREE.Group();
    var body = carPaint(THREE, paint, envMap);
    var glass = glassMat(THREE, envMap);
    var trim = blackTrim(THREE, envMap);
    var cargo = new THREE.MeshStandardMaterial({
      color: 0xe8e4d8,
      roughness: 0.75,
      metalness: 0.15,
      envMap: envMap || null,
      envMapIntensity: 0.35,
    });
    // Cab
    g.add(mesh(THREE, new THREE.BoxGeometry(6.5, 4.2, 6.8), body, 6.5, 3.0, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.15, 2.2, 6.0), glass, 9.7, 3.6, 0));
    // Cargo box
    g.add(mesh(THREE, new THREE.BoxGeometry(14, 5.5, 7.0), cargo, -3.5, 3.6, 0));
    // Chassis rails
    g.add(mesh(THREE, new THREE.BoxGeometry(20, 0.5, 5.5), trim, 0, 1.0, 0));
    // Exhaust stack
    g.add(mesh(THREE, new THREE.CylinderGeometry(0.25, 0.28, 4.5, 8), trim, 4.5, 5.5, -2.8));
    addWheels(
      THREE,
      g,
      [
        { x: 6.2, y: 1.1, z: 3.0 },
        { x: 6.2, y: 1.1, z: -3.0 },
        { x: -5.5, y: 1.1, z: 3.0 },
        { x: -5.5, y: 1.1, z: -3.0 },
        { x: -8.5, y: 1.1, z: 3.0 },
        { x: -8.5, y: 1.1, z: -3.0 },
      ],
      1.2,
      0.9
    );
    g.userData.style = "truck";
    g.userData.modelName = "Box Truck";
    return g;
  }

  /** Delivery van */
  function buildVan(THREE, paint, envMap) {
    var g = new THREE.Group();
    var body = carPaint(THREE, paint, envMap);
    var glass = glassMat(THREE, envMap);
    var trim = blackTrim(THREE, envMap);
    g.add(mesh(THREE, new THREE.BoxGeometry(14, 4.8, 6.4), body, 0, 3.1, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.15, 2.0, 5.6), glass, 7.0, 3.5, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(5, 1.6, 6.55), glass, 2.5, 4.4, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(3.2, 3.2, 0.12), glass, 1.5, 2.6, 3.25));
    g.add(mesh(THREE, new THREE.BoxGeometry(12, 0.35, 6.6), trim, 0, 0.85, 0));
    addWheels(
      THREE,
      g,
      [
        { x: 4.2, y: 1.05, z: 2.85 },
        { x: 4.2, y: 1.05, z: -2.85 },
        { x: -4.0, y: 1.05, z: 2.85 },
        { x: -4.0, y: 1.05, z: -2.85 },
      ],
      1.05,
      0.85
    );
    g.userData.style = "van";
    g.userData.modelName = "Delivery Van";
    return g;
  }

  /** Compact traffic sedan (not Model 3 fleet) */
  function buildSedan(THREE, paint, envMap) {
    var g = new THREE.Group();
    var body = carPaint(THREE, paint, envMap);
    var glass = glassMat(THREE, envMap);
    var trim = blackTrim(THREE, envMap);
    g.add(mesh(THREE, new THREE.BoxGeometry(15, 2.4, 6.2), body, 0.2, 1.9, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(8.5, 1.8, 5.8), body, -0.5, 3.4, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(7.5, 1.4, 5.9), glass, -0.3, 3.5, 0));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.15, 1.3, 5.2), glass, 3.8, 3.2, 0, 0, 0, -0.35));
    g.add(mesh(THREE, new THREE.BoxGeometry(14, 0.3, 6.4), trim, 0, 0.75, 0));
    // Lights
    var hl = lightMat(THREE, 0xf8faff, 3.5);
    g.add(mesh(THREE, new THREE.BoxGeometry(0.2, 0.35, 1.4), hl, 7.6, 1.7, 1.9));
    g.add(mesh(THREE, new THREE.BoxGeometry(0.2, 0.35, 1.4), hl, 7.6, 1.7, -1.9));
    addWheels(
      THREE,
      g,
      [
        { x: 4.3, y: 1.0, z: 2.7 },
        { x: 4.3, y: 1.0, z: -2.7 },
        { x: -4.0, y: 1.0, z: 2.7 },
        { x: -4.0, y: 1.0, z: -2.7 },
      ],
      1.0,
      0.8
    );
    g.userData.style = "sedan";
    g.userData.modelName = "Traffic Sedan";
    return g;
  }

  /**
   * @param {number} colorHex - from race engine (or ignored for factory paint)
   * @param {number} kartId
   * @param {THREE.CubeTexture} envMap
   * @param {object} [opts] vehicleType: model3|bus|truck|van|sedan
   */
  function makeVehicle(colorHex, kartId, envMap, opts) {
    var THREE = root.THREE;
    if (!THREE) throw new Error("THREE required");
    opts = opts || {};
    var vType = opts.vehicleType || "model3";
    var paint;
    var mesh;

    if (vType === "model3" || !vType) {
      paint = opts.forcePaint != null ? opts.forcePaint : paintForKart(kartId);
      if (opts.useEngineColor) paint = paintForColor(colorHex);
      mesh = buildModel3(THREE, paint, envMap);
      mesh.scale.multiplyScalar(0.98);
      mesh.userData.paintName = MODEL3_PAINTS[kartId % MODEL3_PAINTS.length].name;
    } else {
      var palette = TRAFFIC_PAINTS[vType] || TRAFFIC_PAINTS.sedan;
      paint =
        opts.forcePaint != null
          ? opts.forcePaint
          : palette[kartId % palette.length];
      if (vType === "bus") mesh = buildBus(THREE, paint, envMap);
      else if (vType === "truck") mesh = buildTruck(THREE, paint, envMap);
      else if (vType === "van") mesh = buildVan(THREE, paint, envMap);
      else mesh = buildSedan(THREE, paint, envMap);
      mesh.scale.multiplyScalar(0.95);
      mesh.userData.paintName = vType;
    }

    mesh.userData.paint = paint;
    mesh.userData.envMap = envMap;
    mesh.userData.vehicleType = vType;

    var glow = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 4.2, 0.2, 20),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.0 })
    );
    glow.position.y = 0.15;
    mesh.add(glow);
    mesh.userData.glow = glow;
    mesh.userData.thrusters = [];
    return mesh;
  }

  function spinWheels(mesh, speed, dt) {
    if (!mesh || !mesh.userData.wheels) return;
    var ang = (speed / 11) * dt;
    var i, w;
    for (i = 0; i < mesh.userData.wheels.length; i++) {
      w = mesh.userData.wheels[i];
      if (w.userData.spin) w.userData.spin.rotation.x += ang;
      else w.rotation.x += ang;
    }
  }

  function setBoostVisual(mesh, boosting) {
    if (!mesh || !mesh.userData.glow) return;
    mesh.userData.glow.material.opacity = boosting ? 0.4 : 0.0;
    mesh.userData.glow.material.color.setHex(boosting ? 0x44ddff : 0x66ccff);
    if (mesh.userData.headlights) {
      mesh.userData.headlights.forEach(function (h) {
        if (h.material && h.material.emissiveIntensity != null) {
          h.material.emissiveIntensity = boosting ? 5.5 : 3.5;
        }
      });
    }
  }

  var api = {
    makeVehicle: makeVehicle,
    makeEnvMap: makeEnvMap,
    spinWheels: spinWheels,
    setBoostVisual: setBoostVisual,
    buildModel3: buildModel3,
    buildBus: buildBus,
    buildTruck: buildTruck,
    buildVan: buildVan,
    buildSedan: buildSedan,
    BODY_STYLES: BODY_STYLES,
    MODEL3_PAINTS: MODEL3_PAINTS,
    TRAFFIC_PAINTS: TRAFFIC_PAINTS,
    paintForKart: paintForKart,
  };

  root.NeoKartVehicles = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
