import {
  CFG, SETTINGS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { terrainHeightAt, groundAt, groundInfo, surfaceAt, stepTopAt, collideXZ, raycastWorld, hasLOS, terrainSlope, MAT, POIS, ROADS } from './world.js';
import { WEAPONS, RARITY, LOOT, LOOT_WEAPONS, fireWeapon, healChar, useHeal, giveItem, reviveChar, teammates, teamOf, openChest, startReload, finishReload, removeLoot, canCarry, tryKnockOrKill, damageChar, addShield } from './combat.js';
import { CHARS, PC, createChar, moveChar, animateChar } from './chars.js';
import { STORM, BUS, updateStorm, deployGlider, ejectFromBus } from './storm.js';
import { DROPS, nearestDrop, openDrop, dropLoot } from './drops.js';
import { VANS, nearestVan, doReboot, deadTeammateOf, livingTeammatesOf } from './reboot.js';
import { UI, Input } from './ui.js';
import { GAMETIME, MODE } from './main.js';
        /* ==== 60_ai.js ==== */
        /* ============================================================================
   60_AI — bot brains. Navigation-grid A* pathfinding, personality archetypes,
   squad play (no friendly fire, revives), looting, storm rotation, healing,
   and skydive targeting.
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
              "camper",
              "sniper",
              "looter",
              "rusher",
              "camper",
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
            /* without a pickaxe every bot always holds a gun, but a null slot can
               still happen mid-swap -- fall back to the pistol's stats, which is
               what an unarmed bot effectively has */
            var def = WEAPONS[w ? w.id : "pistol"];
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




export { makeBots, updateBot, DIFF, DIFF_TABLE, NAME_A, NAME_B };
