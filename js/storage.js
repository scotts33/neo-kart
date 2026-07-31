/**
 * Local progression: settings, best times, cup points.
 * Pure helpers + localStorage when available.
 */
(function (root) {
  "use strict";

  var PREFIX = "neoKart2026_";

  function memStore() {
    var m = {};
    return {
      getItem: function (k) {
        return m.hasOwnProperty(k) ? m[k] : null;
      },
      setItem: function (k, v) {
        m[k] = String(v);
      },
      removeItem: function (k) {
        delete m[k];
      },
    };
  }

  var store = null;
  function getStore() {
    if (store) return store;
    try {
      if (root.localStorage) {
        root.localStorage.setItem(PREFIX + "ping", "1");
        root.localStorage.removeItem(PREFIX + "ping");
        store = root.localStorage;
        return store;
      }
    } catch (e) {}
    store = memStore();
    return store;
  }

  /** For tests: inject a memory store */
  function useMemoryStore() {
    store = memStore();
    return store;
  }

  function loadJSON(key, fallback) {
    try {
      var raw = getStore().getItem(PREFIX + key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, val) {
    try {
      getStore().setItem(PREFIX + key, JSON.stringify(val));
      return true;
    } catch (e) {
      return false;
    }
  }

  var DEFAULT_SETTINGS = {
    volume: 0.7, // SFX (legacy key)
    musicVolume: 0.35,
    camera: "chase", // chase | cockpit
    quality: "high", // high default (ultra opt-in)
    tipsDismissed: false,
    paintIndex: 0,
    difficulty: "normal", // easy | normal | hard
    stickDeadzone: 0.22,
    stickSensitivity: 1.0,
  };

  function loadSettings() {
    var s = loadJSON("settings", {});
    var out = {};
    var k;
    for (k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
    for (k in s) if (s.hasOwnProperty(k)) out[k] = s[k];
    return out;
  }

  function saveSettings(s) {
    var cur = loadSettings();
    var k;
    for (k in s) if (s.hasOwnProperty(k)) cur[k] = s[k];
    return saveJSON("settings", cur);
  }

  /**
   * Best race time (seconds) per course id — lower is better.
   * Only finished races should call recordBestTime.
   */
  function getBestTime(courseId) {
    var all = loadJSON("bestTimes", {});
    return all[courseId] != null ? all[courseId] : null;
  }

  function recordBestTime(courseId, seconds) {
    if (seconds == null || !(seconds > 0)) return getBestTime(courseId);
    var all = loadJSON("bestTimes", {});
    var prev = all[courseId];
    if (prev == null || seconds < prev) {
      all[courseId] = seconds;
      saveJSON("bestTimes", all);
      return seconds;
    }
    return prev;
  }

  function getAllBestTimes() {
    return loadJSON("bestTimes", {});
  }

  /**
   * Cup: ordered course list, points by place [1st,2nd,3rd,4th+]
   */
  var CUP_POINTS = [10, 7, 5, 3];
  var CUP_COURSES = ["dubai", "neo-tokyo", "harbor", "shanghai"];

  function getCupState() {
    var c = loadJSON("cup", null);
    if (!c || !c.points) {
      return {
        points: {},
        racesDone: [],
        active: false,
        index: 0,
      };
    }
    return c;
  }

  function saveCupState(c) {
    return saveJSON("cup", c);
  }

  function startCup() {
    var c = {
      points: {},
      racesDone: [],
      active: true,
      index: 0,
    };
    saveCupState(c);
    return c;
  }

  function cupPointsForPlace(place) {
    if (place <= 0) return 0;
    if (place <= CUP_POINTS.length) return CUP_POINTS[place - 1];
    return 1;
  }

  /**
   * Record a cup race finish once per course. Re-calling with the same
   * courseId does not add points again (idempotent for HUD re-renders).
   * Returns updated cup state; { skipped: true } if already recorded.
   */
  function recordCupRace(courseId, place, playerId) {
    playerId = playerId != null ? playerId : "player";
    var c = getCupState();
    if (!c.active) c.active = true;
    if (!c.points[playerId]) c.points[playerId] = 0;
    // Idempotent: same course already counted this cup
    if (c.racesDone && c.racesDone.indexOf(courseId) >= 0) {
      c.skipped = true;
      return c;
    }
    c.skipped = false;
    c.points[playerId] += cupPointsForPlace(place);
    if (!c.racesDone) c.racesDone = [];
    c.racesDone.push(courseId);
    c.index = Math.min(CUP_COURSES.length, c.racesDone.length);
    if (c.index >= CUP_COURSES.length) c.active = false;
    saveCupState(c);
    return c;
  }

  function nextCupCourse() {
    var c = getCupState();
    if (c.index >= CUP_COURSES.length) return null;
    return CUP_COURSES[c.index];
  }

  function clearCup() {
    var c = { points: {}, racesDone: [], active: false, index: 0 };
    saveCupState(c);
    return c;
  }

  /**
   * Session meta — "one more race" hooks (persists across races until clear).
   * { races, wins, winStreak, bestWinStreak, lastPlace, lastCourseId }
   */
  function getSessionState() {
    var s = loadJSON("session", null);
    if (!s || typeof s.races !== "number") {
      return {
        races: 0,
        wins: 0,
        winStreak: 0,
        bestWinStreak: 0,
        lastPlace: 0,
        lastCourseId: null,
      };
    }
    return s;
  }

  function saveSessionState(s) {
    return saveJSON("session", s);
  }

  function clearSession() {
    var s = {
      races: 0,
      wins: 0,
      winStreak: 0,
      bestWinStreak: 0,
      lastPlace: 0,
      lastCourseId: null,
    };
    saveSessionState(s);
    return s;
  }

  /**
   * Record one race finish into session streaks.
   * place 1 grows winStreak; any other place breaks it.
   * Idempotent key optional: same finishKey not double-counted.
   */
  function recordSessionFinish(place, courseId, finishKey) {
    var s = getSessionState();
    if (finishKey && s.lastFinishKey === finishKey) {
      s.skipped = true;
      return s;
    }
    s.skipped = false;
    s.races = (s.races || 0) + 1;
    s.lastPlace = place;
    s.lastCourseId = courseId || null;
    if (finishKey) s.lastFinishKey = finishKey;
    if (place === 1) {
      s.wins = (s.wins || 0) + 1;
      s.winStreak = (s.winStreak || 0) + 1;
      if (s.winStreak > (s.bestWinStreak || 0)) s.bestWinStreak = s.winStreak;
    } else {
      s.winStreak = 0;
    }
    saveSessionState(s);
    return s;
  }

  /**
   * Career / unlock meta — EA-style durable progression beyond a single PB.
   * Default paints 0–3 free; 4–7 gated by wins. Night course gated by career wins.
   */
  var FREE_PAINTS = [0, 1, 2, 3];
  var PAINT_CATALOG = [
    { id: 0, name: "Deep Blue", requiresWins: 0 },
    { id: 1, name: "Red", requiresWins: 0 },
    { id: 2, name: "Pearl White", requiresWins: 0 },
    { id: 3, name: "Black", requiresWins: 0 },
    { id: 4, name: "Midnight Silver", requiresWins: 1 },
    { id: 5, name: "Stealth Grey", requiresWins: 2 },
    { id: 6, name: "Quicksilver", requiresWins: 3 },
    { id: 7, name: "Ultra Red", requiresWins: 5 },
  ];
  var COURSE_UNLOCKS = {
    "neo-tokyo-night": { requiresWins: 2, label: "Neo Tokyo Night" },
  };
  var BASE_COURSES = ["dubai", "neo-tokyo", "harbor", "shanghai", "red-rock"];

  function defaultCareer() {
    return {
      xp: 0,
      level: 1,
      totalWins: 0,
      totalRaces: 0,
      unlockedPaints: FREE_PAINTS.slice(),
      unlockedCourses: BASE_COURSES.slice(),
      lastUnlocks: [],
    };
  }

  function getCareer() {
    var c = loadJSON("career", null);
    if (!c || typeof c.xp !== "number") return defaultCareer();
    if (!c.unlockedPaints) c.unlockedPaints = FREE_PAINTS.slice();
    if (!c.unlockedCourses) c.unlockedCourses = BASE_COURSES.slice();
    if (!c.lastUnlocks) c.lastUnlocks = [];
    return c;
  }

  function saveCareer(c) {
    return saveJSON("career", c);
  }

  function clearCareer() {
    var c = defaultCareer();
    saveCareer(c);
    return c;
  }

  function isPaintUnlocked(paintId) {
    var c = getCareer();
    return (c.unlockedPaints || []).indexOf(paintId) >= 0;
  }

  function isCourseUnlocked(courseId) {
    if (!COURSE_UNLOCKS[courseId]) return true;
    var c = getCareer();
    return (c.unlockedCourses || []).indexOf(courseId) >= 0;
  }

  function xpForPlace(place) {
    if (place === 1) return 100;
    if (place === 2) return 70;
    if (place === 3) return 50;
    return 30;
  }

  /**
   * Award XP / wins and grant any newly earned paints or courses.
   * Idempotent via finishKey on career.lastFinishKey.
   */
  function awardCareerProgress(place, finishKey) {
    var c = getCareer();
    var out = { career: c, newUnlocks: [], xpGained: 0, skipped: false };
    if (finishKey && c.lastFinishKey === finishKey) {
      out.skipped = true;
      return out;
    }
    if (finishKey) c.lastFinishKey = finishKey;
    c.totalRaces = (c.totalRaces || 0) + 1;
    var xp = xpForPlace(place);
    c.xp = (c.xp || 0) + xp;
    out.xpGained = xp;
    c.level = 1 + Math.floor((c.xp || 0) / 250);
    if (place === 1) c.totalWins = (c.totalWins || 0) + 1;
    var wins = c.totalWins || 0;
    var i, p, u;
    c.lastUnlocks = [];
    for (i = 0; i < PAINT_CATALOG.length; i++) {
      p = PAINT_CATALOG[i];
      if (wins >= p.requiresWins && c.unlockedPaints.indexOf(p.id) < 0) {
        c.unlockedPaints.push(p.id);
        u = { type: "paint", id: p.id, name: p.name };
        c.lastUnlocks.push(u);
        out.newUnlocks.push(u);
      }
    }
    var cid;
    for (cid in COURSE_UNLOCKS) {
      if (!COURSE_UNLOCKS.hasOwnProperty(cid)) continue;
      if (
        wins >= COURSE_UNLOCKS[cid].requiresWins &&
        c.unlockedCourses.indexOf(cid) < 0
      ) {
        c.unlockedCourses.push(cid);
        u = {
          type: "course",
          id: cid,
          name: COURSE_UNLOCKS[cid].label || cid,
        };
        c.lastUnlocks.push(u);
        out.newUnlocks.push(u);
      }
    }
    saveCareer(c);
    out.career = c;
    return out;
  }

  /**
   * Apply finish rewards once for a completed race state.
   * Safe to call many times with the same courseId — cup points only once.
   * opts: { cupMode, place, playerId, finishKey }
   * returns { messageBits, nextCourse, cup, pb, isNewPb, prevPb, pbDelta,
   *           session, rematchHint, career, newUnlocks, placeLabel, nextAction }
   */
  function applyFinishRewards(courseId, raceTimeSec, opts) {
    opts = opts || {};
    var place = opts.place != null ? opts.place : 4;
    var out = {
      messageBits: [],
      nextCourse: null,
      cup: null,
      pb: null,
      prevPb: null,
      isNewPb: false,
      pbDelta: null,
      session: null,
      rematchHint: null,
      career: null,
      newUnlocks: [],
      placeLabel:
        place === 1
          ? "1ST"
          : place === 2
            ? "2ND"
            : place === 3
              ? "3RD"
              : place + "TH",
      nextAction: "Press R to rematch · Esc for courses",
    };
    if (courseId && raceTimeSec > 0) {
      var prev = getBestTime(courseId);
      out.prevPb = prev;
      var pb = recordBestTime(courseId, raceTimeSec);
      out.pb = pb;
      // isNewPb: this finish set (or tied as first) the stored PB
      out.isNewPb = pb === raceTimeSec && (prev == null || raceTimeSec <= prev);
      if (out.isNewPb) {
        if (prev != null && raceTimeSec < prev) {
          out.pbDelta = +(prev - raceTimeSec).toFixed(2);
          out.messageBits.push("NEW PB! −" + out.pbDelta.toFixed(1) + "s");
        } else {
          out.messageBits.push("NEW PB!");
        }
      } else if (prev != null) {
        // Hook: show how close you were — drives rematch
        out.pbDelta = +(raceTimeSec - prev).toFixed(2);
        if (out.pbDelta > 0 && out.pbDelta < 1.5) {
          out.messageBits.push("ALMOST! +" + out.pbDelta.toFixed(1) + "s");
          out.rematchHint = "so close to PB — rematch?";
        } else if (out.pbDelta > 0) {
          out.messageBits.push("+" + out.pbDelta.toFixed(1) + "s vs PB");
          out.rematchHint = "beat your PB";
        }
      }
    }

    // Session streak / win streak — one more race juice
    var finKey =
      opts.finishKey ||
      (courseId && raceTimeSec
        ? courseId + ":" + Math.round(raceTimeSec * 100) + ":" + place
        : null);
    var session = recordSessionFinish(place, courseId, finKey);
    out.session = session;
    if (!session.skipped) {
      if (session.winStreak >= 2) {
        out.messageBits.push("WIN STREAK ×" + session.winStreak);
      } else if (place === 1) {
        out.messageBits.push("WIN!");
      }
      if (session.races >= 2) {
        out.messageBits.push(
          "SESSION " + session.races + " races · " + (session.wins || 0) + " wins"
        );
      }
      if (!out.rematchHint) {
        if (place === 1) out.rematchHint = "defend the streak — race again";
        else if (place === 2) out.rematchHint = "P2 — steal the win";
        else out.rematchHint = "climb the pack — one more";
      }
    }

    // Career XP + unlockable paints / night course
    var careerAward = awardCareerProgress(place, finKey);
    out.career = careerAward.career;
    out.newUnlocks = careerAward.newUnlocks || [];
    if (!careerAward.skipped && careerAward.xpGained) {
      out.messageBits.push("+" + careerAward.xpGained + " XP");
      out.messageBits.push("LVL " + (careerAward.career.level || 1));
    }
    if (out.newUnlocks.length) {
      var ui;
      for (ui = 0; ui < out.newUnlocks.length; ui++) {
        out.messageBits.push("UNLOCKED " + out.newUnlocks[ui].name);
      }
    }

    if (opts.cupMode) {
      var cup = recordCupRace(courseId, place, opts.playerId);
      out.cup = cup;
      out.messageBits.push("CUP " + (cup.points[opts.playerId || "player"] || 0) + " pts");
      var next = nextCupCourse();
      out.nextCourse = next;
      if (next) {
        out.messageBits.push("NEXT: " + next);
        out.nextAction = "Press R for next cup race · Esc for courses";
      } else {
        out.messageBits.push("CUP COMPLETE");
        out.nextAction = "Cup complete — Press R to race again · Esc for courses";
      }
    } else if (out.rematchHint) {
      out.nextAction = out.rematchHint + " · Press R · Esc courses";
    }

    out.messageBits.unshift(out.placeLabel + " PLACE");
    return out;
  }

  var api = {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    getBestTime: getBestTime,
    recordBestTime: recordBestTime,
    getAllBestTimes: getAllBestTimes,
    getCupState: getCupState,
    startCup: startCup,
    recordCupRace: recordCupRace,
    nextCupCourse: nextCupCourse,
    clearCup: clearCup,
    cupPointsForPlace: cupPointsForPlace,
    applyFinishRewards: applyFinishRewards,
    getSessionState: getSessionState,
    recordSessionFinish: recordSessionFinish,
    clearSession: clearSession,
    getCareer: getCareer,
    clearCareer: clearCareer,
    awardCareerProgress: awardCareerProgress,
    isPaintUnlocked: isPaintUnlocked,
    isCourseUnlocked: isCourseUnlocked,
    PAINT_CATALOG: PAINT_CATALOG,
    COURSE_UNLOCKS: COURSE_UNLOCKS,
    CUP_COURSES: CUP_COURSES,
    CUP_POINTS: CUP_POINTS,
    useMemoryStore: useMemoryStore,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
  };

  root.NeoKartStorage = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
