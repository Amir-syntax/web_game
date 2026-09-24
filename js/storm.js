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
          { wait: 55, shrink: 44, r: 205, dmg: 1 },
          { wait: 40, shrink: 36, r: 140, dmg: 2 },
          { wait: 34, shrink: 32, r: 90, dmg: 5 },
          { wait: 30, shrink: 28, r: 52, dmg: 8 },
          { wait: 26, shrink: 24, r: 25, dmg: 10 },
          { wait: 24, shrink: 22, r: 8, dmg: 12 },
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
          STORM.nx = clamp(STORM.cx + Math.cos(a) * d, -185, 185);
          STORM.nz = clamp(STORM.cz + Math.sin(a) * d, -185, 185);
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
              // vehicle check removed
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
          var bodyMat = new THREE.MeshStandardMaterial({ color: col(0x2f4fa8), roughness: 0.38, metalness: 0.55 });
          var darkBody = new THREE.MeshStandardMaterial({ color: col(0x1e3570), roughness: 0.5, metalness: 0.4 });
          var glassMat = new THREE.MeshStandardMaterial({ color: col(0xa8d8ff), roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.65 });
          var trimMat = new THREE.MeshStandardMaterial({ color: col(0xffd76a), metalness: 0.7, roughness: 0.25, emissive: col(0x8a6000), emissiveIntensity: 0.15 });
          var rubber = new THREE.MeshStandardMaterial({ color: col(0x1a1a1a), roughness: 0.95 });
          var lightMat = new THREE.MeshStandardMaterial({ color: col(0xffffff), emissive: col(0xffffcc), emissiveIntensity: 0.8 });
          var tailLight = new THREE.MeshStandardMaterial({ color: col(0xff3333), emissive: col(0xff0000), emissiveIntensity: 0.5 });
          /* Main body */
          var bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.8, 9.4), bodyMat);
          bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
          g.add(bodyMesh);
          /* Roof AC units */
          for (var ri = 0; ri < 2; ri++) {
            var ac = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.25, 1.4), darkBody);
            ac.position.set(0, 1.52, -2 + ri * 4); ac.castShadow = true;
            g.add(ac);
          }
          /* Roof trim */
          var roofTrim = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.08, 9.5), trimMat);
          roofTrim.position.y = 1.44;
          g.add(roofTrim);
          /* Windshield */
          var windshield = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.3, 0.1), glassMat);
          windshield.position.set(0, 0.5, 4.75); windshield.rotation.x = -0.12;
          g.add(windshield);
          /* Rear window */
          var rearWin = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.1, 0.1), glassMat);
          rearWin.position.set(0, 0.5, -4.75);
          g.add(rearWin);
          /* Side windows + frames */
          for (var side = -1; side <= 1; side += 2) {
            for (var wi = 0; wi < 3; wi++) {
              var win = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 1.5), glassMat);
              win.position.set(side * 1.72, 0.65, -2.2 + wi * 2.4);
              g.add(win);
            }
            var ft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 9.2), darkBody);
            ft.position.set(side * 1.72, 1.15, 0); g.add(ft);
            var fb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 9.2), darkBody);
            fb.position.set(side * 1.72, 0.15, 0); g.add(fb);
            var df = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.8, 1.8), trimMat);
            df.position.set(side * 1.73, 0.0, 1.5); g.add(df);
          }
          /* Gold stripes */
          for (var s2 = -1; s2 <= 1; s2 += 2) {
            var st = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 9.3), trimMat);
            st.position.set(s2 * 1.72, -0.35, 0); g.add(st);
          }
          /* Front bumper + lights */
          var bumper = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.35, 0.4), rubber);
          bumper.position.set(0, -1.1, 4.8); g.add(bumper);
          for (var hl = -1; hl <= 1; hl += 2) {
            var headlight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.08), lightMat);
            headlight.position.set(hl * 1.1, -0.5, 4.78); g.add(headlight);
          }
          for (var tl = -1; tl <= 1; tl += 2) {
            var taillight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.08), tailLight);
            taillight.position.set(tl * 1.1, -0.5, -4.78); g.add(taillight);
          }
          /* Wheels with hubcaps */
          for (var w2 = 0; w2 < 4; w2++) {
            var sideW = w2 < 2 ? -1 : 1, frontBack = w2 % 2 === 0 ? -2.8 : 2.8;
            var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.45, 12), rubber);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(sideW * 1.8, -1.35, frontBack); wheel.castShadow = true;
            g.add(wheel);
            var hubcap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.48, 8), trimMat);
            hubcap.rotation.z = Math.PI / 2;
            hubcap.position.set(sideW * 1.8, -1.35, frontBack);
            g.add(hubcap);
          }
          /* Balloon with ribs and stripes */
          var balloonGroup = new THREE.Group();
          var balloonGeo = new THREE.SphereGeometry(6.8, 32, 26);
          balloonGeo.scale(1, 0.82, 1.15);
          var balloonMat2 = new THREE.MeshStandardMaterial({ color: col(0xe8556b), roughness: 0.5, metalness: 0.05 });
          var balloonMesh = new THREE.Mesh(balloonGeo, balloonMat2);
          balloonMesh.castShadow = true; balloonGroup.add(balloonMesh);
          /* Vertical ribs */
          for (var rib = 0; rib < 8; rib++) {
            var angle = (rib / 8) * Math.PI * 2;
            var ribCurve = new THREE.TorusGeometry(6.7, 0.06, 6, 24, Math.PI);
            var ribMesh = new THREE.Mesh(ribCurve, trimMat);
            ribMesh.rotation.y = angle; ribMesh.rotation.x = Math.PI / 2;
            balloonGroup.add(ribMesh);
          }
          /* Horizontal stripes */
          for (var sti = 0; sti < 3; sti++) {
            var stGeo = new THREE.TorusGeometry(5.8 + sti * 0.9, 0.12, 6, 32);
            var stMesh = new THREE.Mesh(stGeo, trimMat);
            stMesh.position.y = -1.5 + sti * 2.0; stMesh.rotation.x = Math.PI / 2;
            balloonGroup.add(stMesh);
          }
          /* Burner nozzle + fire glow */
          var nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 0.8, 8), darkBody);
          nozzle.position.y = -5.2; balloonGroup.add(nozzle);
          var fireGlow = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: col(0xff8800), transparent: true, opacity: 0.8 }));
          fireGlow.position.y = -5.8; fireGlow.name = "fireGlow";
          balloonGroup.add(fireGlow);
          balloonGroup.position.y = 11;
          g.add(balloonGroup);
          BUS.balloon = balloonGroup;
          /* Ropes */
          for (var r2 = 0; r2 < 4; r2++) {
            var ropeGeo = new THREE.CylinderGeometry(0.04, 0.04, 7.2, 4);
            var rope = new THREE.Mesh(ropeGeo, rubber);
            rope.position.set((r2 < 2 ? -1 : 1) * 1.3, 5.3, r2 % 2 === 0 ? -1.9 : 1.9);
            g.add(rope);
          }
          /* Propeller housing */
          var propHousing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.6), darkBody);
          propHousing.position.set(0, 0, 4.9); g.add(propHousing);
          /* Propeller */
          var prop = new THREE.Group();
          for (var p2 = 0; p2 < 3; p2++) {
            var blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 0.05), darkBody);
            blade.position.z = 0.35; prop.add(blade);
          }
          prop.position.set(0, 0, 5.15); g.add(prop);
          BUS.prop = prop;
          worldGroup.add(g);
          BUS.mesh = g;
          BUS.y = CFG.BUS_Y;
          BUS.mesh.position.set(BUS.x, BUS.y, BUS.z);
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
          ch.vy = -4;
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
            /* Main canopy — semi-sphere shape */
            var canopyGeo = new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            var canopyMat = new THREE.MeshStandardMaterial({
              color: col(0x3fd0ff),
              roughness: 0.35,
              metalness: 0.15,
              side: THREE.DoubleSide,
              emissive: col(0x0d5f8a),
              emissiveIntensity: 0.3,
            });
            var canopy = new THREE.Mesh(canopyGeo, canopyMat);
            canopy.position.y = 3.4;
            canopy.castShadow = true;
            g.add(canopy);
            /* Center vent */
            var ventGeo = new THREE.CylinderGeometry(0.25, 0.35, 0.15, 10, 1, true);
            var ventMat = new THREE.MeshStandardMaterial({
              color: col(0x1a3050),
              side: THREE.DoubleSide,
            });
            var vent = new THREE.Mesh(ventGeo, ventMat);
            vent.position.y = 4.95;
            g.add(vent);
            /* Stripes on canopy */
            for (var si = 0; si < 4; si++) {
              var stripeAngle = (si / 4) * Math.PI * 2;
              var stripeGeo = new THREE.PlaneGeometry(0.15, 1.5);
              var stripeMat = new THREE.MeshStandardMaterial({
                color: col(0xffd76a),
                side: THREE.DoubleSide,
                emissive: col(0x6a4a00),
                emissiveIntensity: 0.2,
              });
              var stripe = new THREE.Mesh(stripeGeo, stripeMat);
              stripe.position.set(
                Math.cos(stripeAngle) * 0.8,
                3.8,
                Math.sin(stripeAngle) * 0.8,
              );
              stripe.lookAt(0, 3.8, 0);
              stripe.rotation.z = stripeAngle;
              g.add(stripe);
            }
            /* Suspension lines to harness */
            var lineMat = new THREE.MeshStandardMaterial({ color: col(0x2b3038) });
            for (var i = 0; i < 8; i++) {
              var angle = (i / 8) * Math.PI * 2;
              var topX = Math.cos(angle) * 1.4;
              var topZ = Math.sin(angle) * 1.4;
              var botX = Math.cos(angle) * 0.5;
              var botZ = Math.sin(angle) * 0.5;
              var midY = 2.8;
              var dx = botX - topX, dy = midY - 3.4, dz = botZ - topZ;
              var len = Math.sqrt(dx*dx + dy*dy + dz*dz);
              var lineGeo = new THREE.CylinderGeometry(0.012, 0.012, len, 3);
              var line = new THREE.Mesh(lineGeo, lineMat);
              line.position.set((topX+botX)/2, (3.4+midY)/2, (topZ+botZ)/2);
              line.lookAt(new THREE.Vector3(botX, midY, botZ));
              line.rotateX(Math.PI/2);
              g.add(line);
            }
            /* Harness / risers */
            var harnessMat = new THREE.MeshStandardMaterial({ color: col(0x3a3a3a) });
            for (var hi = -1; hi <= 1; hi += 2) {
              var riser = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.6, 0.25),
                harnessMat,
              );
              riser.position.set(hi * 0.5, 2.3, 0);
              g.add(riser);
            }
            /* Connecting bar */
            var bar = new THREE.Mesh(
              new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6),
              harnessMat,
            );
            bar.rotation.z = Math.PI / 2;
            bar.position.set(0, 2.0, 0);
            g.add(bar);
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

