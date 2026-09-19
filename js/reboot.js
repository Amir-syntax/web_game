import {
  CFG, SETTINGS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { worldGroup } from './gfx.js';
import { terrainHeightAt, colliders, POIS, MAT } from './world.js';
import { CHARS, PC, attachWeapon, createChar, animateChar } from './chars.js';
import { spawnLoot, giveItem, LOOT_WEAPONS, RARE_WEAPONS } from './combat.js';
import { UI } from './ui.js';
import { GAMETIME, MODE, SPECTATE_TARGET, ALIVE, MATCH_OVER } from './main.js';
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



export {
  VANS, VAN_TEX, REBOOT_ST,
  initVanAssets, makeVanMesh, buildRebootVans, resetReboot,
  livingTeammatesOf, deadTeammateOf, spawnRebootCard, nearestVan,
  doReboot, updateReboot
};

