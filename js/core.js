import { terrainHeightAt, terrainSlope, blockedAt } from './world.js';
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
          DIVE: 85,
          GLIDE: 11.5,
          GLIDE_FWD: 24.0,
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



export {
  CFG, SETTINGS, XHAIR_COLORS, saveSettings,
  clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance,
  col, hexStr,
  hash2i, vnoise, fbm, ridged,
  makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop,
  NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid,
  Sfx
};
