(function() {
"use strict";
// === core ===
/* ==== 05_core.js ==== */
        /* ============================================================================
   05_CORE — config, math, deterministic RNG, procedural noise & textures,
   geometry batching, spatial hashing, navigation grid and the audio engine.
   ========================================================================== */

        var CFG = {
          MAP: 640,
          SEG: 200,
          PLAY_R: 168,
          SEA: 0,
          GRID: 4,
          MAXP: 25,
          GRAV: -26,
          RUN: 9.6,
          SPRINT: 13.8,
          CROUCH: 5.0,
          JUMP: 10.6,
          EYE: 1.55,
          BUS_Y: 208,
          BUS_SPEED: 45,
           DIVE: 55,
           GLIDE: 7,
           GLIDE_FWD: 18,
          HARVEST_RANGE: 3.8,
          BUILD_RANGE: 4.8,
          VEH_MAX: 30,
          KNOCK_DRAIN: 2.4,
        };

        /* ---------------- persisted settings ---------------- */
        var SETTINGS = {
          sens: 1.0,
          fov: 74,
          quality: 0,
          shadows: 1,
          bloom: 1,
          volume: 0.62,
          autofire: 0,
          crosshair: 0,
          mode: "solo",
          fps: 1,
          aimAssist: 1,
          postFx: 1,
        };
        var XHAIR_COLORS = [
          "#ffffff",
          "#6bffa8",
          "#ffd76a",
          "#ff6bd6",
          "#7fd8ff",
        ];
        (function loadSettings() {
          try {
            var raw =
              window.localStorage && localStorage.getItem("fnbr_v2_settings");
            if (raw) {
              var o = JSON.parse(raw);
              for (var k in o)
                if (SETTINGS.hasOwnProperty(k)) SETTINGS[k] = o[k];
            }
          } catch (e) {}
        })();
        function saveSettings() {
          try {
            if (window.localStorage)
              localStorage.setItem(
                "fnbr_v2_settings",
                JSON.stringify(SETTINGS),
              );
          } catch (e) {}
        }

        /* ---------------- math ---------------- */
        function clamp(v, a, b) {
          return v < a ? a : v > b ? b : v;
        }
        function lerp(a, b, t) {
          return a + (b - a) * t;
        }
        function smoothstep(e0, e1, x) {
          var t = clamp((x - e0) / (e1 - e0), 0, 1);
          return t * t * (3 - 2 * t);
        }
        function dist2(ax, az, bx, bz) {
          var dx = ax - bx,
            dz = az - bz;
          return Math.sqrt(dx * dx + dz * dz);
        }
        function angDiff(a, b) {
          var d = (b - a) % (Math.PI * 2);
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
          return d;
        }
        function approachAngle(cur, tgt, rate) {
          return cur + clamp(angDiff(cur, tgt), -rate, rate);
        }
        function fmtTime(s) {
          s = Math.max(0, Math.ceil(s));
          var m = Math.floor(s / 60);
          var r = s % 60;
          return m + ":" + (r < 10 ? "0" : "") + r;
        }
        function expDecay(rate, dt) {
          return 1 - Math.exp(-rate * dt);
        }

        /* ---------------- deterministic RNG ---------------- */
        var _seed = 20260915;
        function srnd() {
          _seed = (Math.imul(_seed, 1664525) + 1013904223) & 0x7fffffff;
          return _seed / 0x7fffffff;
        }
        function rnd(a, b) {
          return a + (b - a) * srnd();
        }
        function rndi(a, b) {
          return Math.floor(a + (b - a + 1) * srnd());
        }
        function pickOne(arr) {
          return arr[Math.min(arr.length - 1, Math.floor(srnd() * arr.length))];
        }
        function chance(p) {
          return srnd() < p;
        }

        /* ---------------- colour ---------------- */
        function col(hex) {
          return new THREE.Color(hex).convertSRGBToLinear();
        }
        function hexStr(hex) {
          return "#" + ("000000" + (hex >>> 0).toString(16)).slice(-6);
        }

        /* ---------------- noise ---------------- */
        function hash2i(x, y) {
          var h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
          h = Math.imul(h ^ (h >>> 13), 1274126177);
          h = h ^ (h >>> 16);
          return ((h >>> 0) % 100000) / 100000;
        }
        function vnoise(x, y) {
          var xi = Math.floor(x),
            yi = Math.floor(y),
            xf = x - xi,
            yf = y - yi;
          var u = xf * xf * (3 - 2 * xf),
            v = yf * yf * (3 - 2 * yf);
          var a = hash2i(xi, yi),
            b = hash2i(xi + 1, yi),
            c = hash2i(xi, yi + 1),
            d = hash2i(xi + 1, yi + 1);
          return lerp(lerp(a, b, u), lerp(c, d, u), v);
        }
        function fbm(x, y, oct) {
          var s = 0,
            a = 0.5,
            f = 1,
            n = 0;
          for (var i = 0; i < oct; i++) {
            s += a * vnoise(x * f, y * f);
            n += a;
            a *= 0.5;
            f *= 2;
          }
          return s / n;
        }
        /* ridged noise — good for mountain crests */
        function ridged(x, y, oct) {
          var s = 0,
            a = 0.5,
            f = 1,
            n = 0;
          for (var i = 0; i < oct; i++) {
            var v = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
            s += a * v * v;
            n += a;
            a *= 0.5;
            f *= 2;
          }
          return s / n;
        }

        /* ---------------- procedural textures ---------------- */
        function makeTex(size, draw, rep, noRepeat) {
          var c = document.createElement("canvas");
          c.width = c.height = size;
          var g = c.getContext("2d");
          draw(g, size);
          var t = new THREE.CanvasTexture(c);
          if (!noRepeat) {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
          }
          t.encoding = THREE.sRGBEncoding;
          t.anisotropy = 8;
          if (rep) t.repeat.set(rep, rep);
          return t;
        }
        function px(g, x, y, w, h, c, a) {
          g.fillStyle = c;
          g.globalAlpha = a === undefined ? 1 : a;
          g.fillRect(x, y, w, h);
          g.globalAlpha = 1;
        }
        var TEX = {};
        function buildTextures() {
          /* --- grass --- */
          TEX.grass = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#4c8c37");
              for (var i = 0; i < 3400; i++) {
                var h = rnd(0, 1);
                g.fillStyle =
                  h < 0.35 ? "#3d7529" : h < 0.72 ? "#59a03f" : "#6fba4c";
                g.fillRect(rnd(0, s), rnd(0, s), rnd(1, 3), rnd(2, 8));
              }
              for (var j = 0; j < 70; j++) {
                g.fillStyle = "rgba(126,116,72," + rnd(0.04, 0.14) + ")";
                g.beginPath();
                g.ellipse(
                  rnd(0, s),
                  rnd(0, s),
                  rnd(6, 24),
                  rnd(5, 17),
                  rnd(0, 3),
                  0,
                  6.3,
                );
                g.fill();
              }
              for (var k = 0; k < 120; k++) {
                px(
                  g,
                  rnd(0, s),
                  rnd(0, s),
                  rnd(1, 3),
                  rnd(1, 3),
                  "#a8d46a",
                  rnd(0.1, 0.3),
                );
              }
            },
            46,
          );
          /* --- dirt --- */
          TEX.dirt = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#6d5433");
              for (var i = 0; i < 2600; i++) {
                var v = Math.floor(rnd(-34, 34));
                g.fillStyle =
                  "rgba(" +
                  (v > 0 ? 255 : 0) +
                  "," +
                  (v > 0 ? 255 : 0) +
                  "," +
                  (v > 0 ? 255 : 0) +
                  "," +
                  Math.abs(v) / 210 +
                  ")";
                g.fillRect(rnd(0, s), rnd(0, s), rnd(1, 5), rnd(1, 4));
              }
              for (var j = 0; j < 50; j++) {
                px(
                  g,
                  rnd(0, s),
                  rnd(0, s),
                  rnd(2, 7),
                  rnd(2, 5),
                  "#4d3a22",
                  rnd(0.2, 0.5),
                );
              }
            },
            20,
          );
          /* --- rock --- */
          TEX.rock = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#8b8b95");
              for (var i = 0; i < 620; i++) {
                var v = Math.floor(rnd(-46, 46));
                g.fillStyle =
                  "rgba(" +
                  (v > 0 ? 255 : 0) +
                  "," +
                  (v > 0 ? 255 : 0) +
                  "," +
                  (v > 0 ? 255 : 0) +
                  "," +
                  Math.abs(v) / 215 +
                  ")";
                g.beginPath();
                g.ellipse(
                  rnd(0, s),
                  rnd(0, s),
                  rnd(3, 15),
                  rnd(3, 12),
                  rnd(0, 3),
                  0,
                  6.3,
                );
                g.fill();
              }
              g.strokeStyle = "rgba(52,52,64,.4)";
              g.lineWidth = 1.6;
              for (var j = 0; j < 12; j++) {
                g.beginPath();
                g.moveTo(rnd(0, s), 0);
                g.lineTo(rnd(0, s), s);
                g.stroke();
              }
            },
            14,
          );
          /* --- sand --- */
          TEX.sand = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#d8c48a");
              for (var i = 0; i < 2200; i++) {
                var v = Math.floor(rnd(-26, 26));
                g.fillStyle =
                  "rgba(" +
                  (v > 0 ? 255 : 0) +
                  "," +
                  (v > 0 ? 255 : 0) +
                  "," +
                  (v > 0 ? 255 : 0) +
                  "," +
                  Math.abs(v) / 190 +
                  ")";
                g.fillRect(rnd(0, s), rnd(0, s), rnd(1, 3), rnd(1, 3));
              }
              for (var j = 0; j < 40; j++) {
                g.strokeStyle = "rgba(190,168,116," + rnd(0.2, 0.45) + ")";
                g.lineWidth = rnd(1, 2.4);
                g.beginPath();
                var y = rnd(0, s);
                g.moveTo(0, y);
                for (var x = 0; x < s; x += 16)
                  g.lineTo(x, y + Math.sin(x * 0.08 + y) * 5);
                g.stroke();
              }
            },
            26,
          );
          /* --- snow --- */
          TEX.snow = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#e8eff7");
              for (var i = 0; i < 1400; i++) {
                g.fillStyle =
                  "rgba(" +
                  (srnd() < 0.5 ? 255 : 190) +
                  "," +
                  (srnd() < 0.5 ? 255 : 205) +
                  ",255," +
                  rnd(0.1, 0.5) +
                  ")";
                g.fillRect(rnd(0, s), rnd(0, s), rnd(2, 7), rnd(2, 7));
              }
            },
            22,
          );
          /* --- wood plank --- */
          TEX.wood = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#a8703c");
              for (var p = 0; p < 8; p++) {
                var y = (p * s) / 8;
                px(g, 0, y, s, s / 8, p % 2 ? "#9a6636" : "#b87c44");
                px(g, 0, y, s, 2, "rgba(60,32,10,.6)");
                for (var k = 0; k < 18; k++)
                  px(
                    g,
                    rnd(0, s),
                    y + rnd(3, s / 8 - 4),
                    rnd(8, 70),
                    rnd(1, 2),
                    "rgba(70,40,15," + rnd(0.05, 0.22) + ")",
                  );
                for (var q = 0; q < 2; q++) {
                  g.strokeStyle = "rgba(88,54,22,.4)";
                  g.lineWidth = 1.4;
                  g.beginPath();
                  var ey = y + rnd(6, s / 8 - 6);
                  g.ellipse(rnd(0, s), ey, rnd(3, 7), rnd(2, 4), 0, 0, 6.3);
                  g.stroke();
                }
              }
            },
            1,
          );
          /* --- brick --- */
          TEX.brick = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#7d4436");
              var bh = s / 10,
                bw = s / 5;
              for (var r = 0; r < 10; r++) {
                for (var c2 = -1; c2 < 6; c2++) {
                  var off = r % 2 ? bw / 2 : 0;
                  g.fillStyle =
                    "rgb(" +
                    Math.floor(rnd(126, 182)) +
                    "," +
                    Math.floor(rnd(62, 98)) +
                    "," +
                    Math.floor(rnd(52, 84)) +
                    ")";
                  g.fillRect(c2 * bw + off + 2, r * bh + 2, bw - 4, bh - 4);
                }
              }
            },
            1,
          );
          /* --- concrete / stone block --- */
          TEX.stone = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#9a9aa6");
              for (var i = 0; i < 700; i++) {
                var v = Math.floor(rnd(-34, 34));
                g.fillStyle =
                  "rgba(" +
                  (v > 0 ? 255 : 0) +
                  "," +
                  (v > 0 ? 255 : 0) +
                  "," +
                  (v > 0 ? 255 : 0) +
                  "," +
                  Math.abs(v) / 225 +
                  ")";
                g.beginPath();
                g.ellipse(
                  rnd(0, s),
                  rnd(0, s),
                  rnd(3, 14),
                  rnd(3, 12),
                  rnd(0, 3),
                  0,
                  6.3,
                );
                g.fill();
              }
              g.strokeStyle = "rgba(70,70,82,.35)";
              g.lineWidth = 2;
              g.strokeRect(4, 4, s - 8, s - 8);
              g.beginPath();
              g.moveTo(0, s / 2);
              g.lineTo(s, s / 2);
              g.moveTo(s / 2, 0);
              g.lineTo(s / 2, s / 2);
              g.stroke();
            },
            1,
          );
          /* --- metal panel --- */
          TEX.metal = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#7d8794");
              for (var i = 0; i < 260; i++)
                px(
                  g,
                  rnd(0, s),
                  rnd(0, s),
                  rnd(10, 80),
                  rnd(2, 7),
                  "rgba(255,255,255," + rnd(0.02, 0.1) + ")",
                );
              g.fillStyle = "#5b6470";
              for (var y = 0; y < 4; y++)
                for (var x = 0; x < 4; x++) {
                  g.beginPath();
                  g.arc(32 + x * 64, 32 + y * 64, 5.5, 0, 6.3);
                  g.fill();
                }
              px(g, 0, s / 2 - 2, s, 4, "rgba(20,24,30,.55)");
              px(g, 0, 0, s, 3, "rgba(255,255,255,.14)");
            },
            1,
          );
          /* --- asphalt / road --- */
          TEX.road = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#3c3f46");
              for (var i = 0; i < 3000; i++) {
                var v = Math.floor(rnd(-22, 22));
                g.fillStyle =
                  "rgba(" +
                  (v > 0 ? 255 : 0) +
                  "," +
                  (v > 0 ? 255 : 0) +
                  "," +
                  (v > 0 ? 255 : 0) +
                  "," +
                  Math.abs(v) / 170 +
                  ")";
                g.fillRect(rnd(0, s), rnd(0, s), rnd(1, 3), rnd(1, 3));
              }
              for (var j = 0; j < 6; j++)
                px(
                  g,
                  rnd(0, s),
                  rnd(0, s),
                  rnd(20, 80),
                  rnd(10, 40),
                  "rgba(90,92,100,.28)",
                );
            },
            8,
          );
          /* --- roof tile --- */
          TEX.roof = makeTex(
            256,
            function (g, s) {
              px(g, 0, 0, s, s, "#8f4f3a");
              var bh = s / 12;
              for (var r = 0; r < 12; r++) {
                px(
                  g,
                  0,
                  r * bh,
                  s,
                  bh - 2,
                  "rgb(" +
                    Math.floor(rnd(120, 165)) +
                    "," +
                    Math.floor(rnd(66, 96)) +
                    "," +
                    Math.floor(rnd(50, 74)) +
                    ")",
                );
                px(g, 0, r * bh, s, 2, "rgba(40,20,12,.5)");
              }
            },
            1,
          );
          /* --- foliage sprite --- */
          TEX.leaf = makeTex(
            128,
            function (g, s) {
              g.clearRect(0, 0, s, s);
              for (var i = 0; i < 30; i++) {
                var x = rnd(14, s - 14),
                  y = rnd(14, s - 14);
                g.fillStyle =
                  "rgba(" +
                  Math.floor(rnd(40, 90)) +
                  "," +
                  Math.floor(rnd(110, 170)) +
                  "," +
                  Math.floor(rnd(40, 90)) +
                  ",0.9)";
                g.beginPath();
                g.ellipse(x, y, rnd(9, 20), rnd(6, 13), rnd(0, 3), 0, 6.3);
                g.fill();
              }
            },
            1,
          );
          /* --- grass tuft (alpha-cut billboard) --- */
          TEX.tuft = makeTex(
            128,
            function (g, s) {
              g.clearRect(0, 0, s, s);
              for (var i = 0; i < 54; i++) {
                var bx = rnd(16, s - 16),
                  by = s;
                var h = rnd(40, 110),
                  lean = rnd(-24, 24);
                var w = rnd(3.4, 7.5);
                var grd = g.createLinearGradient(bx, by, bx + lean, by - h);
                var lum = rnd(0.55, 1.0);
                grd.addColorStop(
                  0,
                  "rgba(" +
                    Math.floor(46 * lum) +
                    "," +
                    Math.floor(104 * lum) +
                    "," +
                    Math.floor(34 * lum) +
                    ",1)",
                );
                grd.addColorStop(
                  0.6,
                  "rgba(" +
                    Math.floor(86 * lum) +
                    "," +
                    Math.floor(158 * lum) +
                    "," +
                    Math.floor(58 * lum) +
                    ",1)",
                );
                grd.addColorStop(
                  1,
                  "rgba(" +
                    Math.floor(132 * lum) +
                    "," +
                    Math.floor(196 * lum) +
                    "," +
                    Math.floor(84 * lum) +
                    ",0.85)",
                );
                g.strokeStyle = grd;
                g.lineWidth = w;
                g.lineCap = "round";
                g.beginPath();
                g.moveTo(bx, by);
                g.quadraticCurveTo(
                  bx + lean * 0.35,
                  by - h * 0.6,
                  bx + lean,
                  by - h,
                );
                g.stroke();
              }
            },
            1,
            true,
          );
          /* --- cloud puff --- */ TEX.cloud = makeTex(
            256,
            function (g, s) {
              g.clearRect(0, 0, s, s);
              for (var i = 0; i < 30; i++) {
                var x = rnd(46, s - 46),
                  y = rnd(76, s - 76),
                  r = rnd(26, 66);
                var grd = g.createRadialGradient(x, y, 0, x, y, r);
                grd.addColorStop(0, "rgba(255,255,255,.92)");
                grd.addColorStop(0.55, "rgba(255,255,255,.42)");
                grd.addColorStop(1, "rgba(255,255,255,0)");
                g.fillStyle = grd;
                g.beginPath();
                g.arc(x, y, r, 0, 6.3);
                g.fill();
              }
            },
            1,
            true,
          );
          /* --- glow --- */
          TEX.glow = makeTex(
            64,
            function (g, s) {
              var grd = g.createRadialGradient(
                s / 2,
                s / 2,
                0,
                s / 2,
                s / 2,
                s / 2,
              );
              grd.addColorStop(0, "rgba(255,255,255,1)");
              grd.addColorStop(0.3, "rgba(255,255,255,.6)");
              grd.addColorStop(1, "rgba(255,255,255,0)");
              g.fillStyle = grd;
              g.fillRect(0, 0, s, s);
            },
            1,
            true,
          );
          /* --- smoke puff --- */
          TEX.smoke = makeTex(
            128,
            function (g, s) {
              g.clearRect(0, 0, s, s);
              for (var i = 0; i < 26; i++) {
                var x = rnd(30, s - 30),
                  y = rnd(30, s - 30),
                  r = rnd(14, 42);
                var grd = g.createRadialGradient(x, y, 0, x, y, r);
                grd.addColorStop(0, "rgba(230,230,235,.5)");
                grd.addColorStop(1, "rgba(200,200,210,0)");
                g.fillStyle = grd;
                g.beginPath();
                g.arc(x, y, r, 0, 6.3);
                g.fill();
              }
            },
            1,
            true,
          );
          /* --- muzzle flash --- */
          TEX.flash = makeTex(
            128,
            function (g, s) {
              g.clearRect(0, 0, s, s);
              var grd = g.createRadialGradient(
                s / 2,
                s / 2,
                0,
                s / 2,
                s / 2,
                s / 2,
              );
              grd.addColorStop(0, "rgba(255,255,240,1)");
              grd.addColorStop(0.22, "rgba(255,226,150,.85)");
              grd.addColorStop(0.55, "rgba(255,160,60,.28)");
              grd.addColorStop(1, "rgba(255,120,20,0)");
              g.fillStyle = grd;
              g.fillRect(0, 0, s, s);
              g.strokeStyle = "rgba(255,240,200,.75)";
              g.lineWidth = 3;
              for (var i = 0; i < 5; i++) {
                var a = rnd(0, 6.28);
                g.beginPath();
                g.moveTo(s / 2, s / 2);
                g.lineTo(
                  s / 2 + Math.cos(a) * rnd(24, 60),
                  s / 2 + Math.sin(a) * rnd(24, 60),
                );
                g.stroke();
              }
            },
            1,
            true,
          );
          /* --- impact decal (bullet hole) --- */
          TEX.hole = makeTex(
            64,
            function (g, s) {
              g.clearRect(0, 0, s, s);
              var grd = g.createRadialGradient(
                s / 2,
                s / 2,
                0,
                s / 2,
                s / 2,
                s / 2,
              );
              grd.addColorStop(0, "rgba(12,10,8,.92)");
              grd.addColorStop(0.4, "rgba(30,26,20,.6)");
              grd.addColorStop(1, "rgba(40,34,26,0)");
              g.fillStyle = grd;
              g.fillRect(0, 0, s, s);
              for (var i = 0; i < 16; i++) {
                var a = rnd(0, 6.28),
                  r = rnd(6, 28);
                g.strokeStyle = "rgba(20,18,14," + rnd(0.2, 0.55) + ")";
                g.lineWidth = rnd(1, 2.6);
                g.beginPath();
                g.moveTo(s / 2, s / 2);
                g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
                g.stroke();
              }
            },
            1,
            true,
          );
          /* --- scorch decal --- */
          TEX.scorch = makeTex(
            64,
            function (g, s) {
              g.clearRect(0, 0, s, s);
              var grd = g.createRadialGradient(
                s / 2,
                s / 2,
                0,
                s / 2,
                s / 2,
                s / 2,
              );
              grd.addColorStop(0, "rgba(10,8,6,.95)");
              grd.addColorStop(0.5, "rgba(26,20,14,.55)");
              grd.addColorStop(1, "rgba(40,30,20,0)");
              g.fillStyle = grd;
              g.fillRect(0, 0, s, s);
            },
            1,
            true,
          );
          /* --- build crack overlay --- */
          TEX.crack = makeTex(
            128,
            function (g, s) {
              g.clearRect(0, 0, s, s);
              g.strokeStyle = "rgba(10,6,2,.72)";
              g.lineWidth = 2.4;
              for (var i = 0; i < 5; i++) {
                g.beginPath();
                var x = rnd(10, s - 10),
                  y = 0;
                g.moveTo(x, y);
                while (y < s) {
                  y += rnd(10, 26);
                  x += rnd(-14, 14);
                  g.lineTo(x, y);
                }
                g.stroke();
              }
            },
            1,
            true,
          );
        }

        /* ============================================================================
   GeoBatch — merge many boxes into one BufferGeometry with vertex colours.
   Also records world-space AABBs (collision), walkable platforms and ramps.
   ========================================================================== */
        function GeoBatch() {
          this.items = [];
          this.m4 = new THREE.Matrix4();
          this.q = new THREE.Quaternion();
          this.e = new THREE.Euler();
          this.v = new THREE.Vector3();
          this.s = new THREE.Vector3();
          this.basePos = new THREE.Vector3();
          this.baseRot = 0;
          this.baseQuat = new THREE.Quaternion();
          this.boxes = [];
          this.plats = [];
          this.ramps = [];
        }
        GeoBatch.prototype.origin = function (x, y, z, rot) {
          this.basePos.set(x, y, z);
          this.baseRot = rot || 0;
          this.baseQuat.setFromEuler(new THREE.Euler(0, rot || 0, 0));
          return this;
        };
        /* Local Y offset that seats an object on the terrain directly beneath local
   (lx,lz). Lets props scattered around a batch origin follow the real ground
   instead of hanging at (or sinking below) the origin's height.
   terrainHeightAt lives in the world module but is hoisted inside the same
   IIFE, so it is safe to reference from here. */
        GeoBatch.prototype.groundY = function (lx, lz) {
          var w = new THREE.Vector3(lx, 0, lz)
            .applyQuaternion(this.baseQuat)
            .add(this.basePos);
          return terrainHeightAt(w.x, w.z) - this.basePos.y;
        };
        GeoBatch.prototype.add = function (
          w,
          h,
          d,
          lx,
          ly,
          lz,
          color,
          ry,
          rx,
          rz,
          collide,
          walk,
          harv,
        ) {
          if (typeof color === "number") color = col(color);
          var geo = new THREE.BoxGeometry(w, h, d);
          this.e.set(rx || 0, ry || 0, rz || 0);
          this.q.setFromEuler(this.e);
          var q = this.baseQuat.clone().multiply(this.q);
          this.v
            .set(lx, ly, lz)
            .applyQuaternion(this.baseQuat)
            .add(this.basePos);
          this.m4.compose(this.v, q, this.s.set(1, 1, 1));
          this.items.push({ geo: geo, m: this.m4.clone(), c: color });
          var itemIdx = this.items.length - 1;
          if (collide) {
            var ex = new THREE.Vector3(w / 2, h / 2, d / 2);
            var ax = new THREE.Vector3(1, 0, 0)
              .applyQuaternion(q)
              .multiplyScalar(ex.x);
            var ay = new THREE.Vector3(0, 1, 0)
              .applyQuaternion(q)
              .multiplyScalar(ex.y);
            var az = new THREE.Vector3(0, 0, 1)
              .applyQuaternion(q)
              .multiplyScalar(ex.z);
            var e2 = new THREE.Vector3(
              Math.abs(ax.x) + Math.abs(ay.x) + Math.abs(az.x),
              Math.abs(ax.y) + Math.abs(ay.y) + Math.abs(az.y),
              Math.abs(ax.z) + Math.abs(ay.z) + Math.abs(az.z),
            );
            var bb = {
              minX: this.v.x - e2.x,
              maxX: this.v.x + e2.x,
              minY: this.v.y - e2.y,
              maxY: this.v.y + e2.y,
              minZ: this.v.z - e2.z,
              maxZ: this.v.z + e2.z,
              itemIdx: itemIdx,
            };
            if (harv) bb.harv = harv;
            this.boxes.push(bb);
            if (walk !== false) {
              var pl = {
                minX: bb.minX,
                maxX: bb.maxX,
                minZ: bb.minZ,
                maxZ: bb.maxZ,
                y: bb.maxY,
              };
              bb.plat =
                pl; /* so destroying the piece also removes its walkable top */
              this.plats.push(pl);
            }
          }
          return this;
        };
        GeoBatch.prototype.ramp = function (x0, z0, h0, x1, z1, h1, halfW) {
          var a = new THREE.Vector3(x0, 0, z0)
            .applyQuaternion(this.baseQuat)
            .add(this.basePos);
          var b = new THREE.Vector3(x1, 0, z1)
            .applyQuaternion(this.baseQuat)
            .add(this.basePos);
          this.ramps.push({
            x0: a.x,
            z0: a.z,
            h0: h0 + this.basePos.y,
            x1: b.x,
            z1: b.z,
            h1: h1 + this.basePos.y,
            halfW: halfW,
          });
          return this;
        };
        GeoBatch.prototype.merge = function () {
          var pos = [],
            nor = [],
            uv = [],
            cls = [],
            i,
            j,
            g,
            p,
            n,
            u,
            cnt,
            c;
          var vOff = 0;
          for (i = 0; i < this.items.length; i++) {
            var it = this.items[i];
            g = it.geo.index ? it.geo.toNonIndexed() : it.geo.clone();
            g.applyMatrix4(it.m);
            p = g.attributes.position.array;
            n = g.attributes.normal.array;
            u = g.attributes.uv ? g.attributes.uv.array : null;
            cnt = g.attributes.position.count;
            /* remember where this piece lives in the merged buffer so it can later be
       collapsed in place (destruction) without rebuilding the geometry */
            it.vStart = vOff;
            it.vCount = cnt;
            vOff += cnt;
            for (j = 0; j < p.length; j++) pos.push(p[j]);
            for (j = 0; j < n.length; j++) nor.push(n[j]);
            if (u) for (j = 0; j < u.length; j++) uv.push(u[j]);
            else for (j = 0; j < cnt * 2; j++) uv.push(0);
            c = it.c;
            for (j = 0; j < cnt; j++) cls.push(c.r, c.g, c.b);
            g.dispose();
            it.geo.dispose();
          }
          var out = new THREE.BufferGeometry();
          out.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(pos, 3),
          );
          out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
          out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
          out.setAttribute("color", new THREE.Float32BufferAttribute(cls, 3));
          out.computeBoundingSphere();
          out.computeBoundingBox();
          return out;
        };

        /* ============================================================================
   PartBag — collect many small primitives per joint and flush them into one
   merged mesh per material. This is what lets the character rigs carry heavy
   detail (faces, straps, pads, buckles) at only a handful of draw calls each.
   ========================================================================== */
        function mergeGeoList(list) {
          var pos = [],
            nor = [],
            uv = [],
            i,
            j,
            g,
            p,
            n,
            u,
            cnt;
          for (i = 0; i < list.length; i++) {
            var e = list[i];
            g = e.geo.index ? e.geo.toNonIndexed() : e.geo.clone();
            if (e.matrix) g.applyMatrix4(e.matrix);
            p = g.attributes.position.array;
            n = g.attributes.normal.array;
            u = g.attributes.uv ? g.attributes.uv.array : null;
            cnt = g.attributes.position.count;
            for (j = 0; j < p.length; j++) pos.push(p[j]);
            for (j = 0; j < n.length; j++) nor.push(n[j]);
            if (u) for (j = 0; j < u.length; j++) uv.push(u[j]);
            else for (j = 0; j < cnt * 2; j++) uv.push(0);
            g.dispose();
          }
          var out = new THREE.BufferGeometry();
          out.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(pos, 3),
          );
          out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
          out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
          out.computeBoundingSphere();
          out.computeBoundingBox();
          return out;
        }
        function PartBag(parent) {
          this.parent = parent;
          this.byMat = [];
          this.meshes = [];
          this._q = new THREE.Quaternion();
          this._e = new THREE.Euler();
          this._v = new THREE.Vector3();
          this._s = new THREE.Vector3();
        }
        PartBag.prototype.add = function (
          geo,
          mat,
          x,
          y,
          z,
          rx,
          ry,
          rz,
          sx,
          sy,
          sz,
        ) {
          this._e.set(rx || 0, ry || 0, rz || 0);
          this._q.setFromEuler(this._e);
          this._v.set(x || 0, y || 0, z || 0);
          this._s.set(
            sx === undefined ? 1 : sx,
            sy === undefined ? 1 : sy,
            sz === undefined ? 1 : sz,
          );
          var m = new THREE.Matrix4().compose(this._v, this._q, this._s);
          var slot = null;
          for (var i = 0; i < this.byMat.length; i++)
            if (this.byMat[i].mat === mat) {
              slot = this.byMat[i];
              break;
            }
          if (!slot) {
            slot = { mat: mat, list: [] };
            this.byMat.push(slot);
          }
          slot.list.push({ geo: geo, matrix: m });
          return this;
        };
        PartBag.prototype.flush = function () {
          for (var i = 0; i < this.byMat.length; i++) {
            var g = mergeGeoList(this.byMat[i].list);
            var m = new THREE.Mesh(g, this.byMat[i].mat);
            m.castShadow = true;
            m.receiveShadow = true;
            this.parent.add(m);
            this.meshes.push(m);
          }
          this.byMat = [];
          return this.meshes;
        };

        /* ============================================================================
   SpatialHash — uniform grid broadphase with O(1) de-duplication.
   ========================================================================== */
        var SpatialHash = function (cell) {
          this.cell = cell;
          this.map = {};
          this._q = 0;
        };
        SpatialHash.prototype.key = function (cx, cz) {
          return cx + ":" + cz;
        };
        SpatialHash.prototype.insert = function (b) {
          var c = this.cell;
          var x0 = Math.floor(b.minX / c),
            x1 = Math.floor(b.maxX / c);
          var z0 = Math.floor(b.minZ / c),
            z1 = Math.floor(b.maxZ / c);
          for (var x = x0; x <= x1; x++)
            for (var z = z0; z <= z1; z++) {
              var k = this.key(x, z);
              (this.map[k] || (this.map[k] = [])).push(b);
            }
        };
        SpatialHash.prototype.query = function (x, z, out) {
          out.length = 0;
          var c = this.cell,
            cx = Math.floor(x / c),
            cz = Math.floor(z / c),
            q = ++this._q;
          for (var i = -1; i <= 1; i++)
            for (var j = -1; j <= 1; j++) {
              var arr = this.map[this.key(cx + i, cz + j)];
              if (!arr) continue;
              for (var k = 0; k < arr.length; k++) {
                var b = arr[k];
                if (b._q === q) continue;
                b._q = q;
                out.push(b);
              }
            }
          return out;
        };
        SpatialHash.prototype.queryRay = function (ox, oz, dx, dz, len, out) {
          out.length = 0;
          var c = this.cell,
            steps = Math.ceil(len / c) + 1,
            lx = len / Math.max(0.0001, Math.sqrt(dx * dx + dz * dz));
          var q = ++this._q;
          for (var i = 0; i <= steps; i++) {
            var t = (i / steps) * lx;
            var cx = Math.floor((ox + dx * t) / c),
              cz = Math.floor((oz + dz * t) / c);
            for (var a = -1; a <= 1; a++)
              for (var b = -1; b <= 1; b++) {
                var arr = this.map[this.key(cx + a, cz + b)];
                if (!arr) continue;
                for (var k = 0; k < arr.length; k++) {
                  var bb = arr[k];
                  if (bb._q === q) continue;
                  bb._q = q;
                  out.push(bb);
                }
              }
          }
          return out;
        };

        /* ============================================================================
   NavGrid — coarse walkability map + A* with string-pulled waypoints.
   Used by bots so they path around buildings instead of nose-diving into walls.
   ========================================================================== */
        var NAV = {
          cell: 4,
          n: 0,
          half: 0,
          blocked: null,
          built: false,
          _heap: null,
        };
        function navIdx(ix, iz) {
          return iz * NAV.n + ix;
        }
        function navToCell(x, z) {
          var ix = Math.floor((x + NAV.half) / NAV.cell),
            iz = Math.floor((z + NAV.half) / NAV.cell);
          return { ix: clamp(ix, 0, NAV.n - 1), iz: clamp(iz, 0, NAV.n - 1) };
        }
        function navWalkable(ix, iz) {
          if (ix < 0 || iz < 0 || ix >= NAV.n || iz >= NAV.n) return false;
          return NAV.blocked[navIdx(ix, iz)] === 0;
        }
        function buildNavGrid() {
          var cell = NAV.cell,
            n = Math.ceil(CFG.MAP / cell);
          NAV.n = n;
          NAV.half = CFG.MAP / 2;
          var blocked = new Uint8Array(n * n);
          for (var iz = 0; iz < n; iz++) {
            for (var ix = 0; ix < n; ix++) {
              var x = (ix + 0.5) * cell - NAV.half,
                z = (iz + 0.5) * cell - NAV.half;
              var d = Math.sqrt(x * x + z * z);
              var b = 0;
              if (d > CFG.PLAY_R) b = 1;
              else {
                var y = terrainHeightAt(x, z);
                if (y < CFG.SEA + 0.6)
                  b = 1; // water
                else if (terrainSlope(x, z) > 1.05)
                  b = 1; // cliff
                else if (blockedAt(x, z, y + 0.35, y + 1.75)) b = 1; // solid geometry
              }
              blocked[iz * n + ix] = b;
            }
          }
          /* dilate once so bots keep a body-width away from walls */
          var dil = blocked.slice();
          for (var jz = 1; jz < n - 1; jz++)
            for (var jx = 1; jx < n - 1; jx++) {
              if (blocked[jz * n + jx]) continue;
              if (
                blocked[jz * n + jx - 1] &&
                blocked[jz * n + jx + 1] &&
                blocked[(jz - 1) * n + jx] &&
                blocked[(jz + 1) * n + jx]
              )
                dil[jz * n + jx] = 1;
            }
          NAV.blocked = dil;
          NAV.built = true;
          /* binary heap scratch */
          NAV._heap = [];
        }

        /* --- tiny binary min-heap keyed on f --- */
        function HeapPush(h, node) {
          h.push(node);
          var i = h.length - 1;
          while (i > 0) {
            var p = (i - 1) >> 1;
            if (h[p].f <= h[i].f) break;
            var t = h[p];
            h[p] = h[i];
            h[i] = t;
            i = p;
          }
        }
        function HeapPop(h) {
          var top = h[0],
            last = h.pop();
          if (h.length) {
            h[0] = last;
            var i = 0;
            for (;;) {
              var l = i * 2 + 1,
                r = l + 1,
                m = i;
              if (l < h.length && h[l].f < h[m].f) m = l;
              if (r < h.length && h[r].f < h[m].f) m = r;
              if (m === i) break;
              var t = h[m];
              h[m] = h[i];
              h[i] = t;
              i = m;
            }
          }
          return top;
        }
        var _navG = null,
          _navF = null,
          _navFrom = null,
          _navClosed = null,
          _navStamp = 0;
        function navAlloc() {
          var n = NAV.n * NAV.n;
          if (!_navG || _navG.length !== n) {
            _navG = new Float32Array(n);
            _navF = new Float32Array(n);
            _navFrom = new Int32Array(n);
            _navClosed = new Uint8Array(n);
          }
        }
        var NAV_DIRS = [
          [1, 0, 1],
          [-1, 0, 1],
          [0, 1, 1],
          [0, -1, 1],
          [1, 1, 1.4142],
          [1, -1, 1.4142],
          [-1, 1, 1.4142],
          [-1, -1, 1.4142],
        ];
        /* returns array of {x,z} waypoints (world space) or null */
        function navPath(sx, sz, tx, tz, maxNodes) {
          if (!NAV.built) return null;
          navAlloc();
          var a = navToCell(sx, sz),
            b = navToCell(tx, tz);
          var start = navIdx(a.ix, a.iz),
            goal = navIdx(b.ix, b.iz);
          if (start === goal) return [{ x: tx, z: tz }];
          if (NAV.blocked[goal]) {
            /* find nearest open cell to the goal */
            var best = -1,
              bd = 1e9;
            for (var r = 1; r <= 6 && best < 0; r++) {
              for (var dz = -r; dz <= r; dz++)
                for (var dx = -r; dx <= r; dx++) {
                  if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                  var cx = b.ix + dx,
                    cz = b.iz + dz;
                  if (!navWalkable(cx, cz)) continue;
                  var dd = dx * dx + dz * dz;
                  if (dd < bd) {
                    bd = dd;
                    best = navIdx(cx, cz);
                  }
                }
            }
            if (best < 0) return null;
            goal = best;
          }
          _navG.fill(1e9);
          _navClosed.fill(0);
          var h = NAV._heap;
          h.length = 0;
          _navG[start] = 0;
          _navFrom[start] = -1;
          _navClosed[start] = 1;
          HeapPush(h, { i: start, f: 0 });
          var found = false,
            budget = maxNodes || 1600,
            expanded = 0;
          while (h.length && expanded < budget) {
            var cur = HeapPop(h);
            var ci = cur.i;
            if (ci === goal) {
              found = true;
              break;
            }
            expanded++;
            var cx2 = ci % NAV.n,
              cz2 = (ci - cx2) / NAV.n;
            var gBase = _navG[ci];
            for (var d = 0; d < 8; d++) {
              var D = NAV_DIRS[d];
              var nx = cx2 + D[0],
                nz = cz2 + D[1];
              if (!navWalkable(nx, nz)) continue;
              if (D[2] > 1) {
                if (
                  !navWalkable(cx2 + D[0], cz2) ||
                  !navWalkable(cx2, cz2 + D[1])
                )
                  continue;
              }
              var ni = nz * NAV.n + nx;
              var g = gBase + D[2];
              if (g >= _navG[ni]) continue;
              _navG[ni] = g;
              _navFrom[ni] = ci;
              var hx = Math.abs(nx - b.ix),
                hz = Math.abs(nz - b.iz);
              var hh = hx + hz + (1.4142 - 2) * Math.min(hx, hz);
              _navClosed[ni] = 1;
              HeapPush(h, { i: ni, f: g + hh * 1.06 });
            }
          }
          if (!found) return null;
          /* rebuild + simplify (string pulling) */
          var cells = [],
            p = goal,
            guard = 0;
          while (p !== -1 && guard++ < 4000) {
            cells.push(p);
            p = _navFrom[p];
          }
          cells.reverse();
          var pts = [];
          for (var i = 0; i < cells.length; i++) {
            var idx = cells[i],
              ix2 = idx % NAV.n,
              iz2 = (idx - ix2) / NAV.n;
            pts.push({
              x: (ix2 + 0.5) * NAV.cell - NAV.half,
              z: (iz2 + 0.5) * NAV.cell - NAV.half,
            });
          }
          pts[pts.length - 1] = { x: tx, z: tz };
          return navSimplify(sx, sz, pts);
        }
        /* line-of-walk test between two world points on the nav grid (supercover) */
        function navClear(ax, az, bx, bz) {
          var dx = bx - ax,
            dz = bz - az,
            len = Math.sqrt(dx * dx + dz * dz);
          var steps = Math.ceil(len / (NAV.cell * 0.5));
          for (var i = 0; i <= steps; i++) {
            var t = i / steps;
            var c = navToCell(ax + dx * t, az + dz * t);
            if (!navWalkable(c.ix, c.iz)) return false;
          }
          return true;
        }
        function navSimplify(sx, sz, pts) {
          var out = [],
            i = 0,
            guard = 0;
          while (i < pts.length && guard++ < 200) {
            var j = pts.length - 1,
              picked = j;
            while (j > i + 1) {
              if (
                navClear(
                  i === 0 ? sx : pts[i].x,
                  i === 0 ? sz : pts[i].z,
                  pts[j].x,
                  pts[j].z,
                )
              ) {
                picked = j;
                break;
              }
              j--;
            }
            out.push(pts[picked]);
            i = picked;
          }
          return out.length ? out : null;
        }

        /* ============================================================================
   Sfx — everything is synthesized at runtime with WebAudio. No audio assets.
   ========================================================================== */
        var Sfx = {
          ctx: null,
          master: null,
          noiseBuf: null,
          enabled: true,
          stormGain: null,
          windGain: null,
          engGain: null,
          engOsc: null,
          musicGain: null,
          beatGain: null,
          muted: false,
          init: function () {
            if (this.ctx) return;
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) {
              this.enabled = false;
              return;
            }
            try {
              this.ctx = new AC();
              this.master = this.ctx.createGain();
              this.master.gain.value = SETTINGS.volume;
              this.master.connect(this.ctx.destination);
              var len = Math.floor(this.ctx.sampleRate * 1.2);
              var b = this.ctx.createBuffer(1, len, this.ctx.sampleRate),
                d = b.getChannelData(0);
              for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
              this.noiseBuf = b;
            } catch (e) {
              this.enabled = false;
            }
          },
          resume: function () {
            try {
              if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
            } catch (e) {}
          },
          setVolume: function (v) {
            if (this.master) this.master.gain.value = v;
          },
          noise: function (dur, f0, f1, q, gain, type, delay) {
            if (!this.enabled || !this.ctx) return;
            var t = this.ctx.currentTime + (delay || 0);
            var s = this.ctx.createBufferSource();
            s.buffer = this.noiseBuf;
            var flt = this.ctx.createBiquadFilter();
            flt.type = type || "lowpass";
            flt.frequency.setValueAtTime(f0, t);
            flt.frequency.exponentialRampToValueAtTime(
              Math.max(40, f1),
              t + dur,
            );
            flt.Q.value = q || 1;
            var g = this.ctx.createGain();
            g.gain.setValueAtTime(gain, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            s.connect(flt);
            flt.connect(g);
            g.connect(this.master);
            s.start(t);
            s.stop(t + dur + 0.03);
          },
          tone: function (f0, f1, dur, type, gain, delay) {
            if (!this.enabled || !this.ctx) return;
            var t = this.ctx.currentTime + (delay || 0);
            var o = this.ctx.createOscillator();
            o.type = type || "sine";
            o.frequency.setValueAtTime(f0, t);
            o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
            var g = this.ctx.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(gain, t + 0.008);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g);
            g.connect(this.master);
            o.start(t);
            o.stop(t + dur + 0.03);
          },
          /* --- gunfire: layered crack + body + tail --- */
          shot: function (kind, dist) {
            var v = dist === undefined ? 1 : clamp(1 - dist / 110, 0.05, 1);
            if (kind === "shotgun") {
              this.noise(0.34, 2600, 130, 1, 0.5 * v, "lowpass");
              this.tone(150, 38, 0.24, "square", 0.17 * v);
              this.noise(0.5, 700, 90, 1, 0.16 * v, "lowpass", 0.05);
            } else if (kind === "sniper") {
              this.noise(0.6, 3200, 100, 1, 0.55 * v, "lowpass");
              this.tone(110, 26, 0.45, "sawtooth", 0.22 * v);
              this.noise(0.9, 420, 70, 1, 0.2 * v, "lowpass", 0.06);
            } else if (kind === "smg") {
              this.noise(0.08, 3400, 700, 1, 0.23 * v, "bandpass");
              this.tone(330, 120, 0.055, "square", 0.07 * v);
            } else if (kind === "pistol") {
              this.noise(0.13, 2900, 380, 1, 0.3 * v, "lowpass");
              this.tone(255, 85, 0.09, "square", 0.1 * v);
            } else if (kind === "heavy") {
              this.noise(0.3, 2400, 150, 1, 0.48 * v, "lowpass");
              this.tone(140, 40, 0.3, "sawtooth", 0.2 * v);
            } else if (kind === "launcher") {
              this.noise(0.45, 1400, 180, 1, 0.42 * v, "lowpass");
              this.tone(90, 34, 0.5, "sawtooth", 0.2 * v);
            } else {
              this.noise(0.15, 3100, 340, 1, 0.33 * v, "lowpass");
              this.tone(225, 78, 0.11, "square", 0.1 * v);
            }
          },
          explosion: function () {
            this.noise(0.9, 1800, 60, 1, 0.72, "lowpass");
            this.tone(90, 26, 0.85, "sawtooth", 0.34);
            this.noise(1.6, 380, 50, 1, 0.24, "lowpass", 0.08);
            this.tone(50, 20, 1.4, "sine", 0.2, 0.05);
          },
          hitmark: function (head, kill) {
            this.tone(
              head ? 1900 : 1500,
              head ? 2500 : 2100,
              0.05,
              "square",
              0.15,
            );
            this.tone(2300, 2700, 0.05, "square", 0.07, 0.03);
            if (kill) this.tone(900, 1700, 0.18, "triangle", 0.2, 0.06);
          },
          hurt: function () {
            this.noise(0.2, 900, 180, 1, 0.32, "lowpass");
            this.tone(220, 70, 0.2, "sawtooth", 0.14);
          },
          shieldHit: function () {
            this.tone(1300, 1900, 0.08, "sine", 0.16);
            this.noise(0.1, 2600, 900, 1, 0.16, "bandpass");
          },
          build: function () {
            this.tone(420, 640, 0.07, "triangle", 0.17);
            this.noise(0.09, 1500, 520, 1, 0.17, "bandpass");
          },
          edit: function () {
            this.tone(700, 1100, 0.06, "square", 0.14);
            this.noise(0.07, 2200, 900, 1, 0.14, "bandpass");
          },
          repair: function () {
            this.tone(500, 900, 0.1, "triangle", 0.15);
            this.tone(760, 1200, 0.1, "sine", 0.1, 0.08);
          },
          break: function () {
            this.noise(0.24, 1800, 220, 1, 0.32, "lowpass");
            this.noise(0.4, 900, 180, 1, 0.14, "lowpass", 0.05);
          },
          swing: function () {
            this.noise(0.16, 900, 260, 1, 0.16, "bandpass");
          },
          harvest: function (kind) {
            if (kind === "stone") {
              this.tone(240, 150, 0.1, "square", 0.15);
              this.noise(0.12, 1200, 300, 1, 0.2, "bandpass");
            } else if (kind === "metal") {
              this.tone(900, 500, 0.14, "triangle", 0.16);
              this.noise(0.14, 2600, 900, 1, 0.18, "bandpass");
            } else {
              this.tone(180, 110, 0.12, "sawtooth", 0.15);
              this.noise(0.14, 900, 240, 1, 0.22, "lowpass");
            }
          },
          pickup: function () {
            this.tone(700, 1250, 0.11, "triangle", 0.2);
            this.tone(1100, 1600, 0.1, "sine", 0.12, 0.06);
          },
          reload: function () {
            this.tone(300, 180, 0.06, "square", 0.12);
            this.tone(220, 430, 0.08, "square", 0.1, 0.16);
          },
          reloadDone: function () {
            this.tone(560, 760, 0.07, "square", 0.14);
          },
          step: function (kind) {
            var f =
              kind === "metal"
                ? 1500
                : kind === "wood"
                  ? 800
                  : kind === "stone"
                    ? 1900
                    : kind === "water"
                      ? 520
                      : kind === "sand"
                        ? 420
                        : 700;
            var g = kind === "metal" ? 0.12 : 0.1;
            this.noise(0.06, f, f * 0.35, 1, g, "lowpass");
          },
          jump: function () {
            this.tone(420, 700, 0.1, "sine", 0.1);
          },
          land: function () {
            this.noise(0.14, 620, 150, 1, 0.22, "lowpass");
          },
          splash: function () {
            this.noise(0.35, 1400, 300, 1, 0.28, "bandpass");
          },
          glider: function () {
            this.noise(0.8, 760, 300, 1, 0.26, "lowpass");
            this.tone(180, 120, 0.5, "sine", 0.1);
          },
          elim: function () {
            this.tone(600, 1200, 0.1, "square", 0.22);
            this.tone(900, 1800, 0.14, "square", 0.2, 0.09);
            this.tone(1400, 2400, 0.2, "sine", 0.16, 0.18);
          },
          knock: function () {
            this.tone(300, 140, 0.3, "square", 0.22);
            this.noise(0.3, 700, 180, 1, 0.2, "lowpass");
          },
          revive: function () {
            var n = [500, 660, 880];
            for (var i = 0; i < 3; i++)
              this.tone(n[i], n[i] * 1.25, 0.2, "triangle", 0.16, i * 0.1);
          },
          chest: function () {
            this.tone(500, 900, 0.16, "triangle", 0.18);
            this.tone(760, 1400, 0.22, "sine", 0.14, 0.1);
          },
          heal: function () {
            this.tone(600, 900, 0.22, "sine", 0.16);
            this.tone(900, 1200, 0.2, "sine", 0.1, 0.14);
          },
          victory: function () {
            var n = [523, 659, 784, 1046, 1318];
            for (var i = 0; i < n.length; i++)
              this.tone(n[i], n[i], 0.38, "triangle", 0.2, i * 0.15);
          },
          defeat: function () {
            var n = [420, 340, 260, 180];
            for (var i = 0; i < n.length; i++)
              this.tone(n[i], n[i] * 0.8, 0.4, "sawtooth", 0.15, i * 0.18);
          },
          stormStart: function () {
            this.tone(160, 90, 1.2, "sine", 0.22);
            this.noise(1.0, 500, 120, 1, 0.14, "lowpass");
          },
          thunder: function () {
            this.noise(1.8, 420, 60, 1, 0.3, "lowpass");
            this.tone(60, 24, 1.6, "sine", 0.24, 0.05);
          },
          /* --- supply drop: a distant jet, a rising whistle, then a heavy thud --- */
          airdrop: function () {
            this.noise(1.6, 340, 90, 1, 0.16, "lowpass");
            this.tone(190, 150, 1.5, "sawtooth", 0.09);
            var n = [880, 1100, 1380];
            for (var i = 0; i < 3; i++)
              this.tone(
                n[i],
                n[i] * 1.06,
                0.3,
                "triangle",
                0.1,
                0.5 + i * 0.22,
              );
          },
          dropLand: function () {
            this.noise(0.7, 900, 70, 1, 0.42, "lowpass");
            this.tone(120, 34, 0.6, "sawtooth", 0.22);
            this.noise(1.4, 300, 50, 1, 0.16, "lowpass", 0.08);
          },
          dropOpen: function () {
            var n = [620, 830, 1046, 1318];
            for (var i = 0; i < n.length; i++)
              this.tone(n[i], n[i] * 1.3, 0.3, "triangle", 0.18, i * 0.09);
            this.noise(0.5, 2400, 400, 1, 0.2, "bandpass", 0.02);
          },
          reboot: function () {
            var n = [330, 440, 554, 660, 880];
            for (var i = 0; i < n.length; i++)
              this.tone(n[i], n[i], 0.34, "triangle", 0.17, i * 0.12);
            this.noise(1.2, 700, 1400, 1, 0.12, "bandpass", 0.1);
          },
          vehicle: function (on) {
            if (!this.enabled || !this.ctx) return;
            if (on && !this.engGain) {
              var o = this.ctx.createOscillator();
              o.type = "sawtooth";
              o.frequency.value = 52;
              var o2 = this.ctx.createOscillator();
              o2.type = "square";
              o2.frequency.value = 104;
              var f = this.ctx.createBiquadFilter();
              f.type = "lowpass";
              f.frequency.value = 420;
              f.Q.value = 2;
              var g = this.ctx.createGain();
              g.gain.value = 0;
              o.connect(f);
              o2.connect(f);
              f.connect(g);
              g.connect(this.master);
              o.start();
              o2.start();
              this.engOsc = { o: o, o2: o2, f: f };
              this.engGain = g;
            } else if (!on && this.engGain) {
              try {
                this.engOsc.o.stop();
                this.engOsc.o2.stop();
              } catch (e) {}
              try {
                this.engGain.disconnect();
              } catch (e) {}
              this.engGain = null;
              this.engOsc = null;
            }
          },
          setEngine: function (v) {
            if (this.engGain) this.engGain.gain.value = clamp(v, 0, 0.24);
            if (this.engOsc) {
              this.engOsc.o.frequency.value = 46 + v * 70;
              this.engOsc.o2.frequency.value = 92 + v * 140;
              this.engOsc.f.frequency.value = 380 + v * 900;
            }
          },
          startStormLoop: function () {
            if (!this.enabled || !this.ctx || this.stormGain) return;
            var s = this.ctx.createBufferSource();
            s.buffer = this.noiseBuf;
            s.loop = true;
            var f = this.ctx.createBiquadFilter();
            f.type = "bandpass";
            f.frequency.value = 420;
            f.Q.value = 0.7;
            var g = this.ctx.createGain();
            g.gain.value = 0.0;
            s.connect(f);
            f.connect(g);
            g.connect(this.master);
            s.start();
            this.stormGain = g;
          },
          setStorm: function (v) {
            if (this.stormGain) this.stormGain.gain.value = clamp(v, 0, 0.34);
          },
          startWind: function () {
            if (!this.enabled || !this.ctx || this.windGain) return;
            var s = this.ctx.createBufferSource();
            s.buffer = this.noiseBuf;
            s.loop = true;
            var f = this.ctx.createBiquadFilter();
            f.type = "lowpass";
            f.frequency.value = 520;
            f.Q.value = 0.4;
            var g = this.ctx.createGain();
            g.gain.value = 0.035;
            s.connect(f);
            f.connect(g);
            g.connect(this.master);
            s.start();
            this.windGain = g;
          },
          setWind: function (v) {
            if (this.windGain) this.windGain.gain.value = clamp(v, 0, 0.14);
          },
          startBeat: function () {
            if (!this.enabled || !this.ctx || this.beatGain) return;
            var g = this.ctx.createGain();
            g.gain.value = 0;
            g.connect(this.master);
            this.beatGain = g;
            this._beatT = 0;
          },
          tickBeat: function (dt, intensity) {
            if (!this.beatGain) return;
            this._beatT = (this._beatT || 0) - dt;
            if (this._beatT <= 0 && intensity > 0.01) {
              this._beatT = 0.62;
              var t = this.ctx.currentTime;
              var o = this.ctx.createOscillator();
              o.type = "sine";
              o.frequency.setValueAtTime(64, t);
              o.frequency.exponentialRampToValueAtTime(34, t + 0.2);
              var g = this.ctx.createGain();
              g.gain.setValueAtTime(0, t);
              g.gain.linearRampToValueAtTime(0.3 * intensity, t + 0.02);
              g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
              o.connect(g);
              g.connect(this.master);
              o.start(t);
              o.stop(t + 0.3);
              this.tone(150, 90, 0.1, "sine", 0.06 * intensity, 0.16);
            }
          },
          music: function (kind) {
            if (!this.enabled || !this.ctx) return;
            if (kind === "drop") {
              var n = [392, 523, 659, 784];
              for (var i = 0; i < n.length; i++)
                this.tone(n[i], n[i], 0.6, "triangle", 0.13, i * 0.22);
            } else if (kind === "tension") {
              this.tone(196, 196, 1.2, "sawtooth", 0.09);
              this.tone(233, 233, 1.2, "sawtooth", 0.07, 0.1);
            }
          },
        };

// === gfx ===
/* ==== 10_gfx.js ==== */
        /* ============================================================================
   10_GFX — renderer, custom post-processing stack (bloom + grade + vignette +
   grain + chromatic aberration), shader sky, Gerstner water, triplanar terrain,
   wind-animated foliage, lights, fog and the decal pool.
   ========================================================================== */

        var renderer,
          scene,
          camera,
          sun,
          hemi,
          bounce,
          skyMesh,
          worldGroup,
          waterMesh;
        var WORLD_SIZE = 4200;

        /* ============================================================================
   POST — a small hand-written pipeline. No external CDN dependency, and it
   degrades gracefully: if anything fails we simply render straight to canvas.
   ========================================================================== */
        var POST = {
          ok: false,
          w: 0,
          h: 0,
          rtScene: null,
          rtA: null,
          rtB: null,
          quadScene: null,
          quadCam: null,
          quad: null,
          mBright: null,
          mBlur: null,
          mComp: null,
          bloom: 0.62,
          exposure: 1.06,
          contrast: 1.07,
          saturation: 1.16,
          vignette: 0.34,
          grain: 0.022,
          aberration: 0.0016,
          hurt: 0,
          level: 1,
          init: function () {
            try {
              var gl2 = renderer.capabilities && renderer.capabilities.isWebGL2;
              var type = gl2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
              var opts = {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: type,
                depthBuffer: true,
                stencilBuffer: false,
              };
              var bopts = {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: type,
                depthBuffer: false,
                stencilBuffer: false,
              };
              this.rtScene = new THREE.WebGLRenderTarget(2, 2, opts);
              this.rtA = new THREE.WebGLRenderTarget(2, 2, bopts);
              this.rtB = new THREE.WebGLRenderTarget(2, 2, bopts);

              this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
              this.quadScene = new THREE.Scene();
              var geo = new THREE.PlaneGeometry(2, 2);
              this.quad = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
              this.quad.frustumCulled = false;
              this.quadScene.add(this.quad);

              var VS =
                "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }";

              this.mBright = new THREE.ShaderMaterial({
                uniforms: {
                  tDiffuse: { value: null },
                  threshold: { value: 0.72 },
                  knee: { value: 0.42 },
                },
                vertexShader: VS,
                fragmentShader:
                  "uniform sampler2D tDiffuse; uniform float threshold; uniform float knee; varying vec2 vUv;" +
                  "void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb;" +
                  " float l=dot(c,vec3(0.2126,0.7152,0.0722));" +
                  " float w=smoothstep(threshold,threshold+knee,l);" +
                  " gl_FragColor=vec4(c*w,1.0); }",
                depthTest: false,
                depthWrite: false,
              });
              this.mBlur = new THREE.ShaderMaterial({
                uniforms: {
                  tDiffuse: { value: null },
                  dir: { value: new THREE.Vector2(1, 0) },
                  res: { value: new THREE.Vector2(1, 1) },
                },
                vertexShader: VS,
                fragmentShader:
                  "uniform sampler2D tDiffuse; uniform vec2 dir; uniform vec2 res; varying vec2 vUv;" +
                  "void main(){ vec2 t=dir/res; vec3 s=texture2D(tDiffuse,vUv).rgb*0.2270270270;" +
                  " s+=texture2D(tDiffuse,vUv+t*1.3846153846).rgb*0.3162162162;" +
                  " s+=texture2D(tDiffuse,vUv-t*1.3846153846).rgb*0.3162162162;" +
                  " s+=texture2D(tDiffuse,vUv+t*3.2307692308).rgb*0.0702702703;" +
                  " s+=texture2D(tDiffuse,vUv-t*3.2307692308).rgb*0.0702702703;" +
                  " gl_FragColor=vec4(s,1.0); }",
                depthTest: false,
                depthWrite: false,
              });
              this.mComp = new THREE.ShaderMaterial({
                uniforms: {
                  tDiffuse: { value: null },
                  tBloom: { value: null },
                  bloom: { value: this.bloom },
                  exposure: { value: this.exposure },
                  contrast: { value: this.contrast },
                  saturation: { value: this.saturation },
                  vignette: { value: this.vignette },
                  grain: { value: this.grain },
                  aberration: { value: this.aberration },
                  time: { value: 0 },
                  res: { value: new THREE.Vector2(1, 1) },
                  hurt: { value: 0 },
                },
                vertexShader: VS,
                fragmentShader:
                  "uniform sampler2D tDiffuse; uniform sampler2D tBloom;" +
                  "uniform float bloom,exposure,contrast,saturation,vignette,grain,aberration,time,hurt;" +
                  "uniform vec2 res; varying vec2 vUv;" +
                  "void main(){ vec2 uv=vUv; vec2 c=uv-0.5; float r2=dot(c,c);" +
                  " vec2 off=c*aberration*(0.5+r2*2.4);" +
                  " vec3 base; base.r=texture2D(tDiffuse,uv+off).r; base.g=texture2D(tDiffuse,uv).g;" +
                  " base.b=texture2D(tDiffuse,uv-off).b;" +
                  " vec3 bl=texture2D(tBloom,uv).rgb;" +
                  " vec3 col=(base+bl*bloom)*exposure;" +
                  " col=pow(max(col,vec3(0.0)),vec3(0.4545454545));" +
                  " float l=dot(col,vec3(0.2126,0.7152,0.0722));" +
                  " col=mix(vec3(l),col,saturation);" +
                  " col=(col-0.5)*contrast+0.5;" +
                  " float v=1.0-vignette*smoothstep(0.16,0.82,r2*1.7);" +
                  " col*=v;" +
                  " col=mix(col,vec3(0.86,0.05,0.05),hurt*0.42);" +
                  " float n=fract(sin(dot(uv*res,vec2(12.9898,78.233))+time*13.0)*43758.5453);" +
                  " col+=(n-0.5)*grain;" +
                  " gl_FragColor=vec4(clamp(col,0.0,1.0),1.0); }",
                depthTest: false,
                depthWrite: false,
              });
              this.ok = true;
              this.enabled = true;
            } catch (e) {
              console.warn("post-processing unavailable", e);
              this.ok = false;
              this.enabled = false;
            }
          },
          enabled: false,
          resize: function (w, h) {
            if (!this.ok) return;
            this.w = w;
            this.h = h;
            this.rtScene.setSize(w, h);
            var bw = Math.max(2, Math.floor(w / 4)),
              bh = Math.max(2, Math.floor(h / 4));
            this.rtA.setSize(bw, bh);
            this.rtB.setSize(bw, bh);
            this.mBlur.uniforms.res.value.set(bw, bh);
            this.mComp.uniforms.res.value.set(w, h);
          },
          applyLevel: function (level) {
            this.level = level;
            var on = SETTINGS.postFx && SETTINGS.bloom && level >= 2;
            this.enabled = this.ok && on;
            if (level >= 3) {
              this.bloom = 0.66;
              this.grain = 0.018;
              this.aberration = 0.0016;
            } else {
              this.bloom = 0.5;
              this.grain = 0.028;
              this.aberration = 0.0012;
            }
            if (this.mComp) {
              this.mComp.uniforms.bloom.value = this.bloom;
              this.mComp.uniforms.grain.value = this.grain;
              this.mComp.uniforms.aberration.value = this.aberration;
            }
          },
          render: function (dt) {
            if (!this.enabled) {
              renderer.setRenderTarget(null);
              renderer.render(scene, camera);
              return;
            }
            var M = this;
            renderer.setRenderTarget(M.rtScene);
            renderer.clear();
            renderer.render(scene, camera);
            /* bright pass */
            M.quad.material = M.mBright;
            M.mBright.uniforms.tDiffuse.value = M.rtScene.texture;
            renderer.setRenderTarget(M.rtA);
            renderer.render(M.quadScene, M.quadCam);
            /* separable blur, two widening passes */
            M.quad.material = M.mBlur;
            for (var pass = 0; pass < 2; pass++) {
              var spread = pass === 0 ? 1.0 : 2.1;
              M.mBlur.uniforms.tDiffuse.value = M.rtA.texture;
              M.mBlur.uniforms.dir.value.set(spread, 0);
              renderer.setRenderTarget(M.rtB);
              renderer.render(M.quadScene, M.quadCam);
              M.mBlur.uniforms.tDiffuse.value = M.rtB.texture;
              M.mBlur.uniforms.dir.value.set(0, spread);
              renderer.setRenderTarget(M.rtA);
              renderer.render(M.quadScene, M.quadCam);
            }
            /* composite */
            M.quad.material = M.mComp;
            M.mComp.uniforms.tDiffuse.value = M.rtScene.texture;
            M.mComp.uniforms.tBloom.value = M.rtA.texture;
            M.mComp.uniforms.time.value = GAMETIME;
            M.mComp.uniforms.hurt.value = M.hurt;
            renderer.setRenderTarget(null);
            renderer.render(M.quadScene, M.quadCam);
          },
        };

        /* ============================================================================
   DECALS — pooled quads for bullet holes and scorch marks.
   ========================================================================== */
        var DECALS = { pool: [], next: 0, cap: 110, ready: false };
        function initDecals() {
          var geo = new THREE.PlaneGeometry(1, 1);
          for (var i = 0; i < DECALS.cap; i++) {
            var m = new THREE.Mesh(
              geo,
              new THREE.MeshBasicMaterial({
                map: TEX.hole,
                transparent: true,
                opacity: 0.9,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -4,
                polygonOffsetUnits: -4,
              }),
            );
            m.visible = false;
            m.renderOrder = 2;
            m.frustumCulled = false;
            scene.add(m);
            DECALS.pool.push({ m: m, life: 0 });
          }
          DECALS.ready = true;
        }
        function addDecal(x, y, z, nx, ny, nz, size, kind, life) {
          if (!DECALS.ready) return;
          var d = DECALS.pool[DECALS.next];
          DECALS.next = (DECALS.next + 1) % DECALS.cap;
          var m = d.m;
          m.material.map = kind === "scorch" ? TEX.scorch : TEX.hole;
          m.material.needsUpdate = true;
          m.position.set(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03);
          m.lookAt(x + nx, y + ny, z + nz);
          m.scale.setScalar(size);
          m.material.opacity = kind === "scorch" ? 0.95 : 0.88;
          m.visible = true;
          d.life = life || 22;
          d.max = d.life;
        }
        function updateDecals(dt) {
          for (var i = 0; i < DECALS.pool.length; i++) {
            var d = DECALS.pool[i];
            if (d.life <= 0) continue;
            d.life -= dt;
            if (d.life <= 2.0)
              d.m.material.opacity =
                Math.max(0, d.life / 2.0) *
                (d.m.material.map === TEX.scorch ? 0.95 : 0.88);
            if (d.life <= 0) d.m.visible = false;
          }
        }

        /* ============================================================================
   Sky — gradient + sun disc + halo + drifting cirrus + subtle horizon haze.
   ========================================================================== */
        var SKY = {
          mat: null,
          sunDir: new THREE.Vector3(0.42, 0.58, 0.3).normalize(),
        };
        function makeSky() {
          var geo = new THREE.SphereGeometry(1600, 40, 24);
          SKY.mat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: {
              top: { value: col(0x1c4fbe) },
              mid: { value: col(0x74b6ef) },
              bot: { value: col(0xd8e8f6) },
              sunDir: { value: SKY.sunDir.clone() },
              uTime: { value: 0 },
              haze: { value: col(0xcfe2f2) },
            },
            vertexShader:
              "varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
            fragmentShader:
              "uniform vec3 top,mid,bot,haze; uniform vec3 sunDir; uniform float uTime; varying vec3 vP;" +
              "float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }" +
              "float nz(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);" +
              " return mix(mix(h(i),h(i+vec2(1.0,0.0)),f.x),mix(h(i+vec2(0.0,1.0)),h(i+vec2(1.0,1.0)),f.x),f.y); }" +
              "float fb(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*nz(p); p*=2.07; a*=0.5; } return s; }" +
              "void main(){" +
              " vec3 d=normalize(vP);" +
              " float up=clamp(d.y*0.5+0.5,0.0,1.0);" +
              " vec3 c=mix(bot,mid,smoothstep(0.42,0.56,up));" +
              " c=mix(c,top,smoothstep(0.55,1.0,up));" +
              " vec3 sd=normalize(sunDir);" +
              " float s=max(dot(d,sd),0.0);" +
              " c+=vec3(1.0,0.86,0.62)*pow(s,12.0)*0.5;" +
              " c+=vec3(1.0,0.93,0.80)*pow(s,220.0)*2.2;" +
              " c=mix(c,vec3(1.0,0.97,0.90),pow(s,900.0)*3.0);" +
              " float horizon=1.0-smoothstep(0.0,0.28,abs(d.y));" +
              " c=mix(c,haze,horizon*0.42);" +
              " if(d.y>0.02){" +
              "   vec2 cuv=vec2(atan(d.z,d.x)*1.6, d.y*4.4);" +
              "   float cl=fb(cuv*2.4+vec2(uTime*0.0075,uTime*0.0016));" +
              "   float cl2=fb(cuv*6.1+vec2(uTime*0.016,-uTime*0.004));" +
              "   float cover=smoothstep(0.52,0.86,cl*0.72+cl2*0.4);" +
              "   float fade=smoothstep(0.02,0.30,d.y)*(1.0-smoothstep(0.55,1.0,d.y)*0.5);" +
              "   c=mix(c,vec3(1.0,1.0,1.0),cover*fade*0.72);" +
              "   c=mix(c,vec3(0.80,0.84,0.92),cover*fade*0.22);" +
              " }" +
              " gl_FragColor=vec4(c,1.0); }",
          });
          skyMesh = new THREE.Mesh(geo, SKY.mat);
          skyMesh.frustumCulled = false;
          scene.add(skyMesh);
        }

        function makeClouds() {
          var g = new THREE.PlaneGeometry(1, 1);
          var mat = new THREE.MeshBasicMaterial({
            map: TEX.cloud,
            transparent: true,
            depthWrite: false,
            fog: false,
          });
          for (var i = 0; i < 34; i++) {
            var m = new THREE.Mesh(g, mat.clone());
            m.material.opacity = rnd(0.24, 0.56);
            m.material.color = col(srnd() < 0.4 ? 0xffffff : 0xf2f6ff);
            var a = rnd(0, Math.PI * 2),
              r = rnd(40, 560);
            m.position.set(Math.cos(a) * r, rnd(140, 280), Math.sin(a) * r);
            m.scale.set(rnd(160, 420), rnd(160, 420), 1);
            m.rotation.x = -Math.PI / 2;
            m.rotation.z = rnd(0, 6.28);
            m.renderOrder = -2;
            m.userData.drift = rnd(0.4, 1.4);
            scene.add(m);
            CLOUDS.push(m);
          }
        }
        var CLOUDS = [];

        /* ============================================================================
   Terrain — vertex-coloured heightfield with a triplanar-ish texture blend.
   ========================================================================== */
        function buildTerrainMesh() {
          var geo = new THREE.PlaneGeometry(CFG.MAP, CFG.MAP, CFG.SEG, CFG.SEG);
          geo.rotateX(-Math.PI / 2);
          var pos = geo.attributes.position,
            count = pos.count;
          var colors = new Float32Array(count * 3);
          var cSand = col(0xdcc98f),
            cGrass = col(0x4d8f36),
            cGrass2 = col(0x74b24e),
            cDirt = col(0x7b6136),
            cRock = col(0x8b8175),
            cRock2 = col(0x655e55),
            cSnow = col(0xeaf1f8);
          var tmp = new THREE.Color();
          for (var i = 0; i < count; i++) {
            var x = pos.getX(i),
              z = pos.getZ(i);
            var y = terrainHeightAt(x, z);
            pos.setY(i, y);
            var nz = fbm(x * 0.06 + 5, z * 0.06 - 2, 2);
            var sl = terrainSlope(x, z);
            if (y < 2.6) tmp.copy(cSand);
            else tmp.copy(cGrass).lerp(cGrass2, nz);
            tmp.lerp(cDirt, smoothstep(0.35, 0.75, sl) * 0.8);
            tmp.lerp(cRock, smoothstep(28, 46, y));
            tmp.lerp(cRock2, smoothstep(0.55, 0.95, sl) * 0.55);
            tmp.lerp(cSnow, smoothstep(64, 86, y));
            var v = 0.9 + nz * 0.2;
            colors[i * 3] = tmp.r * v;
            colors[i * 3 + 1] = tmp.g * v;
            colors[i * 3 + 2] = tmp.b * v;
          }
          geo.setAttribute(
            "color",
            new THREE.Float32BufferAttribute(colors, 3),
          );
          geo.computeVertexNormals();
          var mesh = new THREE.Mesh(geo, MAT.terra);
          mesh.receiveShadow = true;
          scene.add(mesh);
        }
        /* inject multi-texture blending into the standard terrain material */
        function patchTerrainMaterial() {
          MAT.terra.onBeforeCompile = function (shader) {
            shader.uniforms.uGrass = { value: TEX.grass };
            shader.uniforms.uRock = { value: TEX.rock };
            shader.uniforms.uSand = { value: TEX.sand };
            shader.uniforms.uSnow = { value: TEX.snow };
            shader.uniforms.uDirt = { value: TEX.dirt };
            shader.vertexShader =
              "varying vec3 vWPos;\n" +
              shader.vertexShader.replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\n vWPos=(modelMatrix*vec4(position,1.0)).xyz;",
              );
            /* The custom samplers MUST be declared in the shader source. Adding them to
       shader.uniforms only supplies values -- three.js does not emit
       declarations for custom uniforms, so without these lines the fragment
       shader fails to compile ("'uGrass' : undeclared identifier"), the whole
       terrain program is invalid, and the terrain never draws at all. */
            shader.fragmentShader =
              "varying vec3 vWPos;\n" +
              "uniform sampler2D uGrass;\n" +
              "uniform sampler2D uRock;\n" +
              "uniform sampler2D uSand;\n" +
              "uniform sampler2D uSnow;\n" +
              "uniform sampler2D uDirt;\n" +
              /* Triplanar lookup. A flat XZ projection stretches to infinity as a face
         turns vertical, so cliffs and cave walls smeared into streaks that read
         as "no texture". Blending the three axis-aligned projections by the
         squared normal keeps the texel density constant on every face. */
              "vec3 tpTex(sampler2D t, vec3 p, float sc, vec3 nrm){\n" +
              "  vec3 n=abs(nrm); n=n*n; n/=(n.x+n.y+n.z+1e-5);\n" +
              "  vec3 cx=texture2D(t,p.zy*sc).rgb;\n" +
              "  vec3 cy=texture2D(t,p.xz*sc).rgb;\n" +
              "  vec3 cz=texture2D(t,p.xy*sc).rgb;\n" +
              "  return cx*n.x+cy*n.y+cz*n.z;\n" +
              "}\n" +
              shader.fragmentShader.replace(
                "#include <map_fragment>",
                "vec3 wN=normalize(vNormal);\n" +
                  "float slope=1.0-clamp(wN.y,0.0,1.0);\n" +
                  "float hgt=vWPos.y;\n" +
                  "float wRock=smoothstep(0.30,0.68,slope);\n" +
                  "float wSnow=smoothstep(58.0,82.0,hgt)*(1.0-wRock*0.6);\n" +
                  "float wSand=(1.0-smoothstep(2.0,4.4,hgt))*(1.0-wRock);\n" +
                  "float wGrass=clamp(1.0-wRock-wSnow-wSand,0.0,1.0);\n" +
                  /* grass + rock are the two layers that appear on slopes, so they get
           the triplanar treatment; sand/snow/dirt live on flatter ground */
                  "vec3 cg=tpTex(uGrass,vWPos,0.30,wN);\n" +
                  "vec3 cr=tpTex(uRock ,vWPos,0.19,wN);\n" +
                  "vec3 cs=texture2D(uSand,vWPos.xz*0.26).rgb;\n" +
                  "vec3 cw=texture2D(uSnow,vWPos.xz*0.17).rgb;\n" +
                  "vec3 cd=texture2D(uDirt,vWPos.xz*0.52).rgb;\n" +
                  "vec3 tex=cg*wGrass+cr*wRock+cs*wSand+cw*wSnow;\n" +
                  "tex=mix(tex,cd,smoothstep(0.5,0.95,slope)*0.35);\n" +
                  /* Wide flat areas are only ~3m of tile across, so they used to read as
           one untextured slab. A large-scale mottle breaks that up. */
                  "float macro=texture2D(uDirt,vWPos.xz*0.0105).g;\n" +
                  "tex*=0.78+macro*0.44;\n" +
                  "diffuseColor.rgb*=tex*1.62;",
              );
          };
          MAT.terra.needsUpdate = true;
        }
        /* gentle wind sway for instanced foliage */
        function patchFoliageWind(mat, amp) {
          mat.userData.windUniform = null;
          mat.onBeforeCompile = function (shader) {
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uWind = { value: amp };
            mat.userData.windUniform = shader.uniforms;
            shader.vertexShader =
              "uniform float uTime;\nuniform float uWind;\n" +
              shader.vertexShader.replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\n" +
                  "#ifdef USE_INSTANCING\n" +
                  " vec3 iPos=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);\n" +
                  "#else\n" +
                  " vec3 iPos=vec3(0.0);\n" +
                  "#endif\n" +
                  " float ph=uTime*1.55+iPos.x*0.24+iPos.z*0.31;\n" +
                  " float amp2=uWind*max(0.0,transformed.y);\n" +
                  " transformed.x+=sin(ph)*amp2*0.085;\n" +
                  " transformed.z+=cos(ph*0.81+1.3)*amp2*0.062;\n",
              );
          };
          mat.needsUpdate = true;
        }

        /* ============================================================================
   Water — Gerstner-style waves, fresnel, shore foam from the heightmap depth.
   ========================================================================== */
        var WATER = { mat: null, heightTex: null };
        function buildWater() {
          var g = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 140, 140);
          g.rotateX(-Math.PI / 2);
          /* pack terrain height into a 16-bit RG texture so the shader knows the depth */
          var n = HM.n,
            data = new Uint8Array(n * n * 4);
          for (var i = 0; i < n * n; i++) {
            var v = clamp((HM.data[i] + 16) / 132, 0, 1);
            var q = Math.floor(v * 65535);
            data[i * 4] = q >> 8;
            data[i * 4 + 1] = q & 255;
            data[i * 4 + 2] = 0;
            data[i * 4 + 3] = 255;
          }
          var tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.needsUpdate = true;
          WATER.heightTex = tex;

          WATER.mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: true,
            uniforms: {
              uTime: { value: 0 },
              uHeight: { value: tex },
              uMap: { value: CFG.MAP },
              uHalf: { value: CFG.MAP / 2 },
              uSea: { value: CFG.SEA },
              uSun: { value: SKY.sunDir.clone() },
              uShallow: { value: col(0x2fa8c8) },
              uDeep: { value: col(0x0d2f6b) },
              uFoam: { value: col(0xe8f6ff) },
              uFog: { value: col(0xc3dcf2) },
              uCam: { value: new THREE.Vector3() },
            },
            vertexShader:
              "uniform float uTime; varying vec3 vW; varying vec2 vUv2; varying vec3 vN;" +
              "void main(){" +
              " vUv2=uv;" +
              " vec3 p=position;" +
              " float w1=sin(p.x*0.035+uTime*0.85)+sin(p.z*0.041-uTime*0.72);" +
              " float w2=sin((p.x+p.z)*0.017+uTime*0.5)*1.6;" +
              " float w3=sin(p.x*0.11-uTime*1.7)*0.35+cos(p.z*0.13+uTime*1.4)*0.35;" +
              " p.y+=w1*0.34+w2*0.22+w3*0.12;" +
              " float dx=cos(p.x*0.035+uTime*0.85)*0.035+w2*0.0+cos((p.x+p.z)*0.017+uTime*0.5)*1.6*0.017;" +
              " float dz=cos(p.z*0.041-uTime*0.72)*0.041+cos((p.x+p.z)*0.017+uTime*0.5)*1.6*0.017;" +
              " vN=normalize(vec3(-dx*3.4,1.0,-dz*3.4));" +
              " vec4 wp=modelMatrix*vec4(p,1.0); vW=wp.xyz;" +
              " gl_Position=projectionMatrix*viewMatrix*wp; }",
            fragmentShader:
              "uniform float uTime,uMap,uHalf,uSea; uniform sampler2D uHeight; uniform vec3 uSun,uShallow,uDeep,uFoam,uFog,uCam;" +
              "varying vec3 vW; varying vec2 vUv2; varying vec3 vN;" +
              "void main(){" +
              " vec2 huv=clamp((vW.xz+vec2(uHalf))/uMap,0.0,1.0);" +
              " vec4 hs=texture2D(uHeight,huv);" +
              " float hh=(hs.r*255.0*256.0+hs.g*255.0)/65535.0*132.0-16.0;" +
              " float depth=max(0.0,uSea-hh);" +
              " vec3 vd=normalize(uCam-vW);" +
              " vec3 nrm=normalize(mix(vN,vec3(0.0,1.0,0.0),0.42));" +
              " float fres=pow(1.0-clamp(dot(vd,nrm),0.0,1.0),3.0);" +
              " float dFac=clamp(depth/9.0,0.0,1.0);" +
              " vec3 water=mix(uShallow,uDeep,dFac);" +
              " vec3 hdir=normalize(uSun);" +
              " vec3 hf=normalize(hdir+vd);" +
              " float spec=pow(max(dot(nrm,hf),0.0),220.0)*1.5;" +
              " float glit=pow(max(dot(nrm,hdir),0.0),40.0)*0.25;" +
              " vec3 col=water+uSun*spec+vec3(1.0,0.95,0.85)*glit;" +
              " col=mix(col,uFog,fres*0.42);" +
              " float foam=smoothstep(2.2,0.0,depth)*0.9;" +
              " float wob=sin(vW.x*1.4+uTime*2.4)*0.5+sin(vW.z*1.7-uTime*2.1)*0.5;" +
              " foam*=0.62+wob*0.38;" +
              " col=mix(col,uFoam,clamp(foam,0.0,0.85));" +
              " float a=mix(0.72,0.94,dFac);" +
              " a=max(a,foam);" +
              " gl_FragColor=vec4(col,a); }",
          });
          waterMesh = new THREE.Mesh(g, WATER.mat);
          waterMesh.position.y = CFG.SEA;
          waterMesh.frustumCulled = false;
          waterMesh.renderOrder = 1;
          scene.add(waterMesh);
        }

        /* ============================================================================
   World core — renderer, scene, camera, lights, fog.
   ========================================================================== */
        function initWorldCore() {
          renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById("gl"),
            antialias: !IS_MOBILE,
            powerPreference: "high-performance",
            stencil: false,
          });
          var maxDpr = IS_MOBILE ? 1.5 : 2;
          renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, maxDpr),
          );
          renderer.setSize(window.innerWidth, window.innerHeight);
          renderer.outputEncoding = THREE.sRGBEncoding;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.04;
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          renderer.autoClear = true;

          scene = new THREE.Scene();
          scene.fog = new THREE.Fog(col(0xbcd8ee).getHex(), 220, 1000);
          scene.background = col(0x8fc6f2);
          camera = new THREE.PerspectiveCamera(
            SETTINGS.fov,
            window.innerWidth / window.innerHeight,
            0.12,
            3000,
          );
          camera.rotation.order = "YXZ";
          worldGroup = new THREE.Group();
          scene.add(worldGroup);

          makeMaterials();
          makeSky();
          makeClouds();

          sun = new THREE.DirectionalLight(0xfff0d6, 2.5);
          sun.position.copy(SKY.sunDir.clone().multiplyScalar(300));
          sun.castShadow = true;
          var sm = IS_MOBILE ? 1024 : SETTINGS.quality >= 3 ? 3072 : 2048;
          sun.shadow.mapSize.width = sm;
          sun.shadow.mapSize.height = sm;
          var sc = sun.shadow.camera;
          sc.left = -78;
          sc.right = 78;
          sc.top = 78;
          sc.bottom = -78;
          sc.near = 1;
          sc.far = 680;
          sc.updateProjectionMatrix();
          sun.shadow.bias = -0.0005;
          sun.shadow.normalBias = 0.5;
          scene.add(sun);
          scene.add(sun.target);

          hemi = new THREE.HemisphereLight(
            col(0xbcd8ff).getHex(),
            col(0x46502e).getHex(),
            0.9,
          );
          scene.add(hemi);

          bounce = new THREE.DirectionalLight(0x9fc0ff, 0.4);
          bounce.position.set(-140, 90, -160);
          scene.add(bounce);

          POST.init();
          POST.resize(
            Math.floor(window.innerWidth * renderer.getPixelRatio()),
            Math.floor(window.innerHeight * renderer.getPixelRatio()),
          );
          initDecals();
        }

// === world ===
/* ==== 20_world.js ==== */
        /* ============================================================================
   20_WORLD — heightfield, collision registries, physics raycast, roads,
   16 points of interest, wind-animated vegetation, chests, vehicles,
   the minimap bake and the navigation grid.
   ========================================================================== */

        var colliders = null;
        var platforms = [],
          ramps = [];
        var platHash = null,
          rampHash = null;
        var _pArr = [],
          _rArr = [];
        function insertPlatform(p) {
          platforms.push(p);
          platHash.insert(p);
        }
        function insertRamp(r) {
          r.minX = Math.min(r.x0, r.x1) - r.halfW;
          r.maxX = Math.max(r.x0, r.x1) + r.halfW;
          r.minZ = Math.min(r.z0, r.z1) - r.halfW;
          r.maxZ = Math.max(r.z0, r.z1) + r.halfW;
          r.minY = Math.min(r.h0, r.h1);
          r.maxY = Math.max(r.h0, r.h1);
          ramps.push(r);
          rampHash.insert(r);
        }
        var POIS = [],
          LOOTSPOTS = [],
          CHESTS = [],
          MAPCANVAS = null,
          TREES = [];
        var HM = { n: 0, step: 0, half: 0, data: null };
        var MAT = {};

        /* ---------------- raw terrain ---------------- */
        /* --- new: diverse biomes + dramatic peaks + clear gameplay zones --- */
        function terrainRaw(x, z) {
          var d = Math.sqrt(x * x + z * z);

          /* base rolling hills (large scale) */
          var base = 2.4 + fbm(x * 0.006 + 11.3, z * 0.006 - 4.7, 5) * 32;
          /* medium detail adds texture */
          base += fbm(x * 0.027 - 3.1, z * 0.027 + 9.4, 3) * 4.0 - 2.0;

          /* ---- mountain range NE (roughly x>40, z<-40) ---- */
          var neX = clamp((x - 40) / 160, 0, 1);
          var neZ = clamp((-z - 40) / 160, 0, 1);
          var neFactor = neX * neZ;
          var neRidge = ridged(x * 0.012 + 8, z * 0.012 + 3, 4);
          var nePeak = smoothstep(0.3, 0.8, neRidge) * neFactor;
          base += nePeak * 55;
          /* cliff bands for dramatic verticality */
          base += Math.abs(Math.sin(nePeak * Math.PI * 2.5)) * neFactor * 12;

          /* ---- volcanic peak at (-130, -130) ---- */
          var volD = Math.sqrt((x + 130) * (x + 130) + (z + 130) * (z + 130));
          var vol = smoothstep(110, 15, volD);
          var volRidge = ridged(x * 0.02 + 1, z * 0.02 + 1, 5);
          base += vol * (volRidge * 40 + 18);
          /* crater dip */
          if (volD < 18) base -= (1 - volD / 18) * 14;

          /* ---- deep valley SW (x<-80, z>80) ---- */
          var swX = clamp((-x - 80) / 140, 0, 1);
          var swZ = clamp((z - 80) / 140, 0, 1);
          var swFactor = swX * swZ;
          var swValley = smoothstep(0.2, 0.7, fbm(x * 0.015 + 5, z * 0.015 + 2, 3));
          base -= swFactor * swValley * 28;

          /* ---- high plateau central ---- */
          var ctrX = clamp((x + 50) / 200, 0, 1);
          var ctrZ = clamp((z - 20) / 200, 0, 1);
          var ctrPlateau = ctrX * ctrZ * (1 - ctrX) * (1 - ctrZ) * 4;
          base += ctrPlateau;

          /* ridge noise for overall dramatic features */
          var ridge = ridged(x * 0.0092 + 4.4, z * 0.0092 - 2.2, 4);
          base += smoothstep(0.42, 0.95, ridge) * 20;

          /* ---- island rim (cliff at edges) ---- */
          var rim = smoothstep(150, 238, d);
          base = lerp(base, 82 + fbm(x * 0.011 + 2, z * 0.011 + 7, 2) * 26, rim);
          /* steep cliff face */
          if (d > 160 && d < 210) {
            var cliff = smoothstep(160, 190, d) * (1 - smoothstep(190, 220, d));
            base += cliff * 35;
          }
          /* sea (flat ocean floor beyond rim) */
          var sea = smoothstep(252, 302, d);
          base = lerp(base, -11, sea);
          return base;
        }
        function buildHeightmap() {
          var n = CFG.SEG + 1,
            step = CFG.MAP / (n - 1),
            half = CFG.MAP / 2;
          var d = new Float32Array(n * n);
          for (var j = 0; j < n; j++)
            for (var i = 0; i < n; i++)
              d[j * n + i] = terrainRaw(i * step - half, j * step - half);
          HM = { n: n, step: step, half: half, data: d };
        }
        function terrainHeightAt(x, z) {
          var n = HM.n,
            step = HM.step,
            half = HM.half;
          var fx = (x + half) / step,
            fz = (z + half) / step;
          if (fx < 0) fx = 0;
          if (fz < 0) fz = 0;
          if (fx > n - 1.002) fx = n - 1.002;
          if (fz > n - 1.002) fz = n - 1.002;
          var i = fx | 0,
            j = fz | 0,
            tx = fx - i,
            tz = fz - j,
            D = HM.data;
          var a = D[j * n + i],
            b = D[j * n + i + 1],
            c = D[(j + 1) * n + i],
            e = D[(j + 1) * n + i + 1];
          return lerp(lerp(a, b, tx), lerp(c, e, tx), tz);
        }
        function terrainSlope(x, z) {
          var d = 1.6;
          var dx = terrainHeightAt(x + d, z) - terrainHeightAt(x - d, z);
          var dz = terrainHeightAt(x, z + d) - terrainHeightAt(x, z - d);
          return Math.sqrt(dx * dx + dz * dz) / (2 * d);
        }
        function flattenArea(cx, cz, r, targetY) {
          var n = HM.n,
            step = HM.step,
            half = HM.half,
            D = HM.data,
            R = r + 9;
          var i0 = clamp(Math.floor((cx - R + half) / step), 0, n - 1),
            i1 = clamp(Math.ceil((cx + R + half) / step), 0, n - 1);
          var j0 = clamp(Math.floor((cz - R + half) / step), 0, n - 1),
            j1 = clamp(Math.ceil((cz + R + half) / step), 0, n - 1);
          for (var j = j0; j <= j1; j++)
            for (var i = i0; i <= i1; i++) {
              var x = i * step - half,
                z = j * step - half;
              var d = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
              if (d < R) {
                var t = 1 - smoothstep(r * 0.72, R, d);
                D[j * n + i] = lerp(D[j * n + i], targetY, t);
              }
            }
        }
        /* Highest terrain sample under a rotated rectangular footprint. Sampling only
   the centre height buried the uphill corners of every structure standing on a
   slope -- this is the root cause of "houses are half inside the ground". */
        function footprintY(x, z, halfW, halfD, rot) {
          var m = terrainHeightAt(x, z);
          var c = Math.cos(rot || 0),
            s = Math.sin(rot || 0);
          for (var i = -1; i <= 1; i += 2) {
            for (var j = -1; j <= 1; j += 2) {
              var lx = i * halfW,
                lz = j * halfD;
              var px = x + lx * c - lz * s,
                pz = z + lx * s + lz * c;
              var h = terrainHeightAt(px, pz);
              if (h > m) m = h;
            }
          }
          return m;
        }
        /* Level the ground under a structure and return the height to sit on. Safe to
   call during buildPOIs() because the terrain mesh is baked afterwards, so the
   flattened pad is what actually gets rendered. The footprint diagonal is
   scaled past the 0.72 "fully level" knee of flattenArea() so the whole
   footprint ends up genuinely flat and the doorway stays above ground. */
        function padY(x, z, halfW, halfD, rot) {
          var y = footprintY(x, z, halfW, halfD, rot);
          var diag = Math.sqrt(halfW * halfW + halfD * halfD);
          flattenArea(x, z, diag * 1.45 + 0.8, y);
          return y;
        }

        /* ---------------- support surface sampling ---------------- */
        function rampHeight(r, x, z) {
          var dx = r.x1 - r.x0,
            dz = r.z1 - r.z0;
          var len2 = dx * dx + dz * dz;
          if (len2 < 0.0001) return null;
          var t = ((x - r.x0) * dx + (z - r.z0) * dz) / len2;
          if (t < -0.06 || t > 1.06) return null;
          var px = r.x0 + dx * t,
            pz = r.z0 + dz * t;
          var ox = x - px,
            oz = z - pz;
          if (ox * ox + oz * oz > r.halfW * r.halfW) return null;
          return r.h0 + (r.h1 - r.h0) * clamp(t, 0, 1);
        }
        var _gInfo = { y: 0, mat: null, ramp: false };
        function groundInfo(x, z, feetY, out) {
          out = out || _gInfo;
          var best = terrainHeightAt(x, z);
          out.mat = null;
          out.ramp = false;
          var lim = feetY + 0.72,
            i,
            p,
            h;
          platHash.query(x, z, _pArr);
          for (i = 0; i < _pArr.length; i++) {
            p = _pArr[i];
            if (p.dead) continue;
            if (
              x >= p.minX &&
              x <= p.maxX &&
              z >= p.minZ &&
              z <= p.maxZ &&
              p.y <= lim &&
              p.y > best
            ) {
              best = p.y;
              out.mat = p.mat || null;
            }
          }
          rampHash.query(x, z, _rArr);
          for (i = 0; i < _rArr.length; i++) {
            p = _rArr[i];
            if (p.dead) continue;
            if (p.minY > feetY + 0.9) continue;
            h = rampHeight(p, x, z);
            if (h !== null && h <= lim && h > best) {
              best = h;
              out.mat = p.mat || null;
              out.ramp = true;
            }
          }
          out.y = best;
          return out;
        }
        function groundAt(x, z, feetY) {
          return groundInfo(x, z, feetY).y;
        }
        /* Highest surface we could STEP UP onto from `feetY` at (x,z) -- the tops of
   solid boxes as well as registered platforms, as long as the rise is no more
   than maxRise. House floor slabs sit slightly proud of the terrain and are
   solid boxes rather than platforms, so without looking at box tops the
   doorway just blocks and you have to jump to get inside. */
        function stepTopAt(x, z, r, feetY, maxRise) {
          var top = -1e9,
            lim = feetY + maxRise + 0.02,
            i,
            c,
            cx,
            cz,
            dx,
            dz;
          var near = [];
          colliders.query(x, z, near);
          for (i = 0; i < near.length; i++) {
            c = near[i];
            if (c.dead) continue;
            if (c.maxY <= feetY + 0.02 || c.maxY > lim) continue;
            cx = clamp(x, c.minX, c.maxX);
            cz = clamp(z, c.minZ, c.maxZ);
            dx = x - cx;
            dz = z - cz;
            if (dx * dx + dz * dz >= r * r) continue;
            if (c.maxY > top) top = c.maxY;
          }
          var near2 = [];
          platHash.query(x, z, near2);
          for (i = 0; i < near2.length; i++) {
            c = near2[i];
            if (c.dead) continue;
            if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
            if (c.y <= feetY + 0.02 || c.y > lim) continue;
            if (c.y > top) top = c.y;
          }
          return top;
        }
        /* what are we standing on? drives footstep audio + harvest feedback */
        function surfaceAt(x, z, feetY) {
          var gi = groundInfo(x, z, feetY);
          if (gi.mat) return gi.mat;
          var y = gi.y;
          if (y < CFG.SEA + 0.6) return "water";
          if (y < 3.2) return "sand";
          if (terrainSlope(x, z) > 0.62) return "stone";
          if (y > 62) return "snow";
          return "grass";
        }
        function collideXZ(p, r, y0, y1) {
          var near = [],
            n = colliders.query(p.x, p.z, near);
          for (var i = 0; i < near.length; i++) {
            var c = near[i];
            if (c.dead) continue;
            if (y1 < c.minY || y0 > c.maxY) continue;
            var cx = clamp(p.x, c.minX, c.maxX),
              cz = clamp(p.z, c.minZ, c.maxZ);
            var dx = p.x - cx,
              dz = p.z - cz,
              d2 = dx * dx + dz * dz;
            if (d2 >= r * r) continue;
            if (d2 > 0.000001) {
              var d = Math.sqrt(d2),
                push = (r - d) / d;
              p.x += dx * push;
              p.z += dz * push;
            } else {
              var lx = Math.min(p.x - c.minX, c.maxX - p.x),
                lz = Math.min(p.z - c.minZ, c.maxZ - p.z);
              if (lx < lz)
                p.x = p.x - c.minX < c.maxX - p.x ? c.minX - r : c.maxX + r;
              else p.z = p.z - c.minZ < c.maxZ - p.z ? c.minZ - r : c.maxZ + r;
            }
          }
        }
        function blockedAt(x, z, y0, y1) {
          var near = [],
            n = colliders.query(x, z, near);
          for (var i = 0; i < near.length; i++) {
            var c = near[i];
            if (c.dead) continue;
            if (y1 < c.minY || y0 > c.maxY) continue;
            if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ)
              return true;
          }
          return false;
        }
        /* returns the first solid box overlapping a capsule, or null */
        function overlapAt(x, z, y0, y1, out) {
          var near = [],
            n = colliders.query(x, z, near);
          for (var i = 0; i < near.length; i++) {
            var c = near[i];
            if (c.dead) continue;
            if (y1 < c.minY || y0 > c.maxY) continue;
            if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ)
              return c;
          }
          return null;
        }

        /* ---------------- raycast ---------------- */
        var _rcOut = { t: 0, kind: null, obj: null, nx: 0, ny: 1, nz: 0 };
        function rayAABB(o, d, dx, dy, dz, b) {
          var tmin = 0,
            tmax = 1e9,
            inv,
            s;
          inv = 1 / (dx || 1e-9);
          var t1 = (b.minX - o.x) * inv,
            t2 = (b.maxX - o.x) * inv;
          if (t1 > t2) {
            s = t1;
            t1 = t2;
            t2 = s;
          }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          inv = 1 / (dy || 1e-9);
          t1 = (b.minY - o.y) * inv;
          t2 = (b.maxY - o.y) * inv;
          if (t1 > t2) {
            s = t1;
            t1 = t2;
            t2 = s;
          }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          inv = 1 / (dz || 1e-9);
          t1 = (b.minZ - o.z) * inv;
          t2 = (b.maxZ - o.z) * inv;
          if (t1 > t2) {
            s = t1;
            t1 = t2;
            t2 = s;
          }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmax < tmin || tmax < 0) return -1;
          return tmin;
        }
        function boxNormal(b, px, py, pz, out) {
          var e = 0.06;
          if (Math.abs(px - b.minX) < e) {
            out.nx = -1;
            out.ny = 0;
            out.nz = 0;
            return out;
          }
          if (Math.abs(px - b.maxX) < e) {
            out.nx = 1;
            out.ny = 0;
            out.nz = 0;
            return out;
          }
          if (Math.abs(py - b.minY) < e) {
            out.nx = 0;
            out.ny = -1;
            out.nz = 0;
            return out;
          }
          if (Math.abs(py - b.maxY) < e) {
            out.nx = 0;
            out.ny = 1;
            out.nz = 0;
            return out;
          }
          if (Math.abs(pz - b.minZ) < e) {
            out.nx = 0;
            out.ny = 0;
            out.nz = -1;
            return out;
          }
          out.nx = 0;
          out.ny = 0;
          out.nz = 1;
          return out;
        }
        var _rayBoxes = [];
        function raycastWorld(o, dx, dy, dz, maxD) {
          var bestT = maxD,
            kind = null,
            obj = null;
          var steps = Math.min(260, Math.ceil(maxD / 0.7));
          for (var i = 1; i <= steps; i++) {
            var t = (i / steps) * maxD;
            var x = o.x + dx * t,
              y = o.y + dy * t,
              z = o.z + dz * t;
            var h = y - terrainHeightAt(x, z);
            if (h < 0) {
              var lo = t - maxD / steps,
                hi = t;
              for (var k2 = 0; k2 < 8; k2++) {
                var mid = (lo + hi) / 2;
                var mm =
                  o.y +
                  dy * mid -
                  terrainHeightAt(o.x + dx * mid, o.z + dz * mid);
                if (mm < 0) hi = mid;
                else lo = mid;
              }
              if (hi < bestT) {
                bestT = hi;
                kind = "terrain";
                obj = null;
                var nx2 =
                  terrainHeightAt(o.x + dx * hi + 0.5, o.z + dz * hi) -
                  terrainHeightAt(o.x + dx * hi - 0.5, o.z + dz * hi);
                var nz2 =
                  terrainHeightAt(o.x + dx * hi, o.z + dz * hi + 0.5) -
                  terrainHeightAt(o.x + dx * hi, o.z + dz * hi - 0.5);
                var nl = Math.sqrt(nx2 * nx2 + 1 + nz2 * nz2);
                _rcOut.nx = -nx2 / nl;
                _rcOut.ny = 1 / nl;
                _rcOut.nz = -nz2 / nl;
              }
              break;
            }
          }
          colliders.queryRay(o.x, o.z, dx, dz, maxD, _rayBoxes);
          for (var b = 0; b < _rayBoxes.length; b++) {
            var bb = _rayBoxes[b];
            if (bb.dead) continue;
            var t2 = rayAABB(o, { x: 0 }, dx, dy, dz, bb);
            if (t2 >= 0 && t2 < bestT) {
              bestT = t2;
              kind = "box";
              obj = bb;
              boxNormal(
                bb,
                o.x + dx * t2,
                o.y + dy * t2,
                o.z + dz * t2,
                _rcOut,
              );
            }
          }
          _rcOut.t = bestT;
          _rcOut.kind = kind;
          _rcOut.obj = obj;
          return _rcOut;
        }
        function hasLOS(ax, ay, az, bx, by, bz) {
          var dx = bx - ax,
            dy = by - ay,
            dz = bz - az;
          var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (len < 0.4) return true;
          dx /= len;
          dy /= len;
          dz /= len;
          var r = raycastWorld({ x: ax, y: ay, z: az }, dx, dy, dz, len - 0.5);
          return r.t >= len - 0.6;
        }

        /* ---------------- materials ---------------- */
        function makeMaterials() {
          MAT.wood = new THREE.MeshStandardMaterial({
            map: TEX.wood,
            vertexColors: true,
            roughness: 0.86,
            metalness: 0.0,
          });
          MAT.brick = new THREE.MeshStandardMaterial({
            map: TEX.brick,
            vertexColors: true,
            roughness: 0.92,
            metalness: 0.0,
          });
          MAT.stone = new THREE.MeshStandardMaterial({
            map: TEX.stone,
            vertexColors: true,
            roughness: 0.95,
            metalness: 0.02,
          });
          MAT.metal = new THREE.MeshStandardMaterial({
            map: TEX.metal,
            vertexColors: true,
            roughness: 0.42,
            metalness: 0.62,
          });
          MAT.terra = new THREE.MeshStandardMaterial({
            map: TEX.grass,
            vertexColors: true,
            roughness: 0.97,
            metalness: 0.0,
          });
          MAT.road = new THREE.MeshStandardMaterial({
            map: TEX.road,
            vertexColors: true,
            roughness: 0.9,
            metalness: 0.0,
          });
          MAT.roof = new THREE.MeshStandardMaterial({
            map: TEX.roof,
            vertexColors: true,
            roughness: 0.85,
            metalness: 0.0,
          });
          /* instanced meshes colour via setColorAt — these must NOT enable vertexColors */
          MAT.leaf = new THREE.MeshStandardMaterial({
            roughness: 0.85,
            flatShading: true,
          });
          MAT.foliage = new THREE.MeshStandardMaterial({
            roughness: 0.8,
            flatShading: true,
          });
          MAT.trunk = new THREE.MeshStandardMaterial({
            roughness: 0.92,
            flatShading: true,
          });
          MAT.canopy = new THREE.MeshStandardMaterial({
            roughness: 0.82,
            flatShading: true,
          });
          MAT.rockI = new THREE.MeshStandardMaterial({
            map: TEX.stone,
            roughness: 0.95,
            flatShading: true,
          });
          MAT.grassI = new THREE.MeshStandardMaterial({
            map: TEX.tuft,
            transparent: false,
            alphaTest: 0.42,
            side: THREE.DoubleSide,
            roughness: 0.9,
            depthWrite: true,
          });
          patchTerrainMaterial();
          patchFoliageWind(MAT.canopy, 1.0);
          patchFoliageWind(MAT.leaf, 1.5);
          patchFoliageWind(MAT.grassI, 2.4);
        }

        /* ============================================================================
   Building generators
   ========================================================================== */
        function wallZ(gb, a, b, y, z, h, t, color, gc, gw, gh) {
          if (gw && gw > 0) {
            var g0 = gc - gw / 2,
              g1 = gc + gw / 2;
            if (g0 > a)
              gb.add(
                g0 - a,
                h,
                t,
                (a + g0) / 2,
                y + h / 2,
                z,
                color,
                0,
                0,
                0,
                true,
              );
            if (b > g1)
              gb.add(
                b - g1,
                h,
                t,
                (g1 + b) / 2,
                y + h / 2,
                z,
                color,
                0,
                0,
                0,
                true,
              );
            if (h > gh)
              gb.add(
                gw,
                h - gh,
                t,
                gc,
                y + gh + (h - gh) / 2,
                z,
                color,
                0,
                0,
                0,
                true,
              );
          } else
            gb.add(
              b - a,
              h,
              t,
              (a + b) / 2,
              y + h / 2,
              z,
              color,
              0,
              0,
              0,
              true,
            );
        }
        function wallX(gb, a, b, y, x, h, t, color, gc, gw, gh) {
          if (gw && gw > 0) {
            var g0 = gc - gw / 2,
              g1 = gc + gw / 2;
            if (g0 > a)
              gb.add(
                t,
                h,
                g0 - a,
                x,
                y + h / 2,
                (a + g0) / 2,
                color,
                0,
                0,
                0,
                true,
              );
            if (b > g1)
              gb.add(
                t,
                h,
                b - g1,
                x,
                y + h / 2,
                (g1 + b) / 2,
                color,
                0,
                0,
                0,
                true,
              );
            if (h > gh)
              gb.add(
                t,
                h - gh,
                gw,
                x,
                y + gh + (h - gh) / 2,
                gc,
                color,
                0,
                0,
                0,
                true,
              );
          } else
            gb.add(
              t,
              h,
              b - a,
              x,
              y + h / 2,
              (a + b) / 2,
              color,
              0,
              0,
              0,
              true,
            );
        }
        function gableRoof(gb, w, d, y, hgt, color) {
          var half = d / 2,
            slope = Math.sqrt(half * half + hgt * hgt),
            ang = Math.atan2(hgt, half);
          gb.add(
            w + 0.5,
            0.28,
            slope,
            0,
            y + hgt / 2,
            -half / 2,
            color,
            0,
            -ang,
            0,
            false,
          );
          gb.add(
            w + 0.5,
            0.28,
            slope,
            0,
            y + hgt / 2,
            half / 2,
            color,
            0,
            ang,
            0,
            false,
          );
          gb.ramp(0, -half, y, 0, 0, y + hgt, w / 2 + 0.25);
          gb.ramp(0, half, y, 0, 0, y + hgt, w / 2 + 0.25);
          gb.add(
            0.4,
            0.4,
            w + 0.6,
            0,
            y + hgt + 0.1,
            0,
            color,
            Math.PI / 2,
            0,
            0,
            false,
          );
        }
        function house(gb, w, d, floors, wallC, roofC, opt) {
          opt = opt || {};
          var fh = 3.4,
            t = 0.34,
            f;
          for (f = 0; f < floors; f++) {
            var y = f * fh;
            if (f > 0) gb.add(w, 0.34, d, 0, y - 0.17, 0, wallC, 0, 0, 0, true);
            if (f === 0)
              gb.add(
                w + 0.6,
                0.4,
                d + 0.6,
                0,
                0.1,
                0,
                col(0x8a7a5f),
                0,
                0,
                0,
                true,
              );
            var door = f === 0 ? [0, 2.4, 2.8] : null;
            wallZ(
              gb,
              -w / 2,
              w / 2,
              y,
              -d / 2,
              fh,
              t,
              wallC,
              door ? door[0] : null,
              door ? door[1] : 0,
              door ? door[2] : 0,
            );
            var win = f > 0 || opt.winFront ? [0, 2.6, 1.7] : null;
            wallZ(
              gb,
              -w / 2,
              w / 2,
              y,
              d / 2,
              fh,
              t,
              wallC,
              win ? win[0] : null,
              win ? win[1] : 0,
              win ? win[2] : 0,
            );
            wallX(gb, -d / 2, d / 2, y, -w / 2, fh, t, wallC, 0, 2.2, 1.7);
            wallX(gb, -d / 2, d / 2, y, w / 2, fh, t, wallC, 0, 2.2, 1.7);
            if (f === 0 && floors > 1) {
              var rl = w * 0.75;
              gb.add(
                rl,
                0.28,
                1.6,
                0,
                fh - 0.14,
                d / 2 - 0.85,
                col(0x8a7a5f),
                0,
                0,
                0,
                false,
              );
              gb.ramp(
                -rl / 2,
                d / 2 - 0.85,
                0.02,
                rl / 2,
                d / 2 - 0.85,
                fh - 0.02,
                0.8,
              );
              for (var s = 0; s < 6; s++) {
                var tt = s / 6;
                gb.add(
                  0.14,
                  0.5,
                  1.6,
                  -rl / 2 + tt * rl,
                  0.3 + tt * (fh - 0.7),
                  d / 2 - 0.85,
                  col(0x6b5a3f),
                  0,
                  0,
                  0,
                  false,
                );
              }
            }
          }
          gableRoof(gb, w, d, floors * fh, opt.roofH || 2.4, roofC);
          if (opt.fence) {
            for (var i = 0; i < 10; i++) {
              var a = rnd(0, Math.PI * 2),
                r = rnd(w, d) + rnd(1, 3);
              gb.add(
                0.16,
                1.1,
                1.6,
                Math.cos(a) * r,
                0.55,
                Math.sin(a) * r,
                col(0x9a7c50),
                rnd(0, 3),
                0,
                0,
                true,
              );
            }
          }
        }
        function tower(gb, w, d, floors, wallC, roofC) {
          var fh = 3.6,
            f;
          for (f = 0; f < floors; f++) {
            var y = f * fh;
            if (f > 0) gb.add(w, 0.32, d, 0, y - 0.16, 0, wallC, 0, 0, 0, true);
            else
              gb.add(
                w + 0.8,
                0.5,
                d + 0.8,
                0,
                -0.25,
                0,
                col(0x6f6a60),
                0,
                0,
                0,
                true,
              );
            var door = f === 0 ? [0, 2.6, 3.0] : null;
            wallZ(
              gb,
              -w / 2,
              w / 2,
              y,
              -d / 2,
              fh,
              0.34,
              wallC,
              door ? 0 : null,
              door ? 2.6 : 0,
              door ? 3.0 : 0,
            );
            wallZ(gb, -w / 2, w / 2, y, d / 2, fh, 0.34, wallC, 0, 2.4, 2.0);
            wallX(gb, -d / 2, d / 2, y, -w / 2, fh, 0.34, wallC, 0, 2.4, 2.0);
            wallX(gb, -d / 2, d / 2, y, w / 2, fh, 0.34, wallC, 0, 2.4, 2.0);
            gb.add(
              0.5,
              fh,
              0.5,
              -w / 2,
              y + fh / 2,
              -d / 2,
              roofC,
              0,
              0,
              0,
              true,
            );
            gb.add(
              0.5,
              fh,
              0.5,
              w / 2,
              y + fh / 2,
              -d / 2,
              roofC,
              0,
              0,
              0,
              true,
            );
            gb.add(
              0.5,
              fh,
              0.5,
              -w / 2,
              y + fh / 2,
              d / 2,
              roofC,
              0,
              0,
              0,
              true,
            );
            gb.add(
              0.5,
              fh,
              0.5,
              w / 2,
              y + fh / 2,
              d / 2,
              roofC,
              0,
              0,
              0,
              true,
            );
          }
          var top = floors * fh;
          gb.add(
            w + 0.6,
            0.34,
            d + 0.6,
            0,
            top + 0.17,
            0,
            roofC,
            0,
            0,
            0,
            true,
          );
          for (var s = 0; s < 4; s++) {
            var ang = (s * Math.PI) / 2;
            gb.add(
              w + 0.6,
              0.9,
              0.3,
              Math.sin(ang) * (d / 2 + 0.2),
              top + 0.8,
              Math.cos(ang) * (d / 2 + 0.2),
              roofC,
              ang,
              0,
              0,
              true,
            );
          }
          gb.add(1.6, 2.6, 1.6, 0, top + 1.6, 0, col(0x8d8478), 0, 0, 0, true);
        }
        function warehouse(gb, w, d, h, wallC, roofC) {
          var t = 0.4;
          wallZ(gb, -w / 2, w / 2, 0, -d / 2, h, t, wallC, 0, 5.0, 4.2);
          wallZ(gb, -w / 2, w / 2, 0, d / 2, h, t, wallC, 0, 5.0, 4.2);
          wallX(gb, -d / 2, d / 2, 0, -w / 2, h, t, wallC, 0, 3.4, 3.2);
          wallX(gb, -d / 2, d / 2, 0, w / 2, h, t, wallC, 0, 3.4, 3.2);
          gb.add(w + 0.8, 0.36, d + 0.8, 0, h + 0.18, 0, roofC, 0, 0, 0, true);
          gb.add(w * 0.9, 0.3, 3.0, 0, h * 0.55, 0, roofC, 0, 0, 0, true);
          gb.ramp(-w * 0.45, 0, 0.02, w * 0.45, 0, h * 0.55, 1.5);
          for (var i = 0; i < 6; i++)
            gb.add(
              0.6,
              h,
              0.6,
              -w / 2 + i * (w / 5),
              h / 2,
              -d / 2,
              roofC,
              0,
              0,
              0,
              true,
            );
        }
        function crate(gb, x, y, z, s, c) {
          gb.add(s, s, s, x, y + s / 2, z, c, rnd(0, 0.4), 0, 0, true);
        }
        function container(gb, x, y, z, c) {
          gb.add(6.2, 2.7, 2.6, x, y + 1.35, z, c, 0, 0, 0, true);
        }
        function fenceLine(gb, x0, z0, x1, z1, c) {
          var dx = x1 - x0,
            dz = z1 - z0,
            len = Math.sqrt(dx * dx + dz * dz),
            n = Math.floor(len / 2.2),
            ang = Math.atan2(dx, dz);
          for (var i = 0; i <= n; i++) {
            var t = i / n;
            var px = x0 + dx * t,
              pz = z0 + dz * t;
            gb.add(
              0.16,
              1.2,
              0.16,
              px,
              gb.groundY(px, pz) + 0.6,
              pz,
              c,
              0,
              0,
              0,
              true,
            );
          }
          var mx = (x0 + x1) / 2,
            mz = (z0 + z1) / 2,
            my = gb.groundY(mx, mz);
          gb.add(0.1, 0.2, len, mx, my + 1.0, mz, c, ang, 0, 0, true);
          gb.add(0.1, 0.2, len, mx, my + 0.5, mz, c, ang, 0, 0, true);
        }
        function carProp(gb, x, y, z, c) {
          gb.add(4.4, 0.9, 1.9, x, y + 0.75, z, c, 0, 0, 0, true);
          gb.add(
            2.4,
            0.75,
            1.75,
            x - 0.15,
            y + 1.5,
            z,
            col(0x9fd4ee),
            0,
            0,
            0,
            false,
          );
          gb.add(4.6, 0.3, 2.0, x, y + 0.32, z, col(0x1a1a1a), 0, 0, 0, false);
          gb.add(
            0.4,
            0.7,
            0.4,
            x + 2.2,
            y + 0.5,
            z,
            col(0xf0e6b0),
            0,
            0,
            0,
            false,
          );
        }
        function streetLamp(gb, x, y, z, c) {
          gb.add(0.24, 6.4, 0.24, x, y + 3.2, z, c, 0, 0, 0, true);
          gb.add(1.5, 0.2, 0.24, x + 0.7, y + 6.3, z, c, 0, 0, 0, false);
          gb.add(
            0.5,
            0.18,
            0.4,
            x + 1.3,
            y + 6.15,
            z,
            col(0xfff0c0),
            0,
            0,
            0,
            false,
          );
        }
        function billboard(gb, x, y, z, rot) {
          gb.add(0.3, 5.4, 0.3, 0, 2.7, 0, col(0x5a5f68), 0, 0, 0, true);
          gb.add(5.6, 3.0, 0.24, 0, 5.6, 0, col(0xd8dde4), 0, 0, 0, false);
        }

        /* ============================================================================
   POI generation
   ========================================================================== */
        /* Pickaxe-harvestable material implied by the batch's surface material. Road
   tarmac and foliage deliberately return null so they stay indestructible. */
        function harvKindForMat(mat) {
          if (mat === MAT.wood) return "wood";
          if (mat === MAT.brick || mat === MAT.stone) return "stone";
          if (mat === MAT.metal) return "metal";
          return null;
        }
        /* How much pickaxe work a world piece takes before it breaks. Tuned so a wall
   goes down in ~3 swings (pickaxe dmg 22). */
        var WORLD_HP = { wood: 62, stone: 88, metal: 124 };
        /* Materials awarded for breaking a piece, and per successful swing. */
        var WORLD_YIELD = { wood: 34, stone: 26, metal: 20 };

        /* Collapse every vertex of a destroyed piece onto a single point. The triangles
   become degenerate and stop rasterising, which removes the piece visually
   without touching the index buffer or issuing a draw call. */
        function collapseBoxRange(geo, vStart, vCount) {
          var pa = geo.attributes.position.array;
          var o0 = vStart * 3,
            cx = pa[o0],
            cy = pa[o0 + 1],
            cz = pa[o0 + 2];
          for (var i = 1; i < vCount; i++) {
            var o = (vStart + i) * 3;
            pa[o] = cx;
            pa[o + 1] = cy;
            pa[o + 2] = cz;
          }
          geo.attributes.position.needsUpdate = true;
        }
        function commit(gb, mat, cast) {
          if (!gb.items.length) return null;
          var geo = gb.merge();
          var mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = cast !== false;
          mesh.receiveShadow = true;
          worldGroup.add(mesh);
          var hk = harvKindForMat(mat);
          for (var i = 0; i < gb.boxes.length; i++) {
            var bb = gb.boxes[i];
            if (hk && bb.harv === undefined) {
              bb.harv = hk;
              bb.hp = WORLD_HP[hk];
              bb.maxHp = bb.hp;
              var it = gb.items[bb.itemIdx];
              if (it)
                bb.destruct = {
                  geo: geo,
                  vStart: it.vStart,
                  vCount: it.vCount,
                };
            }
            colliders.insert(bb);
          }
          for (var j = 0; j < gb.plats.length; j++) insertPlatform(gb.plats[j]);
          for (var k = 0; k < gb.ramps.length; k++) insertRamp(gb.ramps[k]);
          return mesh;
        }
        /* One pickaxe swing against a harvestable world piece. Materials are awarded on
   every swing; pieces that carry HP (i.e. real map structures) also take damage
   and break apart for good once their HP runs out. Trees and rocks are inserted
   straight into the collider grid without HP, so they stay infinite sources. */
        function harvestStrike(ob, ch, hx, hy, hz, def) {
          if (ob.dead) return;
          var kind = ob.harv;
          var gain = kind === "stone" ? 18 : kind === "metal" ? 14 : 22;
          if (ch.mats[kind] < MAX_MATS) {
            ch.mats[kind] = Math.min(MAX_MATS, ch.mats[kind] + gain);
            if (ch.isPlayer) UI.floatGain(gain, kind);
          }
          Sfx.harvest(kind);
          fxDebris(hx, hy, hz, kind, 4);
          if (ob.hp === undefined) return;
          ob.hp -= def.dmg;
          if (ob.hp > 0) return;
          /* ---- piece destroyed ---- */
          ob.dead = true;
          if (ob.plat) ob.plat.dead = true;
          if (ob.destruct)
            collapseBoxRange(
              ob.destruct.geo,
              ob.destruct.vStart,
              ob.destruct.vCount,
            );
          var bonus = WORLD_YIELD[kind] || 20;
          if (ch.mats[kind] < MAX_MATS) {
            ch.mats[kind] = Math.min(MAX_MATS, ch.mats[kind] + bonus);
            if (ch.isPlayer) UI.floatGain(bonus, kind);
          }
          fxDebris(hx, hy, hz, kind, 16);
          Sfx.break();
          if (nearPlayer(hx, hz, 70)) fxSmoke(hx, hy, hz, 2, 0.9, 0.7, 0.55);
        }
        function addLootSpot(x, z, y) {
          LOOTSPOTS.push({ x: x, y: y, z: z, used: false });
        }
        function addChest(x, z, y) {
          CHESTS.push({
            x: x,
            y: y,
            z: z,
            opened: false,
            mesh: null,
            lid: null,
          });
        }
        function spotY(x, z) {
          return terrainHeightAt(x, z);
        }

        var WOODC = [0xb98a53, 0xa87b46, 0xc79a63],
          ROOFC = [0x8f4f3a, 0x6f4a35, 0x4f5b6b, 0x8a6a3a],
          PLAST = [0xd8d2c4, 0xc9c0ae, 0xe0d8c8],
          BRICKC = [0xa9634c, 0x8f5340, 0xb87a5e],
          METALC = [0x8f9aa6, 0x7a8590, 0xa5b0bc];

        function poiTilted(cx, cz, r) {
          var y = terrainHeightAt(cx, cz);
          var gb = new GeoBatch().origin(cx, y, cz, 0);
          var spots = [
            [-12, -12, 7, 8],
            [11, -13, 6, 7],
            [-13, 11, 8, 6],
            [12, 12, 9, 7],
            [0, -2, 5, 6],
          ];
          for (var i = 0; i < spots.length; i++) {
            var tx0 = cx + spots[i][0],
              tz0 = cz + spots[i][1],
              trot = rnd(-0.12, 0.12);
            var ty0 = padY(tx0, tz0, spots[i][2] / 2, spots[i][3] / 2, trot);
            var g2 = new GeoBatch().origin(tx0, ty0, tz0, trot);
            tower(
              g2,
              spots[i][2],
              spots[i][3],
              rndi(3, 6),
              pickOne(BRICKC),
              pickOne(METALC),
            );
            commit(g2, MAT.brick, true);
            addChest(tx0 + rnd(-3, 3), tz0 + rnd(-3, 3), ty0);
          }
          for (var k = 0; k < 7; k++) {
            var a = rnd(0, 6.28),
              rr = rnd(17, 27);
            var hx = cx + Math.cos(a) * rr,
              hz = cz + Math.sin(a) * rr;
            var hw = rnd(7, 10),
              hd = rnd(7, 10),
              hrot = rnd(-0.5, 0.5);
            var hy = padY(hx, hz, hw / 2, hd / 2, hrot);
            var g3 = new GeoBatch().origin(hx, hy, hz, hrot);
            house(g3, hw, hd, rndi(1, 2), pickOne(PLAST), pickOne(ROOFC), {
              winFront: true,
            });
            commit(g3, MAT.wood, true);
            if (k < 4) addChest(hx, hz, hy);
          }
          for (var c = 0; c < 12; c++) {
            var ox = rnd(-26, 26),
              oz = rnd(-26, 26);
            crate(
              gb,
              ox,
              terrainHeightAt(cx + ox, cz + oz) - y,
              oz,
              rnd(0.9, 1.5),
              pickOne(WOODC),
            );
          }
          for (var v = 0; v < 4; v++) {
            var vx = rnd(-30, 30),
              vz = rnd(-30, 30);
            carProp(
              gb,
              vx,
              terrainHeightAt(cx + vx, cz + vz) - y,
              vz,
              pickOne([0x3f7fd6, 0xd6d6d6, 0xc23b3b, 0x2f2f2f]),
            );
          }
          for (var s = 0; s < 4; s++) {
            var ang = (s * Math.PI) / 2 + 0.78,
              lx = Math.cos(ang) * 19,
              lz = Math.sin(ang) * 19;
            streetLamp(
              gb,
              lx,
              terrainHeightAt(cx + lx, cz + lz) - y,
              lz,
              col(0x6e7480),
            );
          }
          commit(gb, MAT.wood, true);
          for (var l = 0; l < 9; l++)
            addLootSpot(cx + rnd(-30, 30), cz + rnd(-30, 30), y);
        }
        function poiHouses(cx, cz, r, name) {
          var y = terrainHeightAt(cx, cz);
          var gb = new GeoBatch().origin(cx, y, cz, 0);
          var n = rndi(8, 11);
          for (var i = 0; i < n; i++) {
            var a = (i / n) * 6.28 + rnd(-0.3, 0.3),
              rr = rnd(12, 30);
            var hx = cx + Math.cos(a) * rr,
              hz = cz + Math.sin(a) * rr;
            var hw = rnd(7, 10.5),
              hd = rnd(7, 10.5),
              hrot = rnd(0, 3.14);
            var hy = padY(hx, hz, hw / 2, hd / 2, hrot);
            var g2 = new GeoBatch().origin(hx, hy, hz, hrot);
            house(g2, hw, hd, rndi(1, 2), pickOne(PLAST), pickOne(ROOFC), {
              winFront: true,
              fence: true,
            });
            commit(g2, MAT.wood, true);
            if (i < 5) addChest(hx + rnd(-2, 2), hz + rnd(-2, 2), hy);
            if (i < 8) addLootSpot(hx + rnd(-3, 3), hz + rnd(-3, 3), hy);
          }
          var g3 = new GeoBatch().origin(cx, y, cz, 0);
          fenceLine(g3, -33, -33, 33, -33, col(0xcdc3ad));
          fenceLine(g3, 33, -33, 33, 33, col(0xcdc3ad));
          fenceLine(g3, 33, 33, -33, 33, col(0xcdc3ad));
          for (var s = 0; s < 4; s++) {
            var lx = (s % 2 ? 1 : -1) * 22,
              lz = (s < 2 ? 1 : -1) * 22;
            streetLamp(g3, lx, g3.groundY(lx, lz), lz, col(0x6e7480));
          }
          commit(g3, MAT.wood, true);
        }
        function poiRetail(cx, cz) {
          var y = terrainHeightAt(cx, cz);
          var gb = new GeoBatch().origin(cx, y, cz, 0);
          for (var side = -1; side <= 1; side += 2) {
            for (var i = 0; i < 5; i++) {
              var sx = cx - 22 + i * 11,
                sz = cz + side * 13;
              var srot = side > 0 ? Math.PI : 0;
              var sy = padY(sx, sz, 5, 4.5, srot);
              var g2 = new GeoBatch().origin(sx, sy, sz, srot);
              house(g2, 10, 9, 1, pickOne(PLAST), pickOne(ROOFC), {
                winFront: true,
              });
              commit(g2, MAT.wood, true);
              if (i % 2 === 0) addChest(sx, sz, sy);
              addLootSpot(sx + rnd(-4, 4), sz + rnd(-4, 4), sy);
            }
          }
          for (var c = 0; c < 14; c++) {
            var ox = rnd(-26, 26),
              oz = rnd(-4, 4);
            crate(
              gb,
              ox,
              terrainHeightAt(cx + ox, cz + oz) - y,
              oz,
              rnd(0.8, 1.3),
              pickOne(WOODC),
            );
          }
          for (var s = 0; s < 5; s++) {
            var lx = -20 + s * 10;
            streetLamp(
              gb,
              lx,
              terrainHeightAt(cx + lx, cz) - y,
              0,
              col(0x6e7480),
            );
          }
          commit(gb, MAT.wood, true);
          for (var l = 0; l < 6; l++)
            addLootSpot(cx + rnd(-28, 28), cz + rnd(-8, 8), y);
        }
        function poiFactory(cx, cz) {
          var y = terrainHeightAt(cx, cz);
          var gb = new GeoBatch().origin(0, 0, 0, 0);
          var wy1 = padY(cx - 13, cz, 13, 10, 0);
          var g2 = new GeoBatch().origin(cx - 13, wy1, cz, 0);
          warehouse(g2, 26, 20, 9, pickOne(METALC), col(0x59606b));
          commit(g2, MAT.metal, true);
          var wy2 = padY(cx + 15, cz + 4, 10, 8, 0.25);
          var g3 = new GeoBatch().origin(cx + 15, wy2, cz + 4, 0.25);
          warehouse(g3, 20, 16, 7.5, pickOne(METALC), col(0x4d545f));
          commit(g3, MAT.metal, true);
          var cc = [0x2f6fd0, 0xd06a2f, 0x2fae6a, 0xd0c22f, 0x8a2fd0];
          for (var i = 0; i < 10; i++) {
            var ccx = cx + rnd(-30, 30),
              ccz = cz + rnd(-22, 22);
            container(gb, ccx, terrainHeightAt(ccx, ccz), ccz, pickOne(cc));
          }
          for (var k = 0; k < 4; k++) {
            var kx = cx + rnd(-30, 30),
              kz = cz + rnd(-22, 22);
            container(gb, kx, terrainHeightAt(kx, kz) + 2.75, kz, pickOne(cc));
          }
          for (var b = 0; b < 8; b++) {
            var bx = cx + rnd(-30, 30),
              bz = cz + rnd(-22, 22);
            gb.add(
              1.1,
              1.4,
              1.1,
              bx,
              terrainHeightAt(bx, bz) + 0.7,
              bz,
              col(0xb03a2f),
              0,
              0,
              0,
              true,
            );
          }
          gb.add(
            5.0,
            11.0,
            5.0,
            cx + 30,
            y + 5.5,
            cz - 14,
            col(0x7a8490),
            0,
            0,
            0,
            true,
          );
          commit(gb, MAT.metal, true);
          addChest(cx - 13, cz - 6, wy1);
          addChest(cx + 15, cz + 6, wy2);
          addChest(cx, cz, y);
          for (var l = 0; l < 11; l++)
            addLootSpot(cx + rnd(-30, 30), cz + rnd(-22, 22), y);
        }
        function poiFarm(cx, cz) {
          var y = terrainHeightAt(cx, cz);
          var gb = new GeoBatch().origin(0, 0, 0, 0);
          var wy = padY(cx, cz, 15, 9, 0);
          var g2 = new GeoBatch().origin(cx, wy, cz, 0);
          warehouse(g2, 30, 18, 11, col(0xa8442f), col(0x6b3a2a));
          commit(g2, MAT.wood, true);
          var sy = padY(cx + 24, cz - 4, 4.5, 4.5, 0);
          var g3 = new GeoBatch().origin(cx + 24, sy, cz - 4, 0);
          g3.add(8, 22, 8, 0, 11, 0, col(0xbfc4c9), 0, 0, 0, true);
          g3.add(9, 1.2, 9, 0, 22.5, 0, col(0x8a9099), 0, 0, 0, true);
          g3.add(2.4, 3, 2.4, 0, 24, 0, col(0x9aa0a8), 0, 0, 0, true);
          for (var b2 = 0; b2 < 4; b2++) {
            var ba = (b2 * Math.PI) / 2;
            g3.add(
              5.6,
              0.3,
              1.6,
              Math.sin(ba) * 3.4,
              21.2,
              Math.cos(ba) * 3.4,
              col(0xdfe4ea),
              ba,
              0,
              0,
              false,
            );
          }
          commit(g3, MAT.metal, true);
          for (var i = 0; i < 9; i++)
            fenceLine(
              gb,
              cx - 34 + i * 8,
              cz + 12,
              cx - 34 + i * 8,
              cz + 30,
              col(0xb8a06a),
            );
          for (var h = 0; h < 3; h++) {
            var hx = cx - rnd(14, 30),
              hz = cz + rnd(16, 26);
            var hrot = rnd(0, 3.1);
            var hy = padY(hx, hz, 3.5, 3, hrot);
            var g4 = new GeoBatch().origin(hx, hy, hz, hrot);
            house(g4, 7, 6, 1, col(0xb5644a), col(0x6b4a35), {});
            commit(g4, MAT.wood, true);
          }
          for (var s = 0; s < 7; s++) {
            var sx = cx - 34 + s * 9;
            gb.add(
              0.3,
              1.0,
              3.0,
              sx,
              terrainHeightAt(sx, cz + 21) + 0.5,
              cz + 21,
              col(0x8dbf4a),
              0,
              0,
              0,
              false,
            );
          }
          commit(gb, MAT.wood, true);
          addChest(cx, cz, wy);
          addChest(cx + 24, cz - 4, sy);
          for (var l = 0; l < 9; l++)
            addLootSpot(cx + rnd(-32, 32), cz + rnd(-8, 28), y);
        }
        function poiRuins(cx, cz) {
          var y = terrainHeightAt(cx, cz);
          var gb = new GeoBatch().origin(cx, y, cz, 0);
          for (var i = 0; i < 28; i++) {
            var a = rnd(0, 6.28),
              r = rnd(4, 30);
            var px = Math.cos(a) * r,
              pz = Math.sin(a) * r;
            var h = rnd(1.5, 7.5),
              w = rnd(3, 9);
            var gy = terrainHeightAt(cx + px, cz + pz) - y;
            gb.add(
              w,
              h,
              1.0,
              px,
              gy + h / 2,
              pz,
              col(0x8d8578),
              rnd(0, 3.14),
              0,
              0,
              true,
            );
          }
          for (var j = 0; j < 12; j++) {
            var jx = rnd(-30, 30),
              jz = rnd(-30, 30);
            gb.add(
              rnd(1, 2.4),
              rnd(0.6, 1.4),
              rnd(1, 2.4),
              jx,
              terrainHeightAt(cx + jx, cz + jz) - y + 0.7,
              jz,
              col(0x7d7568),
              rnd(0, 3),
              0,
              0,
              true,
            );
          }
          for (var c = 0; c < 4; c++) {
            var ca = rnd(0, 6.28),
              cr = rnd(10, 26);
            var cpx = Math.cos(ca) * cr,
              cpz = Math.sin(ca) * cr;
            gb.add(
              2.2,
              6.0,
              2.2,
              cpx,
              terrainHeightAt(cx + cpx, cz + cpz) - y + 3,
              cpz,
              col(0x9a9184),
              rnd(0, 3),
              0,
              0,
              true,
            );
          }
          commit(gb, MAT.stone, true);
          for (var c2 = 0; c2 < 4; c2++)
            addChest(cx + rnd(-20, 20), cz + rnd(-20, 20), y);
          for (var l = 0; l < 7; l++)
            addLootSpot(cx + rnd(-28, 28), cz + rnd(-28, 28), y);
        }
        function poiTower(cx, cz) {
          var y = padY(cx, cz, 5.5, 5.5, 0);
          var g = new GeoBatch().origin(cx, y, cz, 0);
          tower(g, 11, 11, 6, col(0x8a6a44), col(0x6b4f34));
          commit(g, MAT.wood, true);
          for (var i = 0; i < 6; i++) {
            var a = rnd(0, 6.28),
              r = rnd(15, 27);
            var hx = cx + Math.cos(a) * r,
              hz = cz + Math.sin(a) * r;
            var hrot = rnd(0, 3);
            var hy = padY(hx, hz, 3.25, 3, hrot);
            var g2 = new GeoBatch().origin(hx, hy, hz, hrot);
            house(g2, 6.5, 6, 1, col(0xa07a4c), col(0x5e4230), {});
            commit(g2, MAT.wood, true);
          }
          addChest(cx, cz, y + 21.6);
          addChest(cx + 6, cz, y);
          for (var l = 0; l < 7; l++)
            addLootSpot(cx + rnd(-24, 24), cz + rnd(-24, 24), y);
        }
        function poiWoods(cx, cz) {
          for (var i = 0; i < 80; i++) {
            var a = rnd(0, 6.28),
              r = rnd(0, 38);
            var x = cx + Math.cos(a) * r,
              z = cz + Math.sin(a) * r;
            var y = terrainHeightAt(x, z);
            if (y < 1.6 || terrainSlope(x, z) > 0.5) continue;
            TREES.push({
              x: x,
              y: y,
              z: z,
              s: rnd(0.85, 1.35),
              rot: rnd(0, 6.28),
            });
          }
          var y2 = padY(cx, cz, 4.5, 4, 0);
          var g = new GeoBatch().origin(cx, y2, cz, 0);
          house(g, 9, 8, 2, col(0x9c7448), col(0x5a4030), { winFront: true });
          commit(g, MAT.wood, true);
          addChest(cx, cz, y2);
          addChest(cx + 9, cz + 4, terrainHeightAt(cx + 9, cz + 4));
          for (var l = 0; l < 7; l++)
            addLootSpot(cx + rnd(-20, 20), cz + rnd(-20, 20), y2);
        }
        /* --- NEW: airfield --- */
        function poiAirfield(cx, cz) {
          /* flatten the runway strip first so the tarmac never floats or clips */
          for (var s = -56; s <= 56; s += 7)
            flattenArea(cx, cz + s, 13.5, terrainRaw(cx, cz + s));
          var y = terrainHeightAt(cx, cz);
          var gb = new GeoBatch().origin(0, 0, 0, 0);
          /* runway */
          var rg = new GeoBatch().origin(cx, y + 0.06, cz, 0);
          rg.add(22, 0.3, 110, 0, 0, 0, col(0x3a3d44), 0, 0, 0, true, true);
          for (var d = 0; d < 12; d++)
            rg.add(
              0.7,
              0.34,
              6,
              0,
              0.05,
              -48 + d * 9,
              col(0xe8e8e8),
              0,
              0,
              0,
              false,
              false,
            );
          commit(rg, MAT.road, false);
          /* hangars */
          for (var h = 0; h < 3; h++) {
            var hx = cx + 26,
              hz = cz - 34 + h * 34;
            var hy = padY(hx, hz, 13, 9, Math.PI / 2);
            var g2 = new GeoBatch().origin(hx, hy, hz, Math.PI / 2);
            warehouse(g2, 26, 18, 8.5, col(0x8f9aa6), col(0x59606b));
            commit(g2, MAT.metal, true);
            addChest(hx, hz, hy);
          }
          /* control tower */
          var cty = padY(cx - 30, cz + 38, 5.2, 5.2, 0);
          var ct = new GeoBatch().origin(cx - 30, cty, cz + 38, 0);
          ct.add(7, 22, 7, 0, 11, 0, col(0xc4ccd4), 0, 0, 0, true);
          ct.add(10, 4, 10, 0, 23, 0, col(0x2b3038), 0, 0, 0, true);
          ct.add(10.4, 0.5, 10.4, 0, 25.2, 0, col(0x8f9aa6), 0, 0, 0, false);
          commit(ct, MAT.metal, true);
          /* static planes */
          for (var p = 0; p < 2; p++) {
            var px = cx - 18 + p * 12,
              pz = cz - 30 + p * 44;
            var pg = new GeoBatch().origin(
              px,
              terrainHeightAt(px, pz),
              pz,
              p ? 0.4 : -0.3,
            );
            pg.add(2.2, 2.0, 14, 0, 1.6, 0, col(0xdfe4ea), 0, 0, 0, true);
            pg.add(24, 0.4, 3.4, 0, 2.0, 0, col(0xdfe4ea), 0, 0, 0, false);
            pg.add(4.6, 1.4, 2.2, 0, 2.4, -1.0, col(0x9fd4ee), 0, 0, 0, false);
            pg.add(2.0, 3.4, 2.0, 0, 3.4, -5.4, col(0xdfe4ea), 0, 0, 0, false);
            commit(pg, MAT.metal, true);
            addChest(px, pz, terrainHeightAt(px, pz));
          }
          for (var l = 0; l < 10; l++)
            addLootSpot(cx + rnd(-34, 34), cz + rnd(-50, 50), y);
        }
        /* --- NEW: graveyard --- */
        function poiGraveyard(cx, cz) {
          var y = terrainHeightAt(cx, cz);
          var gb = new GeoBatch().origin(cx, y, cz, 0);
          for (var i = 0; i < 46; i++) {
            var gx = rnd(-32, 32),
              gz = rnd(-32, 32);
            var gh = rnd(0.9, 1.9);
            var gy = terrainHeightAt(cx + gx, cz + gz);
            gb.add(
              rnd(0.8, 1.3),
              gh,
              rnd(0.2, 0.35),
              gx,
              gy - y + gh / 2,
              gz,
              col(0xa8a49a),
              rnd(-0.25, 0.25),
              0,
              0,
              true,
            );
          }
          /* chapel */
          var cy = padY(cx + 2, cz - 2, 6.5, 5.5, 0.2);
          var cg = new GeoBatch().origin(cx + 2, cy, cz - 2, 0.2);
          house(cg, 13, 11, 1, col(0x8a8578), col(0x4a4438), {
            winFront: true,
            roofH: 4.2,
          });
          commit(cg, MAT.stone, true);
          for (var t = 0; t < 12; t++) {
            var a = rnd(0, 6.28),
              r = rnd(14, 32);
            var tx = cx + Math.cos(a) * r,
              tz = cz + Math.sin(a) * r;
            var ty = terrainHeightAt(tx, tz);
            if (ty < 1.6) continue;
            TREES.push({
              x: tx,
              y: ty,
              z: tz,
              s: rnd(0.7, 1.0),
              rot: rnd(0, 6.28),
              dead: true,
            });
          }
          for (var s = 0; s < 4; s++) {
            var lx = (s % 2 ? 1 : -1) * 20,
              lz = (s < 2 ? 1 : -1) * 20;
            streetLamp(gb, lx, gb.groundY(lx, lz), lz, col(0x4a4f58));
          }
          commit(gb, MAT.stone, true);
          addChest(cx + 2, cz - 2, cy);
          addChest(cx - 14, cz + 10, terrainHeightAt(cx - 14, cz + 10));
          for (var l = 0; l < 8; l++)
            addLootSpot(cx + rnd(-30, 30), cz + rnd(-30, 30), y);
        }
        /* --- NEW: beach town --- */
        function poiBeach(cx, cz) {
          var y = terrainHeightAt(cx, cz);
          var gb = new GeoBatch().origin(0, 0, 0, 0);
          for (var i = 0; i < 9; i++) {
            var hx = cx - 30 + i * 8,
              hz = cz + side8(i);
            var hrot = rnd(-0.2, 0.2);
            var hy = padY(hx, hz, 3.5, 3.25, hrot);
            var g2 = new GeoBatch().origin(hx, hy, hz, hrot);
            house(
              g2,
              7,
              6.5,
              1,
              pickOne([0xf0e2c8, 0x9fd4ee, 0xe8b48a]),
              col(0x5f8fa8),
              { winFront: true },
            );
            commit(g2, MAT.wood, true);
            if (i % 2 === 0) addChest(hx, hz, hy);
            addLootSpot(hx + rnd(-3, 3), hz + rnd(-3, 3), hy);
          }
          for (var u = 0; u < 6; u++) {
            var ux = cx + rnd(-34, 34),
              uz = cz + rnd(-16, 10);
            var uy = terrainHeightAt(ux, uz);
            gb.add(
              3.0,
              0.25,
              3.0,
              ux,
              uy + 2.4,
              uz,
              pickOne([0xd04a3f, 0x3fae6a, 0x3f8fe0, 0xffd23f]),
              0,
              0,
              0,
              false,
            );
            gb.add(
              0.2,
              2.4,
              0.2,
              ux - 1.2,
              uy + 1.2,
              uz - 1.2,
              col(0x9a7c50),
              0,
              0,
              0,
              true,
            );
            gb.add(
              0.2,
              2.4,
              0.2,
              ux + 1.2,
              uy + 1.2,
              uz + 1.2,
              col(0x9a7c50),
              0,
              0,
              0,
              true,
            );
          }
          commit(gb, MAT.wood, true);
          for (var l = 0; l < 9; l++)
            addLootSpot(cx + rnd(-34, 34), cz + rnd(-18, 14), y);
        }
        function side8(i) {
          return (i % 2 ? 1 : -1) * (6 + ((i * 7) % 14));
        }
        /* --- NEW: junkyard --- */
        function poiJunk(cx, cz) {
          var y = terrainHeightAt(cx, cz);
          var gb = new GeoBatch().origin(0, 0, 0, 0);
          var cols = [
            0x8a3a2f, 0x4a5a6a, 0x7a7a7a, 0x3a5a8a, 0x6a4a2f, 0x2f6a4a,
          ];
          for (var i = 0; i < 26; i++) {
            var x = cx + rnd(-30, 30),
              z = cz + rnd(-30, 30);
            var yy = terrainHeightAt(x, z);
            if (i % 3 === 0) {
              carProp(gb, x, yy, z, pickOne(cols));
            } else if (i % 3 === 1) {
              gb.add(
                rnd(3, 5),
                rnd(1.2, 2.2),
                rnd(1.6, 2.6),
                x,
                yy + rnd(0.8, 1.6),
                z,
                pickOne(cols),
                rnd(0, 3),
                0,
                0,
                true,
              );
            } else {
              gb.add(
                rnd(1.4, 2.6),
                rnd(1.0, 2.0),
                rnd(1.4, 2.6),
                x,
                yy + rnd(0.6, 1.2),
                z,
                pickOne(cols),
                rnd(0, 3),
                0,
                0,
                true,
              );
            }
          }
          /* crusher crane */
          var cg = new GeoBatch().origin(
            cx + 22,
            terrainHeightAt(cx + 22, cz - 16),
            cz - 16,
            0,
          );
          cg.add(1.4, 17, 1.4, 0, 8.5, 0, col(0x9a5f2f), 0, 0, 0, true);
          cg.add(16, 0.9, 1.2, -7.5, 16.6, 0, col(0x9a5f2f), 0, 0, 0, false);
          cg.add(2.6, 1.4, 2.6, -14.5, 16.0, 0, col(0x5a5f68), 0, 0, 0, false);
          commit(cg, MAT.metal, true);
          commit(gb, MAT.metal, true);
          for (var c = 0; c < 3; c++)
            addChest(cx + rnd(-24, 24), cz + rnd(-24, 24), y);
          for (var l = 0; l < 10; l++)
            addLootSpot(cx + rnd(-30, 30), cz + rnd(-30, 30), y);
        }

        function definePOIs() {
          POIS = [
            { n: "TILTED TOWERS", x: 0, z: -96, r: 44, f: poiTilted },
            { n: "PLEASANT PARK", x: -104, z: -58, r: 40, f: poiHouses },
            { n: "RETAIL ROW", x: 100, z: -52, r: 34, f: poiRetail },
            { n: "SALTY SPRINGS", x: -76, z: 64, r: 30, f: poiHouses },
            { n: "GREASY GROVE", x: 78, z: 84, r: 32, f: poiHouses },
            { n: "TOMATO TOWN", x: 6, z: 44, r: 26, f: poiRetail },
            { n: "DUSTY DEPOT", x: -24, z: 126, r: 30, f: poiFactory },
            { n: "ANARCHY ACRES", x: -124, z: -124, r: 38, f: poiFarm },
            { n: "LONELY LODGE", x: 138, z: 24, r: 30, f: poiTower },
            { n: "WAILING WOODS", x: -142, z: 8, r: 44, f: poiWoods },
            { n: "MOISTY MIRE", x: 112, z: -130, r: 34, f: poiRuins },
            { n: "SNOBBY SHORES", x: -40, z: -152, r: 28, f: poiHouses },
            { n: "LUCKY LANDING", x: -132, z: 118, r: 44, f: poiAirfield },
            { n: "HAUNTED HILLS", x: 56, z: -150, r: 32, f: poiGraveyard },
            { n: "SUNNY SHORES", x: 150, z: 96, r: 30, f: poiBeach },
            { n: "JUNK JUNCTION", x: -58, z: -16, r: 28, f: poiJunk },
          ];
        }
        function buildPOIs() {
          definePOIs();
          for (var i = 0; i < POIS.length; i++) {
            var p = POIS[i];
            var y = terrainRaw(p.x, p.z);
            /* flattenArea only fully levels out to r*0.72 with a falloff to r+9, but the
       POI builders scatter houses out to radius ~30 and their fences to ~33.
       Houses were therefore landing on the sloped ring, which sank their uphill
       side into the hill -- sometimes deep enough to bury the doorway, which is
       why some houses could not be entered. Widen the pad so the whole POI is
       level. */
            flattenArea(p.x, p.z, p.r * 1.28, y);
          }
          buildRoads();
          for (var k = 0; k < POIS.length; k++)
            POIS[k].y = terrainHeightAt(POIS[k].x, POIS[k].z);
          for (var j = 0; j < POIS.length; j++) {
            var q = POIS[j];
            q.f(q.x, q.z, q.r, q.n);
          }
        }
        /* ---------------- roads ---------------- */
        var ROADS = [
          [0, 1],
          [0, 2],
          [0, 3],
          [0, 4],
          [0, 5],
          [0, 15],
          [0, 6],
          [1, 7],
          [1, 11],
          [2, 13],
          [2, 8],
          [3, 10],
          [4, 14],
          [6, 12],
          [7, 9],
          [5, 10],
          [8, 14],
          [13, 11],
          [12, 7],
          [9, 1],
        ];
        function roadPoint(x, z) {
          return terrainHeightAt(x, z);
        }
        function buildRoads() {
          var gb = new GeoBatch().origin(0, 0, 0, 0);
          for (var r = 0; r < ROADS.length; r++) {
            var A = POIS[ROADS[r][0]],
              B = POIS[ROADS[r][1]];
            if (!A || !B) continue;
            var dx = B.x - A.x,
              dz = B.z - A.z,
              len = Math.sqrt(dx * dx + dz * dz);
            var n = Math.max(2, Math.floor(len / 7));
            /* flatten a corridor so the road never floats or clips */
            for (var s = 0; s <= n; s++) {
              var t = s / n;
              var px = A.x + dx * t,
                pz = A.z + dz * t;
              flattenArea(px, pz, 6.0, terrainHeightAt(px, pz));
            }
            var ang = Math.atan2(dx, dz);
            for (var q = 0; q < n; q++) {
              var t0 = q / n,
                t1 = (q + 1) / n;
              var x0 = A.x + dx * t0,
                z0 = A.z + dz * t0,
                x1 = A.x + dx * t1,
                z1 = A.z + dz * t1;
              var mx = (x0 + x1) / 2,
                mz = (z0 + z1) / 2,
                seg = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
              var y = terrainHeightAt(mx, mz);
              gb.add(
                7.6,
                0.26,
                seg + 1.2,
                mx,
                y + 0.08,
                mz,
                col(0x3c3f46),
                ang,
                0,
                0,
                false,
                true,
              );
              if (q % 2 === 0)
                gb.add(
                  0.5,
                  0.3,
                  3.2,
                  mx,
                  y + 0.12,
                  mz,
                  col(0xe0dcc8),
                  ang,
                  0,
                  0,
                  false,
                  false,
                );
            }
            /* roadside lamps */
            for (var e = 1; e < n; e += 3) {
              var t2 = e / n;
              var lx = A.x + dx * t2,
                lz = A.z + dz * t2;
              var nx = -dz / len,
                nz = dx / len;
              var sx = lx + nx * 5.2,
                sz = lz + nz * 5.2;
              streetLamp(gb, sx, terrainHeightAt(sx, sz), sz, col(0x6e7480));
            }
          }
          commit(gb, MAT.road, false);
        }

        /* ============================================================================
   Vegetation — instanced pines, blobs, dead trees, rocks, bushes and grass.
   ========================================================================== */
        function nearPOI(x, z, pad) {
          for (var i = 0; i < POIS.length; i++) {
            var p = POIS[i];
            if (dist2(x, z, p.x, p.z) < p.r + pad) return true;
          }
          return false;
        }
        function nearRoad(x, z, pad) {
          for (var r = 0; r < ROADS.length; r++) {
            var A = POIS[ROADS[r][0]],
              B = POIS[ROADS[r][1]];
            if (!A || !B) continue;
            var dx = B.x - A.x,
              dz = B.z - A.z,
              len2 = dx * dx + dz * dz;
            var t = clamp(((x - A.x) * dx + (z - A.z) * dz) / len2, 0, 1);
            var px = A.x + dx * t,
              pz = A.z + dz * t;
            if (dist2(x, z, px, pz) < pad) return true;
          }
          return false;
        }
        function buildVegetation() {
          var pine = [],
            blob = [],
            rocks = [],
            bush = [],
            dead = [],
            tufts = [];
          var tries = 0;
          while (pine.length < 330 && tries < 14000) {
            tries++;
            var a = rnd(0, 6.28),
              r = Math.sqrt(rnd(0, 1)) * 174;
            var x = Math.cos(a) * r,
              z = Math.sin(a) * r;
            var y = terrainHeightAt(x, z);
            if (y < 1.8 || y > 54) continue;
            if (terrainSlope(x, z) > 0.44) continue;
            if (nearPOI(x, z, 3) || nearRoad(x, z, 5.2)) continue;
            pine.push({
              x: x,
              y: y,
              z: z,
              s: rnd(0.8, 1.55),
              rot: rnd(0, 6.28),
            });
          }
          tries = 0;
          while (blob.length < 180 && tries < 10000) {
            tries++;
            var a2 = rnd(0, 6.28),
              r2 = Math.sqrt(rnd(0, 1)) * 170;
            var x2 = Math.cos(a2) * r2,
              z2 = Math.sin(a2) * r2;
            var y2 = terrainHeightAt(x2, z2);
            if (y2 < 2.2 || y2 > 42) continue;
            if (terrainSlope(x2, z2) > 0.4) continue;
            if (nearPOI(x2, z2, 2) || nearRoad(x2, z2, 4.6)) continue;
            blob.push({
              x: x2,
              y: y2,
              z: z2,
              s: rnd(0.8, 1.45),
              rot: rnd(0, 6.28),
            });
          }
          tries = 0;
          while (rocks.length < 170 && tries < 10000) {
            tries++;
            var a3 = rnd(0, 6.28),
              r3 = Math.sqrt(rnd(0, 1)) * 178;
            var x3 = Math.cos(a3) * r3,
              z3 = Math.sin(a3) * r3;
            var y3 = terrainHeightAt(x3, z3);
            if (y3 < 1.2) continue;
            if (nearPOI(x3, z3, 1)) continue;
            rocks.push({
              x: x3,
              y: y3,
              z: z3,
              s: rnd(0.7, 2.8),
              rot: rnd(0, 6.28),
            });
          }
          tries = 0;
          while (bush.length < 460 && tries < 10000) {
            tries++;
            var a4 = rnd(0, 6.28),
              r4 = Math.sqrt(rnd(0, 1)) * 176;
            var x4 = Math.cos(a4) * r4,
              z4 = Math.sin(a4) * r4;
            var y4 = terrainHeightAt(x4, z4);
            if (y4 < 1.8 || y4 > 46) continue;
            if (nearRoad(x4, z4, 4.0)) continue;
            bush.push({ x: x4, y: y4, z: z4, s: rnd(0.5, 1.25) });
          }
          for (var i = 0; i < TREES.length; i++) {
            var T = TREES[i];
            if (T.dead)
              dead.push({ x: T.x, y: T.y, z: T.z, s: T.s, rot: T.rot });
            else
              pine.push({
                x: T.x,
                y: T.y,
                z: T.z,
                s: T.s * 1.15,
                rot: rnd(0, 6.28),
              });
          }
          /* grass tufts — dense and close to the ground, heavy on visuals for cheap */
          tries = 0;
          while (tufts.length < 3200 && tries < 30000) {
            tries++;
            var a5 = rnd(0, 6.28),
              r5 = Math.sqrt(rnd(0, 1)) * 168;
            var x5 = Math.cos(a5) * r5,
              z5 = Math.sin(a5) * r5;
            var y5 = terrainHeightAt(x5, z5);
            if (y5 < 2.0 || y5 > 58) continue;
            if (terrainSlope(x5, z5) > 0.6) continue;
            if (nearRoad(x5, z5, 4.4)) continue;
            tufts.push({
              x: x5,
              y: y5,
              z: z5,
              s: rnd(0.7, 1.5),
              rot: rnd(0, 6.28),
            });
          }

          var m4 = new THREE.Matrix4(),
            q = new THREE.Quaternion(),
            v = new THREE.Vector3(),
            sc = new THREE.Vector3();
          var c = new THREE.Color();

          var tg = new THREE.CylinderGeometry(0.26, 0.44, 5.2, 6);
          tg.translate(0, 2.6, 0);
          var trunk = new THREE.InstancedMesh(
            tg,
            MAT.trunk,
            Math.max(1, pine.length),
          );
          trunk.castShadow = true;
          trunk.receiveShadow = true;
          var cg = new THREE.ConeGeometry(2.55, 7.8, 7);
          cg.translate(0, 7.8 / 2 + 3.5, 0);
          var canopy = new THREE.InstancedMesh(
            cg,
            MAT.canopy,
            Math.max(1, pine.length),
          );
          canopy.castShadow = true;
          canopy.receiveShadow = true;
          for (var p = 0; p < pine.length; p++) {
            var o = pine[p];
            q.setFromEuler(new THREE.Euler(0, o.rot, 0));
            m4.compose(v.set(o.x, o.y - 0.3, o.z), q, sc.set(o.s, o.s, o.s));
            trunk.setMatrixAt(p, m4);
            c.setHSL(
              0.08 + rnd(-0.02, 0.02),
              0.42,
              rnd(0.2, 0.3),
            ).convertSRGBToLinear();
            trunk.setColorAt(p, c);
            m4.compose(
              v.set(o.x, o.y - 0.3, o.z),
              q,
              sc.set(o.s, o.s * rnd(0.9, 1.2), o.s),
            );
            canopy.setMatrixAt(p, m4);
            c.setHSL(
              0.31 + rnd(-0.035, 0.035),
              0.55,
              rnd(0.17, 0.3),
            ).convertSRGBToLinear();
            canopy.setColorAt(p, c);
            colliders.insert({
              minX: o.x - 0.55,
              maxX: o.x + 0.55,
              minY: o.y - 1,
              maxY: o.y + 4.4 * o.s,
              minZ: o.z - 0.55,
              maxZ: o.z + 0.55,
              harv: "wood",
            });
          }
          worldGroup.add(trunk);
          worldGroup.add(canopy);

          var bg = new THREE.IcosahedronGeometry(2.4, 1);
          bg.translate(0, 3.6, 0);
          bg.scale(1, 0.85, 1);
          var bmesh = new THREE.InstancedMesh(
            bg,
            MAT.canopy,
            Math.max(1, blob.length),
          );
          bmesh.castShadow = true;
          bmesh.receiveShadow = true;
          for (var b = 0; b < blob.length; b++) {
            var ob = blob[b];
            q.setFromEuler(new THREE.Euler(rnd(-0.1, 0.1), ob.rot, 0));
            m4.compose(
              v.set(ob.x, ob.y - 0.2, ob.z),
              q,
              sc.set(ob.s, ob.s, ob.s),
            );
            bmesh.setMatrixAt(b, m4);
            c.setHSL(
              0.27 + rnd(-0.04, 0.04),
              0.5,
              rnd(0.2, 0.34),
            ).convertSRGBToLinear();
            bmesh.setColorAt(b, c);
            colliders.insert({
              minX: ob.x - 0.5,
              maxX: ob.x + 0.5,
              minY: ob.y - 1,
              maxY: ob.y + 3.4 * ob.s,
              minZ: ob.z - 0.5,
              maxZ: ob.z + 0.5,
              harv: "wood",
            });
          }
          worldGroup.add(bmesh);

          if (dead.length) {
            var dg = new THREE.CylinderGeometry(0.16, 0.34, 6.0, 5);
            dg.translate(0, 3.0, 0);
            var dmesh = new THREE.InstancedMesh(dg, MAT.trunk, dead.length);
            dmesh.castShadow = true;
            dmesh.receiveShadow = true;
            for (var d2 = 0; d2 < dead.length; d2++) {
              var od = dead[d2];
              q.setFromEuler(
                new THREE.Euler(rnd(-0.12, 0.12), od.rot, rnd(-0.12, 0.12)),
              );
              m4.compose(
                v.set(od.x, od.y - 0.2, od.z),
                q,
                sc.set(od.s, od.s, od.s),
              );
              dmesh.setMatrixAt(d2, m4);
              c.setHSL(0.08, 0.16, rnd(0.16, 0.26)).convertSRGBToLinear();
              dmesh.setColorAt(d2, c);
              colliders.insert({
                minX: od.x - 0.4,
                maxX: od.x + 0.4,
                minY: od.y - 1,
                maxY: od.y + 5 * od.s,
                minZ: od.z - 0.4,
                maxZ: od.z + 0.4,
                harv: "wood",
              });
            }
            worldGroup.add(dmesh);
          }

          var rg = new THREE.IcosahedronGeometry(1.6, 0);
          var rmesh = new THREE.InstancedMesh(
            rg,
            MAT.rockI,
            Math.max(1, rocks.length),
          );
          rmesh.castShadow = true;
          rmesh.receiveShadow = true;
          for (var rk = 0; rk < rocks.length; rk++) {
            var orr = rocks[rk];
            q.setFromEuler(
              new THREE.Euler(rnd(-0.4, 0.4), orr.rot, rnd(-0.4, 0.4)),
            );
            m4.compose(
              v.set(orr.x, orr.y + orr.s * 0.5, orr.z),
              q,
              sc.set(orr.s, orr.s * rnd(0.6, 1), orr.s * rnd(0.8, 1.2)),
            );
            rmesh.setMatrixAt(rk, m4);
            c.setHSL(0.09, 0.05, rnd(0.34, 0.5)).convertSRGBToLinear();
            rmesh.setColorAt(rk, c);
            colliders.insert({
              minX: orr.x - orr.s * 0.9,
              maxX: orr.x + orr.s * 0.9,
              minY: orr.y - 1,
              maxY: orr.y + orr.s * 0.9,
              minZ: orr.z - orr.s * 0.9,
              maxZ: orr.z + orr.s * 0.9,
              harv: "stone",
            });
          }
          worldGroup.add(rmesh);

          var ug = new THREE.IcosahedronGeometry(0.9, 0);
          ug.translate(0, 0.5, 0);
          var umesh = new THREE.InstancedMesh(
            ug,
            MAT.leaf,
            Math.max(1, bush.length),
          );
          umesh.castShadow = false;
          umesh.receiveShadow = true;
          for (var u = 0; u < bush.length; u++) {
            var ob2 = bush[u];
            q.setFromEuler(new THREE.Euler(0, ob2.s * 9, 0));
            m4.compose(
              v.set(ob2.x, ob2.y, ob2.z),
              q,
              sc.set(ob2.s, ob2.s * rnd(0.6, 1.1), ob2.s),
            );
            umesh.setMatrixAt(u, m4);
            c.setHSL(
              0.26 + rnd(-0.05, 0.05),
              0.45,
              rnd(0.16, 0.3),
            ).convertSRGBToLinear();
            umesh.setColorAt(u, c);
          }
          worldGroup.add(umesh);

          /* grass tufts: two crossed quads */
          var g1 = new THREE.PlaneGeometry(1.5, 1.05);
          g1.translate(0, 0.52, 0);
          var g2 = new THREE.PlaneGeometry(1.5, 1.05);
          g2.rotateY(Math.PI / 2);
          g2.translate(0, 0.52, 0);
          var tuftGeo = mergeSimple([g1, g2]);
          var tmesh = new THREE.InstancedMesh(
            tuftGeo,
            MAT.grassI,
            Math.max(1, tufts.length),
          );
          tmesh.castShadow = false;
          tmesh.receiveShadow = true;
          for (var tf = 0; tf < tufts.length; tf++) {
            var ot = tufts[tf];
            q.setFromEuler(new THREE.Euler(0, ot.rot, 0));
            m4.compose(
              v.set(ot.x, ot.y - 0.05, ot.z),
              q,
              sc.set(ot.s, ot.s * rnd(0.8, 1.5), ot.s),
            );
            tmesh.setMatrixAt(tf, m4);
            c.setHSL(
              0.25 + rnd(-0.04, 0.05),
              0.5,
              rnd(0.24, 0.42),
            ).convertSRGBToLinear();
            tmesh.setColorAt(tf, c);
          }
          worldGroup.add(tmesh);
        }
        /* minimal geometry merge (positions/normals/uv only) */
        function mergeSimple(geos) {
          var pos = [],
            nor = [],
            uv = [];
          for (var i = 0; i < geos.length; i++) {
            var g = geos[i].index ? geos[i].toNonIndexed() : geos[i];
            var p = g.attributes.position.array,
              n = g.attributes.normal.array,
              u = g.attributes.uv.array;
            for (var j = 0; j < p.length; j++) pos.push(p[j]);
            for (var k = 0; k < n.length; k++) nor.push(n[k]);
            for (var m = 0; m < u.length; m++) uv.push(u[m]);
          }
          var out = new THREE.BufferGeometry();
          out.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(pos, 3),
          );
          out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
          out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
          out.computeBoundingSphere();
          return out;
        }

        /* ============================================================================
   Chests, harvest nodes, vehicles
   ========================================================================== */
        var CHEST_GLOW = [];
        function buildChests() {
          var body = new THREE.BoxGeometry(1.5, 0.85, 1.05);
          var lid = new THREE.BoxGeometry(1.55, 0.28, 1.1);
          var gold = new THREE.MeshStandardMaterial({
            color: col(0xd8a12a),
            metalness: 0.85,
            roughness: 0.28,
            emissive: col(0x3a2600),
          });
          var dark = new THREE.MeshStandardMaterial({
            color: col(0x6b4a1c),
            metalness: 0.6,
            roughness: 0.5,
          });
          for (var i = 0; i < CHESTS.length; i++) {
            var ch = CHESTS[i];
            var g = new THREE.Group();
            g.position.set(ch.x, ch.y + 0.45, ch.z);
            g.rotation.y = rnd(0, 6.28);
            var b = new THREE.Mesh(body, gold);
            b.castShadow = true;
            g.add(b);
            var l = new THREE.Mesh(lid, dark);
            l.position.set(0, 0.56, 0);
            l.castShadow = true;
            g.add(l);
            var bd = new THREE.Mesh(
              new THREE.BoxGeometry(1.58, 0.16, 1.12),
              dark,
            );
            bd.position.y = -0.34;
            g.add(bd);
            var spr = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: TEX.glow,
                color: col(0xffd76a),
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
              }),
            );
            spr.scale.set(3, 3, 1);
            spr.position.y = 0.7;
            g.add(spr);
            worldGroup.add(g);
            ch.mesh = g;
            ch.lid = l;
            ch.spr = spr;
            colliders.insert({
              minX: ch.x - 0.8,
              maxX: ch.x + 0.8,
              minY: ch.y,
              maxY: ch.y + 1.1,
              minZ: ch.z - 0.6,
              maxZ: ch.z + 0.6,
            });
          }
        }
        function buildMetalNodes() {
          var gb = new GeoBatch().origin(0, 0, 0, 0);
          var n = 0,
            tries = 0;
          while (n < 52 && tries < 5000) {
            tries++;
            var a = rnd(0, 6.28),
              r = Math.sqrt(rnd(0, 1)) * 166;
            var x = Math.cos(a) * r,
              z = Math.sin(a) * r;
            var y = terrainHeightAt(x, z);
            if (y < 2.0 || terrainSlope(x, z) > 0.35) continue;
            if (nearPOI(x, z, 1) || nearRoad(x, z, 5)) continue;
            var isCar = srnd() < 0.6;
            if (isCar) {
              carProp(
                gb,
                x,
                y,
                z,
                pickOne([0x8a3a2f, 0x4a5a6a, 0x7a7a7a, 0x3a5a8a]),
              );
            } else {
              gb.add(
                1.2,
                1.5,
                1.2,
                x,
                y + 0.75,
                z,
                col(0x8a4a3a),
                rnd(0, 3),
                0,
                0,
                true,
              );
              gb.add(
                1.3,
                0.2,
                1.3,
                x,
                y + 1.55,
                z,
                col(0x6a6a72),
                0,
                0,
                0,
                false,
              );
            }
            var tag = isCar ? 1.9 : 0.9;
            colliders.insert({
              minX: x - tag,
              maxX: x + tag,
              minY: y - 0.5,
              maxY: y + 1.8,
              minZ: z - tag,
              maxZ: z + tag,
              harv: "metal",
            });
            n++;
          }
          commit(gb, MAT.metal, true);
        }

        /* ============================================================================
   Minimap bake — also used by the full map screen.
   ========================================================================== */
        function buildMapCanvas() {
          var S = 1024;
          var c = document.createElement("canvas");
          c.width = c.height = S;
          var g = c.getContext("2d");
          var half = CFG.MAP / 2,
            scale = S / CFG.MAP;
          var img = g.createImageData(S, S);
          var D = HM.data,
            n = HM.n,
            step = HM.step;
          for (var j = 0; j < S; j++) {
            for (var i = 0; i < S; i++) {
              var x = (i / S) * CFG.MAP - half,
                z = (j / S) * CFG.MAP - half;
              var y = terrainHeightAt(x, z);
              var r, gr, b;
              if (y < CFG.SEA + 0.3) {
                var dp = clamp(-y / 12, 0, 1);
                r = 30 + dp * 6;
                gr = 86 - dp * 26;
                b = 150 - dp * 30;
              } else if (y < 3) {
                r = 214;
                gr = 198;
                b = 148;
              } else {
                var t = clamp((y - 3) / 70, 0, 1);
                r = Math.floor(lerp(84, 158, t));
                gr = Math.floor(lerp(146, 150, t));
                b = Math.floor(lerp(62, 152, t));
                if (t > 0.72) {
                  r = 226;
                  gr = 236;
                  b = 246;
                }
              }
              var o = (j * S + i) * 4;
              img.data[o] = r;
              img.data[o + 1] = gr;
              img.data[o + 2] = b;
              img.data[o + 3] = 255;
            }
          }
          g.putImageData(img, 0, 0);
          /* POI discs */
          g.globalAlpha = 0.5;
          g.fillStyle = "#1c3f14";
          for (var p = 0; p < POIS.length; p++) {
            var q = POIS[p];
            g.beginPath();
            g.arc(
              (q.x + half) * scale,
              (q.z + half) * scale,
              q.r * scale,
              0,
              6.3,
            );
            g.fill();
          }
          g.globalAlpha = 1;
          /* roads */
          g.strokeStyle = "rgba(60,63,70,.85)";
          g.lineWidth = Math.max(3, S / 150);
          for (var r2 = 0; r2 < ROADS.length; r2++) {
            var A = POIS[ROADS[r2][0]],
              B = POIS[ROADS[r2][1]];
            if (!A || !B) continue;
            g.beginPath();
            g.moveTo((A.x + half) * scale, (A.z + half) * scale);
            g.lineTo((B.x + half) * scale, (B.z + half) * scale);
            g.stroke();
          }
          g.font = "bold 15px Trebuchet MS";
          g.textAlign = "center";
          g.textBaseline = "middle";
          for (var k = 0; k < POIS.length; k++) {
            var q2 = POIS[k];
            var px = (q2.x + half) * scale,
              py = (q2.z + half) * scale;
            g.fillStyle = "rgba(0,0,0,.78)";
            var w = g.measureText(q2.n).width;
            g.fillRect(px - w / 2 - 5, py - 10, w + 10, 17);
            g.fillStyle = "#fff";
            g.fillText(q2.n, px, py);
          }
          MAPCANVAS = c;
        }

        /* ---------------- world content ---------------- */
        function initWorldContent() {
          colliders = new SpatialHash(8);
          platHash = new SpatialHash(8);
          rampHash = new SpatialHash(8);
          buildHeightmap();
          buildPOIs();
          buildTerrainMesh();
          buildWater();
          buildVegetation();
          buildChests();
          buildMetalNodes();
          buildRebootVans(); /* colliders must exist before the nav grid is baked */
          buildMapCanvas();
          buildNavGrid();
        }

// === build ===
/* ==== 30_build.js ==== */
        /* ============================================================================
   30_BUILD — Fortnite-style grid building.
   Walls / floors / ramps / cones, wall variants (window, door, half),
   in-place editing, turbo build, ramp rush, repair and piece damage.
   ========================================================================== */

        var BUILDS = {};
        var CELLIDX = {};
        var GHOST = null,
          GHOST_TYPE = null,
          GHOST_VARIANT = null;
        var BUILD_MODE = false,
          BUILD_PIECE = "wall",
          BUILD_MAT = "wood";
        var BGEO = {},
          BMAT = {};
        var COST = 10,
          MAX_MATS = 999;
        var PIECE_HP = { wood: 150, stone: 300, metal: 500 };
        var BUILD_CD = 0,
          BUILD_HOLD = 0;
        var TURBO_CD = 0.085,
          NORMAL_CD = 0.16;
        var EDIT_TARGET = null,
          EDIT_CD = 0;
        var REPAIR_CD = 0;

        /* local-space sub-boxes: [w,h,d, ox,oy,oz] — piece origin is the piece centre */
        var PIECE_DEFS = {
          wall: [[4, 4, 0.3, 0, 0, 0]],
          wallWin: [
            [4, 1.3, 0.3, 0, -1.35, 0],
            [4, 1.3, 0.3, 0, 1.35, 0],
            [1.4, 1.4, 0.3, -1.3, 0, 0],
            [1.4, 1.4, 0.3, 1.3, 0, 0],
          ],
          wallDoor: [
            [4, 1.2, 0.3, 0, 1.4, 0],
            [1.3, 2.8, 0.3, -1.35, -0.6, 0],
            [1.3, 2.8, 0.3, 1.35, -0.6, 0],
          ],
          wallHalf: [[4, 2, 0.3, 0, -1, 0]],
          floor: [[4, 0.3, 4, 0, 0, 0]],
          ramp: [[4, 4, 4, 0, 0, 0]],
          pyramid: [[4, 4, 4, 0, 0, 0]],
        };
        var WALL_VARIANTS = ["wall", "wallWin", "wallDoor", "wallHalf"];

        function initBuildAssets() {
          var G = CFG.GRID;
          BGEO.wall = buildPieceGeo("wall");
          BGEO.wallWin = buildPieceGeo("wallWin");
          BGEO.wallDoor = buildPieceGeo("wallDoor");
          BGEO.wallHalf = buildPieceGeo("wallHalf");
          BGEO.floor = buildPieceGeo("floor");
          var slope = G * Math.SQRT2;
          var r = new THREE.BoxGeometry(slope, 0.28, G);
          r.rotateZ(Math.PI / 4);
          BGEO.ramp = r;
          var p = new THREE.ConeGeometry(G * 0.707, G * 0.72, 4, 1);
          p.rotateY(Math.PI / 4);
          p.translate(0, G * 0.36, 0);
          BGEO.pyramid = p;

          BMAT.wood = new THREE.MeshStandardMaterial({
            map: TEX.wood,
            roughness: 0.85,
          });
          BMAT.stone = new THREE.MeshStandardMaterial({
            map: TEX.stone,
            roughness: 0.93,
          });
          BMAT.metal = new THREE.MeshStandardMaterial({
            map: TEX.metal,
            roughness: 0.42,
            metalness: 0.6,
          });
          BMAT.dmg_wood = new THREE.MeshStandardMaterial({
            map: TEX.wood,
            roughness: 0.85,
            emissive: col(0x4a1206),
            emissiveIntensity: 0.55,
          });
          BMAT.dmg_stone = new THREE.MeshStandardMaterial({
            map: TEX.stone,
            roughness: 0.93,
            emissive: col(0x4a1206),
            emissiveIntensity: 0.55,
          });
          BMAT.dmg_metal = new THREE.MeshStandardMaterial({
            map: TEX.metal,
            roughness: 0.42,
            metalness: 0.6,
            emissive: col(0x4a1206),
            emissiveIntensity: 0.55,
          });
          BMAT.ghostOk = new THREE.MeshBasicMaterial({
            color: 0x6bffa8,
            transparent: true,
            opacity: 0.34,
            depthWrite: false,
          });
          BMAT.ghostBad = new THREE.MeshBasicMaterial({
            color: 0xff5b5b,
            transparent: true,
            opacity: 0.28,
            depthWrite: false,
          });
          BMAT.ghostEdit = new THREE.MeshBasicMaterial({
            color: 0x6bc4ff,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
          });
        }
        function buildPieceGeo(type) {
          var def = PIECE_DEFS[type],
            geos = [];
          for (var i = 0; i < def.length; i++) {
            var b = def[i];
            var g = new THREE.BoxGeometry(b[0], b[1], b[2]);
            g.translate(b[3], b[4], b[5]);
            geos.push(g);
          }
          return mergeSimple(geos);
        }
        function matOf(name) {
          return BMAT[name] || BMAT.wood;
        }
        function dmgMatOf(name) {
          return BMAT["dmg_" + name] || BMAT.dmg_wood;
        }

        function cellKey(gx, gz, lvl) {
          return gx + "_" + gz + "_" + lvl;
        }
        function idxAdd(gx, gz, lvl, d) {
          var k = cellKey(gx, gz, lvl);
          CELLIDX[k] = (CELLIDX[k] || 0) + d;
          if (CELLIDX[k] <= 0) delete CELLIDX[k];
        }
        function hasPieceAt(gx, gz, lvl) {
          return (CELLIDX[cellKey(gx, gz, lvl)] || 0) > 0;
        }

        /* ---------------- placement maths ---------------- */
        function computePlacement(px, pz, feetY, dx, dz, pitch, type) {
          var G = CFG.GRID;
          var lvl = Math.round(feetY / G);
          var adx = Math.abs(dx),
            adz = Math.abs(dz);
          var dxi = adx >= adz ? (dx >= 0 ? 1 : -1) : 0;
          var dzi = adx >= adz ? 0 : dz >= 0 ? 1 : -1;
          var cellX = Math.round(px / G),
            cellZ = Math.round(pz / G);
          var out = null;
          if (type === "wall") {
            var fx = cellX + dxi,
              fz = cellZ + dzi;
            if (dxi !== 0) {
              var ax = Math.min(cellX, fx);
              out = {
                key: "WX" + ax + "_" + cellZ + "_" + lvl,
                x: (ax + 0.5) * G,
                z: cellZ * G,
                ry: Math.PI / 2,
                gx: cellX,
                gz: cellZ,
                dxi: dxi,
                dzi: dzi,
              };
            } else {
              var az = Math.min(cellZ, fz);
              out = {
                key: "WZ" + cellX + "_" + az + "_" + lvl,
                x: cellX * G,
                z: (az + 0.5) * G,
                ry: 0,
                gx: cellX,
                gz: cellZ,
                dxi: dxi,
                dzi: dzi,
              };
            }
            out.y = lvl * G + G / 2;
          } else if (type === "floor") {
            var tX = px + dx * G * 0.62,
              tZ = pz + dz * G * 0.62;
            if (pitch < -0.62) {
              tX = px;
              tZ = pz;
            }
            var cX = Math.round(tX / G),
              cZ = Math.round(tZ / G);
            out = {
              key: "F" + cX + "_" + cZ + "_" + lvl,
              x: cX * G,
              z: cZ * G,
              y: lvl * G - 0.15,
              ry: 0,
              gx: cX,
              gz: cZ,
              dxi: dxi,
              dzi: dzi,
            };
          } else if (type === "ramp") {
            var rX = Math.round((px + dx * G * 0.9) / G),
              rZ = Math.round((pz + dz * G * 0.9) / G);
            var ry =
              dxi !== 0
                ? dxi > 0
                  ? 0
                  : Math.PI
                : dzi > 0
                  ? -Math.PI / 2
                  : Math.PI / 2;
            out = {
              key: "R" + rX + "_" + rZ + "_" + lvl + "_" + dxi + "_" + dzi,
              x: rX * G,
              z: rZ * G,
              y: lvl * G + G / 2,
              ry: ry,
              gx: rX,
              gz: rZ,
              dxi: dxi,
              dzi: dzi,
            };
          } else {
            var pX = Math.round((px + dx * G * 0.62) / G),
              pZ = Math.round((pz + dz * G * 0.62) / G);
            out = {
              key: "P" + pX + "_" + pZ + "_" + lvl,
              x: pX * G,
              z: pZ * G,
              y: lvl * G,
              ry: 0,
              gx: pX,
              gz: pZ,
              dxi: dxi,
              dzi: dzi,
            };
          }
          out.type = type;
          out.lvl = lvl;
          return out;
        }
        function hasSupport(pl) {
          var G = CFG.GRID,
            lvl = pl.lvl;
          var gy = terrainHeightAt(pl.gx * G, pl.gz * G);
          if (pl.type === "wall") {
            if (gy >= lvl * G - 1.6) return true;
          } else {
            if (Math.abs(gy - lvl * G) < 1.6) return true;
          }
          if (
            hasPieceAt(pl.gx + 1, pl.gz, lvl) ||
            hasPieceAt(pl.gx - 1, pl.gz, lvl) ||
            hasPieceAt(pl.gx, pl.gz + 1, lvl) ||
            hasPieceAt(pl.gx, pl.gz - 1, lvl)
          )
            return true;
          if (
            hasPieceAt(pl.gx, pl.gz, lvl - 1) ||
            hasPieceAt(pl.gx, pl.gz, lvl + 1)
          )
            return true;
          return false;
        }
        function placementValid(pl, ch) {
          if (!pl) return false;
          if (BUILDS[pl.key]) return false;
          var d = dist2(ch.x, ch.z, pl.x, pl.z);
          if (d > CFG.BUILD_RANGE) return false;
          if (!hasSupport(pl)) return false;
          if (
            pl.type !== "wall" &&
            pl.lvl * CFG.GRID > terrainHeightAt(pl.x, pl.z) + 64
          )
            return false;
          return true;
        }

        /* ---------------- piece creation ---------------- */
        function makePiece(pl, matName, owner, variant) {
          var G = CFG.GRID,
            rec = {};
          var type = variant || pl.type;
          rec.type = pl.type;
          rec.variant = type;
          rec.mat = matName;
          rec.owner = owner;
          rec.key = pl.key;
          rec.hp = PIECE_HP[matName];
          rec.maxHp = rec.hp;
          rec.lvl = pl.lvl;
          rec.gx = pl.gx;
          rec.gz = pl.gz;
          rec.x = pl.x;
          rec.y = pl.y;
          rec.z = pl.z;
          rec.ry = pl.ry || 0;
          var mesh = new THREE.Mesh(
            BGEO[type] || BGEO[pl.type],
            matOf(matName),
          );
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.position.set(pl.x, pl.y, pl.z);
          mesh.rotation.y = pl.ry || 0;
          worldGroup.add(mesh);
          rec.mesh = mesh;

          /* --- collision + walkable surfaces, one AABB per sub-box --- */
          var def = PIECE_DEFS[type] || PIECE_DEFS[pl.type];
          rec.boxes = [];
          var c = Math.abs(Math.cos(rec.ry)),
            s = Math.abs(Math.sin(rec.ry));
          for (var i = 0; i < def.length; i++) {
            var b = def[i];
            var ox = b[3],
              oz = b[5];
            var wx = pl.x + ox * c + oz * s;
            var wz = pl.z - ox * s + oz * c;
            var wy = pl.y + b[4];
            var hw = (b[0] * c + b[2] * s) / 2,
              hd = (b[0] * s + b[2] * c) / 2,
              hh = b[1] / 2;
            var bb = {
              minX: wx - hw,
              maxX: wx + hw,
              minY: wy - hh,
              maxY: wy + hh,
              minZ: wz - hd,
              maxZ: wz + hd,
              build: rec,
            };
            rec.boxes.push(bb);
            if (pl.type !== "ramp") colliders.insert(bb);
          }
          rec.box = rec.boxes[0];

          if (pl.type === "ramp") {
            var dxi = pl.dxi,
              dzi = pl.dzi;
            if (dxi !== 0) {
              var xa = pl.x - (dxi * G) / 2,
                xb = pl.x + (dxi * G) / 2;
              rec.ramp = {
                x0: xa,
                z0: pl.z,
                h0: pl.lvl * G,
                x1: xb,
                z1: pl.z,
                h1: (pl.lvl + 1) * G,
                halfW: G / 2,
                mat: matName,
              };
            } else {
              var za = pl.z - (dzi * G) / 2,
                zb = pl.z + (dzi * G) / 2;
              rec.ramp = {
                x0: pl.x,
                z0: za,
                h0: pl.lvl * G,
                x1: pl.x,
                z1: zb,
                h1: (pl.lvl + 1) * G,
                halfW: G / 2,
                mat: matName,
              };
            }
            insertRamp(rec.ramp);
          } else if (pl.type === "floor") {
            rec.plat = {
              minX: pl.x - G / 2,
              maxX: pl.x + G / 2,
              minZ: pl.z - G / 2,
              maxZ: pl.z + G / 2,
              y: pl.lvl * G,
              mat: matName,
            };
            insertPlatform(rec.plat);
          } else if (pl.type === "pyramid") {
            var top = pl.lvl * G + G * 0.72;
            rec.plats = [];
            var dirs = [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ];
            for (var k = 0; k < 4; k++) {
              var dd = dirs[k];
              var rr = {
                x0: pl.x - (dd[0] * G) / 2,
                z0: pl.z - (dd[1] * G) / 2,
                h0: pl.lvl * G,
                x1: pl.x,
                z1: pl.z,
                h1: top,
                halfW: G / 2,
                mat: matName,
              };
              rec.plats.push(rr);
              insertRamp(rr);
            }
          } else {
            /* walls give a walkable ledge so you can stand on top of them */
            rec.plat = {
              minX: pl.x - G / 2,
              maxX: pl.x + G / 2,
              minZ: pl.z - G / 2,
              maxZ: pl.z + G / 2,
              y: pl.y + G / 2,
              mat: matName,
            };
            insertPlatform(rec.plat);
          }
          BUILDS[pl.key] = rec;
          idxAdd(pl.gx, pl.gz, pl.lvl, 1);
          return rec;
        }
        function placeBuild(pl, matName, owner, variant) {
          if (!pl || BUILDS[pl.key]) return null;
          if (!hasSupport(pl)) return null;
          var rec = makePiece(pl, matName || "wood", owner, variant);
          Sfx.build();
          return rec;
        }
        function killPiece(rec, quiet) {
          if (!rec || rec.dead) return;
          rec.dead = true;
          if (rec.mesh) {
            worldGroup.remove(rec.mesh);
            rec.mesh = null;
          }
          if (rec.boxes)
            for (var i = 0; i < rec.boxes.length; i++) rec.boxes[i].dead = true;
          if (rec.box) rec.box.dead = true;
          if (rec.plat) rec.plat.dead = true;
          if (rec.ramp) rec.ramp.dead = true;
          if (rec.plats)
            for (var j = 0; j < rec.plats.length; j++) rec.plats[j].dead = true;
          idxAdd(rec.gx, rec.gz, rec.lvl, -1);
          delete BUILDS[rec.key];
          if (!quiet) Sfx.break();
        }
        function damageBuild(rec, dmg, by) {
          if (!rec || rec.dead) return;
          rec.hp -= dmg;
          if (rec.mesh) {
            var f = 1 - rec.hp / rec.maxHp;
            rec.mesh.scale.setScalar(1 + f * 0.035);
            rec.mesh.rotation.z = Math.sin(GAMETIME * 30) * f * 0.012;
            rec.mesh.material = f > 0.35 ? dmgMatOf(rec.mat) : matOf(rec.mat);
          }
          if (rec.hp <= 0) {
            var px = rec.x,
              py = rec.y,
              pz = rec.z;
            var kind =
              rec.mat === "wood"
                ? "wood"
                : rec.mat === "stone"
                  ? "stone"
                  : "metal";
            fxDebris(px, py, pz, kind, 10);
            addDecal(px, py - 1.9, pz, 0, 1, 0, 2.2, "scorch", 8);
            killPiece(rec);
          }
        }
        function clearAllBuilds() {
          for (var k in BUILDS)
            if (BUILDS.hasOwnProperty(k)) killPiece(BUILDS[k], true);
          BUILDS = {};
          CELLIDX = {};
        }

        /* ---------------- editing ---------------- */
        function findEditTarget(ch) {
          var ox, oy, oz;
          if (ch.isPlayer && CAM.pos) {
            ox = CAM.pos.x;
            oy = CAM.pos.y;
            oz = CAM.pos.z;
            var r = raycastWorld(
              { x: ox, y: oy, z: oz },
              CAM.dir.x,
              CAM.dir.y,
              CAM.dir.z,
              CFG.BUILD_RANGE + 3,
            );
            if (r.kind === "box" && r.obj && r.obj.build && !r.obj.build.dead)
              return { rec: r.obj.build, t: r.t };
            return null;
          }
          var dx = Math.sin(ch.yaw),
            dz = Math.cos(ch.yaw);
          var res = raycastWorld(
            { x: ch.x, y: ch.y + 1.4, z: ch.z },
            dx,
            -0.1,
            dz,
            CFG.BUILD_RANGE + 2,
          );
          if (
            res.kind === "box" &&
            res.obj &&
            res.obj.build &&
            !res.obj.build.dead
          )
            return { rec: res.obj.build, t: res.t };
          return null;
        }
        function cycleEdit(rec) {
          if (!rec || rec.type !== "wall") return false;
          var idx = WALL_VARIANTS.indexOf(rec.variant || "wall");
          if (idx < 0) idx = 0;
          var next = WALL_VARIANTS[(idx + 1) % WALL_VARIANTS.length];
          return setVariant(rec, next);
        }
        function setVariant(rec, variant) {
          if (!rec || rec.dead) return false;
          if (rec.type !== "wall") return false;
          if (rec.variant === variant) return true;
          /* rebuild geometry + collision in place, keeping damage */
          var pl = {
            type: "wall",
            lvl: rec.lvl,
            gx: rec.gx,
            gz: rec.gz,
            x: rec.x,
            y: rec.y,
            z: rec.z,
            ry: rec.ry,
            key: rec.key,
          };
          var hp = rec.hp,
            mat = rec.mat,
            owner = rec.owner;
          killPiece(rec, true);
          var fresh = makePiece(pl, mat, owner, variant);
          fresh.hp = hp;
          if (fresh.mesh)
            fresh.mesh.material =
              1 - hp / fresh.maxHp > 0.35 ? dmgMatOf(mat) : matOf(mat);
          Sfx.edit();
          return true;
        }
        function repairPiece(rec, ch) {
          if (!rec || rec.dead) return false;
          if (rec.hp >= rec.maxHp) return false;
          var missing = rec.maxHp - rec.hp;
          var cost = Math.max(1, Math.ceil((missing / rec.maxHp) * COST * 1.4));
          if (ch.mats[rec.mat] < cost) return false;
          ch.mats[rec.mat] -= cost;
          rec.hp = Math.min(rec.maxHp, rec.hp + rec.maxHp * 0.5);
          if (rec.mesh) {
            rec.mesh.scale.setScalar(1);
            rec.mesh.rotation.z = 0;
            rec.mesh.material =
              1 - rec.hp / rec.maxHp > 0.35
                ? dmgMatOf(rec.mat)
                : matOf(rec.mat);
          }
          Sfx.repair();
          if (ch.isPlayer) UI.floatGain(-cost, rec.mat);
          return true;
        }

        /* ---------------- ghost preview ---------------- */
        function updateGhost(ch, type, mat, variant) {
          var geoType = variant || type;
          if (!GHOST || GHOST_TYPE !== geoType) {
            if (GHOST) {
              worldGroup.remove(GHOST);
              GHOST = null;
            }
            GHOST = new THREE.Mesh(BGEO[geoType] || BGEO[type], BMAT.ghostOk);
            GHOST.renderOrder = 5;
            worldGroup.add(GHOST);
            GHOST_TYPE = geoType;
          }
          var pl = computePlacement(
            ch.x,
            ch.z,
            ch.y,
            ch.aimX,
            ch.aimZ,
            ch.pitch,
            type,
          );
          var ok = placementValid(pl, ch) && ch.mats[mat] >= COST;
          GHOST.visible = true;
          GHOST.position.set(pl.x, pl.y, pl.z);
          GHOST.rotation.y = pl.ry || 0;
          GHOST.material = ok ? BMAT.ghostOk : BMAT.ghostBad;
          return { pl: pl, ok: ok };
        }
        function hideGhost() {
          if (GHOST) GHOST.visible = false;
        }

        /* ---------------- build actions (used by player + bots) ---------------- */
        function tryPlace(ch, type, mat, variant) {
          var pl = computePlacement(
            ch.x,
            ch.z,
            ch.y,
            ch.aimX,
            ch.aimZ,
            ch.pitch || 0,
            type,
          );
          if (!pl || !placementValid(pl, ch)) return null;
          if (ch.mats[mat] < COST) return null;
          var rec = placeBuild(pl, mat, ch, variant);
          if (rec) ch.mats[mat] -= COST;
          return rec;
        }
        /* Fortnite's ramp-rush: place a ramp and a wall in front of it, twice */
        function rampRush(ch, mat) {
          var made = 0;
          for (var step = 0; step < 2; step++) {
            var baseY = ch.y + step * CFG.GRID;
            var dx = ch.aimX,
              dz = ch.aimZ;
            var G = CFG.GRID;
            var rX = Math.round((ch.x + dx * G * (0.9 + step * 1.1)) / G),
              rZ = Math.round((ch.z + dz * G * (0.9 + step * 1.1)) / G);
            var dxi = Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 1 : -1) : 0;
            var dzi = Math.abs(dx) >= Math.abs(dz) ? 0 : dz >= 0 ? 1 : -1;
            var lvl = Math.round(baseY / G);
            var ry =
              dxi !== 0
                ? dxi > 0
                  ? 0
                  : Math.PI
                : dzi > 0
                  ? -Math.PI / 2
                  : Math.PI / 2;
            var plR = {
              type: "ramp",
              lvl: lvl,
              gx: rX,
              gz: rZ,
              x: rX * G,
              z: rZ * G,
              y: lvl * G + G / 2,
              ry: ry,
              dxi: dxi,
              dzi: dzi,
              key: "R" + rX + "_" + rZ + "_" + lvl + "_" + dxi + "_" + dzi,
            };
            if (ch.mats[mat] >= COST && placementValid(plR, ch)) {
              placeBuild(plR, mat, ch);
              ch.mats[mat] -= COST;
              made++;
            }
            var wX = Math.round((ch.x + dx * G * (1.4 + step * 1.1)) / G),
              wZ = Math.round((ch.z + dz * G * (1.4 + step * 1.1)) / G);
            var awx = Math.abs(dx) >= Math.abs(dz);
            var wx, wz, wry, wkey;
            if (awx) {
              wx = Math.min(wX, wX + (dx >= 0 ? 1 : -1));
              wz = wZ;
              wry = Math.PI / 2;
              wkey = "WX" + wx + "_" + wz + "_" + lvl;
            } else {
              wz = Math.min(wZ, wZ + (dz >= 0 ? 1 : -1));
              wx = wX;
              wry = 0;
              wkey = "WZ" + wx + "_" + wz + "_" + lvl;
            }
            var plW = {
              type: "wall",
              lvl: lvl,
              gx: wX,
              gz: wZ,
              x: awx ? (wx + 0.5) * G : wx * G,
              z: awx ? wz * G : (wz + 0.5) * G,
              y: lvl * G + G / 2,
              ry: wry,
              dxi: dxi,
              dzi: dzi,
              key: wkey,
            };
            if (ch.mats[mat] >= COST && placementValid(plW, ch)) {
              placeBuild(plW, mat, ch);
              ch.mats[mat] -= COST;
              made++;
            }
          }
          return made;
        }
        function updateBuild(dt, firing) {
          if (!PC || !PC.alive) return;
          if (BUILD_CD > 0) BUILD_CD -= dt;
          if (EDIT_CD > 0) EDIT_CD -= dt;
          if (REPAIR_CD > 0) REPAIR_CD -= dt;
          if (!BUILD_MODE) {
            hideGhost();
            return;
          }

          /* edit targeting */
          var tgt = findEditTarget(PC);
          EDIT_TARGET = tgt ? tgt.rec : null;

          var g = updateGhost(PC, BUILD_PIECE, BUILD_MAT, BUILT_VARIANT);
          if (EDIT_TARGET && GHOST) GHOST.material = BMAT.ghostEdit;
          if (firing && BUILD_CD <= 0) {
            var turbo = BUILD_HOLD > 0.22;
            if (g.ok) {
              if (turbo && PC.sprinting && PC.mats[BUILD_MAT] >= COST * 4) {
                var made = rampRush(PC, BUILD_MAT);
                BUILD_CD = made ? TURBO_CD : NORMAL_CD;
              } else {
                var rec = placeBuild(g.pl, BUILD_MAT, PC, BUILT_VARIANT);
                if (rec) {
                  PC.mats[BUILD_MAT] -= COST;
                  BUILD_CD = turbo ? TURBO_CD : NORMAL_CD;
                } else BUILD_CD = NORMAL_CD;
              }
            } else if (PC.mats[BUILD_MAT] < COST) {
              UI.showPrompt("NOT ENOUGH " + BUILD_MAT.toUpperCase(), 0.8);
              BUILD_CD = 0.4;
            } else BUILD_CD = NORMAL_CD;
          }
        }
        var BUILT_VARIANT = null;
        function setBuildVariant(v) {
          BUILT_VARIANT = v;
        }
        function doEdit() {
          if (EDIT_CD > 0) return;
          EDIT_CD = 0.22;
          var t = findEditTarget(PC);
          if (!t || !t.rec) {
            UI.showPrompt("NOTHING TO EDIT", 0.7);
            return;
          }
          cycleEdit(t.rec);
          UI.showPrompt(
            "EDITED &middot; <b>" +
              (t.rec.variant || "wall").replace("wall", "").toUpperCase() +
              "</b>",
            0.7,
          );
        }
        function doRepair() {
          if (REPAIR_CD > 0) return;
          REPAIR_CD = 0.3;
          var t = findEditTarget(PC);
          if (!t || !t.rec) {
            UI.showPrompt("NOTHING TO REPAIR", 0.7);
            return;
          }
          if (!repairPiece(t.rec, PC)) UI.showPrompt("CANNOT REPAIR", 0.7);
        }

// === combat ===
/* ==== 40_combat.js ==== */
        /* ============================================================================
   40_COMBAT — arsenal, hitscan ballistics, projectiles & explosions,
   consumables, loot, down-but-not-out and elimination handling.
   ========================================================================== */

        var BOT_DMG = 0.55;
        var RARITY = [
          { name: "COMMON", c: 0x9aa3ad, m: 1.0 },
          { name: "UNCOMMON", c: 0x4fbf4f, m: 1.07 },
          { name: "RARE", c: 0x3f8fe0, m: 1.14 },
          { name: "EPIC", c: 0xa45ce6, m: 1.21 },
          { name: "LEGENDARY", c: 0xffc233, m: 1.3 },
        ];
        var AMMO_MAX = {
          light: 999,
          medium: 999,
          heavy: 999,
          shell: 999,
          rocket: 12,
        };

        var WEAPONS = {
          pickaxe: {
            id: "pickaxe",
            name: "PICKAXE",
            cls: "melee",
            dmg: 22,
            rate: 0.42,
            range: 3.8,
            spread: 0,
            mag: 0,
            reload: 0,
            ammo: null,
            head: 1.5,
            auto: true,
            icon: "\u26CF",
          },
          pistol: {
            id: "pistol",
            name: "PISTOL",
            cls: "pistol",
            dmg: 25,
            rate: 0.22,
            range: 80,
            spread: 0.25,
            mag: 16,
            reload: 1.1,
            ammo: "light",
            head: 2.0,
            auto: true,
            falloff: 0.72,
            icon: "\uD83D\uDD2B",
          },
          smg: {
            id: "smg",
            name: "SMG",
            cls: "smg",
            dmg: 18,
            rate: 0.08,
            range: 65,
            spread: 0.45,
            mag: 30,
            reload: 1.6,
            ammo: "light",
            head: 1.7,
            auto: true,
            falloff: 0.65,
            icon: "\uD83D\uDD2B",
          },
          tsmg: {
            id: "tsmg",
            name: "TACTICAL SMG",
            cls: "smg",
            dmg: 20,
            rate: 0.07,
            range: 72,
            spread: 0.35,
            mag: 30,
            reload: 1.7,
            ammo: "light",
            head: 1.75,
            auto: true,
            falloff: 0.7,
            icon: "\uD83D\uDD2B",
          },
          ar: {
            id: "ar",
            name: "ASSAULT RIFLE",
            cls: "ar",
            dmg: 33,
            rate: 0.14,
            range: 130,
            spread: 0.15,
            mag: 30,
            reload: 1.8,
            ammo: "medium",
            head: 2.0,
            auto: true,
            falloff: 0.8,
            icon: "\uD83D\uDD2B",
          },
          burst: {
            id: "burst",
            name: "BURST RIFLE",
            cls: "ar",
            dmg: 29,
            rate: 0.4,
            range: 140,
            spread: 0.12,
            mag: 30,
            reload: 1.9,
            ammo: "medium",
            head: 2.0,
            auto: true,
            burst: 3,
            burstGap: 0.07,
            falloff: 0.82,
            icon: "\uD83D\uDD2B",
          },
          handcannon: {
            id: "handcannon",
            name: "HAND CANNON",
            cls: "heavy",
            dmg: 65,
            rate: 0.6,
            range: 110,
            spread: 0.12,
            mag: 7,
            reload: 1.7,
            ammo: "heavy",
            head: 2.5,
            auto: true,
            falloff: 0.85,
            icon: "\uD83D\uDD2B",
          },
          shotgun: {
            id: "shotgun",
            name: "PUMP SHOTGUN",
            cls: "shotgun",
            dmg: 11.5,
            rate: 0.75,
            range: 28,
            spread: 1.8,
            mag: 5,
            reload: 1.9,
            ammo: "shell",
            head: 1.7,
            auto: true,
            pellets: 10,
            falloff: 0.4,
            icon: "\uD83D\uDD2B",
          },
          tacshotgun: {
            id: "tacshotgun",
            name: "TACTICAL SHOTGUN",
            cls: "shotgun",
            dmg: 8.8,
            rate: 0.45,
            range: 26,
            spread: 2.2,
            mag: 8,
            reload: 2.0,
            ammo: "shell",
            head: 1.6,
            auto: true,
            pellets: 8,
            falloff: 0.35,
            icon: "\uD83D\uDD2B",
          },
          sniper: {
            id: "sniper",
            name: "BOLT SNIPER",
            cls: "sniper",
            dmg: 115,
            rate: 1.2,
            range: 400,
            spread: 0.0,
            mag: 1,
            reload: 2.2,
            ammo: "heavy",
            head: 2.5,
            auto: false,
            falloff: 1.0,
            scope: 3.0,
            icon: "\uD83C\uDFAF",
          },
          rpg: {
            id: "rpg",
            name: "ROCKET LAUNCHER",
            cls: "launcher",
            dmg: 110,
            rate: 1.6,
            range: 260,
            spread: 0.3,
            mag: 1,
            reload: 3.4,
            ammo: "rocket",
            head: 1,
            auto: false,
            projectile: "rocket",
            speed: 70,
            radius: 6.4,
            icon: "\uD83D\uDE80",
          },
          grenade: {
            id: "grenade",
            name: "GRENADE",
            cls: "throw",
            dmg: 96,
            rate: 0.85,
            range: 60,
            spread: 0.6,
            mag: 3,
            reload: 0,
            ammo: null,
            head: 1,
            auto: false,
            projectile: "nade",
            speed: 26,
            radius: 7.0,
            fuse: 3.0,
            icon: "\uD83D\uDCA3",
          },
        };
        /* Grip class per weapon — which hold pose the animation rig uses. Keeping it
   in one table means adding a weapon only needs a line here. */
        var HOLD_CLASS = {
          pickaxe: "axe",
          pistol: "pistol",
          smg: "rifle",
          tsmg: "rifle",
          ar: "rifle",
          burst: "rifle",
          handcannon: "heavy",
          shotgun: "rifle",
          tacshotgun: "rifle",
          sniper: "sniper",
          rpg: "launcher",
          grenade: "throw",
        };
        for (var _hw in WEAPONS) WEAPONS[_hw].hold = HOLD_CLASS[_hw] || "rifle";

        var LOOT_WEAPONS = [
          "pistol",
          "smg",
          "tsmg",
          "ar",
          "burst",
          "handcannon",
          "shotgun",
          "tacshotgun",
          "sniper",
        ];
        var RARE_WEAPONS = [
          "tsmg",
          "burst",
          "handcannon",
          "tacshotgun",
          "sniper",
          "rpg",
        ];
        var HEALS = {
          band: {
            name: "BANDAGE",
            hp: 15,
            shield: 0,
            time: 3.2,
            cap: "hp75",
            icon: "\uD83E\uDE79",
          },
          mini: {
            name: "MINI SHIELD",
            hp: 0,
            shield: 25,
            time: 2.0,
            cap: "sh50",
            icon: "\uD83E\uDDEA",
          },
          med: {
            name: "MEDKIT",
            hp: 100,
            shield: 0,
            time: 8.0,
            cap: "hp100",
            icon: "\uD83E\uDE79",
          },
          pot: {
            name: "SHIELD POTION",
            hp: 0,
            shield: 50,
            time: 4.6,
            cap: "sh100",
            icon: "\uD83E\uDDEA",
          },
        };

        /* ============================================================================
   Weapon models — rails, sights, mags, stocks, muzzle devices, scopes.
   ========================================================================== */
        var WMAT = null;
        function initWeaponMats() {
          if (WMAT) return;
          WMAT = {
            metal: new THREE.MeshStandardMaterial({
              color: col(0x2b3038),
              metalness: 0.86,
              roughness: 0.34,
            }),
            dark: new THREE.MeshStandardMaterial({
              color: col(0x14171c),
              metalness: 0.7,
              roughness: 0.5,
            }),
            grip: new THREE.MeshStandardMaterial({
              color: col(0x22262d),
              metalness: 0.3,
              roughness: 0.75,
            }),
            glass: new THREE.MeshStandardMaterial({
              color: col(0x9fd8ff),
              metalness: 0.4,
              roughness: 0.06,
              transparent: true,
              opacity: 0.6,
              emissive: col(0x1a4a6a),
              emissiveIntensity: 0.4,
            }),
          };
        }
        function makeWeaponModel(id, rarity) {
          initWeaponMats();
          var g = new THREE.Group();
          var metal = WMAT.metal,
            dark = WMAT.dark,
            grip = WMAT.grip,
            glass = WMAT.glass;
          var rc = RARITY[rarity || 0].c;
          var accent = new THREE.MeshStandardMaterial({
            color: col(rc),
            metalness: 0.6,
            roughness: 0.32,
            emissive: col(rc),
            emissiveIntensity: 0.3,
          });
          function box(w, h, d, x, y, z, m, rx, rz) {
            var b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || metal);
            b.position.set(x, y, z);
            if (rx) b.rotation.x = rx;
            if (rz) b.rotation.z = rz;
            b.castShadow = false;
            g.add(b);
            return b;
          }
          function cyl(r1, r2, h, x, y, z, m, rx, rz) {
            var c = new THREE.Mesh(
              new THREE.CylinderGeometry(r1, r2, h, 8),
              m || metal,
            );
            c.position.set(x, y, z);
            c.rotation.x = Math.PI / 2 + (rx || 0);
            if (rz) c.rotation.z = rz;
            c.castShadow = false;
            g.add(c);
            return c;
          }
          if (id === "pickaxe") {
            box(0.09, 0.09, 1.2, 0, 0, 0.26, dark);
            box(0.62, 0.075, 0.1, 0, 0.02, 0.88, metal);
            box(0.1, 0.26, 0.1, 0, 0.11, 0.88, accent);
            box(0.2, 0.05, 0.3, 0, -0.06, 0.02, grip);
          } else if (id === "pistol") {
            box(0.11, 0.17, 0.46, 0, 0, 0.17, metal);
            box(0.1, 0.21, 0.12, 0, -0.17, 0.02, grip, 0.16);
            box(0.06, 0.06, 0.22, 0, 0.04, 0.44, accent);
            box(0.03, 0.035, 0.2, 0, 0.11, 0.2, dark);
            cyl(0.03, 0.03, 0.09, 0, 0.03, 0.52, dark);
          } else if (id === "smg" || id === "tsmg") {
            box(0.13, 0.18, 0.62, 0, 0, 0.21, metal);
            box(0.09, 0.28, 0.11, 0, -0.21, 0.07, grip, 0.1);
            box(0.08, 0.08, 0.28, 0, 0.02, 0.63, accent);
            box(0.055, 0.09, 0.3, 0, 0.13, 0.05, dark);
            box(0.06, 0.2, 0.06, 0, -0.13, 0.33, dark);
            cyl(0.028, 0.028, 0.1, 0, 0.01, 0.72, dark);
            if (id === "tsmg") box(0.05, 0.05, 0.18, 0, 0.14, 0.62, dark);
          } else if (id === "ar" || id === "burst") {
            box(0.13, 0.19, 0.88, 0, 0, 0.31, metal);
            box(0.09, 0.29, 0.13, 0, -0.23, 0.1, grip, 0.12);
            box(0.09, 0.09, 0.44, 0, 0.01, 0.92, accent);
            box(0.1, 0.12, 0.24, 0, 0.14, 0.36, dark);
            box(0.11, 0.15, 0.32, 0, -0.02, -0.16, grip);
            box(0.03, 0.04, 0.3, 0, 0.11, 0.55, dark);
            cyl(0.028, 0.028, 0.12, 0, 0.01, 1.06, dark);
            if (id === "burst") box(0.05, 0.07, 0.1, 0, 0.15, 0.72, accent);
          } else if (id === "handcannon") {
            box(0.12, 0.2, 0.62, 0, 0, 0.24, metal);
            box(0.1, 0.24, 0.13, 0, -0.2, 0.04, grip, 0.18);
            box(0.07, 0.07, 0.34, 0, 0.05, 0.6, accent);
            box(0.04, 0.04, 0.24, 0, 0.13, 0.28, dark);
            cyl(0.036, 0.036, 0.12, 0, 0.04, 0.72, dark);
          } else if (id === "shotgun" || id === "tacshotgun") {
            box(0.15, 0.2, 0.98, 0, 0, 0.33, metal);
            box(0.12, 0.13, 0.52, 0, -0.11, 0.58, dark);
            box(0.09, 0.25, 0.13, 0, -0.21, 0.02, grip, 0.1);
            box(0.11, 0.16, 0.28, 0, -0.02, -0.22, grip);
            box(0.07, 0.07, 0.22, 0, 0.02, 0.98, accent);
            if (id === "tacshotgun") box(0.06, 0.06, 0.4, 0, 0.13, 0.5, dark);
          } else if (id === "sniper") {
            box(0.14, 0.18, 1.3, 0, 0, 0.47, metal);
            box(0.09, 0.09, 0.58, 0, 0.01, 1.34, accent);
            box(0.09, 0.27, 0.13, 0, -0.22, 0.17, grip, 0.1);
            box(0.11, 0.15, 0.42, 0, -0.01, -0.22, grip);
            box(0.09, 0.09, 0.36, 0, 0.16, 0.5, dark);
            box(0.11, 0.11, 0.42, 0, 0.2, 0.62, dark);
            cyl(0.055, 0.055, 0.42, 0, 0.2, 0.62, glass);
            box(0.075, 0.075, 0.14, 0, 0.2, 0.86, accent);
            box(0.05, 0.12, 0.05, 0, -0.13, 0.86, dark);
            cyl(0.032, 0.032, 0.16, 0, 0.01, 1.62, dark);
          } else if (id === "rpg") {
            var tube = new THREE.Mesh(
              new THREE.CylinderGeometry(0.11, 0.11, 1.5, 12),
              metal,
            );
            tube.rotation.x = Math.PI / 2;
            tube.position.set(0, 0, 0.42);
            g.add(tube);
            var wide = new THREE.Mesh(
              new THREE.CylinderGeometry(0.19, 0.11, 0.42, 12),
              metal,
            );
            wide.rotation.x = Math.PI / 2;
            wide.position.set(0, 0, 1.28);
            g.add(wide);
            box(0.09, 0.24, 0.12, 0, -0.19, 0.16, grip, 0.12);
            box(0.08, 0.16, 0.4, 0, 0.15, 0.34, dark);
            box(0.09, 0.1, 0.16, 0, 0.24, 0.5, accent);
            box(0.1, 0.12, 0.26, 0, -0.05, -0.24, grip);
          } else if (id === "grenade") {
            var b = new THREE.Mesh(
              new THREE.SphereGeometry(0.14, 10, 8),
              new THREE.MeshStandardMaterial({
                color: col(0x3f5a34),
                metalness: 0.4,
                roughness: 0.6,
              }),
            );
            b.position.set(0, 0, 0.2);
            g.add(b);
            box(0.05, 0.05, 0.14, 0, 0.13, 0.2, accent);
            box(0.06, 0.02, 0.06, 0, 0.2, 0.2, dark);
          }
          return g;
        }

        /* ============================================================================
   FX — tracers, sparks, muzzle flashes, shells, debris, smoke, explosions.
   ========================================================================== */
        var FX = {
          tracers: [],
          sparks: [],
          smoke: [],
          debris: [],
          shells: [],
          flashes: [],
          light: null,
          shake: 0,
          upd: 0,
        };
        function initFX() {
          var tg = new THREE.CylinderGeometry(0.028, 0.028, 1, 5, 1, true);
          tg.rotateX(Math.PI / 2);
          for (var i = 0; i < 56; i++) {
            var m = new THREE.Mesh(
              tg,
              new THREE.MeshBasicMaterial({
                color: 0xffe9a8,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
              }),
            );
            m.visible = false;
            m.frustumCulled = false;
            scene.add(m);
            FX.tracers.push({ m: m, life: 0, max: 0.055 });
          }
          for (var j = 0; j < 120; j++) {
            var s = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: TEX.glow,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                opacity: 0,
              }),
            );
            s.visible = false;
            scene.add(s);
            FX.sparks.push({
              s: s,
              life: 0,
              max: 1,
              vx: 0,
              vy: 0,
              vz: 0,
              size: 1,
            });
          }
          for (var k = 0; k < 72; k++) {
            var sm = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: TEX.smoke,
                transparent: true,
                depthWrite: false,
                opacity: 0,
              }),
            );
            sm.visible = false;
            scene.add(sm);
            FX.smoke.push({
              s: sm,
              life: 0,
              max: 1,
              vx: 0,
              vy: 0,
              vz: 0,
              size: 1,
              grow: 1,
            });
          }
          for (var f = 0; f < 8; f++) {
            var fl = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: TEX.flash,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                opacity: 0,
              }),
            );
            fl.visible = false;
            scene.add(fl);
            FX.flashes.push({ s: fl, life: 0 });
          }
          var dg = new THREE.BoxGeometry(0.16, 0.16, 0.16);
          var dm = new THREE.MeshStandardMaterial({ roughness: 0.85 });
          for (var d = 0; d < 90; d++) {
            var dm2 = dm.clone();
            var dm3 = new THREE.Mesh(dg, dm2);
            dm3.visible = false;
            dm3.castShadow = false;
            scene.add(dm3);
            FX.debris.push({
              m: dm3,
              life: 0,
              max: 1,
              vx: 0,
              vy: 0,
              vz: 0,
              rx: 0,
              ry: 0,
              rz: 0,
              s: 1,
            });
          }
          var sg = new THREE.CylinderGeometry(0.026, 0.026, 0.11, 6);
          sg.rotateZ(Math.PI / 2);
          var smm = new THREE.MeshStandardMaterial({
            color: col(0xd8b45a),
            metalness: 0.9,
            roughness: 0.3,
          });
          for (var sh = 0; sh < 40; sh++) {
            var shm = new THREE.Mesh(sg, smm);
            shm.visible = false;
            scene.add(shm);
            FX.shells.push({
              m: shm,
              life: 0,
              max: 1,
              vx: 0,
              vy: 0,
              vz: 0,
              rx: 0,
              ry: 0,
              rz: 0,
            });
          }
          FX.light = new THREE.PointLight(0xffcf80, 0, 22, 2);
          FX.light.visible = false;
          scene.add(FX.light);
        }
        function nearPlayer(x, z, d) {
          if (!PC) return true;
          return dist2(x, z, PC.x, PC.z) < (d || 90);
        }
        function fxTracer(from, to, color) {
          var t = null;
          for (var i = 0; i < FX.tracers.length; i++)
            if (FX.tracers[i].life <= 0) {
              t = FX.tracers[i];
              break;
            }
          if (!t) return;
          var dx = to.x - from.x,
            dy = to.y - from.y,
            dz = to.z - from.z;
          var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          t.m.position.set(
            (from.x + to.x) / 2,
            (from.y + to.y) / 2,
            (from.z + to.z) / 2,
          );
          t.m.lookAt(to.x, to.y, to.z);
          t.m.scale.set(1, 1, Math.max(0.3, len));
          t.m.material.color.setHex(color || 0xffe9a8);
          t.m.material.opacity = 0.92;
          t.m.visible = true;
          t.life = 0.055;
        }
        function fxSpark(x, y, z, color, n, spread, size) {
          for (var i = 0; i < n; i++) {
            var p = null;
            for (var k = 0; k < FX.sparks.length; k++)
              if (FX.sparks[k].life <= 0) {
                p = FX.sparks[k];
                break;
              }
            if (!p) return;
            p.s.position.set(x, y, z);
            p.vx = rnd(-spread, spread);
            p.vy = rnd(0.5, spread * 1.4);
            p.vz = rnd(-spread, spread);
            p.size = size || 0.4;
            p.s.material.color.setHex(color);
            p.s.material.opacity = 1;
            p.s.scale.setScalar(p.size);
            p.s.visible = true;
            p.max = p.life = rnd(0.2, 0.5);
          }
        }
        function fxSmoke(x, y, z, n, size, speed, life) {
          for (var i = 0; i < n; i++) {
            var p = null;
            for (var k = 0; k < FX.smoke.length; k++)
              if (FX.smoke[k].life <= 0) {
                p = FX.smoke[k];
                break;
              }
            if (!p) return;
            p.s.position.set(
              x + rnd(-0.6, 0.6),
              y + rnd(-0.4, 0.6),
              z + rnd(-0.6, 0.6),
            );
            p.vx = rnd(-1, 1) * speed;
            p.vy = rnd(0.4, 1.6) * speed;
            p.vz = rnd(-1, 1) * speed;
            p.size = size * rnd(0.8, 1.4);
            p.grow = rnd(1.2, 2.4);
            p.s.material.opacity = 0.55;
            p.s.scale.setScalar(p.size);
            p.s.visible = true;
            p.max = p.life = life || rnd(0.6, 1.3);
          }
        }
        function fxDebris(x, y, z, kind, n) {
          var c =
            kind === "stone"
              ? 0x9a9aa6
              : kind === "metal"
                ? 0x8f9aa6
                : 0xa8703c;
          for (var i = 0; i < n; i++) {
            var p = null;
            for (var k = 0; k < FX.debris.length; k++)
              if (FX.debris[k].life <= 0) {
                p = FX.debris[k];
                break;
              }
            if (!p) return;
            p.m.material.color = col(c);
            p.m.position.set(
              x + rnd(-0.5, 0.5),
              y + rnd(-0.5, 0.5),
              z + rnd(-0.5, 0.5),
            );
            p.vx = rnd(-4, 4);
            p.vy = rnd(1, 6);
            p.vz = rnd(-4, 4);
            p.rx = rnd(-8, 8);
            p.ry = rnd(-8, 8);
            p.rz = rnd(-8, 8);
            p.s = rnd(0.6, 1.6);
            p.m.scale.setScalar(p.s);
            p.m.visible = true;
            p.max = p.life = rnd(0.7, 1.5);
          }
        }
        function fxShell(x, y, z, dirx, diry, dirz) {
          var p = null;
          for (var k = 0; k < FX.shells.length; k++)
            if (FX.shells[k].life <= 0) {
              p = FX.shells[k];
              break;
            }
          if (!p) return;
          p.m.position.set(x, y, z);
          var rx = -dirz,
            rz = dirx,
            l = Math.sqrt(rx * rx + rz * rz) || 1;
          p.vx = (rx / l) * rnd(2, 4) + dirx * 0.5;
          p.vy = rnd(2.4, 4);
          p.vz = (rz / l) * rnd(2, 4) + dirz * 0.5;
          p.rx = rnd(-14, 14);
          p.ry = rnd(-14, 14);
          p.rz = rnd(-14, 14);
          p.m.visible = true;
          p.max = p.life = rnd(0.9, 1.7);
        }
        function fxMuzzle(x, y, z, scale) {
          var f = null;
          for (var i = 0; i < FX.flashes.length; i++)
            if (FX.flashes[i].life <= 0) {
              f = FX.flashes[i];
              break;
            }
          if (!f) return;
          f.s.position.set(x, y, z);
          f.s.scale.setScalar(scale || 1.5);
          f.s.material.opacity = 1;
          f.s.visible = true;
          f.life = 0.045;
          FX.light.position.set(x, y, z);
          FX.light.intensity = 7.5;
          FX.light.distance = 18;
          FX.light.visible = true;
        }
        function fxExplosion(x, y, z, radius) {
          fxSpark(x, y, z, 0xffc04d, 22, 8, 0.9);
          fxSpark(x, y, z, 0xff6a1a, 14, 6, 1.3);
          fxSmoke(x, y + 0.6, z, 12, 2.6, 3.2, 1.8);
          fxDebris(x, y, z, "stone", 16);
          addDecal(
            x,
            Math.max(terrainHeightAt(x, z), y - 1.2),
            z,
            0,
            1,
            0,
            radius * 1.1,
            "scorch",
            26,
          );
          FX.shake = Math.min(1.1, FX.shake + 0.7);
          Sfx.explosion();
        }
        function updateFX(dt) {
          var i;
          for (i = 0; i < FX.tracers.length; i++) {
            var t = FX.tracers[i];
            if (t.life > 0) {
              t.life -= dt;
              t.m.material.opacity = Math.max(0, t.life / t.max) * 0.92;
              if (t.life <= 0) t.m.visible = false;
            }
          }
          for (i = 0; i < FX.sparks.length; i++) {
            var p = FX.sparks[i];
            if (p.life > 0) {
              p.life -= dt;
              p.s.position.x += p.vx * dt;
              p.s.position.y += p.vy * dt;
              p.s.position.z += p.vz * dt;
              p.vy -= 14 * dt;
              var f = Math.max(0, p.life / p.max);
              p.s.material.opacity = f;
              p.s.scale.setScalar(p.size * (0.5 + f * 0.7));
              if (p.life <= 0) p.s.visible = false;
            }
          }
          for (i = 0; i < FX.smoke.length; i++) {
            var sm = FX.smoke[i];
            if (sm.life > 0) {
              sm.life -= dt;
              sm.s.position.x += sm.vx * dt;
              sm.s.position.y += sm.vy * dt;
              sm.s.position.z += sm.vz * dt;
              sm.vy *= Math.exp(-1.6 * dt);
              sm.vx *= Math.exp(-1.9 * dt);
              sm.vz *= Math.exp(-1.9 * dt);
              var fs = Math.max(0, sm.life / sm.max);
              sm.s.material.opacity = fs * 0.5;
              sm.size += sm.grow * dt;
              sm.s.scale.setScalar(sm.size);
              if (sm.life <= 0) sm.s.visible = false;
            }
          }
          for (i = 0; i < FX.debris.length; i++) {
            var d = FX.debris[i];
            if (d.life > 0) {
              d.life -= dt;
              d.m.position.x += d.vx * dt;
              d.m.position.y += d.vy * dt;
              d.m.position.z += d.vz * dt;
              d.vy -= 22 * dt;
              var g = terrainHeightAt(d.m.position.x, d.m.position.z);
              if (d.m.position.y < g + 0.06) {
                d.m.position.y = g + 0.06;
                d.vy *= -0.32;
                d.vx *= 0.6;
                d.vz *= 0.6;
              }
              d.m.rotation.x += d.rx * dt;
              d.m.rotation.y += d.ry * dt;
              d.m.rotation.z += d.rz * dt;
              if (d.life <= 0) d.m.visible = false;
            }
          }
          for (i = 0; i < FX.shells.length; i++) {
            var sh = FX.shells[i];
            if (sh.life > 0) {
              sh.life -= dt;
              sh.m.position.x += sh.vx * dt;
              sh.m.position.y += sh.vy * dt;
              sh.m.position.z += sh.vz * dt;
              sh.vy -= 20 * dt;
              var g2 = terrainHeightAt(sh.m.position.x, sh.m.position.z);
              if (sh.m.position.y < g2 + 0.04) {
                sh.m.position.y = g2 + 0.04;
                sh.vy *= -0.3;
                sh.vx *= 0.7;
                sh.vz *= 0.7;
              }
              sh.m.rotation.x += sh.rx * dt;
              sh.m.rotation.y += sh.ry * dt;
              sh.m.rotation.z += sh.rz * dt;
              if (sh.life <= 0) sh.m.visible = false;
            }
          }
          for (i = 0; i < FX.flashes.length; i++) {
            var fl = FX.flashes[i];
            if (fl.life > 0) {
              fl.life -= dt;
              fl.s.material.opacity = Math.max(0, fl.life / 0.045);
              if (fl.life <= 0) fl.s.visible = false;
            }
          }
          if (FX.light.intensity > 0) {
            FX.light.intensity = Math.max(0, FX.light.intensity - dt * 90);
            if (FX.light.intensity <= 0) FX.light.visible = false;
          }
          if (FX.shake > 0) FX.shake = Math.max(0, FX.shake - dt * 2.6);
        }

        /* ============================================================================
   Projectiles
   ========================================================================== */
        var PROJECTILES = [];
        function spawnProjectile(owner, type, x, y, z, vx, vy, vz, def) {
          PROJECTILES.push({
            owner: owner,
            type: type,
            x: x,
            y: y,
            z: z,
            vx: vx,
            vy: vy,
            vz: vz,
            fuse: def.fuse || 0,
            life: def.projectile === "rocket" ? 7 : 6,
            radius: def.radius || 5,
            dmg: def.dmg || 90,
            def: def,
            spin: 0,
          });
        }
        function updateProjectiles(dt) {
          for (var i = PROJECTILES.length - 1; i >= 0; i--) {
            var p = PROJECTILES[i];
            p.life -= dt;
            var steps = Math.max(
              1,
              Math.ceil(
                (Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) * dt) / 0.6,
              ),
            );
            var sdt = dt / steps,
              exploded = false;
            for (var s = 0; s < steps && !exploded; s++) {
              if (p.type === "nade") p.vy += CFG.GRAV * 0.72 * sdt;
              var dx = p.vx * sdt,
                dy = p.vy * sdt,
                dz = p.vz * sdt;
              var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
              var res = raycastWorld(
                { x: p.x, y: p.y, z: p.z },
                dx / len,
                dy / len,
                dz / len,
                len,
              );
              if (res.t < len) {
                var hx = p.x + (dx / len) * res.t,
                  hy = p.y + (dy / len) * res.t,
                  hz = p.z + (dz / len) * res.t;
                if (p.type === "nade" && res.t > 0.01) {
                  /* bounce */
                  p.x = hx + p.nx * 0.08;
                  p.y = hy + p.ny * 0.08;
                  p.z = hz + p.nz * 0.08;
                  var dot = p.vx * res.nx + p.vy * res.ny + p.vz * res.nz;
                  p.vx = (p.vx - 2 * dot * res.nx) * 0.42;
                  p.vy = (p.vy - 2 * dot * res.ny) * 0.42;
                  p.vz = (p.vz - 2 * dot * res.nz) * 0.42;
                  if (Math.abs(p.vy) < 1.4 && res.ny > 0.5) p.vy = 0;
                  if (res.obj && res.obj.build)
                    damageBuild(res.obj.build, 18, p.owner);
                  Sfx.step("metal");
                  if (len - res.t < 0.05) {
                    p.x += dx;
                    p.y += dy;
                    p.z += dz;
                  }
                } else {
                  exploded = true;
                }
              } else {
                p.x += dx;
                p.y += dy;
                p.z += dz;
              }
            }
            if (p.type === "nade") {
              p.fuse -= dt;
              p.spin += dt * 6;
              if (p.fuse <= 0) exploded = true;
            }
            if (exploded || p.life <= 0 || p.y < -40) {
              explode(p.x, p.y, p.z, p.radius, p.dmg, p.owner);
              PROJECTILES.splice(i, 1);
            }
          }
        }
        function explode(x, y, z, radius, dmg, owner) {
          fxExplosion(x, y, z, radius);
          var r2 = radius * radius;
          var dealt = 0;
          for (var i = 0; i < CHARS.length; i++) {
            var c = CHARS[i];
            if (!c.alive || c.onBus) continue;
            var d = dist2(c.x, c.z, x, z);
            if (d > radius) continue;
            var dy = c.y + 0.9 - y;
            var dd = Math.sqrt(d * d + dy * dy);
            if (dd > radius) continue;
            var f = 1 - dd / radius;
            var amount = dmg * f * f * (c === owner ? 0.35 : 1);
            if (c === owner && dd > radius * 0.55) continue;
            damageChar(c, amount, owner, false, {
              name: "EXPLOSION",
              cls: "launcher",
            });
            if (c !== owner) dealt += amount;
            if (c.ai) {
              c.ai.underFire = 3;
            }
          }
          if (owner && owner.damageDealt !== undefined && dealt > 0)
            owner.damageDealt += dealt;
          for (var k in BUILDS) {
            if (!BUILDS.hasOwnProperty(k)) continue;
            var b = BUILDS[k];
            if (b.dead) continue;
            var bd = dist2(b.x, b.z, x, z);
            if (bd < radius + 1.6) {
              var bf = 1 - bd / (radius + 1.6);
              damageBuild(b, 220 * bf * bf, owner);
            }
          }
          for (var j = PROJECTILES.length - 1; j >= 0; j--) {
            var p = PROJECTILES[j];
            if (
              dist2(p.x, p.z, x, z) < radius * 0.8 &&
              Math.abs(p.y - y) < radius
            ) {
              p.fuse = 0;
              p.life = 0;
            }
          }
        }

        /* ============================================================================
   Character hit tests
   ========================================================================== */
        function charBox(ch) {
          if (ch.knocked)
            return {
              minX: ch.x - 0.5,
              maxX: ch.x + 0.5,
              minY: ch.y,
              maxY: ch.y + 0.85,
              minZ: ch.z - 0.5,
              maxZ: ch.z + 0.5,
            };
          return {
            minX: ch.x - 0.42,
            maxX: ch.x + 0.42,
            minY: ch.y,
            maxY: ch.y + 1.86,
            minZ: ch.z - 0.42,
            maxZ: ch.z + 0.42,
          };
        }
        function rayHitChar(o, dx, dy, dz, ch, maxT) {
          var b = charBox(ch);
          var t = rayAABB(o, { x: 0 }, dx, dy, dz, b);
          if (t < 0 || t > maxT) return -1;
          return t;
        }

        /* ============================================================================
   Firing
   ========================================================================== */
        function weaponOf(ch) {
          return ch.slots[ch.slot] || null;
        }
        function muzzlePos(ch, out) {
          out.x = ch.x + Math.sin(ch.yaw) * 0.6;
          out.y = ch.y + (ch.aiming ? 1.42 : 1.35);
          out.z = ch.z + Math.cos(ch.yaw) * 0.6;
          return out;
        }
        function fireWeapon(ch, aimX, aimY, aimZ, isPlayerShot) {
          var w = ch.slots[ch.slot];
          if (!w) return false;
          var def = WEAPONS[w.id];
          if (ch.fireCd > 0) return false;
          if (ch.reloading) return false;
          if (ch.using) return false;
          if (def.mag > 0 && w.ammoInMag <= 0) return false;
          ch.fireCd = def.rate;
          if (def.mag > 0) w.ammoInMag--;
          ch.lastShot = 0.25;
          ch.recoil = Math.min(
            1,
            ch.recoil +
              (def.cls === "sniper"
                ? 1
                : def.cls === "launcher"
                  ? 0.9
                  : def.cls === "shotgun"
                    ? 0.8
                    : 0.32),
          );
          ch.bloom = Math.min(
            1,
            (ch.bloom || 0) +
              (def.cls === "smg"
                ? 0.075
                : def.cls === "ar"
                  ? 0.055
                  : def.cls === "shotgun"
                    ? 0.2
                    : 0.12),
          );

          var mp = muzzlePos(ch, { x: 0, y: 0, z: 0 });
          var dx = aimX - mp.x,
            dy = aimY - mp.y,
            dz = aimZ - mp.z;
          var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          dx /= len;
          dy /= len;
          dz /= len;

          var visible = ch.isPlayer || nearPlayer(ch.x, ch.z, 85);
          if (visible) {
            fxMuzzle(
              mp.x,
              mp.y,
              mp.z,
              def.cls === "launcher"
                ? 2.6
                : def.cls === "shotgun"
                  ? 2.1
                  : def.cls === "sniper"
                    ? 2.3
                    : 1.4,
            );
            if (def.cls !== "melee" && def.cls !== "throw")
              fxSmoke(mp.x, mp.y, mp.z, 1, 0.5, 0.5, 0.45);
          }
          if (def.projectile) {
            var sp = def.speed;
            spawnProjectile(
              ch,
              def.projectile,
              mp.x + dx * 0.6,
              mp.y + dy * 0.6,
              mp.z + dz * 0.6,
              dx * sp,
              dy * sp + (def.projectile === "nade" ? 3.2 : 0),
              dz * sp,
              def,
            );
            if (ch.isPlayer)
              Sfx.shot(def.cls === "launcher" ? "launcher" : "heavy", 0);
            else Sfx.shot("launcher", dist2(ch.x, ch.z, PC.x, PC.z));
            if (ch.isPlayer) {
              PLAYER_STATS.shots++;
              UI.kick(def.cls);
              if (w.ammoInMag <= 0) startReload(ch);
            }
            return true;
          }

          var pellets = def.pellets || 1;
          var spreadRad =
            ((def.spread * Math.PI) / 180) *
            (ch.isPlayer ? ch.aimSpread || 1 : 1.6) *
            (1 + (ch.bloom || 0) * 0.85);
          var hitAny = false,
            hitChar = null,
            hitHead = false,
            dmgTotal = 0,
            hitKilled = false;

          for (var p = 0; p < pellets; p++) {
            var sx = dx + (srnd() - 0.5) * spreadRad * 2;
            var sy = dy + (srnd() - 0.5) * spreadRad * 2;
            var sz = dz + (srnd() - 0.5) * spreadRad * 2;
            var sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
            sx /= sl;
            sy /= sl;
            sz /= sl;
            var maxT = def.range;
            var res = raycastWorld(
              { x: mp.x, y: mp.y, z: mp.z },
              sx,
              sy,
              sz,
              maxT,
            );
            var wallT = res.t;
            var bestCh = null,
              bestT = wallT;
            for (var c = 0; c < CHARS.length; c++) {
              var o = CHARS[c];
              if (o === ch || !o.alive || o.onBus) continue;
              if (
                o.team !== undefined &&
                ch.team !== undefined &&
                o.team === ch.team
              )
                continue;
              var t = rayHitChar(
                { x: mp.x, y: mp.y, z: mp.z },
                sx,
                sy,
                sz,
                o,
                bestT,
              );
              if (t >= 0 && t < bestT) {
                bestT = t;
                bestCh = o;
              }
            }
            if (bestCh) {
              var hy = mp.y + sy * bestT;
              var head = !bestCh.knocked && hy > bestCh.y + 1.3;
              var d = def.dmg * RARITY[w.rarity].m * (head ? def.head : 1);
              if (def.falloff)
                d *= lerp(1, def.falloff, clamp(bestT / def.range, 0, 1));
              var wasAlive = bestCh.alive;
              damageChar(bestCh, d, ch, head, def);
              if (bestCh.knocked || !bestCh.alive) hitKilled = true;
              dmgTotal += d;
              fxSpark(
                mp.x + sx * bestT,
                mp.y + sy * bestT,
                mp.z + sz * bestT,
                0xff4d4d,
                4,
                2.2,
                0.28,
              );
              if (!hitAny || head) {
                hitChar = bestCh;
                hitHead = head;
              }
              hitAny = true;
            } else if (wallT < def.range) {
              var hx = mp.x + sx * wallT,
                hy2 = mp.y + sy * wallT,
                hz = mp.z + sz * wallT;
              if (res.kind === "box" && res.obj) {
                var ob = res.obj;
                if (ob.build)
                  damageBuild(ob.build, def.dmg * (def.pellets ? 1 : 0.9), ch);
                else if (ob.harv && def.cls === "melee")
                  harvestStrike(ob, ch, hx, hy2, hz, def);
              }
              var dc = res.kind === "terrain" ? 0xd8c48c : 0xbfbfbf;
              fxSpark(hx, hy2, hz, dc, 3, 1.4, 0.22);
              if (nearPlayer(hx, hz, 60))
                addDecal(
                  hx,
                  hy2,
                  hz,
                  res.nx,
                  res.ny,
                  res.nz,
                  rnd(0.24, 0.4),
                  "hole",
                  16,
                );
            }
            if (isPlayerShot !== false || p === 0) {
              var showT =
                ch.isPlayer || (p === 0 && nearPlayer(ch.x, ch.z, 80));
              if (showT)
                fxTracer(
                  mp,
                  {
                    x: mp.x + sx * Math.min(bestT, def.range),
                    y: mp.y + sy * Math.min(bestT, def.range),
                    z: mp.z + sz * Math.min(bestT, def.range),
                  },
                  def.cls === "sniper" ? 0x9fd8ff : 0xffe9a8,
                );
            }
          }
          if (def.cls === "melee") {
            Sfx.swing();
            ch.swingT = 0;
            ch.swingDur = def.rate;
          } else {
            Sfx.shot(def.cls, ch.isPlayer ? 0 : dist2(ch.x, ch.z, PC.x, PC.z));
            if (visible) fxShell(mp.x, mp.y - 0.1, mp.z, dx, dy, dz);
          }
          if (ch.isPlayer) {
            if (def.cls !== "melee") PLAYER_STATS.shots++;
            if (hitAny) PLAYER_STATS.hits++;
            UI.hitmark(hitAny, hitHead, hitChar, hitKilled);
            UI.kick(def.cls);
            if (dmgTotal > 0) ch.damageDealt = (ch.damageDealt || 0) + dmgTotal;
            if (def.mag > 0 && w.ammoInMag <= 0) startReload(ch);
          }
          return true;
        }
        function startReload(ch) {
          var w = ch.slots[ch.slot];
          if (!w) return;
          var def = WEAPONS[w.id];
          if (def.mag <= 0 || ch.reloading || def.reload <= 0) return;
          if (w.ammoInMag >= def.mag) return;
          if (def.ammo && ch.ammo[def.ammo] <= 0) return;
          if (def.projectile === "nade") return;
          ch.reloading = { t: 0, total: def.reload };
          if (ch.isPlayer) Sfx.reload();
        }
        /* Auto-reload: as soon as the held weapon's magazine runs dry and there is
   reserve ammo, start the reload without waiting for R. startReload() already
   no-ops when the mag is full, a reload is in flight, or the reserve is empty,
   so this is safe to call every frame. The short emptyT gate lets the dry-fire
   click land before the animation starts, which reads much better than an
   instant snap into reloading. */
        function updateAutoReload(ch, dt) {
          if (ch.reloading || ch.knocked || !ch.alive) return;
          var w = ch.slots[ch.slot];
          if (!w) return;
          var def = WEAPONS[w.id];
          if (def.mag <= 0 || def.reload <= 0) return;
          if (w.ammoInMag > 0) {
            ch.emptyT = 0;
            return;
          }
          ch.emptyT = (ch.emptyT || 0) + dt;
          if (ch.emptyT < 0.14) return;
          startReload(ch);
        }
        function finishReload(ch) {
          var w = ch.slots[ch.slot];
          if (!w) {
            ch.reloading = null;
            return;
          }
          var def = WEAPONS[w.id];
          var need = def.mag - w.ammoInMag;
          var have = def.ammo ? Math.min(need, ch.ammo[def.ammo]) : need;
          w.ammoInMag += have;
          if (def.ammo) ch.ammo[def.ammo] -= have;
          ch.reloading = null;
          if (ch.isPlayer) Sfx.reloadDone();
        }

        /* ============================================================================
   Consumables
   ========================================================================== */
        function bestHeal(ch) {
          var h = ch.heals;
          if (!h) return null;
          if (ch.health < 100 && h.med > 0) return "med";
          if (ch.shield <= 50 && h.mini > 0) return "mini";
          if (ch.health < 100 && h.pot > 0) return "pot";
          if (ch.health < 100 && h.band > 0) return "band";
          if (ch.shield < 100 && h.pot > 0) return "pot";
          if (ch.shield < 100 && h.mini > 0) return "mini";
          return null;
        }
        function useHeal(ch) {
          if (ch.using || ch.reloading || ch.knocked) return false;
          var key = bestHeal(ch);
          if (!key) return false;
          var def = HEALS[key];
          if (def.cap === "hp75" && ch.health >= 75) return false;
          if (def.cap === "sh50" && ch.shield >= 50) return false;
          ch.heals[key]--;
          ch.using = { t: 0, total: def.time, kind: key };
          if (ch.isPlayer) Sfx.reload();
          return true;
        }
        function finishHeal(ch) {
          var u = ch.using;
          if (!u) return;
          ch.using = null;
          var def = HEALS[u.kind];
          if (def.hp)
            ch.health = Math.min(
              def.cap === "hp75" ? 75 : 100,
              ch.health + def.hp,
            );
          if (def.shield)
            ch.shield = Math.min(
              def.cap === "sh50" ? 50 : 100,
              ch.shield + def.shield,
            );
          if (ch.isPlayer) Sfx.heal();
        }
        function updateUsing(ch, dt) {
          if (!ch.using) return;
          ch.using.t += dt;
          if (ch.using.t >= ch.using.total) finishHeal(ch);
        }

        /* ============================================================================
   Damage, knock-down, elimination
   ========================================================================== */
        function teamOf(ch) {
          return ch.team === undefined ? ch.id : ch.team;
        }
        function teammates(ch) {
          var out = [];
          for (var i = 0; i < CHARS.length; i++) {
            var o = CHARS[i];
            if (
              o !== ch &&
              o.team !== undefined &&
              ch.team !== undefined &&
              o.team === ch.team
            )
              out.push(o);
          }
          return out;
        }
        function hasLivingTeammate(ch) {
          var t = teammates(ch);
          for (var i = 0; i < t.length; i++) if (!t[i].knocked) return true;
          return false;
        }
        function damageChar(tgt, dmg, src, head, def) {
          if (!tgt.alive || tgt.knocked) return;
          if (
            src &&
            src.team !== undefined &&
            tgt.team !== undefined &&
            src.team === tgt.team &&
            src !== tgt
          )
            return;
          if (src && src.isBot) dmg *= tgt.isPlayer ? BOT_DMG : 1.0;
          var raw = dmg;
          if (src && src.isPlayer)
            src.damageDealt = (src.damageDealt || 0) + raw;
          var s = Math.min(tgt.shield, dmg);
          tgt.shield -= s;
          dmg -= s;
          tgt.health -= dmg;
          tgt.lastHitBy = src;
          tgt.lastHitTime = GAMETIME;
          tgt.hurtFlash = 0.3;
          if (tgt.ai) {
            tgt.ai.underFire = 3.0;
            tgt.ai.think = 0;
            tgt.ai.lastHitFrom = src;
          }
          if (src && src !== tgt) tgt.lastAttacker = src;
          if (tgt.isPlayer) {
            UI.hitFlash(head ? 0.9 : clamp(raw / 60, 0.25, 0.85));
            if (src) UI.damageDir(src.x, src.z);
            if (s > 0 && s >= raw * 0.98) Sfx.shieldHit();
            else Sfx.hurt();
          } else if (src === PC) {
            UI.damageNumber(
              tgt.x,
              tgt.y + 1.9,
              tgt.z,
              Math.round(raw),
              head,
              s > 0,
            );
          }
          if (tgt.health <= 0) tryKnockOrKill(tgt, src);
        }
        function healChar(ch, amount) {
          ch.health = Math.min(100, ch.health + amount);
        }
        function addShield(ch, amount) {
          ch.shield = Math.min(100, ch.shield + amount);
        }

        function tryKnockOrKill(tgt, src) {
          if (MODE !== "solo" && !tgt.knocked && hasLivingTeammate(tgt)) {
            knockDown(tgt, src);
          } else {
            eliminate(tgt, src);
          }
        }
        function knockDown(tgt, src) {
          tgt.knocked = true;
          tgt.health = 0;
          tgt.bleed = 60;
          tgt.reviveProg = 0;
          tgt.using = null;
          tgt.reloading = null;
          tgt.fireCd = 0.4;
          Sfx.knock();
          UI.killFeed(
            src ? src.name : "THE STORM",
            tgt.name,
            src === PC,
            tgt.isPlayer,
            true,
            "knocked",
          );
          if (tgt.isPlayer) {
            UI.banner(
              "YOU ARE DOWN",
              "CRAWL TO SAFETY &middot; TEAMMATES CAN REVIVE YOU",
              3.0,
            );
            UI.showRevive(true);
          }
          if (tgt.ai) {
            tgt.ai.mode = "down";
          }
          checkMatchEnd();
        }
        function reviveChar(tgt, by) {
          if (!tgt.knocked) return false;
          tgt.knocked = false;
          tgt.health = 30;
          tgt.shield = 0;
          tgt.bleed = 0;
          tgt.reviveProg = 0;
          if (tgt.ai) {
            tgt.ai.mode = "idle";
            tgt.ai.think = 0;
          }
          if (tgt.isPlayer) UI.showRevive(false);
          Sfx.revive();
          UI.killFeed(
            by ? by.name : "SQUAD",
            tgt.name,
            by === PC,
            tgt.isPlayer,
            true,
            "revived",
          );
          return true;
        }
        function updateKnocked(ch, dt) {
          if (!ch.knocked) return;
          ch.bleed -= dt;
          if (ch.isPlayer) {
            var r = findReviver();
            if (r) {
              ch.reviveProg = Math.min(1, ch.reviveProg + dt / 5.0);
              UI.setReviveBar(ch.reviveProg);
              if (ch.reviveProg >= 1) reviveChar(ch, r);
            } else {
              ch.reviveProg = Math.max(0, ch.reviveProg - dt * 0.35);
              UI.setReviveBar(ch.reviveProg);
            }
          }
          if (ch.bleed <= 0) eliminate(ch, ch.lastAttacker || null);
        }
        function findReviver() {
          for (var i = 0; i < CHARS.length; i++) {
            var c = CHARS[i];
            if (!c.alive || c.isPlayer || c.knocked) continue;
            if (
              c.team === undefined ||
              PC.team === undefined ||
              c.team !== PC.team
            )
              continue;
            if (dist2(c.x, c.z, PC.x, PC.z) < 2.6 && Math.abs(c.y - PC.y) < 3)
              return c;
          }
          return null;
        }
        function eliminate(tgt, killer) {
          if (!tgt.alive) return;
          tgt.alive = false;
          tgt.knocked = false;
          tgt.health = 0;
          tgt.using = null;
          /* Do NOT hide the mesh here: animateDeath() topples the body over ~0.75s
     and only hides it once it has settled, so eliminations read as a fall
     instead of the character blinking out of existence. */
          if (tgt.mesh) {
            tgt.deathT = 0;
            tgt.mesh.visible = !tgt.onBus;
          }
          if (tgt.buildGroup) {
            tgt.buildGroup.visible = false;
          }
          if (tgt.vehicle) {
            exitVehicle(tgt, true);
          }
          fxSpark(tgt.x, tgt.y + 1.0, tgt.z, 0xffd76a, 12, 3.2, 0.5);
          for (var i = 1; i < 6; i++) {
            var w = tgt.slots[i];
            if (w)
              spawnLoot(
                tgt.x + rnd(-1.2, 1.2),
                tgt.y + 0.4,
                tgt.z + rnd(-1.2, 1.2),
                {
                  kind: "weapon",
                  id: w.id,
                  rarity: w.rarity,
                  mag: w.ammoInMag,
                },
              );
          }
          if (tgt.ammo.medium > 0)
            spawnLoot(
              tgt.x + rnd(-1.5, 1.5),
              tgt.y + 0.4,
              tgt.z + rnd(-1.5, 1.5),
              {
                kind: "ammo",
                ammo: "medium",
                count: Math.min(60, tgt.ammo.medium),
              },
            );
          if (tgt.ammo.light > 0)
            spawnLoot(
              tgt.x + rnd(-1.5, 1.5),
              tgt.y + 0.4,
              tgt.z + rnd(-1.5, 1.5),
              {
                kind: "ammo",
                ammo: "light",
                count: Math.min(60, tgt.ammo.light),
              },
            );
          if (tgt.mats.wood > 0)
            spawnLoot(
              tgt.x + rnd(-1.5, 1.5),
              tgt.y + 0.4,
              tgt.z + rnd(-1.5, 1.5),
              { kind: "mat", mat: "wood", count: Math.min(120, tgt.mats.wood) },
            );
          spawnLoot(tgt.x + rnd(-1, 1), tgt.y + 0.4, tgt.z + rnd(-1, 1), {
            kind: "shield",
            count: 1,
          });
          if (chance(0.4))
            spawnLoot(
              tgt.x + rnd(-1.2, 1.2),
              tgt.y + 0.4,
              tgt.z + rnd(-1.2, 1.2),
              { kind: "heal", heal: pickOne(["band", "mini", "pot"]) },
            );
          spawnRebootCard(tgt);
          ALIVE--;
          var hk = killer && killer.isPlayer;
          UI.killFeed(
            killer ? killer.name : "THE STORM",
            tgt.name,
            hk,
            tgt.isPlayer,
            false,
            "elim",
          );
          if (hk) UI.hitmark(true, false, null, true);
          if (killer && killer !== tgt) killer.eliminations++;
          if (killer === PC) {
            Sfx.elim();
          }
          if (tgt.isPlayer) {
            onPlayerDeath(killer);
          } else if (!PC.alive && SPECTATE_TARGET === tgt) pickSpectateTarget();
          checkMatchEnd();
        }

        /* ============================================================================
   Loot
   ========================================================================== */
        var LOOT = [];
        function lootMesh(item) {
          var g = new THREE.Group();
          var rc = RARITY[item.rarity || 0].c;
          if (item.kind === "weapon") {
            var m = makeWeaponModel(item.id, item.rarity || 0);
            m.scale.setScalar(1.5);
            m.rotation.set(0, 0, 0);
            m.position.y = 0.35;
            g.add(m);
            var ring = new THREE.Mesh(
              new THREE.TorusGeometry(0.55, 0.06, 6, 18),
              new THREE.MeshBasicMaterial({
                color: col(rc),
                transparent: true,
                opacity: 0.85,
              }),
            );
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.08;
            g.add(ring);
            var beam = new THREE.Mesh(
              new THREE.CylinderGeometry(0.5, 0.5, 5, 10, 1, true),
              new THREE.MeshBasicMaterial({
                color: col(rc),
                transparent: true,
                opacity: 0.14,
                side: THREE.DoubleSide,
                depthWrite: false,
              }),
            );
            beam.position.y = 2.4;
            g.add(beam);
          } else if (item.kind === "ammo") {
            g.add(
              new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.35, 0.35),
                new THREE.MeshStandardMaterial({
                  color: col(0x6b5a3a),
                  roughness: 0.7,
                }),
              ),
            );
          } else if (item.kind === "shield") {
            var b = new THREE.Mesh(
              new THREE.CylinderGeometry(0.16, 0.16, 0.6, 10),
              new THREE.MeshStandardMaterial({
                color: col(0x38b6ff),
                transparent: true,
                opacity: 0.85,
                emissive: col(0x0a5c9c),
                roughness: 0.2,
              }),
            );
            g.add(b);
            g.add(
              new THREE.Mesh(
                new THREE.CylinderGeometry(0.09, 0.09, 0.22, 8),
                new THREE.MeshStandardMaterial({ color: col(0xdddddd) }),
              ),
            );
          } else if (item.kind === "bandage") {
            g.add(
              new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.22, 0.32),
                new THREE.MeshStandardMaterial({
                  color: col(0xf2f2f2),
                  roughness: 0.85,
                }),
              ),
            );
          } else if (item.kind === "heal") {
            var hc =
              item.heal === "mini" || item.heal === "pot" ? 0x38b6ff : 0xf2f2f2;
            var hm = new THREE.Mesh(
              new THREE.CylinderGeometry(0.18, 0.18, 0.5, 10),
              new THREE.MeshStandardMaterial({
                color: col(hc),
                roughness: 0.4,
                emissive: col(item.heal === "pot" ? 0x4a1a8a : 0x0a3a5c),
                emissiveIntensity: 0.5,
              }),
            );
            g.add(hm);
          } else if (item.kind === "card") {
            /* reboot card — a holographic ID chip left by a fallen squadmate */
            var cm = new THREE.Mesh(
              new THREE.BoxGeometry(0.62, 0.9, 0.05),
              new THREE.MeshStandardMaterial({
                color: col(0x2b6fff),
                emissive: col(0x1a4fd0),
                emissiveIntensity: 1.1,
                metalness: 0.6,
                roughness: 0.25,
                transparent: true,
                opacity: 0.92,
              }),
            );
            cm.position.y = 0.72;
            g.add(cm);
            var ring2 = new THREE.Mesh(
              new THREE.TorusGeometry(0.42, 0.045, 6, 18),
              new THREE.MeshBasicMaterial({
                color: col(0x9fd0ff),
                transparent: true,
                opacity: 0.85,
              }),
            );
            ring2.rotation.x = Math.PI / 2;
            ring2.position.y = 0.1;
            g.add(ring2);
            var beam2 = new THREE.Mesh(
              new THREE.CylinderGeometry(0.42, 0.42, 4.5, 10, 1, true),
              new THREE.MeshBasicMaterial({
                color: col(0x9fd0ff),
                transparent: true,
                opacity: 0.13,
                side: THREE.DoubleSide,
                depthWrite: false,
              }),
            );
            beam2.position.y = 2.2;
            g.add(beam2);
          } else {
            var mc =
              item.mat === "stone"
                ? 0xb9b9c4
                : item.mat === "metal"
                  ? 0x7fe0ff
                  : 0xc98b4b;
            g.add(
              new THREE.Mesh(
                new THREE.BoxGeometry(0.55, 0.4, 0.55),
                new THREE.MeshStandardMaterial({
                  color: col(mc),
                  roughness: 0.7,
                }),
              ),
            );
          }
          g.position.set(item.x, item.y, item.z);
          worldGroup.add(g);
          return g;
        }
        function spawnLoot(x, y, z, item) {
          item.x = x;
          item.y = y;
          item.z = z;
          item.spin = rnd(0, 6.28);
          item.mesh = lootMesh(item);
          LOOT.push(item);
          return item;
        }
        function removeLoot(it) {
          if (it.mesh) {
            worldGroup.remove(it.mesh);
          }
          var i = LOOT.indexOf(it);
          if (i >= 0) LOOT.splice(i, 1);
        }
        function updateLoot(dt) {
          for (var i = 0; i < LOOT.length; i++) {
            var it = LOOT[i];
            it.spin += dt * 1.4;
            it.mesh.rotation.y = it.spin;
            /* Loot used to just bob at whatever height it was spawned at. Eliminating a
       bot that is still gliding therefore dumped five weapons plus ammo and mats
       in mid-air, where they hung for the rest of the match. Give loot gravity
       and settle it on the surface beneath, once. */
            if (!it.settled) {
              var gy = groundInfo(it.x, it.z, it.y + 2).y;
              if (!isFinite(gy)) gy = terrainHeightAt(it.x, it.z);
              if (it.y > gy + 0.02) {
                it.vy = (it.vy || 0) - 24 * dt;
                it.y += it.vy * dt;
                if (it.y <= gy) {
                  it.y = gy;
                  it.vy = 0;
                  it.settled = true;
                }
              } else {
                it.y = gy;
                it.vy = 0;
                it.settled = true;
              }
            }
            it.mesh.position.y =
              it.y + 0.15 + Math.sin(GAMETIME * 2.2 + i) * 0.06;
          }
        }
        function canCarry(ch, item) {
          if (item.kind === "weapon") {
            for (var i = 1; i < 6; i++) if (!ch.slots[i]) return true;
            return false;
          }
          return true;
        }
        function giveItem(ch, item) {
          if (item.kind === "weapon") {
            var slot = -1;
            /* Swap into the slot the player is actually holding. Previously this always
       took the first empty slot, so picking a weapon up while on weapon 4 landed
       it in slot 5 and yanked the selection there instead of replacing weapon 4.
       Falls back to the first empty slot when the pickaxe is held, and to the
       weakest-weapon swap when the inventory is full. */
            if (ch.isPlayer && ch.slot > 0 && ch.slots[ch.slot]) slot = ch.slot;
            if (slot < 0)
              for (var i = 1; i < 6; i++)
                if (!ch.slots[i]) {
                  slot = i;
                  break;
                }
            if (slot >= 0 && slot === ch.slot && ch.slots[slot]) {
              /* the replaced weapon is dropped rather than destroyed */
              var oldHeld = ch.slots[slot];
              spawnLoot(ch.x + rnd(-1, 1), ch.y + 0.4, ch.z + rnd(-1, 1), {
                kind: "weapon",
                id: oldHeld.id,
                rarity: oldHeld.rarity,
                mag: oldHeld.ammoInMag,
              });
            }
            if (slot < 0) {
              /* swap out the weakest weapon if the new one is better */
              var worst = -1,
                ws = 1e9;
              for (var j = 1; j < 6; j++) {
                var ww = ch.slots[j];
                if (!ww) continue;
                var dd = WEAPONS[ww.id];
                var s =
                  ((dd.dmg * (dd.pellets || 1)) / dd.rate) *
                  RARITY[ww.rarity].m;
                if (s < ws) {
                  ws = s;
                  worst = j;
                }
              }
              if (worst < 0) return false;
              var newDef = WEAPONS[item.id];
              var ns =
                ((newDef.dmg * (newDef.pellets || 1)) / newDef.rate) *
                RARITY[item.rarity || 0].m;
              if (ns <= ws) return false;
              var old = ch.slots[worst];
              spawnLoot(ch.x + rnd(-1, 1), ch.y + 0.4, ch.z + rnd(-1, 1), {
                kind: "weapon",
                id: old.id,
                rarity: old.rarity,
                mag: old.ammoInMag,
              });
              slot = worst;
            }
            ch.slots[slot] = {
              id: item.id,
              rarity: item.rarity || 0,
              ammoInMag:
                item.mag !== undefined ? item.mag : WEAPONS[item.id].mag,
            };
            var def = WEAPONS[item.id];
            if (def.ammo) {
              var add =
                def.ammo === "shell"
                  ? 8
                  : def.ammo === "heavy"
                    ? 5
                    : def.ammo === "rocket"
                      ? 2
                      : 30;
              ch.ammo[def.ammo] = Math.min(
                AMMO_MAX[def.ammo],
                ch.ammo[def.ammo] + add,
              );
            }
            if (ch.isPlayer) {
              ch.slot = slot;
              attachWeapon(ch);
            }
            return true;
          }
          if (item.kind === "ammo") {
            ch.ammo[item.ammo] = Math.min(
              AMMO_MAX[item.ammo],
              ch.ammo[item.ammo] + item.count,
            );
            return true;
          }
          if (item.kind === "shield") {
            addShield(ch, 50);
            return true;
          }
          if (item.kind === "bandage") {
            ch.heals.band = Math.min(15, ch.heals.band + 3);
            return true;
          }
          if (item.kind === "heal") {
            ch.heals[item.heal] = Math.min(
              15,
              ch.heals[item.heal] +
                (item.heal === "band" ? 3 : item.heal === "mini" ? 3 : 1),
            );
            return true;
          }
          if (item.kind === "mat") {
            ch.mats[item.mat] = Math.min(
              MAX_MATS,
              ch.mats[item.mat] + item.count,
            );
            return true;
          }
          if (item.kind === "card") {
            ch.cards = (ch.cards || 0) + 1;
            return true;
          }
          return false;
        }
        function tryPickup(ch) {
          var best = null,
            bd = 2.8;
          for (var i = 0; i < LOOT.length; i++) {
            var it = LOOT[i];
            var d = dist2(ch.x, ch.z, it.x, it.z);
            if (d < bd && Math.abs(it.y - ch.y) < 3) {
              bd = d;
              best = it;
            }
          }
          if (!best) return false;
          if (!giveItem(ch, best)) return false;
          Sfx.pickup();
          removeLoot(best);
          return true;
        }
        function nearestInteract(ch) {
          var best = null,
            bd = 3.4,
            kind = null;
          for (var i = 0; i < CHESTS.length; i++) {
            var c = CHESTS[i];
            if (c.opened) continue;
            var d = dist2(ch.x, ch.z, c.x, c.z);
            if (d < bd && Math.abs(c.y - ch.y) < 3.5) {
              bd = d;
              best = c;
              kind = "chest";
            }
          }
          for (var j = 0; j < LOOT.length; j++) {
            var it = LOOT[j];
            var d2v = dist2(ch.x, ch.z, it.x, it.z);
            if (d2v < bd && Math.abs(it.y - ch.y) < 3) {
              bd = d2v;
              best = it;
              kind = "loot";
            }
          }
          /* Supply crates and reboot vans are bulky landmarks, so they get a wider reach
     than floor loot. They are compared on their own scale (4.5 units) rather
     than the tight 1.8-unit chest radius, but a genuinely closer chest or item
     still wins. */
          var big = 20.25,
            bigBest = null,
            bigKind = null;
          if (DROPS) {
            for (var di = 0; di < DROPS.length; di++) {
              var dp = DROPS[di];
              if (dp.opened || dp.state !== "landed") continue;
              var ddp = dist2(ch.x, ch.z, dp.x, dp.z);
              if (ddp < big && Math.abs(dp.gy - ch.y) < 4.5) {
                big = ddp;
                bigBest = dp;
                bigKind = "drop";
              }
            }
          }
          if (VANS && ch.cards > 0) {
            for (var vi = 0; vi < VANS.length; vi++) {
              var vn = VANS[vi];
              var dvn = dist2(ch.x, ch.z, vn.x, vn.z);
              if (dvn < big && Math.abs(vn.y - ch.y) < 4.5) {
                big = dvn;
                bigBest = vn;
                bigKind = "van";
              }
            }
          }
          if (bigBest && (best === null || big < bd)) {
            bd = big;
            best = bigBest;
            kind = bigKind;
          }
          if (MODE !== "solo") {
            for (var k = 0; k < CHARS.length; k++) {
              var o = CHARS[k];
              if (
                o === ch ||
                !o.knocked ||
                o.team === undefined ||
                ch.team === undefined ||
                o.team !== ch.team
              )
                continue;
              var dk = dist2(ch.x, ch.z, o.x, o.z);
              if (dk < 3.0 && Math.abs(o.y - ch.y) < 3) {
                bd = dk;
                best = o;
                kind = "downed";
              }
            }
          }
          return best ? { obj: best, kind: kind } : null;
        }
        function openChest(c, by) {
          if (c.opened) return;
          c.opened = true;
          c.lid.rotation.x = -1.15;
          if (c.spr) c.spr.visible = false;
          Sfx.chest();
          fxSpark(c.x, c.y + 1.0, c.z, 0xffd76a, 10, 2.4, 0.45);
          var n = rndi(3, 4);
          for (var i = 0; i < n; i++) {
            var r = rndi(0, 9);
            var item;
            if (r < 4) {
              var wid = chance(0.16)
                ? pickOne(RARE_WEAPONS)
                : pickOne(LOOT_WEAPONS);
              item = {
                kind: "weapon",
                id: wid,
                rarity: chance(0.12) ? rndi(2, 4) : rndi(0, 2),
              };
            } else if (r === 4)
              item = {
                kind: "ammo",
                ammo: pickOne(["light", "medium", "shell", "heavy"]),
                count: 30,
              };
            else if (r === 5) item = { kind: "shield", count: 1 };
            else if (r === 6) item = { kind: "heal", heal: "mini" };
            else if (r === 7) item = { kind: "heal", heal: "pot" };
            else if (r === 8) item = { kind: "heal", heal: "med" };
            else
              item = {
                kind: "mat",
                mat: pickOne(["wood", "stone", "metal"]),
                count: 60,
              };
            var a = rnd(0, 6.28),
              rr = rnd(1.0, 2.3);
            spawnLoot(
              c.x + Math.cos(a) * rr,
              c.y + 0.5,
              c.z + Math.sin(a) * rr,
              item,
            );
          }
          by.mats.wood = Math.min(MAX_MATS, by.mats.wood + 30);
        }
        function updateChests(dt) {
          for (var i = 0; i < CHESTS.length; i++) {
            var c = CHESTS[i];
            if (c.spr && !c.opened)
              c.spr.material.opacity = 0.4 + Math.sin(GAMETIME * 3 + i) * 0.22;
          }
        }

// === chars ===
/* ==== 50_chars.js ==== */
        /* ============================================================================
   50_CHARS — character rigs with proper joints, animation state machine,
   shared physics (walk / air / water / crouch / knocked / vehicle),
   the player controller, the third-person camera and drivable vehicles.
   ========================================================================== */

        var CHARS = [];
        var PC = null;
        var CAM = {
          pos: new THREE.Vector3(),
          dir: new THREE.Vector3(0, 0, 1),
          aim: new THREE.Vector3(),
          shake: 0,
          kick: 0,
          kickP: 0,
          mode: "third",
        };
        var _charId = 0;

        var SKIN_PALETTE = [
          {
            suit: 0x2f6fd0,
            suit2: 0x1d4a8f,
            skin: 0xe8b48a,
            accent: 0x4fd6ff,
            hair: 0x2b2119,
            helmet: 0,
          },
          {
            suit: 0xd04a3f,
            suit2: 0x8f2a22,
            skin: 0xc98a5e,
            accent: 0xffd23f,
            hair: 0x120d09,
            helmet: 1,
          },
          {
            suit: 0x3fae6a,
            suit2: 0x26794a,
            skin: 0xf0c39a,
            accent: 0x9dff8a,
            hair: 0x4a3524,
            helmet: 0,
          },
          {
            suit: 0x8a4fd0,
            suit2: 0x5c2f96,
            skin: 0x8d5a3a,
            accent: 0xff8ad6,
            hair: 0x1a1119,
            helmet: 2,
          },
          {
            suit: 0xd0a53f,
            suit2: 0x9a7726,
            skin: 0xe8b48a,
            accent: 0xffe9a8,
            hair: 0x5a3f22,
            helmet: 0,
          },
          {
            suit: 0x2a2f3a,
            suit2: 0x151920,
            skin: 0xd6a078,
            accent: 0xff4d4d,
            hair: 0x0d0d0d,
            helmet: 2,
          },
          {
            suit: 0x4fd0c0,
            suit2: 0x2a8f84,
            skin: 0xf5d0aa,
            accent: 0xffffff,
            hair: 0x8a6a3a,
            helmet: 1,
          },
          {
            suit: 0xe0e4ea,
            suit2: 0xa8b0bc,
            skin: 0xc98a5e,
            accent: 0x3f8fe0,
            hair: 0x2b2119,
            helmet: 0,
          },
          {
            suit: 0xd06a2f,
            suit2: 0x8f4418,
            skin: 0x6d452c,
            accent: 0xffc233,
            hair: 0x120d09,
            helmet: 1,
          },
          {
            suit: 0x3a4f8f,
            suit2: 0x222f5c,
            skin: 0xe8b48a,
            accent: 0x7fe0ff,
            hair: 0x4a3524,
            helmet: 2,
          },
          {
            suit: 0x8f3a5c,
            suit2: 0x5c2038,
            skin: 0xf0c39a,
            accent: 0xffb0d0,
            hair: 0x2b2119,
            helmet: 0,
          },
          {
            suit: 0x5c8f3a,
            suit2: 0x3a5c22,
            skin: 0xd6a078,
            accent: 0xd8ff8a,
            hair: 0x1a1119,
            helmet: 0,
          },
          {
            suit: 0xe8e2d0,
            suit2: 0xb8ae94,
            skin: 0x8d5a3a,
            accent: 0xff6b3f,
            hair: 0x0d0d0d,
            helmet: 1,
          },
          {
            suit: 0x1f3a5c,
            suit2: 0x0f2138,
            skin: 0xf0c39a,
            accent: 0x6bffa8,
            hair: 0x4a3524,
            helmet: 2,
          },
          {
            suit: 0xb03a2f,
            suit2: 0x7a241c,
            skin: 0xe8b48a,
            accent: 0xffffff,
            hair: 0x2b2119,
            helmet: 0,
          },
          {
            suit: 0x2f8f8f,
            suit2: 0x1a5c5c,
            skin: 0xc98a5e,
            accent: 0xffd76a,
            hair: 0x120d09,
            helmet: 1,
          },
        ];

        /* Shared unit primitives. Every character part is one of these scaled into
   place, and PartBag merges them per material per joint -- so the rigs carry
   ~70 pieces of detail for roughly the same draw-call cost as the old blocky
   version. mergeGeoList() always works on a *copy*, so sharing is safe. */
        var CH_GEO = {
          box: new THREE.BoxGeometry(1, 1, 1),
          sph: new THREE.SphereGeometry(0.5, 14, 10),
          sphHi: new THREE.SphereGeometry(0.5, 20, 14),
          cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
          cone: new THREE.ConeGeometry(0.5, 1, 10),
        };

        /* Hip height above the character's feet. The whole upper body is parented to
   a pivot at this height, so the animation can lean / twist / bob it without
   dragging the legs along. Shared by the rig builder and the animator. */
        var CH_HIP = 0.8;
        /* Head sits this far above the hip pivot. The head is parented to the torso
   pivot (not the root) so a lean carries it along and the seated crouch lowers
   it with the shoulders. */
        var CH_HEAD = 1.6 - CH_HIP;

        /* ---------------------------------------------------------------------------
   Seating geometry. The vehicle mesh builders and the seated animation BOTH
   read these, so the driver's hips always land on the cushion and the tallest
   helmet always clears the headliner -- the two can no longer drift apart.
   All Y values are in the vehicle's own local space (i.e. relative to v.y).
   SEAT_PELVIS is the seated rig's pelvis height above its mesh origin. */
        var SEAT_PIVOT = 0.34; /* torso pivot height while seated  */
        var SEAT_HEAD = 0.74; /* head height above that pivot     */
        var SEAT_PELVIS = 0.4; /* -> pelvis above the mesh origin  */
        var VEH_SEAT_CAR = 0.64; /* car cushion top                  */
        var VEH_SEAT_BOAT = 0.8; /* boat bench top                   */
        var VEH_ROOF_CAR = 1.9; /* underside of the car roof        */

        function buildCharMesh(ch, skin, skinIdx) {
          var idx = skinIdx || 0;
          var hairStyle = idx % 3,
            gearStyle = (idx >> 1) % 3,
            hasCape = idx % 5 === 0;
          var g = new THREE.Group();
          var suit = new THREE.MeshStandardMaterial({
            color: col(skin.suit),
            roughness: 0.74,
          });
          var suit2 = new THREE.MeshStandardMaterial({
            color: col(skin.suit2),
            roughness: 0.7,
          });
          var skinM = new THREE.MeshStandardMaterial({
            color: col(skin.skin),
            roughness: 0.6,
          });
          var dark = new THREE.MeshStandardMaterial({
            color: col(0x23262e),
            roughness: 0.52,
          });
          var acc = new THREE.MeshStandardMaterial({
            color: col(skin.accent),
            roughness: 0.34,
            emissive: col(skin.accent),
            emissiveIntensity: 0.28,
          });
          var hair = new THREE.MeshStandardMaterial({
            color: col(skin.hair),
            roughness: 0.86,
          });
          var steel = new THREE.MeshStandardMaterial({
            color: col(0x9aa3ad),
            metalness: 0.72,
            roughness: 0.34,
          });
          var white = new THREE.MeshStandardMaterial({
            color: col(0xf2f4f8),
            roughness: 0.22,
          });
          ch.mats3d = [suit, suit2, skinM, dark, acc, hair, steel, white];
          /* remember the intended glow so the hurt-flash can restore it instead of
     permanently flattening the accent emissive to black */
          for (var mi = 0; mi < ch.mats3d.length; mi++) {
            var mm = ch.mats3d[mi];
            mm.userData.baseEm = mm.emissive
              ? mm.emissive.clone()
              : new THREE.Color(0, 0, 0);
            mm.userData.baseEmI =
              mm.emissiveIntensity === undefined ? 1 : mm.emissiveIntensity;
          }

          /* ---------------- torso / gear ----------------
     Everything above the hips hangs off a `body` pivot sitting at hip height,
     so the animation can lean / twist / bob the whole upper half without
     dragging the legs with it. The bag is still authored in absolute Y and
     shifted down afterwards, which keeps every coordinate below readable. */
          var HIP = CH_HIP;
          var body = new THREE.Group();
          body.position.y = HIP;
          g.add(body);
          var B = new PartBag(body);
          B.add(
            CH_GEO.box,
            suit2,
            0,
            0.86,
            0,
            0,
            0,
            0,
            0.42,
            0.2,
            0.3,
          ); /* pelvis */
          B.add(
            CH_GEO.box,
            dark,
            0,
            0.99,
            0,
            0,
            0,
            0,
            0.5,
            0.09,
            0.36,
          ); /* belt */
          B.add(
            CH_GEO.box,
            steel,
            0,
            0.99,
            0.19,
            0,
            0,
            0,
            0.12,
            0.1,
            0.05,
          ); /* buckle */
          B.add(
            CH_GEO.box,
            dark,
            -0.25,
            0.93,
            0.06,
            0,
            0,
            0.08,
            0.12,
            0.17,
            0.11,
          ); /* hip pouch */
          B.add(
            CH_GEO.box,
            dark,
            0.25,
            0.93,
            0.06,
            0,
            0,
            -0.08,
            0.12,
            0.17,
            0.11,
          );
          B.add(
            CH_GEO.box,
            suit,
            0,
            1.16,
            0,
            0,
            0,
            0,
            0.5,
            0.28,
            0.32,
          ); /* abdomen */
          B.add(
            CH_GEO.box,
            suit,
            0,
            1.4,
            0,
            0,
            0,
            0,
            0.56,
            0.3,
            0.34,
          ); /* chest */
          B.add(
            CH_GEO.box,
            suit,
            0,
            1.52,
            0,
            0,
            0,
            0,
            0.66,
            0.12,
            0.3,
          ); /* shoulder yoke */
          B.add(
            CH_GEO.box,
            acc,
            0,
            1.29,
            0,
            0,
            0,
            0,
            0.58,
            0.07,
            0.36,
          ); /* waist stripe */
          B.add(
            CH_GEO.box,
            suit2,
            0,
            1.42,
            0.19,
            0,
            0,
            0,
            0.44,
            0.26,
            0.06,
          ); /* chest plate */
          B.add(
            CH_GEO.box,
            suit2,
            -0.2,
            1.4,
            0.19,
            0,
            0,
            0,
            0.13,
            0.3,
            0.05,
          ); /* vest panel */
          B.add(CH_GEO.box, suit2, 0.2, 1.4, 0.19, 0, 0, 0, 0.13, 0.3, 0.05);
          B.add(
            CH_GEO.box,
            dark,
            -0.13,
            1.4,
            0.2,
            0,
            0,
            0.26,
            0.09,
            0.42,
            0.04,
          ); /* cross straps */
          B.add(
            CH_GEO.box,
            dark,
            0.13,
            1.4,
            0.2,
            0,
            0,
            -0.26,
            0.09,
            0.42,
            0.04,
          );
          B.add(
            CH_GEO.box,
            suit2,
            0,
            1.56,
            0,
            0,
            0,
            0,
            0.34,
            0.1,
            0.3,
          ); /* collar */
          /* back bling */
          B.add(CH_GEO.box, suit2, 0, 1.36, -0.25, 0, 0, 0, 0.4, 0.46, 0.16);
          B.add(CH_GEO.box, dark, 0, 1.6, -0.25, 0, 0, 0, 0.42, 0.08, 0.18);
          B.add(
            CH_GEO.box,
            dark,
            -0.16,
            1.38,
            -0.15,
            0,
            0,
            0,
            0.07,
            0.44,
            0.05,
          );
          B.add(CH_GEO.box, dark, 0.16, 1.38, -0.15, 0, 0, 0, 0.07, 0.44, 0.05);
          B.add(CH_GEO.box, acc, 0, 1.3, -0.34, 0, 0, 0, 0.22, 0.06, 0.05);
          B.add(CH_GEO.box, steel, 0, 1.17, -0.34, 0, 0, 0, 0.1, 0.06, 0.04);
          if (gearStyle === 1)
            B.add(CH_GEO.box, steel, 0, 1.48, 0.19, 0, 0, 0, 0.2, 0.09, 0.05);
          if (gearStyle === 2) {
            /* bedroll */
            B.add(
              CH_GEO.cyl,
              suit2,
              0,
              1.14,
              -0.3,
              0,
              0,
              Math.PI / 2,
              0.13,
              0.34,
              0.13,
            );
            B.add(CH_GEO.box, acc, 0, 1.14, -0.3, 0, 0, 0, 0.06, 0.05, 0.3);
          }
          if (hasCape) {
            /* cape */
            B.add(
              CH_GEO.box,
              suit2,
              0,
              1.24,
              -0.32,
              0.08,
              0,
              0,
              0.46,
              0.62,
              0.05,
            );
            B.add(CH_GEO.box, acc, 0, 1.44, -0.32, 0.08, 0, 0, 0.3, 0.06, 0.06);
          }
          B.add(
            CH_GEO.cyl,
            skinM,
            0,
            1.52,
            0,
            0,
            0,
            0,
            0.19,
            0.13,
            0.19,
          ); /* neck */
          B.flush();
          /* The bag above is authored in absolute Y (0 = the soles) because that is
     far easier to read, but it is parented to the hip pivot -- so shift every
     merged mesh down by the hip height. Without this the whole torso renders
     0.80 above the legs and the character comes apart at the waist. */
          for (var bmi = 0; bmi < B.meshes.length; bmi++)
            B.meshes[bmi].position.y = -HIP;

          /* ---------------- head ---------------- */
          var head = new THREE.Group();
          head.position.set(0, 1.6 - HIP, 0);
          body.add(head);
          var H = new PartBag(head);
          H.add(
            CH_GEO.sphHi,
            skinM,
            0,
            0.13,
            0,
            0,
            0,
            0,
            0.43,
            0.455,
            0.43,
          ); /* skull */
          H.add(
            CH_GEO.box,
            skinM,
            0,
            0.015,
            0.035,
            0,
            0,
            0,
            0.25,
            0.13,
            0.21,
          ); /* jaw */
          H.add(
            CH_GEO.box,
            skinM,
            0,
            -0.02,
            0.135,
            0,
            0,
            0,
            0.14,
            0.06,
            0.06,
          ); /* chin */
          H.add(
            CH_GEO.box,
            skinM,
            -0.215,
            0.12,
            0,
            0,
            0,
            0,
            0.045,
            0.1,
            0.07,
          ); /* ears */
          H.add(CH_GEO.box, skinM, 0.215, 0.12, 0, 0, 0, 0, 0.045, 0.1, 0.07);
          H.add(
            CH_GEO.sph,
            white,
            -0.078,
            0.145,
            0.175,
            0,
            0,
            0,
            0.1,
            0.085,
            0.075,
          ); /* eyes */
          H.add(
            CH_GEO.sph,
            white,
            0.078,
            0.145,
            0.175,
            0,
            0,
            0,
            0.1,
            0.085,
            0.075,
          );
          H.add(
            CH_GEO.sph,
            dark,
            -0.078,
            0.145,
            0.215,
            0,
            0,
            0,
            0.048,
            0.048,
            0.036,
          ); /* pupils */
          H.add(
            CH_GEO.sph,
            dark,
            0.078,
            0.145,
            0.215,
            0,
            0,
            0,
            0.048,
            0.048,
            0.036,
          );
          H.add(
            CH_GEO.box,
            hair,
            -0.078,
            0.196,
            0.192,
            0,
            0,
            0.14,
            0.088,
            0.024,
            0.032,
          ); /* brows */
          H.add(
            CH_GEO.box,
            hair,
            0.078,
            0.196,
            0.192,
            0,
            0,
            -0.14,
            0.088,
            0.024,
            0.032,
          );
          H.add(
            CH_GEO.box,
            skinM,
            0,
            0.105,
            0.202,
            0,
            0,
            0,
            0.046,
            0.058,
            0.06,
          ); /* nose */
          H.add(
            CH_GEO.box,
            dark,
            0,
            0.048,
            0.188,
            0,
            0,
            0,
            0.076,
            0.018,
            0.03,
          ); /* mouth */
          /* hair */
          if (hairStyle === 0) {
            H.add(CH_GEO.box, hair, 0, 0.3, -0.01, 0, 0, 0, 0.43, 0.15, 0.43);
            H.add(CH_GEO.box, hair, 0, 0.22, -0.16, 0, 0, 0, 0.43, 0.18, 0.13);
            H.add(
              CH_GEO.box,
              hair,
              -0.2,
              0.22,
              -0.02,
              0,
              0,
              0,
              0.07,
              0.18,
              0.36,
            );
            H.add(
              CH_GEO.box,
              hair,
              0.2,
              0.22,
              -0.02,
              0,
              0,
              0,
              0.07,
              0.18,
              0.36,
            );
            H.add(CH_GEO.box, hair, 0, 0.275, 0.185, 0, 0, 0, 0.37, 0.1, 0.07);
          } else if (hairStyle === 1) {
            H.add(CH_GEO.box, hair, 0, 0.3, -0.01, 0, 0, 0, 0.4, 0.1, 0.4);
            H.add(CH_GEO.box, hair, 0, 0.215, -0.17, 0, 0, 0, 0.4, 0.16, 0.1);
            H.add(
              CH_GEO.box,
              acc,
              0,
              0.42,
              -0.03,
              0,
              0,
              0,
              0.11,
              0.21,
              0.34,
            ); /* crest */
          } else {
            H.add(CH_GEO.box, hair, 0, 0.3, -0.01, 0, 0, 0, 0.45, 0.15, 0.45);
            H.add(
              CH_GEO.box,
              hair,
              0,
              0.1,
              -0.21,
              0,
              0,
              0,
              0.31,
              0.36,
              0.15,
            ); /* long back */
            H.add(CH_GEO.box, hair, 0, 0.27, 0.19, 0, 0, 0, 0.39, 0.11, 0.07);
          }
          /* helmet variants */
          if (skin.helmet === 1) {
            H.add(CH_GEO.sph, dark, 0, 0.155, 0, 0, 0, 0, 0.5, 0.55, 0.5);
            H.add(
              CH_GEO.box,
              dark,
              0,
              0.135,
              0.21,
              0,
              0,
              0,
              0.52,
              0.075,
              0.13,
            ); /* brim */
            H.add(
              CH_GEO.box,
              acc,
              0,
              0.145,
              0.225,
              0,
              0,
              0,
              0.3,
              0.05,
              0.07,
            ); /* visor stripe */
            H.add(
              CH_GEO.box,
              steel,
              -0.26,
              0.1,
              0,
              0,
              0,
              0,
              0.06,
              0.12,
              0.14,
            ); /* side rail */
            H.add(CH_GEO.box, steel, 0.26, 0.1, 0, 0, 0, 0, 0.06, 0.12, 0.14);
            H.add(
              CH_GEO.box,
              dark,
              0,
              0.02,
              0.14,
              0,
              0,
              0,
              0.3,
              0.05,
              0.05,
            ); /* chin strap */
          } else if (skin.helmet === 2) {
            H.add(
              CH_GEO.box,
              dark,
              0,
              0.2,
              0,
              0,
              0,
              0,
              0.46,
              0.27,
              0.46,
            ); /* shell */
            H.add(
              CH_GEO.box,
              acc,
              0,
              0.19,
              0.225,
              0,
              0,
              0,
              0.48,
              0.11,
              0.11,
            ); /* visor band */
            H.add(
              CH_GEO.box,
              acc,
              0.245,
              0.26,
              0,
              0,
              0,
              0,
              0.12,
              0.23,
              0.3,
            ); /* side pod */
            H.add(
              CH_GEO.box,
              steel,
              0.245,
              0.4,
              0,
              0,
              0,
              0,
              0.035,
              0.14,
              0.035,
            ); /* antenna */
            H.add(CH_GEO.box, dark, -0.235, 0.3, 0, 0, 0, 0, 0.08, 0.1, 0.14);
            H.add(
              CH_GEO.box,
              steel,
              0,
              0.075,
              0.2,
              0,
              0,
              0,
              0.36,
              0.07,
              0.09,
            ); /* mask */
          }
          H.flush();

          /* ---------------- arms: shoulder -> elbow -> hand ---------------- */
          function makeArm(side) {
            var shoulder = new THREE.Group();
            shoulder.position.set(0.36 * side, 1.42 - HIP, 0);
            body.add(shoulder);
            var A = new PartBag(shoulder);
            A.add(
              CH_GEO.sph,
              suit,
              0,
              0.01,
              0,
              0,
              0,
              0,
              0.25,
              0.25,
              0.25,
            ); /* deltoid */
            A.add(
              CH_GEO.box,
              suit2,
              0,
              0.055,
              0,
              0,
              0,
              0,
              0.2,
              0.14,
              0.22,
            ); /* shoulder pad */
            A.add(CH_GEO.box, acc, 0, 0.115, 0, 0, 0, 0, 0.17, 0.045, 0.19);
            A.add(
              CH_GEO.box,
              suit,
              0,
              -0.17,
              0,
              0,
              0,
              0,
              0.145,
              0.3,
              0.155,
            ); /* upper arm */
            A.add(
              CH_GEO.box,
              acc,
              0,
              -0.105,
              0,
              0,
              0,
              0,
              0.152,
              0.035,
              0.162,
            ); /* band */
            A.add(
              CH_GEO.box,
              dark,
              0,
              -0.245,
              0,
              0,
              0,
              0,
              0.16,
              0.055,
              0.17,
            ); /* strap */
            if (gearStyle === 0)
              A.add(
                CH_GEO.box,
                steel,
                0.1 * side,
                0.03,
                0,
                0,
                0,
                0,
                0.07,
                0.1,
                0.12,
              );
            A.flush();
            var elbow = new THREE.Group();
            elbow.position.set(0, -0.32, 0);
            shoulder.add(elbow);
            var E = new PartBag(elbow);
            E.add(
              CH_GEO.sph,
              dark,
              0,
              0,
              0,
              0,
              0,
              0,
              0.17,
              0.17,
              0.17,
            ); /* elbow pad */
            E.add(
              CH_GEO.box,
              skinM,
              0,
              -0.145,
              0,
              0,
              0,
              0,
              0.135,
              0.26,
              0.145,
            ); /* forearm */
            E.add(
              CH_GEO.box,
              suit2,
              0,
              -0.105,
              0,
              0,
              0,
              0,
              0.155,
              0.15,
              0.165,
            ); /* guard */
            E.add(CH_GEO.box, acc, 0, -0.19, 0, 0, 0, 0, 0.16, 0.035, 0.17);
            E.add(
              CH_GEO.box,
              dark,
              0,
              -0.265,
              0,
              0,
              0,
              0,
              0.15,
              0.06,
              0.16,
            ); /* cuff */
            E.flush();
            var hand = new THREE.Group();
            hand.position.set(0, -0.31, 0);
            elbow.add(hand);
            var HD = new PartBag(hand);
            HD.add(
              CH_GEO.box,
              dark,
              0,
              -0.045,
              0,
              0,
              0,
              0,
              0.115,
              0.115,
              0.13,
            ); /* palm */
            for (var fi = 0; fi < 4; fi++)
              HD.add(
                CH_GEO.box,
                dark,
                -0.042 + fi * 0.028,
                -0.128,
                0.012,
                0,
                0,
                0,
                0.026,
                0.075,
                0.1,
              );
            HD.add(
              CH_GEO.box,
              dark,
              0.062,
              -0.07,
              0.032,
              0,
              0,
              0,
              0.03,
              0.06,
              0.07,
            ); /* thumb */
            HD.add(
              CH_GEO.box,
              steel,
              0,
              -0.058,
              0.072,
              0,
              0,
              0,
              0.12,
              0.05,
              0.05,
            ); /* knuckles */
            HD.flush();
            return { shoulder: shoulder, elbow: elbow, hand: hand };
          }
          var armL = makeArm(-1),
            armR = makeArm(1);

          /* ---------------- legs: hip -> knee -> foot ---------------- */
          function makeLeg(side) {
            var hip = new THREE.Group();
            hip.position.set(0.155 * side, 0.8, 0);
            g.add(hip);
            var HP = new PartBag(hip);
            HP.add(
              CH_GEO.box,
              suit2,
              0,
              -0.19,
              0,
              0,
              0,
              0,
              0.2,
              0.36,
              0.22,
            ); /* thigh */
            HP.add(
              CH_GEO.box,
              dark,
              side * 0.1,
              -0.16,
              0.05,
              0,
              0,
              0,
              0.09,
              0.15,
              0.1,
            ); /* pouch */
            HP.add(CH_GEO.box, acc, 0, -0.3, 0, 0, 0, 0, 0.205, 0.035, 0.225);
            HP.add(
              CH_GEO.sph,
              dark,
              0,
              -0.37,
              0.02,
              0,
              0,
              0,
              0.21,
              0.19,
              0.21,
            ); /* knee pad */
            HP.flush();
            var knee = new THREE.Group();
            knee.position.set(0, -0.38, 0);
            hip.add(knee);
            var K = new PartBag(knee);
            K.add(
              CH_GEO.box,
              suit2,
              0,
              -0.18,
              0,
              0,
              0,
              0,
              0.185,
              0.34,
              0.2,
            ); /* shin */
            K.add(
              CH_GEO.box,
              dark,
              0,
              -0.13,
              0.105,
              0,
              0,
              0,
              0.2,
              0.21,
              0.06,
            ); /* shin guard */
            K.add(CH_GEO.box, acc, 0, -0.3, 0, 0, 0, 0, 0.19, 0.045, 0.21);
            K.flush();
            var foot = new THREE.Group();
            foot.position.set(0, -0.36, 0);
            knee.add(foot);
            var F = new PartBag(foot);
            F.add(
              CH_GEO.box,
              dark,
              0,
              -0.05,
              0.05,
              0,
              0,
              0,
              0.2,
              0.13,
              0.3,
            ); /* boot */
            F.add(
              CH_GEO.box,
              suit2,
              0,
              -0.115,
              0.05,
              0,
              0,
              0,
              0.215,
              0.05,
              0.32,
            ); /* sole */
            F.add(
              CH_GEO.box,
              steel,
              0,
              -0.06,
              0.2,
              0,
              0,
              0,
              0.19,
              0.09,
              0.07,
            ); /* toe cap */
            F.add(
              CH_GEO.box,
              dark,
              0,
              0.015,
              0.02,
              0,
              0,
              0,
              0.21,
              0.07,
              0.24,
            ); /* ankle */
            F.flush();
            return { hip: hip, knee: knee, foot: foot };
          }
          var legL = makeLeg(-1),
            legR = makeLeg(1);

          ch.limbs = {
            armL: armL,
            armR: armR,
            legL: legL,
            legR: legR,
            head: head,
            torso: body,
          };
          ch.mesh = g;
          worldGroup.add(g);
          return g;
        }
        function attachWeapon(ch) {
          if (ch.weaponMesh) {
            ch.limbs.armR.hand.remove(ch.weaponMesh);
            ch.weaponMesh = null;
          }
          var w = ch.slots[ch.slot];
          if (!w) return;
          var m = makeWeaponModel(w.id, w.rarity);
          m.position.set(0.0, -0.06, 0.1);
          m.rotation.set(0, 0, 0);
          ch.limbs.armR.hand.add(m);
          ch.weaponMesh = m;
        }
        function createChar(name, isPlayer, skinIdx, team) {
          var skin = SKIN_PALETTE[skinIdx % SKIN_PALETTE.length];
          var ch = {
            id: _charId++,
            name: name,
            isPlayer: !!isPlayer,
            isBot: !isPlayer,
            alive: true,
            knocked: false,
            bleed: 0,
            reviveProg: 0,
            team: team === undefined ? (isPlayer ? 0 : 1) : team,
            x: 0,
            y: 0,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            yaw: 0,
            pitch: 0,
            health: 100,
            shield: 0,
            mats: { wood: isPlayer ? 120 : rndi(70, 240), stone: 0, metal: 0 },
            ammo: { light: 0, medium: 0, heavy: 0, shell: 0, rocket: 0 },
            heals: {
              band: isPlayer ? 0 : rndi(0, 3),
              mini: isPlayer ? 0 : rndi(0, 2),
              med: 0,
              pot: 0,
            },
            slots: [
              { id: "pickaxe", rarity: 0, ammoInMag: 0 },
              null,
              null,
              null,
              null,
              null,
            ],
            slot: 0,
            reloading: null,
            using: null,
            fireCd: 0,
            recoil: 0,
            bloom: 0,
            grounded: false,
            state: "bus",
            onBus: true,
            eliminations: 0,
            damageDealt: 0,
            walkPhase: 0,
            hurtFlash: 0,
            aimX: 0,
            aimZ: 1,
            aimSpread: 1,
            aiming: false,
            skin: skin,
            jumpTarget: null,
            ai: null,
            parasail: false,
            glideLock: 0,
            vehicle: null,
            inWater: false,
            lastShot: 0,
            sprinting: false,
            crouch: false,
            knockAnim: 0,
            landAnim: 0,
            useAnim: 0,
            swingT: 1e9,
            swingDur: 1,
            lastStepSign: 0,
            mantle: null,
            mantleAnim: 0,
            /* ramp weights for the animation override layers (see poseChar) */
            holdW: 0,
            crouchW: 0,
            useW: 0,
            animT: 0,
            prevYaw: 0,
          };
          buildCharMesh(ch, skin, skinIdx);
          attachWeapon(ch);
          CHARS.push(ch);
          return ch;
        }

        /* ============================================================================
   Shared physics
   ========================================================================== */
        /* How high a lip a character can walk up without jumping. Houses put their floor
   slab ~0.15 above the terrain, which used to stop the player dead at the doorway
   and force a jump. Kept well under wall height so this can never be used to climb
   a building: the probe is re-tested at feet+STEP_UP, so a full-height wall still
   blocks and only genuinely short lips are climbed. */
        var STEP_UP = 0.58;
        /* Anything taller than STEP_UP but no taller than this gets MANTLED: running
   into it hauls the character up and over instead of stopping them dead.
   Capped below full wall height (3.0) so a wall is still a wall. */
        var MANTLE_MAX = 1.95;
        var MANTLE_TIME = 0.4;

        function moveChar(ch, dt, mx, mz, jump, sprint, crouch, noGrav) {
          /* --- scripted mantle: a short hand-authored arc that owns the position
     outright. Easing the horizontal first and the vertical after makes it
     read as a haul-up rather than a diagonal slide. --- */
          if (ch.mantle) {
            var M = ch.mantle;
            M.t += dt;
            var mt = clamp(M.t / M.dur, 0, 1);
            var ex = smooth01(clamp(mt * 1.5, 0, 1));
            var ey = smooth01(clamp((mt - 0.2) / 0.8, 0, 1));
            ch.x = lerp(M.x0, M.x1, ex);
            ch.z = lerp(M.z0, M.z1, ex);
            ch.y = lerp(M.y0, M.y1, ey);
            ch.vx = 0;
            ch.vz = 0;
            ch.vy = 0;
            ch.grounded = true;
            ch.mantleAnim = 1 - mt;
            if (mt >= 1) {
              ch.mantle = null;
              ch.mantleAnim = 0;
              ch.landAnim = 0.16;
            }
            return;
          }
          var len = Math.sqrt(mx * mx + mz * mz);
          if (len > 1) {
            mx /= len;
            mz /= len;
            len = 1;
          }
          var speed = ch.knocked
            ? 2.4
            : crouch
              ? CFG.CROUCH
              : sprint
                ? CFG.SPRINT
                : CFG.RUN;
          if (ch.using) speed *= 0.55;
          if (!ch.grounded) speed *= 0.94;
          if (ch.inWater) speed *= 0.6;
          var tx = mx * speed,
            tz = mz * speed;
          var accel = (ch.grounded ? 72 : 24) * dt;
          ch.vx += clamp(tx - ch.vx, -accel, accel);
          ch.vz += clamp(tz - ch.vz, -accel, accel);
          if (len < 0.01 && ch.grounded) {
            var f = Math.exp(-11 * dt);
            ch.vx *= f;
            ch.vz *= f;
          }
          if (jump && ch.grounded && !ch.knocked) {
            ch.vy = CFG.JUMP;
            ch.grounded = false;
            if (ch.isPlayer) Sfx.jump();
          }
          if (!noGrav) {
            ch.vy += CFG.GRAV * dt;
            if (ch.vy < -82) ch.vy = -82;
          }
          var p = { x: ch.x + ch.vx * dt, z: ch.z + ch.vz * dt };
          collideXZ(p, 0.42, ch.y + 0.1, ch.y + 1.72);
          /* Step-up: if the horizontal move got blocked, retry it with the feet raised by
     STEP_UP. If that clears AND the ground at the far side is a step we could
     actually stand on, climb it instead of stalling. */
          if (ch.grounded && !ch.knocked && ch.vy <= 0.01 && !ch.inWater) {
            var wdx = ch.vx * dt,
              wdz = ch.vz * dt;
            var wanted = Math.sqrt(wdx * wdx + wdz * wdz);
            var gotDX = p.x - ch.x,
              gotDZ = p.z - ch.z;
            var got = Math.sqrt(gotDX * gotDX + gotDZ * gotDZ);
            if (wanted > 0.004 && got < wanted * 0.6) {
              var q = { x: ch.x + wdx, z: ch.z + wdz };
              collideXZ(q, 0.42, ch.y + STEP_UP + 0.12, ch.y + STEP_UP + 1.72);
              var got2 = Math.sqrt(
                (q.x - ch.x) * (q.x - ch.x) + (q.z - ch.z) * (q.z - ch.z),
              );
              if (got2 > got * 1.15) {
                /* Support height at the far side: the raised ground/ramp, or the top
           of the box we were just blocked by (a house floor slab, a kerb). */
                var sg = groundInfo(q.x, q.z, ch.y + STEP_UP + 0.6).y;
                var st = stepTopAt(q.x, q.z, 0.42, ch.y, STEP_UP);
                if (st > sg) sg = st;
                var rise = sg - ch.y;
                if (rise > 0.02 && rise <= STEP_UP + 0.02) {
                  p.x = q.x;
                  p.z = q.z;
                  ch.y = sg;
                  ch.stepLift = 0.26; /* drives the climb pose in poseChar */
                  ch.stepDir = Math.atan2(wdx, wdz);
                }
              } else {
                /* --- mantle -------------------------------------------------------
           Too tall to step over and we are still pressed into it. Look for a
           standable top within MANTLE_MAX and, if the landing spot is clear,
           haul the character up. Without this a 0.6-1.9m ledge is an invisible
           wall that only a jump clears, which is exactly the annoyance the
           step-up assist was added to remove. --- */
                var wl = Math.sqrt(wdx * wdx + wdz * wdz) || 1;
                var nx = wdx / wl,
                  nz = wdz / wl;
                var top = stepTopAt(
                  ch.x + nx * 0.55,
                  ch.z + nz * 0.55,
                  0.48,
                  ch.y,
                  MANTLE_MAX,
                );
                var lx = ch.x + nx * 0.95,
                  lz = ch.z + nz * 0.95;
                /* The landing spot has to be genuinely STANDABLE, not merely unblocked:
           groundInfo only knows the terrain and the platform hash, so a bare
           collider box would let the player mantle onto its top and then drop
           straight through it on the next frame. */
                var stand = groundInfo(lx, lz, top + 0.5).y;
                if (
                  top > ch.y + STEP_UP &&
                  top <= ch.y + MANTLE_MAX &&
                  stand >= top - 0.35 &&
                  !blockedAt(lx, lz, stand + 0.12, stand + 1.7) &&
                  !overlapAt(lx, lz, stand + 0.12, stand + 1.7)
                ) {
                  ch.mantle = {
                    t: 0,
                    dur: MANTLE_TIME,
                    x0: ch.x,
                    y0: ch.y,
                    z0: ch.z,
                    x1: lx,
                    y1: stand,
                    z1: lz,
                  };
                  ch.mantleAnim = 1;
                  if (ch.isPlayer) Sfx.jump();
                  return;
                }
              }
            }
          }
          ch.x = p.x;
          ch.z = p.z;
          var preY = ch.y;
          ch.y += ch.vy * dt;
          var gi = groundInfo(ch.x, ch.z, preY);
          var g = gi.y;
          if (ch.y <= g) {
            if (ch.vy < -13) {
              if (ch.isPlayer) {
                Sfx.land();
              }
              if (ch.vy < -24)
                damageChar(ch, (Math.abs(ch.vy) - 24) * 2.6, null, false, {
                  cls: "fall",
                });
              ch.landAnim = 0.28;
              fxSmoke(ch.x, g + 0.1, ch.z, 3, 0.6, 0.9, 0.5);
            }
            ch.y = g;
            ch.vy = 0;
            ch.grounded = true;
          } else if (ch.y > g + 0.06) ch.grounded = false;
          /* water: float at the surface instead of walking the sea bed */
          var wDepth = CFG.SEA - terrainHeightAt(ch.x, ch.z);
          if (wDepth > 0.8 && ch.y < CFG.SEA - 0.15) {
            var wasWater = ch.inWater;
            ch.inWater = true;
            var surf = CFG.SEA - 0.55;
            ch.vy += (surf - ch.y) * 30 * dt;
            ch.vy *= Math.exp(-3.4 * dt);
            ch.vy = clamp(ch.vy, -5, 5);
            if (Math.abs(ch.y - surf) < 0.4) {
              ch.vy *= 0.4;
              ch.grounded = true;
            }
            if (!wasWater) {
              if (ch.isPlayer) Sfx.splash();
              if (ch.isPlayer || nearPlayer(ch.x, ch.z, 48))
                fxSmoke(ch.x, CFG.SEA - 0.22, ch.z, 6, 0.85, 1.5, 0.6);
            }
            /* wake while swimming */
            var wv = Math.sqrt(ch.vx * ch.vx + ch.vz * ch.vz);
            if (wv > 2.2 && (ch.isPlayer || nearPlayer(ch.x, ch.z, 42))) {
              ch.wakeT = (ch.wakeT || 0) + dt;
              if (ch.wakeT > 0.2) {
                ch.wakeT = 0;
                fxSmoke(ch.x, CFG.SEA - 0.18, ch.z, 1, 0.55, 0.5, 0.5);
              }
            }
          } else ch.inWater = false;
          var d = Math.sqrt(ch.x * ch.x + ch.z * ch.z),
            lim = CFG.MAP * 0.47;
          if (d > lim) {
            ch.x *= lim / d;
            ch.z *= lim / d;
          }
          return len;
        }

        /* ============================================================================
   Animation
   ========================================================================== */
        /* Frame-rate independent exponential approach. The previous version used a
   fixed per-frame lerp factor, so every pose transition ran at a speed that
   depended on the display refresh rate (snappy at 144Hz, syrupy at 30Hz). */
        function damp(cur, target, rate, dt) {
          return cur + (target - cur) * expDecay(rate, dt);
        }
        /* Normalised smoothstep over 0..1, for shaping one-shot animation curves. */
        function smooth01(t) {
          t = clamp(t, 0, 1);
          return t * t * (3 - 2 * t);
        }

        /* How each weapon class is carried. rs* = right (firing) arm, ls* = left
   (support) arm; `x` is the shoulder's forward swing, `z` its inward roll and
   `e` the elbow bend. Values are in radians, tuned against the rig's shoulder
   height (1.42) and the weapon's attachment point inside the right hand. */
        var HOLD_POSE = {
          rifle: {
            carry: {
              rsx: -1.02,
              rsz: -0.34,
              rex: -1.05,
              lsx: -1.05,
              lsz: 0.52,
              lex: -1.15,
            },
            aim: {
              rsx: -1.46,
              rsz: -0.16,
              rex: -0.62,
              lsx: -1.42,
              lsz: 0.42,
              lex: -1.02,
            },
          },
          heavy: {
            carry: {
              rsx: -0.95,
              rsz: -0.2,
              rex: -0.98,
              lsx: -1.0,
              lsz: 0.46,
              lex: -1.05,
            },
            aim: {
              rsx: -1.4,
              rsz: -0.14,
              rex: -0.55,
              lsx: -1.38,
              lsz: 0.4,
              lex: -0.95,
            },
          },
          sniper: {
            carry: {
              rsx: -1.0,
              rsz: -0.3,
              rex: -1.02,
              lsx: -1.02,
              lsz: 0.5,
              lex: -1.12,
            },
            aim: {
              rsx: -1.45,
              rsz: -0.1,
              rex: -0.78,
              lsx: -1.55,
              lsz: 0.56,
              lex: -1.35,
            },
          },
          pistol: {
            carry: {
              rsx: -0.86,
              rsz: -0.12,
              rex: -0.94,
              lsx: -0.26,
              lsz: 0.12,
              lex: -0.4,
            },
            aim: {
              rsx: -1.5,
              rsz: -0.05,
              rex: -0.3,
              lsx: -1.22,
              lsz: 0.64,
              lex: -1.45,
            },
          },
          launcher: {
            carry: {
              rsx: -1.05,
              rsz: -0.24,
              rex: -0.95,
              lsx: -1.05,
              lsz: 0.4,
              lex: -1.0,
            },
            aim: {
              rsx: -1.28,
              rsz: -0.2,
              rex: -0.88,
              lsx: -1.12,
              lsz: 0.32,
              lex: -1.0,
            },
          },
          throw: {
            carry: {
              rsx: -1.05,
              rsz: -0.1,
              rex: -0.9,
              lsx: -0.3,
              lsz: 0.14,
              lex: -0.42,
            },
            aim: {
              rsx: -1.35,
              rsz: -0.06,
              rex: -0.7,
              lsx: -0.55,
              lsz: 0.2,
              lex: -0.6,
            },
          },
        };

        function poseChar(ch, dt) {
          var L = ch.limbs,
            T = L.torso;
          var sp = Math.sqrt(ch.vx * ch.vx + ch.vz * ch.vz);
          var w = ch.slots[ch.slot];
          var wdef = (w && WEAPONS[w.id]) || null;
          var hold = wdef ? wdef.hold : "axe";
          var gun = hold !== "axe";
          var hipY = CH_HIP;
          /* The head rides on the torso pivot (so a lean carries it along and the
     seated crouch pulls it down with the shoulders). Seated it tucks slightly
     lower again so the tallest helmet still clears the car roof. Done up here
     so every branch below -- knocked, gliding, driving, on foot -- gets it. */
          if (L.head)
            L.head.position.y = damp(
              L.head.position.y,
              ch.vehicle ? SEAT_HEAD : CH_HEAD,
              12,
              dt,
            );
          /* Weapons are stowed in a vehicle -- both because the hands are on the wheel
     and because a held rifle/pickaxe is long enough to punch straight out
     through the roof. One line up here covers every branch below. */
          if (ch.weaponMesh) ch.weaponMesh.visible = !ch.vehicle;

          /* Signed yaw rate drives the turn lean. angDiff(prev,cur) === cur-prev. */
          if (ch.prevYaw === undefined) ch.prevYaw = ch.yaw;
          var yawRate = angDiff(ch.prevYaw, ch.yaw) / Math.max(dt, 1e-4);
          ch.prevYaw = ch.yaw;
          ch.animT = (ch.animT || 0) + dt;
          var turn = clamp(yawRate * 0.13, -1, 1);

          /* ============================ DOWNED ================================== */
          if (ch.knocked) {
            var ks = Math.sin(ch.animT * 3.0);
            L.legL.hip.rotation.x = damp(
              L.legL.hip.rotation.x,
              -0.9 + ks * 0.16,
              7,
              dt,
            );
            L.legR.hip.rotation.x = damp(
              L.legR.hip.rotation.x,
              -0.62 - ks * 0.16,
              7,
              dt,
            );
            L.legL.knee.rotation.x = damp(L.legL.knee.rotation.x, 1.42, 7, dt);
            L.legR.knee.rotation.x = damp(L.legR.knee.rotation.x, 1.12, 7, dt);
            /* the arms drag alternately, as if hauling yourself along the ground */
            L.armL.shoulder.rotation.x = damp(
              L.armL.shoulder.rotation.x,
              -1.35 + ks * 0.45,
              8,
              dt,
            );
            L.armR.shoulder.rotation.x = damp(
              L.armR.shoulder.rotation.x,
              -1.35 - ks * 0.45,
              8,
              dt,
            );
            L.armL.shoulder.rotation.z = damp(
              L.armL.shoulder.rotation.z,
              0.62,
              8,
              dt,
            );
            L.armR.shoulder.rotation.z = damp(
              L.armR.shoulder.rotation.z,
              -0.62,
              8,
              dt,
            );
            L.armL.elbow.rotation.x = damp(
              L.armL.elbow.rotation.x,
              -0.72,
              8,
              dt,
            );
            L.armR.elbow.rotation.x = damp(
              L.armR.elbow.rotation.x,
              -0.72,
              8,
              dt,
            );
            L.head.rotation.x = damp(L.head.rotation.x, -0.34, 6, dt);
            if (T) {
              T.position.y = damp(T.position.y, hipY, 8, dt);
              T.rotation.x = damp(T.rotation.x, 0.34, 6, dt);
              T.rotation.y = damp(T.rotation.y, ks * 0.1, 6, dt);
              T.rotation.z = damp(T.rotation.z, 0, 6, dt);
            }
            ch.mesh.position.y = ch.y + 0.3;
            ch.mesh.rotation.set(0, ch.yaw, 0);
            applyHurtFlash(ch, dt);
            return;
          }

          /* ======================= SKYDIVE / GLIDE ============================== */
          if (ch.state === "glide" || ch.state === "skydive") {
            var dive = ch.state === "skydive";
            var sway =
              Math.sin(ch.animT * (dive ? 3.0 : 1.5)) * (dive ? 0.05 : 0.1);
            if (dive) {
              /* head-first: arms swept back along the body, legs held together */
              L.armL.shoulder.rotation.x = damp(
                L.armL.shoulder.rotation.x,
                -2.55,
                5,
                dt,
              );
              L.armR.shoulder.rotation.x = damp(
                L.armR.shoulder.rotation.x,
                -2.55,
                5,
                dt,
              );
              L.armL.shoulder.rotation.z = damp(
                L.armL.shoulder.rotation.z,
                0.3 + sway,
                5,
                dt,
              );
              L.armR.shoulder.rotation.z = damp(
                L.armR.shoulder.rotation.z,
                -0.3 - sway,
                5,
                dt,
              );
              L.armL.elbow.rotation.x = damp(
                L.armL.elbow.rotation.x,
                -0.3,
                5,
                dt,
              );
              L.armR.elbow.rotation.x = damp(
                L.armR.elbow.rotation.x,
                -0.3,
                5,
                dt,
              );
              L.legL.hip.rotation.x = damp(
                L.legL.hip.rotation.x,
                0.44 + sway,
                5,
                dt,
              );
              L.legR.hip.rotation.x = damp(
                L.legR.hip.rotation.x,
                0.44 - sway,
                5,
                dt,
              );
              L.legL.knee.rotation.x = damp(L.legL.knee.rotation.x, 0.3, 5, dt);
              L.legR.knee.rotation.x = damp(L.legR.knee.rotation.x, 0.3, 5, dt);
              L.head.rotation.x = damp(L.head.rotation.x, -0.55, 4, dt);
              ch.mesh.rotation.x = damp(ch.mesh.rotation.x, -1.15, 3.5, dt);
            } else {
              /* under the glider: arms up on the bar, legs hanging and swaying */
              L.armL.shoulder.rotation.x = damp(
                L.armL.shoulder.rotation.x,
                -2.2,
                5,
                dt,
              );
              L.armR.shoulder.rotation.x = damp(
                L.armR.shoulder.rotation.x,
                -2.2,
                5,
                dt,
              );
              L.armL.shoulder.rotation.z = damp(
                L.armL.shoulder.rotation.z,
                0.8,
                5,
                dt,
              );
              L.armR.shoulder.rotation.z = damp(
                L.armR.shoulder.rotation.z,
                -0.8,
                5,
                dt,
              );
              L.armL.elbow.rotation.x = damp(
                L.armL.elbow.rotation.x,
                -0.42,
                5,
                dt,
              );
              L.armR.elbow.rotation.x = damp(
                L.armR.elbow.rotation.x,
                -0.42,
                5,
                dt,
              );
              L.legL.hip.rotation.x = damp(
                L.legL.hip.rotation.x,
                -0.16 + sway,
                4,
                dt,
              );
              L.legR.hip.rotation.x = damp(
                L.legR.hip.rotation.x,
                -0.02 - sway,
                4,
                dt,
              );
              L.legL.knee.rotation.x = damp(L.legL.knee.rotation.x, 0.3, 4, dt);
              L.legR.knee.rotation.x = damp(L.legR.knee.rotation.x, 0.2, 4, dt);
              L.head.rotation.x = damp(L.head.rotation.x, -0.1, 4, dt);
              ch.mesh.rotation.x = damp(ch.mesh.rotation.x, 0, 3.5, dt);
            }
            if (T) {
              T.position.y = damp(T.position.y, hipY, 6, dt);
              T.rotation.x = damp(T.rotation.x, 0, 5, dt);
              T.rotation.y = damp(T.rotation.y, 0, 5, dt);
              T.rotation.z = damp(T.rotation.z, sway * 0.5, 5, dt);
            }
            ch.mesh.position.y = ch.y;
            ch.mesh.rotation.y = ch.yaw;
            ch.mesh.rotation.z = 0;
            applyHurtFlash(ch, dt);
            return;
          }

          /* ============================= DRIVING ================================ */
          if (ch.vehicle || ch.state === "vehicle") {
            var isBoat = !!(ch.vehicle && ch.vehicle.type === "boat");
            var wob =
              Math.sin(ch.animT * 7) *
              0.02 *
              clamp(Math.abs(ch.vehicle ? ch.vehicle.speed : 0) / 12, 0, 1);
            /* Seated: thighs forward and level, shins tucked so the feet stay inside
       the chassis, hands out on the wheel. The torso pivot drops 0.35 so the
       head clears the roof -- the rig has a long torso and short legs, so
       without this the character's head pokes straight through it. */
            L.legL.hip.rotation.x = damp(L.legL.hip.rotation.x, -1.55, 9, dt);
            L.legR.hip.rotation.x = damp(L.legR.hip.rotation.x, -1.55, 9, dt);
            L.legL.knee.rotation.x = damp(L.legL.knee.rotation.x, 0.35, 9, dt);
            L.legR.knee.rotation.x = damp(L.legR.knee.rotation.x, 0.35, 9, dt);
            L.legL.foot.rotation.x = damp(L.legL.foot.rotation.x, 0.15, 9, dt);
            L.legR.foot.rotation.x = damp(L.legR.foot.rotation.x, 0.15, 9, dt);
            L.armL.shoulder.rotation.x = damp(
              L.armL.shoulder.rotation.x,
              -1.36 + wob,
              8,
              dt,
            );
            L.armR.shoulder.rotation.x = damp(
              L.armR.shoulder.rotation.x,
              -1.36 - wob,
              8,
              dt,
            );
            L.armL.shoulder.rotation.z = damp(
              L.armL.shoulder.rotation.z,
              0.4,
              8,
              dt,
            );
            L.armR.shoulder.rotation.z = damp(
              L.armR.shoulder.rotation.z,
              -0.4,
              8,
              dt,
            );
            L.armL.elbow.rotation.x = damp(
              L.armL.elbow.rotation.x,
              -0.95,
              8,
              dt,
            );
            L.armR.elbow.rotation.x = damp(
              L.armR.elbow.rotation.x,
              -0.95,
              8,
              dt,
            );
            L.head.rotation.x = damp(L.head.rotation.x, 0, 6, dt);
            L.head.rotation.y = damp(L.head.rotation.y, 0, 6, dt);
            if (T) {
              T.position.y = damp(T.position.y, SEAT_PIVOT, 8, dt);
              T.position.x = damp(T.position.x, 0, 8, dt);
              T.rotation.x = damp(T.rotation.x, -0.06, 8, dt);
              T.rotation.y = damp(T.rotation.y, 0, 8, dt);
              T.rotation.z = damp(T.rotation.z, 0, 8, dt);
            }
            /* Drop the mesh so the seated PELVIS lands exactly on the vehicle's
       cushion, rather than guessing an offset from ch.y -- the two used to
       disagree by 0.38 and the driver's head poked out through the roof.
       ch.y tracks v.y + 1.0 (car) / +0.9 (boat), which is not a seat. */
            var vv = ch.vehicle;
            var seatY = isBoat ? VEH_SEAT_BOAT : VEH_SEAT_CAR;
            var base = vv && isFinite(vv.y) ? vv.y : ch.y - 1.0;
            ch.mesh.position.y = base + seatY - SEAT_PELVIS;
            ch.mesh.rotation.y = ch.yaw;
            ch.mesh.rotation.x = damp(ch.mesh.rotation.x, 0, 7, dt);
            ch.mesh.rotation.z = damp(ch.mesh.rotation.z, 0, 7, dt);
            applyHurtFlash(ch, dt);
            return;
          }

          /* ============================ ON FOOT ================================= */
          ch.mesh.rotation.x = damp(ch.mesh.rotation.x, 0, 7, dt);
          ch.mesh.rotation.z = damp(ch.mesh.rotation.z, -turn * 0.1, 9, dt);
          var amt = clamp(sp / CFG.RUN, 0, 1.35);
          var sprintF = clamp(
            (sp - CFG.RUN) / Math.max(1, CFG.SPRINT - CFG.RUN),
            0,
            1,
          );
          var crouch = !!(ch.crouch || ch.using);
          var baseY = ch.y,
            tx = 0,
            lean = 0,
            roll = -turn * 0.12,
            twist = 0;

          if (!ch.grounded) {
            /* --- airborne: legs tuck on the way up, reach for the ground on the way
       down; arms come out for balance --- */
            var up = clamp(ch.vy / CFG.JUMP, 0, 1),
              dn = clamp(-ch.vy / 16, 0, 1);
            L.legL.hip.rotation.x = damp(
              L.legL.hip.rotation.x,
              -0.58 * up + 0.3 * dn,
              9,
              dt,
            );
            L.legR.hip.rotation.x = damp(
              L.legR.hip.rotation.x,
              0.34 * up - 0.1 * dn,
              9,
              dt,
            );
            L.legL.knee.rotation.x = damp(
              L.legL.knee.rotation.x,
              0.98 * up + 0.3 * dn,
              9,
              dt,
            );
            L.legR.knee.rotation.x = damp(
              L.legR.knee.rotation.x,
              0.42 * up + 0.14 * dn,
              9,
              dt,
            );
            L.legL.foot.rotation.x = damp(
              L.legL.foot.rotation.x,
              0.26 * up,
              9,
              dt,
            );
            L.legR.foot.rotation.x = damp(
              L.legR.foot.rotation.x,
              0.2 * up,
              9,
              dt,
            );
            L.armL.shoulder.rotation.x = damp(
              L.armL.shoulder.rotation.x,
              -1.05 - up * 0.35,
              8,
              dt,
            );
            L.armR.shoulder.rotation.x = damp(
              L.armR.shoulder.rotation.x,
              -1.25 - up * 0.3,
              8,
              dt,
            );
            L.armL.shoulder.rotation.z = damp(
              L.armL.shoulder.rotation.z,
              0.3 + up * 0.35,
              8,
              dt,
            );
            L.armR.shoulder.rotation.z = damp(
              L.armR.shoulder.rotation.z,
              -0.3 - up * 0.35,
              8,
              dt,
            );
            L.armL.elbow.rotation.x = damp(
              L.armL.elbow.rotation.x,
              -0.45,
              8,
              dt,
            );
            L.armR.elbow.rotation.x = damp(
              L.armR.elbow.rotation.x,
              -0.7,
              8,
              dt,
            );
            lean = 0.1 + dn * 0.16;
          } else if (sp > 0.35) {
            /* --- locomotion: hip/knee/ankle cycle with counter-swinging arms --- */
            ch.walkPhase += dt * (2.4 + sp * 1.18);
            var p = ch.walkPhase,
              s = Math.sin(p),
              c = Math.cos(p);
            var A = 0.6 * amt,
              K = 1.02 * amt;
            L.legL.hip.rotation.x = -s * A;
            L.legR.hip.rotation.x = s * A;
            /* the knee folds hardest through the swing phase, when the hip is
       travelling forward */
            L.legL.knee.rotation.x = 0.1 + K * Math.max(0, Math.sin(p + 2.15));
            L.legR.knee.rotation.x =
              0.1 + K * Math.max(0, Math.sin(p + 2.15 + Math.PI));
            /* ankles: toes down at push-off, toes up to clear the ground mid-swing */
            L.legL.foot.rotation.x = -s * 0.3 * amt;
            L.legR.foot.rotation.x = s * 0.3 * amt;
            /* footstep dust: one puff per foot plant, i.e. twice per stride cycle */
            var sgn = s >= 0 ? 1 : -1;
            if (sgn !== ch.lastStepSign) {
              ch.lastStepSign = sgn;
              if (sp > 3.6 && (ch.isPlayer || nearPlayer(ch.x, ch.z, 46)))
                fxSmoke(ch.x, ch.y + 0.05, ch.z, 1, 0.4, 0.45, 0.5);
            }
            /* arms counter-swing against the legs (a held gun overrides this below) */
            L.armL.shoulder.rotation.x = damp(
              L.armL.shoulder.rotation.x,
              s * A * 1.05,
              14,
              dt,
            );
            L.armR.shoulder.rotation.x = damp(
              L.armR.shoulder.rotation.x,
              -s * A * 1.05,
              14,
              dt,
            );
            L.armL.shoulder.rotation.z = damp(
              L.armL.shoulder.rotation.z,
              0.1,
              12,
              dt,
            );
            L.armR.shoulder.rotation.z = damp(
              L.armR.shoulder.rotation.z,
              -0.1,
              12,
              dt,
            );
            L.armL.elbow.rotation.x = damp(
              L.armL.elbow.rotation.x,
              -0.3 - Math.max(0, s * A) * 0.9,
              12,
              dt,
            );
            L.armR.elbow.rotation.x = damp(
              L.armR.elbow.rotation.x,
              -0.3 - Math.max(0, -s * A) * 0.9,
              12,
              dt,
            );
            /* body: two vertical bobs per stride, hips riding over the stance foot */
            baseY += (Math.abs(c) - 0.42) * 0.075 * amt;
            tx = s * 0.03 * amt;
            twist = s * 0.17 * amt;
            lean = 0.11 * amt + sprintF * 0.2;
            roll += -s * 0.045 * amt;
          } else {
            /* --- idle: slow weight shift, breathing, head slightly alive --- */
            var sh = Math.sin(ch.animT * 0.55),
              br = Math.sin(ch.animT * 1.9) * 0.022;
            L.legL.hip.rotation.x = damp(
              L.legL.hip.rotation.x,
              sh * 0.05,
              6,
              dt,
            );
            L.legR.hip.rotation.x = damp(
              L.legR.hip.rotation.x,
              -sh * 0.05,
              6,
              dt,
            );
            L.legL.knee.rotation.x = damp(
              L.legL.knee.rotation.x,
              0.09 + Math.max(0, sh) * 0.1,
              6,
              dt,
            );
            L.legR.knee.rotation.x = damp(
              L.legR.knee.rotation.x,
              0.09 + Math.max(0, -sh) * 0.1,
              6,
              dt,
            );
            L.legL.foot.rotation.x = damp(L.legL.foot.rotation.x, 0, 6, dt);
            L.legR.foot.rotation.x = damp(L.legR.foot.rotation.x, 0, 6, dt);
            L.armL.shoulder.rotation.x = damp(
              L.armL.shoulder.rotation.x,
              -0.05 + br,
              6,
              dt,
            );
            L.armR.shoulder.rotation.x = damp(
              L.armR.shoulder.rotation.x,
              -0.13 + br,
              6,
              dt,
            );
            L.armL.shoulder.rotation.z = damp(
              L.armL.shoulder.rotation.z,
              0.09,
              6,
              dt,
            );
            L.armR.shoulder.rotation.z = damp(
              L.armR.shoulder.rotation.z,
              -0.09,
              6,
              dt,
            );
            L.armL.elbow.rotation.x = damp(
              L.armL.elbow.rotation.x,
              -0.24,
              6,
              dt,
            );
            L.armR.elbow.rotation.x = damp(
              L.armR.elbow.rotation.x,
              -0.32,
              6,
              dt,
            );
            tx = sh * 0.012;
            lean = br * 0.6;
            twist = sh * 0.035;
          }

          /* --- crouch: drop the whole body and fold the legs ---
     Ramping weight + lerp, NOT a damp. Two damped targets that fight each
     other settle at a weighted blend of the two no matter how long the key is
     held, so crouching only ever got the legs halfway down. A weight that
     reaches 1 makes the override exact. */
          ch.crouchW = clamp(
            (ch.crouchW || 0) + (crouch ? dt * 7 : -dt * 7),
            0,
            1,
          );
          if (ch.crouchW > 0.001) {
            var cw = ch.crouchW;
            L.legL.hip.rotation.x = lerp(L.legL.hip.rotation.x, -0.62, cw);
            L.legR.hip.rotation.x = lerp(L.legR.hip.rotation.x, -0.62, cw);
            L.legL.knee.rotation.x = lerp(L.legL.knee.rotation.x, 1.18, cw);
            L.legR.knee.rotation.x = lerp(L.legR.knee.rotation.x, 1.18, cw);
            baseY -= 0.42 * cw;
            lean += 0.16 * cw;
          }
          /* --- landing absorb: knees fold, body sinks, then springs back --- */
          if (ch.landAnim > 0) {
            ch.landAnim -= dt;
            var la = clamp(ch.landAnim / 0.28, 0, 1);
            L.legL.knee.rotation.x += la * 0.62;
            L.legR.knee.rotation.x += la * 0.62;
            L.legL.hip.rotation.x -= la * 0.22;
            L.legR.hip.rotation.x -= la * 0.22;
            baseY -= la * 0.3;
            lean += la * 0.2;
          }
          /* --- step-up assist: lift the leading knee as we clear the lip --- */
          if (ch.stepLift > 0) {
            var sk = clamp(ch.stepLift / 0.26, 0, 1);
            var sdx = Math.sin(ch.stepDir || 0),
              sdz = Math.cos(ch.stepDir || 0);
            /* which side of the body the step is on: +1 = the character's right */
            var side = sdx * -Math.cos(ch.yaw) + sdz * Math.sin(ch.yaw);
            if (side >= 0) {
              L.legR.knee.rotation.x += sk * 0.95;
              L.legR.hip.rotation.x -= sk * 0.45;
            } else {
              L.legL.knee.rotation.x += sk * 0.95;
              L.legL.hip.rotation.x -= sk * 0.45;
            }
            baseY += sk * 0.11;
            lean += sk * 0.14;
          }

          /* --- weapon hold: settle the arms onto the grip of whatever is held.
     Ramping weight so the hold OVERRIDES the arm swing instead of fighting it
     to a standstill; the arms now actually reach the grip. --- */
          ch.holdW = clamp((ch.holdW || 0) + (gun ? dt * 6 : -dt * 6), 0, 1);
          if (ch.holdW > 0.001) {
            var cls = HOLD_POSE[gun ? hold : "rifle"] || HOLD_POSE.rifle;
            var hp = gun && ch.aiming ? cls.aim : cls.carry;
            var hw = ch.holdW;
            L.armR.shoulder.rotation.x = lerp(
              L.armR.shoulder.rotation.x,
              hp.rsx,
              hw,
            );
            L.armR.shoulder.rotation.z = lerp(
              L.armR.shoulder.rotation.z,
              hp.rsz,
              hw,
            );
            L.armR.elbow.rotation.x = lerp(L.armR.elbow.rotation.x, hp.rex, hw);
            L.armL.shoulder.rotation.x = lerp(
              L.armL.shoulder.rotation.x,
              hp.lsx,
              hw,
            );
            L.armL.shoulder.rotation.z = lerp(
              L.armL.shoulder.rotation.z,
              hp.lsz,
              hw,
            );
            L.armL.elbow.rotation.x = lerp(L.armL.elbow.rotation.x, hp.lex, hw);
            /* aiming squares the shoulders up to the camera */
            if (ch.aiming) {
              twist *= 0.35;
              roll *= 0.4;
            }
          } else if (!gun) {
            /* pickaxe: the left hand is free, so let the right arm hang naturally */
            L.armR.shoulder.rotation.z = damp(
              L.armR.shoulder.rotation.z,
              -0.16,
              8,
              dt,
            );
            L.armR.elbow.rotation.x = damp(
              L.armR.elbow.rotation.x,
              -0.3,
              8,
              dt,
            );
          }

          /* --- consuming a heal: the left hand comes up to the face --- */
          ch.useW = clamp((ch.useW || 0) + (ch.using ? dt * 9 : -dt * 9), 0, 1);
          if (ch.using) ch.useAnim += dt;
          else ch.useAnim = 0;
          if (ch.useW > 0.001) {
            var uw = ch.useW;
            L.armL.shoulder.rotation.x = lerp(
              L.armL.shoulder.rotation.x,
              -1.62 + Math.sin(ch.useAnim * 9) * 0.07,
              uw,
            );
            L.armL.shoulder.rotation.z = lerp(
              L.armL.shoulder.rotation.z,
              0.52,
              uw,
            );
            L.armL.elbow.rotation.x = lerp(L.armL.elbow.rotation.x, -1.55, uw);
            lean += 0.1 * uw;
          }

          /* --- reload: the firing hand dips, the support hand goes for the mag.
     The sine envelope peaks mid-reload and returns to 0, so lerping against it
     blends the pose in and out with no pop and no fighting the hold. --- */
          if (ch.reloading) {
            var rwp = Math.sin(
              clamp(ch.reloading.t / ch.reloading.total, 0, 1) * Math.PI,
            );
            L.armR.shoulder.rotation.x -= rwp * 0.26;
            L.armR.elbow.rotation.x -= rwp * 0.34;
            L.armL.shoulder.rotation.x = lerp(
              L.armL.shoulder.rotation.x,
              -1.15,
              rwp,
            );
            L.armL.shoulder.rotation.z = lerp(
              L.armL.shoulder.rotation.z,
              0.72,
              rwp,
            );
            L.armL.elbow.rotation.x = lerp(L.armL.elbow.rotation.x, -1.55, rwp);
            lean += rwp * 0.09;
          }

          /* --- recoil kick --- */
          if (ch.recoil > 0) {
            ch.recoil = Math.max(0, ch.recoil - dt * 3.4);
            var rc = ch.recoil;
            L.armR.shoulder.rotation.x -= rc * 0.34;
            L.armR.elbow.rotation.x -= rc * 0.22;
            L.armL.shoulder.rotation.x -= rc * 0.1;
            lean -= rc * 0.05;
          }
          if (ch.bloom > 0) ch.bloom = Math.max(0, ch.bloom - dt * 4.5);

          /* --- pickaxe / melee swing: wind up, chop, recover --------------------
     Nothing used to animate the melee attack at all -- the pickaxe just sat
     in the hand while the sound played. This drives the right arm through a
     three-phase arc and counter-rotates the torso into the chop. */
          if (ch.swingT < ch.swingDur) {
            ch.swingT += dt;
            var st = clamp(ch.swingT / Math.max(0.06, ch.swingDur), 0, 1);
            var wx, wex, wsz, wtw, wln;
            if (st < 0.3) {
              /* wind up, twist away */
              var q1 = smooth01(st / 0.3);
              wx = lerp(-0.3, 0.64, q1);
              wex = lerp(-0.3, -1.72, q1);
              wsz = lerp(-0.16, -0.56, q1);
              wtw = lerp(0, -0.36, q1);
              wln = lerp(lean, -0.08, q1);
            } else if (st < 0.58) {
              /* the chop itself */
              var q2 = smooth01((st - 0.3) / 0.28);
              wx = lerp(0.64, -1.98, q2);
              wex = lerp(-1.72, -0.1, q2);
              wsz = lerp(-0.56, 0.18, q2);
              wtw = lerp(-0.36, 0.34, q2);
              wln = lerp(-0.08, 0.32, q2);
            } else {
              /* recover to the carry pose */
              var q3 = smooth01((st - 0.58) / 0.42);
              wx = lerp(-1.98, -0.55, q3);
              wex = lerp(-0.1, -0.48, q3);
              wsz = lerp(0.18, -0.16, q3);
              wtw = lerp(0.34, 0, q3);
              wln = lerp(0.32, 0, q3);
            }
            L.armR.shoulder.rotation.x = wx;
            L.armR.shoulder.rotation.z = wsz;
            L.armR.elbow.rotation.x = wex;
            L.armL.shoulder.rotation.x = damp(
              L.armL.shoulder.rotation.x,
              -0.5,
              10,
              dt,
            );
            L.armL.shoulder.rotation.z = damp(
              L.armL.shoulder.rotation.z,
              0.28,
              10,
              dt,
            );
            L.armL.elbow.rotation.x = damp(
              L.armL.elbow.rotation.x,
              -0.55,
              10,
              dt,
            );
            twist = wtw;
            lean = wln;
          }

          /* --- mantle: both hands slam onto the lip, then the body swings up and
     over. `mantleAnim` runs 1 -> 0 across the climb, so the pose below is
     written against that: reach at the start, tuck through the middle, settle
     at the end. Placed AFTER the weapon-hold override on purpose -- otherwise
     a held rifle would win and the hands would stay on the gun while the
     character hauls himself over a wall. --- */
          if (ch.mantleAnim > 0) {
            var mq = clamp(ch.mantleAnim, 0, 1); /* 1 = just grabbed the lip */
            var reach = smooth01(
              clamp((1 - mq) * 2.6, 0, 1),
            ); /* 0 -> 1 as the hands plant */
            var pull = smooth01(clamp((1 - mq - 0.35) / 0.65, 0, 1));
            var aRx = lerp(-2.35, -0.55, reach * 0.55 + pull * 0.45);
            L.armL.shoulder.rotation.x = aRx;
            L.armR.shoulder.rotation.x = aRx;
            L.armL.shoulder.rotation.z = lerp(0.34, 0.14, pull);
            L.armR.shoulder.rotation.z = lerp(-0.34, -0.14, pull);
            L.armL.elbow.rotation.x = lerp(-0.3, -0.85, pull);
            L.armR.elbow.rotation.x = lerp(-0.3, -0.85, pull);
            /* the legs tuck up to clear the lip, then drop to catch the landing */
            var tuck =
              smooth01(clamp((1 - mq) * 1.8, 0, 1)) *
              (1 - smooth01(clamp((1 - mq - 0.62) / 0.38, 0, 1)));
            L.legL.hip.rotation.x = -1.15 * tuck;
            L.legR.hip.rotation.x = -0.72 * tuck;
            L.legL.knee.rotation.x = 1.55 * tuck;
            L.legR.knee.rotation.x = 1.05 * tuck;
            L.legL.foot.rotation.x = 0.3 * tuck;
            L.legR.foot.rotation.x = 0.22 * tuck;
            baseY += 0.1 * tuck;
            lean += 0.34 * (1 - pull) + 0.1;
          }

          /* --- head tracks the aim pitch, minus the torso lean, so it stays level --- */
          var ap = clamp(
            (ch.pitch || 0) * (ch.aiming ? 0.75 : 0.55),
            -0.55,
            0.55,
          );
          L.head.rotation.x = damp(L.head.rotation.x, -ap - lean * 0.55, 8, dt);
          L.head.rotation.y = damp(
            L.head.rotation.y,
            clamp(-turn * 0.22, -0.3, 0.3),
            8,
            dt,
          );
          L.head.rotation.z = damp(L.head.rotation.z, 0, 8, dt);

          /* --- write the upper-body transform --- */
          if (T) {
            T.position.x = damp(T.position.x, tx, 14, dt);
            T.position.y = damp(T.position.y, hipY, 10, dt);
            T.rotation.x = damp(T.rotation.x, lean, 11, dt);
            T.rotation.y = damp(T.rotation.y, twist, 11, dt);
            T.rotation.z = damp(T.rotation.z, roll, 10, dt);
          }
          ch.mesh.position.y = baseY;
          ch.mesh.rotation.y = ch.yaw;
          applyHurtFlash(ch, dt);
        }

        /* Death fall-over. `eliminate` used to hide the mesh the instant a character
   died, which popped them out of existence. Instead we keep the body for a
   beat and topple it, then hide it once it is flat. */
        function animateDeath(ch, dt) {
          if (ch.onBus || !ch.mesh) {
            ch.mesh && (ch.mesh.visible = false);
            return;
          }
          if (ch.deathT === undefined) {
            ch.deathT = 0;
          }
          ch.deathT += dt;
          var t = clamp(ch.deathT / 0.75, 0, 1);
          var e = 1 - (1 - t) * (1 - t); /* ease-out */
          var L = ch.limbs,
            T = L.torso;
          L.legL.hip.rotation.x = damp(L.legL.hip.rotation.x, -0.35, 7, dt);
          L.legR.hip.rotation.x = damp(L.legR.hip.rotation.x, 0.22, 7, dt);
          L.legL.knee.rotation.x = damp(L.legL.knee.rotation.x, 0.55, 7, dt);
          L.legR.knee.rotation.x = damp(L.legR.knee.rotation.x, 0.3, 7, dt);
          L.armL.shoulder.rotation.x = damp(
            L.armL.shoulder.rotation.x,
            -0.55,
            7,
            dt,
          );
          L.armR.shoulder.rotation.x = damp(
            L.armR.shoulder.rotation.x,
            -0.35,
            7,
            dt,
          );
          L.armL.shoulder.rotation.z = damp(
            L.armL.shoulder.rotation.z,
            0.95,
            7,
            dt,
          );
          L.armR.shoulder.rotation.z = damp(
            L.armR.shoulder.rotation.z,
            -0.95,
            7,
            dt,
          );
          L.armL.elbow.rotation.x = damp(L.armL.elbow.rotation.x, -0.35, 7, dt);
          L.armR.elbow.rotation.x = damp(L.armR.elbow.rotation.x, -0.35, 7, dt);
          L.head.rotation.x = damp(L.head.rotation.x, -0.25, 6, dt);
          if (T) {
            T.position.y = damp(T.position.y, CH_HIP, 8, dt);
            T.rotation.x = damp(T.rotation.x, -0.2, 6, dt);
            T.rotation.z = damp(T.rotation.z, 0.12, 6, dt);
          }
          ch.mesh.visible = true;
          ch.mesh.position.set(ch.x, ch.y + Math.sin(e * Math.PI) * 0.12, ch.z);
          ch.mesh.rotation.set(-e * Math.PI * 0.5, ch.yaw, 0);
          applyHurtFlash(ch, dt);
          if (ch.deathT > 1.15) ch.mesh.visible = false;
        }
        /* Weapon aim correction.
   The weapon models are built with the barrel along +Z, but they are parented
   to a hand that hangs along the arm's -Y axis. Raising the arm forward to hold
   a gun (shoulder.x ~= -1.52, elbow.x ~= -0.52) therefore swings the barrel to
   point almost straight UP. Counter-rotating by the arm's accumulated X angle
   puts the barrel back on the character's forward axis, at every pose.
   Wrapping poseChar (rather than patching each branch) covers all the early
   returns -- knocked / skydive / glide / vehicle. */
        var _qA = new THREE.Quaternion(),
          _qB = new THREE.Quaternion(),
          _eA = new THREE.Euler();
        /* Slight nose-down tilt so the held item reads as "carried", not "fired". */
        var _QDESIRED = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(-0.12, 0, 0),
        );
        /* Keep the held weapon pointing along the character's forward axis no matter
   what the arm is doing. The rig only ever rotates shoulder.x, shoulder.z and
   elbow.x, so the hand's orientation relative to the body is exactly
   Rx(sx)*Rz(sz)*Rx(ex) -- inverting that and re-applying a fixed forward
   orientation is exact. The earlier version compensated only the X component,
   so the shoulder's Z roll was left in and swung the weapon out sideways. */
        function aimWeapon(ch) {
          var m = ch.weaponMesh;
          if (!m) return;
          var a = ch.limbs.armR;
          _eA.set(a.shoulder.rotation.x || 0, 0, a.shoulder.rotation.z || 0);
          _qA.setFromEuler(_eA);
          _eA.set(a.elbow.rotation.x || 0, 0, 0);
          _qB.setFromEuler(_eA);
          _qA.multiply(_qB);
          _qA.invert();
          m.quaternion.copy(_qA).multiply(_QDESIRED);
        }
        function animateChar(ch, dt) {
          poseChar(ch, dt);
          aimWeapon(ch);
        }
        function applyHurtFlash(ch, dt) {
          if (ch.hurtFlash > 0) {
            ch.hurtFlash -= dt;
            var f = Math.max(0, ch.hurtFlash) * 3;
            for (var i = 0; i < ch.mats3d.length; i++) {
              ch.mats3d[i].emissive.setRGB(f * 0.9, f * 0.05, f * 0.05);
              ch.mats3d[i].emissiveIntensity = 1;
            }
            if (ch.hurtFlash <= 0) restoreCharEmissive(ch);
          }
        }
        /* Restore each material's own glow (accent trims are emissive by design), not
   a blanket black -- otherwise the first hit permanently kills the accents. */
        function restoreCharEmissive(ch) {
          for (var j = 0; j < ch.mats3d.length; j++) {
            var m = ch.mats3d[j];
            if (m.userData && m.userData.baseEm)
              m.emissive.copy(m.userData.baseEm);
            else m.emissive.setRGB(0, 0, 0);
            m.emissiveIntensity =
              m.userData && m.userData.baseEmI !== undefined
                ? m.userData.baseEmI
                : 1;
          }
        }
        function syncChar(ch) {
          ch.mesh.position.set(ch.x, ch.mesh.position.y, ch.z);
          ch.mesh.rotation.y = ch.yaw;
          ch.mesh.visible = ch.alive && !ch.onBus;
        }

        /* ============================================================================
   Vehicles
   ========================================================================== */
        var VEHICLES = [];
        var VMAT = null;
        function initVehicleMats() {
          if (VMAT) return;
          VMAT = {
            body: new THREE.MeshStandardMaterial({
              color: col(0x3f7fd6),
              metalness: 0.6,
              roughness: 0.32,
            }),
            dark: new THREE.MeshStandardMaterial({
              color: col(0x1a1e26),
              roughness: 0.7,
            }),
            glass: new THREE.MeshStandardMaterial({
              color: col(0x9fd8ff),
              metalness: 0.4,
              roughness: 0.06,
              transparent: true,
              opacity: 0.55,
            }),
            tyre: new THREE.MeshStandardMaterial({
              color: col(0x14161a),
              roughness: 0.9,
            }),
            rim: new THREE.MeshStandardMaterial({
              color: col(0xb8bec6),
              metalness: 0.85,
              roughness: 0.28,
            }),
            lamp: new THREE.MeshStandardMaterial({
              color: col(0xfff4cc),
              emissive: col(0xffe9a0),
              emissiveIntensity: 1.4,
            }),
            hull: new THREE.MeshStandardMaterial({
              color: col(0xe8e8ee),
              metalness: 0.3,
              roughness: 0.4,
            }),
          };
        }
        function makeCarMesh(colorHex) {
          initVehicleMats();
          var g = new THREE.Group();
          var body = VMAT.body.clone();
          body.color = col(colorHex);
          function b(w, h, d, x, y, z, m) {
            var q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || body);
            q.position.set(x, y, z);
            q.castShadow = true;
            q.receiveShadow = true;
            g.add(q);
            return q;
          }
          b(2.0, 0.8, 4.4, 0, 0.8, 0);
          /* Cabin as a shell (roof + pillars) rather than one solid block, so the
     seated driver is actually visible through the glass instead of being
     buried inside the bodywork. Merged into a single mesh so the extra pieces
     cost one draw call rather than seven. Roof height comes from VEH_ROOF_CAR
     so it is guaranteed to clear the seated rig (see the SEAT_* block). */
          var cab = new PartBag(g);
          cab.add(
            CH_GEO.box,
            body,
            0,
            VEH_ROOF_CAR + 0.06,
            -0.25,
            0,
            0,
            0,
            1.86,
            0.12,
            2.24,
          ); /* roof */
          cab.add(
            CH_GEO.box,
            body,
            -0.86,
            1.55,
            0.78,
            0,
            0,
            0,
            0.14,
            0.7,
            0.16,
          ); /* A pillars */
          cab.add(CH_GEO.box, body, 0.86, 1.55, 0.78, 0, 0, 0, 0.14, 0.7, 0.16);
          cab.add(
            CH_GEO.box,
            body,
            -0.86,
            1.55,
            -1.28,
            0,
            0,
            0,
            0.14,
            0.7,
            0.16,
          ); /* C pillars */
          cab.add(
            CH_GEO.box,
            body,
            0.86,
            1.55,
            -1.28,
            0,
            0,
            0,
            0.14,
            0.7,
            0.16,
          );
          cab.add(
            CH_GEO.box,
            body,
            -0.86,
            1.55,
            -0.25,
            0,
            0,
            0,
            0.14,
            0.68,
            0.14,
          ); /* B pillars */
          cab.add(
            CH_GEO.box,
            body,
            0.86,
            1.55,
            -0.25,
            0,
            0,
            0,
            0.14,
            0.68,
            0.14,
          );
          cab.flush();
          b(1.7, 0.56, 0.12, 0, 1.58, 0.9, VMAT.glass);
          b(1.7, 0.56, 0.12, 0, 1.58, -1.42, VMAT.glass);
          b(0.12, 0.56, 1.9, -0.93, 1.58, -0.25, VMAT.glass);
          b(0.12, 0.56, 1.9, 0.93, 1.58, -0.25, VMAT.glass);
          b(1.9, 0.24, 4.5, 0, 0.42, 0, VMAT.dark);
          /* seat cushion the driver actually sits on -- top must equal VEH_SEAT_CAR */
          b(0.78, 0.18, 0.74, 0, VEH_SEAT_CAR - 0.09, -0.1, VMAT.dark);
          b(0.78, 0.46, 0.14, 0, VEH_SEAT_CAR + 0.16, -0.44, VMAT.dark);
          b(1.96, 0.16, 0.5, 0, 0.66, 2.24, VMAT.dark);
          b(1.96, 0.16, 0.5, 0, 0.66, -2.24, VMAT.dark);
          b(0.5, 0.22, 0.12, -0.66, 0.98, 2.3, VMAT.lamp);
          b(0.5, 0.22, 0.12, 0.66, 0.98, 2.3, VMAT.lamp);
          b(0.5, 0.18, 0.1, -0.66, 0.98, -2.3, VMAT.dark);
          b(0.5, 0.18, 0.1, 0.66, 0.98, -2.3, VMAT.dark);
          var wheels = [];
          var wg = new THREE.CylinderGeometry(0.46, 0.46, 0.34, 14);
          wg.rotateZ(Math.PI / 2);
          var rg = new THREE.CylinderGeometry(0.24, 0.24, 0.36, 10);
          rg.rotateZ(Math.PI / 2);
          var pos = [
            [-1.02, 1.42],
            [1.02, 1.42],
            [-1.02, -1.42],
            [1.02, -1.42],
          ];
          for (var i = 0; i < 4; i++) {
            var w = new THREE.Mesh(wg, VMAT.tyre);
            w.position.set(pos[i][0], 0.46, pos[i][1]);
            w.castShadow = true;
            g.add(w);
            var r = new THREE.Mesh(rg, VMAT.rim);
            r.position.copy(w.position);
            r.castShadow = false;
            g.add(r);
            wheels.push(w);
          }
          return { group: g, wheels: wheels, lamp: null };
        }
        function makeBoatMesh() {
          initVehicleMats();
          var g = new THREE.Group();
          function b(w, h, d, x, y, z, m) {
            var q = new THREE.Mesh(
              new THREE.BoxGeometry(w, h, d),
              m || VMAT.hull,
            );
            q.position.set(x, y, z);
            q.castShadow = true;
            q.receiveShadow = true;
            g.add(q);
            return q;
          }
          b(2.4, 0.7, 5.0, 0, 0.5, 0);
          b(2.0, 0.5, 4.6, 0, 0.95, -0.1, VMAT.dark);
          b(1.5, 0.5, 1.2, 0, 1.3, 1.1, VMAT.hull);
          b(1.6, 0.5, 0.3, 0, 1.3, -2.1, VMAT.hull);
          b(0.9, 0.6, 0.7, 0, 1.2, -2.6, VMAT.dark);
          var p = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 1.5, 6),
            VMAT.rim,
          );
          p.position.set(0, 1.75, -2.9);
          g.add(p);
          return { group: g, wheels: [], lamp: null };
        }
        function createVehicles() {
          initVehicleMats();
          var spots = [];
          /* a few by each POI, a few along roads */
          for (var i = 0; i < POIS.length; i++) {
            var p = POIS[i];
            var n = p.f === poiAirfield ? 2 : 1;
            for (var k = 0; k < n; k++) {
              var a = rnd(0, 6.28),
                r = p.r * rnd(0.55, 0.95);
              var x = p.x + Math.cos(a) * r,
                z = p.z + Math.sin(a) * r;
              if (terrainHeightAt(x, z) < CFG.SEA + 1.4) continue;
              spots.push({ x: x, z: z });
            }
          }
          for (var r2 = 0; r2 < ROADS.length; r2 += 2) {
            var A = POIS[ROADS[r2][0]],
              B = POIS[ROADS[r2][1]];
            if (!A || !B) continue;
            var t = rnd(0.25, 0.75);
            var x2 = A.x + (B.x - A.x) * t,
              z2 = A.z + (B.z - A.z) * t;
            var nx = -(B.z - A.z),
              nz = B.x - A.x;
            var nl = Math.sqrt(nx * nx + nz * nz) || 1;
            x2 += (nx / nl) * rnd(5, 8);
            z2 += (nz / nl) * rnd(5, 8);
            if (terrainHeightAt(x2, z2) > CFG.SEA + 1.2)
              spots.push({ x: x2, z: z2 });
          }
          var colors = [
            0x3f7fd6, 0xd6d6d6, 0xc23b3b, 0x2f2f2f, 0x2fae6a, 0xffd23f,
            0x8a4fd0, 0xe8e2d0,
          ];
          for (var s = 0; s < spots.length; s++) {
            var sp = spots[s];
            var y = terrainHeightAt(sp.x, sp.z);
            var mk = makeCarMesh(pickOne(colors));
            mk.group.position.set(sp.x, y, sp.z);
            mk.group.rotation.y = rnd(0, 6.28);
            worldGroup.add(mk.group);
            VEHICLES.push({
              type: "car",
              mesh: mk.group,
              wheels: mk.wheels,
              x: sp.x,
              y: y,
              z: sp.z,
              yaw: mk.group.rotation.y,
              speed: 0,
              vy: 0,
              driver: null,
              boost: 1,
              hp: 600,
              wheelSpin: 0,
              radius: 1.5,
              len: 2.4,
              hover: 0,
              /* AABB collider for world collision */
              col: {
                minX: sp.x - 1.8, maxX: sp.x + 1.8,
                minY: y - 0.5, maxY: y + 2.2,
                minZ: sp.z - 1.3, maxZ: sp.z + 1.3,
              },
            });
            colliders.insert(VEHICLES[VEHICLES.length - 1].col);
          }
          /* boats near the shoreline */
          var made = 0,
            tries = 0;
          while (made < 7 && tries < 600) {
            tries++;
            var a2 = rnd(0, 6.28),
              r3 = rnd(232, 262);
            var bx = Math.cos(a2) * r3,
              bz = Math.sin(a2) * r3;
            if (terrainHeightAt(bx, bz) > CFG.SEA - 1.2) continue;
            var bm = makeBoatMesh();
            bm.group.position.set(bx, CFG.SEA - 0.35, bz);
            bm.group.rotation.y = rnd(0, 6.28);
            worldGroup.add(bm.group);
            VEHICLES.push({
              type: "boat",
              mesh: bm.group,
              wheels: [],
              x: bx,
              y: CFG.SEA - 0.35,
              z: bz,
              yaw: bm.group.rotation.y,
              speed: 0,
              vy: 0,
              driver: null,
              boost: 1,
              hp: 500,
              wheelSpin: 0,
              radius: 1.4,
              len: 2.2,
              hover: 0,
              col: {
                minX: bx - 1.6, maxX: bx + 1.6,
                minY: CFG.SEA - 0.8, maxY: CFG.SEA + 1.2,
                minZ: bz - 1.2, maxZ: bz + 1.2,
              },
            });
            colliders.insert(VEHICLES[VEHICLES.length - 1].col);
            made++;
          }
        }
        function updateVehicles(dt) {
          for (var i = 0; i < VEHICLES.length; i++) {
            var v = VEHICLES[i];
            var thr = 0,
              steer = 0,
              boost = false;
            if (v.driver) {
              var d = v.driver;
              thr = d.vehThrottle || 0;
              steer = d.vehSteer || 0;
              boost = !!d.vehBoost;
            }
            var isBoat = v.type === "boat";
            var maxSpd = isBoat ? 26 : CFG.VEH_MAX;
            if (boost) maxSpd *= 1.42;
            var accel = isBoat ? 16 : 22;
            v.speed += thr * accel * dt;
            if (thr === 0) v.speed *= Math.exp(-(isBoat ? 1.1 : 1.6) * dt);
            v.speed = clamp(v.speed, -maxSpd * 0.45, maxSpd);
            var steerRate =
              clamp(Math.abs(v.speed) / 9, 0, 1.15) * (isBoat ? 1.9 : 1.55);
            /* Yaw is measured so that forward=(sin yaw, cos yaw); increasing yaw swings
       forward from +Z toward +X, and +X is the driver's LEFT (the camera's right
       vector is (-cos yaw, sin yaw)). So positive steer must DECREASE yaw for D
       to turn right. */
            v.yaw -= steer * steerRate * dt * Math.sign(v.speed >= 0 ? 1 : -1);
            /* Camera-steering assist: while the player holds throttle without touching
       A/D, gently ease the chassis toward the free-look direction so the mouse
       is a meaningful driving input instead of pure decoration. */
            if (
              v.driver &&
              v.driver.isPlayer &&
              thr > 0.1 &&
              Math.abs(steer) < 0.1 &&
              Math.abs(v.speed) > 2.5
            ) {
              var camK = Math.min(1, Math.abs(v.speed) / 16) * 1.6;
              v.yaw += angDiff(v.yaw, v.driver.yaw) * Math.min(camK * dt, 0.35);
            }
            var fx = Math.sin(v.yaw),
              fz = Math.cos(v.yaw);
            var nx = v.x + fx * v.speed * dt,
              nz = v.z + fz * v.speed * dt;
            /* collide with the world */
            var p = { x: nx, z: nz };
            collideXZ(p, v.radius, v.y + 0.2, v.y + 1.6);
            /* also check platforms and ramps */
            var hw = v.radius, hl = v.len / 2;
            var cosV = Math.cos(v.yaw), sinV = Math.sin(v.yaw);
            var vMinX = 1e9, vMaxX = -1e9, vMinZ = 1e9, vMaxZ = -1e9;
            var vpts = [[hl,hw],[-hl,hw],[hl,-hw],[-hl,-hw]];
            for (var vi = 0; vi < vpts.length; vi++) {
              var vx = nx + vpts[vi][0] * cosV - vpts[vi][1] * sinV;
              var vz = nz + vpts[vi][0] * sinV + vpts[vi][1] * cosV;
              if (vx < vMinX) vMinX = vx; if (vx > vMaxX) vMaxX = vx;
              if (vz < vMinZ) vMinZ = vz; if (vz > vMaxZ) vMaxZ = vz;
            }
            var vBotY = v.y - 0.5;
            /* Check platforms */
            if (platHash) {
              var platCandidates = [];
              platHash.query(nx, nz, platCandidates);
              for (var pi = 0; pi < platCandidates.length; pi++) {
                var pl = platCandidates[pi];
                if (pl.dead) continue;
                if (vMaxX < pl.minX || vMinX > pl.maxX || vMaxZ < pl.minZ || vMinZ > pl.maxZ) continue;
                if (vBotY < pl.maxY && v.y + 2.5 > pl.minY) {
                  p.x = nx; p.z = nz; v.speed = 0; break;
                }
              }
            }
            /* Check ramps */
            if (!v.driver || !v.driver.isPlayer || v.speed <= 0) {
              if (rampHash) {
                var rampCandidates = [];
                rampHash.query(nx, nz, rampCandidates);
                for (var ri = 0; ri < rampCandidates.length; ri++) {
                  var rm = rampCandidates[ri];
                  if (rm.dead) continue;
                  if (vMaxX < rm.minX || vMinX > rm.maxX || vMaxZ < rm.minZ || vMinZ > rm.maxZ) continue;
                  if (vBotY < rm.maxY && v.y + 2.5 > rm.minY) {
                    p.x = nx; p.z = nz; v.speed = 0;
                  }
                }
              }
            }
            if (Math.abs(p.x - nx) > 0.01 || Math.abs(p.z - nz) > 0.01) {
              if (Math.abs(v.speed) > 10)
                fxDebris(v.x, v.y + 0.8, v.z, "metal", 5);
              v.speed *= 0.24;
              if (v.driver && v.driver.isPlayer)
                FX.shake = Math.min(0.8, FX.shake + 0.35);
            }
            v.x = p.x;
            v.z = p.z;
            /* update vehicle AABB collider */
            if (v.col) {
              var hlen = v.len / 2, hwid = v.radius;
              var cosY = Math.cos(v.yaw), sinY = Math.sin(v.yaw);
              var cx = v.x, cz = v.z;
              var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
              var pts = [
                [hlen, hwid], [-hlen, hwid], [hlen, -hwid], [-hlen, -hwid]
              ];
              for (var pi = 0; pi < pts.length; pi++) {
                var rx = cx + pts[pi][0] * cosY - pts[pi][1] * sinY;
                var rz = cz + pts[pi][0] * sinY + pts[pi][1] * cosY;
                if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
                if (rz < minZ) minZ = rz; if (rz > maxZ) maxZ = rz;
              }
              v.col.minX = minX; v.col.maxX = maxX;
              v.col.minZ = minZ; v.col.maxZ = maxZ;
              v.col.minY = v.y - 0.5; v.col.maxY = v.y + (isBoat ? 1.2 : 2.2);
            }
            /* follow the ground */
            if (isBoat) {
              var depth = CFG.SEA - terrainHeightAt(v.x, v.z);
              if (depth < 0.4) {
                v.speed *= Math.exp(-4 * dt);
              }
              v.y = lerp(
                v.y,
                CFG.SEA - 0.35 + Math.sin(GAMETIME * 2.4) * 0.06,
                0.2,
              );
            } else {
              var fy = terrainHeightAt(v.x + fx * 1.6, v.z + fz * 1.6);
              var ry2 = terrainHeightAt(v.x - fx * 1.6, v.z - fz * 1.6);
              var ly = terrainHeightAt(v.x - fz * 1.0, v.z + fx * 1.0);
              var ry3 = terrainHeightAt(v.x + fz * 1.0, v.z - fx * 1.0);
              var target = (fy + ry2 + ly + ry3) / 4;
              v.y = lerp(v.y, target, 1 - Math.exp(-9 * dt));
              var pitch = Math.atan2(ry2 - fy, 3.2);
              var roll = Math.atan2(ry3 - ly, 2.0);
              v.mesh.rotation.x = lerp(v.mesh.rotation.x, pitch, 0.14);
              v.mesh.rotation.z = lerp(v.mesh.rotation.z, roll, 0.14);
            }
            v.mesh.position.set(v.x, v.y, v.z);
            v.mesh.rotation.y = v.yaw;
            v.wheelSpin += v.speed * dt * 2.1;
            for (var w = 0; w < v.wheels.length; w++)
              v.wheels[w].rotation.x = -v.wheelSpin;
            /* run over players */
            if (Math.abs(v.speed) > 7) {
              for (var c = 0; c < CHARS.length; c++) {
                var ch = CHARS[c];
                if (!ch.alive || ch.onBus || ch.vehicle === v) continue;
                if (
                  dist2(ch.x, ch.z, v.x, v.z) < v.radius + 0.7 &&
                  Math.abs(ch.y - v.y) < 2.0
                ) {
                  damageChar(ch, 26, v.driver, false, { cls: "vehicle" });
                  ch.vx += fx * v.speed * 0.6;
                  ch.vz += fz * v.speed * 0.6;
                  ch.vy = 6;
                }
              }
            }
            /* engine audio for the driver */
            if (v.driver && v.driver.isPlayer) {
              Sfx.setEngine(
                clamp(Math.abs(v.speed) / maxSpd, 0, 1) * 0.9 +
                  (thr !== 0 ? 0.2 : 0),
              );
            }
            if (v.driver) {
              v.driver.x = v.x;
              v.driver.z = v.z;
              v.driver.y = v.y + (v.type === "boat" ? 0.9 : 1.0);
              v.driver.vx = v.vx || 0;
              v.driver.vz = 0;
              v.driver.vy = 0;
              /* NEVER stomp the player's yaw here: it is the free-look camera yaw and is
         driven by the mouse. Overwriting it welded the camera to the car heading
         and made the mouse appear completely dead while driving. Bots keep the
         old behaviour since their yaw is their facing direction. */
              if (!v.driver.isPlayer) v.driver.yaw = v.yaw;
              v.driver.grounded = true;
            }
          }
        }
        function nearestVehicle(ch) {
          var best = null,
            bd = 4.2;
          for (var i = 0; i < VEHICLES.length; i++) {
            var v = VEHICLES[i];
            if (v.driver) continue;
            var d = dist2(ch.x, ch.z, v.x, v.z);
            if (d < bd && Math.abs(v.y - ch.y) < 3) {
              bd = d;
              best = v;
            }
          }
          return best;
        }
        function enterVehicle(ch, v) {
          if (!v || v.driver) return false;
          ch.vehicle = v;
          v.driver = ch;
          ch.state = "vehicle";
          ch.vx = 0;
          ch.vz = 0;
          ch.vy = 0;
          ch.mantle = null;
          ch.mantleAnim = 0;
          /* Sync character position to vehicle seat so they don't fall through */
          var seatY = v.type === "boat" ? VEH_SEAT_BOAT : VEH_SEAT_CAR;
          ch.x = v.x;
          ch.z = v.z;
          ch.y = v.y + seatY - SEAT_PELVIS;
          ch.mesh.visible = true;
          if (ch.isPlayer) {
            Sfx.vehicle(true);
            Sfx.setEngine(0.15);
            UI.showVeh(true);
          }
          return true;
        }
        function exitVehicle(ch, silent) {
          var v = ch.vehicle;
          if (!v) return;
          v.driver = null;
          ch.vehicle = null;
          ch.state = "ground";
          var fx = Math.sin(v.yaw),
            fz = Math.cos(v.yaw);
          var px = v.x - fz * 2.4,
            pz = v.z + fx * 2.4;
          var gy = groundAt(px, pz, v.y + 3);
          ch.x = px;
          ch.z = pz;
          ch.y = gy + 0.2;
          ch.vx = 0;
          ch.vz = 0;
          ch.vy = 0;
          if (ch.isPlayer && !silent) {
            Sfx.vehicle(false);
            UI.showVeh(false);
          }
          if (ch.isPlayer) {
            ch.vehThrottle = 0;
            ch.vehSteer = 0;
            ch.vehBoost = false;
          }
        }

        /* ============================================================================
   Player
   ========================================================================== */
        function createPlayer() {
          PC = createChar("YOU", true, 0, 0);
          PC.health = 100;
          PC.shield = 0;
          PC.mats = { wood: 120, stone: 0, metal: 0 };
          return PC;
        }
        function updatePlayer(dt) {
          if (!PC) return;
          var jumpEdge = Input.jumpPress;
          Input.jumpPress = false;
          PC.fireCd = Math.max(0, PC.fireCd - dt);
          if (PC.reloading) {
            PC.reloading.t += dt;
            if (PC.reloading.t >= PC.reloading.total) finishReload(PC);
          }
          updateUsing(PC, dt);
          updateAutoReload(PC, dt);

          if (PC.knocked) {
            PC.aimX = Math.sin(PC.yaw);
            PC.aimZ = Math.cos(PC.yaw);
            var mx = Input.axisX,
              mz = Input.axisZ;
            var wx = Math.sin(PC.yaw) * mz - Math.cos(PC.yaw) * mx;
            var wz = Math.cos(PC.yaw) * mz + Math.sin(PC.yaw) * mx;
            moveChar(PC, dt, wx, wz, false, false, false, false);
            PC.aiming = false;
            PC.sprinting = false;
            return;
          }

          var yaw = PC.yaw,
            pitch = PC.pitch;
          PC.aimX = Math.sin(yaw);
          PC.aimZ = Math.cos(yaw);
          var fx = Math.sin(yaw),
            fz = Math.cos(yaw);
          var rx = -Math.cos(yaw),
            rz = Math.sin(yaw);

          if (PC.state === "bus") {
            PC.x = BUS.x;
            PC.z = BUS.z;
            PC.y = BUS.y - 3.2;
            PC.mesh.visible = false;
            if (Input.jump) ejectFromBus(PC);
            return;
          }
          if (PC.state === "vehicle") {
            PC.mesh.visible = false;
            return;
          }
          if (PC.state === "skydive" || PC.state === "glide") {
            var fwd = Input.axisZ;
            var strafe = Input.axisX;
            if (PC.state === "skydive") {
              var dive = Input.forward || Input.axisZ > 0.4;
              var tv = dive ? -CFG.DIVE : Input.back ? -18 : -42;
              PC.vy = lerp(PC.vy, tv, 1 - Math.exp(-1.6 * dt));
              var hs = dive ? 18 : 10;
              PC.vx = lerp(
                PC.vx,
                (fx * fwd + rx * strafe) * hs,
                1 - Math.exp(-1.8 * dt),
              );
              PC.vz = lerp(
                PC.vz,
                (fz * fwd + rz * strafe) * hs,
                1 - Math.exp(-1.8 * dt),
              );
              /* Auto-deploy glider sooner for better gameplay */
              PC.glideLock = Math.max(0, (PC.glideLock || 0) - dt);
              var altitude = PC.y - groundAt(PC.x, PC.z, PC.y);
              if (
                (PC.glideLock <= 0 && jumpEdge) ||
                altitude < 50
              )
                deployGlider(PC);
            } else {
              PC.vy = lerp(PC.vy, -CFG.GLIDE, 1 - Math.exp(-3 * dt));
              var gs = CFG.GLIDE_FWD * (Input.forward ? 1.4 : 1);
              PC.vx = lerp(
                PC.vx,
                (fx * fwd + rx * strafe) * gs,
                1 - Math.exp(-1.6 * dt),
              );
              PC.vz = lerp(
                PC.vz,
                (fz * fwd + rz * strafe) * gs,
                1 - Math.exp(-1.6 * dt),
              );
            }
            var pp = { x: PC.x + PC.vx * dt, z: PC.z + PC.vz * dt };
            collideXZ(pp, 0.42, PC.y + 0.1, PC.y + 1.7);
            PC.x = pp.x;
            PC.z = pp.z;
            var preY = PC.y;
            PC.y += PC.vy * dt;
            var g = groundAt(PC.x, PC.z, preY);
            if (PC.y <= g) {
              PC.y = g;
              PC.vy = 0;
              PC.grounded = true;
              PC.state = "ground";
              PC.parasail = false;
              if (PC.gliderMesh) PC.gliderMesh.visible = false;
              PC.landAnim = 0.3;
              Sfx.land();
              UI.setGlider(false);
              fxSmoke(PC.x, g + 0.1, PC.z, 3, 0.6, 0.9, 0.5);
            }
            var dd = Math.sqrt(PC.x * PC.x + PC.z * PC.z),
              lim2 = CFG.MAP * 0.47;
            if (dd > lim2) {
              PC.x *= lim2 / dd;
              PC.z *= lim2 / dd;
            }
            UI.setAlt(Math.max(0, PC.y));
            return;
          }
          /* grounded */
          var mvx = Input.axisX;
          var mvz = Input.axisZ;
          var wx = fx * mvz + rx * mvx,
            wz = fz * mvz + rz * mvx;
          var sprint =
            Input.sprint && !PC.aiming && mvz > 0 && !Input.crouch && !PC.using;
          moveChar(PC, dt, wx, wz, Input.jump, sprint, Input.crouch, false);
          PC.crouch = Input.crouch;
          if (PC.grounded) {
            PC.stepAcc =
              (PC.stepAcc || 0) + Math.sqrt(PC.vx * PC.vx + PC.vz * PC.vz) * dt;
            var interval = PC.sprinting ? 2.2 : 2.7;
            if (PC.stepAcc > interval) {
              PC.stepAcc = 0;
              var s = surfaceAt(PC.x, PC.z, PC.y);
              Sfx.step(s);
              if (s === "water")
                fxSmoke(PC.x, PC.y + 0.1, PC.z, 2, 0.4, 0.7, 0.4);
            }
          }
        }

        /* ============================================================================
   Camera
   ========================================================================== */
        var _camTarget = new THREE.Vector3(),
          _camDesired = new THREE.Vector3();
        function updateCamera(dt) {
          var ch = PC.alive ? PC : SPECTATE_TARGET || PC;
          if (!ch) return;
          if (ch.vehicle) {
            var v = ch.vehicle;
            var dist = 8.2 + Math.abs(v.speed) * 0.09;
            var yaw = PC.yaw,
              pitch = PC.pitch;
            var fx = Math.sin(yaw) * Math.cos(pitch),
              fy = Math.sin(pitch),
              fz = Math.cos(yaw) * Math.cos(pitch);
            _camTarget.set(v.x, v.y + 1.7, v.z);
            _camDesired.set(
              _camTarget.x - fx * dist,
              _camTarget.y - fy * dist + 1.3,
              _camTarget.z - fz * dist,
            );
            var ox = _camTarget.x,
              oy = _camTarget.y,
              oz = _camTarget.z;
            var dx = _camDesired.x - ox,
              dy = _camDesired.y - oy,
              dz = _camDesired.z - oz;
            var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
            var rr = raycastWorld(
              { x: ox, y: oy, z: oz },
              dx / dl,
              dy / dl,
              dz / dl,
              dl + 0.4,
            );
            var tt = Math.min(dl, Math.max(1.2, rr.t - 0.4));
            camera.position.set(
              ox + (dx / dl) * tt,
              oy + (dy / dl) * tt,
              oz + (dz / dl) * tt,
            );
            camera.lookAt(
              _camTarget.x + fx * 20,
              _camTarget.y + fy * 20,
              _camTarget.z + fz * 20,
            );
            camera.fov +=
              (Math.min(96, SETTINGS.fov + 8 + Math.abs(v.speed) * 0.4) -
                camera.fov) *
              Math.min(1, dt * 5);
            camera.updateProjectionMatrix();
            camera.getWorldDirection(CAM.dir);
            CAM.aim.set(
              camera.position.x + CAM.dir.x * 80,
              camera.position.y + CAM.dir.y * 80,
              camera.position.z + CAM.dir.z * 80,
            );
            return;
          }
          var aiming = PC.alive && Input.aim && !BUILD_MODE && !PC.knocked;
          var w = PC.slots[PC.slot];
          var scoped = aiming && w && WEAPONS[w.id].scope;
          var dist = BUILD_MODE ? 6.4 : scoped ? 2.0 : aiming ? 2.6 : 4.5;
          var height = ch.knocked ? 0.75 : 1.54;
          var yaw = PC.alive ? ch.yaw : PC.yaw;
          var pitch = PC.alive ? ch.pitch : PC.pitch;
          var fx2 = Math.sin(yaw) * Math.cos(pitch),
            fy2 = Math.sin(pitch),
            fz2 = Math.cos(yaw) * Math.cos(pitch);
          _camTarget.set(ch.x, ch.y + height, ch.z);
          if (ch.state === "glide" || ch.state === "skydive") {
            _camTarget.y += 1.2;
            dist = 7.0;
          }
          var side = aiming ? (scoped ? 0.42 : 0.74) : 0.5;
          var rxv = -Math.cos(yaw),
            rzv = Math.sin(yaw);
          _camDesired.set(
            _camTarget.x - fx2 * dist + rxv * side,
            _camTarget.y - fy2 * dist + (aiming ? 0.36 : 0.58),
            _camTarget.z - fz2 * dist + rzv * side,
          );
          var ox2 = _camTarget.x,
            oy2 = _camTarget.y,
            oz2 = _camTarget.z;
          var dx2 = _camDesired.x - ox2,
            dy2 = _camDesired.y - oy2,
            dz2 = _camDesired.z - oz2;
          var dl2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2) || 1;
          var r2 = raycastWorld(
            { x: ox2, y: oy2, z: oz2 },
            dx2 / dl2,
            dy2 / dl2,
            dz2 / dl2,
            dl2 + 0.4,
          );
          var t2 = Math.min(dl2, Math.max(0.55, r2.t - 0.35));
          CAM.pos.set(
            ox2 + (dx2 / dl2) * t2,
            oy2 + (dy2 / dl2) * t2,
            oz2 + (dz2 / dl2) * t2,
          );
          camera.position.copy(CAM.pos);
          camera.lookAt(
            _camTarget.x + fx2 * 22,
            _camTarget.y + fy2 * 22,
            _camTarget.z + fz2 * 22,
          );
          /* recoil + explosion shake */
          CAM.kick = (CAM.kick || 0) * Math.exp(-dt * 11);
          CAM.kickP = (CAM.kickP || 0) * Math.exp(-dt * 9);
          CAM.shake = (CAM.shake || 0) * Math.exp(-dt * 6.5);
          if (FX.shake > 0) {
            CAM.shake = Math.max(CAM.shake, FX.shake);
            FX.shake = 0;
          }
          if (CAM.kick > 0.0008) {
            camera.position.x -= fx2 * CAM.kick * 3;
            camera.position.y -= fy2 * CAM.kick * 3;
            camera.position.z -= fz2 * CAM.kick * 3;
            camera.rotateX(CAM.kickP * 2.4);
          }
          if (CAM.shake > 0.002) {
            camera.position.x += (srnd() - 0.5) * CAM.shake * 0.42;
            camera.position.y += (srnd() - 0.5) * CAM.shake * 0.42;
            camera.position.z += (srnd() - 0.5) * CAM.shake * 0.42;
            camera.rotateZ((srnd() - 0.5) * CAM.shake * 0.05);
          }
          /* --- body-english roll -------------------------------------------------
     Bank into a turn and lean against a strafe. The character rig already
     does this (poseChar's `roll`), but with the camera held dead level the
     world just slid sideways instead of the player carving through it. Kept
     small so it registers as weight, not as a wobble, and killed entirely
     while aiming so ADS stays rock steady. */
          if (CAM.lastYaw === undefined) CAM.lastYaw = yaw;
          var camYawRate = angDiff(CAM.lastYaw, yaw) / Math.max(dt, 1e-4);
          CAM.lastYaw = yaw;
          var spd3 = Math.sqrt(ch.vx * ch.vx + ch.vz * ch.vz);
          var rollWant = 0;
          if (!ch.vehicle && !aiming && PC.alive && !PC.knocked) {
            rollWant =
              clamp(camYawRate * 0.055, -0.075, 0.075) -
              clamp(Input.axisX, -1, 1) * 0.03 * clamp(spd3 / CFG.RUN, 0, 1);
          }
          CAM.roll =
            (CAM.roll || 0) +
            (rollWant - (CAM.roll || 0)) * Math.min(1, dt * 6);
          /* a NaN here would poison the camera matrix and defeat frustum culling for
     the whole scene, so never let it through */
          if (!isFinite(CAM.roll)) CAM.roll = 0;
          if (Math.abs(CAM.roll) > 0.0006) camera.rotateZ(CAM.roll);
          camera.getWorldDirection(CAM.dir);
          var res = raycastWorld(
            { x: CAM.pos.x, y: CAM.pos.y, z: CAM.pos.z },
            CAM.dir.x,
            CAM.dir.y,
            CAM.dir.z,
            360,
          );
          CAM.aim.set(
            CAM.pos.x + CAM.dir.x * res.t,
            CAM.pos.y + CAM.dir.y * res.t,
            CAM.pos.z + CAM.dir.z * res.t,
          );
          var wantFov = scoped
            ? Math.max(22, SETTINGS.fov / WEAPONS[w.id].scope)
            : aiming
              ? Math.max(46, SETTINGS.fov - 16)
              : PC.sprinting
                ? SETTINGS.fov + 9
                : SETTINGS.fov;
          camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 8);
          camera.updateProjectionMatrix();
          UI.setScope(!!scoped);
        }

// === ai ===
/* ==== 60_ai.js ==== */
        /* ============================================================================
   60_AI — bot brains. Navigation-grid A* pathfinding, personality archetypes,
   squad play (no friendly fire, revives), looting, storm rotation, defensive
   and offensive building, healing, and skydive targeting.
   Expensive work (pathfinding, line-of-sight, obstacle probes) runs on the
   low-frequency "think" tick; per-frame work stays cheap.
   ========================================================================== */

        var NAME_A = [
          "Sly",
          "Raven",
          "Blaze",
          "Nova",
          "Frost",
          "Viper",
          "Echo",
          "Zane",
          "Kai",
          "Rico",
          "Juno",
          "Axel",
          "Rogue",
          "Toxic",
          "Pixel",
          "Drift",
          "Lynx",
          "Ghost",
          "Peely",
          "Midas",
          "Rippley",
          "Meowscles",
          "Brite",
          "Cuddle",
          "Skull",
          "Bandolier",
          "Renegade",
          "Wildcat",
          "Fable",
          "Ikonic",
          "Sparks",
          "Vex",
        ];
        var NAME_B = [
          "",
          "X",
          "Prime",
          "YT",
          "TTV",
          "_69",
          "Pro",
          "HD",
          "OP",
          "Xx",
          "Gaming",
          "Sniper",
          "Ninja",
          "2026",
          "Boss",
          "Fury",
        ];
        var DIFF_TABLE = [
          { name: "EASY", dmg: 0.4, acc: -0.14, react: 1.35, range: 0.72 },
          { name: "NORMAL", dmg: 0.55, acc: 0.0, react: 1.0, range: 1.0 },
          { name: "HARD", dmg: 0.78, acc: 0.13, react: 0.75, range: 1.15 },
        ];
        var DIFF = 1;

        function botName() {
          var n = pickOne(NAME_A) + pickOne(NAME_B);
          if (chance(0.5)) n += rndi(10, 99);
          return n;
        }
        function makeBots(n) {
          var teamSize = MODE === "solo" ? 1 : MODE === "duo" ? 2 : 4;
          var team = 0,
            count = 0;
          for (var i = 0; i < n; i++) {
            if (teamSize > 1) {
              /* The player already occupies a slot on team 0, so that team takes one
         fewer bot; every other team is filled to the full squad size. */
              var cap = team === 0 ? teamSize - 1 : teamSize;
              if (count >= cap) {
                team++;
                count = 0;
              }
              count++;
            } else team = i + 1;
            var b = createChar(
              botName(),
              false,
              rndi(1, SKIN_PALETTE.length - 1),
              teamSize > 1 ? team : i + 1,
            );
            var D = DIFF_TABLE[DIFF];
            var pers = pickOne([
              "rusher",
              "builder",
              "camper",
              "sniper",
              "looter",
              "rusher",
              "builder",
            ]);
            var accBase =
              pers === "sniper"
                ? rnd(0.62, 0.88)
                : pers === "camper"
                  ? rnd(0.55, 0.8)
                  : rnd(0.36, 0.68);
            b.ai = {
              state: "air",
              personality: pers,
              target: null,
              engage: null,
              loot: null,
              think: rnd(0, 0.35),
              react: 0,
              accuracy: clamp(accBase + D.acc, 0.15, 0.95),
              underFire: 0,
              buildCd: rnd(0, 2),
              healCd: 0,
              strafe: chance(0.5) ? 1 : -1,
              strafeT: rnd(0.6, 1.8),
              path: null,
              pathI: 0,
              pathT: 0,
              goalX: 0,
              goalZ: 0,
              goalD: 99,
              goalKind: "none",
              mx: 0,
              mz: 0,
              sprint: false,
              faceYaw: 0,
              mode: "idle",
              jumpCd: 0,
              landed: false,
              aimErr: rnd(0.6, 2.4),
              fireBurst: 0,
              burstT: 0,
              lostT: 9,
              outside: false,
              needRotate: false,
              rotateX: 0,
              rotateZ: 0,
              reviveTarget: null,
              reviveT: 0,
              lootT: rnd(0, 2),
              stuck: 0,
              lastX: 0,
              lastZ: 0,
              stillT: 0,
              aggro: pers === "rusher" ? 1.35 : pers === "camper" ? 0.7 : 1.0,
              buildSkill:
                pers === "builder" ? 1.5 : pers === "rusher" ? 0.9 : 0.7,
              preferred:
                pers === "sniper"
                  ? ["sniper", "handcannon", "burst", "ar"]
                  : pers === "rusher"
                    ? ["shotgun", "tacshotgun", "tsmg", "smg"]
                    : ["ar", "burst", "tsmg", "shotgun"],
            };
            var wid = pickOne(LOOT_WEAPONS);
            b.slots[1] = {
              id: wid,
              rarity: rndi(0, 2),
              ammoInMag: WEAPONS[wid].mag,
            };
            b.slot = 1;
            var d = WEAPONS[wid];
            if (d.ammo)
              b.ammo[d.ammo] =
                d.ammo === "shell" ? 24 : d.ammo === "heavy" ? 8 : 120;
            b.ammo.light += 60;
            b.ammo.medium += 60;
            b.heals.band = rndi(0, 3);
            b.heals.mini = rndi(0, 2);
            attachWeapon(b);
            var poi = POIS[rndi(0, POIS.length - 1)];
            b.jumpTarget = {
              x: poi.x + rnd(-poi.r * 0.7, poi.r * 0.7),
              z: poi.z + rnd(-poi.r * 0.7, poi.r * 0.7),
            };
            b.jumpAt = rnd(0.04, 0.96);
          }
        }

        /* ============================================================================
   Perception
   ========================================================================== */
        var _cand = [];
        function findEnemy(b, maxD) {
          _cand.length = 0;
          for (var i = 0; i < CHARS.length; i++) {
            var o = CHARS[i];
            if (o === b || !o.alive || o.onBus || o.knocked) continue;
            if (
              o.team !== undefined &&
              b.team !== undefined &&
              o.team === b.team
            )
              continue;
            var d = dist2(b.x, b.z, o.x, o.z);
            if (d < maxD && Math.abs(o.y - b.y) < 30) _cand.push(o);
          }
          if (!_cand.length) return null;
          _cand.sort(function (a, c) {
            return dist2(b.x, b.z, a.x, a.z) - dist2(b.x, b.z, c.x, c.z);
          });
          var n = Math.min(_cand.length, 4);
          for (var k = 0; k < n; k++) {
            var t = _cand[k];
            if (hasLOS(b.x, b.y + 1.45, b.z, t.x, t.y + 1.2, t.z)) return t;
          }
          return null;
        }
        function findLoot(b, maxD) {
          var best = null,
            bd = maxD,
            bk = null;
          /* A reboot card outranks ordinary loot: it is the only way to get a wiped
     squadmate back, and it is worthless to anyone who already carries one. */
          if (MODE !== "solo" && !(b.cards > 0) && deadTeammateOf(b)) {
            for (var ci = 0; ci < LOOT.length; ci++) {
              var cd = LOOT[ci];
              if (cd.kind !== "card") continue;
              var dcd = dist2(b.x, b.z, cd.x, cd.z);
              if (dcd < Math.max(bd, 90))
                return { obj: cd, kind: "card", d: dcd };
            }
          }
          /* An unopened supply drop pulls the aggressive archetypes across the map.
     Campers and snipers hold position instead, so a crate does not become a
     magnet for all 24 bots at once. */
          if (
            DROPS &&
            b.ai &&
            (b.ai.personality === "rusher" || b.ai.personality === "looter")
          ) {
            for (var di = 0; di < DROPS.length; di++) {
              var dp = DROPS[di];
              if (dp.opened || dp.state !== "landed") continue;
              var ddp = dist2(b.x, b.z, dp.x, dp.z);
              if (ddp < 6400) return { obj: dp, kind: "drop", d: ddp };
            }
          }
          for (var i = 0; i < CHESTS.length; i++) {
            var c = CHESTS[i];
            if (c.opened) continue;
            var d = dist2(b.x, b.z, c.x, c.z);
            if (d < bd && Math.abs(c.y - b.y) < 10) {
              bd = d;
              best = c;
              bk = "chest";
            }
          }
          if (best) return { obj: best, kind: bk, d: bd };
          for (var j = 0; j < LOOT.length; j++) {
            var it = LOOT[j];
            if (it.kind === "card") continue; /* handled above */
            var d2v = dist2(b.x, b.z, it.x, it.z);
            if (d2v < bd && Math.abs(it.y - b.y) < 8) {
              if (it.kind === "weapon") {
                var def = WEAPONS[it.id];
                var score =
                  ((def.dmg * (def.pellets || 1)) / def.rate) *
                  RARITY[it.rarity || 0].m;
                var mine = 0;
                for (var s = 1; s < 6; s++) {
                  var w = b.slots[s];
                  if (!w) continue;
                  var dd = WEAPONS[w.id];
                  mine = Math.max(
                    mine,
                    ((dd.dmg * (dd.pellets || 1)) / dd.rate) *
                      RARITY[w.rarity].m,
                  );
                }
                var empty = false;
                for (var e = 1; e < 6; e++) if (!b.slots[e]) empty = true;
                if (!empty && score <= mine * 1.02) continue;
              }
              bd = d2v;
              best = it;
              bk = "loot";
            }
          }
          return best ? { obj: best, kind: bk, d: bd } : null;
        }
        function botBestSlot(b) {
          var best = 1,
            bs = -1;
          var pref = b.ai ? b.ai.preferred : [];
          for (var i = 1; i < 6; i++) {
            var w = b.slots[i];
            if (!w) continue;
            var def = WEAPONS[w.id];
            var dps = (def.dmg * (def.pellets || 1)) / def.rate;
            var sc = dps * RARITY[w.rarity].m * (def.range > 60 ? 1.15 : 1);
            if (def.cls === "sniper") sc *= 0.9;
            if (pref.indexOf(w.id) >= 0) sc *= 1.22;
            if (sc > bs) {
              bs = sc;
              best = i;
            }
          }
          return bs < 0 ? 0 : best;
        }
        function botBlocked(b, dx, dz) {
          for (var s = 1; s <= 2; s++) {
            var x = b.x + dx * 2.4 * s,
              z = b.z + dz * 2.4 * s;
            if (groundAt(x, z, b.y) > b.y + 1.2) return true;
            if (blockedAt(x, z, b.y + 0.25, b.y + 1.6)) return true;
          }
          return false;
        }
        function botSteer(b, tx, tz) {
          var dx = tx - b.x,
            dz = tz - b.z,
            d = Math.sqrt(dx * dx + dz * dz);
          if (d < 0.05) return { x: 0, z: 0, d: 0 };
          dx /= d;
          dz /= d;
          var base = Math.atan2(dx, dz);
          var offs = [0, 0.42, -0.42, 0.9, -0.9, 1.5, -1.5, 2.2, -2.2, 3.14];
          for (var i = 0; i < offs.length; i++) {
            var a = base + offs[i];
            var px = Math.sin(a),
              pz = Math.cos(a);
            if (!botBlocked(b, px, pz)) return { x: px, z: pz, d: d };
          }
          return { x: dx, z: dz, d: d };
        }
        function setBotGoal(b, gx, gz, kind) {
          var ai = b.ai;
          if (ai.goalKind === kind && dist2(gx, gz, ai.goalX, ai.goalZ) < 3.0)
            return;
          ai.goalX = gx;
          ai.goalZ = gz;
          ai.goalKind = kind;
          ai.pathT = 0;
          ai.path = null;
          ai.pathI = 0;
          if (NAV.built) ai.path = navPath(b.x, b.z, gx, gz);
        }

        /* ============================================================================
   Main bot tick
   ========================================================================== */
        function updateBot(b, dt) {
          if (!b.alive) return;
          b.fireCd = Math.max(0, b.fireCd - dt);
          if (b.hurtFlash > 0) b.hurtFlash -= dt;
          if (b.reloading) {
            b.reloading.t += dt;
            if (b.reloading.t >= b.reloading.total) finishReload(b);
          }
          updateUsing(b, dt);
          updateAutoReload(b, dt);
          var ai = b.ai;
          if (ai.underFire > 0) ai.underFire -= dt;
          if (ai.buildCd > 0) ai.buildCd -= dt;
          if (ai.healCd > 0) ai.healCd -= dt;
          if (ai.jumpCd > 0) ai.jumpCd -= dt;
          if (ai.strafeT > 0) ai.strafeT -= dt;
          else {
            ai.strafeT = rnd(0.7, 2.0);
            ai.strafe *= -1;
          }

          if (b.knocked) {
            botDowned(b, dt);
            return;
          }
          if (b.state === "bus") {
            b.x = BUS.x + rnd(-1, 1);
            b.z = BUS.z + rnd(-1, 1);
            b.y = BUS.y - 3.2;
            return;
          }
          if (b.state === "skydive" || b.state === "glide") {
            updateBotAir(b, dt);
            return;
          }

          /* distant bots think less often — keeps the frame budget sane */
          var far = PC && dist2(b.x, b.z, PC.x, PC.z) > 140;
          ai.think -= dt;
          if (ai.think <= 0) {
            ai.think = far ? rnd(0.4, 0.6) : rnd(0.16, 0.3);
            botThink(b);
          }
          botAct(b, dt);
        }

        function updateBotAir(b, dt) {
          var t = b.jumpTarget;
          var dx = t.x - b.x,
            dz = t.z - b.z,
            d = Math.sqrt(dx * dx + dz * dz);
          var sx = 0,
            sz = 0;
          if (d > 4) {
            sx = dx / d;
            sz = dz / d;
          }
          if (b.state === "skydive") {
            b.vy = lerp(b.vy, -CFG.DIVE * 0.72, 1 - Math.exp(-2 * dt));
            b.vx = lerp(b.vx, sx * 22, 1 - Math.exp(-1.6 * dt));
            b.vz = lerp(b.vz, sz * 22, 1 - Math.exp(-1.6 * dt));
            if (b.y - groundAt(b.x, b.z, b.y) < 32) deployGlider(b);
          } else {
            b.vy = lerp(b.vy, -CFG.GLIDE, 1 - Math.exp(-3 * dt));
            b.vx = lerp(b.vx, sx * CFG.GLIDE_FWD, 1 - Math.exp(-1.4 * dt));
            b.vz = lerp(b.vz, sz * CFG.GLIDE_FWD, 1 - Math.exp(-1.4 * dt));
          }
          var preY = b.y;
          b.x += b.vx * dt;
          b.z += b.vz * dt;
          b.y += b.vy * dt;
          var g = groundAt(b.x, b.z, preY);
          if (b.y <= g) {
            b.y = g;
            b.vy = 0;
            b.grounded = true;
            b.state = "ground";
            b.parasail = false;
            if (b.gliderMesh) b.gliderMesh.visible = false;
            b.ai.landed = true;
            b.ai.think = 0;
            b.landAnim = 0.3;
            var dd = Math.sqrt(b.x * b.x + b.z * b.z),
              lim = CFG.MAP * 0.47;
            if (dd > lim) {
              b.x *= lim / dd;
              b.z *= lim / dd;
            }
          }
          b.yaw = Math.atan2(sx || 0, sz || 1);
          b.pitch = Math.atan2(b.vy, 18);
        }

        function botDowned(b, dt) {
          var ai = b.ai;
          b.bleed -= dt;
          /* crawl toward the nearest standing teammate, else toward the storm centre */
          var mate = null,
            bd = 1e9;
          var team = teammates(b);
          for (var i = 0; i < team.length; i++) {
            var o = team[i];
            if (o.knocked) continue;
            var d = dist2(b.x, b.z, o.x, o.z);
            if (d < bd) {
              bd = d;
              mate = o;
            }
          }
          var tx, tz;
          if (mate) {
            tx = mate.x;
            tz = mate.z;
          } else {
            tx = STORM.cx;
            tz = STORM.cz;
          }
          var dx = tx - b.x,
            dz = tz - b.z,
            dd = Math.sqrt(dx * dx + dz * dz) || 1;
          var mx = 0,
            mz = 0;
          if (dd > 2.2) {
            mx = dx / dd;
            mz = dz / dd;
          }
          if (mate && dd < 2.4) {
            b.reviveProg = (b.reviveProg || 0) + dt / 5.0;
            if (b.reviveProg >= 1) {
              reviveChar(b, mate);
            }
          }
          moveChar(b, dt, mx, mz, false, false, false, false);
          b.aimX = Math.sin(b.yaw);
          b.aimZ = Math.cos(b.yaw);
          if (b.bleed <= 0) eliminate(b, b.lastAttacker || null);
        }

        function botThink(b) {
          var ai = b.ai;
          var D = DIFF_TABLE[DIFF];
          var sight = (ai.underFire > 0 ? 80 : 64) * D.range;
          if (ai.personality === "camper") sight *= 0.85;
          var enemy = findEnemy(b, sight);
          if (enemy) {
            if (ai.engage !== enemy) {
              ai.engage = enemy;
              ai.react = rnd(0.32, 0.9) * (1.3 - ai.accuracy) * D.react;
            }
            ai.lostT = 0;
          } else {
            ai.lostT += 0.25;
            if (ai.lostT > 2.2) ai.engage = null;
          }
          if (ai.react > 0) ai.react -= 0.25;

          /* weapon choice + reload */
          var bs = botBestSlot(b);
          if (bs !== b.slot) {
            b.slot = bs;
            attachWeapon(b);
          }
          if (bs > 0) {
            var def = WEAPONS[b.slots[bs].id];
            if (def.mag > 0 && b.slots[bs].ammoInMag <= 0) startReload(b);
          }

          /* ---- storm rotation ---- */
          var sc = STORM;
          var dc = dist2(b.x, b.z, sc.cx, sc.cz);
          ai.outside = dc > sc.r;
          ai.needRotate =
            dc > sc.r * 0.78 || (sc.state === "wait" && sc.timer < 10);
          if (ai.needRotate) {
            var tx = sc.nx !== undefined ? sc.nx : sc.cx,
              tz = sc.nz !== undefined ? sc.nz : sc.cz;
            if (dist2(b.x, b.z, tx, tz) > sc.r * 0.42) {
              ai.rotateX = tx;
              ai.rotateZ = tz;
            } else {
              ai.rotateX = sc.cx;
              ai.rotateZ = sc.cz;
            }
          }

          /* ---- revive a downed squadmate ---- */
          ai.reviveTarget = null;
          if (MODE !== "solo") {
            var team = teammates(b);
            var bestMate = null,
              bmd = 16;
            for (var i = 0; i < team.length; i++) {
              var o = team[i];
              if (!o.knocked) continue;
              var d = dist2(b.x, b.z, o.x, o.z);
              if (d < bmd) {
                bmd = d;
                bestMate = o;
              }
            }
            if (bestMate && (!enemy || bmd < 7)) ai.reviveTarget = bestMate;
          }

          /* ---- healing ---- */
          if (b.health < 70 && ai.healCd <= 0 && !enemy && !b.using) {
            if (useHeal(b)) ai.healCd = 3.0;
            else if (b.shield < 50 && b.heals.mini > 0) {
              ai.healCd = 3.0;
            }
          }

          /* ---- loot target ---- */
          if (!enemy && !ai.reviveTarget) {
            ai.lootT -= 0.25;
            if (ai.lootT <= 0) {
              ai.lootT = rnd(0.6, 1.6);
              ai.loot = findLoot(b, ai.needRotate ? 44 : 72);
            }
          } else ai.loot = null;

          /* ---- goal selection ---- */
          ai.mx = 0;
          ai.mz = 0;
          ai.sprint = false;
          ai.goalD = 99;
          if (enemy && ai.react <= 0) {
            ai.mode = "fight";
            return;
          }

          if (ai.reviveTarget) {
            ai.mode = "revive";
            setBotGoal(b, ai.reviveTarget.x, ai.reviveTarget.z, "revive");
            return;
          }
          /* a reboot card in hand means a trip to the nearest van beats looting */
          if (b.cards > 0 && deadTeammateOf(b)) {
            var vn = nearestVan(b, 1e9);
            if (vn) {
              ai.vanTarget = vn;
              ai.mode = "reboot";
              var va = Math.atan2(b.x - vn.x, b.z - vn.z);
              setBotGoal(
                b,
                vn.x + Math.sin(va) * 4.8,
                vn.z + Math.cos(va) * 4.8,
                "reboot",
              );
              return;
            }
          }
          ai.vanTarget = null;
          ai.mode = "move";
          if (ai.loot && ai.loot.obj) {
            var lo = ai.loot.obj;
            if (ai.loot.kind === "chest" && lo.opened) ai.loot = null;
            else if (
              ai.loot.kind === "drop" &&
              (lo.opened || lo.state !== "landed")
            )
              ai.loot = null;
            else {
              setBotGoal(b, lo.x, lo.z, "loot");
              return;
            }
          }
          if (ai.needRotate) {
            setBotGoal(b, ai.rotateX, ai.rotateZ, "storm");
            ai.sprint = true;
            return;
          }
          /* wander — campers hold the middle, everyone else drifts */
          if (
            ai.personality === "camper" &&
            dist2(b.x, b.z, STORM.cx, STORM.cz) < STORM.r * 0.55
          ) {
            ai.mode = "hold";
            return;
          }
          if (
            dist2(b.x, b.z, ai.goalX, ai.goalZ) < 4 ||
            ai.goalKind === "wander"
          ) {
            var a = rnd(0, 6.28),
              r = rnd(10, 28);
            var wx = b.x + Math.cos(a) * r,
              wz = b.z + Math.sin(a) * r;
            var dcen = Math.sqrt(wx * wx + wz * wz);
            if (dcen > CFG.PLAY_R * 0.92) {
              wx *= (CFG.PLAY_R * 0.9) / dcen;
              wz *= (CFG.PLAY_R * 0.9) / dcen;
            }
            setBotGoal(b, wx, wz, "wander");
          }
        }

        function botAct(b, dt) {
          var ai = b.ai,
            e = ai.engage;
          var mx = 0,
            mz = 0,
            sprint = false,
            jump = false,
            engage = false;

          if (ai.mode === "fight" && e && e.alive && ai.react <= 0) {
            engage = true;
            var w = b.slots[b.slot];
            var def = WEAPONS[w ? w.id : "pickaxe"];
            var closeRange = def.cls === "shotgun";
            var range = Math.min(
              def.range * (closeRange ? 0.55 : 0.8),
              def.cls === "sniper" ? 90 : 48,
            );
            if (ai.personality === "sniper")
              range = Math.min(def.range * 0.85, 110);
            if (ai.personality === "rusher") range *= 1.15;
            var d = dist2(b.x, b.z, e.x, e.z);
            var tx = e.x - b.x,
              tz = e.z - b.z;
            var want = Math.atan2(tx, tz);
            b.yaw = approachAngle(b.yaw, want, dt * 7.5 * ai.accuracy);
            var dy = e.y + 1.15 - (b.y + 1.45);
            b.pitch = lerp(
              b.pitch,
              Math.atan2(dy, Math.max(2, d)),
              Math.min(1, dt * 7),
            );
            if (d > range * 0.8) {
              mx = tx / d;
              mz = tz / d;
              sprint = true;
            } else if (d < range * 0.3) {
              mx = -tx / d;
              mz = -tz / d;
            } else {
              var px = Math.cos(b.yaw),
                pz = -Math.sin(b.yaw);
              mx = px * ai.strafe;
              mz = pz * ai.strafe;
            }
            var aligned = Math.abs(angDiff(b.yaw, want)) < 0.14;
            if (aligned && d < def.range * 1.05 && Math.abs(dy) < 14) {
              if (def.projectile) {
                if (b.fireCd <= 0 && d < def.range * 0.85) botShoot(b, e);
              } else if (def.burst) {
                if (ai.burstT > 0) {
                  ai.burstT -= dt;
                  if (ai.burstT <= 0) {
                    botShoot(b, e);
                    ai.burstT = def.burstGap;
                    ai.fireBurst--;
                  }
                } else if (b.fireCd <= 0) {
                  ai.fireBurst = def.burst;
                  ai.burstT = def.burstGap;
                  botShoot(b, e);
                }
              } else if (def.auto || b.fireCd <= 0) {
                botShoot(b, e);
              }
            }
            /* defensive + offensive building */
            if (ai.buildCd <= 0 && b.mats.wood >= COST * 2) {
              var wantBuild = false;
              if (ai.underFire > 0 && d > 6 && chance(0.6 * ai.buildSkill))
                wantBuild = true;
              else if (ai.personality === "rusher" && d > 10 && chance(0.25))
                wantBuild = true;
              else if (ai.personality === "builder" && chance(0.3))
                wantBuild = true;
              if (wantBuild) botBuild(b, e);
            }
            /* keep a preferred range for snipers */
            if (ai.personality === "sniper" && d < 16) {
              mx = -tx / d;
              mz = -tz / d;
            }
          } else if (ai.mode === "revive" && ai.reviveTarget) {
            var r = ai.reviveTarget;
            var rd = dist2(b.x, b.z, r.x, r.z);
            if (rd > 2.2) {
              mx = (r.x - b.x) / rd;
              mz = (r.z - b.z) / rd;
            } else {
              ai.reviveT += dt;
              if (ai.reviveT >= 5.0) {
                reviveChar(r, b);
                ai.reviveT = 0;
                ai.reviveTarget = null;
              }
            }
            if (ai.goalD > 1.5)
              b.yaw = approachAngle(
                b.yaw,
                Math.atan2(r.x - b.x, r.z - b.z),
                dt * 5,
              );
          } else if (ai.mode === "hold") {
            /* campers strafe a little and watch the horizon */
            b.yaw += Math.sin(GAMETIME * 0.4 + b.id) * dt * 0.6;
            if (chance(0.006)) ai.strafe *= -1;
            mx = Math.cos(b.yaw) * ai.strafe * 0.4;
            mz = -Math.sin(b.yaw) * ai.strafe * 0.4;
          } else {
            /* ---- follow the A* path ---- */
            var moved = false;
            if (ai.path && ai.pathI < ai.path.length) {
              var wp = ai.path[ai.pathI];
              var wd = dist2(b.x, b.z, wp.x, wp.z);
              if (wd < 1.8) ai.pathI++;
              if (ai.pathI >= ai.path.length) {
                ai.path = null;
              } else {
                var st = botSteer(b, wp.x, wp.z);
                ai.goalD = st.d;
                mx = st.x;
                mz = st.z;
                moved = true;
                b.yaw = approachAngle(b.yaw, Math.atan2(st.x, st.z), dt * 5);
              }
            }
            if (!moved) {
              var st2 = botSteer(b, ai.goalX, ai.goalZ);
              ai.goalD = st2.d;
              mx = st2.x;
              mz = st2.z;
              if (st2.d > 1.5)
                b.yaw = approachAngle(b.yaw, Math.atan2(st2.x, st2.z), dt * 5);
            }
            sprint =
              ai.sprint || (ai.goalD > 14 && ai.personality !== "camper");
            /* repath periodically or when stuck */
            ai.pathT -= dt;
            var spd = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
            if (spd < 0.6 && ai.goalD > 3) ai.stillT += dt;
            else ai.stillT = 0;
            if ((ai.pathT <= 0 && ai.goalD > 6) || ai.stillT > 0.9) {
              ai.pathT = rnd(1.8, 3.2);
              ai.stillT = 0;
              if (NAV.built) ai.path = navPath(b.x, b.z, ai.goalX, ai.goalZ);
              if (ai.path) ai.pathI = 0;
              else if (chance(0.5)) {
                /* give up on this goal */
                ai.goalKind = "wander";
                ai.path = null;
              }
            }
          }

          /* ---- interactions ---- */
          if (ai.loot && ai.loot.kind === "chest") {
            var c = ai.loot.obj;
            if (dist2(b.x, b.z, c.x, c.z) < 2.6 && Math.abs(b.y - c.y) < 3.2) {
              openChest(c, b);
              ai.loot = null;
            }
          }
          if (ai.loot && ai.loot.kind === "loot") {
            var it = ai.loot.obj;
            if (dist2(b.x, b.z, it.x, it.z) < 2.4 && Math.abs(b.y - it.y) < 3) {
              if (giveItem(b, it)) {
                removeLoot(it);
                ai.loot = null;
              } else ai.loot = null;
            }
          }
          if (ai.loot && ai.loot.kind === "card") {
            var cd = ai.loot.obj;
            if (dist2(b.x, b.z, cd.x, cd.z) < 2.4 && Math.abs(b.y - cd.y) < 3) {
              if (giveItem(b, cd)) {
                removeLoot(cd);
                ai.loot = null;
              } else ai.loot = null;
            }
          }
          if (ai.loot && ai.loot.kind === "drop") {
            var dp = ai.loot.obj;
            if (dp.opened || dp.state !== "landed") ai.loot = null;
            else if (
              dist2(b.x, b.z, dp.x, dp.z) < 17 &&
              Math.abs(b.y - dp.gy) < 3.5
            ) {
              openDrop(dp, b);
              ai.loot = null;
            }
          }
          /* reboot channel at a van */
          if (b.cards > 0 && ai.vanTarget && deadTeammateOf(b)) {
            var vn = ai.vanTarget;
            if (dist2(b.x, b.z, vn.x, vn.z) < 30) {
              ai.rebootT = (ai.rebootT || 0) + dt;
              if (ai.rebootT >= 6.0) {
                doReboot(vn, b);
                ai.rebootT = 0;
                ai.vanTarget = null;
              }
            } else ai.rebootT = 0;
          } else if (ai.rebootT) ai.rebootT = 0;
          if (engage && chance(0.06)) {
            for (var i = 0; i < LOOT.length; i++) {
              var it2 = LOOT[i];
              if (it2.kind === "weapon") continue;
              if (
                dist2(b.x, b.z, it2.x, it2.z) < 2.0 &&
                Math.abs(b.y - it2.y) < 3
              ) {
                if (giveItem(b, it2)) removeLoot(it2);
                break;
              }
            }
          }
          /* stuck -> jump */
          var moved2 = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
          if (
            moved2 < 0.5 &&
            !engage &&
            (ai.mode === "move" || ai.mode === "loot") &&
            ai.jumpCd <= 0
          ) {
            jump = true;
            ai.jumpCd = 1.0;
          }
          if (ai.outside && ai.jumpCd <= 0 && chance(0.02)) {
            jump = true;
            ai.jumpCd = 0.8;
          }
          moveChar(b, dt, mx, mz, jump, sprint, false, false);
          b.aimX = Math.sin(b.yaw);
          b.aimZ = Math.cos(b.yaw);
          b.aiming = engage;
          b.sprinting = sprint;
        }
        function botShoot(b, e) {
          var w = b.slots[b.slot];
          if (!w) return;
          var def = WEAPONS[w.id];
          if (def.mag > 0 && w.ammoInMag <= 0) {
            startReload(b);
            return;
          }
          var err = aiErr(b, e);
          var aimY = e.y + (e.knocked ? 0.5 : 1.15);
          var lead = 0;
          if (def.projectile) {
            var d = dist2(b.x, b.z, e.x, e.z);
            lead = d / def.speed;
            if (def.projectile === "nade") aimY += d * 0.09;
          }
          fireWeapon(
            b,
            e.x + e.vx * lead + err.x,
            aimY + err.y + (def.projectile === "nade" ? 2.4 : 0),
            e.z + e.vz * lead + err.z,
            false,
          );
          if (chance(0.3)) b.fireCd += rnd(0.12, 0.45);
        }
        function aiErr(b, e) {
          var d = dist2(b.x, b.z, e.x, e.z);
          var k = (1 - b.ai.accuracy) * 3.0 + d * 0.026;
          var moving = Math.sqrt(e.vx * e.vx + e.vz * e.vz) > 3 ? 1.35 : 1;
          return {
            x: rnd(-1, 1) * k * moving,
            y: rnd(-1, 1) * k * 0.7 * moving,
            z: rnd(-1, 1) * k * moving,
          };
        }
        function botBuild(b, e) {
          var ai = b.ai;
          var mat =
            b.mats.metal > 120
              ? "metal"
              : b.mats.stone > 120
                ? "stone"
                : "wood";
          if (b.mats[mat] < COST * 2) mat = "wood";
          if (b.mats[mat] < COST * 2) return;
          /* rushers push with ramps, defenders wall up */
          if (ai.personality === "rusher" && e && chance(0.55)) {
            if (rampRush(b, mat) > 0) {
              ai.buildCd = rnd(1.4, 2.6) / ai.buildSkill;
              return;
            }
          }
          var dx = ai.engage ? e.x - b.x : b.aimX;
          var dz = ai.engage ? e.z - b.z : b.aimZ;
          var l = Math.sqrt(dx * dx + dz * dz) || 1;
          dx /= l;
          dz /= l;
          var made = 0;
          /* a wall plus a ramp behind it is the classic panic tower */
          for (var i = 0; i < 3; i++) {
            var type = i === 0 ? "wall" : i === 1 ? "ramp" : "floor";
            var G = CFG.GRID;
            var px = b.x + dx * G * (0.8 + i * 0.35),
              pz = b.z + dz * G * (0.8 + i * 0.35);
            var pl = computePlacement(b.x, b.z, b.y, b.aimX, b.aimZ, 0, type);
            if (type === "floor")
              pl = computePlacement(px, pz, b.y + G, dx, dz, -1, type);
            if (pl && placementValid(pl, b) && b.mats[mat] >= COST) {
              if (placeBuild(pl, mat, b)) {
                b.mats[mat] -= COST;
                made++;
              }
            }
          }
          if (made) ai.buildCd = rnd(1.1, 2.4) / ai.buildSkill;
          else ai.buildCd = rnd(0.6, 1.2);
        }

// === storm ===
/* ==== 70_storm.js ==== */
        /* ============================================================================
   70_STORM â€” the shrinking circle, its volumetric wall shader, lightning,
   the battle bus and the skydive / glider descent.
   ========================================================================== */

        var STORM_PHASES = [
          { wait: 55, shrink: 44, r: 170, dmg: 1 },
          { wait: 40, shrink: 36, r: 118, dmg: 2 },
          { wait: 34, shrink: 32, r: 76, dmg: 5 },
          { wait: 30, shrink: 28, r: 44, dmg: 8 },
          { wait: 26, shrink: 24, r: 21, dmg: 10 },
          { wait: 24, shrink: 22, r: 7, dmg: 12 },
        ];
        var STORM = {
          phase: 0,
          state: "wait",
          timer: 0,
          cx: 0,
          cz: 0,
          r: 220,
          dmg: 1,
          nx: 0,
          nz: 0,
          nr: 0,
          active: false,
          mesh: null,
          ring: null,
          ringMat: null,
          sx: 0,
          sz: 0,
          sr: 0,
          dmgTick: 0,
          hurtFlash: 0,
          warnT: 0,
          boltT: 0,
          boltFlash: 0,
          wallA: null,
        };

        function initStormAssets() {
          if (STORM.mesh) return;
          var g = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true);
          var mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
            blending: THREE.NormalBlending,
            uniforms: {
              uTime: { value: 0 },
              uCol: { value: col(0x9b4ff0) },
              uCol2: { value: col(0x4a1a9c) },
              uOp: { value: 0.55 },
              uEdge: { value: 0.0 },
            },
            vertexShader:
              "varying vec2 vUv; varying vec3 vWorld; varying vec3 vNrm;" +
              "void main(){ vUv=uv; vNrm=normalize(mat3(modelMatrix)*normal);" +
              " vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz;" +
              " gl_Position=projectionMatrix*viewMatrix*wp; }",
            fragmentShader:
              "uniform float uTime; uniform vec3 uCol; uniform vec3 uCol2; uniform float uOp; uniform float uEdge;" +
              "varying vec2 vUv; varying vec3 vWorld; varying vec3 vNrm;" +
              "float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }" +
              "float nz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);" +
              " return mix(mix(h(i),h(i+vec2(1.0,0.0)),f.x), mix(h(i+vec2(0.0,1.0)),h(i+vec2(1.0,1.0)),f.x), f.y); }" +
              "float fb(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*nz(p); p*=2.13; a*=0.5; } return s; }" +
              "void main(){" +
              " vec3 vd=normalize(cameraPosition-vWorld);" +
              " float fr=1.0-abs(dot(vd,normalize(vNrm)));" +
              " float t=uTime*0.055;" +
              " float n1=fb(vUv*vec2(30.0,4.5)+vec2(t,uTime*0.32));" +
              " float n2=fb(vUv*vec2(62.0,9.0)-vec2(t*1.7,uTime*0.55));" +
              " float n=n1*0.62+n2*0.44;" +
              " float band=smoothstep(0.0,0.22,vUv.y)*(1.0-smoothstep(0.72,1.0,vUv.y));" +
              " float a=uOp*(0.20+0.80*fr)*(0.42+0.72*n)*band;" +
              " a+=uEdge*0.16;" +
              " vec3 c=mix(uCol2,uCol,clamp(n*1.25,0.0,1.0));" +
              " c+=vec3(0.55,0.30,1.0)*pow(max(n-0.62,0.0),2.0)*1.9;" +
              " c+=vec3(1.0,0.85,1.0)*pow(max(n-0.86,0.0),3.0)*2.4;" +
              " gl_FragColor=vec4(c,clamp(a,0.0,0.94)); }",
          });
          STORM.mesh = new THREE.Mesh(g, mat);
          STORM.mesh.frustumCulled = false;
          STORM.mesh.renderOrder = 3;
          scene.add(STORM.mesh);

          var rg = new THREE.CylinderGeometry(1, 1, 1, 80, 1, true);
          STORM.ringMat = new THREE.MeshBasicMaterial({
            color: col(0xffffff),
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            depthWrite: false,
            fog: false,
          });
          STORM.ring = new THREE.Mesh(rg, STORM.ringMat);
          STORM.ring.frustumCulled = false;
          STORM.ring.renderOrder = 4;
          scene.add(STORM.ring);
        }
        function resetStorm() {
          STORM.phase = 0;
          STORM.state = "wait";
          STORM.timer = STORM_PHASES[0].wait;
          STORM.cx = 0;
          STORM.cz = 0;
          STORM.r = 220;
          STORM.dmg = STORM_PHASES[0].dmg;
          STORM.active = false;
          STORM.dmgTick = 0;
          STORM.boltT = rnd(8, 18);
          STORM.boltFlash = 0;
          computeNextCircle();
          updateStormVisual();
        }
        function computeNextCircle() {
          var p = STORM_PHASES[STORM.phase];
          var nr = p.r;
          var maxOff = Math.max(0, STORM.r - nr) * 0.78;
          var a = rnd(0, 6.28),
            d = rnd(0.15, 1) * maxOff;
          STORM.nx = clamp(STORM.cx + Math.cos(a) * d, -152, 152);
          STORM.nz = clamp(STORM.cz + Math.sin(a) * d, -152, 152);
          STORM.nr = nr;
        }
        function updateStormVisual() {
          var H = 620;
          STORM.mesh.position.set(STORM.cx, 120, STORM.cz);
          STORM.mesh.scale.set(STORM.r, H, STORM.r);
          STORM.mesh.material.uniforms.uTime.value = GAMETIME;
          var distToWall = PC
            ? Math.abs(dist2(PC.x, PC.z, STORM.cx, STORM.cz) - STORM.r)
            : 999;
          STORM.mesh.material.uniforms.uEdge.value = clamp(
            1 - distToWall / 26,
            0,
            1,
          );
          STORM.mesh.material.uniforms.uOp.value =
            STORM.phase >= 4 ? 0.72 : 0.55;
          STORM.ring.position.set(STORM.nx, 60, STORM.nz);
          STORM.ring.scale.set(STORM.nr, 140, STORM.nr);
          STORM.ringMat.opacity = 0.12 + 0.12 * Math.sin(GAMETIME * 2.4);
        }
        function updateStorm(dt) {
          if (!STORM.active) {
            updateStormVisual();
            return;
          }
          STORM.timer -= dt;
          if (STORM.state === "wait") {
            if (STORM.timer <= 0) {
              STORM.state = "shrink";
              STORM.timer = STORM_PHASES[STORM.phase].shrink;
              STORM.sx = STORM.cx;
              STORM.sz = STORM.cz;
              STORM.sr = STORM.r;
              Sfx.stormStart();
              UI.banner(
                STORM.phase >= STORM_PHASES.length - 2
                  ? "FINAL CIRCLE"
                  : "THE STORM IS CLOSING",
                "GET INSIDE THE CIRCLE",
                2.6,
              );
            }
          } else {
            var p = STORM_PHASES[STORM.phase];
            var t = 1 - clamp(STORM.timer / p.shrink, 0, 1);
            STORM.cx = lerp(STORM.sx, STORM.nx, t);
            STORM.cz = lerp(STORM.sz, STORM.nz, t);
            STORM.r = lerp(STORM.sr, STORM.nr, t);
            if (STORM.timer <= 0) {
              STORM.cx = STORM.nx;
              STORM.cz = STORM.nz;
              STORM.r = STORM.nr;
              STORM.phase = Math.min(STORM.phase + 1, STORM_PHASES.length - 1);
              STORM.dmg = STORM_PHASES[STORM.phase].dmg;
              STORM.state = "wait";
              STORM.timer = STORM_PHASES[STORM.phase].wait;
              computeNextCircle();
              UI.banner(
                "STORM PHASE " + (STORM.phase + 1),
                Math.round(STORM.timer) + " SECONDS TO CLOSE",
                2.2,
              );
            }
          }
          /* lightning once the storm gets angry */
          if (STORM.phase >= 2) {
            STORM.boltT -= dt;
            if (STORM.boltT <= 0) {
              STORM.boltT = rnd(6, 16);
              STORM.boltFlash = 0.45;
              Sfx.thunder();
              UI.lightning();
            }
          }
          if (STORM.boltFlash > 0) {
            STORM.boltFlash -= dt;
            var f = Math.max(0, STORM.boltFlash / 0.45);
            hemi.intensity = 0.9 + f * 1.5;
            sun.intensity = 2.5 + f * 0.9;
          } else {
            hemi.intensity = 0.9;
            sun.intensity = 2.5;
          }

          /* damage ticks */
          STORM.dmgTick -= dt;
          if (STORM.dmgTick <= 0) {
            STORM.dmgTick = 1.0;
            for (var i = 0; i < CHARS.length; i++) {
              var c = CHARS[i];
              if (
                !c.alive ||
                c.onBus ||
                c.knocked ||
                c.state === "skydive" ||
                c.state === "glide"
              )
                continue;
              if (c.vehicle) continue;
              if (dist2(c.x, c.z, STORM.cx, STORM.cz) > STORM.r) {
                c.shield = Math.max(0, c.shield - STORM.dmg * 0.5);
                c.health -= STORM.dmg;
                c.hurtFlash = 0.25;
                if (c.isPlayer) {
                  UI.stormHurt();
                  Sfx.hurt();
                }
                if (c.health <= 0) tryKnockOrKill(c, null);
              }
            }
          }
          updateStormVisual();
          if (PC.alive) {
            var out = dist2(PC.x, PC.z, STORM.cx, STORM.cz) > STORM.r;
            UI.setStormOverlay(out ? 1 : 0);
            Sfx.setStorm(out ? 0.3 : 0.05);
            STORM.warnT -= dt;
            if (out && STORM.warnT <= 0) {
              STORM.warnT = 5;
              UI.banner("YOU ARE IN THE STORM", "GET TO THE SAFE ZONE", 2.0);
            }
          }
        }

        /* ============================================================================
   Battle bus
   ========================================================================== */
        var BUS = {
          x: 0,
          y: 208,
          z: 0,
          dx: 0,
          dz: 1,
          t: 0,
          mesh: null,
          active: true,
          balloon: null,
          prop: null,
        };
        function initBusAssets() {
          if (BUS.mesh) return;
          var g = new THREE.Group();
          var bodyMat = new THREE.MeshStandardMaterial({ color: col(0x2f4fa8), roughness: 0.38, metalness: 0.55 });
          var darkBody = new THREE.MeshStandardMaterial({ color: col(0x1e3570), roughness: 0.5, metalness: 0.4 });
          var glassMat = new THREE.MeshStandardMaterial({ color: col(0xa8d8ff), roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.65 });
          var trimMat = new THREE.MeshStandardMaterial({ color: col(0xffd76a), metalness: 0.7, roughness: 0.25, emissive: col(0x8a6000), emissiveIntensity: 0.15 });
          var rubber = new THREE.MeshStandardMaterial({ color: col(0x1a1a1a), roughness: 0.95 });
          var lightMat = new THREE.MeshStandardMaterial({ color: col(0xffffff), emissive: col(0xffffcc), emissiveIntensity: 0.8 });
          var tailLight = new THREE.MeshStandardMaterial({ color: col(0xff3333), emissive: col(0xff0000), emissiveIntensity: 0.5 });
          /* Main body */
          var bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.8, 9.4), bodyMat);
          bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
          g.add(bodyMesh);
          /* Roof AC units */
          for (var ri = 0; ri < 2; ri++) {
            var ac = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.25, 1.4), darkBody);
            ac.position.set(0, 1.52, -2 + ri * 4); ac.castShadow = true;
            g.add(ac);
          }
          /* Roof trim */
          var roofTrim = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.08, 9.5), trimMat);
          roofTrim.position.y = 1.44;
          g.add(roofTrim);
          /* Windshield */
          var windshield = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.3, 0.1), glassMat);
          windshield.position.set(0, 0.5, 4.75); windshield.rotation.x = -0.12;
          g.add(windshield);
          /* Rear window */
          var rearWin = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.1, 0.1), glassMat);
          rearWin.position.set(0, 0.5, -4.75);
          g.add(rearWin);
          /* Side windows + frames */
          for (var side = -1; side <= 1; side += 2) {
            for (var wi = 0; wi < 3; wi++) {
              var win = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 1.5), glassMat);
              win.position.set(side * 1.72, 0.65, -2.2 + wi * 2.4);
              g.add(win);
            }
            var ft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 9.2), darkBody);
            ft.position.set(side * 1.72, 1.15, 0); g.add(ft);
            var fb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 9.2), darkBody);
            fb.position.set(side * 1.72, 0.15, 0); g.add(fb);
            var df = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.8, 1.8), trimMat);
            df.position.set(side * 1.73, 0.0, 1.5); g.add(df);
          }
          /* Gold stripes */
          for (var s2 = -1; s2 <= 1; s2 += 2) {
            var st = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 9.3), trimMat);
            st.position.set(s2 * 1.72, -0.35, 0); g.add(st);
          }
          /* Front bumper + lights */
          var bumper = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.35, 0.4), rubber);
          bumper.position.set(0, -1.1, 4.8); g.add(bumper);
          for (var hl = -1; hl <= 1; hl += 2) {
            var headlight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.08), lightMat);
            headlight.position.set(hl * 1.1, -0.5, 4.78); g.add(headlight);
          }
          for (var tl = -1; tl <= 1; tl += 2) {
            var taillight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.08), tailLight);
            taillight.position.set(tl * 1.1, -0.5, -4.78); g.add(taillight);
          }
          /* Wheels with hubcaps */
          for (var w2 = 0; w2 < 4; w2++) {
            var sideW = w2 < 2 ? -1 : 1, frontBack = w2 % 2 === 0 ? -2.8 : 2.8;
            var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.45, 12), rubber);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(sideW * 1.8, -1.35, frontBack); wheel.castShadow = true;
            g.add(wheel);
            var hubcap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.48, 8), trimMat);
            hubcap.rotation.z = Math.PI / 2;
            hubcap.position.set(sideW * 1.8, -1.35, frontBack);
            g.add(hubcap);
          }
          /* Balloon with ribs and stripes */
          var balloonGroup = new THREE.Group();
          var balloonGeo = new THREE.SphereGeometry(6.8, 32, 26);
          balloonGeo.scale(1, 0.82, 1.15);
          var balloonMat2 = new THREE.MeshStandardMaterial({ color: col(0xe8556b), roughness: 0.5, metalness: 0.05 });
          var balloonMesh = new THREE.Mesh(balloonGeo, balloonMat2);
          balloonMesh.castShadow = true; balloonGroup.add(balloonMesh);
          /* Vertical ribs */
          for (var rib = 0; rib < 8; rib++) {
            var angle = (rib / 8) * Math.PI * 2;
            var ribCurve = new THREE.TorusGeometry(6.7, 0.06, 6, 24, Math.PI);
            var ribMesh = new THREE.Mesh(ribCurve, trimMat);
            ribMesh.rotation.y = angle; ribMesh.rotation.x = Math.PI / 2;
            balloonGroup.add(ribMesh);
          }
          /* Horizontal stripes */
          for (var sti = 0; sti < 3; sti++) {
            var stGeo = new THREE.TorusGeometry(5.8 + sti * 0.9, 0.12, 6, 32);
            var stMesh = new THREE.Mesh(stGeo, trimMat);
            stMesh.position.y = -1.5 + sti * 2.0; stMesh.rotation.x = Math.PI / 2;
            balloonGroup.add(stMesh);
          }
          /* Burner nozzle + fire glow */
          var nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 0.8, 8), darkBody);
          nozzle.position.y = -5.2; balloonGroup.add(nozzle);
          var fireGlow = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: col(0xff8800), transparent: true, opacity: 0.8 }));
          fireGlow.position.y = -5.8; fireGlow.name = "fireGlow";
          balloonGroup.add(fireGlow);
          balloonGroup.position.y = 11;
          g.add(balloonGroup);
          BUS.balloon = balloonGroup;
          /* Ropes */
          for (var r2 = 0; r2 < 4; r2++) {
            var ropeGeo = new THREE.CylinderGeometry(0.04, 0.04, 7.2, 4);
            var rope = new THREE.Mesh(ropeGeo, rubber);
            rope.position.set((r2 < 2 ? -1 : 1) * 1.3, 5.3, r2 % 2 === 0 ? -1.9 : 1.9);
            g.add(rope);
          }
          /* Propeller housing */
          var propHousing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.6), darkBody);
          propHousing.position.set(0, 0, 4.9); g.add(propHousing);
          /* Propeller */
          var prop = new THREE.Group();
          for (var p2 = 0; p2 < 3; p2++) {
            var blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 0.05), darkBody);
            blade.position.z = 0.35; prop.add(blade);
          }
          prop.position.set(0, 0, 5.15); g.add(prop);
          BUS.prop = prop;
          worldGroup.add(g);
          BUS.mesh = g;
          BUS.y = CFG.BUS_Y;
          BUS.mesh.position.set(BUS.x, BUS.y, BUS.z);
        }
        function resetBus() {
          var a = rnd(0, 6.28);
          BUS.dx = Math.cos(a);
          BUS.dz = Math.sin(a);
          var off = rnd(-70, 70);
          BUS.cx = -BUS.dz * off;
          BUS.cz = BUS.dx * off;
          BUS.t = -300;
          BUS.active = true;
          BUS.mesh.visible = true;
          BUS.x = BUS.cx + BUS.dx * BUS.t;
          BUS.z = BUS.cz + BUS.dz * BUS.t;
          BUS.y = CFG.BUS_Y;
          BUS.mesh.position.set(BUS.x, BUS.y, BUS.z);
        }
        function updateBus(dt) {
          if (!BUS.active) return;
          BUS.t += CFG.BUS_SPEED * dt;
          BUS.x = BUS.cx + BUS.dx * BUS.t;
          BUS.z = BUS.cz + BUS.dz * BUS.t;
          BUS.y = CFG.BUS_Y + Math.sin(GAMETIME * 0.7) * 2.5;
          BUS.mesh.position.set(BUS.x, BUS.y, BUS.z);
          BUS.mesh.rotation.y = Math.atan2(BUS.dx, BUS.dz);
          BUS.mesh.rotation.z = Math.sin(GAMETIME * 0.9) * 0.035;
          if (BUS.prop) BUS.prop.rotation.z += dt * 22;
          if (BUS.balloon) BUS.balloon.rotation.y += dt * 0.15;
          for (var i = 0; i < CHARS.length; i++) {
            var c = CHARS[i];
            if (c.onBus && !c.isPlayer && BUS.t > c.jumpAt * 520 - 260)
              ejectFromBus(c);
          }
          if (BUS.t > 300) {
            for (var j = 0; j < CHARS.length; j++)
              if (CHARS[j].onBus) ejectFromBus(CHARS[j]);
            BUS.active = false;
            BUS.mesh.visible = false;
            UI.hideBusHint();
            STORM.active = true;
            STORM.timer = STORM_PHASES[0].wait;
            Sfx.startStormLoop();
          }
        }
        function ejectFromBus(ch) {
          if (!ch.onBus) return;
          ch.onBus = false;
          ch.state = "skydive";
          ch.x = BUS.x + rnd(-2, 2);
          ch.z = BUS.z + rnd(-2, 2);
          ch.y = BUS.y - 2.5;
          ch.vx = BUS.dx * CFG.BUS_SPEED * 0.7;
          ch.vz = BUS.dz * CFG.BUS_SPEED * 0.7;
          ch.vy = -4;
          ch.glideLock = 0.55;
          ch.mesh.visible = true;
          if (ch.isPlayer) {
            UI.hideBusHint();
            UI.setGlider(true);
            Sfx.glider();
            Sfx.music("drop");
          }
        }
        function deployGlider(ch) {
          if (ch.state !== "skydive") return;
          ch.state = "glide";
          ch.vy = Math.min(ch.vy, -6);
          if (!ch.gliderMesh) {
            var g = new THREE.Group();
            /* Main canopy â€” semi-sphere shape */
            var canopyGeo = new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            var canopyMat = new THREE.MeshStandardMaterial({
              color: col(0x3fd0ff),
              roughness: 0.35,
              metalness: 0.15,
              side: THREE.DoubleSide,
              emissive: col(0x0d5f8a),
              emissiveIntensity: 0.3,
            });
            var canopy = new THREE.Mesh(canopyGeo, canopyMat);
            canopy.position.y = 3.4;
            canopy.castShadow = true;
            g.add(canopy);
            /* Center vent */
            var ventGeo = new THREE.CylinderGeometry(0.25, 0.35, 0.15, 10, 1, true);
            var ventMat = new THREE.MeshStandardMaterial({
              color: col(0x1a3050),
              side: THREE.DoubleSide,
            });
            var vent = new THREE.Mesh(ventGeo, ventMat);
            vent.position.y = 4.95;
            g.add(vent);
            /* Stripes on canopy */
            for (var si = 0; si < 4; si++) {
              var stripeAngle = (si / 4) * Math.PI * 2;
              var stripeGeo = new THREE.PlaneGeometry(0.15, 1.5);
              var stripeMat = new THREE.MeshStandardMaterial({
                color: col(0xffd76a),
                side: THREE.DoubleSide,
                emissive: col(0x6a4a00),
                emissiveIntensity: 0.2,
              });
              var stripe = new THREE.Mesh(stripeGeo, stripeMat);
              stripe.position.set(
                Math.cos(stripeAngle) * 0.8,
                3.8,
                Math.sin(stripeAngle) * 0.8,
              );
              stripe.lookAt(0, 3.8, 0);
              stripe.rotation.z = stripeAngle;
              g.add(stripe);
            }
            /* Suspension lines to harness */
            var lineMat = new THREE.MeshStandardMaterial({ color: col(0x2b3038) });
            for (var i = 0; i < 8; i++) {
              var angle = (i / 8) * Math.PI * 2;
              var topX = Math.cos(angle) * 1.4;
              var topZ = Math.sin(angle) * 1.4;
              var botX = Math.cos(angle) * 0.5;
              var botZ = Math.sin(angle) * 0.5;
              var midY = 2.8;
              var dx = botX - topX, dy = midY - 3.4, dz = botZ - topZ;
              var len = Math.sqrt(dx*dx + dy*dy + dz*dz);
              var lineGeo = new THREE.CylinderGeometry(0.012, 0.012, len, 3);
              var line = new THREE.Mesh(lineGeo, lineMat);
              line.position.set((topX+botX)/2, (3.4+midY)/2, (topZ+botZ)/2);
              line.lookAt(new THREE.Vector3(botX, midY, botZ));
              line.rotateX(Math.PI/2);
              g.add(line);
            }
            /* Harness / risers */
            var harnessMat = new THREE.MeshStandardMaterial({ color: col(0x3a3a3a) });
            for (var hi = -1; hi <= 1; hi += 2) {
              var riser = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.6, 0.25),
                harnessMat,
              );
              riser.position.set(hi * 0.5, 2.3, 0);
              g.add(riser);
            }
            /* Connecting bar */
            var bar = new THREE.Mesh(
              new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6),
              harnessMat,
            );
            bar.rotation.z = Math.PI / 2;
            bar.position.set(0, 2.0, 0);
            g.add(bar);
            ch.mesh.add(g);
            ch.gliderMesh = g;
          }
          ch.gliderMesh.visible = true;
          if (ch.isPlayer) {
            Sfx.glider();
            UI.setGlider(false);
          }
        }

// === drops ===
/* ==== 75_drops.js ==== */
        /* ============================================================================
   75_DROPS — supply drops.
   A ballooned crate descends into the safe zone on a timer and lands with a
   smoke column and a light beam. It holds top-tier loot and is the single most
   recognisable non-combat beat of a Battle Royale match, so bots contest it.
   ========================================================================== */

        var DROPS = [];
        var DROP_SCHED = { t: 58, n: 0, max: 8, gap: 74 };
        var DROP_TEX = null;

        function initDropAssets() {
          if (DROP_TEX) return;
          DROP_TEX = {
            crate: new THREE.MeshStandardMaterial({
              color: col(0x2d4f92),
              metalness: 0.55,
              roughness: 0.4,
              emissive: col(0x0a1c3c),
              emissiveIntensity: 0.55,
            }),
            trim: new THREE.MeshStandardMaterial({
              color: col(0xe8c14a),
              metalness: 0.92,
              roughness: 0.22,
              emissive: col(0x3a2a00),
              emissiveIntensity: 0.7,
            }),
            balloon: new THREE.MeshStandardMaterial({
              color: col(0xf4f8ff),
              metalness: 0.04,
              roughness: 0.86,
              emissive: col(0x243258),
              emissiveIntensity: 0.55,
              transparent: true,
              opacity: 0.95,
            }),
            rope: new THREE.MeshStandardMaterial({
              color: col(0xccd4e0),
              roughness: 0.92,
            }),
            beam: new THREE.MeshBasicMaterial({
              color: col(0x8fd0ff),
              transparent: true,
              opacity: 0.14,
              side: THREE.DoubleSide,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
              fog: false,
            }),
            puff: new THREE.SpriteMaterial({
              map: TEX.smoke,
              transparent: true,
              opacity: 0.45,
              depthWrite: false,
              color: col(0xe6eef8),
            }),
            geo: {
              body: new THREE.BoxGeometry(2.1, 1.5, 2.1),
              band: new THREE.BoxGeometry(2.18, 0.26, 2.18),
              cap: new THREE.BoxGeometry(1.5, 0.24, 1.5),
              ball: new THREE.SphereGeometry(1.5, 18, 14),
              rope: new THREE.CylinderGeometry(0.035, 0.035, 4.0, 5),
              beam: new THREE.CylinderGeometry(1.25, 1.25, 34, 12, 1, true),
            },
          };
        }

        /* ---------------------------------------------------------------- crate mesh */
        function makeDropMesh() {
          initDropAssets();
          var G = DROP_TEX.geo;
          var g = new THREE.Group();

          var body = new THREE.Mesh(G.body, DROP_TEX.crate);
          body.castShadow = true;
          body.receiveShadow = true;
          g.add(body);

          var band = new THREE.Mesh(G.band, DROP_TEX.trim);
          band.position.y = 0.34;
          g.add(band);
          var band2 = new THREE.Mesh(G.band, DROP_TEX.trim);
          band2.position.y = -0.34;
          g.add(band2);

          var cap = new THREE.Mesh(G.cap, DROP_TEX.trim);
          cap.position.y = 0.86;
          g.add(cap);

          var balloon = new THREE.Mesh(G.ball, DROP_TEX.balloon);
          balloon.position.y = 5.6;
          balloon.scale.set(1, 1.16, 1);
          g.add(balloon);

          for (var i = 0; i < 4; i++) {
            var a = (i * Math.PI) / 2 + 0.78;
            var r = new THREE.Mesh(G.rope, DROP_TEX.rope);
            r.position.set(Math.cos(a) * 0.82, 2.9, Math.sin(a) * 0.82);
            r.rotation.z = Math.cos(a) * 0.14;
            r.rotation.x = -Math.sin(a) * 0.14;
            g.add(r);
          }
          return { g: g, balloon: balloon, body: body };
        }

        /* --------------------------------------------------------------- landing fx */
        function makeDropBeacon() {
          initDropAssets();
          var g = new THREE.Group();
          var beam = new THREE.Mesh(DROP_TEX.geo.beam, DROP_TEX.beam.clone());
          beam.position.y = 17;
          g.add(beam);
          var smoke = [];
          for (var i = 0; i < 4; i++) {
            var s = new THREE.Sprite(DROP_TEX.puff.clone());
            s.scale.set(4.5, 4.5, 1);
            g.add(s);
            smoke.push(s);
          }
          g.visible = false;
          return { g: g, beam: beam, smoke: smoke };
        }

        /* ------------------------------------------------------------------ lifecycle */
        function resetDrops() {
          for (var i = 0; i < DROPS.length; i++) {
            if (DROPS[i].mesh) worldGroup.remove(DROPS[i].mesh.g);
            if (DROPS[i].beacon) worldGroup.remove(DROPS[i].beacon.g);
            /* retire the crate's collision box, otherwise every match would leave a
       fresh set of invisible solid blocks behind */
            if (DROPS[i].col) DROPS[i].col.dead = true;
          }
          DROPS.length = 0;
          DROP_SCHED.t = 58;
          DROP_SCHED.n = 0;
        }

        /* Pick a point inside the *next* circle so a drop is never doomed to land in
   the storm, and never on top of the player. */
        function dropSpawnPoint() {
          var cx = STORM.active ? STORM.nx : STORM.cx;
          var cz = STORM.active ? STORM.nz : STORM.cz;
          var rad = (STORM.active ? STORM.nr : STORM.r) * 0.74;
          if (rad < 12) rad = 12;
          for (var t = 0; t < 48; t++) {
            var a = rnd(0, 6.28),
              d = Math.sqrt(rnd(0, 1)) * rad;
            var x = clamp(cx + Math.cos(a) * d, -150, 150);
            var z = clamp(cz + Math.sin(a) * d, -150, 150);
            if (PC && dist2(x, z, PC.x, PC.z) < 625)
              continue; /* >= 25 units away */
            return { x: x, z: z };
          }
          return { x: cx, z: cz };
        }

        /* Where a crate should settle: the highest surface under the bus, so it rests
   on a rooftop instead of clipping through one. A player's sky tower is
   deliberately ignored — the crate falls to the ground beneath it instead. */
        function dropGroundY(x, z) {
          var t = terrainHeightAt(x, z);
          var top = groundInfo(x, z, CFG.BUS_Y).y;
          return top > t + 24 ? t : top;
        }

        function spawnDrop() {
          initDropAssets();
          var p = dropSpawnPoint();
          var gy = dropGroundY(p.x, p.z);
          var mm = makeDropMesh();
          var bc = makeDropBeacon();

          var d = {
            x: p.x,
            z: p.z,
            y: CFG.BUS_Y - 16,
            gy: gy + 0.95,
            vy: -1.5,
            state: "fall",
            sway: rnd(0, 6.28),
            trailT: 0,
            opened: false,
            age: 0,
            mesh: mm,
            beacon: bc,
          };
          mm.g.position.set(d.x, d.y, d.z);
          worldGroup.add(mm.g);
          worldGroup.add(bc.g);
          DROPS.push(d);

          DROP_SCHED.n++;
          Sfx.airdrop();
          UI.banner("SUPPLY DROP INCOMING", "HIGH-TIER LOOT INBOUND", 2.8);
          return d;
        }

        function updateDrops(dt) {
          /* --- scheduler: DROP_SCHED.t is a plain countdown in match seconds, so the
     first crate always arrives about a minute in and never during the drop-in --- */
          if (MATCH_RUNNING && DROP_SCHED.n < DROP_SCHED.max) {
            DROP_SCHED.t -= dt;
            if (DROP_SCHED.t <= 0) {
              DROP_SCHED.t = DROP_SCHED.gap + rnd(-14, 20);
              spawnDrop();
            }
          }
          /* --- per-drop --- */
          for (var i = 0; i < DROPS.length; i++) {
            var d = DROPS[i];
            d.age += dt;

            if (d.state === "fall") {
              d.vy = Math.max(-13.5, d.vy - 9.0 * dt);
              d.y += d.vy * dt;
              d.sway += dt * 0.85;

              if (d.y <= d.gy) {
                d.y = d.gy;
                d.state = "landed";
                d.mesh.g.position.set(d.x, d.y, d.z);
                d.mesh.g.rotation.set(0, d.mesh.g.rotation.y, 0);
                d.beacon.g.position.set(d.x, d.gy - 1.0, d.z);
                d.beacon.g.visible = true;
                /* A landed crate is solid. Keep the box so resetDrops() can retire it —
           the collider grid has no removal, only the `dead` flag. */
                d.col = {
                  minX: d.x - 1.15,
                  maxX: d.x + 1.15,
                  minY: d.gy - 0.9,
                  maxY: d.gy + 1.1,
                  minZ: d.z - 1.15,
                  maxZ: d.z + 1.15,
                };
                colliders.insert(d.col);
                Sfx.dropLand();
                fxSmoke(d.x, d.gy + 0.3, d.z, 10, 1.7, 1.3, 1.4);
                fxSpark(d.x, d.gy + 1.3, d.z, 0x9fd8ff, 16, 3.4, 0.5);
                if (PC && dist2(PC.x, PC.z, d.x, d.z) < 6400)
                  UI.banner("SUPPLY DROP LANDED", "CHECK YOUR MAP", 2.2);
                continue;
              }

              d.mesh.g.position.set(d.x, d.y, d.z);
              d.mesh.g.rotation.y += dt * 0.32;
              d.mesh.g.rotation.z = Math.sin(d.sway) * 0.1;
              d.mesh.g.rotation.x = Math.cos(d.sway * 0.83) * 0.08;

              d.trailT -= dt;
              if (d.trailT <= 0) {
                d.trailT = 0.15;
                fxSmoke(d.x, d.y + 1.0, d.z, 1, 0.75, 0.6, 0.7);
              }
              continue;
            }

            /* landed: pulse the beam, loop the smoke column */
            d.beacon.beam.material.opacity = d.opened
              ? 0
              : 0.1 + 0.07 * Math.sin(GAMETIME * 2.6 + i);
            for (var s = 0; s < d.beacon.smoke.length; s++) {
              var sp = d.beacon.smoke[s];
              var ph = (GAMETIME * 0.3 + s * 0.25 + i * 0.11) % 1;
              var wid = 0.7 * (1 + ph);
              sp.position.set(
                Math.sin(ph * 6.28 + i) * wid,
                1.2 + ph * 16,
                Math.cos(ph * 6.28 + s) * wid,
              );
              sp.scale.setScalar(3.0 + ph * 7.0);
              sp.material.opacity = d.opened ? 0 : 0.44 * (1 - ph) * (1 - ph);
            }
            if (d.opened) d.beacon.g.visible = false;
          }
        }

        /* ------------------------------------------------------------------ looting */
        function dropLoot(d) {
          /* a launcher plus a fistful of top-rarity gear, exactly like the real thing */
          spawnLoot(d.x + rnd(-0.9, 0.9), d.gy + 0.5, d.z + rnd(-0.9, 0.9), {
            kind: "weapon",
            id: "rpg",
            rarity: 3,
          });
          var n = rndi(4, 5);
          for (var i = 0; i < n; i++) {
            var r = rndi(0, 9),
              item;
            if (r < 6) {
              item = {
                kind: "weapon",
                id: pickOne(LOOT_WEAPONS.concat(RARE_WEAPONS)),
                rarity: chance(0.72) ? 4 : 3,
              };
            } else if (r === 6)
              item = {
                kind: "ammo",
                ammo: pickOne(["light", "medium", "shell", "heavy"]),
                count: 60,
              };
            else if (r === 7) item = { kind: "shield", count: 1 };
            else if (r === 8) item = { kind: "heal", heal: "med" };
            else item = { kind: "heal", heal: "pot" };
            var a = rnd(0, 6.28),
              rr = rnd(1.4, 3.0);
            spawnLoot(
              d.x + Math.cos(a) * rr,
              d.gy + 0.5,
              d.z + Math.sin(a) * rr,
              item,
            );
          }
        }

        function openDrop(d, by) {
          if (!d || d.opened || d.state !== "landed") return false;
          d.opened = true;
          d.beacon.g.visible = false;
          d.mesh.balloon.visible = false; /* the balloon drifts off */
          d.mesh.g.rotation.z = 0.06;
          Sfx.dropOpen();
          fxSpark(d.x, d.gy + 1.2, d.z, 0xffd76a, 22, 3.6, 0.6);
          fxSmoke(d.x, d.gy + 0.6, d.z, 6, 1.4, 1.0, 1.0);
          dropLoot(d);
          if (by) {
            by.mats.wood = Math.min(MAX_MATS, by.mats.wood + 40);
            by.mats.stone = Math.min(MAX_MATS, by.mats.stone + 40);
            by.mats.metal = Math.min(MAX_MATS, by.mats.metal + 40);
            if (by.isPlayer)
              UI.banner("SUPPLY DROP LOOTED", "LEGENDARY GEAR ACQUIRED", 2.0);
          }
          return true;
        }

        /* Landed, unopened crates are valid interaction targets. */
        function nearestDrop(ch) {
          var best = null,
            bd = 4.2;
          for (var i = 0; i < DROPS.length; i++) {
            var d = DROPS[i];
            if (d.opened || d.state !== "landed") continue;
            var dd = dist2(ch.x, ch.z, d.x, d.z);
            if (dd < bd && Math.abs(d.gy - ch.y) < 4.5) {
              bd = dd;
              best = d;
            }
          }
          return best;
        }

// === reboot ===
/* ==== 76_reboot.js ==== */
        /* ============================================================================
   76_REBOOT — reboot vans + reboot cards.
   When a squadmate is fully eliminated (not merely knocked) their reboot card
   drops where they died. A surviving teammate can carry it to one of the vans
   dotted around the map and channel a reboot, bringing them back with nothing
   but a pickaxe. Solo mode never produces cards.
   ========================================================================== */

        var VANS = [];
        var VAN_TEX = null;
        var REBOOT_ST = { van: null, by: null, prog: 0 };

        function initVanAssets() {
          if (VAN_TEX) return;
          VAN_TEX = {
            body: new THREE.MeshStandardMaterial({
              color: col(0xe2e8f4),
              metalness: 0.34,
              roughness: 0.52,
            }),
            dark: new THREE.MeshStandardMaterial({
              color: col(0x2a3346),
              metalness: 0.5,
              roughness: 0.45,
            }),
            glass: new THREE.MeshStandardMaterial({
              color: col(0x1a3550),
              metalness: 0.9,
              roughness: 0.12,
              emissive: col(0x0d3a6b),
              emissiveIntensity: 0.7,
            }),
            tyre: new THREE.MeshStandardMaterial({
              color: col(0x1b1f28),
              roughness: 0.88,
            }),
            glow: new THREE.MeshBasicMaterial({
              color: col(0x6bffd0),
              transparent: true,
              opacity: 0.42,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
              fog: false,
            }),
            halo: new THREE.SpriteMaterial({
              map: TEX.glow,
              color: col(0x6bffd0),
              transparent: true,
              opacity: 0.42,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
            geo: {
              body: new THREE.BoxGeometry(2.6, 2.0, 5.4),
              cab: new THREE.BoxGeometry(2.5, 1.5, 1.9),
              wind: new THREE.BoxGeometry(2.34, 0.85, 0.14),
              skirt: new THREE.BoxGeometry(2.7, 0.5, 5.6),
              dish: new THREE.SphereGeometry(0.62, 14, 10, 0, 6.283, 0, 1.15),
              mast: new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8),
              wheel: new THREE.CylinderGeometry(0.55, 0.55, 0.34, 14),
              panel: new THREE.BoxGeometry(0.12, 1.0, 3.0),
            },
          };
        }

        function makeVanMesh() {
          initVanAssets();
          var G = VAN_TEX.geo;
          var g = new THREE.Group();

          var body = new THREE.Mesh(G.body, VAN_TEX.body);
          body.position.y = 1.35;
          body.castShadow = true;
          body.receiveShadow = true;
          g.add(body);

          var cab = new THREE.Mesh(G.cab, VAN_TEX.body);
          cab.position.set(0, 1.05, 2.9);
          cab.castShadow = true;
          g.add(cab);

          var wind = new THREE.Mesh(G.wind, VAN_TEX.glass);
          wind.position.set(0, 1.35, 3.86);
          g.add(wind);

          var skirt = new THREE.Mesh(G.skirt, VAN_TEX.dark);
          skirt.position.y = 0.5;
          g.add(skirt);

          var mast = new THREE.Mesh(G.mast, VAN_TEX.dark);
          mast.position.set(0, 2.5, -0.9);
          g.add(mast);
          var dish = new THREE.Mesh(G.dish, VAN_TEX.body);
          dish.position.set(0, 2.75, -0.9);
          dish.rotation.x = -0.9;
          g.add(dish);

          var off = [
            [-1.32, 2.0],
            [1.32, 2.0],
            [-1.32, -1.9],
            [1.32, -1.9],
          ];
          for (var i = 0; i < off.length; i++) {
            var w = new THREE.Mesh(G.wheel, VAN_TEX.tyre);
            w.rotation.z = Math.PI / 2;
            w.position.set(off[i][0], 0.55, off[i][1]);
            w.castShadow = true;
            g.add(w);
          }

          var glow = VAN_TEX.glow.clone();
          var p1 = new THREE.Mesh(G.panel, glow);
          p1.position.set(1.34, 1.4, 0);
          g.add(p1);
          var p2 = new THREE.Mesh(G.panel, glow);
          p2.position.set(-1.34, 1.4, 0);
          g.add(p2);

          var halo = new THREE.Sprite(VAN_TEX.halo.clone());
          halo.scale.set(7, 7, 1);
          halo.position.y = 2.2;
          g.add(halo);

          return { g: g, glow: glow, halo: halo };
        }

        /* Vans sit beside a spread of POIs so every squad has one within reach. */
        function buildRebootVans() {
          initVanAssets();
          if (VANS.length) return;
          var want = Math.min(9, POIS.length);
          if (want <= 0) return;
          var stride = Math.max(1, Math.floor(POIS.length / want));
          for (var i = 0; i < POIS.length && VANS.length < want; i += stride) {
            var p = POIS[i];
            var a = rnd(0, 6.28);
            var r = p.r * 0.55 + 7.5;
            var x = clamp(p.x + Math.cos(a) * r, -150, 150);
            var z = clamp(p.z + Math.sin(a) * r, -150, 150);
            var y = terrainHeightAt(x, z);
            if (y < 2.0 || terrainSlope(x, z) > 0.5) {
              a += 1.9;
              x = clamp(p.x + Math.cos(a) * r, -150, 150);
              z = clamp(p.z + Math.sin(a) * r, -150, 150);
              y = terrainHeightAt(x, z);
              if (y < 2.0) continue;
            }
            var mm = makeVanMesh();
            var yaw = rnd(0, 6.28);
            mm.g.position.set(x, y, z);
            mm.g.rotation.y = yaw;
            worldGroup.add(mm.g);
            colliders.insert({
              minX: x - 1.5,
              maxX: x + 1.5,
              minY: y - 0.4,
              maxY: y + 2.5,
              minZ: z - 2.9,
              maxZ: z + 2.9,
            });
            VANS.push({
              x: x,
              y: y,
              z: z,
              yaw: yaw,
              mesh: mm.g,
              glow: mm.glow,
              halo: mm.halo,
              user: null,
              prog: 0,
              ph: rnd(0, 6.28),
            });
          }
        }

        function resetReboot() {
          REBOOT_ST.van = null;
          REBOOT_ST.by = null;
          REBOOT_ST.prog = 0;
          for (var i = 0; i < VANS.length; i++) {
            VANS[i].user = null;
            VANS[i].prog = 0;
          }
          for (var c = 0; c < CHARS.length; c++) {
            CHARS[c].cards = 0;
          }
          if (PC) PC.cards = 0;
        }

        /* --------------------------------------------------------------- reboot cards */
        function livingTeammatesOf(ch) {
          var n = 0;
          for (var i = 0; i < CHARS.length; i++) {
            var o = CHARS[i];
            if (o === ch || !o.alive) continue;
            if (
              o.team === undefined ||
              ch.team === undefined ||
              o.team !== ch.team
            )
              continue;
            n++;
          }
          return n;
        }
        function deadTeammateOf(ch) {
          for (var i = 0; i < CHARS.length; i++) {
            var o = CHARS[i];
            if (o === ch || o.alive) continue;
            if (
              o.team === undefined ||
              ch.team === undefined ||
              o.team !== ch.team
            )
              continue;
            return o;
          }
          return null;
        }
        /* Called from eliminate(): only worth a card if somebody is left to carry it. */
        function spawnRebootCard(ch) {
          if (MODE === "solo") return null;
          if (ch.team === undefined) return null;
          if (livingTeammatesOf(ch) <= 0) return null;
          return spawnLoot(
            ch.x + rnd(-0.8, 0.8),
            ch.y + 0.6,
            ch.z + rnd(-0.8, 0.8),
            { kind: "card", team: ch.team, owner: ch.name, ownerRef: ch },
          );
        }

        function nearestVan(ch, maxD) {
          var best = null,
            bd = maxD || 4.6;
          for (var i = 0; i < VANS.length; i++) {
            var v = VANS[i];
            var d = dist2(ch.x, ch.z, v.x, v.z);
            if (d < bd && Math.abs(v.y - ch.y) < 4.5) {
              bd = d;
              best = v;
            }
          }
          return best;
        }

        /* -------------------------------------------------------------- the reboot */
        function doReboot(van, by) {
          if (!van || !by) return false;
          if (!by.cards || by.cards <= 0) return false;
          var mate = deadTeammateOf(by);
          if (!mate) return false;

          by.cards = Math.max(0, by.cards - 1);

          var a = rnd(0, 6.28);
          var rx = van.x + Math.cos(a) * 3.0,
            rz = van.z + Math.sin(a) * 3.0;
          var ry = terrainHeightAt(rx, rz);

          mate.alive = true;
          mate.knocked = false;
          mate.bleed = 0;
          mate.reviveProg = 0;
          mate.health = 100;
          mate.shield = 0;
          mate.hurtFlash = 0;
          mate.landAnim = 0.4;
          mate.x = rx;
          mate.y = ry + 0.2;
          mate.z = rz;
          mate.vx = 0;
          mate.vy = 0;
          mate.vz = 0;
          mate.yaw = van.yaw + Math.PI;
          mate.pitch = 0;
          mate.state = "ground";
          mate.onBus = false;
          mate.vehicle = null;
          mate.using = null;
          mate.reloading = null;
          mate.fireCd = 0.7;
          mate.cards = 0;
          /* reboots come back with nothing but a pickaxe — that is the whole point */
          mate.slots = [
            { id: "pickaxe", rarity: 0, ammoInMag: 0 },
            null,
            null,
            null,
            null,
            null,
          ];
          mate.slot = 0;
          mate.ammo = { light: 0, medium: 0, heavy: 0, shell: 0, rocket: 0 };
          mate.mats = { wood: 0, stone: 0, metal: 0 };
          mate.heals = { band: 0, mini: 0, med: 0, pot: 0 };
          if (mate.mesh) mate.mesh.visible = true;
          if (mate.buildGroup) mate.buildGroup.visible = true;
          if (mate.ai) {
            mate.ai.mode = "idle";
            mate.ai.think = 0;
            mate.ai.engage = null;
            mate.ai.loot = null;
            mate.ai.path = null;
            mate.ai.reviveTarget = null;
          }
          ALIVE++;

          if (mate.isPlayer) {
            SPECTATING = false;
            SPECTATE_TARGET = null;
            MATCH_OVER = false;
            END_SHOWN = false;
            PC.placement = 0;
            var es = document.getElementById("endScreen");
            if (es) es.classList.add("hidden");
            UI.show();
            attachWeapon(PC);
            UI.showRevive(false);
          }

          fxSpark(rx, ry + 1.0, rz, 0x6bffd0, 26, 3.6, 0.65);
          fxSmoke(rx, ry + 0.4, rz, 8, 1.5, 1.1, 1.1);
          Sfx.reboot();
          UI.killFeed(
            by.name,
            mate.name,
            by === PC,
            mate.isPlayer,
            true,
            "rebooted",
          );
          UI.banner(
            "TEAMMATE REBOOTED",
            mate.name.toUpperCase() + " IS BACK IN THE FIGHT",
            2.6,
          );
          van.user = null;
          van.prog = 0;
          checkMatchEnd();
          return true;
        }

        function updateReboot(dt) {
          for (var i = 0; i < VANS.length; i++) {
            var v = VANS[i];
            var usable = false;
            for (var c = 0; c < CHARS.length; c++) {
              var ch = CHARS[c];
              if (
                ch.alive &&
                !ch.knocked &&
                ch.cards > 0 &&
                dist2(ch.x, ch.z, v.x, v.z) < 30
              ) {
                usable = true;
                break;
              }
            }
            var pulse = 0.3 + 0.16 * Math.sin(GAMETIME * 2.2 + v.ph);
            v.glow.opacity = usable ? pulse + 0.22 : pulse;
            v.halo.material.opacity = usable ? 0.55 : 0.3;
          }
        }

// === ui ===
/* ==== 80_ui.js ==== */
        /* ============================================================================
   80_UI — input (keyboard / mouse / pointer-lock / touch), the HUD, minimap,
   compass, kill feed, damage numbers, full map screen, settings, backpack.
   ========================================================================== */

        var IS_MOBILE = (function () {
          var ua = navigator.userAgent || "";
          var touch = "ontouchstart" in window || navigator.maxTouchPoints > 1;
          return (
            touch && /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)
          );
        })();

        var Input = {
          forward: false,
          back: false,
          left: false,
          right: false,
          jump: false,
          sprint: false,
          crouch: false,
          fire: false,
          aim: false,
          reload: false,
          build: false,
          use: false,
          axisX: 0,
          axisZ: 0,
          joyX: 0,
          joyZ: 0,
          lookDX: 0,
          lookDY: 0,
          locked: false,
          rmb: false,
          wheel: 0,
          firePress: false,
          usePress: false,
          jumpPress: false,
          slotPress: -1,
          uiBlock: false,
          init: function () {
            var cv = document.getElementById("gl");
            var self = this;
            /* Layout-independent key resolver: e.code is the PHYSICAL key,
               so WASD keeps working on Persian/Arabic/Russian/etc. layouts
               where e.key would be a non-Latin letter instead of "w". */
            function keyOf(e) {
              var c = e.code || "";
              if (/^Key[A-Z]$/.test(c)) return c.charAt(3).toLowerCase();
              if (/^Digit[0-9]$/.test(c)) return c.charAt(5);
              if (c === "Space") return " ";
              if (c === "ShiftLeft" || c === "ShiftRight") return "shift";
              if (c === "ControlLeft" || c === "ControlRight")
                return "control";
              if (c === "Tab") return "tab";
              if (c === "Escape") return "escape";
              if (c.indexOf("Arrow") === 0) return c.toLowerCase();
              return (e.key || "").toLowerCase();
            }
            window.addEventListener("keydown", function (e) {
              if (e.repeat) return;
              var k = keyOf(e);
              if (k === "escape") {
                if (UI.anyOverlay()) {
                  UI.closeOverlays();
                } else UI.toggleSettings();
                e.preventDefault();
                return;
              }
              if (UI.anyOverlay() && k !== "m" && k !== "tab" && k !== "i") return;
              if (k === "w" || k === "arrowup") self.forward = true;
              else if (k === "s" || k === "arrowdown") self.back = true;
              else if (k === "a" || k === "arrowleft") self.left = true;
              else if (k === "d" || k === "arrowright") self.right = true;
              else if (k === " ") {
                self.jump = true;
                self.jumpPress = true;
                e.preventDefault();
              } else if (k === "shift") self.sprint = true;
              else if (k === "control") self.crouch = !self.crouch;
              else if (k === "r") self.reload = true;
              else if (k === "f") {
                self.use = true;
                self.usePress = true;
              } else if (k === "c") UI.healPress = true;
              else if (k === "q") toggleBuildMode();
              else if (k === "v") cycleBuildMat();
              else if (k === "g") {
                if (BUILD_MODE) doEdit();
              } else if (k === "m" || k === "tab") {
                UI.toggleMap();
                e.preventDefault();
              } else if (k === "i") UI.toggleInventory();
              else if (k >= "1" && k <= "6") {
                var n = parseInt(k, 10);
                if (BUILD_MODE && n <= 4)
                  setBuildPiece(["wall", "floor", "ramp", "pyramid"][n - 1]);
                else selectSlot(n - 1);
              }
              if (k === "tab") e.preventDefault();
            });
            window.addEventListener("keyup", function (e) {
              var k = keyOf(e);
              if (k === "w" || k === "arrowup") self.forward = false;
              else if (k === "s" || k === "arrowdown") self.back = false;
              else if (k === "a" || k === "arrowleft") self.left = false;
              else if (k === "d" || k === "arrowright") self.right = false;
              else if (k === " ") self.jump = false;
              else if (k === "shift") self.sprint = false;
              else if (k === "f") self.use = false;
              else if (k === "r") self.reload = false;
            });
            cv.addEventListener("mousedown", function (e) {
              Sfx.init();
              Sfx.resume();
              if (self.uiBlock) return;
              /* First click captures the mouse (pointer lock): the cursor
                 hides and mouse movement rotates the camera. That capture
                 click should NOT fire the weapon. */
              if (
                !self.locked &&
                !self.noLock &&
                !IS_MOBILE &&
                cv.requestPointerLock
              ) {
                cv.requestPointerLock();
                return;
              }
              if (e.button === 0) {
                self.fire = true;
                self.firePress = true;
              }
              if (e.button === 2) {
                self.aim = true;
                self.rmb = true;
              }
            });
            document.addEventListener("pointerlockerror", function () {
              /* Browser blocked mouse capture (e.g. inside an iframe
                 preview) — fall back to right-drag look instead. */
              self.noLock = true;
              UI.showPrompt(
                "MOUSE CAPTURE BLOCKED &middot; RIGHT-DRAG TO LOOK",
                2.5,
              );
            });
            window.addEventListener("mouseup", function (e) {
              if (e.button === 0) self.fire = false;
              if (e.button === 2) {
                self.aim = false;
                self.rmb = false;
              }
            });
            cv.addEventListener("contextmenu", function (e) {
              e.preventDefault();
            });
            document.addEventListener("pointerlockchange", function () {
              self.locked = document.pointerLockElement === cv;
              if (!self.locked && MATCH_RUNNING && !IS_MOBILE)
                UI.showPrompt(
                  "CLICK TO CAPTURE MOUSE &middot; RIGHT-DRAG TO LOOK",
                  1.8,
                );
            });
            document.addEventListener("mousemove", function (e) {
              if (self.uiBlock) return;
              if (self.locked || self.rmb) {
                self.lookDX += e.movementX || 0;
                self.lookDY += e.movementY || 0;
              }
            });
            cv.addEventListener(
              "wheel",
              function (e) {
                if (self.uiBlock) return;
                self.wheel += e.deltaY > 0 ? 1 : -1;
                e.preventDefault();
              },
              { passive: false },
            );
            if (IS_MOBILE) this.initTouch();
            window.addEventListener("resize", onResize);
            window.addEventListener("blur", function () {
              self.forward =
                self.back =
                self.left =
                self.right =
                self.fire =
                  false;
              self.joyX = 0;
              self.joyZ = 0;
            });
          },
          initTouch: function () {
            var self = this;
            document.getElementById("touch").classList.remove("hidden");
            var joy = document.getElementById("joy"),
              knob = document.getElementById("joyKnob");
            var jid = null,
              jcx = 0,
              jcy = 0,
              jr = 56;
            joy.addEventListener(
              "touchstart",
              function (e) {
                Sfx.init();
                Sfx.resume();
                var t = e.changedTouches[0];
                jid = t.identifier;
                var r = joy.getBoundingClientRect();
                jcx = r.left + r.width / 2;
                jcy = r.top + r.height / 2;
                e.preventDefault();
              },
              { passive: false },
            );
            joy.addEventListener(
              "touchmove",
              function (e) {
                for (var i = 0; i < e.changedTouches.length; i++) {
                  var t = e.changedTouches[i];
                  if (t.identifier !== jid) continue;
                  var dx = (t.clientX - jcx) / jr,
                    dy = (t.clientY - jcy) / jr;
                  var l = Math.sqrt(dx * dx + dy * dy);
                  if (l > 1) {
                    dx /= l;
                    dy /= l;
                  }
                  self.joyX = dx;
                  self.joyZ = -dy;
                  knob.style.transform =
                    "translate(" + dx * jr + "px," + dy * jr + "px)";
                  e.preventDefault();
                }
              },
              { passive: false },
            );
            function endJoy(e) {
              for (var i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === jid) {
                  jid = null;
                  self.joyX = 0;
                  self.joyZ = 0;
                  knob.style.transform = "";
                }
              }
            }
            joy.addEventListener("touchend", endJoy);
            joy.addEventListener("touchcancel", endJoy);

            var lid = null,
              lx = 0,
              ly = 0;
            var cv = document.getElementById("gl");
            cv.addEventListener(
              "touchstart",
              function (e) {
                Sfx.init();
                Sfx.resume();
                var t = e.changedTouches[0];
                lid = t.identifier;
                lx = t.clientX;
                ly = t.clientY;
                e.preventDefault();
              },
              { passive: false },
            );
            cv.addEventListener(
              "touchmove",
              function (e) {
                for (var i = 0; i < e.changedTouches.length; i++) {
                  var t = e.changedTouches[i];
                  if (t.identifier !== lid) continue;
                  self.lookDX += (t.clientX - lx) * 2.4;
                  self.lookDY += (t.clientY - ly) * 2.4;
                  lx = t.clientX;
                  ly = t.clientY;
                  e.preventDefault();
                }
              },
              { passive: false },
            );
            cv.addEventListener("touchend", function (e) {
              for (var i = 0; i < e.changedTouches.length; i++)
                if (e.changedTouches[i].identifier === lid) lid = null;
            });
            function bind(id, on, off) {
              var el = document.getElementById(id);
              if (!el) return;
              el.addEventListener(
                "touchstart",
                function (e) {
                  Sfx.init();
                  Sfx.resume();
                  on();
                  el.classList.add("on");
                  e.preventDefault();
                },
                { passive: false },
              );
              el.addEventListener(
                "touchend",
                function (e) {
                  if (off) off();
                  el.classList.remove("on");
                  e.preventDefault();
                },
                { passive: false },
              );
              el.addEventListener("touchcancel", function (e) {
                if (off) off();
                el.classList.remove("on");
              });
            }
            bind(
              "tbJump",
              function () {
                self.jump = true;
                self.jumpPress = true;
              },
              function () {
                self.jump = false;
              },
            );
            bind(
              "tbFire",
              function () {
                self.fire = true;
                self.firePress = true;
              },
              function () {
                self.fire = false;
              },
            );
            bind("tbAim", function () {
              self.aim = !self.aim;
            });
            bind("tbBuild", function () {
              toggleBuildMode();
            });
            bind(
              "tbReload",
              function () {
                self.reload = true;
              },
              function () {
                self.reload = false;
              },
            );
            bind(
              "tbUse",
              function () {
                self.use = true;
                self.usePress = true;
              },
              function () {
                self.use = false;
              },
            );
            bind("tbCrouch", function () {
              self.crouch = !self.crouch;
            });
            bind("tbSlot", function () {
              selectSlot((PC.slot + 1) % 6);
            });
            bind("tbHeal", function () {
              UI.healPress = true;
            });
            bind("tbMap", function () {
              UI.toggleMap();
            });
          },
          poll: function () {
            var x = (this.right ? 1 : 0) - (this.left ? 1 : 0) + this.joyX;
            var z = (this.forward ? 1 : 0) - (this.back ? 1 : 0) + this.joyZ;
            this.axisX = clamp(x, -1, 1);
            this.axisZ = clamp(z, -1, 1);
          },
          consumeLook: function () {
            var d = this.lookDX;
            this.lookDX = 0;
            return d;
          },
          consumeLookY: function () {
            var d = this.lookDY;
            this.lookDY = 0;
            return d;
          },
        };

        /* ============================================================================
   UI
   ========================================================================== */
        var UI = {
          slotEls: [],
          lastMap: 0,
          healPress: false,
          _el: {},
          init: function () {
            var bar = document.getElementById("slotBar");
            for (var i = 0; i < 6; i++) {
              var d = document.createElement("div");
              d.className = "slot empty";
              d.innerHTML =
                '<span class="k">' +
                (i + 1) +
                '</span><span class="ic"></span><span class="r"></span><span class="n">-</span><span class="a"></span>';
              bar.appendChild(d);
              this.slotEls.push(d);
            }
            var mat = document.getElementById("mat");
            var names = [
              ["wood", "WOOD"],
              ["stone", "STONE"],
              ["metal", "METAL"],
            ];
            for (var m = 0; m < 3; m++) {
              var e = document.createElement("div");
              e.className = "mat " + names[m][0];
              /* The chip used to be just a coloured square plus a number, so there was no
         way to tell wood from stone from metal at a glance. Render the label. */
              e.innerHTML =
                '<i></i><b id="mat' +
                names[m][1] +
                '">0</b>' +
                '<span style="font-size:9px;opacity:.6;letter-spacing:.4px;margin-left:3px">' +
                names[m][1] +
                "</span>";
              mat.appendChild(e);
            }
            var cons = document.getElementById("cons");
            var cnames = [
              ["band", "band", "BAND"],
              ["mini", "mini", "MINI"],
              ["med", "med", "MED"],
              ["pot", "pot", "POT"],
            ];
            for (var c = 0; c < cnames.length; c++) {
              var ce = document.createElement("div");
              ce.className = "cns " + cnames[c][0];
              ce.innerHTML =
                '<i></i><b id="cns' +
                cnames[c][1] +
                '">0</b>' +
                '<span style="font-size:9px;opacity:.6;letter-spacing:.4px;margin-left:3px">' +
                cnames[c][2] +
                "</span>";
              cons.appendChild(ce);
            }
            document
              .getElementById("btnPlay")
              .addEventListener("click", function () {
                Sfx.init();
                Sfx.resume();
                startMatch();
              });
            document
              .getElementById("btnAgain")
              .addEventListener("click", function () {
                restartMatch();
              });
            document
              .getElementById("btnSpectate")
              .addEventListener("click", function () {
                if (MATCH_OVER) return;
                document.getElementById("endScreen").classList.add("hidden");
                END_SHOWN = false;
                SPECTATING = true;
                if (!SPECTATE_TARGET || !SPECTATE_TARGET.alive)
                  pickSpectateTarget();
                UI.show();
                UI.showPrompt(
                  "SPECTATING &mdash; CLICK OR <b>FIRE</b> TO SWITCH",
                  2.4,
                );
              });
            document
              .getElementById("buildBar")
              .addEventListener("click", function (e) {
                var t = e.target.closest(".bp");
                if (!t) return;
                if (t.dataset.piece === "edit") doEdit();
                else setBuildPiece(t.dataset.piece);
              });
            bar.addEventListener("click", function (e) {
              var t = e.target.closest(".slot");
              if (t) selectSlot(Array.prototype.indexOf.call(bar.children, t));
            });
            document
              .getElementById("btnMap")
              .addEventListener("click", function () {
                UI.toggleMap();
              });
            document
              .getElementById("btnFullscreen")
              .addEventListener("click", function () {
                UI.toggleFullscreen();
              });
            document.addEventListener("fullscreenchange", function () {
              var b = document.getElementById("btnFullscreen");
              if (b)
                b.textContent = document.fullscreenElement
                  ? "â›¶ EXIT"
                  : "â›¶ FULLSCREEN";
            });
            document.addEventListener("webkitfullscreenchange", function () {
              var b = document.getElementById("btnFullscreen");
              if (b)
                b.textContent = document.webkitFullscreenElement
                  ? "â›¶ EXIT"
                  : "â›¶ FULLSCREEN";
            });
            document
              .getElementById("btnSetClose")
              .addEventListener("click", function () {
                UI.closeOverlays();
              });
            document
              .getElementById("mapScreen")
              .addEventListener("click", function (e) {
                if (e.target.id === "mapScreen") UI.closeOverlays();
              });
            var mr = document.getElementById("modeRow");
            mr.addEventListener("click", function (e) {
              var b = e.target.closest("button.mode");
              if (!b) return;
              var kids = mr.querySelectorAll("button.mode");
              for (var i = 0; i < kids.length; i++)
                kids[i].classList.remove("on");
              b.classList.add("on");
              SETTINGS.mode = b.dataset.mode;
              saveSettings();
            });
            this.buildSettings();
            this.applySettings();
            this.cacheEls();
          },
          cacheEls: function () {
            var ids = [
              "hpFill",
              "hpText",
              "shieldFill",
              "shieldText",
              "aliveCount",
              "elimCount",
              "matWOOD",
              "matSTONE",
              "matMETAL",
              "cnsband",
              "cnsmini",
              "cnsmed",
              "cnspot",
              "ammoCur",
              "ammoMax",
              "weaponName",
              "weaponRarity",
              "stormTimer",
              "stormLabel",
              "mmCoord",
              "mmStorm",
              "fps",
              "prompt",
              "banner",
              "hitmarker",
              "crosshair",
              "buildInfo",
              "vehHud",
              "vehSpeed",
              "vehBoost",
              "specBar",
              "specName",
              "compassTape",
              "reviveBar",
              "lowhp",
              "squadList",
              "endTitle",
              "endStats",
            ];
            for (var i = 0; i < ids.length; i++)
              UI._el[ids[i]] = document.getElementById(ids[i]);
          },
          el: function (id) {
            return UI._el[id] || (UI._el[id] = document.getElementById(id));
          },

          /* ---------------- overlays ---------------- */
          anyOverlay: function () {
            return (
              !document
                .getElementById("mapScreen")
                .classList.contains("hidden") ||
              !document
                .getElementById("settingsScreen")
                .classList.contains("hidden") ||
              !document.getElementById("invScreen").classList.contains("hidden")
            );
          },
          closeOverlays: function () {
            document.getElementById("mapScreen").classList.add("hidden");
            document.getElementById("settingsScreen").classList.add("hidden");
            document.getElementById("invScreen").classList.add("hidden");
            Input.uiBlock = false;
            if (Input.locked === false && !IS_MOBILE) {
            }
          },
          toggleMap: function () {
            var m = document.getElementById("mapScreen");
            var showing = m.classList.contains("hidden");
            this.closeOverlays();
            if (showing) {
              m.classList.remove("hidden");
              Input.uiBlock = true;
              this.drawFullMap();
            }
          },
          toggleFullscreen: function () {
            var el = document.documentElement;
            if (
              !document.fullscreenElement &&
              !document.webkitFullscreenElement
            ) {
              var req =
                el.requestFullscreen ||
                el.webkitRequestFullscreen ||
                el.msRequestFullscreen;
              if (req) req.call(el);
            } else {
              var exit =
                document.exitFullscreen ||
                document.webkitExitFullscreen ||
                document.msExitFullscreen;
              if (exit) exit.call(document);
            }
          },
          toggleSettings: function () {
            var s = document.getElementById("settingsScreen");
            var showing = s.classList.contains("hidden");
            this.closeOverlays();
            if (showing) {
              s.classList.remove("hidden");
              Input.uiBlock = true;
            }
          },
          toggleInventory: function () {
            var s = document.getElementById("invScreen");
            var showing = s.classList.contains("hidden");
            this.closeOverlays();
            if (showing) {
              s.classList.remove("hidden");
              Input.uiBlock = true;
              this.drawInventory();
            }
          },

          /* ---------------- settings ---------------- */
          buildSettings: function () {
            var rows = document.getElementById("setRows");
            var self = this;
            function seg(label, key, opts, onPick) {
              var wrap = document.createElement("div");
              wrap.className = "seg";
              var html =
                '<label style="grid-column:1">' +
                label +
                '</label><div class="seg">';
              for (var i = 0; i < opts.length; i++)
                html +=
                  '<button data-v="' +
                  opts[i][0] +
                  '">' +
                  opts[i][1] +
                  "</button>";
              html += '</div><span class="val"></span>';
              wrap.innerHTML = html;
              rows.appendChild(wrap);
              var btns = wrap.querySelectorAll("button");
              function sync() {
                for (var i = 0; i < btns.length; i++)
                  btns[i].classList.toggle(
                    "on",
                    String(SETTINGS[key]) === btns[i].dataset.v,
                  );
              }
              for (var i2 = 0; i2 < btns.length; i2++) {
                btns[i2].addEventListener("click", function () {
                  var v = this.dataset.v;
                  SETTINGS[key] =
                    v === "1" || v === "0"
                      ? parseInt(v, 10)
                      : isNaN(parseFloat(v))
                        ? v
                        : parseFloat(v);
                  if (key === "mode") SETTINGS.mode = v;
                  saveSettings();
                  self.applySettings();
                  sync();
                  if (onPick) onPick(v);
                });
              }
              sync();
              return wrap;
            }
            function range(label, key, min, max, step, fmt) {
              var wrap = document.createElement("div");
              wrap.style.display = "contents";
              wrap.innerHTML =
                "<label>" +
                label +
                '</label><input type="range" min="' +
                min +
                '" max="' +
                max +
                '" step="' +
                step +
                '" value="' +
                SETTINGS[key] +
                '"><span class="val">' +
                fmt(SETTINGS[key]) +
                "</span>";
              rows.appendChild(wrap);
              var inp = wrap.querySelector("input"),
                val = wrap.querySelector(".val");
              inp.addEventListener("input", function () {
                SETTINGS[key] = parseFloat(inp.value);
                val.textContent = fmt(SETTINGS[key]);
                saveSettings();
                self.applySettings();
              });
            }
            range("MOUSE SENSITIVITY", "sens", 0.2, 3, 0.05, function (v) {
              return v.toFixed(2) + "x";
            });
            range("FIELD OF VIEW", "fov", 60, 112, 1, function (v) {
              return Math.round(v) + "\u00B0";
            });
            range("MASTER VOLUME", "volume", 0, 1, 0.02, function (v) {
              return Math.round(v * 100) + "%";
            });
            seg(
              "DIFFICULTY",
              "diff",
              [
                [0, "EASY"],
                [1, "NORMAL"],
                [2, "HARD"],
              ],
              function (v) {
                DIFF = parseInt(v, 10) || 0;
              },
            );
            seg("GRAPHICS", "quality", [
              [0, "AUTO"],
              [1, "LOW"],
              [2, "MEDIUM"],
              [3, "HIGH"],
            ]);
            seg("SHADOWS", "shadows", [
              [0, "OFF"],
              [1, "ON"],
            ]);
            seg("BLOOM", "bloom", [
              [0, "OFF"],
              [1, "ON"],
            ]);
            seg("POST FX", "postFx", [
              [0, "OFF"],
              [1, "ON"],
            ]);
            seg("AUTO FIRE", "autofire", [
              [0, "OFF"],
              [1, "ON"],
            ]);
            seg("AIM ASSIST", "aimAssist", [
              [0, "OFF"],
              [1, "ON"],
            ]);
            seg("SHOW FPS", "fps", [
              [0, "OFF"],
              [1, "ON"],
            ]);
            seg("CROSSHAIR", "crosshair", [
              [0, "WHITE"],
              [1, "GREEN"],
              [2, "GOLD"],
              [3, "PINK"],
              [4, "CYAN"],
            ]);
            seg(
              "DEFAULT MODE",
              "mode",
              [
                ["solo", "SOLO"],
                ["duo", "DUOS"],
                ["squad", "SQUADS"],
              ],
              function (v) {
                var mr = document.getElementById("modeRow");
                var kids = mr.querySelectorAll("button.mode");
                for (var i = 0; i < kids.length; i++)
                  kids[i].classList.toggle("on", kids[i].dataset.mode === v);
              },
            );
          },
          applySettings: function () {
            DIFF =
              parseInt(SETTINGS.diff === undefined ? 1 : SETTINGS.diff, 10) ||
              0;
            if (camera) {
              camera.fov = SETTINGS.fov;
              camera.updateProjectionMatrix();
            }
            if (Sfx) Sfx.setVolume(SETTINGS.volume);
            if (renderer) {
              var q = SETTINGS.quality;
              if (q === 1) {
                renderer.setPixelRatio(1);
                renderer.shadowMap.enabled = false;
              } else if (q === 2) {
                renderer.setPixelRatio(
                  Math.min(window.devicePixelRatio || 1, 1.35),
                );
                renderer.shadowMap.enabled = SETTINGS.shadows === 1;
              } else if (q === 3) {
                renderer.setPixelRatio(
                  Math.min(window.devicePixelRatio || 1, 2),
                );
                renderer.shadowMap.enabled = SETTINGS.shadows === 1;
              } else {
                renderer.shadowMap.enabled = SETTINGS.shadows === 1;
              }
              if (POST) POST.applyLevel(q === 0 ? (IS_MOBILE ? 2 : 3) : q);
            }
            var ch = this.el("crosshair");
            if (ch) {
              var c = XHAIR_COLORS[SETTINGS.crosshair | 0] || "#ffffff";
              var kids = ch.querySelectorAll(".ch");
              for (var i = 0; i < kids.length; i++) {
                kids[i].style.background = c;
                kids[i].style.boxShadow = "0 0 4px rgba(0,0,0,.9)";
              }
              var dot = ch.querySelector(".dot");
              if (dot) dot.style.background = c;
            }
            var f = this.el("fps");
            if (f) f.style.display = SETTINGS.fps ? "block" : "none";
            var mr = document.getElementById("modeRow");
            if (mr) {
              var ks = mr.querySelectorAll("button.mode");
              for (var k = 0; k < ks.length; k++)
                ks[k].classList.toggle(
                  "on",
                  ks[k].dataset.mode === SETTINGS.mode,
                );
            }
          },

          /* ---------------- HUD ---------------- */
          show: function () {
            document.getElementById("hud").classList.remove("hidden");
          },
          hide: function () {
            document.getElementById("hud").classList.add("hidden");
          },
          hitmark: function (hit, head, ch, kill) {
            if (!hit) return;
            var h = this.el("hitmarker");
            h.classList.toggle("kill", !!kill);
            h.classList.remove("on");
            void h.offsetWidth;
            h.classList.add("on");
            Sfx.hitmark(head, !!kill);
          },
          kick: function (cls) {
            var k =
              cls === "sniper"
                ? 0.04
                : cls === "launcher"
                  ? 0.05
                  : cls === "shotgun"
                    ? 0.035
                    : cls === "heavy"
                      ? 0.03
                      : cls === "smg"
                        ? 0.006
                        : cls === "melee"
                          ? 0.004
                          : 0.011;
            CAM.kick = (CAM.kick || 0) + k;
            CAM.kickP = (CAM.kickP || 0) + k * 0.2;
          },
          damageNumber: function (x, y, z, amount, head, shield) {
            if (!camera || !MATCH_RUNNING) return;
            var p = worldToScreen(x, y, z);
            if (!p.vis || p.x < -120 || p.x > window.innerWidth + 120) return;
            var d = document.createElement("div");
            d.className =
              "dmgn" + (head ? " hs" : "") + (shield ? " shield" : "");
            d.textContent = amount;
            d.style.left = p.x + "px";
            d.style.top = p.y + "px";
            document.getElementById("dmgLayer").appendChild(d);
            setTimeout(function () {
              if (d.parentNode) d.parentNode.removeChild(d);
            }, 860);
          },
          floatGain: function (amount, mat) {
            var layer = document.getElementById("dmgLayer");
            var d = document.createElement("div");
            d.className = "dmgn";
            d.style.color =
              mat === "stone"
                ? "#d8d8e2"
                : mat === "metal"
                  ? "#7fe0ff"
                  : "#e0a86a";
            d.style.fontSize = "15px";
            d.textContent =
              (amount > 0 ? "+" : "") + amount + " " + mat.toUpperCase();
            d.style.left = "50%";
            d.style.top = "60%";
            layer.appendChild(d);
            setTimeout(function () {
              if (d.parentNode) d.parentNode.removeChild(d);
            }, 860);
          },
          hitFlash: function (v) {
            var e = document.getElementById("hitFlash");
            e.style.opacity = v;
            clearTimeout(this._hf);
            this._hf = setTimeout(function () {
              e.style.opacity = 0;
            }, 110);
          },
          damageDir: function (ax, az) {
            if (!PC) return;
            var host = document.getElementById("dmgDir");
            if (!host) return;
            /* Relative bearing, in the same convention as the camera: forward is
       (sin yaw, cos yaw), so an attacker dead ahead gives 0 and one to the
       right gives +90deg. */
            var rel = PC.yaw - Math.atan2(ax - PC.x, az - PC.z);
            /* One ring per attacker. This used to be a single element whose fade was
       restarted by clearTimeout, so being shot from two sides at once showed
       only the second hit -- exactly when the player most needs both. Capped
       so a full squad can't grow the DOM without bound. */
            while (host.childNodes.length >= 6)
              host.removeChild(host.firstChild);
            var ring = document.createElement("div");
            ring.className = "dmgRing";
            ring.style.setProperty(
              "--a",
              ((rel * 180) / Math.PI).toFixed(1) + "deg",
            );
            ring.innerHTML = "<i></i><b></b>";
            host.appendChild(ring);
            ring.addEventListener("animationend", function () {
              if (ring.parentNode) ring.parentNode.removeChild(ring);
            });
          },
          banner: function (main, sub, secs) {
            var b = this.el("banner");
            b.innerHTML = main + (sub ? "<small>" + sub + "</small>" : "");
            b.classList.add("on");
            clearTimeout(this._bn);
            this._bn = setTimeout(
              function () {
                b.classList.remove("on");
              },
              (secs || 2.4) * 1000,
            );
          },
          stormHurt: function () {
            var e = document.getElementById("dmgVig");
            e.style.opacity = 0.75;
            clearTimeout(this._sv);
            this._sv = setTimeout(function () {
              e.style.opacity = 0;
            }, 180);
          },
          lightning: function () {
            var e = document.getElementById("hitFlash");
            e.style.background = "rgba(220,225,255,0.55)";
            e.style.transition = "none";
            e.style.opacity = 0.5;
            setTimeout(function () {
              e.style.opacity = 0;
              e.style.transition = "opacity .25s";
            }, 70);
            setTimeout(function () {
              e.style.background =
                "radial-gradient(ellipse at center,rgba(255,0,0,0) 38%,rgba(190,0,0,.62) 100%)";
            }, 260);
          },
          setStormOverlay: function (v) {
            document.getElementById("stormOverlay").style.opacity = v;
          },
          setGlider: function (show) {
            document
              .getElementById("skydiveHud")
              .classList.toggle("hidden", !show);
          },
          setAlt: function (v) {
            this.el("altVal").textContent = Math.round(v);
          },
          setScope: function (on) {
            document.getElementById("scope").classList.toggle("on", !!on);
          },
          showRevive: function (on) {
            document.getElementById("reviveBar").style.opacity = on ? 1 : 0;
            if (!on) this.setReviveBar(0);
          },
          setReviveBar: function (v) {
            document.getElementById("reviveBar").firstElementChild.style.width =
              v * 100 + "%";
          },
          showVeh: function (on) {
            this.el("vehHud").style.opacity = on ? 1 : 0;
          },
          showBusHint: function () {
            document.getElementById("busHint").classList.remove("hidden");
          },
          hideBusHint: function () {
            document.getElementById("busHint").classList.add("hidden");
          },
          showSpec: function (on) {
            var e = this.el("specBar");
            if (!e) return;
            e.classList.toggle("hidden", !on);
          },
          showPrompt: function (text, secs) {
            var p = this.el("prompt");
            p.innerHTML = text;
            p.classList.add("on");
            clearTimeout(this._pt);
            if (secs)
              this._pt = setTimeout(function () {
                p.classList.remove("on");
              }, secs * 1000);
          },
          hidePrompt: function () {
            this.el("prompt").classList.remove("on");
          },
          killFeed: function (
            killer,
            victim,
            byPlayer,
            victimIsPlayer,
            isTeam,
            verb,
          ) {
            var f = document.getElementById("killfeed");
            var d = document.createElement("div");
            d.className = "kf" + (byPlayer ? " me" : "");
            var icon = "";
            var w = PC && PC.slots[PC.slot] ? PC.slots[PC.slot] : null;
            if (byPlayer && w)
              icon =
                '<span class="wp">' +
                (WEAPONS[w.id].icon || "\u2694") +
                "</span>";
            d.innerHTML =
              icon +
              "<span>" +
              killer +
              "</span><i>" +
              (verb === "knocked"
                ? "KNOCKED"
                : verb === "revived"
                  ? "REVIVED"
                  : verb === "rebooted"
                    ? "REBOOTED"
                    : "ELIMINATED") +
              '</i><span style="color:' +
              (victimIsPlayer ? "#ff6b6b" : isTeam ? "#6bffa8" : "#fff") +
              '">' +
              victim +
              "</span>";
            f.insertBefore(d, f.firstChild);
            while (f.children.length > 5) f.removeChild(f.lastChild);
            setTimeout(function () {
              if (d.parentNode) d.parentNode.removeChild(d);
            }, 7000);
          },
          setSquad: function () {
            var box = this.el("squadList");
            if (!box) return;
            if (MODE === "solo") {
              box.innerHTML = "";
              return;
            }
            var html = "";
            var t = teammates(viewChar());
            for (var i = 0; i < t.length; i++) {
              var o = t[i];
              var cls = !o.alive ? "dead" : o.knocked ? "down" : "";
              var pct = o.knocked ? 100 : clamp(o.health, 0, 100);
              html +=
                '<div class="sqm ' +
                cls +
                '"><span>' +
                o.name +
                "</span>" +
                '<span class="bar2"><i style="width:' +
                pct +
                '%"></i></span></div>';
            }
            if (box._html !== html) {
              box.innerHTML = html;
              box._html = html;
            }
          },
          drawInventory: function () {
            var b = document.getElementById("invBody");
            if (!PC) return;
            var html = "";
            html += '<div class="invCard"><h4>WEAPONS</h4>';
            for (var i = 0; i < 6; i++) {
              var s = PC.slots[i];
              html +=
                '<div class="line"><span>' +
                (i === 0 ? "PICKAXE" : "SLOT " + i) +
                "</span><b>" +
                (s
                  ? WEAPONS[s.id].name +
                    (s.rarity ? " (" + RARITY[s.rarity].name + ")" : "")
                  : "-") +
                "</b></div>";
            }
            html += "</div>";
            html += '<div class="invCard"><h4>AMMO</h4>';
            var am = [
              ["light", "LIGHT"],
              ["medium", "MEDIUM"],
              ["heavy", "HEAVY"],
              ["shell", "SHELLS"],
              ["rocket", "ROCKETS"],
            ];
            for (var a = 0; a < am.length; a++)
              html +=
                '<div class="line"><span>' +
                am[a][1] +
                "</span><b>" +
                PC.ammo[am[a][0]] +
                "</b></div>";
            html += "</div>";
            html += '<div class="invCard"><h4>MATERIALS</h4>';
            html +=
              '<div class="line"><span>WOOD</span><b>' +
              Math.round(PC.mats.wood) +
              "</b></div>";
            html +=
              '<div class="line"><span>STONE</span><b>' +
              Math.round(PC.mats.stone) +
              "</b></div>";
            html +=
              '<div class="line"><span>METAL</span><b>' +
              Math.round(PC.mats.metal) +
              "</b></div>";
            html += "</div>";
            html += '<div class="invCard"><h4>CONSUMABLES</h4>';
            html +=
              '<div class="line"><span>BANDAGES</span><b>' +
              PC.heals.band +
              "</b></div>";
            html +=
              '<div class="line"><span>MINI SHIELDS</span><b>' +
              PC.heals.mini +
              "</b></div>";
            html +=
              '<div class="line"><span>MEDKITS</span><b>' +
              PC.heals.med +
              "</b></div>";
            html +=
              '<div class="line"><span>SHIELD POTIONS</span><b>' +
              PC.heals.pot +
              "</b></div>";
            if (MODE !== "solo") {
              html +=
                '<div class="line"><span>REBOOT CARDS</span><b style="color:' +
                (PC.cards > 0 ? "#6bffd0" : "#7c8aa8") +
                '">' +
                (PC.cards || 0) +
                "</b></div>";
            }
            html += "</div>";
            html += '<div class="invCard"><h4>MATCH</h4>';
            html +=
              '<div class="line"><span>ELIMINATIONS</span><b>' +
              PC.eliminations +
              "</b></div>";
            html +=
              '<div class="line"><span>DAMAGE</span><b>' +
              Math.round(PC.damageDealt || 0) +
              "</b></div>";
            html +=
              '<div class="line"><span>ALIVE</span><b>' + ALIVE + "</b></div>";
            html += "</div>";
            b.innerHTML = html;
          },
          update: function () {
            if (!PC) return;
            var E = this.el;
            /* while spectating, the vitals/weapon readouts describe the watched player */
            var P =
              !PC.alive &&
              SPECTATING &&
              SPECTATE_TARGET &&
              SPECTATE_TARGET.alive
                ? SPECTATE_TARGET
                : PC;
            E("hpFill").style.width = Math.max(0, P.health) + "%";
            E("hpText").textContent = Math.max(0, Math.round(P.health));
            E("shieldFill").style.width = Math.max(0, P.shield) + "%";
            E("shieldText").textContent = Math.max(0, Math.round(P.shield));
            E("aliveCount").textContent = ALIVE;
            E("elimCount").textContent = P.eliminations;
            E("matWOOD").textContent = Math.round(P.mats.wood);
            E("matSTONE").textContent = Math.round(P.mats.stone);
            E("matMETAL").textContent = Math.round(P.mats.metal);
            E("cnsband").textContent = P.heals.band;
            E("cnsmini").textContent = P.heals.mini;
            E("cnsmed").textContent = P.heals.med;
            E("cnspot").textContent = P.heals.pot;
            var w = P.slots[P.slot];
            var def = w ? WEAPONS[w.id] : null;
            E("weaponName").textContent = def ? def.name : "-";
            E("weaponRarity").textContent =
              def && def.mag > 0 && w.rarity !== undefined
                ? RARITY[w.rarity].name
                : "";
            E("weaponRarity").style.color = w
              ? hexStr(RARITY[w.rarity].c)
              : "#fff";
            if (def && def.mag > 0) {
              E("ammoCur").textContent = w.ammoInMag;
              E("ammoMax").textContent = def.ammo
                ? " / " + P.ammo[def.ammo]
                : "";
            } else {
              E("ammoCur").textContent = "";
              E("ammoMax").textContent = def
                ? def.cls === "melee"
                  ? "MELEE"
                  : ""
                : "";
            }
            var rb = document.getElementById("reloadBar");
            if (P.reloading) {
              rb.style.opacity = 1;
              rb.firstElementChild.style.width =
                (P.reloading.t / P.reloading.total) * 100 + "%";
            } else if (P.using) {
              rb.style.opacity = 1;
              rb.firstElementChild.style.width =
                (P.using.t / P.using.total) * 100 + "%";
            } else rb.style.opacity = 0;
            for (var i = 0; i < 6; i++) {
              var el = this.slotEls[i],
                s = P.slots[i];
              el.classList.toggle("active", i === P.slot);
              el.classList.toggle("empty", !s);
              if (s) {
                var d2 = WEAPONS[s.id];
                el.querySelector(".n").textContent = d2.name;
                el.querySelector(".r").style.background = hexStr(
                  RARITY[s.rarity].c,
                );
                el.querySelector(".a").textContent =
                  d2.mag > 0 ? s.ammoInMag : "";
                el.querySelector(".ic").textContent = d2.icon || "";
              } else {
                el.querySelector(".n").textContent = "-";
                el.querySelector(".r").style.background = "transparent";
                el.querySelector(".a").textContent = "";
                el.querySelector(".ic").textContent = "";
              }
            }
            E("stormTimer").textContent = fmtTime(Math.max(0, STORM.timer));
            E("stormLabel").textContent = STORM.active
              ? STORM.state === "shrink"
                ? "STORM CLOSING"
                : "STORM SURGE " + (STORM.phase + 1)
              : "STORM IDLE";
            document
              .getElementById("stormPill")
              .classList.toggle(
                "warn",
                STORM.active && STORM.state === "shrink",
              );
            E("mmCoord").textContent =
              Math.round(P.x) + " , " + Math.round(P.z);
            var sd = dist2(P.x, P.z, STORM.cx, STORM.cz);
            E("mmStorm").textContent = STORM.active
              ? sd > STORM.r
                ? "OUTSIDE " + Math.round(sd - STORM.r) + "m"
                : "SAFE " + Math.round(STORM.r - sd) + "m"
              : "--";
            E("mmStorm").style.color =
              STORM.active && sd > STORM.r ? "#ff6b6b" : "#9dc4ff";
            E("lowhp").style.opacity =
              P.alive && P.health < 35 && !P.knocked ? 1 : 0;
            E("buildInfo").classList.toggle("hidden", !BUILD_MODE);
            document
              .getElementById("buildBar")
              .classList.toggle("hidden", !BUILD_MODE);
            if (BUILD_MODE) {
              var bi = this.el("buildInfo");
              var txt =
                "BUILD MODE &middot; <b>" +
                BUILD_MAT.toUpperCase() +
                "</b> &middot; <b>Q</b> EXIT &middot; <b>V</b> MATERIAL &middot; <b>G</b> EDIT &middot; <b>R</b> REPAIR";
              if (EDIT_TARGET)
                txt =
                  "EDITING &middot; <b>G</b> CYCLE WINDOW / DOOR / HALF &middot; <b>R</b> REPAIR";
              if (bi._t !== txt) {
                bi.innerHTML = txt;
                bi._t = txt;
              }
            }
            if (P.vehicle && P === PC) {
              this.el("vehSpeed").textContent = Math.round(
                Math.abs(PC.vehicle.speed) * 3.6,
              );
              document.getElementById(
                "vehBoost",
              ).firstElementChild.style.width = (PC.vehBoost ? 0 : 100) + "%";
            }
            if (!PC.alive && SPECTATING) this.showSpec(true);
            else this.showSpec(false);
            if (SPECTATE_TARGET && this.el("specName"))
              this.el("specName").textContent =
                SPECTATE_TARGET.name.toUpperCase();
            this.setSquad();
            this.drawCompass();
            this.drawMinimap();
            Sfx.tickBeat(
              1 / 60,
              P.alive && P.health < 35 && !P.knocked ? 1 - P.health / 35 : 0,
            );
          },
          drawCompass: function () {
            var tape = this.el("compassTape");
            if (!tape) return;
            var now = performance.now();
            if (now - (this._lastCompass || 0) < 90) return;
            this._lastCompass = now;
            var yaw = viewChar().yaw;
            var deg = ((((yaw * 180) / Math.PI) % 360) + 360) % 360;
            var W = window.innerWidth
              ? Math.min(420, window.innerWidth * 0.52)
              : 420;
            var pxPerDeg = W / 120;
            var html = "";
            var marks = [
              [0, "N", 1],
              [22.5, "", 0],
              [45, "NE", 0],
              [67.5, "", 0],
              [90, "E", 1],
              [112.5, "", 0],
              [135, "SE", 0],
              [157.5, "", 0],
              [180, "S", 1],
              [202.5, "", 0],
              [225, "SW", 0],
              [247.5, "", 0],
              [270, "W", 1],
              [292.5, "", 0],
              [315, "NW", 0],
              [337.5, "", 0],
            ];
            for (var i = 0; i < marks.length; i++) {
              var d = marks[i][0];
              var diff = ((d - deg + 540) % 360) - 180;
              if (Math.abs(diff) > 62) continue;
              var x = W / 2 + diff * pxPerDeg;
              if (!marks[i][1]) {
                html +=
                  '<span class="tick" style="left:' +
                  x.toFixed(1) +
                  'px"></span>';
              } else {
                html +=
                  '<span class="' +
                  (marks[i][2] ? "card" : "ord") +
                  '" style="left:' +
                  x.toFixed(1) +
                  'px">' +
                  marks[i][1] +
                  "</span>";
              }
            }
            if (tape._h !== html) {
              tape.innerHTML = html;
              tape._h = html;
            }
          },
          drawMinimap: function () {
            var now = performance.now();
            if (now - this.lastMap < 66) return;
            this.lastMap = now;
            var cv = document.getElementById("minimap");
            var g = cv.getContext("2d");
            var W = cv.width,
              half = W / 2,
              sc = W / CFG.MAP;
            g.clearRect(0, 0, W, W);
            g.save();
            g.beginPath();
            g.arc(half, half, half - 4, 0, 6.3);
            g.clip();
            g.fillStyle = "#0d2a4a";
            g.fillRect(0, 0, W, W);
            if (MAPCANVAS) g.drawImage(MAPCANVAS, 0, 0, W, W);
            var ox = CFG.MAP / 2;
            g.strokeStyle = "rgba(170,80,255,.95)";
            g.lineWidth = 7;
            g.beginPath();
            g.arc(
              (STORM.cx + ox) * sc,
              (STORM.cz + ox) * sc,
              STORM.r * sc,
              0,
              6.3,
            );
            g.stroke();
            if (STORM.active) {
              g.strokeStyle = "rgba(255,255,255,.9)";
              g.lineWidth = 5;
              g.setLineDash([12, 9]);
              g.beginPath();
              g.arc(
                (STORM.nx + ox) * sc,
                (STORM.nz + ox) * sc,
                STORM.nr * sc,
                0,
                6.3,
              );
              g.stroke();
              g.setLineDash([]);
            }
            if (BUS.active) {
              g.strokeStyle = "rgba(255,215,106,.85)";
              g.lineWidth = 4;
              g.setLineDash([14, 12]);
              g.beginPath();
              g.moveTo(
                (BUS.cx + BUS.dx * -300 + ox) * sc,
                (BUS.cz + BUS.dz * -300 + ox) * sc,
              );
              g.lineTo(
                (BUS.cx + BUS.dx * 300 + ox) * sc,
                (BUS.cz + BUS.dz * 300 + ox) * sc,
              );
              g.stroke();
              g.setLineDash([]);
              g.fillStyle = "#ffd76a";
              g.beginPath();
              g.arc((BUS.x + ox) * sc, (BUS.z + ox) * sc, 8, 0, 6.3);
              g.fill();
            }
            /* vehicles */
            g.fillStyle = "rgba(255,143,63,.85)";
            for (var vi = 0; vi < VEHICLES.length; vi++) {
              var v = VEHICLES[vi];
              if (dist2(v.x, v.z, viewChar().x, viewChar().z) > 140) continue;
              g.fillRect((v.x + ox) * sc - 3, (v.z + ox) * sc - 3, 6, 6);
            }
            /* supply drops + reboot vans */
            if (DROPS) {
              for (var di = 0; di < DROPS.length; di++) {
                var dp = DROPS[di];
                if (dp.opened) continue;
                g.fillStyle = dp.state === "landed" ? "#8fd0ff" : "#ffd76a";
                g.beginPath();
                g.arc((dp.x + ox) * sc, (dp.z + ox) * sc, 6, 0, 6.3);
                g.fill();
                g.strokeStyle = "#0a1a3c";
                g.lineWidth = 2;
                g.stroke();
              }
            }
            if (VANS) {
              g.fillStyle = "rgba(107,255,208,.9)";
              for (var vj = 0; vj < VANS.length; vj++) {
                g.fillRect(
                  (VANS[vj].x + ox) * sc - 3,
                  (VANS[vj].z + ox) * sc - 3,
                  6,
                  6,
                );
              }
            }
            /* squad */
            if (MODE !== "solo") {
              var t = teammates(viewChar());
              for (var si = 0; si < t.length; si++) {
                var o = t[si];
                if (!o.alive) continue;
                g.fillStyle = o.knocked ? "#ff4d4d" : "#6bffa8";
                g.beginPath();
                g.arc((o.x + ox) * sc, (o.z + ox) * sc, 5, 0, 6.3);
                g.fill();
              }
            }
            /* spectate target or enemies on radar */
            for (var ci = 0; ci < CHARS.length; ci++) {
              var c = CHARS[ci];
              if (!c.alive || c.isPlayer) continue;
              if (
                c.team !== undefined &&
                PC.team !== undefined &&
                c.team === PC.team
              )
                continue; // skip squadmates
              var dEnemy = dist2(c.x, c.z, PC.x, PC.z);
              if (dEnemy <= 180) {
                g.fillStyle = "rgba(255, 48, 48, 0.95)";
                g.beginPath();
                g.arc((c.x + ox) * sc, (c.z + ox) * sc, 4.5, 0, 6.3);
                g.fill();
                g.strokeStyle = "rgba(255, 48, 48, 0.4)";
                g.lineWidth = 1.5;
                g.beginPath();
                g.moveTo((c.x + ox) * sc, (c.z + ox) * sc);
                g.lineTo(
                  (c.x + ox + Math.sin(c.yaw) * 8) * sc,
                  (c.z + ox + Math.cos(c.yaw) * 8) * sc,
                );
                g.stroke();
              }
            }
            if (SPECTATING && SPECTATE_TARGET) {
              g.fillStyle = "rgba(255,80,80,.95)";
              g.beginPath();
              g.arc(
                (SPECTATE_TARGET.x + ox) * sc,
                (SPECTATE_TARGET.z + ox) * sc,
                6,
                0,
                6.3,
              );
              g.fill();
            }
            /* chests on minimap */
            for (var chi = 0; chi < CHESTS.length; chi++) {
              var ch = CHESTS[chi];
              if (ch.opened) continue;
              var dChest = dist2(ch.x, ch.z, PC.x, PC.z);
              if (dChest <= 120) {
                g.fillStyle = "#ffd700";
                g.beginPath();
                g.arc((ch.x + ox) * sc, (ch.z + ox) * sc, 3.5, 0, 6.3);
                g.fill();
                g.strokeStyle = "#0a1a3c";
                g.lineWidth = 0.5;
                g.stroke();
              }
            }
            var px = (PC.x + ox) * sc,
              py = (PC.z + ox) * sc;
            if (SPECTATING && SPECTATE_TARGET && SPECTATE_TARGET.alive) {
              px = (SPECTATE_TARGET.x + ox) * sc;
              py = (SPECTATE_TARGET.z + ox) * sc;
            }
            g.save();
            g.translate(px, py);
            g.rotate(-viewChar().yaw + Math.PI);
            g.fillStyle = "#fff";
            g.strokeStyle = "#0a1a3c";
            g.lineWidth = 2.5;
            g.beginPath();
            g.moveTo(0, -13);
            g.lineTo(8, 10);
            g.lineTo(0, 5);
            g.lineTo(-8, 10);
            g.closePath();
            g.fill();
            g.stroke();
            g.restore();
            g.restore();
            g.strokeStyle = "rgba(150,190,255,.5)";
            g.lineWidth = 4;
            g.beginPath();
            g.arc(half, half, half - 4, 0, 6.3);
            g.stroke();
          },
          drawFullMap: function () {
            var cv = document.getElementById("mapCanvas");
            var g = cv.getContext("2d");
            var S = cv.width,
              half = S / 2,
              sc = S / CFG.MAP,
              ox = CFG.MAP / 2;
            g.clearRect(0, 0, S, S);
            if (MAPCANVAS) g.drawImage(MAPCANVAS, 0, 0, S, S);
            /* storm */
            g.strokeStyle = "rgba(170,80,255,.95)";
            g.lineWidth = 9;
            g.beginPath();
            g.arc(
              (STORM.cx + ox) * sc,
              (STORM.cz + ox) * sc,
              STORM.r * sc,
              0,
              6.3,
            );
            g.stroke();
            if (STORM.active) {
              g.strokeStyle = "rgba(255,255,255,.9)";
              g.lineWidth = 6;
              g.setLineDash([18, 14]);
              g.beginPath();
              g.arc(
                (STORM.nx + ox) * sc,
                (STORM.nz + ox) * sc,
                STORM.nr * sc,
                0,
                6.3,
              );
              g.stroke();
              g.setLineDash([]);
            }
            if (BUS.active) {
              g.strokeStyle = "rgba(255,215,106,.9)";
              g.lineWidth = 6;
              g.setLineDash([20, 16]);
              g.beginPath();
              g.moveTo(
                (BUS.cx + BUS.dx * -300 + ox) * sc,
                (BUS.cz + BUS.dz * -300 + ox) * sc,
              );
              g.lineTo(
                (BUS.cx + BUS.dx * 300 + ox) * sc,
                (BUS.cz + BUS.dz * 300 + ox) * sc,
              );
              g.stroke();
              g.setLineDash([]);
              g.fillStyle = "#ffd76a";
              g.beginPath();
              g.arc((BUS.x + ox) * sc, (BUS.z + ox) * sc, 11, 0, 6.3);
              g.fill();
            }
            g.fillStyle = "rgba(255,143,63,.9)";
            for (var vi = 0; vi < VEHICLES.length; vi++) {
              var v = VEHICLES[vi];
              g.fillRect((v.x + ox) * sc - 5, (v.z + ox) * sc - 5, 10, 10);
            }
            /* supply drops + reboot vans */
            if (DROPS) {
              for (var di = 0; di < DROPS.length; di++) {
                var dp = DROPS[di];
                if (dp.opened) continue;
                g.fillStyle = dp.state === "landed" ? "#8fd0ff" : "#ffd76a";
                g.beginPath();
                g.arc((dp.x + ox) * sc, (dp.z + ox) * sc, 10, 0, 6.3);
                g.fill();
                g.strokeStyle = "#0a1a3c";
                g.lineWidth = 3;
                g.stroke();
              }
            }
            if (VANS) {
              g.fillStyle = "rgba(107,255,208,.9)";
              for (var vj = 0; vj < VANS.length; vj++) {
                g.fillRect(
                  (VANS[vj].x + ox) * sc - 6,
                  (VANS[vj].z + ox) * sc - 6,
                  12,
                  12,
                );
              }
            }
            if (MODE !== "solo") {
              var t = teammates(viewChar());
              for (var si = 0; si < t.length; si++) {
                var o = t[si];
                if (!o.alive) continue;
                g.fillStyle = o.knocked ? "#ff4d4d" : "#6bffa8";
                g.beginPath();
                g.arc((o.x + ox) * sc, (o.z + ox) * sc, 8, 0, 6.3);
                g.fill();
              }
            }
            /* Draw all alive enemies on full map */
            for (var ci = 0; ci < CHARS.length; ci++) {
              var c = CHARS[ci];
              if (!c.alive || c.isPlayer) continue;
              if (
                c.team !== undefined &&
                PC.team !== undefined &&
                c.team === PC.team
              )
                continue; // skip squadmates
              g.fillStyle = "rgba(255, 48, 48, 0.9)";
              g.beginPath();
              g.arc((c.x + ox) * sc, (c.z + ox) * sc, 7, 0, 6.3);
              g.fill();
              g.strokeStyle = "#0a1a3c";
              g.lineWidth = 1.5;
              g.stroke();

              g.strokeStyle = "rgba(255, 48, 48, 0.4)";
              g.lineWidth = 2.0;
              g.beginPath();
              g.moveTo((c.x + ox) * sc, (c.z + ox) * sc);
              g.lineTo(
                (c.x + ox + Math.sin(c.yaw) * 12) * sc,
                (c.z + ox + Math.cos(c.yaw) * 12) * sc,
              );
              g.stroke();
            }
            /* Draw all unopened chests on full map */
            for (var chi = 0; chi < CHESTS.length; chi++) {
              var ch = CHESTS[chi];
              if (ch.opened) continue;
              g.fillStyle = "#ffd700";
              g.beginPath();
              g.arc((ch.x + ox) * sc, (ch.z + ox) * sc, 5.5, 0, 6.3);
              g.fill();
              g.strokeStyle = "#0a1a3c";
              g.lineWidth = 1.5;
              g.stroke();
            }
            if (SPECTATING) {
              for (var ci = 0; ci < CHARS.length; ci++) {
                var c = CHARS[ci];
                if (!c.alive || c.isPlayer) continue;
                g.fillStyle = "rgba(255,77,77,.9)";
                g.beginPath();
                g.arc((c.x + ox) * sc, (c.z + ox) * sc, 7, 0, 6.3);
                g.fill();
              }
            }
            var px = (PC.x + ox) * sc,
              py = (PC.z + ox) * sc;
            if (SPECTATING && SPECTATE_TARGET && SPECTATE_TARGET.alive) {
              px = (SPECTATE_TARGET.x + ox) * sc;
              py = (SPECTATE_TARGET.z + ox) * sc;
            }
            g.save();
            g.translate(px, py);
            g.rotate(-viewChar().yaw + Math.PI);
            g.fillStyle = "#fff";
            g.strokeStyle = "#0a1a3c";
            g.lineWidth = 3;
            g.beginPath();
            g.moveTo(0, -20);
            g.lineTo(13, 16);
            g.lineTo(0, 8);
            g.lineTo(-13, 16);
            g.closePath();
            g.fill();
            g.stroke();
            g.restore();
          },
        };
        function worldToScreen(x, y, z) {
          var v = new THREE.Vector3(x, y, z).project(camera);
          return {
            x: (v.x * 0.5 + 0.5) * window.innerWidth,
            y: (-v.y * 0.5 + 0.5) * window.innerHeight,
            vis: v.z < 1 && v.z > -1,
          };
        }

        /* ---------------- actions ---------------- */
        function toggleBuildMode() {
          if (!PC || !PC.alive || PC.knocked) return;
          BUILD_MODE = !BUILD_MODE;
          document
            .getElementById("buildBar")
            .classList.toggle("hidden", !BUILD_MODE);
          if (!BUILD_MODE) {
            hideGhost();
            EDIT_TARGET = null;
          }
        }
        function setBuildPiece(p) {
          BUILD_PIECE = p;
          var els = document.querySelectorAll(".bp");
          for (var i = 0; i < els.length; i++)
            els[i].classList.toggle("active", els[i].dataset.piece === p);
        }
        function cycleBuildMat() {
          var order = ["wood", "stone", "metal"];
          BUILD_MAT = order[(order.indexOf(BUILD_MAT) + 1) % 3];
          UI.showPrompt(
            "BUILD MATERIAL: <b>" + BUILD_MAT.toUpperCase() + "</b>",
            1.2,
          );
        }
        function selectSlot(i) {
          if (!PC || i < 0 || i > 5) return;
          PC.slot = i;
          attachWeapon(PC);
          if (PC.reloading) PC.reloading = null;
        }
        function onResize() {
          if (!renderer) return;
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(window.innerWidth, window.innerHeight);
          if (POST && POST.ok)
            POST.resize(
              Math.floor(window.innerWidth * renderer.getPixelRatio()),
              Math.floor(window.innerHeight * renderer.getPixelRatio()),
            );
        }

// === main ===
/* ==== 90_main.js ==== */
        /* ============================================================================
   90_MAIN — match lifecycle, squads, spectating, player input resolution,
   the frame loop, adaptive quality and boot.
   ========================================================================== */

        var GAMETIME = 0,
          MATCH_RUNNING = false,
          MATCH_OVER = false,
          ALIVE = 25,
          SPECTATE_TARGET = null,
          SPECTATING = false;
        var MODE = "solo",
          TEAM_SIZE = 1;
        var FIXED = 1 / 60,
          _accum = 0,
          _last = 0;
        var QUALITY = 0,
          END_SHOWN = false,
          _fpsAcc = 0,
          _fpsN = 0,
          _fpsLow = 0,
          _fpsShown = 0,
          _qLocked = false;
        var PLAYER_STATS = { shots: 0, hits: 0, dist: 0 };

        /* ---------------- match lifecycle ---------------- */
        function countTeamsAlive() {
          var seen = {},
            n = 0;
          for (var i = 0; i < CHARS.length; i++) {
            var c = CHARS[i];
            if (!c.alive) continue;
            var t = c.team === undefined ? c.id : c.team;
            if (!seen[t]) {
              seen[t] = 1;
              n++;
            }
          }
          return n;
        }
        function resetMatch() {
          MODE = SETTINGS.mode || "solo";
          TEAM_SIZE = MODE === "solo" ? 1 : MODE === "duo" ? 2 : 4;
          clearAllBuilds();
          while (LOOT.length) removeLoot(LOOT[0]);
          while (PROJECTILES.length) PROJECTILES.pop();
          for (var i = 0; i < CHESTS.length; i++) {
            var c = CHESTS[i];
            c.opened = false;
            if (c.lid) c.lid.rotation.x = 0;
            if (c.spr) c.spr.visible = true;
          }
          for (var v = 0; v < VEHICLES.length; v++) {
            var veh = VEHICLES[v];
            veh.driver = null;
            veh.speed = 0;
            veh.mesh.rotation.x = 0;
            veh.mesh.rotation.z = 0;
          }
          for (var j = 0; j < CHARS.length; j++) {
            var ch = CHARS[j];
            if (ch.mesh) worldGroup.remove(ch.mesh);
          }
          CHARS.length = 0;
          PC = null;
          SPECTATE_TARGET = null;
          SPECTATING = false;
          MATCH_OVER = false;
          createPlayer();
          /* MAXP counts the player too, so spawn one fewer bot than MAXP. */
          makeBots(CFG.MAXP - 1);
          ALIVE = CFG.MAXP;
          GAMETIME = 0;
          resetStorm();
          resetBus();
          resetDrops();
          resetReboot();
          BUILD_MODE = false;
          document.getElementById("buildBar").classList.add("hidden");
          hideGhost();
          PC.state = "bus";
          PC.onBus = true;
          PC.slots = [
            { id: "pickaxe", rarity: 0, ammoInMag: 0 },
            null,
            null,
            null,
            null,
            null,
          ];
          PC.slot = 0;
          PC.health = 100;
          PC.shield = 0;
          PC.eliminations = 0;
          PC.damageDealt = 0;
          PC.mats = { wood: 250, stone: 100, metal: 50 };
          PC.heals = { band: 5, mini: 3, med: 0, pot: 0 };
          PC.ammo = { light: 150, medium: 120, heavy: 15, shell: 24, rocket: 4 };
          PC.knocked = false;
          PC.bleed = 0;
          PC.vehicle = null;
          attachWeapon(PC);
          UI.setStormOverlay(0);
          UI.setGlider(false);
          UI.hidePrompt();
          UI.showRevive(false);
          UI.showVeh(false);
          UI.setScope(false);
          PLAYER_STATS = { shots: 0, hits: 0, dist: 0 };
          UI.closeOverlays();
        }
        function startMatch() {
          document.getElementById("startScreen").classList.add("hidden");
          document.getElementById("endScreen").classList.add("hidden");
          UI.show();
          resetMatch();
          MATCH_RUNNING = true;
          END_SHOWN = false;
          QUALITY = 0;
          _fpsLow = 0;
          _qLocked = false;
          UI.showBusHint();
          var modeName =
            MODE === "solo" ? "SOLO" : MODE === "duo" ? "DUOS" : "SQUADS";
          UI.banner(
            "BATTLE ROYALE",
            CFG.MAXP + " PLAYERS &middot; " + modeName + " &middot; ONE WINNER",
            3.0,
          );
          Sfx.startWind();
          Sfx.startBeat();
        }
        function restartMatch() {
          document.getElementById("endScreen").classList.add("hidden");
          startMatch();
        }
        function pickSpectateTarget() {
          var best = null,
            bd = 1e9;
          for (var i = 0; i < CHARS.length; i++) {
            var c = CHARS[i];
            if (!c.alive || c.isPlayer) continue;
            var d = dist2(PC.x, PC.z, c.x, c.z);
            if (d < bd) {
              bd = d;
              best = c;
            }
          }
          SPECTATE_TARGET = best;
        }
        /* The character the camera/HUD is currently describing: you, or the player you
   are spectating once you have been eliminated. */
        function viewChar() {
          if (PC && !PC.alive && SPECTATE_TARGET && SPECTATE_TARGET.alive)
            return SPECTATE_TARGET;
          return PC;
        }
        function cycleSpectate() {
          if (!SPECTATING) return;
          var alive = [];
          for (var i = 0; i < CHARS.length; i++)
            if (CHARS[i].alive && !CHARS[i].isPlayer) alive.push(CHARS[i]);
          if (!alive.length) return;
          var idx = alive.indexOf(SPECTATE_TARGET);
          SPECTATE_TARGET = alive[(idx + 1) % alive.length];
        }
        function onPlayerDeath(killer) {
          PC.placement = Math.max(1, ALIVE + 1);
          UI.banner(
            "ELIMINATED BY " +
              (killer ? killer.name.toUpperCase() : "THE STORM"),
            "#" + PC.placement + " OF " + CFG.MAXP,
            2.6,
          );
          Sfx.vehicle(false);
          Sfx.setStorm(0);
          Sfx.defeat();
          UI.setStormOverlay(0);
          UI.setScope(false);
          UI.showVeh(false);
          UI.showRevive(false);
          SPECTATE_TARGET = null;
          pickSpectateTarget();
          /* The match keeps simulating behind the end screen so the player can choose
     to spectate a live game. It is only truly over when one side remains. */
          setTimeout(function () {
            if (SPECTATING) return;
            if (PC.alive)
              return; /* a squadmate rebooted us before the screen came up */
            showEnd(false);
          }, 2100);
        }
        function checkMatchEnd() {
          if (!MATCH_RUNNING) return;
          var done = MODE === "solo" ? ALIVE <= 1 : countTeamsAlive() <= 1;
          if (!done) return;
          MATCH_RUNNING = false;
          MATCH_OVER = true; /* stops the world even if the player is still spectating */
          SPECTATING = false;
          Sfx.setStorm(0);
          Sfx.vehicle(false);
          var win =
            MODE === "solo"
              ? PC.alive && ALIVE === 1
              : PC.alive && countTeamsAlive() <= 1;
          if (win) {
            Sfx.victory();
            UI.banner("VICTORY ROYALE", "#1 VICTORY ROYALE", 3.2);
          }
          setTimeout(
            function () {
              showEnd(win);
            },
            win ? 1400 : 700,
          );
        }
        function showEnd(win) {
          var over = MODE === "solo" ? ALIVE <= 1 : countTeamsAlive() <= 1;
          if (END_SHOWN && !over && !win)
            return; /* already showed "you died"; match still live */
          END_SHOWN = true;
          if (over) MATCH_RUNNING = false;
          var es = document.getElementById("endScreen");
          es.classList.remove("hidden");
          es.classList.toggle("lost", !win);
          document.getElementById("endTitle").textContent = win
            ? "VICTORY ROYALE"
            : "ELIMINATED  #" + (PC.placement || ALIVE + 1);
          var mins = Math.floor(GAMETIME / 60),
            secs = Math.floor(GAMETIME % 60);
          var acc =
            PLAYER_STATS.shots > 0
              ? Math.round((PLAYER_STATS.hits / PLAYER_STATS.shots) * 100)
              : 0;
          document.getElementById("endStats").innerHTML =
            "<span>PLACEMENT</span><b>" +
            (win ? "#1 of " + CFG.MAXP : PC.placement || "?") +
            "</b>" +
            "<span>ELIMINATIONS</span><b>" +
            PC.eliminations +
            "</b>" +
            "<span>DAMAGE DEALT</span><b>" +
            Math.round(PC.damageDealt || 0) +
            "</b>" +
            "<span>ACCURACY</span><b>" +
            acc +
            "%</b>" +
            "<span>MATERIALS USED</span><b>" +
            Math.round(PC.mats.wood + PC.mats.stone + PC.mats.metal) +
            "</b>" +
            "<span>DISTANCE</span><b>" +
            Math.round(PLAYER_STATS.dist) +
            " m</b>" +
            "<span>SURVIVED</span><b>" +
            mins +
            ":" +
            (secs < 10 ? "0" : "") +
            secs +
            "</b>";
          document.getElementById("btnSpectate").style.display =
            win || over ? "none" : "inline-block";
        }

        /* ---------------- aim assist ---------------- */
        var _aaYaw = 0,
          _aaPitch = 0;
        function applyAimAssist(dt) {
          if (!SETTINGS.aimAssist) return;
          if (!(IS_MOBILE || SETTINGS.autofire || Input.aim || Input.fire)) return;
          if (!PC.alive || PC.knocked) return;
          if (PC.vehicle || BUILD_MODE)
            return; /* never tug the camera while driving/building */
          var best = null,
            bd = 1e9,
            maxAaDist = 130;
          for (var i = 0; i < CHARS.length; i++) {
            var c = CHARS[i];
            if (!c.alive || c.onBus || c.knocked) continue;
            if (
              c.team !== undefined &&
              PC.team !== undefined &&
              c.team === PC.team
            )
              continue;
            var d = dist2(PC.x, PC.z, c.x, c.z);
            if (d > maxAaDist) continue;
            var ang = Math.abs(
              angDiff(PC.yaw, Math.atan2(c.x - PC.x, c.z - PC.z)),
            );
            if (ang > 0.45) continue;
            if (!hasLOS(PC.x, PC.y + 1.5, PC.z, c.x, c.y + 1.2, c.z)) continue;
            if (d < bd) {
              bd = d;
              best = c;
            }
          }
          if (!best) {
            _aaYaw *= 0.85;
            _aaPitch *= 0.85;
            return;
          }
          var wantYaw = Math.atan2(best.x - PC.x, best.z - PC.z);
          var dy = best.y + 1.15 - (PC.y + 1.5);
          var wantPitch = Math.atan2(dy, Math.max(2, bd));
          var strength = (clamp(1 - bd / maxAaDist, 0, 1) * 0.38 * dt * 60) / 60;
          PC.yaw = approachAngle(PC.yaw, wantYaw, strength * 0.95);
          PC.pitch = lerp(PC.pitch, wantPitch, strength * 0.75);
        }

        /* ---------------- player input resolution ---------------- */
        var REVIVE_TARGET = null;
        function updatePlayerInput(dt) {
          var sens = 0.0023 * SETTINGS.sens * (Input.aim ? 0.55 : 1);
          PC.yaw -= Input.consumeLook() * sens;
          PC.pitch -= Input.consumeLookY() * sens;
          PC.pitch = clamp(PC.pitch, -1.4, 1.4);
          applyAimAssist(dt);

          if (PC.knocked) {
            Input.firePress = false;
            Input.usePress = false;
            UI.showRevive(true);
            return;
          }
          PC.aiming =
            (Input.aim || (IS_MOBILE && Input.fire && SETTINGS.autofire)) &&
            !BUILD_MODE;
          PC.sprinting = Input.sprint && !PC.aiming && Input.axisZ > 0.1;
          PC.aimSpread = PC.aiming ? 0.2 : PC.sprinting ? 1.1 : 0.65;

          if (PC.vehicle) {
            PC.vehThrottle = Input.axisZ;
            PC.vehSteer = Input.axisX;
            PC.vehBoost = Input.sprint;
            if (Input.usePress) {
              exitVehicle(PC);
              Input.usePress = false;
            }
            Input.firePress = false;
            hideGhost();
            UI.setScope(false);
            return;
          }
          if (Input.wheel !== 0) {
            selectSlot((PC.slot + Input.wheel + 6) % 6);
            Input.wheel = 0;
          }
          if (Input.reload) {
            startReload(PC);
            Input.reload = false;
          }
          if (UI.healPress) {
            useHeal(PC);
            UI.healPress = false;
          }
          if (PC.using && (Input.firePress || Input.jump)) PC.using = null;

          if (BUILD_MODE) {
            if (Input.fire) BUILD_HOLD += dt;
            else BUILD_HOLD = 0;
            updateBuild(dt, Input.fire);
          } else {
            hideGhost();
            BUILD_HOLD = 0;
            if (Input.fire) {
              var w = PC.slots[PC.slot];
              if (w) {
                var def = WEAPONS[w.id];
                if (def.auto || Input.firePress || SETTINGS.autofire)
                  fireWeapon(PC, CAM.aim.x, CAM.aim.y, CAM.aim.z, true);
              }
            }
          }
          Input.firePress = false;

          /* convenience auto-pickup of ammo & materials */
          if (!BUILD_MODE) {
            for (var li = 0; li < LOOT.length; li++) {
              var lt = LOOT[li];
              if (
                lt.kind === "weapon" ||
                lt.kind === "shield" ||
                lt.kind === "bandage" ||
                lt.kind === "heal"
              )
                continue;
              if (
                dist2(PC.x, PC.z, lt.x, lt.z) < 1.7 &&
                Math.abs(lt.y - PC.y) < 3
              ) {
                if (giveItem(PC, lt)) {
                  Sfx.pickup();
                  removeLoot(lt);
                }
                break;
              }
            }
          }
          /* interaction: chests, loot, downed teammates, vehicles */
          var near = nearestInteract(PC);
          var veh = nearestVehicle(PC);
          var promptText = null,
            action = null;
          if (near) {
            if (near.kind === "chest") {
              promptText = "<b>F</b> OPEN CHEST";
              action = "chest";
            } else if (near.kind === "downed") {
              promptText = "HOLD <b>F</b> TO REVIVE " + near.obj.name;
              action = "revive";
            } else if (near.kind === "drop") {
              promptText = "<b>F</b> OPEN SUPPLY DROP";
              action = "drop";
            } else if (near.kind === "van") {
              var dm = deadTeammateOf(PC);
              promptText =
                "HOLD <b>F</b> TO REBOOT " + (dm ? dm.name : "TEAMMATE");
              action = "van";
            } else {
              var nit = near.obj,
                ntxt;
              if (nit.kind === "weapon")
                ntxt =
                  '<span style="color:' +
                  hexStr(RARITY[nit.rarity || 0].c) +
                  '">' +
                  RARITY[nit.rarity || 0].name +
                  " " +
                  WEAPONS[nit.id].name +
                  "</span>";
              else if (nit.kind === "ammo")
                ntxt = nit.ammo.toUpperCase() + " AMMO";
              else if (nit.kind === "shield") ntxt = "SHIELD POTION";
              else if (nit.kind === "heal") ntxt = HEALS[nit.heal].name;
              else if (nit.kind === "bandage") ntxt = "BANDAGES";
              else if (nit.kind === "card")
                ntxt = '<span style="color:#6bffd0">REBOOT CARD</span>';
              else if (nit.mat) ntxt = nit.mat.toUpperCase();
              else ntxt = "ITEM";
              promptText = "<b>F</b> PICK UP " + ntxt;
              action = "loot";
            }
          } else if (veh) {
            promptText =
              "<b>F</b> ENTER " + (veh.type === "boat" ? "BOAT" : "VEHICLE");
            action = "vehicle";
          }
          if (promptText) UI.showPrompt(promptText);
          else UI.hidePrompt();

          if (action === "revive") {
            var o = near.obj;
            if (REBOOT_ST.van) {
              REBOOT_ST.van = null;
              REBOOT_ST.prog = 0;
            }
            if (Input.use) {
              REVIVE_TARGET = o;
              o.reviveProg = (o.reviveProg || 0) + dt / 5.0;
              UI.showRevive(true);
              UI.setReviveBar(o.reviveProg);
              if (o.reviveProg >= 1) {
                reviveChar(o, PC);
                UI.showRevive(false);
                REVIVE_TARGET = null;
              }
            } else if (REVIVE_TARGET === o) {
              o.reviveProg = Math.max(0, (o.reviveProg || 0) - dt * 0.4);
              UI.showRevive(false);
            }
          } else if (action === "van") {
            if (REVIVE_TARGET) {
              REVIVE_TARGET.reviveProg = 0;
              REVIVE_TARGET = null;
            }
            var vnear = near.obj;
            if (Input.use && PC.cards > 0) {
              REBOOT_ST.van = vnear;
              REBOOT_ST.by = PC;
              REBOOT_ST.prog += dt / 6.0;
              UI.showRevive(true);
              UI.setReviveBar(REBOOT_ST.prog);
              if (REBOOT_ST.prog >= 1) {
                doReboot(vnear, PC);
                REBOOT_ST.prog = 0;
                REBOOT_ST.van = null;
                UI.showRevive(false);
              }
            } else if (REBOOT_ST.van === vnear) {
              REBOOT_ST.prog = Math.max(0, REBOOT_ST.prog - dt * 0.6);
              UI.showRevive(false);
            }
          } else {
            if (REBOOT_ST.van) {
              REBOOT_ST.van = null;
              REBOOT_ST.prog = 0;
            }
            if (REVIVE_TARGET) {
              REVIVE_TARGET.reviveProg = 0;
              REVIVE_TARGET = null;
              UI.showRevive(false);
            }
            if (Input.usePress) {
              if (action === "chest") openChest(near.obj, PC);
              else if (action === "loot") tryPickup(PC);
              else if (action === "drop") openDrop(near.obj, PC);
              else if (action === "vehicle") enterVehicle(PC, veh);
            }
          }
          Input.usePress = false;
        }

        /* ---------------- world follow ---------------- */
        function updateSun(dt) {
          var c = PC.alive ? PC : SPECTATE_TARGET || PC;
          if (!c) return;
          sun.position.set(
            c.x + SKY.sunDir.x * 300,
            c.y + SKY.sunDir.y * 300,
            c.z + SKY.sunDir.z * 300,
          );
          sun.target.position.set(c.x, c.y, c.z);
          sun.target.updateMatrixWorld();
          skyMesh.position.set(c.x, 0, c.z);
          if (waterMesh) {
            waterMesh.position.set(c.x, CFG.SEA, c.z);
            if (WATER.mat) WATER.mat.uniforms.uCam.value.copy(camera.position);
          }
          if (SKY.mat) SKY.mat.uniforms.uTime.value = GAMETIME;
          for (var i = 0; i < CLOUDS.length; i++) {
            var cl = CLOUDS[i];
            cl.position.x += dt * cl.userData.drift * 1.6;
            if (cl.position.x > c.x + 700) cl.position.x = c.x - 700;
          }
          /* wind on foliage */
          var u1 = MAT.canopy.userData.windUniform;
          var u2 = MAT.leaf.userData.windUniform;
          var u3 = MAT.grassI.userData.windUniform;
          if (u1) u1.uTime.value = GAMETIME;
          if (u2) u2.uTime.value = GAMETIME;
          if (u3) u3.uTime.value = GAMETIME;
        }

        /* ---------------- frame ---------------- */
        function frame(now) {
          requestAnimationFrame(frame);
          var dt = (now - _last) / 1000;
          _last = now;
          if (!isFinite(dt) || dt <= 0) dt = 0.016;
          dt = Math.min(dt, 0.05);
          GAMETIME += dt;
          Input.poll();

          /* fps + adaptive quality */
          _fpsAcc += dt;
          _fpsN++;
          if (_fpsAcc > 0.5) {
            var fps = _fpsN / _fpsAcc;
            _fpsAcc = 0;
            _fpsN = 0;
            _fpsShown = fps;
            if (SETTINGS.fps) {
              var fe = UI.el("fps");
              if (fe) fe.textContent = Math.round(fps) + " FPS";
            }
            if (fps < 36) {
              _fpsLow++;
            } else _fpsLow = Math.max(0, _fpsLow - 1);
            if (!_qLocked && _fpsLow > 6 && QUALITY < 2) {
              QUALITY++;
              _fpsLow = 0;
              if (QUALITY === 1) {
                renderer.setPixelRatio(
                  Math.min(window.devicePixelRatio || 1, 1.1),
                );
              }
              if (QUALITY === 2) {
                renderer.shadowMap.enabled = false;
                if (POST) POST.enabled = false;
                scene.traverse(function (o) {
                  if (o.material) o.material.needsUpdate = true;
                });
              }
              if (POST && POST.ok)
                POST.resize(
                  Math.floor(window.innerWidth * renderer.getPixelRatio()),
                  Math.floor(window.innerHeight * renderer.getPixelRatio()),
                );
            }
          }

          if (!MATCH_OVER && (MATCH_RUNNING || SPECTATING || !PC)) {
            if (PC) {
              if (PC.alive) {
                updatePlayerInput(dt);
                updatePlayer(dt);
                PLAYER_STATS.dist +=
                  Math.sqrt(PC.vx * PC.vx + PC.vz * PC.vz) * dt;
              } else {
                PC.yaw -= Input.consumeLook() * 0.0023;
                PC.pitch = clamp(
                  PC.pitch - Input.consumeLookY() * 0.0023,
                  -1.3,
                  1.3,
                );
                if (!SPECTATE_TARGET || !SPECTATE_TARGET.alive)
                  pickSpectateTarget();
                if (Input.firePress) {
                  cycleSpectate();
                }
                Input.firePress = false;
                Input.usePress = false;
                UI.showRevive(false);
              }
              var i;
              for (i = 0; i < CHARS.length; i++) {
                var bc = CHARS[i];
                if (!bc.isBot) continue;
                if (!bc.alive) continue;
                if (bc.knocked) updateKnocked(bc, dt);
                updateBot(bc, dt);
              }
              updateVehicles(dt);
              updateStorm(dt);
              updateBus(dt);
              updateDrops(dt);
              updateReboot(dt);
              updateProjectiles(dt);
              updateFX(dt);
              updateLoot(dt);
              updateChests(dt);
              updateDecals(dt);
              for (i = 0; i < CHARS.length; i++) {
                var c = CHARS[i];
                if (!c.alive) {
                  animateDeath(c, dt);
                  continue;
                }
                animateChar(c, dt);
                syncChar(c);
              }
              updateCamera(dt);
              updateSun(dt);
              UI.update();
            }
          }
          if (POST && POST.ok)
            POST.hurt =
              PC && PC.alive && PC.hurtFlash > 0
                ? clamp(PC.hurtFlash * 1.4, 0, 0.6)
                : 0;
          POST.render(dt);
        }

        /* ---------------- boot ---------------- */
        function setLoad(p, msg) {
          document.getElementById("loadBar").firstElementChild.style.width =
            p * 100 + "%";
          if (msg) document.getElementById("loadMsg").textContent = msg;
        }
        function ensureThree(cb) {
          if (window.THREE) return cb();
          var urls = [
            "https://unpkg.com/three@0.147.0/build/three.min.js",
            "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.147.0/three.min.js",
          ];
          var i = 0;
          function tryNext() {
            if (i >= urls.length) {
              var f = document.getElementById("fatal");
              f.style.display = "flex";
              f.innerHTML =
                "<div><b>Could not load the 3D engine (three.js).</b><br><br>" +
                "This game needs an internet connection on first load so it can pull three.js from a CDN.<br>" +
                "Please check your connection and reload the page.</div>";
              return;
            }
            var s = document.createElement("script");
            s.src = urls[i++];
            s.onload = function () {
              cb();
            };
            s.onerror = function () {
              tryNext();
            };
            document.head.appendChild(s);
          }
          tryNext();
        }
        function boot() {
          ensureThree(function () {
            var steps = [
              [
                "PAINTING TEXTURES",
                function () {
                  buildTextures();
                  if (IS_MOBILE) CFG.SEG = 150;
                },
              ],
              [
                "WAKING UP THE ENGINE",
                function () {
                  initWorldCore();
                },
              ],
              [
                "SCULPTING THE ISLAND",
                function () {
                  initWorldContent();
                },
              ],
              [
                "RAISING TILTED TOWERS",
                function () {
                  initBuildAssets();
                },
              ],
              [
                "MAPPING THE BATTLEFIELD",
                function () {
                  initFX();
                  createVehicles();
                },
              ],
              [
                "SPAWNING THE STORM",
                function () {
                  initStormAssets();
                  initBusAssets();
                },
              ],
              [
                "READY",
                function () {
                  UI.init();
                  Input.init();
                  resetMatch();
                },
              ],
            ];
            var i = 0;
            function next() {
              if (i >= steps.length) {
                setLoad(1, "READY");
                document.getElementById("loading").classList.add("hidden");
                document
                  .getElementById("startScreen")
                  .classList.remove("hidden");
                _last = performance.now();
                requestAnimationFrame(frame);
                return;
              }
              var s = steps[i];
              setLoad(i / steps.length, s[0]);
              try {
                s[1]();
              } catch (err) {
                console.error(err);
                var f = document.getElementById("fatal");
                f.style.display = "flex";
                f.innerHTML =
                  "<div><b>Startup error</b><br>" +
                  (err && err.message ? err.message : err) +
                  "</div>";
                return;
              }
              i++;
              setTimeout(next, 16);
            }
            next();
          });
        }
        if (
          document.readyState === "complete" ||
          document.readyState === "interactive"
        )
          setTimeout(boot, 40);
        else window.addEventListener("DOMContentLoaded", boot);
})();