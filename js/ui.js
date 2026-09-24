import {
  CFG, SETTINGS, XHAIR_COLORS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { renderer, camera, scene } from './gfx.js';
import { CHESTS, POIS, terrainHeightAt, groundAt } from './world.js';
import { PC, CHARS, CAM, attachWeapon } from './chars.js';
import { WEAPONS, RARITY, teammates, damageChar, healChar, fireWeapon, useHeal } from './combat.js';
import { STORM } from './storm.js';
import { DROPS } from './drops.js';
import { VANS } from './reboot.js';
import {
  GAMETIME, MODE, QUALITY, FIXED, MATCH_RUNNING, SPECTATE_TARGET, SPECTATING,
  PLAYER_STATS, REVIVE_TARGET, viewChar, startMatch, restartMatch, pickSpectateTarget, cycleSpectate
} from './main.js';
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
              else if (k === "m" || k === "tab") {
                UI.toggleMap();
                e.preventDefault();
              } else if (k === "i") UI.toggleInventory();
              else if (k >= "1" && k <= "6") {
                var n = parseInt(k, 10);
                selectSlot(n - 1);
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
                "SLOT " + (i + 1) +
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
            // vehicles removed from minimap
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
            // vehicles removed from map
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



export {
  UI, Input, IS_MOBILE,
  worldToScreen, selectSlot, onResize
};
