import {
  CFG, SETTINGS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { scene, worldGroup, sun } from './gfx.js';
import { MAT, terrainHeightAt, groundAt } from './world.js';
import { CHARS, PC, CAM } from './chars.js';
import { tryKnockOrKill } from './combat.js';
import { UI } from './ui.js';
import { GAMETIME } from './main.js';
        /* ==== 70_storm.js ==== */
        /* ============================================================================
   70_STORM — the shrinking circle, its volumetric wall shader, lightning,
   the battle bus and the skydive / glider descent.
   ========================================================================== */

        var STORM_PHASES = [
          { wait: 55, shrink: 44, r: 170, dmg: 1 },
          { wait: 40, shrink: 36, r: 118, dmg: 2 },
          { wait: 34, shrink: 32, r: 76, dmg: 5 },
          { wait: 30, shrink: 28, r: 44, dmg: 8 },
          { wait: 26, shrink: 24, r: 21, dmg: 10 },
          { wait: 24, shrink: 22, r: 7, dmg: 12 },
        ];
        var STORM = {
          phase: 0,
          state: "wait",
          timer: 0,
          cx: 0,
          cz: 0,
          r: 220,
          dmg: 1,
          nx: 0,
          nz: 0,
          nr: 0,
          active: false,
          mesh: null,
          ring: null,
          ringMat: null,
          sx: 0,
          sz: 0,
          sr: 0,
          dmgTick: 0,
          hurtFlash: 0,
          warnT: 0,
          boltT: 0,
          boltFlash: 0,
          wallA: null,
        };

        function initStormAssets() {
          if (STORM.mesh) return;
          var g = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true);
          var mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
            blending: THREE.NormalBlending,
            uniforms: {
              uTime: { value: 0 },
              uCol: { value: col(0x9b4ff0) },
              uCol2: { value: col(0x4a1a9c) },
              uOp: { value: 0.55 },
              uEdge: { value: 0.0 },
            },
            vertexShader:
              "varying vec2 vUv; varying vec3 vWorld; varying vec3 vNrm;" +
              "void main(){ vUv=uv; vNrm=normalize(mat3(modelMatrix)*normal);" +
              " vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz;" +
              " gl_Position=projectionMatrix*viewMatrix*wp; }",
            fragmentShader:
              "uniform float uTime; uniform vec3 uCol; uniform vec3 uCol2; uniform float uOp; uniform float uEdge;" +
              "varying vec2 vUv; varying vec3 vWorld; varying vec3 vNrm;" +
              "float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }" +
              "float nz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);" +
              " return mix(mix(h(i),h(i+vec2(1.0,0.0)),f.x), mix(h(i+vec2(0.0,1.0)),h(i+vec2(1.0,1.0)),f.x), f.y); }" +
              "float fb(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*nz(p); p*=2.13; a*=0.5; } return s; }" +
              "void main(){" +
              " vec3 vd=normalize(cameraPosition-vWorld);" +
              " float fr=1.0-abs(dot(vd,normalize(vNrm)));" +
              " float t=uTime*0.055;" +
              " float n1=fb(vUv*vec2(30.0,4.5)+vec2(t,uTime*0.32));" +
              " float n2=fb(vUv*vec2(62.0,9.0)-vec2(t*1.7,uTime*0.55));" +
              " float n=n1*0.62+n2*0.44;" +
              " float band=smoothstep(0.0,0.22,vUv.y)*(1.0-smoothstep(0.72,1.0,vUv.y));" +
              " float a=uOp*(0.20+0.80*fr)*(0.42+0.72*n)*band;" +
              " a+=uEdge*0.16;" +
              " vec3 c=mix(uCol2,uCol,clamp(n*1.25,0.0,1.0));" +
              " c+=vec3(0.55,0.30,1.0)*pow(max(n-0.62,0.0),2.0)*1.9;" +
              " c+=vec3(1.0,0.85,1.0)*pow(max(n-0.86,0.0),3.0)*2.4;" +
              " gl_FragColor=vec4(c,clamp(a,0.0,0.94)); }",
          });
          STORM.mesh = new THREE.Mesh(g, mat);
          STORM.mesh.frustumCulled = false;
          STORM.mesh.renderOrder = 3;
          scene.add(STORM.mesh);

          var rg = new THREE.CylinderGeometry(1, 1, 1, 80, 1, true);
          STORM.ringMat = new THREE.MeshBasicMaterial({
            color: col(0xffffff),
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            depthWrite: false,
            fog: false,
          });
          STORM.ring = new THREE.Mesh(rg, STORM.ringMat);
          STORM.ring.frustumCulled = false;
          STORM.ring.renderOrder = 4;
          scene.add(STORM.ring);
        }
        function resetStorm() {
          STORM.phase = 0;
          STORM.state = "wait";
          STORM.timer = STORM_PHASES[0].wait;
          STORM.cx = 0;
          STORM.cz = 0;
          STORM.r = 220;
          STORM.dmg = STORM_PHASES[0].dmg;
          STORM.active = false;
          STORM.dmgTick = 0;
          STORM.boltT = rnd(8, 18);
          STORM.boltFlash = 0;
          computeNextCircle();
          updateStormVisual();
        }
        function computeNextCircle() {
          var p = STORM_PHASES[STORM.phase];
          var nr = p.r;
          var maxOff = Math.max(0, STORM.r - nr) * 0.78;
          var a = rnd(0, 6.28),
            d = rnd(0.15, 1) * maxOff;
          STORM.nx = clamp(STORM.cx + Math.cos(a) * d, -152, 152);
          STORM.nz = clamp(STORM.cz + Math.sin(a) * d, -152, 152);
          STORM.nr = nr;
        }
        function updateStormVisual() {
          var H = 620;
          STORM.mesh.position.set(STORM.cx, 120, STORM.cz);
          STORM.mesh.scale.set(STORM.r, H, STORM.r);
          STORM.mesh.material.uniforms.uTime.value = GAMETIME;
          var distToWall = PC
            ? Math.abs(dist2(PC.x, PC.z, STORM.cx, STORM.cz) - STORM.r)
            : 999;
          STORM.mesh.material.uniforms.uEdge.value = clamp(
            1 - distToWall / 26,
            0,
            1,
          );
          STORM.mesh.material.uniforms.uOp.value =
            STORM.phase >= 4 ? 0.72 : 0.55;
          STORM.ring.position.set(STORM.nx, 60, STORM.nz);
          STORM.ring.scale.set(STORM.nr, 140, STORM.nr);
          STORM.ringMat.opacity = 0.12 + 0.12 * Math.sin(GAMETIME * 2.4);
        }
        function updateStorm(dt) {
          if (!STORM.active) {
            updateStormVisual();
            return;
          }
          STORM.timer -= dt;
          if (STORM.state === "wait") {
            if (STORM.timer <= 0) {
              STORM.state = "shrink";
              STORM.timer = STORM_PHASES[STORM.phase].shrink;
              STORM.sx = STORM.cx;
              STORM.sz = STORM.cz;
              STORM.sr = STORM.r;
              Sfx.stormStart();
              UI.banner(
                STORM.phase >= STORM_PHASES.length - 2
                  ? "FINAL CIRCLE"
                  : "THE STORM IS CLOSING",
                "GET INSIDE THE CIRCLE",
                2.6,
              );
            }
          } else {
            var p = STORM_PHASES[STORM.phase];
            var t = 1 - clamp(STORM.timer / p.shrink, 0, 1);
            STORM.cx = lerp(STORM.sx, STORM.nx, t);
            STORM.cz = lerp(STORM.sz, STORM.nz, t);
            STORM.r = lerp(STORM.sr, STORM.nr, t);
            if (STORM.timer <= 0) {
              STORM.cx = STORM.nx;
              STORM.cz = STORM.nz;
              STORM.r = STORM.nr;
              STORM.phase = Math.min(STORM.phase + 1, STORM_PHASES.length - 1);
              STORM.dmg = STORM_PHASES[STORM.phase].dmg;
              STORM.state = "wait";
              STORM.timer = STORM_PHASES[STORM.phase].wait;
              computeNextCircle();
              UI.banner(
                "STORM PHASE " + (STORM.phase + 1),
                Math.round(STORM.timer) + " SECONDS TO CLOSE",
                2.2,
              );
            }
          }
          /* lightning once the storm gets angry */
          if (STORM.phase >= 2) {
            STORM.boltT -= dt;
            if (STORM.boltT <= 0) {
              STORM.boltT = rnd(6, 16);
              STORM.boltFlash = 0.45;
              Sfx.thunder();
              UI.lightning();
            }
          }
          if (STORM.boltFlash > 0) {
            STORM.boltFlash -= dt;
            var f = Math.max(0, STORM.boltFlash / 0.45);
            hemi.intensity = 0.9 + f * 1.5;
            sun.intensity = 2.5 + f * 0.9;
          } else {
            hemi.intensity = 0.9;
            sun.intensity = 2.5;
          }

          /* damage ticks */
          STORM.dmgTick -= dt;
          if (STORM.dmgTick <= 0) {
            STORM.dmgTick = 1.0;
            for (var i = 0; i < CHARS.length; i++) {
              var c = CHARS[i];
              if (
                !c.alive ||
                c.onBus ||
                c.knocked ||
                c.state === "skydive" ||
                c.state === "glide"
              )
                continue;
              if (c.vehicle) continue;
              if (dist2(c.x, c.z, STORM.cx, STORM.cz) > STORM.r) {
                c.shield = Math.max(0, c.shield - STORM.dmg * 0.5);
                c.health -= STORM.dmg;
                c.hurtFlash = 0.25;
                if (c.isPlayer) {
                  UI.stormHurt();
                  Sfx.hurt();
                }
                if (c.health <= 0) tryKnockOrKill(c, null);
              }
            }
          }
          updateStormVisual();
          if (PC.alive) {
            var out = dist2(PC.x, PC.z, STORM.cx, STORM.cz) > STORM.r;
            UI.setStormOverlay(out ? 1 : 0);
            Sfx.setStorm(out ? 0.3 : 0.05);
            STORM.warnT -= dt;
            if (out && STORM.warnT <= 0) {
              STORM.warnT = 5;
              UI.banner("YOU ARE IN THE STORM", "GET TO THE SAFE ZONE", 2.0);
            }
          }
        }

        /* ============================================================================
   Battle bus
   ========================================================================== */
        var BUS = {
          x: 0,
          y: 208,
          z: 0,
          dx: 0,
          dz: 1,
          t: 0,
          mesh: null,
          active: true,
          balloon: null,
          prop: null,
        };
        function initBusAssets() {
          if (BUS.mesh) return;
          var g = new THREE.Group();
          var body = new THREE.MeshStandardMaterial({
            color: col(0x2f4fa8),
            roughness: 0.45,
            metalness: 0.5,
          });
          var glass = new THREE.MeshStandardMaterial({
            color: col(0x9fd8ff),
            roughness: 0.08,
            metalness: 0.35,
            transparent: true,
            opacity: 0.7,
          });
          var dark = new THREE.MeshStandardMaterial({
            color: col(0x1a1f2e),
            roughness: 0.7,
          });
          var trim = new THREE.MeshStandardMaterial({
            color: col(0xffd76a),
            metalness: 0.6,
            roughness: 0.3,
          });
          var b = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 9), body);
          b.castShadow = true;
          g.add(b);
          for (var i = -1; i <= 1; i++) {
            var w = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.0, 1.6), glass);
            w.position.set(0, 0.7, i * 2.6);
            g.add(w);
          }
          var top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 9.2), dark);
          top.position.y = 1.45;
          g.add(top);
          var stripe = new THREE.Mesh(
            new THREE.BoxGeometry(3.28, 0.26, 9.05),
            trim,
          );
          stripe.position.y = -0.3;
          g.add(stripe);
          for (var w2 = 0; w2 < 4; w2++) {
            var wh = new THREE.Mesh(
              new THREE.CylinderGeometry(0.62, 0.62, 0.5, 10),
              dark,
            );
            wh.rotation.z = Math.PI / 2;
            wh.position.set(w2 < 2 ? -1.7 : 1.7, -1.3, w2 % 2 === 0 ? -3 : 3);
            g.add(wh);
          }
          var balloon = new THREE.Mesh(
            new THREE.SphereGeometry(6.4, 22, 18),
            new THREE.MeshStandardMaterial({
              color: col(0xe8556b),
              roughness: 0.55,
              metalness: 0.05,
            }),
          );
          balloon.position.y = 11;
          balloon.scale.set(1, 0.82, 1.15);
          balloon.castShadow = true;
          g.add(balloon);
          for (var r2 = 0; r2 < 4; r2++) {
            var rope = new THREE.Mesh(
              new THREE.CylinderGeometry(0.05, 0.05, 7, 4),
              dark,
            );
            rope.position.set(
              (r2 < 2 ? -1 : 1) * 1.2,
              5.4,
              r2 % 2 === 0 ? -1.8 : 1.8,
            );
            g.add(rope);
          }
          /* propeller */
          var prop = new THREE.Group();
          for (var p2 = 0; p2 < 3; p2++) {
            var blade = new THREE.Mesh(
              new THREE.BoxGeometry(0.16, 2.6, 0.06),
              dark,
            );
            blade.rotation.z = (p2 * Math.PI * 2) / 3;
            prop.add(blade);
          }
          prop.position.set(0, 0, 4.8);
          g.add(prop);
          BUS.prop = prop;
          worldGroup.add(g);
          BUS.mesh = g;
          BUS.balloon = balloon;
        }
        function resetBus() {
          var a = rnd(0, 6.28);
          BUS.dx = Math.cos(a);
          BUS.dz = Math.sin(a);
          var off = rnd(-70, 70);
          BUS.cx = -BUS.dz * off;
          BUS.cz = BUS.dx * off;
          BUS.t = -300;
          BUS.active = true;
          BUS.mesh.visible = true;
          BUS.x = BUS.cx + BUS.dx * BUS.t;
          BUS.z = BUS.cz + BUS.dz * BUS.t;
          BUS.y = CFG.BUS_Y;
          BUS.mesh.position.set(BUS.x, BUS.y, BUS.z);
        }
        function updateBus(dt) {
          if (!BUS.active) return;
          BUS.t += CFG.BUS_SPEED * dt;
          BUS.x = BUS.cx + BUS.dx * BUS.t;
          BUS.z = BUS.cz + BUS.dz * BUS.t;
          BUS.y = CFG.BUS_Y + Math.sin(GAMETIME * 0.7) * 2.5;
          BUS.mesh.position.set(BUS.x, BUS.y, BUS.z);
          BUS.mesh.rotation.y = Math.atan2(BUS.dx, BUS.dz);
          BUS.mesh.rotation.z = Math.sin(GAMETIME * 0.9) * 0.035;
          if (BUS.prop) BUS.prop.rotation.z += dt * 22;
          if (BUS.balloon) BUS.balloon.rotation.y += dt * 0.15;
          for (var i = 0; i < CHARS.length; i++) {
            var c = CHARS[i];
            if (c.onBus && !c.isPlayer && BUS.t > c.jumpAt * 520 - 260)
              ejectFromBus(c);
          }
          if (BUS.t > 300) {
            for (var j = 0; j < CHARS.length; j++)
              if (CHARS[j].onBus) ejectFromBus(CHARS[j]);
            BUS.active = false;
            BUS.mesh.visible = false;
            UI.hideBusHint();
            STORM.active = true;
            STORM.timer = STORM_PHASES[0].wait;
            Sfx.startStormLoop();
          }
        }
        function ejectFromBus(ch) {
          if (!ch.onBus) return;
          ch.onBus = false;
          ch.state = "skydive";
          ch.x = BUS.x + rnd(-2, 2);
          ch.z = BUS.z + rnd(-2, 2);
          ch.y = BUS.y - 2.5;
          ch.vx = BUS.dx * CFG.BUS_SPEED * 0.7;
          ch.vz = BUS.dz * CFG.BUS_SPEED * 0.7;
          ch.vy = -6;
          ch.glideLock = 0.55;
          ch.mesh.visible = true;
          if (ch.isPlayer) {
            UI.hideBusHint();
            UI.setGlider(true);
            Sfx.glider();
            Sfx.music("drop");
          }
        }
        function deployGlider(ch) {
          if (ch.state !== "skydive") return;
          ch.state = "glide";
          ch.vy = Math.min(ch.vy, -6);
          if (!ch.gliderMesh) {
            var g = new THREE.Group();
            var m = new THREE.MeshStandardMaterial({
              color: col(0x3fd0ff),
              roughness: 0.35,
              metalness: 0.2,
              side: THREE.DoubleSide,
              emissive: col(0x0d5f8a),
              emissiveIntensity: 0.4,
            });
            var m2 = new THREE.MeshStandardMaterial({
              color: col(0xffd76a),
              roughness: 0.4,
              metalness: 0.2,
              side: THREE.DoubleSide,
              emissive: col(0x6a4a00),
              emissiveIntensity: 0.3,
            });
            var w = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 1.7), m);
            w.position.set(0, 3.1, 0.15);
            g.add(w);
            var w2 = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 1.2), m2);
            w2.position.set(0, 3.2, -1.2);
            g.add(w2);
            var w3 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.09, 0.9), m);
            w3.position.set(0, 3.05, 1.3);
            g.add(w3);
            var pole = new THREE.Mesh(
              new THREE.CylinderGeometry(0.06, 0.06, 1.7, 5),
              new THREE.MeshStandardMaterial({ color: col(0x2b3038) }),
            );
            pole.position.set(0, 2.25, 0);
            g.add(pole);
            for (var i = -1; i <= 1; i += 2) {
              var arm = new THREE.Mesh(
                new THREE.CylinderGeometry(0.045, 0.045, 1.7, 4),
                new THREE.MeshStandardMaterial({ color: col(0x2b3038) }),
              );
              arm.position.set(i * 0.95, 2.6, -0.2);
              arm.rotation.z = i * 0.6;
              g.add(arm);
              var line = new THREE.Mesh(
                new THREE.CylinderGeometry(0.018, 0.018, 2.0, 3),
                new THREE.MeshStandardMaterial({ color: col(0x1a1f28) }),
              );
              line.position.set(i * 0.7, 2.1, 0.1);
              line.rotation.z = i * 0.35;
              g.add(line);
            }
            ch.mesh.add(g);
            ch.gliderMesh = g;
          }
          ch.gliderMesh.visible = true;
          if (ch.isPlayer) {
            Sfx.glider();
            UI.setGlider(false);
          }
        }



export {
  STORM, STORM_PHASES, BUS,
  initStormAssets, initBusAssets, resetStorm, resetBus,
  computeNextCircle, updateStormVisual, updateStorm, updateBus,
  ejectFromBus, deployGlider
};
