/**
 * Keyboard + gamepad input for Neon Circuit 2026.
 * Accelerate, brake, left, right, item, drift, camera, pause.
 */
(function (root) {
  "use strict";

  var keys = Object.create(null);

  var BINDINGS = {
    accel: ["ArrowUp", "KeyW", "w", "W", "Up"],
    brake: ["ArrowDown", "KeyS", "s", "S", "Down"],
    left: ["ArrowLeft", "KeyA", "a", "A", "Left"],
    right: ["ArrowRight", "KeyD", "d", "D", "Right"],
    useItem: ["Space", " ", "KeyE", "e", "E"],
    drift: ["ShiftLeft", "ShiftRight", "Shift", "KeyZ", "z", "Z"],
    camera: ["KeyC", "c", "C", "KeyV", "v", "V"],
    pause: ["KeyP", "p", "P", "Escape"],
  };

  var cameraEdge = false;
  var pauseEdge = false;
  var padDead = 0.22;
  var stickSensitivity = 1.0; // scales gamepad axis after deadzone
  /** On-screen touch / mobile virtual pad state */
  var touch = {
    accel: false,
    brake: false,
    left: false,
    right: false,
    useItem: false,
    drift: false,
    steerAxis: 0,
  };

  function codeOrKey(e) {
    return e.code || e.key;
  }

  function isBound(action, e) {
    var list = BINDINGS[action];
    if (!list) return false;
    var c = codeOrKey(e);
    var k = e.key;
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] === c || list[i] === k) return true;
    }
    return false;
  }

  function onKeyDown(e) {
    var action;
    for (action in BINDINGS) {
      if (isBound(action, e)) {
        if (action === "camera") {
          if (!keys.camera) cameraEdge = true;
        }
        if (action === "pause") {
          // Escape still used for menu in main — only edge for P
          if (e.code === "KeyP" || e.key === "p" || e.key === "P") {
            if (!keys.pause) pauseEdge = true;
          }
        }
        keys[action] = true;
        if (
          action === "useItem" ||
          action === "accel" ||
          action === "brake" ||
          action === "left" ||
          action === "right" ||
          action === "camera" ||
          action === "drift"
        ) {
          if (e.preventDefault) e.preventDefault();
        }
      }
    }
  }

  function onKeyUp(e) {
    var action;
    for (action in BINDINGS) {
      if (isBound(action, e)) {
        keys[action] = false;
      }
    }
  }

  function consumeCameraToggle() {
    if (!cameraEdge) return false;
    cameraEdge = false;
    return true;
  }

  function consumePauseToggle() {
    // Also gamepad Start
    pollGamepadEdges();
    if (!pauseEdge) return false;
    pauseEdge = false;
    return true;
  }

  var prevPadButtons = {};

  function pollGamepadEdges() {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    var pads;
    try {
      pads = navigator.getGamepads();
    } catch (e) {
      return;
    }
    if (!pads) return;
    var i, g, start, select;
    for (i = 0; i < pads.length; i++) {
      g = pads[i];
      if (!g) continue;
      start = g.buttons[9] && g.buttons[9].pressed;
      select = g.buttons[8] && g.buttons[8].pressed;
      if (start && !prevPadButtons[i + "_start"]) pauseEdge = true;
      if (select && !prevPadButtons[i + "_select"]) cameraEdge = true;
      prevPadButtons[i + "_start"] = !!start;
      prevPadButtons[i + "_select"] = !!select;
    }
  }

  function readGamepad() {
    var out = {
      accel: false,
      brake: false,
      left: false,
      right: false,
      useItem: false,
      drift: false,
      steerAxis: 0,
    };
    if (typeof navigator === "undefined" || !navigator.getGamepads) return out;
    var pads;
    try {
      pads = navigator.getGamepads();
    } catch (e) {
      return out;
    }
    if (!pads) return out;
    var i, g, ax, lt, rt;
    for (i = 0; i < pads.length; i++) {
      g = pads[i];
      if (!g || !g.connected) continue;
      ax = g.axes && g.axes[0] != null ? g.axes[0] : 0;
      // Deadzone then sensitivity curve for steer axis
      if (Math.abs(ax) > padDead) {
        var sign = ax < 0 ? -1 : 1;
        var mag = (Math.abs(ax) - padDead) / (1 - padDead);
        mag = Math.min(1, mag * stickSensitivity);
        out.steerAxis = sign * mag;
        if (out.steerAxis < -0.12) out.left = true;
        if (out.steerAxis > 0.12) out.right = true;
      }
      // D-pad
      if (g.buttons[14] && g.buttons[14].pressed) out.left = true;
      if (g.buttons[15] && g.buttons[15].pressed) out.right = true;
      if (g.buttons[12] && g.buttons[12].pressed) out.accel = true;
      if (g.buttons[13] && g.buttons[13].pressed) out.brake = true;
      // Triggers / shoulders
      rt = g.buttons[7];
      lt = g.buttons[6];
      if (rt && (rt.pressed || (rt.value != null && rt.value > 0.2))) out.accel = true;
      if (lt && (lt.pressed || (lt.value != null && lt.value > 0.2))) out.brake = true;
      // A / cross = item, B / circle = drift, X = item alt
      if (g.buttons[0] && g.buttons[0].pressed) out.useItem = true;
      if (g.buttons[1] && g.buttons[1].pressed) out.drift = true;
      if (g.buttons[2] && g.buttons[2].pressed) out.useItem = true;
      if (g.buttons[5] && g.buttons[5].pressed) out.drift = true; // RB
      if (g.buttons[4] && g.buttons[4].pressed) out.useItem = true; // LB
      break; // first pad
    }
    return out;
  }

  function attach(target) {
    target = target || (typeof window !== "undefined" ? window : null);
    if (!target || !target.addEventListener) return;
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
  }

  function detach(target) {
    target = target || (typeof window !== "undefined" ? window : null);
    if (!target || !target.removeEventListener) return;
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
  }

  function getPlayerInput() {
    pollGamepadEdges();
    var pad = readGamepad();
    var steer = pad.steerAxis || touch.steerAxis || 0;
    return {
      accel: !!keys.accel || pad.accel || !!touch.accel,
      brake: !!keys.brake || pad.brake || !!touch.brake,
      left: !!keys.left || pad.left || !!touch.left || steer < -0.12,
      right: !!keys.right || pad.right || !!touch.right || steer > 0.12,
      useItem: !!keys.useItem || pad.useItem || !!touch.useItem,
      drift: !!keys.drift || pad.drift || !!touch.drift,
      steerAxis: steer,
    };
  }

  function reset() {
    var a;
    for (a in keys) keys[a] = false;
    cameraEdge = false;
    pauseEdge = false;
    touch.accel = false;
    touch.brake = false;
    touch.left = false;
    touch.right = false;
    touch.useItem = false;
    touch.drift = false;
    touch.steerAxis = 0;
  }

  function setKey(action, down) {
    keys[action] = !!down;
  }

  /**
   * Set virtual control state from on-screen touch pad.
   * opts: { accel?, brake?, left?, right?, useItem?, drift?, steerAxis? }
   */
  function setTouchState(opts) {
    opts = opts || {};
    if (opts.accel != null) touch.accel = !!opts.accel;
    if (opts.brake != null) touch.brake = !!opts.brake;
    if (opts.left != null) touch.left = !!opts.left;
    if (opts.right != null) touch.right = !!opts.right;
    if (opts.useItem != null) touch.useItem = !!opts.useItem;
    if (opts.drift != null) touch.drift = !!opts.drift;
    if (opts.steerAxis != null) {
      touch.steerAxis = Math.max(-1, Math.min(1, opts.steerAxis));
    }
    return {
      accel: touch.accel,
      brake: touch.brake,
      left: touch.left,
      right: touch.right,
      useItem: touch.useItem,
      drift: touch.drift,
      steerAxis: touch.steerAxis,
    };
  }

  function getTouchState() {
    return {
      accel: touch.accel,
      brake: touch.brake,
      left: touch.left,
      right: touch.right,
      useItem: touch.useItem,
      drift: touch.drift,
      steerAxis: touch.steerAxis,
    };
  }

  function setStickSettings(opts) {
    opts = opts || {};
    if (opts.deadzone != null) {
      padDead = Math.max(0.05, Math.min(0.5, opts.deadzone));
    }
    if (opts.sensitivity != null) {
      stickSensitivity = Math.max(0.4, Math.min(2.5, opts.sensitivity));
    }
    return { deadzone: padDead, sensitivity: stickSensitivity };
  }

  function getStickSettings() {
    return { deadzone: padDead, sensitivity: stickSensitivity };
  }

  var api = {
    attach: attach,
    detach: detach,
    getPlayerInput: getPlayerInput,
    consumeCameraToggle: consumeCameraToggle,
    consumePauseToggle: consumePauseToggle,
    reset: reset,
    setKey: setKey,
    setStickSettings: setStickSettings,
    getStickSettings: getStickSettings,
    setTouchState: setTouchState,
    getTouchState: getTouchState,
    BINDINGS: BINDINGS,
  };

  root.NeoKartInput = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
