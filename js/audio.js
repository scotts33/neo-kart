/**
 * Procedural Web Audio for Neon Circuit — SFX + lightweight BGM loop.
 * Separate music / SFX gain buses. Safe no-op without AudioContext (Node tests).
 */
(function (root) {
  "use strict";

  var ctx = null;
  var master = null;
  var sfxBus = null;
  var musicBus = null;
  var engineOsc = null;
  var engineGain = null;
  var sfxVolume = 0.7;
  var musicVolume = 0.35;
  var muted = false;
  var musicMuted = false;
  var started = false;
  var musicNodes = null; // { oscs, gains, intervalId or nextNote }
  var musicTimer = null;
  var musicStep = 0;

  // Simple major-pentatonic riff (Hz) — arcade energy, not licensed music
  var MUSIC_NOTES = [196, 247, 294, 330, 392, 330, 294, 247];

  function ensure() {
    if (muted && musicMuted) return null;
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = muted ? 0 : sfxVolume;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = musicMuted ? 0 : musicVolume;
      musicBus.connect(master);
    } catch (e) {
      ctx = null;
      return null;
    }
    return ctx;
  }

  function applyBusGains() {
    if (sfxBus) sfxBus.gain.value = muted || sfxVolume <= 0.001 ? 0 : sfxVolume;
    if (musicBus) {
      musicBus.gain.value =
        musicMuted || musicVolume <= 0.001 ? 0 : musicVolume;
    }
  }

  /** Legacy: sets SFX volume (keeps old call sites working). */
  function setVolume(v) {
    setSfxVolume(v);
  }

  function getVolume() {
    return sfxVolume;
  }

  function setSfxVolume(v) {
    sfxVolume = Math.max(0, Math.min(1, v == null ? 0.7 : v));
    muted = sfxVolume <= 0.001;
    applyBusGains();
  }

  function getSfxVolume() {
    return sfxVolume;
  }

  function setMusicVolume(v) {
    musicVolume = Math.max(0, Math.min(1, v == null ? 0.35 : v));
    musicMuted = musicVolume <= 0.001;
    applyBusGains();
  }

  function getMusicVolume() {
    return musicVolume;
  }

  function resume() {
    var c = ensure();
    if (c && c.state === "suspended" && c.resume) c.resume();
    started = true;
  }

  function beep(freq, dur, type, gainVal, when) {
    var c = ensure();
    if (!c || !sfxBus) return;
    if (muted || sfxVolume <= 0.001) return;
    var t0 = when != null ? when : c.currentTime;
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(
      gainVal != null ? gainVal : 0.12,
      t0 + 0.01
    );
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, gainVal, hpFreq) {
    var c = ensure();
    if (!c || !sfxBus) return;
    if (muted || sfxVolume <= 0.001) return;
    var n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate);
    var data = buf.getChannelData(0);
    var i;
    for (i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource();
    src.buffer = buf;
    var g = c.createGain();
    var t0 = c.currentTime;
    g.gain.setValueAtTime(gainVal != null ? gainVal : 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (hpFreq && c.createBiquadFilter) {
      var f = c.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = hpFreq;
      src.connect(f);
      f.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function play(name) {
    resume();
    var c = ensure();
    if (!c) return;
    if (name === "boost") {
      beep(180, 0.08, "sawtooth", 0.1);
      beep(320, 0.18, "sawtooth", 0.08, c.currentTime + 0.05);
      beep(520, 0.12, "triangle", 0.06, c.currentTime + 0.12);
    } else if (name === "item") {
      beep(660, 0.06, "square", 0.08);
      beep(880, 0.08, "square", 0.07, c.currentTime + 0.06);
      beep(1100, 0.1, "triangle", 0.06, c.currentTime + 0.12);
    } else if (name === "missile") {
      beep(120, 0.15, "sawtooth", 0.12);
      noiseBurst(0.2, 0.1, 400);
    } else if (name === "hit" || name === "explode") {
      noiseBurst(0.35, 0.22, 80);
      beep(90, 0.25, "sawtooth", 0.15);
    } else if (name === "oil") {
      beep(200, 0.1, "triangle", 0.06);
      noiseBurst(0.12, 0.06, 200);
    } else if (name === "shield") {
      beep(440, 0.08, "sine", 0.08);
      beep(660, 0.12, "sine", 0.07, c.currentTime + 0.07);
    } else if (name === "shock") {
      noiseBurst(0.25, 0.14, 600);
      beep(900, 0.08, "square", 0.08);
      beep(400, 0.15, "sawtooth", 0.1, c.currentTime + 0.05);
    } else if (name === "drift") {
      noiseBurst(0.08, 0.04, 900);
    } else if (name === "driftBoost") {
      beep(240, 0.1, "sawtooth", 0.1);
      beep(480, 0.15, "triangle", 0.08, c.currentTime + 0.06);
    } else if (name === "lap") {
      beep(520, 0.08, "sine", 0.09);
      beep(780, 0.12, "sine", 0.08, c.currentTime + 0.08);
    } else if (name === "finish") {
      beep(392, 0.12, "triangle", 0.1);
      beep(523, 0.12, "triangle", 0.1, c.currentTime + 0.12);
      beep(659, 0.2, "triangle", 0.12, c.currentTime + 0.24);
    } else if (name === "results") {
      beep(330, 0.1, "sine", 0.1);
      beep(440, 0.12, "sine", 0.1, c.currentTime + 0.1);
      beep(554, 0.18, "triangle", 0.12, c.currentTime + 0.22);
    } else if (name === "countdown") {
      beep(220, 0.12, "square", 0.12);
    } else if (name === "go") {
      beep(523, 0.1, "sawtooth", 0.12);
      beep(784, 0.2, "triangle", 0.14, c.currentTime + 0.08);
    } else if (name === "placeUp") {
      beep(660, 0.07, "square", 0.09);
      beep(880, 0.1, "triangle", 0.08, c.currentTime + 0.06);
    } else if (name === "taunt") {
      beep(300, 0.06, "square", 0.07);
      beep(380, 0.1, "sawtooth", 0.06, c.currentTime + 0.05);
    } else if (name === "replay") {
      beep(440, 0.08, "sine", 0.08);
      beep(554, 0.12, "triangle", 0.07, c.currentTime + 0.1);
    } else if (name === "wrongWay") {
      beep(160, 0.15, "square", 0.07);
    } else if (name === "pickup") {
      play("item");
    } else if (name === "itemTick") {
      beep(500 + Math.random() * 400, 0.035, "square", 0.04);
    } else if (name === "itemReady") {
      beep(880, 0.07, "square", 0.09);
      beep(1320, 0.12, "triangle", 0.08, c.currentTime + 0.06);
    } else if (name === "fever") {
      beep(300, 0.1, "sawtooth", 0.1);
      beep(450, 0.12, "sawtooth", 0.09, c.currentTime + 0.08);
      beep(700, 0.18, "triangle", 0.1, c.currentTime + 0.16);
    } else {
      beep(440, 0.05, "sine", 0.05);
    }
  }

  /** Continuous engine tone driven by speed fraction 0..1 */
  function updateEngine(speedFrac, boosting) {
    var c = ensure();
    if (!c || !sfxBus) return;
    speedFrac = Math.max(0, Math.min(1, speedFrac || 0));
    if (!engineOsc) {
      engineOsc = c.createOscillator();
      engineGain = c.createGain();
      engineOsc.type = "sawtooth";
      engineGain.gain.value = 0.0001;
      engineOsc.connect(engineGain);
      engineGain.connect(sfxBus);
      try {
        engineOsc.start();
      } catch (e) {}
    }
    var base = 55 + speedFrac * 140;
    if (boosting) base *= 1.25;
    engineOsc.frequency.setTargetAtTime(base, c.currentTime, 0.05);
    var g =
      muted || sfxVolume <= 0.001
        ? 0
        : 0.02 + speedFrac * 0.06 + (boosting ? 0.03 : 0);
    engineGain.gain.setTargetAtTime(
      Math.max(0.0001, g * sfxVolume),
      c.currentTime,
      0.08
    );
  }

  function stopEngine() {
    if (engineGain && ctx) {
      engineGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    }
  }

  function scheduleMusicNote() {
    if (!ctx || !musicBus || musicMuted || musicVolume <= 0.001) return;
    var freq = MUSIC_NOTES[musicStep % MUSIC_NOTES.length];
    musicStep++;
    var t0 = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t0);
    // Soft pad second oscillator an octave up, quieter
    var o2 = ctx.createOscillator();
    var g2 = ctx.createGain();
    o2.type = "sine";
    o2.frequency.setValueAtTime(freq * 2, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.045, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(0.018, t0 + 0.04);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    o.connect(g);
    g.connect(musicBus);
    o2.connect(g2);
    g2.connect(musicBus);
    o.start(t0);
    o.stop(t0 + 0.35);
    o2.start(t0);
    o2.stop(t0 + 0.38);
  }

  /**
   * Start looping procedural race bed (idempotent).
   * Uses setInterval when available; no-op in pure Node without timers still OK.
   */
  function startMusic() {
    resume();
    var c = ensure();
    if (!c || !musicBus) return false;
    if (musicTimer != null) return true;
    musicStep = 0;
    applyBusGains();
    scheduleMusicNote();
    if (typeof root.setInterval === "function") {
      musicTimer = root.setInterval(function () {
        try {
          scheduleMusicNote();
        } catch (e) {}
      }, 320);
    }
    return true;
  }

  function stopMusic() {
    if (musicTimer != null && typeof root.clearInterval === "function") {
      root.clearInterval(musicTimer);
    }
    musicTimer = null;
    musicStep = 0;
  }

  function isMusicPlaying() {
    return musicTimer != null;
  }

  /** Map race state.events[] to one-shots */
  function consumeEvents(events) {
    if (!events || !events.length) return;
    var i, e, n;
    for (i = 0; i < events.length; i++) {
      e = events[i];
      n = typeof e === "string" ? e : e && e.type;
      if (n) play(n);
    }
  }

  var api = {
    play: play,
    setVolume: setVolume,
    getVolume: getVolume,
    setSfxVolume: setSfxVolume,
    getSfxVolume: getSfxVolume,
    setMusicVolume: setMusicVolume,
    getMusicVolume: getMusicVolume,
    resume: resume,
    updateEngine: updateEngine,
    stopEngine: stopEngine,
    startMusic: startMusic,
    stopMusic: stopMusic,
    isMusicPlaying: isMusicPlaying,
    consumeEvents: consumeEvents,
    ensure: ensure,
  };

  root.NeoKartAudio = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
