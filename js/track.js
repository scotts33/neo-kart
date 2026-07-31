/**
 * Neon Circuit 2026 — multi-city tracks with elevation (ramps/bridges)
 * and landmark metadata. World plane X/Z; height is Z elev (sim: waypoint.z).
 */
(function (root) {
  "use strict";

  function clonePts(arr) {
    return arr.map(function (p) {
      return { x: p.x, y: p.y, z: p.z || 0 };
    });
  }

  function boxesAlong(waypoints, ids, offsets) {
    var out = [];
    var i;
    for (i = 0; i < ids.length; i++) {
      var idx = Math.floor((i + 1) * (waypoints.length / (ids.length + 1))) % waypoints.length;
      var w = waypoints[idx];
      var off = offsets && offsets[i] != null ? offsets[i] : (i % 2 === 0 ? 22 : -22);
      var n = waypoints[(idx + 1) % waypoints.length];
      var ang = Math.atan2(n.y - w.y, n.x - w.x);
      var nx = Math.cos(ang + Math.PI / 2);
      var ny = Math.sin(ang + Math.PI / 2);
      out.push({
        x: w.x + nx * off,
        y: w.y + ny * off,
        z: w.z || 0,
        id: ids[i],
      });
    }
    return out;
  }

  /** Smooth closed loop; interpolates x, y, z. */
  function densify(ctrl, samplesPerSeg) {
    samplesPerSeg = samplesPerSeg || 5;
    var n = ctrl.length;
    var out = [];
    var i, j, t, p0, p1, p2, p3, tt, ttt, x, y, z;
    function get(p) {
      return { x: p.x, y: p.y, z: p.z || 0 };
    }
    for (i = 0; i < n; i++) {
      p0 = get(ctrl[(i - 1 + n) % n]);
      p1 = get(ctrl[i]);
      p2 = get(ctrl[(i + 1) % n]);
      p3 = get(ctrl[(i + 2) % n]);
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

  // Elevation helpers for readable course design
  var G = 0; // ground
  var R = 14; // ramp mid
  var B = 28; // bridge deck
  var H = 40; // high flyover
  var J = 62; // long-jump apex (airborne hang)

  /**
   * Tokyo — bay bridge + LONG JUMP over the park + elevated expressway.
   * Landmarks sit at fractions matching the blurb.
   */
  var NEO_TOKYO_CTRL = [
    { x: 300, y: 140, z: G }, // start / tower view
    { x: 420, y: 90, z: G },
    { x: 560, y: 80, z: G },
    { x: 680, y: 110, z: R }, // ramp onto Rainbow Bridge
    { x: 760, y: 180, z: B },
    { x: 820, y: 280, z: B }, // long bay span
    { x: 830, y: 400, z: B },
    { x: 780, y: 510, z: B },
    { x: 660, y: 580, z: R }, // off bridge
    { x: 520, y: 620, z: G }, // shrine approach / launch straight
    { x: 430, y: 610, z: 10 }, // long-jump launch lip
    { x: 340, y: 580, z: 32 }, // takeoff
    { x: 250, y: 520, z: J }, // LONG JUMP apex
    { x: 170, y: 440, z: J }, // hang time
    { x: 110, y: 360, z: 38 }, // landing approach
    { x: 90, y: 280, z: R }, // touchdown
    { x: 140, y: 180, z: G },
    { x: 240, y: 120, z: G },
  ];

  /**
   * Dubai — desert highway, sky highway, LONG JUMP over dunes to marina.
   */
  var DUBAI_CTRL = [
    { x: 140, y: 260, z: G }, // dunes / open desert
    { x: 280, y: 140, z: G },
    { x: 460, y: 70, z: G },
    { x: 640, y: 90, z: R }, // onto sky highway
    { x: 760, y: 160, z: B },
    { x: 860, y: 280, z: H }, // long elevated (Burj views)
    { x: 880, y: 420, z: H },
    { x: 820, y: 540, z: B },
    { x: 700, y: 620, z: R },
    { x: 560, y: 670, z: G }, // launch straight
    { x: 460, y: 680, z: 12 }, // long-jump launch
    { x: 360, y: 660, z: 36 }, // takeoff
    { x: 250, y: 600, z: J }, // LONG JUMP over dunes
    { x: 160, y: 520, z: 42 }, // hang
    { x: 90, y: 400, z: R }, // landing
    { x: 80, y: 260, z: G },
  ];

  /**
   * Shanghai — twin river crossings + LONG JUMP over the Huangpu gap.
   */
  var SHANGHAI_CTRL = [
    { x: 340, y: 70, z: G }, // Bund waterfront start
    { x: 500, y: 70, z: G },
    { x: 640, y: 100, z: R }, // ramp bridge 1
    { x: 760, y: 180, z: B }, // river bridge A
    { x: 830, y: 300, z: B },
    { x: 820, y: 420, z: R }, // down
    { x: 700, y: 540, z: G }, // Pearl / Pudong skyline side
    { x: 560, y: 620, z: G },
    { x: 420, y: 650, z: 8 }, // long-jump launch
    { x: 300, y: 640, z: 34 }, // takeoff
    { x: 190, y: 580, z: J }, // LONG JUMP over river gap
    { x: 100, y: 480, z: 44 }, // hang
    { x: 50, y: 360, z: B }, // land onto bridge deck B
    { x: 70, y: 240, z: R },
    { x: 180, y: 110, z: G },
    { x: 280, y: 70, z: G },
  ];

  /**
   * Atlantic Arc — suspension midspan + LONG JUMP off the waterfront elevate.
   */
  var RED_ROCK_CTRL = [
    { x: 120, y: 200, z: G },
    { x: 260, y: 100, z: G },
    { x: 420, y: 60, z: R },
    { x: 580, y: 80, z: B },
    { x: 720, y: 160, z: H },
    { x: 840, y: 300, z: H },
    { x: 860, y: 460, z: B },
    { x: 760, y: 580, z: R },
    { x: 600, y: 660, z: G },
    { x: 480, y: 700, z: 10 },
    { x: 360, y: 690, z: 32 },
    { x: 240, y: 620, z: J },
    { x: 140, y: 500, z: 40 },
    { x: 90, y: 360, z: R },
    { x: 100, y: 240, z: G },
  ];

  var HARBOR_CTRL = [
    { x: 280, y: 100, z: G },
    { x: 450, y: 70, z: G },
    { x: 620, y: 90, z: R },
    { x: 760, y: 160, z: B }, // onto suspension span
    { x: 860, y: 260, z: H }, // midspan peak (towers)
    { x: 880, y: 400, z: H },
    { x: 820, y: 540, z: B },
    { x: 680, y: 620, z: R },
    { x: 520, y: 670, z: G }, // ferry / pier
    { x: 380, y: 660, z: 10 }, // long-jump launch
    { x: 280, y: 620, z: 34 }, // takeoff
    { x: 170, y: 540, z: J }, // LONG JUMP over harbor
    { x: 90, y: 420, z: 40 }, // hang
    { x: 70, y: 300, z: R }, // landing on elevated run
    { x: 120, y: 180, z: G }, // statue harbor approach
    { x: 240, y: 100, z: G },
  ];

  var COURSES = {
    "neo-tokyo": {
      id: "neo-tokyo",
      name: "Rainbow Bridge Run",
      city: "Tokyo",
      blurb:
        "Climb the bay bridge, nail the long jump over the park, weave city buses, and race past Tokyo Tower.",
      difficulty: "Medium",
      numLaps: 6,
      numTraffic: 10,
      weather: "clear",
      halfWidth: 50,
      worldW: 900,
      worldH: 740,
      theme: {
        timeOfDay: "day",
        skyTop: 0x4aa3ff,
        skyZenith: 0x1a6fd4,
        skyHorizon: 0xc8e4ff,
        skyBottom: 0xe8f2ff,
        fog: 0xd0e4f5,
        fogNear: 220,
        fogFar: 1100,
        asphalt: 0x4a4e54,
        asphaltEdge: 0xf5f5f0,
        emissive: 0xffcc66,
        accent: 0xe6304a,
        accent2: 0x2a6fd4,
        building: [0xb8c0c8, 0xd0d4d8, 0xa8b0b8, 0xc4c8cc, 0x9aa4ae],
        window: 0x7ec8ff,
        ground: 0x4a9a48,
        groundAlt: 0x5cb054,
        ambient: 0xc8d8e8,
        hemiSky: 0xa8c8ff,
        hemiGround: 0x8a9070,
        dirLight: 0xfff4e0,
        sunColor: 0xfff8e8,
        sunIntensity: 2.4,
        bloomHint: 0xfff0c0,
      },
      ctrl: NEO_TOKYO_CTRL,
      skyline: "dense",
      weather: "clear",
      // Placements: at = fraction along loop; side ±1 off road; span = decorate elevated road
      landmarks: [
        { id: "tokyo-tower", at: 0.02, side: 1, dist: 180 },
        { id: "rainbow-bridge", at: 0.22, side: 0, span: true },
        { id: "torii", at: 0.42, side: -1, dist: 160 },
        { id: "long-jump", at: 0.55, side: 0, span: true },
        { id: "bullet-arch", at: 0.88, side: 1, dist: 150 },
        { id: "bay-water", at: 0.24, side: 0, span: true },
      ],
    },
    dubai: {
      id: "dubai",
      name: "Marina Sky Highway",
      city: "Dubai",
      blurb:
        "Wide desert straights, sky highway, a long dune jump, pass coaches and trucks, Burj and palm views.",
      difficulty: "Easy",
      numLaps: 5,
      numTraffic: 8,
      weather: "clear",
      // Optional dirt shortcut cut (risky lower grip handled in engine via zone)
      shortcut: { at: 0.12, side: -1, dist: 40, grip: 0.72 },
      halfWidth: 58,
      worldW: 940,
      worldH: 780,
      theme: {
        timeOfDay: "day",
        skyTop: 0x5eb0ff,
        skyZenith: 0x2a8ae0,
        skyHorizon: 0xffe8c8,
        skyBottom: 0xfff0d8,
        fog: 0xe8d8c0,
        fogNear: 180,
        fogFar: 1000,
        asphalt: 0x555048,
        asphaltEdge: 0xf0ebe0,
        emissive: 0xffd080,
        accent: 0xd4a017,
        accent2: 0xc47820,
        building: [0xe8e0d0, 0xd0c8b8, 0xf0e8d8, 0xc8c0b0, 0xb8b0a0],
        window: 0xa8d4ff,
        ground: 0xc4a86a,
        groundAlt: 0xd4b87a,
        ambient: 0xffe8c8,
        hemiSky: 0xffe0b0,
        hemiGround: 0xc8a060,
        dirLight: 0xfff0d0,
        sunColor: 0xfffaf0,
        sunIntensity: 2.8,
        bloomHint: 0xffe8a0,
      },
      ctrl: DUBAI_CTRL,
      skyline: "towers",
      weather: "clear",
      landmarks: [
        { id: "dune", at: 0.05, side: -1, dist: 180 },
        { id: "burj", at: 0.28, side: 1, dist: 190 },
        { id: "long-jump", at: 0.58, side: 0, span: true },
        { id: "sail-hotel", at: 0.78, side: -1, dist: 175 },
        { id: "palm-isles", at: 0.9, side: 1, dist: 185 },
      ],
    },
    shanghai: {
      id: "shanghai",
      name: "Bund River Circuit",
      city: "Shanghai",
      blurb:
        "Two river bridges, a long jump over the Huangpu, heavy buses and vans on the Bund — Pearl skyline. Wet grip.",
      difficulty: "Hard",
      numLaps: 8,
      numTraffic: 14,
      weather: "rain",
      halfWidth: 46,
      worldW: 900,
      worldH: 760,
      theme: {
        timeOfDay: "day",
        skyTop: 0x5a9ee8,
        skyZenith: 0x2878c8,
        skyHorizon: 0xd0e8f8,
        skyBottom: 0xe8f4fc,
        fog: 0xd8e8f0,
        fogNear: 200,
        fogFar: 1050,
        asphalt: 0x484c52,
        asphaltEdge: 0xf2f2ea,
        emissive: 0xffaa55,
        accent: 0xc03040,
        accent2: 0x1a7acc,
        building: [0xc0c8d0, 0xd8dce0, 0xa8b0b8, 0xb0b8c0, 0x98a0a8],
        window: 0x90d0ff,
        ground: 0x48a050,
        groundAlt: 0x58b05c,
        ambient: 0xd0e0f0,
        hemiSky: 0xb0d0ff,
        hemiGround: 0x708060,
        dirLight: 0xfff6e8,
        sunColor: 0xfff8f0,
        sunIntensity: 2.35,
        bloomHint: 0xffe8c0,
      },
      ctrl: SHANGHAI_CTRL,
      skyline: "harbor",
      weather: "clear",
      landmarks: [
        { id: "bund-gate", at: 0.05, side: -1, dist: 155 },
        { id: "river", at: 0.18, side: 0, span: true },
        { id: "oriental-pearl", at: 0.38, side: 1, dist: 175 },
        { id: "long-jump", at: 0.55, side: 0, span: true },
        { id: "river", at: 0.72, side: 0, span: true },
        { id: "pagoda", at: 0.9, side: -1, dist: 160 },
      ],
    },
    harbor: {
      id: "harbor",
      name: "Liberty Harbor Run",
      city: "Atlantic Arc",
      blurb:
        "Suspension midspan, long harbor jump, dodge buses and trucks, statue torch and ferry docks.",
      difficulty: "Medium",
      numLaps: 6,
      numTraffic: 11,
      halfWidth: 50,
      worldW: 940,
      worldH: 780,
      theme: {
        timeOfDay: "day",
        skyTop: 0x6ab0ff,
        skyZenith: 0x3a88e0,
        skyHorizon: 0xd8ecff,
        skyBottom: 0xf0f6ff,
        fog: 0xd8e8f5,
        fogNear: 240,
        fogFar: 1200,
        asphalt: 0x4c5056,
        asphaltEdge: 0xf5f5f0,
        emissive: 0xffcc66,
        accent: 0x2a7acc,
        accent2: 0x3a9a60,
        building: [0xd0d6dc, 0xc0c8d0, 0xe0e4e8, 0xb0b8c0, 0xa8b0b8],
        window: 0x88c8ff,
        ground: 0x4a9c52,
        groundAlt: 0x5aac5e,
        ambient: 0xd8e8f8,
        hemiSky: 0xb8d8ff,
        hemiGround: 0x809068,
        dirLight: 0xfff5e8,
        sunColor: 0xfffaf0,
        sunIntensity: 2.5,
        bloomHint: 0xfff0c8,
      },
      ctrl: HARBOR_CTRL,
      skyline: "coast",
      weather: "clear",
      landmarks: [
        { id: "suspension-towers", at: 0.22, side: 0, span: true },
        { id: "long-jump", at: 0.52, side: 0, span: true },
        { id: "ferry", at: 0.68, side: -1, dist: 165 },
        { id: "harbor-crane", at: 0.75, side: 1, dist: 170 },
        { id: "statue-torch", at: 0.92, side: -1, dist: 175 },
        { id: "bay-water", at: 0.26, side: 0, span: true },
      ],
    },
    "neo-tokyo-night": {
      id: "neo-tokyo-night",
      name: "Midnight Express",
      city: "Tokyo Night",
      blurb:
        "Same bay circuit under neon night rain — tighter grip loss in wet, denser traffic, long jump still open.",
      difficulty: "Hard",
      numLaps: 7,
      numTraffic: 12,
      halfWidth: 50,
      worldW: 900,
      worldH: 740,
      weather: "rain",
      theme: {
        timeOfDay: "night",
        skyTop: 0x0a1028,
        skyZenith: 0x060a18,
        skyHorizon: 0x1a2848,
        skyBottom: 0x121820,
        fog: 0x101828,
        fogNear: 120,
        fogFar: 700,
        asphalt: 0x2a2e34,
        asphaltEdge: 0xc8c8c0,
        emissive: 0xff66aa,
        accent: 0xff3a6e,
        accent2: 0x44ddff,
        building: [0x1a2030, 0x242a38, 0x303848, 0x181c28, 0x2c3444],
        window: 0xffcc66,
        ground: 0x1a2820,
        groundAlt: 0x243028,
        ambient: 0x304060,
        hemiSky: 0x203050,
        hemiGround: 0x1a2018,
        dirLight: 0xaabbff,
        sunColor: 0x8899cc,
        sunIntensity: 0.55,
        bloomHint: 0xff66aa,
      },
      ctrl: NEO_TOKYO_CTRL,
      skyline: "dense",
      landmarks: [
        { id: "tokyo-tower", at: 0.02, side: 1, dist: 180 },
        { id: "rainbow-bridge", at: 0.22, side: 0, span: true },
        { id: "torii", at: 0.42, side: -1, dist: 160 },
        { id: "long-jump", at: 0.55, side: 0, span: true },
        { id: "bullet-arch", at: 0.88, side: 1, dist: 150 },
        { id: "bay-water", at: 0.24, side: 0, span: true },
      ],
    },
    /**
     * Red Rock Canyon — new desert mesa circuit: elevation steps + long jump.
     * Distinct layout from Dubai dunes (tighter hairpin mesa, cliff jump).
     */
    "red-rock": {
      id: "red-rock",
      name: "Mesa Breaker",
      city: "Red Rock",
      blurb:
        "Carve red canyon walls, climb the mesa switchbacks, then long-jump the gorge — pure time-trial heaven.",
      difficulty: "Hard",
      numLaps: 5,
      numTraffic: 4,
      halfWidth: 46,
      worldW: 920,
      worldH: 760,
      weather: "clear",
      theme: {
        timeOfDay: "day",
        skyTop: 0x5eb0ff,
        skyZenith: 0x2a78d4,
        skyHorizon: 0xffe0b8,
        skyBottom: 0xffd0a0,
        fog: 0xf0d8c0,
        fogNear: 200,
        fogFar: 1000,
        asphalt: 0x4a4540,
        asphaltEdge: 0xf0e8d8,
        emissive: 0xff8844,
        accent: 0xe85d04,
        accent2: 0xf48c06,
        building: [0xc47840, 0xa06030, 0xd49050, 0x8a5030, 0xb87038],
        window: 0xffcc88,
        ground: 0xc47840,
        groundAlt: 0xa86030,
        ambient: 0xe8d0b0,
        hemiSky: 0xffd0a0,
        hemiGround: 0xa06030,
        dirLight: 0xfff0d0,
        sunColor: 0xffe8c0,
        sunIntensity: 2.6,
        bloomHint: 0xffaa44,
      },
      ctrl: RED_ROCK_CTRL,
      skyline: "mesa",
      landmarks: [
        { id: "long-jump", at: 0.48, side: 0, span: true },
        { id: "harbor-crane", at: 0.15, side: 1, dist: 140 },
        { id: "statue-torch", at: 0.72, side: -1, dist: 150 },
      ],
    },
  };

  var DEFAULT_COURSE_ID = "neo-tokyo";

  function buildCourse(def) {
    // Higher Catmull-Rom density → smoother gameplay path + road projection
    var waypoints = densify(def.ctrl, 12);
    var itemBoxes = boxesAlong(waypoints, ["b0", "b1", "b2", "b3", "b4", "b5", "b6"]);
    return {
      id: def.id,
      name: def.name,
      city: def.city,
      blurb: def.blurb,
      difficulty: def.difficulty,
      waypoints: clonePts(waypoints),
      halfWidth: def.halfWidth,
      width: def.halfWidth * 2,
      itemBoxes: itemBoxes,
      numLaps: def.numLaps != null ? def.numLaps : 6,
      numTraffic: def.numTraffic != null ? def.numTraffic : 6,
      worldW: def.worldW,
      worldH: def.worldH,
      theme: def.theme,
      skyline: def.skyline,
      weather: def.weather || "clear",
      shortcut: def.shortcut || null,
      landmarks: (def.landmarks || []).map(function (lm) {
        if (typeof lm === "string") return { id: lm, at: 0.2, side: 1, dist: 130 };
        return {
          id: lm.id,
          at: lm.at != null ? lm.at : 0.2,
          side: lm.side != null ? lm.side : 1,
          dist: lm.dist != null ? lm.dist : 130,
          span: !!lm.span,
        };
      }),
      ctrl: clonePts(def.ctrl),
    };
  }

  var CACHE = {};

  function listCourses() {
    return Object.keys(COURSES).map(function (id) {
      var d = COURSES[id];
      return {
        id: d.id,
        name: d.name,
        city: d.city,
        blurb: d.blurb,
        difficulty: d.difficulty,
        numLaps: d.numLaps != null ? d.numLaps : 6,
        weather: d.weather || "clear",
        accent: "#" + d.theme.accent.toString(16).padStart(6, "0"),
        accent2: "#" + d.theme.accent2.toString(16).padStart(6, "0"),
      };
    });
  }

  function getTrack(courseId) {
    var id = courseId || DEFAULT_COURSE_ID;
    if (!COURSES[id]) id = DEFAULT_COURSE_ID;
    // Always rebuild from defs so elev/landmark edits apply (dev-friendly)
    CACHE[id] = buildCourse(COURSES[id]);
    var t = CACHE[id];
    return {
      id: t.id,
      name: t.name,
      city: t.city,
      blurb: t.blurb,
      difficulty: t.difficulty,
      waypoints: clonePts(t.waypoints),
      halfWidth: t.halfWidth,
      width: t.width,
      itemBoxes: t.itemBoxes.map(function (b) {
        return { x: b.x, y: b.y, z: b.z || 0, id: b.id };
      }),
      numLaps: t.numLaps,
      numTraffic: t.numTraffic,
      worldW: t.worldW,
      worldH: t.worldH,
      theme: t.theme,
      skyline: t.skyline,
      weather: t.weather,
      shortcut: t.shortcut || null,
      landmarks: (t.landmarks || []).map(function (lm) {
        return {
          id: lm.id,
          at: lm.at,
          side: lm.side,
          dist: lm.dist,
          span: lm.span,
        };
      }),
    };
  }

  function buildPathMetrics(waypoints) {
    var segs = [];
    var cum = [0];
    var total = 0;
    var i, dx, dy, dz, len;
    for (i = 0; i < waypoints.length; i++) {
      var a = waypoints[i];
      var b = waypoints[(i + 1) % waypoints.length];
      dx = b.x - a.x;
      dy = b.y - a.y;
      dz = (b.z || 0) - (a.z || 0);
      len = Math.sqrt(dx * dx + dy * dy + dz * dz * 0.25);
      segs.push(len);
      total += len;
      cum.push(total);
    }
    return { segs: segs, cum: cum, total: total };
  }

  /** Min distance from a world point to the track centerline (planar). */
  function distToTrack(x, y, waypoints) {
    var best = Infinity;
    var i, a, b, abx, aby, apx, apy, ab2, t, cx, cy, d;
    for (i = 0; i < waypoints.length; i++) {
      a = waypoints[i];
      b = waypoints[(i + 1) % waypoints.length];
      abx = b.x - a.x;
      aby = b.y - a.y;
      apx = x - a.x;
      apy = y - a.y;
      ab2 = abx * abx + aby * aby;
      t = ab2 < 1e-9 ? 0 : (apx * abx + apy * aby) / ab2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      cx = a.x + abx * t;
      cy = a.y + aby * t;
      d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d < best) best = d;
    }
    return best;
  }

  var defaultTrack = getTrack(DEFAULT_COURSE_ID);

  var api = {
    getTrack: getTrack,
    listCourses: listCourses,
    buildPathMetrics: buildPathMetrics,
    densify: densify,
    distToTrack: distToTrack,
    DEFAULT_COURSE_ID: DEFAULT_COURSE_ID,
    COURSE_IDS: Object.keys(COURSES),
    WAYPOINTS: defaultTrack.waypoints,
    ITEM_BOXES: defaultTrack.itemBoxes,
    TRACK_HALF_WIDTH: defaultTrack.halfWidth,
    NUM_LAPS_DEFAULT: defaultTrack.numLaps,
    WORLD_W: defaultTrack.worldW,
    WORLD_H: defaultTrack.worldH,
  };

  root.NeoKartTrack = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
