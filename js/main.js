import {
  CFG, SETTINGS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { renderer, scene, camera, sun, skyMesh, waterMesh, WATER, SKY, CLOUDS, POST, initWorldCore } from './gfx.js';
import { CHESTS, MAT, initWorldContent } from './world.js';
import { CHARS, PC, CAM, createPlayer, updatePlayer, updateCamera, animateDeath, animateChar, syncChar, updateVehicles, enterVehicle, exitVehicle, nearestVehicle, attachWeapon, createVehicles } from './chars.js';
import {
  LOOT, PROJECTILES, removeLoot, fireWeapon, giveItem, startReload, useHeal,
  nearestInteract, openChest, tryPickup, reviveChar, updateKnocked,
  updateProjectiles, updateFX, updateLoot, updateChests, WEAPONS, RARITY, HEALS, initFX
} from './combat.js';
import { STORM, resetStorm, resetBus, updateStorm, updateBus, initStormAssets, initBusAssets } from './storm.js';
import { resetDrops, updateDrops, openDrop } from './drops.js';
import { resetReboot, updateReboot, doReboot, REBOOT_ST, deadTeammateOf, nearestVan } from './reboot.js';
import { makeBots, updateBot } from './ai.js';
import { UI, Input, IS_MOBILE, selectSlot } from './ui.js';
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
          while (LOOT.length) removeLoot(LOOT[0]);
          while (PROJECTILES.length) PROJECTILES.pop();
          for (var i = 0; i < CHESTS.length; i++) {
            var c = CHESTS[i];
            c.opened = false;
            if (c.lid) c.lid.rotation.x = 0;
            if (c.spr) c.spr.visible = true;
          }
          // vehicle cleanup removed
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
          PC.state = "bus";
          PC.onBus = true;
          /* The pickaxe and the whole building kit are gone, so everyone drops in
             with a common pistol -- enough to defend the landing, not enough to
             skip looting. */
          PC.slots = [
            { id: "pistol", rarity: 0, ammoInMag: 16 },
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
          PC.heals = { band: 5, mini: 3, med: 0, pot: 0 };
          PC.ammo = { light: 150, medium: 120, heavy: 15, shell: 24, rocket: 4 };
          PC.knocked = false;
          PC.bleed = 0;
          // PC.vehicle = null; removed
          attachWeapon(PC);
          UI.setStormOverlay(0);
          UI.setGlider(false);
          UI.hidePrompt();
          UI.showRevive(false);
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
          // Sfx.vehicle(false); removed
          Sfx.setStorm(0);
          Sfx.defeat();
          UI.setStormOverlay(0);
          UI.setScope(false);
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
          // Sfx.vehicle(false); removed
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
            (Input.aim || (IS_MOBILE && Input.fire && SETTINGS.autofire));
          PC.sprinting = Input.sprint && !PC.aiming && Input.axisZ > 0.1;
          PC.aimSpread = PC.aiming ? 0.2 : PC.sprinting ? 1.1 : 0.65;

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

          if (Input.fire) {
            var w = PC.slots[PC.slot];
            if (w) {
              var def = WEAPONS[w.id];
              if (def.auto || Input.firePress || SETTINGS.autofire)
                fireWeapon(PC, CAM.aim.x, CAM.aim.y, CAM.aim.z, true);
            }
          }
          Input.firePress = false;

          /* convenience auto-pickup of ammo */
          {
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
          /* interaction: chests, loot, downed teammates */
          var near = nearestInteract(PC);
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
              // vehicle action removed
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
              /* Update vehicles FIRST so their colliders are fresh for player physics */
              updateVehicles(dt);
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
                "MAPPING THE BATTLEFIELD",
                function () {
                  initFX();
                  // createVehicles(); removed
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

export {
  GAMETIME, MODE, QUALITY, FIXED, MATCH_RUNNING, MATCH_OVER, ALIVE, TEAM_SIZE,
  SPECTATE_TARGET, SPECTATING, PLAYER_STATS, REVIVE_TARGET,
  countTeamsAlive, resetMatch, startMatch, restartMatch, pickSpectateTarget,
  viewChar, cycleSpectate, onPlayerDeath, checkMatchEnd, showEnd,
  applyAimAssist, updatePlayerInput, updateSun, frame, setLoad, boot
};
