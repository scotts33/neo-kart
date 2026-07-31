/**
 * Neon Circuit 2026 — pure race simulation.
 * All step/drive/item/ranking logic lives here; render/input only read state.
 */
(function (root) {
  "use strict";

  var Track = root.NeoKartTrack;
  if (!Track && typeof require !== "undefined") {
    try {
      Track = require("./track.js");
    } catch (e) {
      Track = null;
    }
  }

  // --- constants ---
  var ACCEL = 280;
  var BRAKE = 360;
  var FRICTION = 0.985;
  var OFFTRACK_FRICTION = 0.94;
  var MAX_SPEED = 220;
  var OFFTRACK_MAX = 95;
  var STEER_RATE = 2.8; // base rad/s; low-speed gets more authority (arcade)
  var STEER_LOW_FRAC = 0.95; // steer mult at standstill
  var STEER_HIGH_FRAC = 0.6; // steer mult at max speed (still readable)
  var REVERSE_MAX = 60;
  var KART_RADIUS = 12;
  /** Collision hull (world units) — matches visual Model 3 footprint */
  var KART_COLLIDE_HALF_LEN = 8.6;
  var KART_COLLIDE_HALF_WID = 3.9;
  var KART_COLLIDE_RADIUS = 9.2; // circle fallback / pair separation
  /** Per vehicle-type collision radius (pass larger buses/trucks carefully) */
  var VEHICLE_COLLIDE = {
    model3: 9.2,
    sedan: 9.0,
    van: 11.0,
    truck: 13.5,
    bus: 16.0,
  };
  var TRAFFIC_TYPES = ["bus", "truck", "van", "sedan", "sedan", "bus"];
  /** Named AI field — paint index into Model 3 palette, aggression scales item/rubber hunger */
  var AI_RIVALS = [
    { name: "MIRA", aggression: 1.2, paintIndex: 1 },
    { name: "VOX", aggression: 1.05, paintIndex: 4 },
    { name: "KAI", aggression: 0.95, paintIndex: 2 },
    { name: "NOVA", aggression: 1.15, paintIndex: 7 },
    { name: "REX", aggression: 1.0, paintIndex: 3 },
    { name: "JET", aggression: 1.1, paintIndex: 5 },
  ];
  var DRAFT_RANGE = 72;
  var DRAFT_CONE = 0.62; // cos(angle) threshold — wider draft cone
  var DRAFT_MAX_BONUS = 0.34; // +34% effective top speed when fully drafting
  var ITEM_BOX_RADIUS = 16;
  var ITEM_PICKUP_COOLDOWN = 0.4;
  var ITEM_BOX_RESPAWN = 4.0;
  /** Roulette spin after box pickup — anticipation before item settles */
  var ITEM_SPIN_DURATION = 1.15;
  var ITEM_SPIN_TICK = 0.09;
  /** Overtake chain window (sec) before chain resets */
  var PASS_CHAIN_WINDOW = 5.5;
  var BOOST_DURATION = 1.2;
  var BOOST_MULT = 1.55;
  var HIT_SLOW_DURATION = 1.0;
  var HIT_SLOW_MULT = 0.35;
  var OIL_DURATION = 12;
  var OIL_RADIUS = 18;
  var OIL_SLOW_DURATION = 0.9;
  var MISSILE_SPEED = 400;
  var MISSILE_RADIUS = 14;
  var MISSILE_LIFE = 4.5;
  var MISSILE_AIR_HEIGHT = 4.5; // base height above road while in flight
  /** Heat-seek: max turn rate (rad/s) and acquisition */
  var MISSILE_TURN_RATE = 5.5;
  var MISSILE_SEEK_RANGE = 420;
  var MISSILE_SEEK_CONE = 0.15; // cos threshold — ~81° forward cone
  var STUN_DURATION = 0.85;
  /** Missile hit: car is destroyed for this long, then reappears (still dazed). */
  var EXPLODE_DURATION = 1.65;
  var EXPLODE_RECOVER = 0.55; // extra no-control after reappear
  /** Drift hold → release mini-boost (addicting corner loop) */
  var DRIFT_MIN_SPEED = 55;
  var DRIFT_FILL_RATE = 0.85; // meter / sec while drifting (snappy arcade fill)
  var DRIFT_DECAY = 0.28;
  var DRIFT_STEER_BONUS = 1.4;
  var DRIFT_SPEED_PENALTY = 0.94;
  var DRIFT_BOOST_THRESHOLD = 0.4;
  var DRIFT_BOOST_DURATION = 0.95;
  var DRIFT_BOOST_MULT = 1.48;
  var SHIELD_DURATION = 4.5;
  var SHOCK_RANGE = 280;
  var SHOCK_STUN = 1.1;
  var RUBBER_BAND_GAP = 180; // path units behind leader before catch-up
  var RUBBER_BAND_MAX = 0.22; // extra top-speed fraction for last place
  /** Difficulty scales AI catch-up (hard = meaner pack, easy = looser) */
  var DIFFICULTY_RUBBER = { easy: 0.72, normal: 1, hard: 1.38 };
  var LAST_LAP_RUBBER = 1.28;
  /** Style / near-miss / comeback addiction loops */
  var NEAR_MISS_DIST = 22;
  var NEAR_MISS_COOLDOWN = 0.85;
  var NEAR_MISS_BOOST = 0.45;
  var STYLE_DECAY = 18; // points/sec
  var COMEBACK_PLACE_MIN = 3; // place >= this gets comeback charge
  var COMEBACK_FILL = 0.12; // /sec while trailing
  var COMEBACK_BOOST_T = 1.35;
  var PERFECT_DRIFT = 0.92; // meter for "PERFECT" release
  var FEVER_MULT = 3.0; // style mult threshold for fever mode
  var FEVER_SPEED_BONUS = 0.08; // extra top speed while fever
  var FEVER_DURATION = 4.5;
  /** EA-style lights ceremony: 3 · 2 · 1 · GO before racing */
  var COUNTDOWN_TOTAL = 3.4;
  var COUNTDOWN_SEG = 0.85; // each light ~0.85s; last GO ~0.85s then race
  /** After player finishes, end race without waiting for every CPU */
  var PLAYER_FINISH_GRACE = 2.5;
  /** Along-track window for shortcut zone (fraction of lap) */
  var SHORTCUT_ALONG_FRAC = 0.055;
  /** Instant-replay ring buffer (~4s at 60fps) */
  var REPLAY_BUFFER_MAX = 240;
  var REPLAY_PLAY_DURATION = 3.6;
  var RIVAL_TAUNTS = [
    "too slow!",
    "eat dust!",
    "see ya!",
    "not today!",
    "outpaced!",
  ];

  var ITEM_TYPES = ["boost", "missile", "oil", "shield", "shock"];

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /**
   * Arcade steer rate: more yaw authority at low speed (hairpins / grid),
   * still solid at top end. Pure helper for tests + driveKart.
   */
  function steerRateAtSpeed(speed, drifting) {
    var speedFrac = clamp(Math.abs(speed) / MAX_SPEED, 0, 1);
    var mult =
      STEER_LOW_FRAC + (STEER_HIGH_FRAC - STEER_LOW_FRAC) * speedFrac;
    var rate = STEER_RATE * mult;
    if (drifting) rate *= DRIFT_STEER_BONUS;
    return rate;
  }

  /**
   * AI rubber-band top-speed multiplier for a trailing racer.
   * Grows with gap, difficulty, and final-lap pressure.
   */
  function rubberBandMult(state, kart) {
    if (!state || !kart || kart.isPlayer || kart.isTraffic) return 1;
    if (state._leaderProgress == null) return 1;
    var gap = state._leaderProgress - (kart.totalProgress || 0);
    if (gap <= RUBBER_BAND_GAP) return 1;
    var band = clamp((gap - RUBBER_BAND_GAP) / (RUBBER_BAND_GAP * 2), 0, 1);
    var max = RUBBER_BAND_MAX;
    var diff = (state.difficulty || "normal").toLowerCase();
    var dScale = DIFFICULTY_RUBBER[diff] != null ? DIFFICULTY_RUBBER[diff] : 1;
    max *= dScale;
    if (state.lastLap) max *= LAST_LAP_RUBBER;
    return 1 + max * band;
  }

  function dist(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function angleTo(fromX, fromY, toX, toY) {
    return Math.atan2(toY - fromY, toX - fromX);
  }

  function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /** Distance from point to segment; returns {dist, t, px, py}. */
  function pointToSegment(px, py, ax, ay, bx, by) {
    var abx = bx - ax;
    var aby = by - ay;
    var apx = px - ax;
    var apy = py - ay;
    var ab2 = abx * abx + aby * aby;
    var t = ab2 < 1e-9 ? 0 : (apx * abx + apy * aby) / ab2;
    t = clamp(t, 0, 1);
    var cx = ax + abx * t;
    var cy = ay + aby * t;
    return { dist: dist(px, py, cx, cy), t: t, px: cx, py: cy };
  }

  /**
   * Closest point on closed centerline + signed progress along path [0, total).
   * opts:
   *   preferSeg — bias search near this segment (stops bridge/jump elev teleport)
   *   preferElev — penalize segments far from current height
   *   segWindow — half-width of segment search around preferSeg
   *   elevWeight — cost per unit elev mismatch
   */
  function projectOnTrack(x, y, waypoints, metrics, opts) {
    opts = opts || {};
    var n = waypoints.length;
    // Prefer caller-owned bag (kart._proj) to avoid GC in hot path
    var out = opts.out || {
      dist: 0,
      seg: 0,
      t: 0,
      px: 0,
      py: 0,
      elev: 0,
      progress: 0,
    };
    if (!n) {
      out.dist = 0;
      out.seg = 0;
      out.t = 0;
      out.px = x;
      out.py = y;
      out.elev = 0;
      out.progress = 0;
      return out;
    }
    var preferSeg = opts.preferSeg;
    var preferElev = opts.preferElev;
    var elevWeight = opts.elevWeight != null ? opts.elevWeight : 0.4;
    var window =
      opts.segWindow != null
        ? opts.segWindow
        : preferSeg != null
          ? 18
          : n;
    var bestScore = Infinity;
    var found = false;
    var i, idx, a, b, r, prog, elev, score, count, start;

    function consider(segIdx) {
      a = waypoints[segIdx];
      b = waypoints[(segIdx + 1) % n];
      r = pointToSegment(x, y, a.x, a.y, b.x, b.y);
      elev = (a.z || 0) * (1 - r.t) + (b.z || 0) * r.t;
      score = r.dist;
      if (preferElev != null && isFinite(preferElev)) {
        score += elevWeight * Math.abs(elev - preferElev);
      }
      if (score < bestScore) {
        bestScore = score;
        prog = metrics.cum[segIdx] + metrics.segs[segIdx] * r.t;
        out.dist = r.dist;
        out.seg = segIdx;
        out.t = r.t;
        out.px = r.px;
        out.py = r.py;
        out.elev = elev;
        out.progress = prog % metrics.total;
        found = true;
      }
    }

    if (preferSeg != null && window < n) {
      start = preferSeg - window;
      count = window * 2 + 1;
      for (i = 0; i < count; i++) {
        idx = ((start + i) % n + n) % n;
        consider(idx);
      }
      // Lost the ribbon — fall back to full scan with elev bias
      if (!found || out.dist > (opts.loseDist != null ? opts.loseDist : 160)) {
        bestScore = Infinity;
        found = false;
        for (i = 0; i < n; i++) consider(i);
      }
    } else {
      for (i = 0; i < n; i++) consider(i);
    }
    return out;
  }

  /** Road surface Y: waypoint elev + thin asphalt deck offset. */
  var ROAD_SURFACE_PAD = 0.1;

  /**
   * Snap kart to road: lateral bounds + elevation + pitch.
   * Prevents falling through bridges / long-jump decks.
   */
  function stickToRoad(kart, state, dt) {
    dt = dt != null ? dt : 1 / 60;
    var wps = state.track.waypoints;
    var metrics = state.metrics;
    var hw = state.track.halfWidth;
    if (!kart._proj) {
      kart._proj = {
        dist: 0,
        seg: 0,
        t: 0,
        px: 0,
        py: 0,
        elev: 0,
        progress: 0,
      };
    }
    var proj = projectOnTrack(kart.x, kart.y, wps, metrics, {
      preferSeg: kart.checkpoint,
      preferElev: kart.elev,
      segWindow: 18,
      elevWeight: 0.55,
      loseDist: hw * 2.5,
      out: kart._proj,
    });

    // Soft shoulder then hard wall — never leave the carriageway ribbon
    var soft = hw * 0.8;
    var hard = hw * 0.96;
    var dx = proj.px - kart.x;
    var dy = proj.py - kart.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = dx / d;
    var ny = dy / d;

    if (proj.dist > hard) {
      // Hard clamp onto road surface
      var excess = proj.dist - hard;
      kart.x += nx * excess;
      kart.y += ny * excess;
      var vn = kart.vx * nx + kart.vy * ny;
      if (vn < 0) {
        kart.vx -= nx * vn;
        kart.vy -= ny * vn;
        kart.speed = kart.vx * Math.cos(kart.angle) + kart.vy * Math.sin(kart.angle);
      }
      kart.speed *= 0.84;
      proj = projectOnTrack(kart.x, kart.y, wps, metrics, {
        preferSeg: proj.seg,
        preferElev: kart.elev,
        segWindow: 14,
        elevWeight: 0.55,
        out: kart._proj,
      });
      dx = proj.px - kart.x;
      dy = proj.py - kart.y;
      d = Math.sqrt(dx * dx + dy * dy) || 1;
      nx = dx / d;
      ny = dy / d;
    } else if (proj.dist > soft) {
      // Soft nudge toward center before the wall
      var edgeT = (proj.dist - soft) / Math.max(0.01, hard - soft);
      edgeT = clamp(edgeT, 0, 1);
      var pushAmt = (proj.dist - soft) * (0.18 + edgeT * 0.45);
      kart.x += nx * pushAmt;
      kart.y += ny * pushAmt;
      var vn2 = kart.vx * nx + kart.vy * ny;
      if (vn2 < 0) {
        kart.vx -= nx * vn2 * (0.35 + edgeT * 0.55);
        kart.vy -= ny * vn2 * (0.35 + edgeT * 0.55);
        kart.speed = kart.vx * Math.cos(kart.angle) + kart.vy * Math.sin(kart.angle);
      }
    }

    // Elevation — follow deck; reject teleports through overlapping layers
    var surface = (proj.elev || 0) + ROAD_SURFACE_PAD;
    var prevElev = kart.elev != null ? kart.elev : surface;
    var de = surface - prevElev;
    var maxRate = 95; // world-units / second vertical follow
    var maxStep = maxRate * dt;
    // Allow fast snap only when still close in height (same deck)
    if (Math.abs(de) > 28) {
      // Likely wrong segment — re-search with stronger elev lock
      proj = projectOnTrack(kart.x, kart.y, wps, metrics, {
        preferSeg: kart.checkpoint,
        preferElev: prevElev,
        segWindow: 28,
        elevWeight: 1.2,
        loseDist: hw * 4,
        out: kart._proj,
      });
      surface = (proj.elev || 0) + ROAD_SURFACE_PAD;
      de = surface - prevElev;
      if (Math.abs(de) > 28) {
        // Still far: stick to previous elev, only nudge toward surface slowly
        de = clamp(de, -maxStep * 0.35, maxStep * 0.35);
      }
    }
    if (Math.abs(de) > maxStep) de = de > 0 ? maxStep : -maxStep;
    kart.elev = prevElev + de;

    // Pitch from local path grade (look along a few segments)
    var n = wps.length;
    var seg = proj.seg;
    var a = wps[seg];
    var b = wps[(seg + 1) % n];
    var c = wps[(seg + 2) % n];
    var len1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    var len2 = Math.hypot(c.x - b.x, c.y - b.y) || 1;
    var g1 = ((b.z || 0) - (a.z || 0)) / len1;
    var g2 = ((c.z || 0) - (b.z || 0)) / len2;
    var grade = g1 * 0.65 + g2 * 0.35;
    var pitchTarget = Math.atan(grade);
    pitchTarget = clamp(pitchTarget, -0.55, 0.55);
    if (kart.pitch == null) kart.pitch = pitchTarget;
    else kart.pitch = kart.pitch * 0.72 + pitchTarget * 0.28;

    // Keep AI checkpoint coherent with ribbon
    if (kart.checkpoint == null) kart.checkpoint = proj.seg;
    // Don't leap checkpoint more than window (avoids lap glitches)
    var jump = Math.abs(proj.seg - kart.checkpoint);
    if (jump > n / 2) jump = n - jump;
    if (jump <= 30) kart.checkpoint = proj.seg;

    kart._roadProj = proj;
    return proj;
  }

  function sampleKartElev(kart, state) {
    // Back-compat: full stick without dt (used by older call sites)
    stickToRoad(kart, state, 1 / 60);
    return kart.elev;
  }

  function pushInsideTrack(kart, state) {
    return stickToRoad(kart, state, 1 / 60);
  }

  function emptyInput() {
    return {
      accel: false,
      brake: false,
      left: false,
      right: false,
      useItem: false,
      drift: false,
    };
  }

  function pushEvent(state, type, data) {
    if (!state.events) state.events = [];
    state.events.push(data ? { type: type, data: data } : type);
  }

  function vehicleCollideRadius(kart) {
    var t = (kart && kart.vehicleType) || "model3";
    return VEHICLE_COLLIDE[t] != null ? VEHICLE_COLLIDE[t] : KART_COLLIDE_RADIUS;
  }

  function createKart(id, isPlayer, x, y, angle, color, extra) {
    extra = extra || {};
    var vType = extra.vehicleType || (extra.isTraffic ? "sedan" : "model3");
    return {
      id: id,
      isPlayer: !!isPlayer,
      isTraffic: !!extra.isTraffic,
      // +1 = race direction (waypoint index increases), -1 = oncoming
      direction: extra.direction != null ? extra.direction : 1,
      vehicleType: vType,
      // Traffic speed cap multiplier (slower buses/trucks to pass)
      speedCap: extra.speedCap != null ? extra.speedCap : 1,
      x: x,
      y: y,
      elev: 0,
      pitch: 0, // road grade (radians), nose-up positive
      angle: angle,
      speed: 0,
      vx: 0,
      vy: 0,
      item: null,
      boostT: 0,
      slowT: 0,
      stunT: 0,
      explodedT: 0, // >0 = temporarily blown up (missile)
      shieldT: 0,
      // Drift meter 0..1
      driftMeter: 0,
      drifting: false,
      wasDrifting: false,
      damage: 0, // 0..1 cosmetic / slight drag
      wrongWay: false,
      // lap/checkpoint state
      checkpoint: 0,
      laps: 0,
      lapArmed: false, // must pass mid-lap before start/finish awards a lap
      progress: 0,
      totalProgress: 0,
      finished: false,
      finishPlace: 0,
      finishTime: 0,
      color: color || "#fff",
      paintIndex: extra.paintIndex != null ? extra.paintIndex : id,
      displayName:
        extra.displayName ||
        (extra.isPlayer ? "YOU" : extra.isTraffic ? "TRAFFIC" : "CPU" + id),
      aggression: extra.aggression != null ? extra.aggression : 1,
      pickupCooldown: 0,
      lastUseItem: false,
      // Item roulette (spin before settle)
      itemSpinT: 0,
      itemSpinTick: 0,
      itemPreview: null,
      itemPending: null,
      // Slipstream / draft
      drafting: false,
      draftStrength: 0,
      // Style / addiction loops
      styleScore: 0,
      styleMult: 1,
      styleLabel: "",
      styleLabelT: 0,
      nearMissCd: 0,
      comebackMeter: 0,
      rivalId: null,
      lastPlace: 0, // for overtake detection
      passChain: 0,
      passChainT: 0,
      fever: false,
      feverT: 0,
    };
  }

  function addStyle(kart, state, pts, label) {
    if (!kart || kart.isTraffic) return;
    var m = kart.styleMult || 1;
    kart.styleScore = (kart.styleScore || 0) + pts * m;
    kart.styleMult = Math.min(5, m + 0.15);
    if (label) {
      kart.styleLabel = label;
      kart.styleLabelT = 1.1;
    }
    if (kart.isPlayer && state) pushEvent(state, "drift");
  }

  /**
   * Create a full race state.
   * opts: { numKarts?, numTraffic?, numLaps?, track?, seed? }
   */
  function createRace(opts) {
    opts = opts || {};
    var track = opts.track || (Track ? Track.getTrack() : null);
    if (!track) {
      throw new Error("NeoKart race-engine: track data required");
    }
    var waypoints = track.waypoints;
    var metrics = Track.buildPathMetrics(waypoints);
    var timeTrial = !!opts.timeTrial;
    var numKarts = timeTrial ? 1 : opts.numKarts != null ? opts.numKarts : 4;
    // Default 0 for unit tests; game boot passes numTraffic: 6
    var numTraffic = timeTrial
      ? 0
      : opts.numTraffic != null
        ? opts.numTraffic
        : 0;
    var numLaps = opts.numLaps != null ? opts.numLaps : track.numLaps;
    var difficulty = (opts.difficulty || "normal").toLowerCase();
    if (difficulty !== "easy" && difficulty !== "hard") difficulty = "normal";
    // Tesla Model 3 factory-style paints (Deep Blue, Red, Pearl White, Black, …)
    var colors = [
      "#1a3a6e",
      "#a01820",
      "#f0f0ec",
      "#0e0e10",
      "#4a5058",
      "#5c6168",
      "#b0b4b8",
      "#8b1020",
    ];
    var start = waypoints[0];
    var next = waypoints[1];
    var startAngle = angleTo(start.x, start.y, next.x, next.y);
    var nWp = waypoints.length;
    var hw = track.halfWidth || 50;
    /**
     * Race-direction right normal at a segment (perp to waypoint flow).
     * Positive offset = right lane for racers; negative = left (oncoming).
     */
    function raceRightAt(segIdx) {
      var a0 = waypoints[segIdx % nWp];
      var a1 = waypoints[(segIdx + 1) % nWp];
      var ang = angleTo(a0.x, a0.y, a1.x, a1.y);
      return {
        x: Math.cos(ang - Math.PI / 2),
        y: Math.sin(ang - Math.PI / 2),
        ang: ang,
      };
    }
    // Grid: ALL racers on the RIGHT side of the road, staggered in depth only
    var karts = [];
    var i, back, ox, oy, wpIdx, a, b, faceAng, laneOff, rr;
    var rx = Math.cos(startAngle - Math.PI / 2);
    var ry = Math.sin(startAngle - Math.PI / 2);
    // Keep clear of centerline; clamp so stickToRoad won't shove us left into oncoming
    var gridLane = Math.min(hw * 0.42, Math.max(14, hw * 0.32));
    for (i = 0; i < numKarts; i++) {
      back = i * 30 + 14;
      // Right lane + tiny stagger; player (i=0) furthest forward, still right
      var rightLane = gridLane + (i % 2) * 2.5;
      ox = start.x - Math.cos(startAngle) * back + rx * rightLane;
      oy = start.y - Math.sin(startAngle) * back + ry * rightLane;
      var rival =
        i > 0 ? AI_RIVALS[(i - 1 + (opts.seed || 0)) % AI_RIVALS.length] : null;
      var pIdx =
        i === 0
          ? opts.paintIndex != null
            ? opts.paintIndex
            : 0
          : rival
            ? rival.paintIndex
            : i;
      karts.push(
        createKart(
          i,
          i === 0,
          ox,
          oy,
          startAngle,
          colors[pIdx % colors.length],
          {
            direction: 1,
            isTraffic: false,
            vehicleType: "model3",
            paintIndex: pIdx,
            displayName: i === 0 ? "YOU" : rival ? rival.name : "CPU" + i,
            aggression: i === 0 ? 1 : rival ? rival.aggression : 1,
          }
        )
      );
    }

    // Mixed traffic: buses, trucks, vans, sedans — same-way RIGHT, oncoming LEFT
    var trafficColors = {
      bus: ["#e8e0c8", "#d4a820", "#2a6fd4", "#c03040"],
      truck: ["#f0f0f0", "#3a7acc", "#4a5058", "#c47820"],
      van: ["#e8ecf0", "#5c6168", "#1a3a6e", "#a01820"],
      sedan: ["#2a2e34", "#b0b4b8", "#8b1020", "#4a9a48"],
    };
    // Clear zone near start so you don't get smashed leaving the grid
    var clearSegs = Math.max(4, Math.floor(nWp * 0.12));
    var trafficPlaced = 0;
    var attempt;
    for (attempt = 0; trafficPlaced < numTraffic && attempt < numTraffic * 4; attempt++) {
      // Spread around the circuit, skipping the start clear zone
      wpIdx = Math.floor(
        ((attempt + 0.4) / Math.max(1, numTraffic * 1.5)) * nWp
      ) % nWp;
      // Skip segments in [0, clearSegs) and near loop-around into start
      if (wpIdx < clearSegs || wpIdx > nWp - Math.max(2, Math.floor(clearSegs * 0.5))) {
        continue;
      }
      a = waypoints[wpIdx];
      var vType = TRAFFIC_TYPES[trafficPlaced % TRAFFIC_TYPES.length];
      // ~60% same-way (pass targets); rest oncoming on the OTHER lane
      var sameWay = trafficPlaced % 5 !== 0 && trafficPlaced % 5 !== 1;
      var dir = sameWay ? 1 : -1;
      rr = raceRightAt(wpIdx);
      if (dir < 0) {
        b = waypoints[(wpIdx - 1 + nWp) % nWp];
        faceAng = angleTo(a.x, a.y, b.x, b.y);
      } else {
        faceAng = rr.ang;
      }
      // Lane offsets in race-frame: +right for same-way, −right (= left) for oncoming
      var laneMag = Math.min(hw * 0.38, 12 + (trafficPlaced % 3) * 4.5);
      if (vType === "bus") laneMag = Math.min(hw * 0.4, laneMag + 2);
      laneOff = sameWay ? laneMag : -laneMag;
      ox = a.x + rr.x * laneOff;
      oy = a.y + rr.y * laneOff;
      // Safety: don't spawn traffic on top of the starting grid
      var nearGrid = dist(ox, oy, start.x, start.y) < 95;
      if (nearGrid) continue;

      var tCols = trafficColors[vType] || trafficColors.sedan;
      var cap =
        vType === "bus"
          ? 0.42
          : vType === "truck"
            ? 0.48
            : vType === "van"
              ? 0.55
              : 0.62;
      if (!sameWay) cap *= 0.85;
      var tk = createKart(
        numKarts + trafficPlaced,
        false,
        ox,
        oy,
        faceAng,
        tCols[trafficPlaced % tCols.length],
        {
          direction: dir,
          isTraffic: true,
          vehicleType: vType,
          speedCap: cap,
        }
      );
      tk.speed = MAX_SPEED * cap * (0.55 + (trafficPlaced % 4) * 0.08);
      karts.push(tk);
      trafficPlaced++;
    }
    // Fallback if clear-zone culling left us short — still honor lanes + grid bubble
    for (attempt = 0; trafficPlaced < numTraffic && attempt < nWp * 2; attempt++) {
      wpIdx = (clearSegs + 1 + attempt * 3) % nWp;
      if (wpIdx < 2) continue;
      a = waypoints[wpIdx];
      var vType2 = TRAFFIC_TYPES[trafficPlaced % TRAFFIC_TYPES.length];
      var sameWay2 = trafficPlaced % 2 === 0;
      var dir2 = sameWay2 ? 1 : -1;
      rr = raceRightAt(wpIdx);
      faceAng =
        dir2 < 0
          ? angleTo(
              a.x,
              a.y,
              waypoints[(wpIdx - 1 + nWp) % nWp].x,
              waypoints[(wpIdx - 1 + nWp) % nWp].y
            )
          : rr.ang;
      laneOff = (sameWay2 ? 1 : -1) * Math.min(hw * 0.36, 14 + (trafficPlaced % 3) * 3);
      ox = a.x + rr.x * laneOff;
      oy = a.y + rr.y * laneOff;
      if (dist(ox, oy, start.x, start.y) < 110) continue;
      var cap2 = vType2 === "bus" ? 0.42 : vType2 === "truck" ? 0.48 : 0.55;
      var tk2 = createKart(
        numKarts + trafficPlaced,
        false,
        ox,
        oy,
        faceAng,
        (trafficColors[vType2] || trafficColors.sedan)[0],
        {
          direction: dir2,
          isTraffic: true,
          vehicleType: vType2,
          speedCap: cap2,
        }
      );
      tk2.speed = MAX_SPEED * cap2 * 0.6;
      karts.push(tk2);
      trafficPlaced++;
    }

    // init progress + elevation for each kart (locked to road surface)
    for (i = 0; i < karts.length; i++) {
      var proj = projectOnTrack(karts[i].x, karts[i].y, waypoints, metrics);
      karts[i].progress = proj.progress;
      karts[i].checkpoint = proj.seg;
      karts[i].totalProgress = proj.progress;
      karts[i].elev = (proj.elev || 0) + ROAD_SURFACE_PAD;
      karts[i].pitch = 0;
      stickToRoad(karts[i], { track: track, metrics: metrics, karts: karts }, 1 / 60);
    }

    var boxes = track.itemBoxes.map(function (b) {
      return {
        id: b.id,
        x: b.x,
        y: b.y,
        active: true,
        respawnT: 0,
      };
    });

    // Optional player paint override
    if (opts.paintIndex != null && karts[0]) {
      var paints = ["#1a3a6e", "#a01820", "#f0f0ec", "#0e0e10", "#4a5058", "#5c6168", "#b0b4b8", "#8b1020"];
      karts[0].paintIndex = opts.paintIndex;
      karts[0].color = paints[opts.paintIndex % paints.length];
    }

    return {
      track: track,
      metrics: metrics,
      karts: karts,
      itemBoxes: boxes,
      hazards: [], // oil slicks {x,y,life,radius}
      projectiles: [], // missiles {x,y,angle,life,ownerId}
      explosions: [], // missile blasts for VFX {x,y,elev,life,maxLife,kartId}
      events: [], // audio/UI one-shots this frame
      time: 0,
      numLaps: numLaps,
      finished: false,
      rankings: [],
      finishCount: 0,
      rng: makeRng(opts.seed != null ? opts.seed : 42),
      // countdown | racing | paused | results
      phase: opts.countdown === true ? "countdown" : "racing",
      countdownT: opts.countdown === true ? COUNTDOWN_TOTAL : 0,
      countdownLabel: opts.countdown === true ? "3" : "",
      message: "",
      wrongWay: false,
      playerPlace: 1,
      // Ghost PB chase: expected path units if matching prior best time
      ghostPbTime: opts.ghostPbTime != null ? opts.ghostPbTime : null,
      ghostDelta: null,
      ghostPose: null, // {x,y,elev,angle} for visual ghost car
      passChain: 0,
      hitStop: 0, // seconds of presentation slow-mo (main loop may scale dt)
      cameraPunch: 0, // 0..1 kick strength for render
      resultsDetail: null, // filled when phase → results
      difficulty: difficulty,
      mode: timeTrial ? "timeTrial" : "race",
      timeTrial: timeTrial,
      raceClock: 0, // mirrors time once racing (for HUD)
      playerFinishGraceT: null, // null until player finishes; then counts down
      replayBuffer: [], // ring of {t, karts:[{id,x,y,elev,angle,speed}]}
      replayPlayT: 0,
      replayDuration: 0,
      taunt: "",
      tauntT: 0,
    };
  }

  function pushReplaySnapshot(state) {
    if (!state || !state.karts) return;
    var snap = { t: state.time, karts: [] };
    var i, k;
    for (i = 0; i < state.karts.length; i++) {
      k = state.karts[i];
      if (k.isTraffic) continue;
      snap.karts.push({
        id: k.id,
        x: k.x,
        y: k.y,
        elev: k.elev || 0,
        angle: k.angle,
        speed: k.speed || 0,
        name: k.displayName || "",
      });
    }
    if (!state.replayBuffer) state.replayBuffer = [];
    state.replayBuffer.push(snap);
    while (state.replayBuffer.length > REPLAY_BUFFER_MAX) {
      state.replayBuffer.shift();
    }
  }

  /**
   * Apply a fractional index (0..1) into the replay buffer onto live kart poses.
   */
  function applyReplayFrame(state, frac) {
    var buf = state.replayBuffer;
    if (!buf || !buf.length) return false;
    frac = clamp(frac, 0, 1);
    var idx = Math.min(buf.length - 1, Math.floor(frac * (buf.length - 1)));
    var snap = buf[idx];
    var i, j, k, s;
    for (i = 0; i < snap.karts.length; i++) {
      s = snap.karts[i];
      for (j = 0; j < state.karts.length; j++) {
        k = state.karts[j];
        if (k.id === s.id) {
          k.x = s.x;
          k.y = s.y;
          k.elev = s.elev;
          k.angle = s.angle;
          k.speed = s.speed;
          break;
        }
      }
    }
    state.replayFrame = idx;
    state.replayFrac = frac;
    return true;
  }

  function buildResultsPayload(state) {
    var pr = playerResult(state);
    var placeLabel =
      pr.place === 1
        ? "1ST"
        : pr.place === 2
          ? "2ND"
          : pr.place === 3
            ? "3RD"
            : pr.place + "TH";
    var timeStr = (state.time || 0).toFixed(2) + "s";
    var message;
    if (state.timeTrial || state.mode === "timeTrial") {
      message = "TIME TRIAL — " + timeStr;
      placeLabel = "TIME";
    } else {
      message = pr.win
        ? "YOU WIN — " + placeLabel
        : "FINISHED " + placeLabel;
    }
    return {
      place: pr.place || 0,
      win: !!pr.win,
      placeLabel: placeLabel,
      time: state.time,
      timeStr: timeStr,
      mode: state.mode || "race",
      difficulty: state.difficulty || "normal",
      headline: message,
      nextAction: "Press R to rematch · Esc for courses",
      message: message,
    };
  }

  /**
   * Signed lateral offset from road center (positive = race-right).
   */
  function signedLateralOnRoad(kart, state) {
    var wps = state.track.waypoints;
    var n = wps.length;
    var seg = kart.checkpoint != null ? kart.checkpoint : 0;
    var a = wps[seg % n];
    var b = wps[(seg + 1) % n];
    var ang = Math.atan2(b.y - a.y, b.x - a.x);
    var rx = Math.cos(ang - Math.PI / 2);
    var ry = Math.sin(ang - Math.PI / 2);
    return (kart.x - a.x) * rx + (kart.y - a.y) * ry;
  }

  /**
   * Dirt/off-ribbon shortcut: lower grip when near track.shortcut along-progress
   * and on the configured side of the road (outside the main asphalt).
   * Returns grip mult 0..1 (1 = full asphalt). Pure helper for tests.
   */
  function shortcutGripMult(kart, state) {
    if (!kart || !state || !state.track || !state.metrics) return 1;
    var sc = state.track.shortcut;
    if (!sc) {
      kart.inShortcut = false;
      return 1;
    }
    var total = state.metrics.total || 1;
    var at = sc.at != null ? sc.at : 0.12;
    var frac = ((kart.progress || 0) % total) / total;
    var dFrac = Math.abs(frac - at);
    if (dFrac > 0.5) dFrac = 1 - dFrac;
    if (dFrac > SHORTCUT_ALONG_FRAC) {
      kart.inShortcut = false;
      return 1;
    }
    var hw = state.track.halfWidth || 50;
    var lat = signedLateralOnRoad(kart, state);
    var side = sc.side != null ? sc.side : -1;
    // Must be on the shortcut side and outside soft shoulder (risky cut)
    var onSide = side < 0 ? lat < -hw * 0.55 : lat > hw * 0.55;
    var maxOut = hw + (sc.dist != null ? sc.dist : 40);
    var absLat = Math.abs(lat);
    if (!onSide || absLat > maxOut) {
      kart.inShortcut = false;
      return 1;
    }
    kart.inShortcut = true;
    var grip = sc.grip != null ? sc.grip : 0.72;
    return clamp(grip, 0.35, 1);
  }

  /**
   * World pose along closed path for a totalProgress-like distance (wraps per lap).
   */
  function poseAlongTrack(state, pathDist) {
    if (!state || !state.metrics || !state.track) return null;
    var total = state.metrics.total || 1;
    var d = pathDist % total;
    if (d < 0) d += total;
    var cum = state.metrics.cum;
    var segs = state.metrics.segs;
    var wps = state.track.waypoints;
    var n = wps.length;
    var i, t, a, b, ang;
    for (i = 0; i < n; i++) {
      if (d <= cum[i] + segs[i] + 1e-6 || i === n - 1) {
        t = segs[i] > 1e-6 ? (d - cum[i]) / segs[i] : 0;
        t = clamp(t, 0, 1);
        a = wps[i];
        b = wps[(i + 1) % n];
        ang = angleTo(a.x, a.y, b.x, b.y);
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          elev: ((a.z || 0) * (1 - t) + (b.z || 0) * t) + ROAD_SURFACE_PAD,
          angle: ang,
          seg: i,
        };
      }
    }
    return null;
  }

  function finalizeResults(state) {
    if (!state) return state;
    state.finished = true;
    state.phase = "results";
    state.playerFinishGraceT = 0;
    state.cameraPunch = Math.max(state.cameraPunch || 0, 0.6);
    state.hitStop = 0.08;
    state.podiumT = 0;
    var payload = buildResultsPayload(state);
    state.message = payload.message;
    state.resultsDetail = payload;
    pushEvent(state, "results");
    return state;
  }

  /**
   * Enter instant replay if buffer is hot, else go straight to results board.
   */
  function openResults(state) {
    if (!state || state.phase === "results" || state.phase === "replay") {
      return state;
    }
    state.finished = true;
    state.playerFinishGraceT = 0;
    state.cameraPunch = 1;
    state.hitStop = 0.1;
    var buf = state.replayBuffer;
    if (buf && buf.length >= 30) {
      state.phase = "replay";
      state.replayPlayT = 0;
      state.replayDuration = REPLAY_PLAY_DURATION;
      state.message = "REPLAY";
      pushEvent(state, "replay");
      applyReplayFrame(state, 0);
      return state;
    }
    return finalizeResults(state);
  }

  /**
   * Map remaining countdownT → light label for HUD/audio.
   * 3 → 2 → 1 → GO → racing.
   */
  function countdownLabelFor(t) {
    if (t > COUNTDOWN_SEG * 3) return "3";
    if (t > COUNTDOWN_SEG * 2) return "2";
    if (t > COUNTDOWN_SEG) return "1";
    if (t > 0) return "GO";
    return "";
  }

  /**
   * Advance start-lights ceremony. Pure + deterministic.
   * Returns true while still in countdown (caller should not drive karts).
   */
  function tickCountdown(state, dt) {
    if (!state || state.phase !== "countdown") return false;
    var prev = state.countdownLabel || "";
    state.countdownT = (state.countdownT || 0) - dt;
    var label = countdownLabelFor(state.countdownT);
    state.countdownLabel = label;
    if (label && label !== prev) {
      if (label === "GO") pushEvent(state, "go");
      else pushEvent(state, "countdown");
    }
    if (state.countdownT <= 0) {
      state.countdownT = 0;
      state.countdownLabel = "";
      state.phase = "racing";
      if (prev !== "GO") pushEvent(state, "go");
      return false;
    }
    return true;
  }

  function makeRng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      // xorshift32
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  /**
   * Position-aware item RNG.
   * place: 1 = leader (weaker offense), higher = more catch-up tools.
   */
  function pickItem(rng, place, numRacers) {
    place = place != null ? place : 2;
    numRacers = numRacers != null ? numRacers : 4;
    var r = rng();
    var lastish = place >= Math.max(2, numRacers - 1);
    var leader = place === 1;
    if (leader) {
      // Leaders: defense / oil, rare missile
      if (r < 0.35) return "shield";
      if (r < 0.6) return "oil";
      if (r < 0.8) return "boost";
      if (r < 0.92) return "shock";
      return "missile";
    }
    if (lastish) {
      if (r < 0.3) return "missile";
      if (r < 0.5) return "shock";
      if (r < 0.72) return "boost";
      if (r < 0.88) return "shield";
      return "oil";
    }
    if (r < 0.28) return "boost";
    if (r < 0.48) return "missile";
    if (r < 0.62) return "shield";
    if (r < 0.76) return "shock";
    return "oil";
  }

  function playerPlaceOf(state, kartId) {
    var ranks = state.rankings && state.rankings.length ? state.rankings : computeRankings(state);
    var i;
    for (i = 0; i < ranks.length; i++) {
      if (ranks[i].id === kartId) return ranks[i].place;
    }
    return 2;
  }

  function racerCount(state) {
    var n = 0;
    var i;
    for (i = 0; i < state.karts.length; i++) {
      if (!state.karts[i].isTraffic) n++;
    }
    return Math.max(1, n);
  }

  function isOnTrack(kart, state) {
    var proj = projectOnTrack(
      kart.x,
      kart.y,
      state.track.waypoints,
      state.metrics,
      {
        preferSeg: kart.checkpoint,
        preferElev: kart.elev,
        segWindow: 24,
        elevWeight: 0.5,
      }
    );
    return proj.dist <= state.track.halfWidth * 0.98;
  }

  /**
   * Advance checkpoint/lap only when moving forward along the track.
   * Progress is path distance; lap completes when wrapping past start after full circuit.
   */
  function updateProgress(kart, state) {
    if (kart.finished) return;
    var proj =
      kart._roadProj ||
      projectOnTrack(kart.x, kart.y, state.track.waypoints, state.metrics, {
        preferSeg: kart.checkpoint,
        preferElev: kart.elev,
        segWindow: 24,
        elevWeight: 0.5,
      });
    // Traffic: only keep checkpoint for AI aiming — no race scoring
    if (kart.isTraffic || kart.direction < 0) {
      kart.checkpoint = proj.seg;
      kart.progress = proj.progress;
      return;
    }
    var total = state.metrics.total;
    var prev = kart.progress;
    var next = proj.progress;
    // delta with wrap handling
    var d = next - prev;
    if (d > total * 0.5) d -= total; // backward wrap noise
    if (d < -total * 0.5) d += total; // forward wrap

    // Facing vs track tangent at projection
    var a = state.track.waypoints[proj.seg];
    var b = state.track.waypoints[(proj.seg + 1) % state.track.waypoints.length];
    var tang = Math.atan2(b.y - a.y, b.x - a.x);
    var faceDot = Math.cos(kart.angle - tang);
    // Wrong way: facing opposite the path while moving with meaningful speed
    kart.wrongWay =
      faceDot < -0.25 && Math.abs(kart.speed) > 40 && !kart.finished;

    // Only accept forward progress (or small noise); reject large reverse jumps as wrong way
    if (d >= -total * 0.08) {
      if (d > 0 || Math.abs(d) < total * 0.02) {
        // Arm after reaching mid-course so grid spawn behind start cannot free-lap
        if (next > total * 0.45 && next < total * 0.95) {
          kart.lapArmed = true;
        }
        // detect lap: armed + crossed start going forward
        if (
          kart.lapArmed &&
          d > 0 &&
          prev > total * 0.7 &&
          next < total * 0.3
        ) {
          kart.laps += 1;
          kart.lapArmed = false;
          if (kart.isPlayer) pushEvent(state, "lap");
          if (kart.laps >= state.numLaps) {
            kart.finished = true;
            kart.finishTime = state.time;
            state.finishCount += 1;
            kart.finishPlace = state.finishCount;
            if (kart.isPlayer) pushEvent(state, "finish");
          }
        }
        kart.progress = next;
        kart.checkpoint = proj.seg;
        kart.totalProgress = kart.laps * total + next;
      }
    }
    // if going wrong way significantly, do not advance laps/checkpoints
  }

  /**
   * Slipstream: if you're behind another car going roughly the same way,
   * draftStrength rises (0..1) and boosts top speed / accel in driveKart.
   */
  function applyDrafting(state) {
    var karts = state.karts;
    var i, j, a, b, dx, dy, dist, fx, fy, along, lat, score, best;
    for (i = 0; i < karts.length; i++) {
      a = karts[i];
      a.drafting = false;
      best = 0;
      if (a.finished || a.stunT > 0) {
        a.draftStrength = 0;
        continue;
      }
      fx = Math.cos(a.angle);
      fy = Math.sin(a.angle);
      for (j = 0; j < karts.length; j++) {
        if (i === j) continue;
        b = karts[j];
        // Must be roughly same travel direction (not oncoming)
        if (Math.cos(a.angle - b.angle) < 0.35) continue;
        dx = b.x - a.x;
        dy = b.y - a.y;
        dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 8 || dist > DRAFT_RANGE) continue;
        along = dx * fx + dy * fy;
        if (along < 4) continue; // leader must be in front
        lat = Math.abs(-dx * fy + dy * fx);
        if (lat > 18) continue; // too far sideways
        // Cone check
        if (along / dist < DRAFT_CONE) continue;
        // Closer + more centered = stronger draft
        score = (1 - dist / DRAFT_RANGE) * (1 - lat / 18);
        if (score > best) best = score;
      }
      a.draftStrength = clamp(best, 0, 1);
      a.drafting = a.draftStrength > 0.08;
    }
  }

  /**
   * Solid kart–kart collision: no interpenetration.
   * Circle broadphase + separation; impulse damps closing speed.
   * Multiple iterations stabilize stacks in the pack.
   */
  function resolveKartCollisions(state) {
    var karts = state.karts;
    var n = karts.length;
    var iter, i, j, a, b, dx, dy, dist, minDist, nx, ny, overlap;
    var va, vb, rel, impulse, rest;
    rest = 0.22;

    // 3 iterations is enough for arcade packs; 4 was pure cost
    for (iter = 0; iter < 3; iter++) {
      for (i = 0; i < n; i++) {
        a = karts[i];
        // Blown-up wrecks don't block the pack
        if (a.explodedT > 0) continue;
        for (j = i + 1; j < n; j++) {
          b = karts[j];
          if (b.explodedT > 0) continue;
          minDist = vehicleCollideRadius(a) + vehicleCollideRadius(b);
          dx = b.x - a.x;
          dy = b.y - a.y;
          dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= minDist) continue;
          if (dist < 1e-5) {
            // identical position — arbitrary shove
            nx = 1;
            ny = 0;
            dist = 1e-5;
          } else {
            nx = dx / dist;
            ny = dy / dist;
          }
          overlap = minDist - dist;
          // Positional correction (equal mass)
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;

          // Sync cartesian velocity from scalar speed + heading
          a.vx = Math.cos(a.angle) * a.speed;
          a.vy = Math.sin(a.angle) * a.speed;
          b.vx = Math.cos(b.angle) * b.speed;
          b.vy = Math.sin(b.angle) * b.speed;

          va = a.vx * nx + a.vy * ny;
          vb = b.vx * nx + b.vy * ny;
          rel = va - vb;
          // Only resolve if approaching
          if (rel < 0) {
            impulse = (-(1 + rest) * rel) / 2;
            a.vx -= impulse * nx;
            a.vy -= impulse * ny;
            b.vx += impulse * nx;
            b.vy += impulse * ny;
            // Project back onto forward axis for arcade feel
            a.speed = a.vx * Math.cos(a.angle) + a.vy * Math.sin(a.angle);
            b.speed = b.vx * Math.cos(b.angle) + b.vy * Math.sin(b.angle);
            // Small impact friction / bump
            a.speed *= 0.92;
            b.speed *= 0.92;
          }

          // Keep both on track after shove
          stickToRoad(a, state, 1 / 60);
          stickToRoad(b, state, 1 / 60);
        }
      }
    }
  }

  function driveKart(kart, input, dt, state) {
    if (kart.finished) {
      kart.speed *= 0.9;
      kart.vx = Math.cos(kart.angle) * kart.speed;
      kart.vy = Math.sin(kart.angle) * kart.speed;
      kart.x += kart.vx * dt;
      kart.y += kart.vy * dt;
      stickToRoad(kart, state, dt);
      return;
    }

    // Temporarily blown up (missile): car is wrecked in place, no control
    if (kart.explodedT > 0) {
      kart.explodedT -= dt;
      if (kart.stunT > 0) kart.stunT -= dt;
      kart.speed = 0;
      kart.vx = 0;
      kart.vy = 0;
      kart.boostT = 0;
      kart.angle += 9.5 * dt; // spin wreckage
      stickToRoad(kart, state, dt);
      updateProgress(kart, state);
      return;
    }

    if (kart.stunT > 0) {
      kart.stunT -= dt;
      kart.speed *= 0.88;
      // dazed after reappear — slow drift only
      kart.vx = Math.cos(kart.angle) * kart.speed;
      kart.vy = Math.sin(kart.angle) * kart.speed;
      kart.x += kart.vx * dt;
      kart.y += kart.vy * dt;
      kart.angle += 2.2 * dt * (kart.speed > 5 ? 1 : 0.4);
      stickToRoad(kart, state, dt);
      updateProgress(kart, state);
      return;
    }

    var onTrack = isOnTrack(kart, state);
    var maxSp = onTrack ? MAX_SPEED : OFFTRACK_MAX;
    // Dirt shortcut cut — lower grip / top speed (risk-reward)
    var gripMult = shortcutGripMult(kart, state);
    if (gripMult < 1) {
      maxSp *= gripMult;
    }
    // Wet weather: lower top speed + slipperier coast
    if (state.track && state.track.weather === "rain") {
      maxSp *= 0.9;
    }
    if (kart.boostT > 0) {
      kart.boostT -= dt;
      maxSp *= BOOST_MULT;
    }
    if (kart.slowT > 0) {
      kart.slowT -= dt;
      maxSp *= HIT_SLOW_MULT;
    }
    if (kart.shieldT > 0) kart.shieldT -= dt;
    // Cosmetic damage slightly reduces top speed
    if (kart.damage > 0) {
      maxSp *= 1 - 0.12 * clamp(kart.damage, 0, 1);
    }

    // --- Drift hold meter (addicting corner loop) ---
    var steering = !!(input.left || input.right);
    var wantDrift =
      !!input.drift &&
      steering &&
      Math.abs(kart.speed) >= DRIFT_MIN_SPEED &&
      onTrack &&
      !kart.isTraffic;
    kart.wasDrifting = !!kart.drifting;
    kart.drifting = wantDrift;
    if (kart.drifting) {
      kart.driftMeter = clamp(
        (kart.driftMeter || 0) + DRIFT_FILL_RATE * dt,
        0,
        1
      );
      maxSp *= DRIFT_SPEED_PENALTY;
    } else {
      // Release boost when leaving drift with enough meter
      if (
        kart.wasDrifting &&
        (kart.driftMeter || 0) >= DRIFT_BOOST_THRESHOLD
      ) {
        var perfect = (kart.driftMeter || 0) >= PERFECT_DRIFT;
        var boostDur = perfect ? DRIFT_BOOST_DURATION * 1.35 : DRIFT_BOOST_DURATION;
        var boostMul = perfect ? DRIFT_BOOST_MULT * 1.12 : DRIFT_BOOST_MULT;
        kart.boostT = Math.max(kart.boostT, boostDur);
        maxSp *= boostMul;
        if (kart.speed < MAX_SPEED * 0.55) kart.speed = MAX_SPEED * 0.6;
        if (kart.isPlayer) {
          pushEvent(state, "driftBoost");
          addStyle(
            kart,
            state,
            perfect ? 200 : 80,
            perfect ? "PERFECT DRIFT!" : "DRIFT!"
          );
        }
        kart.driftMeter = 0;
      } else {
        kart.driftMeter = Math.max(
          0,
          (kart.driftMeter || 0) - DRIFT_DECAY * dt
        );
      }
    }

    // Comeback charge when mid/pack trailing
    if (kart.isPlayer && !kart.finished) {
      var placeNow = playerPlaceOf(state, kart.id);
      if (placeNow >= COMEBACK_PLACE_MIN) {
        kart.comebackMeter = clamp(
          (kart.comebackMeter || 0) + COMEBACK_FILL * dt,
          0,
          1
        );
        if (kart.comebackMeter >= 1) {
          kart.comebackMeter = 0;
          kart.boostT = Math.max(kart.boostT, COMEBACK_BOOST_T);
          addStyle(kart, state, 100, "COMEBACK!");
          pushEvent(state, "boost");
        }
      } else {
        kart.comebackMeter = Math.max(0, (kart.comebackMeter || 0) - 0.2 * dt);
      }
    }

    // Near-miss boost (threading traffic / pack)
    if (kart.nearMissCd > 0) kart.nearMissCd -= dt;
    if (
      kart.isPlayer &&
      kart.nearMissCd <= 0 &&
      Math.abs(kart.speed) > 90 &&
      !kart.explodedT
    ) {
      var ni, other, nd;
      for (ni = 0; ni < state.karts.length; ni++) {
        other = state.karts[ni];
        if (other.id === kart.id || other.finished) continue;
        nd = dist(kart.x, kart.y, other.x, other.y);
        if (nd < NEAR_MISS_DIST && nd > KART_RADIUS * 1.4) {
          // Passing laterally at speed
          var lat =
            Math.abs(
              -(other.x - kart.x) * Math.sin(kart.angle) +
                (other.y - kart.y) * Math.cos(kart.angle)
            );
          var along =
            (other.x - kart.x) * Math.cos(kart.angle) +
            (other.y - kart.y) * Math.sin(kart.angle);
          if (lat < 16 && Math.abs(along) < 18) {
            kart.nearMissCd = NEAR_MISS_COOLDOWN;
            kart.boostT = Math.max(kart.boostT, NEAR_MISS_BOOST);
            addStyle(kart, state, 60, "NEAR MISS!");
            pushEvent(state, "drift");
            break;
          }
        }
      }
    }

    // Style decay + label timer
    if (kart.styleLabelT > 0) kart.styleLabelT -= dt;
    else kart.styleLabel = "";
    if (kart.styleScore > 0) {
      kart.styleScore = Math.max(0, kart.styleScore - STYLE_DECAY * dt);
      if (kart.styleScore < 20) kart.styleMult = 1;
    }

    // Fever mode — chain style into a temporary god-flow speed window
    if (kart.feverT > 0) {
      kart.feverT -= dt;
      kart.fever = kart.feverT > 0;
      if (kart.fever) maxSp *= 1 + FEVER_SPEED_BONUS;
    } else {
      kart.fever = false;
      if (
        kart.isPlayer &&
        (kart.styleMult || 1) >= FEVER_MULT &&
        !kart.finished
      ) {
        kart.feverT = FEVER_DURATION;
        kart.fever = true;
        kart.styleMult = 1.5; // must rebuild combo for next fever
        if (state) {
          kart.styleLabel = "FEVER!";
          kart.styleLabelT = 1.4;
          pushEvent(state, "boost");
        }
      }
    }

    // Draft style tick
    if (kart.drafting && kart.isPlayer && Math.random() < dt * 2) {
      addStyle(kart, state, 8, "DRAFT");
    }

    // Arcade steering: snappy at low speed, stable at high; drift bonus
    // Analog stick (steerAxis -1..1) when present; else digital left/right
    var speedFrac = clamp(Math.abs(kart.speed) / MAX_SPEED, 0, 1);
    var steer = steerRateAtSpeed(kart.speed, kart.drifting);
    if (input.steerAxis != null && Math.abs(input.steerAxis) > 0.05) {
      kart.angle += steer * dt * clamp(input.steerAxis, -1, 1);
    } else {
      if (input.left) kart.angle -= steer * dt;
      if (input.right) kart.angle += steer * dt;
    }

    // Traffic (buses/trucks/vans/sedans) capped so racers can pass them
    if (kart.isTraffic) {
      var tCap = kart.speedCap != null ? kart.speedCap : 0.55;
      maxSp = Math.min(maxSp, MAX_SPEED * tCap);
    }
    // Rubber-band for AI racers far behind leader (difficulty + last lap + personality)
    if (!kart.isPlayer && !kart.isTraffic) {
      var rb = rubberBandMult(state, kart);
      // Aggressive rivals catch harder; calm ones less so
      if (rb > 1 && kart.aggression != null) {
        rb = 1 + (rb - 1) * kart.aggression;
      }
      maxSp *= rb;
    }
    // Slipstream: higher top speed + slightly stronger accel when drafting
    if (kart.draftStrength > 0 && !kart.isTraffic) {
      maxSp *= 1 + DRAFT_MAX_BONUS * kart.draftStrength;
    }

    if (input.accel) {
      var accelMul = kart.isTraffic ? 0.85 : 1;
      if (kart.draftStrength > 0 && !kart.isTraffic) {
        accelMul *= 1 + 0.35 * kart.draftStrength;
      }
      if (kart.drifting) accelMul *= 0.9;
      kart.speed += ACCEL * accelMul * dt;
    } else if (input.brake) {
      if (kart.speed > 5) {
        kart.speed -= BRAKE * dt;
      } else {
        kart.speed -= ACCEL * 0.6 * dt;
        if (kart.speed < -REVERSE_MAX) kart.speed = -REVERSE_MAX;
      }
    } else {
      // coast friction (wet = more drag; shortcut dirt = loose)
      var fr =
        state.track && state.track.weather === "rain"
          ? Math.pow(0.975, dt * 60)
          : Math.pow(FRICTION, dt * 60);
      if (kart.inShortcut) fr *= Math.pow(0.97, dt * 60);
      kart.speed *= onTrack || kart.inShortcut ? fr : Math.pow(OFFTRACK_FRICTION, dt * 60);
    }

    if (kart.speed > maxSp) kart.speed = maxSp;
    if (kart.speed < -REVERSE_MAX) kart.speed = -REVERSE_MAX;

    kart.vx = Math.cos(kart.angle) * kart.speed;
    kart.vy = Math.sin(kart.angle) * kart.speed;

    // Sub-step integration so high speed never tunnels through curves / bridge decks
    var stepDist = Math.abs(kart.speed) * dt;
    var steps = Math.max(1, Math.min(4, Math.ceil(stepDist / 14)));
    var sdt = dt / steps;
    var si;
    for (si = 0; si < steps; si++) {
      kart.x += kart.vx * sdt;
      kart.y += kart.vy * sdt;
      stickToRoad(kart, state, sdt);
    }
    updateProgress(kart, state);

    if (kart.pickupCooldown > 0) kart.pickupCooldown -= dt;
    // Item roulette: flash previews, then settle to pending item
    if (kart.itemSpinT > 0) {
      kart.itemSpinT -= dt;
      kart.itemSpinTick -= dt;
      if (kart.itemSpinTick <= 0) {
        kart.itemSpinTick = ITEM_SPIN_TICK;
        // Cycle preview for HUD tension (not the final roll)
        var prevIdx = Math.floor(state.rng() * ITEM_TYPES.length);
        kart.itemPreview = ITEM_TYPES[prevIdx];
        if (kart.isPlayer) pushEvent(state, "itemTick");
      }
      if (kart.itemSpinT <= 0) {
        kart.item = kart.itemPending || pickItem(state.rng, playerPlaceOf(state, kart.id), racerCount(state));
        kart.itemPending = null;
        kart.itemPreview = null;
        kart.itemSpinT = 0;
        if (kart.isPlayer) {
          pushEvent(state, "itemReady");
          addStyle(kart, state, 25, kart.item.toUpperCase() + "!");
        }
      }
    }
    if (kart.passChainT > 0) {
      kart.passChainT -= dt;
      if (kart.passChainT <= 0) kart.passChain = 0;
    }
  }

  function tryPickup(kart, state) {
    if (kart.isTraffic) return;
    // Block while holding item OR mid-roulette (was: instant grant — no tension)
    if (kart.item || kart.itemSpinT > 0 || kart.pickupCooldown > 0 || kart.finished) {
      return;
    }
    var i, box;
    var place = playerPlaceOf(state, kart.id);
    var nRacers = racerCount(state);
    for (i = 0; i < state.itemBoxes.length; i++) {
      box = state.itemBoxes[i];
      if (!box.active) continue;
      if (dist(kart.x, kart.y, box.x, box.y) < KART_RADIUS + ITEM_BOX_RADIUS) {
        box.active = false;
        box.respawnT = ITEM_BOX_RESPAWN;
        // Roll final item up front, but hide it behind a spin
        kart.itemPending = pickItem(state.rng, place, nRacers);
        kart.item = null;
        kart.itemSpinT = ITEM_SPIN_DURATION;
        kart.itemSpinTick = 0;
        kart.itemPreview = ITEM_TYPES[0];
        kart.pickupCooldown = ITEM_PICKUP_COOLDOWN;
        if (kart.isPlayer) pushEvent(state, "pickup");
        return;
      }
    }
  }

  function useItem(kart, input, state) {
    // edge-trigger useItem
    var pressed = !!input.useItem;
    var edge = pressed && !kart.lastUseItem;
    kart.lastUseItem = pressed;
    // Cannot fire while roulette is spinning
    if (!edge || !kart.item || kart.itemSpinT > 0 || kart.finished || kart.stunT > 0) {
      return;
    }

    var item = kart.item;
    kart.item = null;

    if (item === "boost") {
      kart.boostT = BOOST_DURATION;
      if (kart.speed < MAX_SPEED * 0.5) kart.speed = MAX_SPEED * 0.55;
      if (kart.isPlayer) pushEvent(state, "boost");
      return;
    }

    if (item === "shield") {
      kart.shieldT = SHIELD_DURATION;
      if (kart.isPlayer) pushEvent(state, "shield");
      return;
    }

    if (item === "shock") {
      // Stun every racer/traffic ahead in a forward cone (weaker than missile wipe)
      var k, target;
      for (k = 0; k < state.karts.length; k++) {
        target = state.karts[k];
        if (target.id === kart.id || target.finished) continue;
        if (target.shieldT > 0) {
          target.shieldT = 0;
          continue;
        }
        if (
          isAheadOf(
            kart.x,
            kart.y,
            kart.angle,
            target.x,
            target.y,
            SHOCK_RANGE,
            0.2
          )
        ) {
          target.stunT = Math.max(target.stunT, SHOCK_STUN);
          target.speed *= 0.35;
          target.damage = Math.min(1, (target.damage || 0) + 0.25);
        }
      }
      if (kart.isPlayer) pushEvent(state, "shock");
      return;
    }

    if (item === "oil") {
      var behind = kart.angle + Math.PI;
      state.hazards.push({
        x: kart.x + Math.cos(behind) * 28,
        y: kart.y + Math.sin(behind) * 28,
        elev: kart.elev || 0,
        life: OIL_DURATION,
        radius: OIL_RADIUS,
        ownerId: kart.id,
        ownerGrace: 0.45,
      });
      if (kart.isPlayer) pushEvent(state, "oil");
      return;
    }

    if (item === "missile") {
      // Heat-seek ONLY the single nearest car in front of you
      var place = playerPlaceOf(state, kart.id);
      var mx = kart.x + Math.cos(kart.angle) * 22;
      var my = kart.y + Math.sin(kart.angle) * 22;
      var mElev = (kart.elev || 0) + MISSILE_AIR_HEIGHT;
      var lock = pickNearestAheadTarget(kart, state);
      state.projectiles.push({
        x: mx,
        y: my,
        elev: mElev,
        angle: kart.angle,
        life: MISSILE_LIFE,
        maxLife: MISSILE_LIFE,
        ownerId: kart.id,
        speed: MISSILE_SPEED * (place === 1 ? 0.9 : 1),
        vz: 18,
        heatSeek: true,
        targetId: lock ? lock.id : null, // single lock — never multi-wipe
      });
      if (kart.isPlayer) pushEvent(state, "missile");
    }
  }

  function updateHazards(state, dt) {
    var next = [];
    var i, h, k, kart;
    for (i = 0; i < state.hazards.length; i++) {
      h = state.hazards[i];
      h.life -= dt;
      if (h.ownerGrace > 0) h.ownerGrace -= dt;
      if (h.life <= 0) continue;
      for (k = 0; k < state.karts.length; k++) {
        kart = state.karts[k];
        if (kart.id === h.ownerId && h.ownerGrace > 0) continue;
        if (kart.finished || kart.stunT > 0) continue;
        if (kart.shieldT > 0) continue;
        if (dist(kart.x, kart.y, h.x, h.y) < KART_RADIUS + h.radius) {
          kart.slowT = Math.max(kart.slowT, OIL_SLOW_DURATION);
          kart.speed *= 0.4;
          h.life = 0;
          break;
        }
      }
      if (h.life > 0) next.push(h);
    }
    state.hazards = next;
  }

  /**
   * Missile detonation: car is temporarily destroyed (explodedT), then reappears dazed.
   */
  function applyMissileBlast(kart, state) {
    if (!kart || kart.explodedT > 0.2) return false;
    // Shield absorbs the hit
    if (kart.shieldT > 0) {
      kart.shieldT = 0;
      if (state) pushEvent(state, "shield");
      return false;
    }
    kart.explodedT = EXPLODE_DURATION;
    kart.stunT = EXPLODE_DURATION + EXPLODE_RECOVER;
    kart.slowT = Math.max(kart.slowT, HIT_SLOW_DURATION + 0.6);
    kart.speed = 0;
    kart.vx = 0;
    kart.vy = 0;
    kart.boostT = 0;
    kart.item = null;
    kart.draftStrength = 0;
    kart.drafting = false;
    kart.damage = Math.min(1, (kart.damage || 0) + 0.45);
    if (state) {
      if (!state.explosions) state.explosions = [];
      state.explosions.push({
        x: kart.x,
        y: kart.y,
        elev: kart.elev || 0,
        life: 1.05,
        maxLife: 1.05,
        kartId: kart.id,
      });
      if (kart.isPlayer) {
        pushEvent(state, "hit");
        state.hitStop = Math.max(state.hitStop || 0, 0.09);
        state.cameraPunch = Math.max(state.cameraPunch || 0, 0.85);
      } else {
        pushEvent(state, "explode");
        state.cameraPunch = Math.max(state.cameraPunch || 0, 0.35);
      }
    }
    return true;
  }

  /** True if (tx,ty) is ahead of (ox,oy) facing angle within cone + range. */
  function isAheadOf(ox, oy, oAngle, tx, ty, maxDist, coneCos) {
    var dx = tx - ox;
    var dy = ty - oy;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 4 || d > maxDist) return false;
    var along = (dx * Math.cos(oAngle) + dy * Math.sin(oAngle)) / d;
    return along >= (coneCos != null ? coneCos : MISSILE_SEEK_CONE);
  }

  function findOwnerKart(state, ownerId) {
    var i;
    for (i = 0; i < state.karts.length; i++) {
      if (state.karts[i].id === ownerId) return state.karts[i];
    }
    return null;
  }

  /**
   * Single nearest racer/traffic directly in front of shooter (for missile lock).
   * One lock only — missile never multi-wipes the pack.
   */
  function pickNearestAheadTarget(owner, state) {
    if (!owner) return null;
    var best = null;
    var bestD = Infinity;
    var i, kart, d;
    for (i = 0; i < state.karts.length; i++) {
      kart = state.karts[i];
      if (kart.id === owner.id || kart.finished) continue;
      if (kart.explodedT > 0.25) continue;
      if (
        !isAheadOf(
          owner.x,
          owner.y,
          owner.angle,
          kart.x,
          kart.y,
          MISSILE_SEEK_RANGE,
          MISSILE_SEEK_CONE
        )
      ) {
        continue;
      }
      d = dist(owner.x, owner.y, kart.x, kart.y);
      if (d < bestD) {
        bestD = d;
        best = kart;
      }
    }
    return best;
  }

  function findKartById(state, id) {
    if (id == null) return null;
    var i;
    for (i = 0; i < state.karts.length; i++) {
      if (state.karts[i].id === id) return state.karts[i];
    }
    return null;
  }

  /**
   * Heat-seek target for a missile — locked single target only.
   * Re-acquires nearest ahead of owner if lock lost (still one at a time).
   */
  function pickMissileTarget(p, state, owner) {
    var locked = findKartById(state, p.targetId);
    if (
      locked &&
      !locked.finished &&
      !(locked.explodedT > 0.25) &&
      dist(p.x, p.y, locked.x, locked.y) < MISSILE_SEEK_RANGE * 1.2
    ) {
      return locked;
    }
    // Re-lock only one nearest car still ahead of owner
    var next = pickNearestAheadTarget(owner, state);
    if (next) p.targetId = next.id;
    else p.targetId = null;
    return next;
  }

  function updateProjectiles(state, dt) {
    var next = [];
    var i, p, k, kart, roadElev, age, arc, owner, target, desired, err, maxTurn;
    var hitDone;
    for (i = 0; i < state.projectiles.length; i++) {
      p = state.projectiles[i];
      p.life -= dt;
      if (p.life <= 0) {
        // Expire quietly — no multi-car wipe
        continue;
      }
      owner = findOwnerKart(state, p.ownerId);

      // ---- Heat-seek ONE locked target ahead ----
      if (p.heatSeek !== false) {
        target = pickMissileTarget(p, state, owner);
        if (target) {
          desired = angleTo(p.x, p.y, target.x, target.y);
          err = normAngle(desired - p.angle);
          maxTurn = MISSILE_TURN_RATE * dt;
          if (err > maxTurn) err = maxTurn;
          if (err < -maxTurn) err = -maxTurn;
          p.angle += err;
          p.speed = Math.min(
            MISSILE_SPEED * 1.12,
            (p.speed || MISSILE_SPEED) + 35 * dt
          );
        }
      }

      p.x += Math.cos(p.angle) * p.speed * dt;
      p.y += Math.sin(p.angle) * p.speed * dt;
      roadElev = 0;
      if (state.metrics) {
        var pr = projectOnTrack(p.x, p.y, state.track.waypoints, state.metrics);
        roadElev = pr.elev || 0;
      }
      age = 1 - p.life / (p.maxLife || MISSILE_LIFE);
      arc = Math.sin(Math.min(1, age) * Math.PI) * 14;
      if (p.vz == null) p.vz = 12;
      p.vz -= 22 * dt;
      p.elev = roadElev + MISSILE_AIR_HEIGHT + Math.max(0, arc + p.vz * 0.08);
      if (
        p.x < -40 ||
        p.y < -40 ||
        p.x > state.track.worldW + 40 ||
        p.y > state.track.worldH + 40
      ) {
        continue;
      }

      // Hit only the locked target (or nearest accidental contact with lock only)
      hitDone = false;
      target = findKartById(state, p.targetId);
      if (
        target &&
        !target.finished &&
        !(target.explodedT > 0.25) &&
        dist(p.x, p.y, target.x, target.y) < KART_RADIUS + MISSILE_RADIUS
      ) {
        if (applyMissileBlast(target, state)) {
          hitDone = true;
          if (owner && owner.isPlayer) {
            addStyle(owner, state, 150, "HIT!");
            pushEvent(state, "hit");
          }
        }
      }
      // Missile dies after one car
      if (!hitDone) next.push(p);
    }
    state.projectiles = next;

    // Tick explosion FX timers
    if (state.explosions && state.explosions.length) {
      var exNext = [];
      for (i = 0; i < state.explosions.length; i++) {
        var ex = state.explosions[i];
        ex.life -= dt;
        if (ex.life > 0) exNext.push(ex);
      }
      state.explosions = exNext;
    }
  }

  function updateItemBoxes(state, dt) {
    var i, box;
    for (i = 0; i < state.itemBoxes.length; i++) {
      box = state.itemBoxes[i];
      if (!box.active) {
        box.respawnT -= dt;
        if (box.respawnT <= 0) {
          box.active = true;
          box.respawnT = 0;
        }
      }
    }
  }

  /**
   * Rankings: unfinished karts ordered by totalProgress desc;
   * finished karts keep finish place. Returns array of {id, place, laps, progress, finished, isPlayer}.
   */
  function computeRankings(state) {
    var finished = [];
    var racing = [];
    var i, k;
    for (i = 0; i < state.karts.length; i++) {
      k = state.karts[i];
      // Oncoming traffic is not in the race standings
      if (k.isTraffic) continue;
      if (k.finished) finished.push(k);
      else racing.push(k);
    }
    finished.sort(function (a, b) {
      return a.finishPlace - b.finishPlace;
    });
    racing.sort(function (a, b) {
      if (b.totalProgress !== a.totalProgress)
        return b.totalProgress - a.totalProgress;
      return b.laps - a.laps;
    });
    var ranks = [];
    var place = 1;
    for (i = 0; i < finished.length; i++) {
      k = finished[i];
      ranks.push({
        id: k.id,
        place: k.finishPlace || place,
        laps: k.laps,
        progress: k.progress,
        totalProgress: k.totalProgress,
        finished: true,
        isPlayer: k.isPlayer,
        item: k.item,
        name: k.displayName || (k.isPlayer ? "YOU" : "CPU" + k.id),
      });
      place = Math.max(place, (k.finishPlace || place) + 1);
    }
    for (i = 0; i < racing.length; i++) {
      k = racing[i];
      ranks.push({
        id: k.id,
        place: place++,
        laps: k.laps,
        progress: k.progress,
        totalProgress: k.totalProgress,
        finished: false,
        isPlayer: k.isPlayer,
        item: k.item,
        name: k.displayName || (k.isPlayer ? "YOU" : "CPU" + k.id),
      });
    }
    // normalize places 1..n in order
    for (i = 0; i < ranks.length; i++) ranks[i].place = i + 1;
    return ranks;
  }

  function playerResult(state) {
    var ranks = state.rankings.length ? state.rankings : computeRankings(state);
    var i, r;
    for (i = 0; i < ranks.length; i++) {
      if (ranks[i].isPlayer) {
        return {
          place: ranks[i].place,
          win: ranks[i].place === 1 && ranks[i].finished,
          lose: ranks[i].finished && ranks[i].place > 1,
          finished: ranks[i].finished,
        };
      }
    }
    return { place: 0, win: false, lose: false, finished: false };
  }

  /**
   * One simulation frame.
   * inputs: array of input objects aligned with karts, or map id->input.
   * For missing AI inputs, pass null and call setAIInputs or provide via inputs.
   */
  function setPaused(state, paused) {
    if (!state || state.phase === "results") return state;
    if (paused) {
      state._phaseBeforePause = state.phase;
      state.phase = "paused";
    } else {
      state.phase =
        state._phaseBeforePause === "countdown" ? "countdown" : "racing";
      state._phaseBeforePause = null;
    }
    return state;
  }

  function step(state, inputs, dt) {
    if (dt <= 0) return state;
    if (state.phase === "results") {
      state.podiumT = (state.podiumT || 0) + dt;
      return state;
    }
    if (state.phase === "paused") return state;

    // cap dt for stability
    if (dt > 0.05) dt = 0.05;
    state.events = [];

    // Instant replay scrub (no new input; poses from ring buffer)
    if (state.phase === "replay") {
      state.replayPlayT = (state.replayPlayT || 0) + dt;
      var dur = state.replayDuration || REPLAY_PLAY_DURATION;
      var frac = clamp(state.replayPlayT / dur, 0, 1);
      applyReplayFrame(state, frac);
      if (state.cameraPunch > 0) {
        state.cameraPunch = Math.max(0, state.cameraPunch - dt * 2);
      }
      if (state.replayPlayT >= dur) {
        finalizeResults(state);
      }
      return state;
    }

    // Start-lights ceremony — hold the field until GO
    if (state.phase === "countdown") {
      tickCountdown(state, dt);
      // Pin karts: zero control during lights (traffic also held)
      var ci;
      for (ci = 0; ci < state.karts.length; ci++) {
        state.karts[ci].speed = 0;
        state.karts[ci].vx = 0;
        state.karts[ci].vy = 0;
      }
      state.rankings = computeRankings(state);
      return state;
    }

    state.time += dt;
    state.raceClock = state.time;
    // Presentation hit-stop / punch decay (pure timers; main may scale frame dt)
    if (state.hitStop > 0) state.hitStop = Math.max(0, state.hitStop - dt);
    if (state.cameraPunch > 0) {
      state.cameraPunch = Math.max(0, state.cameraPunch - dt * 3.5);
    }
    // Leader progress for rubber-band (racers only)
    var leadP = -Infinity;
    var li, lk;
    for (li = 0; li < state.karts.length; li++) {
      lk = state.karts[li];
      if (lk.isTraffic) continue;
      if ((lk.totalProgress || 0) > leadP) leadP = lk.totalProgress || 0;
    }
    state._leaderProgress = leadP;

    var i, kart, input;
    for (i = 0; i < state.karts.length; i++) {
      kart = state.karts[i];
      input =
        inputs && inputs[i]
          ? inputs[i]
          : inputs && inputs[kart.id]
            ? inputs[kart.id]
            : emptyInput();
      driveKart(kart, input, dt, state);
      tryPickup(kart, state);
      useItem(kart, input, state);
    }

    // Solid body blocking — cannot drive through other karts
    resolveKartCollisions(state);

    // Slipstream / draft detection (after positions settle)
    applyDrafting(state);

    // Ring-buffer poses for finish instant-replay
    pushReplaySnapshot(state);

    updateHazards(state, dt);
    updateProjectiles(state, dt);
    updateItemBoxes(state, dt);

    state.rankings = computeRankings(state);
    // Mirror player wrong-way to state for HUD
    state.wrongWay = false;
    state.playerPlace = 1;
    for (i = 0; i < state.karts.length; i++) {
      if (state.karts[i].isPlayer) {
        state.wrongWay = !!state.karts[i].wrongWay;
        break;
      }
    }
    for (i = 0; i < state.rankings.length; i++) {
      if (state.rankings[i].isPlayer) {
        state.playerPlace = state.rankings[i].place;
        break;
      }
    }
    // Rival = racer one place ahead of player (pressure loop)
    // Overtake reward + last-lap flag + gap-to-rival
    state.lastLap = false;
    state.rivalGap = null;
    state.missileLockId = null;
    for (i = 0; i < state.karts.length; i++) {
      if (!state.karts[i].isPlayer) continue;
      var pk = state.karts[i];
      var myPlace = state.playerPlace || 99;
      var rival = null;
      var j, r;
      for (j = 0; j < state.rankings.length; j++) {
        r = state.rankings[j];
        if (r.place === myPlace - 1) {
          rival = findKartById(state, r.id);
          break;
        }
      }
      pk.rivalId = rival ? rival.id : null;
      state.rivalId = rival ? rival.id : null;
      if (rival) {
        state.rivalGap = Math.max(
          0,
          (rival.totalProgress || 0) - (pk.totalProgress || 0)
        );
      }
      // Overtake / pass chain juice + place-up flash + rival taunt
      if (pk.lastPlace > 0 && myPlace < pk.lastPlace && !pk.finished) {
        var gained = pk.lastPlace - myPlace;
        if (pk.passChainT > 0) pk.passChain = (pk.passChain || 0) + gained;
        else pk.passChain = gained;
        pk.passChainT = PASS_CHAIN_WINDOW;
        state.passChain = pk.passChain;
        state.placeFlash = "↑ P" + myPlace;
        state.placeFlashT = 1.4;
        // Taunt the named racer we just jumped (was one place ahead)
        var passed = null;
        var rj, rr;
        for (rj = 0; rj < state.rankings.length; rj++) {
          rr = state.rankings[rj];
          if (rr.place === myPlace + 1 && !rr.isPlayer) {
            passed = findKartById(state, rr.id);
            break;
          }
        }
        // Prefer rival we overtook by scanning who lost place
        if (!passed) {
          for (rj = 0; rj < state.karts.length; rj++) {
            if (
              !state.karts[rj].isPlayer &&
              !state.karts[rj].isTraffic &&
              state.karts[rj].lastPlace === myPlace
            ) {
              passed = state.karts[rj];
              break;
            }
          }
        }
        if (passed && passed.displayName) {
          var line =
            RIVAL_TAUNTS[
              Math.floor((state.rng ? state.rng() : Math.random()) * RIVAL_TAUNTS.length)
            ];
          state.taunt = passed.displayName + ": " + line;
          state.tauntT = 1.6;
          pushEvent(state, "taunt");
        }
        var chain = pk.passChain;
        var pts = 80 * gained + Math.max(0, chain - 1) * 40;
        var label =
          chain >= 3
            ? "CHAIN ×" + chain + "!"
            : gained > 1
              ? "MULTI PASS!"
              : chain >= 2
                ? "PASS ×" + chain
                : "PASS!";
        addStyle(pk, state, pts, label);
        pushEvent(state, "placeUp");
        pushEvent(state, chain >= 3 ? "fever" : "driftBoost");
      }
      pk.lastPlace = myPlace;
      state.passChain = pk.passChain || 0;
      if (state.placeFlashT > 0) {
        state.placeFlashT -= dt;
        if (state.placeFlashT <= 0) state.placeFlash = "";
      }
      if (state.tauntT > 0) {
        state.tauntT -= dt;
        if (state.tauntT <= 0) state.taunt = "";
      }

      // Ghost PB gap + world pose for translucent ghost car
      if (state.ghostPbTime && state.ghostPbTime > 0 && state.metrics) {
        var raceDist = state.metrics.total * state.numLaps;
        var expected =
          (state.time / state.ghostPbTime) * raceDist;
        state.ghostDelta = (pk.totalProgress || 0) - expected;
        state.ghostPose = poseAlongTrack(state, expected);
      } else {
        state.ghostDelta = null;
        state.ghostPose = null;
      }

      // Final lap intensity
      if (
        !pk.finished &&
        state.numLaps > 1 &&
        (pk.laps || 0) >= state.numLaps - 1
      ) {
        state.lastLap = true;
      }
      break;
    }
    // Active missile lock for HUD (player shots only)
    if (state.projectiles && state.projectiles.length) {
      for (i = 0; i < state.projectiles.length; i++) {
        var mp = state.projectiles[i];
        var own = findOwnerKart(state, mp.ownerId);
        if (own && own.isPlayer && mp.targetId != null) {
          state.missileLockId = mp.targetId;
          break;
        }
      }
    }

    // End when all racers done, OR player finished and grace timer expired
    // (don't force the player to wait for every CPU to limp home).
    var allDone = true;
    var playerKart = null;
    for (i = 0; i < state.karts.length; i++) {
      if (state.karts[i].isTraffic) continue;
      if (state.karts[i].isPlayer) playerKart = state.karts[i];
      if (!state.karts[i].finished) allDone = false;
    }
    if (playerKart && playerKart.finished) {
      if (state.playerFinishGraceT == null) {
        state.playerFinishGraceT = PLAYER_FINISH_GRACE;
      } else if (state.playerFinishGraceT > 0) {
        state.playerFinishGraceT -= dt;
      }
    }
    var graceExpired =
      playerKart &&
      playerKart.finished &&
      state.playerFinishGraceT != null &&
      state.playerFinishGraceT <= 0;
    if (allDone || graceExpired) {
      openResults(state);
    }

    return state;
  }

  /**
   * AI: racers + same-way traffic follow waypoints forward; oncoming goes reverse.
   */
  function aiInput(kart, state) {
    var input = emptyInput();
    if (kart.finished || kart.stunT > 0 || kart.explodedT > 0) return input;
    var wps = state.track.waypoints;
    var n = wps.length;
    // Racing-line look-ahead scales with speed; farther for AI racers on rubber-band
    var look = 3 + Math.floor(Math.abs(kart.speed) / 70);
    if (!kart.isTraffic && state._leaderProgress != null) {
      var gapAi = state._leaderProgress - (kart.totalProgress || 0);
      if (gapAi > RUBBER_BAND_GAP) look += 2;
    }
    var targetIdx;
    if (kart.direction < 0) {
      targetIdx = (kart.checkpoint - look + n * 4) % n;
    } else {
      targetIdx = (kart.checkpoint + look) % n;
    }
    var t = wps[targetIdx];
    // Bias into racing line (slightly inside right lane for racers)
    var desired = angleTo(kart.x, kart.y, t.x, t.y);
    var laneN = desired + Math.PI / 2;
    var lanePull = kart.isTraffic
      ? kart.direction < 0
        ? 12
        : -10
      : -4;
    if (kart.vehicleType === "bus") lanePull *= 1.15;
    var aimX = t.x + Math.cos(laneN) * lanePull;
    var aimY = t.y + Math.sin(laneN) * lanePull;
    desired = angleTo(kart.x, kart.y, aimX, aimY);
    var err = normAngle(desired - kart.angle);
    if (err < -0.08) input.left = true;
    else if (err > 0.08) input.right = true;
    // Drift on medium corners for AI racers (fill meter addictively)
    if (
      !kart.isTraffic &&
      Math.abs(err) > 0.35 &&
      Math.abs(err) < 1.1 &&
      kart.speed > DRIFT_MIN_SPEED
    ) {
      input.drift = true;
    }
    var turnSlow =
      Math.abs(err) > 0.9 && kart.speed > (kart.isTraffic ? 55 : 100);
    if (turnSlow) {
      input.brake = true;
    } else {
      input.accel = true;
    }
    // Hard difficulty + per-rival aggression: item hunger
    var itemHunger = 0.01;
    if ((state.difficulty || "normal") === "hard") itemHunger = 0.04;
    if ((state.difficulty || "normal") === "easy") itemHunger = 0.005;
    if (state.lastLap) itemHunger *= 1.8;
    itemHunger *= kart.aggression != null ? kart.aggression : 1;
    if (kart.item && !kart.isTraffic) {
      var ranks = state.rankings.length
        ? state.rankings
        : computeRankings(state);
      var myPlace = 99;
      var j;
      for (j = 0; j < ranks.length; j++) {
        if (ranks[j].id === kart.id) myPlace = ranks[j].place;
      }
      if (kart.item === "boost" && (myPlace > 1 || kart.speed < 80)) {
        input.useItem = true;
      } else if (kart.item === "missile" && myPlace > 1) {
        input.useItem = true;
      } else if (kart.item === "shock" && myPlace > 1) {
        input.useItem = true;
      } else if (kart.item === "shield" && myPlace === 1) {
        input.useItem = true;
      } else if (kart.item === "oil" && myPlace === 1) {
        input.useItem = true;
      } else if (kart.item && state.rng() < itemHunger) {
        input.useItem = true;
      }
    }
    return input;
  }

  function buildInputs(state, playerInput) {
    var inputs = [];
    var i, kart;
    for (i = 0; i < state.karts.length; i++) {
      kart = state.karts[i];
      if (kart.isPlayer) {
        inputs.push(playerInput || emptyInput());
      } else {
        inputs.push(aiInput(kart, state));
      }
    }
    return inputs;
  }

  /**
   * Next-direction hint for HUD: signed turn bias (-1 left … +1 right)
   * relative to kart heading toward a look-ahead waypoint.
   */
  function getNextDirectionHint(kart, state) {
    if (!kart || !state || !state.track) {
      return { turn: 0, aheadAngle: 0, label: "—" };
    }
    var wps = state.track.waypoints;
    var n = wps.length;
    var look = 6 + Math.floor(Math.abs(kart.speed) / 50);
    var idx = (kart.checkpoint + look) % n;
    if (kart.direction < 0) idx = (kart.checkpoint - look + n * 4) % n;
    var t = wps[idx];
    var desired = angleTo(kart.x, kart.y, t.x, t.y);
    var err = normAngle(desired - kart.angle);
    var turn = clamp(err / 1.2, -1, 1);
    var label = "↑";
    if (err < -0.35) label = "←";
    else if (err > 0.35) label = "→";
    else if (Math.abs(err) > 0.15) label = err < 0 ? "↖" : "↗";
    if (kart.wrongWay) label = "↺";
    return { turn: turn, aheadAngle: desired, err: err, label: label };
  }

  // --- test/helper exports for granting items without RNG ---
  function grantItem(kart, type) {
    if (ITEM_TYPES.indexOf(type) < 0) throw new Error("unknown item " + type);
    // Instant grant for tests / AI — skips roulette
    kart.item = type;
    kart.itemPending = null;
    kart.itemSpinT = 0;
    kart.itemPreview = null;
  }

  /**
   * Begin item roulette as if a box was hit (testable without geometry).
   * Final item is locked in itemPending; settles after ITEM_SPIN_DURATION.
   */
  function beginItemSpin(kart, state, forcedType) {
    if (!kart || kart.isTraffic) return null;
    var place = state ? playerPlaceOf(state, kart.id) : 2;
    var n = state ? racerCount(state) : 4;
    var rng = state && state.rng ? state.rng : Math.random;
    kart.itemPending =
      forcedType && ITEM_TYPES.indexOf(forcedType) >= 0
        ? forcedType
        : pickItem(rng, place, n);
    kart.item = null;
    kart.itemSpinT = ITEM_SPIN_DURATION;
    kart.itemSpinTick = 0;
    kart.itemPreview = ITEM_TYPES[0];
    if (kart.isPlayer && state) pushEvent(state, "pickup");
    return kart.itemPending;
  }

  function applyHit(kart, state) {
    // Generic hit uses full missile blast so tests/FX stay consistent
    applyMissileBlast(kart, state || null);
  }

  var api = {
    createRace: createRace,
    step: step,
    emptyInput: emptyInput,
    computeRankings: computeRankings,
    playerResult: playerResult,
    aiInput: aiInput,
    buildInputs: buildInputs,
    grantItem: grantItem,
    beginItemSpin: beginItemSpin,
    applyHit: applyHit,
    projectOnTrack: projectOnTrack,
    sampleKartElev: sampleKartElev,
    stickToRoad: stickToRoad,
    isOnTrack: isOnTrack,
    driveKart: driveKart,
    resolveKartCollisions: resolveKartCollisions,
    applyDrafting: applyDrafting,
    applyMissileBlast: applyMissileBlast,
    tryPickup: tryPickup,
    useItem: useItem,
    pickItem: pickItem,
    setPaused: setPaused,
    playerPlaceOf: playerPlaceOf,
    getNextDirectionHint: getNextDirectionHint,
    pickNearestAheadTarget: pickNearestAheadTarget,
    addStyle: addStyle,
    tickCountdown: tickCountdown,
    countdownLabelFor: countdownLabelFor,
    steerRateAtSpeed: steerRateAtSpeed,
    rubberBandMult: rubberBandMult,
    shortcutGripMult: shortcutGripMult,
    openResults: openResults,
    finalizeResults: finalizeResults,
    pushReplaySnapshot: pushReplaySnapshot,
    applyReplayFrame: applyReplayFrame,
    poseAlongTrack: poseAlongTrack,
    AI_RIVALS: AI_RIVALS,
    RIVAL_TAUNTS: RIVAL_TAUNTS,
    ITEM_TYPES: ITEM_TYPES,
    constants: {
      COUNTDOWN_TOTAL: COUNTDOWN_TOTAL,
      COUNTDOWN_SEG: COUNTDOWN_SEG,
      PLAYER_FINISH_GRACE: PLAYER_FINISH_GRACE,
      SHORTCUT_ALONG_FRAC: SHORTCUT_ALONG_FRAC,
      REPLAY_BUFFER_MAX: REPLAY_BUFFER_MAX,
      REPLAY_PLAY_DURATION: REPLAY_PLAY_DURATION,
      STEER_LOW_FRAC: STEER_LOW_FRAC,
      STEER_HIGH_FRAC: STEER_HIGH_FRAC,
      RUBBER_BAND_GAP: RUBBER_BAND_GAP,
      RUBBER_BAND_MAX: RUBBER_BAND_MAX,
      LAST_LAP_RUBBER: LAST_LAP_RUBBER,
      ACCEL: ACCEL,
      MAX_SPEED: MAX_SPEED,
      OFFTRACK_MAX: OFFTRACK_MAX,
      BOOST_MULT: BOOST_MULT,
      BOOST_DURATION: BOOST_DURATION,
      KART_RADIUS: KART_RADIUS,
      KART_COLLIDE_RADIUS: KART_COLLIDE_RADIUS,
      VEHICLE_COLLIDE: VEHICLE_COLLIDE,
      DRAFT_RANGE: DRAFT_RANGE,
      DRAFT_MAX_BONUS: DRAFT_MAX_BONUS,
      ITEM_BOX_RADIUS: ITEM_BOX_RADIUS,
      ITEM_SPIN_DURATION: ITEM_SPIN_DURATION,
      PASS_CHAIN_WINDOW: PASS_CHAIN_WINDOW,
      MISSILE_SPEED: MISSILE_SPEED,
      MISSILE_SEEK_RANGE: MISSILE_SEEK_RANGE,
      MISSILE_TURN_RATE: MISSILE_TURN_RATE,
      FEVER_MULT: FEVER_MULT,
      NEAR_MISS_DIST: NEAR_MISS_DIST,
      OIL_RADIUS: OIL_RADIUS,
      STUN_DURATION: STUN_DURATION,
      EXPLODE_DURATION: EXPLODE_DURATION,
      HIT_SLOW_DURATION: HIT_SLOW_DURATION,
      DRIFT_MIN_SPEED: DRIFT_MIN_SPEED,
      DRIFT_FILL_RATE: DRIFT_FILL_RATE,
      DRIFT_BOOST_THRESHOLD: DRIFT_BOOST_THRESHOLD,
      DRIFT_BOOST_DURATION: DRIFT_BOOST_DURATION,
      DRIFT_BOOST_MULT: DRIFT_BOOST_MULT,
      SHIELD_DURATION: SHIELD_DURATION,
      SHOCK_RANGE: SHOCK_RANGE,
      RUBBER_BAND_GAP: RUBBER_BAND_GAP,
      RUBBER_BAND_MAX: RUBBER_BAND_MAX,
    },
  };

  root.NeoKartEngine = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
