import {
  CFG, SETTINGS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { scene, camera, worldGroup } from './gfx.js';
import { terrainHeightAt, groundAt, groundInfo, surfaceAt, stepTopAt, collideXZ, raycastWorld, terrainSlope, MAT, POIS, ROADS, platHash, rampHash } from './world.js';
import { WEAPONS, WMAT, damageChar, finishReload, updateUsing, updateAutoReload, fxSmoke, FX } from './combat.js';
import { BUILD_MODE, BUILDS } from './build.js';
import { BUS, ejectFromBus, deployGlider } from './storm.js';
import { UI, Input } from './ui.js';
import { GAMETIME, MODE, SPECTATE_TARGET } from './main.js';
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



export {
  CHARS, PC, CAM, CH_GEO, CH_HEAD, CH_HIP,
  SEAT_PIVOT, SEAT_PELVIS, SEAT_HEAD, VEH_SEAT_CAR, VEH_SEAT_BOAT, VEH_ROOF_CAR,
  SKIN_PALETTE, VEHICLES, VMAT,
  initVehicleMats, createChar, buildCharMesh, createPlayer, createVehicles,
  updateVehicles, enterVehicle, exitVehicle, nearestVehicle,
  moveChar, animateChar, poseChar, animateDeath, syncChar,
  updatePlayer, updateCamera, applyHurtFlash, restoreCharEmissive, aimWeapon,
  MANTLE_MAX, MANTLE_TIME, STEP_UP, HOLD_POSE, attachWeapon
};

