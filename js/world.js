import {
  CFG, SETTINGS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { worldGroup, patchFoliageWind, buildTerrainMesh, buildWater } from './gfx.js';
import { buildRebootVans } from './reboot.js';
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



export {
  MAT, HM, terrainRaw, POIS, ROADS, colliders, platforms, platHash,
  terrainHeightAt, terrainSlope, buildHeightmap, flattenArea, footprintY,
  groundAt, groundInfo, surfaceAt, stepTopAt, blockedAt, overlapAt, collideXZ,
  rayAABB, raycastWorld, hasLOS, makeMaterials,
  addLootSpot, addChest, buildPOIs, definePOIs, buildRoads, buildVegetation,
  buildChests, buildMetalNodes, buildMapCanvas, initWorldContent,
  CHEST_GLOW, WOODC, WORLD_HP, WORLD_YIELD, harvestStrike, harvKindForMat, CHESTS
};

