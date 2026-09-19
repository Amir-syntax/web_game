import {
  CFG, SETTINGS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { worldGroup } from './gfx.js';
import { terrainHeightAt, terrainSlope, raycastWorld, groundAt, groundInfo, surfaceAt, collideXZ, hasLOS, MAT, POIS } from './world.js';
import { PC, CAM, CHARS } from './chars.js';
import { UI } from './ui.js';
import { GAMETIME } from './main.js';
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



export {
  BUILDS, BUILD_MODE, BUILD_PIECE, BUILD_MAT, BUILT_VARIANT, CELLIDX, EDIT_TARGET, GHOST,
  PIECE_DEFS, PIECE_HP, COST, REPAIR_CD, TURBO_CD,
  initBuildAssets, buildPieceGeo, matOf, dmgMatOf, cellKey, idxAdd,
  hasPieceAt, hasSupport, placementValid, computePlacement, makePiece, placeBuild,
  killPiece, damageBuild, clearAllBuilds, findEditTarget, cycleEdit, setVariant,
  updateGhost, hideGhost, tryPlace, rampRush, doEdit, setBuildVariant, doRepair, updateBuild, BUILD_HOLD
};


