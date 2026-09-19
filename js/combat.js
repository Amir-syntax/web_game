import {
  CFG, SETTINGS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { scene, worldGroup, renderer, camera } from './gfx.js';
import { terrainHeightAt, raycastWorld, groundInfo, groundAt, hasLOS, MAT, collideXZ, surfaceAt, terrainSlope } from './world.js';
import { PC, CHARS, CAM, createChar } from './chars.js';
import { BUILDS, damageBuild, hasPieceAt } from './build.js';
import { UI } from './ui.js';
import { GAMETIME, MODE, SPECTATE_TARGET, pickSpectateTarget, ALIVE, MATCH_OVER } from './main.js';
import { DROPS } from './drops.js';
import { VANS, spawnRebootCard } from './reboot.js';
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



export {
  WEAPONS, RARITY, LOOT_WEAPONS, RARE_WEAPONS, HEALS, HOLD_CLASS, LOOT, PROJECTILES,
  AMMO_MAX, BOT_DMG, WMAT, FX,
  initWeaponMats, makeWeaponModel, initFX,
  fireWeapon, damageChar, knockDown, tryKnockOrKill, reviveChar, eliminate,
  teamOf, teammates, hasLivingTeammate, healChar, useHeal, startReload, finishReload,
  finishHeal, updateUsing, addShield, spawnLoot, removeLoot, giveItem, tryPickup,
  nearestInteract, openChest, updateChests, spawnProjectile, updateProjectiles,
  updateLoot, updateKnocked, updateFX, explode, updateAutoReload, canCarry,
  weaponOf, muzzlePos, rayHitChar, fxTracer, fxSpark, fxSmoke, fxDebris, fxShell, fxMuzzle, fxExplosion
};


