import {
  CFG, SETTINGS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { worldGroup, scene } from './gfx.js';
import { terrainHeightAt, groundInfo, colliders, MAT } from './world.js';
import { spawnLoot, LOOT_WEAPONS, RARE_WEAPONS, WEAPONS, RARITY, fxSpark, fxSmoke, giveItem, LOOT } from './combat.js';
import { STORM } from './storm.js';
import { PC, CHARS } from './chars.js';
import { UI } from './ui.js';
import { GAMETIME } from './main.js';
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
          if (by && by.isPlayer)
            UI.banner("SUPPLY DROP LOOTED", "LEGENDARY GEAR ACQUIRED", 2.0);
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



export {
  DROPS, DROP_SCHED, DROP_TEX,
  initDropAssets, makeDropMesh, makeDropBeacon, resetDrops,
  dropSpawnPoint, dropGroundY, spawnDrop, updateDrops,
  dropLoot, openDrop, nearestDrop
};
