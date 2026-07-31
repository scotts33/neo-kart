/**
 * Canvas 2D renderer for Neon Circuit 2026.
 * Read-only: never mutates race state.
 */
(function (root) {
  "use strict";

  var CANVAS_W = 960;
  var CANVAS_H = 640;

  function ensureCanvas(canvas) {
    if (!canvas) return null;
    if (canvas.width !== CANVAS_W) canvas.width = CANVAS_W;
    if (canvas.height !== CANVAS_H) canvas.height = CANVAS_H;
    return canvas;
  }

  function worldToScreen(x, y, cam, scale) {
    return {
      x: (x - cam.x) * scale + CANVAS_W / 2,
      y: (y - cam.y) * scale + CANVAS_H / 2,
    };
  }

  function drawTrack(ctx, state, cam, scale) {
    var wps = state.track.waypoints;
    var hw = state.track.halfWidth;
    var i, a, b, ang, nx, ny;

    // asphalt ribbon
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1a1f35";
    ctx.lineWidth = hw * 2 * scale;
    ctx.beginPath();
    for (i = 0; i < wps.length; i++) {
      var p = worldToScreen(wps[i].x, wps[i].y, cam, scale);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();

    // neon edge lines
    ctx.strokeStyle = "#3dffe8";
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3;
    drawOffsetPath(ctx, wps, cam, scale, hw);
    drawOffsetPath(ctx, wps, cam, scale, -hw);
    ctx.globalAlpha = 1;

    // dashed center line
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    for (i = 0; i < wps.length; i++) {
      p = worldToScreen(wps[i].x, wps[i].y, cam, scale);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // start/finish gate near waypoint 0
    a = wps[0];
    b = wps[1];
    ang = Math.atan2(b.y - a.y, b.x - a.x);
    nx = Math.cos(ang + Math.PI / 2);
    ny = Math.sin(ang + Math.PI / 2);
    var s1 = worldToScreen(a.x + nx * hw, a.y + ny * hw, cam, scale);
    var s2 = worldToScreen(a.x - nx * hw, a.y - ny * hw, cam, scale);
    ctx.strokeStyle = "#ff5c8a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
    ctx.fillStyle = "#ff5c8a";
    ctx.font = "bold 12px monospace";
    ctx.fillText("START", s1.x - 10, s1.y - 8);
  }

  function drawOffsetPath(ctx, wps, cam, scale, offset) {
    var i, a, b, ang, nx, ny, px, py, p;
    ctx.beginPath();
    for (i = 0; i < wps.length; i++) {
      a = wps[i];
      b = wps[(i + 1) % wps.length];
      ang = Math.atan2(b.y - a.y, b.x - a.x);
      nx = Math.cos(ang + Math.PI / 2) * offset;
      ny = Math.sin(ang + Math.PI / 2) * offset;
      p = worldToScreen(a.x + nx, a.y + ny, cam, scale);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  function drawItemBoxes(ctx, state, cam, scale) {
    var i, box, p, pulse;
    for (i = 0; i < state.itemBoxes.length; i++) {
      box = state.itemBoxes[i];
      if (!box.active) continue;
      p = worldToScreen(box.x, box.y, cam, scale);
      pulse = 1 + 0.12 * Math.sin(state.time * 8 + i);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(state.time * 2);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = "#9b5de5";
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      var s = 14 * scale;
      ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.strokeRect(-s, -s, s * 2, s * 2);
      ctx.fillStyle = "#fff";
      ctx.font = "bold " + Math.round(14 * scale) + "px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", 0, 1);
      ctx.restore();
    }
  }

  function drawHazards(ctx, state, cam, scale) {
    var i, h, p;
    for (i = 0; i < state.hazards.length; i++) {
      h = state.hazards[i];
      p = worldToScreen(h.x, h.y, cam, scale);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, h.radius * scale * 1.2, h.radius * scale * 0.7, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(40, 20, 60, 0.85)";
      ctx.fill();
      ctx.strokeStyle = "#c77dff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawProjectiles(ctx, state, cam, scale) {
    var i, pr, p;
    for (i = 0; i < state.projectiles.length; i++) {
      pr = state.projectiles[i];
      p = worldToScreen(pr.x, pr.y, cam, scale);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(pr.angle);
      ctx.fillStyle = "#ff5c8a";
      ctx.beginPath();
      ctx.moveTo(12 * scale, 0);
      ctx.lineTo(-8 * scale, 6 * scale);
      ctx.lineTo(-8 * scale, -6 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.arc(-6 * scale, 0, 3 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawKart(ctx, kart, cam, scale) {
    var p = worldToScreen(kart.x, kart.y, cam, scale);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(kart.angle);
    var vt = kart.vehicleType || "model3";
    var L =
      (vt === "bus" ? 28 : vt === "truck" ? 24 : vt === "van" ? 20 : 18) * scale;
    var W =
      (vt === "bus" || vt === "truck" ? 14 : vt === "van" ? 13 : 12) * scale;
    if (kart.explodedT > 0) {
      // Temporary blow-up: fireball instead of car body
      var blast = Math.min(1, kart.explodedT / 1.2);
      ctx.fillStyle = "rgba(255, 100, 30, " + (0.4 + blast * 0.5) + ")";
      ctx.beginPath();
      ctx.arc(0, 0, L * (1.2 + (1 - blast) * 1.8), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 240, 120, 0.9)";
      ctx.beginPath();
      ctx.arc(0, 0, L * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#ff6622";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillText("BOOM", p.x, p.y - 22 * scale);
      return;
    }
    // body
    ctx.fillStyle = kart.color;
    ctx.strokeStyle = kart.isPlayer ? "#fff" : "rgba(0,0,0,0.5)";
    ctx.lineWidth = kart.isPlayer ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(L, 0);
    ctx.lineTo(-L * 0.7, W);
    ctx.lineTo(-L * 0.5, 0);
    ctx.lineTo(-L * 0.7, -W);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // canopy
    ctx.fillStyle = "rgba(20,30,50,0.7)";
    ctx.fillRect(-L * 0.2, -W * 0.45, L * 0.5, W * 0.9);
    // boost glow
    if (kart.boostT > 0) {
      ctx.fillStyle = "rgba(61,255,232,0.55)";
      ctx.beginPath();
      ctx.arc(-L * 0.85, 0, 8 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    if (kart.stunT > 0) {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, L * 1.1, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // nameplate
    ctx.fillStyle = kart.isPlayer ? "#3dffe8" : "rgba(255,255,255,0.7)";
    ctx.font = (kart.isPlayer ? "bold " : "") + "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      kart.isPlayer
        ? "YOU"
        : kart.isTraffic
          ? (kart.vehicleType === "bus"
              ? "BUS"
              : kart.vehicleType === "truck"
                ? "TRK"
                : kart.vehicleType === "van"
                  ? "VAN"
                  : kart.direction < 0
                    ? "ONC"
                    : "CAR")
          : "P" + (kart.id + 1),
      p.x,
      p.y - 22 * scale
    );
  }

  function drawHUD(ctx, state) {
    var ranks = state.rankings || [];
    var player = null;
    var i;
    for (i = 0; i < state.karts.length; i++) {
      if (state.karts[i].isPlayer) player = state.karts[i];
    }

    // panel
    ctx.fillStyle = "rgba(8, 12, 28, 0.75)";
    ctx.fillRect(12, 12, 210, 28 + ranks.length * 20 + 60);

    ctx.fillStyle = "#3dffe8";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "left";
    ctx.fillText("NEON CIRCUIT 2026", 22, 32);

    ctx.font = "13px monospace";
    for (i = 0; i < ranks.length; i++) {
      var r = ranks[i];
      ctx.fillStyle = r.isPlayer ? "#3dffe8" : "#c8d0e0";
      var label =
        r.place +
        ". " +
        (r.isPlayer ? "YOU" : "CPU" + r.id) +
        "  L" +
        Math.min(r.laps + 1, state.numLaps) +
        "/" +
        state.numLaps +
        (r.finished ? " ✓" : "");
      ctx.fillText(label, 22, 54 + i * 20);
    }

    if (player) {
      var itemLabel = player.item ? player.item.toUpperCase() : "—";
      ctx.fillStyle = "#ffd166";
      ctx.fillText("ITEM: " + itemLabel, 22, 54 + ranks.length * 20 + 18);
      ctx.fillStyle = "#8892a8";
      ctx.font = "11px monospace";
      ctx.fillText("WASD/Arrows · Space item", 22, 54 + ranks.length * 20 + 38);
    }

    // results overlay
    if (state.phase === "results") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = "#3dffe8";
      ctx.font = "bold 48px monospace";
      ctx.textAlign = "center";
      ctx.fillText(state.message || "FINISH", CANVAS_W / 2, CANVAS_H / 2 - 20);
      ctx.fillStyle = "#ffd166";
      ctx.font = "18px monospace";
      ctx.fillText("Press R to race again", CANVAS_W / 2, CANVAS_H / 2 + 30);
    }
  }

  function render(canvas, state) {
    canvas = ensureCanvas(canvas);
    if (!canvas || !state) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    // camera follows player
    var player = state.karts[0];
    var i;
    for (i = 0; i < state.karts.length; i++) {
      if (state.karts[i].isPlayer) {
        player = state.karts[i];
        break;
      }
    }
    var cam = { x: player.x, y: player.y };
    var scale = 1.15;

    // background
    var grd = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grd.addColorStop(0, "#0a0e1a");
    grd.addColorStop(1, "#12182b");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // subtle grid
    ctx.strokeStyle = "rgba(61,255,232,0.04)";
    ctx.lineWidth = 1;
    var g;
    for (g = 0; g < CANVAS_W; g += 40) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, CANVAS_H);
      ctx.stroke();
    }
    for (g = 0; g < CANVAS_H; g += 40) {
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(CANVAS_W, g);
      ctx.stroke();
    }

    drawTrack(ctx, state, cam, scale);
    drawHazards(ctx, state, cam, scale);
    drawItemBoxes(ctx, state, cam, scale);
    drawProjectiles(ctx, state, cam, scale);
    for (i = 0; i < state.karts.length; i++) {
      drawKart(ctx, state.karts[i], cam, scale);
    }
    drawHUD(ctx, state);
  }

  var api = {
    render: render,
    ensureCanvas: ensureCanvas,
    CANVAS_W: CANVAS_W,
    CANVAS_H: CANVAS_H,
  };

  root.NeoKartRender = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
