import {
  CFG, SETTINGS, clamp, lerp, smoothstep, dist2, angDiff, approachAngle, fmtTime, expDecay,
  srnd, rnd, rndi, pickOne, chance, col, hexStr,
  hash2i, vnoise, fbm, ridged, makeTex, px, TEX, buildTextures,
  GeoBatch, mergeGeoList, PartBag, SpatialHash,
  HeapPush, HeapPop, NAV, NAV_DIRS, navAlloc, navIdx, navToCell, navWalkable, navPath, navSimplify, navClear, buildNavGrid, Sfx
} from './core.js';
import { terrainHeightAt, MAT, HM, makeMaterials } from './world.js';
import { IS_MOBILE } from './ui.js';
        /* ==== 10_gfx.js ==== */
        /* ============================================================================
   10_GFX — renderer, custom post-processing stack (bloom + grade + vignette +
   grain + chromatic aberration), shader sky, Gerstner water, triplanar terrain,
   wind-animated foliage, lights, fog and the decal pool.
   ========================================================================== */

        var renderer,
          scene,
          camera,
          sun,
          hemi,
          bounce,
          skyMesh,
          worldGroup,
          waterMesh;
        var WORLD_SIZE = 4200;

        /* ============================================================================
   POST — a small hand-written pipeline. No external CDN dependency, and it
   degrades gracefully: if anything fails we simply render straight to canvas.
   ========================================================================== */
        var POST = {
          ok: false,
          w: 0,
          h: 0,
          rtScene: null,
          rtA: null,
          rtB: null,
          quadScene: null,
          quadCam: null,
          quad: null,
          mBright: null,
          mBlur: null,
          mComp: null,
          bloom: 0.62,
          exposure: 1.06,
          contrast: 1.07,
          saturation: 1.16,
          vignette: 0.34,
          grain: 0.022,
          aberration: 0.0016,
          hurt: 0,
          level: 1,
          init: function () {
            try {
              var gl2 = renderer.capabilities && renderer.capabilities.isWebGL2;
              var type = gl2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
              var opts = {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: type,
                depthBuffer: true,
                stencilBuffer: false,
              };
              var bopts = {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: type,
                depthBuffer: false,
                stencilBuffer: false,
              };
              this.rtScene = new THREE.WebGLRenderTarget(2, 2, opts);
              this.rtA = new THREE.WebGLRenderTarget(2, 2, bopts);
              this.rtB = new THREE.WebGLRenderTarget(2, 2, bopts);

              this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
              this.quadScene = new THREE.Scene();
              var geo = new THREE.PlaneGeometry(2, 2);
              this.quad = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
              this.quad.frustumCulled = false;
              this.quadScene.add(this.quad);

              var VS =
                "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }";

              this.mBright = new THREE.ShaderMaterial({
                uniforms: {
                  tDiffuse: { value: null },
                  threshold: { value: 0.72 },
                  knee: { value: 0.42 },
                },
                vertexShader: VS,
                fragmentShader:
                  "uniform sampler2D tDiffuse; uniform float threshold; uniform float knee; varying vec2 vUv;" +
                  "void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb;" +
                  " float l=dot(c,vec3(0.2126,0.7152,0.0722));" +
                  " float w=smoothstep(threshold,threshold+knee,l);" +
                  " gl_FragColor=vec4(c*w,1.0); }",
                depthTest: false,
                depthWrite: false,
              });
              this.mBlur = new THREE.ShaderMaterial({
                uniforms: {
                  tDiffuse: { value: null },
                  dir: { value: new THREE.Vector2(1, 0) },
                  res: { value: new THREE.Vector2(1, 1) },
                },
                vertexShader: VS,
                fragmentShader:
                  "uniform sampler2D tDiffuse; uniform vec2 dir; uniform vec2 res; varying vec2 vUv;" +
                  "void main(){ vec2 t=dir/res; vec3 s=texture2D(tDiffuse,vUv).rgb*0.2270270270;" +
                  " s+=texture2D(tDiffuse,vUv+t*1.3846153846).rgb*0.3162162162;" +
                  " s+=texture2D(tDiffuse,vUv-t*1.3846153846).rgb*0.3162162162;" +
                  " s+=texture2D(tDiffuse,vUv+t*3.2307692308).rgb*0.0702702703;" +
                  " s+=texture2D(tDiffuse,vUv-t*3.2307692308).rgb*0.0702702703;" +
                  " gl_FragColor=vec4(s,1.0); }",
                depthTest: false,
                depthWrite: false,
              });
              this.mComp = new THREE.ShaderMaterial({
                uniforms: {
                  tDiffuse: { value: null },
                  tBloom: { value: null },
                  bloom: { value: this.bloom },
                  exposure: { value: this.exposure },
                  contrast: { value: this.contrast },
                  saturation: { value: this.saturation },
                  vignette: { value: this.vignette },
                  grain: { value: this.grain },
                  aberration: { value: this.aberration },
                  time: { value: 0 },
                  res: { value: new THREE.Vector2(1, 1) },
                  hurt: { value: 0 },
                },
                vertexShader: VS,
                fragmentShader:
                  "uniform sampler2D tDiffuse; uniform sampler2D tBloom;" +
                  "uniform float bloom,exposure,contrast,saturation,vignette,grain,aberration,time,hurt;" +
                  "uniform vec2 res; varying vec2 vUv;" +
                  "void main(){ vec2 uv=vUv; vec2 c=uv-0.5; float r2=dot(c,c);" +
                  " vec2 off=c*aberration*(0.5+r2*2.4);" +
                  " vec3 base; base.r=texture2D(tDiffuse,uv+off).r; base.g=texture2D(tDiffuse,uv).g;" +
                  " base.b=texture2D(tDiffuse,uv-off).b;" +
                  " vec3 bl=texture2D(tBloom,uv).rgb;" +
                  " vec3 col=(base+bl*bloom)*exposure;" +
                  " col=pow(max(col,vec3(0.0)),vec3(0.4545454545));" +
                  " float l=dot(col,vec3(0.2126,0.7152,0.0722));" +
                  " col=mix(vec3(l),col,saturation);" +
                  " col=(col-0.5)*contrast+0.5;" +
                  " float v=1.0-vignette*smoothstep(0.16,0.82,r2*1.7);" +
                  " col*=v;" +
                  " col=mix(col,vec3(0.86,0.05,0.05),hurt*0.42);" +
                  " float n=fract(sin(dot(uv*res,vec2(12.9898,78.233))+time*13.0)*43758.5453);" +
                  " col+=(n-0.5)*grain;" +
                  " gl_FragColor=vec4(clamp(col,0.0,1.0),1.0); }",
                depthTest: false,
                depthWrite: false,
              });
              this.ok = true;
              this.enabled = true;
            } catch (e) {
              console.warn("post-processing unavailable", e);
              this.ok = false;
              this.enabled = false;
            }
          },
          enabled: false,
          resize: function (w, h) {
            if (!this.ok) return;
            this.w = w;
            this.h = h;
            this.rtScene.setSize(w, h);
            var bw = Math.max(2, Math.floor(w / 4)),
              bh = Math.max(2, Math.floor(h / 4));
            this.rtA.setSize(bw, bh);
            this.rtB.setSize(bw, bh);
            this.mBlur.uniforms.res.value.set(bw, bh);
            this.mComp.uniforms.res.value.set(w, h);
          },
          applyLevel: function (level) {
            this.level = level;
            var on = SETTINGS.postFx && SETTINGS.bloom && level >= 2;
            this.enabled = this.ok && on;
            if (level >= 3) {
              this.bloom = 0.66;
              this.grain = 0.018;
              this.aberration = 0.0016;
            } else {
              this.bloom = 0.5;
              this.grain = 0.028;
              this.aberration = 0.0012;
            }
            if (this.mComp) {
              this.mComp.uniforms.bloom.value = this.bloom;
              this.mComp.uniforms.grain.value = this.grain;
              this.mComp.uniforms.aberration.value = this.aberration;
            }
          },
          render: function (dt) {
            if (!this.enabled) {
              renderer.setRenderTarget(null);
              renderer.render(scene, camera);
              return;
            }
            var M = this;
            renderer.setRenderTarget(M.rtScene);
            renderer.clear();
            renderer.render(scene, camera);
            /* bright pass */
            M.quad.material = M.mBright;
            M.mBright.uniforms.tDiffuse.value = M.rtScene.texture;
            renderer.setRenderTarget(M.rtA);
            renderer.render(M.quadScene, M.quadCam);
            /* separable blur, two widening passes */
            M.quad.material = M.mBlur;
            for (var pass = 0; pass < 2; pass++) {
              var spread = pass === 0 ? 1.0 : 2.1;
              M.mBlur.uniforms.tDiffuse.value = M.rtA.texture;
              M.mBlur.uniforms.dir.value.set(spread, 0);
              renderer.setRenderTarget(M.rtB);
              renderer.render(M.quadScene, M.quadCam);
              M.mBlur.uniforms.tDiffuse.value = M.rtB.texture;
              M.mBlur.uniforms.dir.value.set(0, spread);
              renderer.setRenderTarget(M.rtA);
              renderer.render(M.quadScene, M.quadCam);
            }
            /* composite */
            M.quad.material = M.mComp;
            M.mComp.uniforms.tDiffuse.value = M.rtScene.texture;
            M.mComp.uniforms.tBloom.value = M.rtA.texture;
            M.mComp.uniforms.time.value = GAMETIME;
            M.mComp.uniforms.hurt.value = M.hurt;
            renderer.setRenderTarget(null);
            renderer.render(M.quadScene, M.quadCam);
          },
        };

        /* ============================================================================
   DECALS — pooled quads for bullet holes and scorch marks.
   ========================================================================== */
        var DECALS = { pool: [], next: 0, cap: 110, ready: false };
        function initDecals() {
          var geo = new THREE.PlaneGeometry(1, 1);
          for (var i = 0; i < DECALS.cap; i++) {
            var m = new THREE.Mesh(
              geo,
              new THREE.MeshBasicMaterial({
                map: TEX.hole,
                transparent: true,
                opacity: 0.9,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -4,
                polygonOffsetUnits: -4,
              }),
            );
            m.visible = false;
            m.renderOrder = 2;
            m.frustumCulled = false;
            scene.add(m);
            DECALS.pool.push({ m: m, life: 0 });
          }
          DECALS.ready = true;
        }
        function addDecal(x, y, z, nx, ny, nz, size, kind, life) {
          if (!DECALS.ready) return;
          var d = DECALS.pool[DECALS.next];
          DECALS.next = (DECALS.next + 1) % DECALS.cap;
          var m = d.m;
          m.material.map = kind === "scorch" ? TEX.scorch : TEX.hole;
          m.material.needsUpdate = true;
          m.position.set(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03);
          m.lookAt(x + nx, y + ny, z + nz);
          m.scale.setScalar(size);
          m.material.opacity = kind === "scorch" ? 0.95 : 0.88;
          m.visible = true;
          d.life = life || 22;
          d.max = d.life;
        }
        function updateDecals(dt) {
          for (var i = 0; i < DECALS.pool.length; i++) {
            var d = DECALS.pool[i];
            if (d.life <= 0) continue;
            d.life -= dt;
            if (d.life <= 2.0)
              d.m.material.opacity =
                Math.max(0, d.life / 2.0) *
                (d.m.material.map === TEX.scorch ? 0.95 : 0.88);
            if (d.life <= 0) d.m.visible = false;
          }
        }

        /* ============================================================================
   Sky — gradient + sun disc + halo + drifting cirrus + subtle horizon haze.
   ========================================================================== */
        var SKY = {
          mat: null,
          sunDir: new THREE.Vector3(0.42, 0.58, 0.3).normalize(),
        };
        function makeSky() {
          var geo = new THREE.SphereGeometry(1600, 40, 24);
          SKY.mat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: {
              top: { value: col(0x1c4fbe) },
              mid: { value: col(0x74b6ef) },
              bot: { value: col(0xd8e8f6) },
              sunDir: { value: SKY.sunDir.clone() },
              uTime: { value: 0 },
              haze: { value: col(0xcfe2f2) },
            },
            vertexShader:
              "varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
            fragmentShader:
              "uniform vec3 top,mid,bot,haze; uniform vec3 sunDir; uniform float uTime; varying vec3 vP;" +
              "float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }" +
              "float nz(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);" +
              " return mix(mix(h(i),h(i+vec2(1.0,0.0)),f.x),mix(h(i+vec2(0.0,1.0)),h(i+vec2(1.0,1.0)),f.x),f.y); }" +
              "float fb(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*nz(p); p*=2.07; a*=0.5; } return s; }" +
              "void main(){" +
              " vec3 d=normalize(vP);" +
              " float up=clamp(d.y*0.5+0.5,0.0,1.0);" +
              " vec3 c=mix(bot,mid,smoothstep(0.42,0.56,up));" +
              " c=mix(c,top,smoothstep(0.55,1.0,up));" +
              " vec3 sd=normalize(sunDir);" +
              " float s=max(dot(d,sd),0.0);" +
              " c+=vec3(1.0,0.86,0.62)*pow(s,12.0)*0.5;" +
              " c+=vec3(1.0,0.93,0.80)*pow(s,220.0)*2.2;" +
              " c=mix(c,vec3(1.0,0.97,0.90),pow(s,900.0)*3.0);" +
              " float horizon=1.0-smoothstep(0.0,0.28,abs(d.y));" +
              " c=mix(c,haze,horizon*0.42);" +
              " if(d.y>0.02){" +
              "   vec2 cuv=vec2(atan(d.z,d.x)*1.6, d.y*4.4);" +
              "   float cl=fb(cuv*2.4+vec2(uTime*0.0075,uTime*0.0016));" +
              "   float cl2=fb(cuv*6.1+vec2(uTime*0.016,-uTime*0.004));" +
              "   float cover=smoothstep(0.52,0.86,cl*0.72+cl2*0.4);" +
              "   float fade=smoothstep(0.02,0.30,d.y)*(1.0-smoothstep(0.55,1.0,d.y)*0.5);" +
              "   c=mix(c,vec3(1.0,1.0,1.0),cover*fade*0.72);" +
              "   c=mix(c,vec3(0.80,0.84,0.92),cover*fade*0.22);" +
              " }" +
              " gl_FragColor=vec4(c,1.0); }",
          });
          skyMesh = new THREE.Mesh(geo, SKY.mat);
          skyMesh.frustumCulled = false;
          scene.add(skyMesh);
        }

        function makeClouds() {
          var g = new THREE.PlaneGeometry(1, 1);
          var mat = new THREE.MeshBasicMaterial({
            map: TEX.cloud,
            transparent: true,
            depthWrite: false,
            fog: false,
          });
          for (var i = 0; i < 34; i++) {
            var m = new THREE.Mesh(g, mat.clone());
            m.material.opacity = rnd(0.24, 0.56);
            m.material.color = col(srnd() < 0.4 ? 0xffffff : 0xf2f6ff);
            var a = rnd(0, Math.PI * 2),
              r = rnd(40, 560);
            m.position.set(Math.cos(a) * r, rnd(140, 280), Math.sin(a) * r);
            m.scale.set(rnd(160, 420), rnd(160, 420), 1);
            m.rotation.x = -Math.PI / 2;
            m.rotation.z = rnd(0, 6.28);
            m.renderOrder = -2;
            m.userData.drift = rnd(0.4, 1.4);
            scene.add(m);
            CLOUDS.push(m);
          }
        }
        var CLOUDS = [];

        /* ============================================================================
   Terrain — vertex-coloured heightfield with a triplanar-ish texture blend.
   ========================================================================== */
        function buildTerrainMesh() {
          var geo = new THREE.PlaneGeometry(CFG.MAP, CFG.MAP, CFG.SEG, CFG.SEG);
          geo.rotateX(-Math.PI / 2);
          var pos = geo.attributes.position,
            count = pos.count;
          var colors = new Float32Array(count * 3);
          var cSand = col(0xdcc98f),
            cGrass = col(0x4d8f36),
            cGrass2 = col(0x74b24e),
            cDirt = col(0x7b6136),
            cRock = col(0x8b8175),
            cRock2 = col(0x655e55),
            cSnow = col(0xeaf1f8);
          var tmp = new THREE.Color();
          for (var i = 0; i < count; i++) {
            var x = pos.getX(i),
              z = pos.getZ(i);
            var y = terrainHeightAt(x, z);
            pos.setY(i, y);
            var nz = fbm(x * 0.06 + 5, z * 0.06 - 2, 2);
            var sl = terrainSlope(x, z);
            if (y < 2.6) tmp.copy(cSand);
            else tmp.copy(cGrass).lerp(cGrass2, nz);
            tmp.lerp(cDirt, smoothstep(0.35, 0.75, sl) * 0.8);
            tmp.lerp(cRock, smoothstep(28, 46, y));
            tmp.lerp(cRock2, smoothstep(0.55, 0.95, sl) * 0.55);
            tmp.lerp(cSnow, smoothstep(64, 86, y));
            var v = 0.9 + nz * 0.2;
            colors[i * 3] = tmp.r * v;
            colors[i * 3 + 1] = tmp.g * v;
            colors[i * 3 + 2] = tmp.b * v;
          }
          geo.setAttribute(
            "color",
            new THREE.Float32BufferAttribute(colors, 3),
          );
          geo.computeVertexNormals();
          var mesh = new THREE.Mesh(geo, MAT.terra);
          mesh.receiveShadow = true;
          scene.add(mesh);
        }
        /* inject multi-texture blending into the standard terrain material */
        function patchTerrainMaterial() {
          MAT.terra.onBeforeCompile = function (shader) {
            shader.uniforms.uGrass = { value: TEX.grass };
            shader.uniforms.uRock = { value: TEX.rock };
            shader.uniforms.uSand = { value: TEX.sand };
            shader.uniforms.uSnow = { value: TEX.snow };
            shader.uniforms.uDirt = { value: TEX.dirt };
            shader.vertexShader =
              "varying vec3 vWPos;\n" +
              shader.vertexShader.replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\n vWPos=(modelMatrix*vec4(position,1.0)).xyz;",
              );
            /* The custom samplers MUST be declared in the shader source. Adding them to
       shader.uniforms only supplies values -- three.js does not emit
       declarations for custom uniforms, so without these lines the fragment
       shader fails to compile ("'uGrass' : undeclared identifier"), the whole
       terrain program is invalid, and the terrain never draws at all. */
            shader.fragmentShader =
              "varying vec3 vWPos;\n" +
              "uniform sampler2D uGrass;\n" +
              "uniform sampler2D uRock;\n" +
              "uniform sampler2D uSand;\n" +
              "uniform sampler2D uSnow;\n" +
              "uniform sampler2D uDirt;\n" +
              /* Triplanar lookup. A flat XZ projection stretches to infinity as a face
         turns vertical, so cliffs and cave walls smeared into streaks that read
         as "no texture". Blending the three axis-aligned projections by the
         squared normal keeps the texel density constant on every face. */
              "vec3 tpTex(sampler2D t, vec3 p, float sc, vec3 nrm){\n" +
              "  vec3 n=abs(nrm); n=n*n; n/=(n.x+n.y+n.z+1e-5);\n" +
              "  vec3 cx=texture2D(t,p.zy*sc).rgb;\n" +
              "  vec3 cy=texture2D(t,p.xz*sc).rgb;\n" +
              "  vec3 cz=texture2D(t,p.xy*sc).rgb;\n" +
              "  return cx*n.x+cy*n.y+cz*n.z;\n" +
              "}\n" +
              shader.fragmentShader.replace(
                "#include <map_fragment>",
                "vec3 wN=normalize(vNormal);\n" +
                  "float slope=1.0-clamp(wN.y,0.0,1.0);\n" +
                  "float hgt=vWPos.y;\n" +
                  "float wRock=smoothstep(0.30,0.68,slope);\n" +
                  "float wSnow=smoothstep(58.0,82.0,hgt)*(1.0-wRock*0.6);\n" +
                  "float wSand=(1.0-smoothstep(2.0,4.4,hgt))*(1.0-wRock);\n" +
                  "float wGrass=clamp(1.0-wRock-wSnow-wSand,0.0,1.0);\n" +
                  /* grass + rock are the two layers that appear on slopes, so they get
           the triplanar treatment; sand/snow/dirt live on flatter ground */
                  "vec3 cg=tpTex(uGrass,vWPos,0.30,wN);\n" +
                  "vec3 cr=tpTex(uRock ,vWPos,0.19,wN);\n" +
                  "vec3 cs=texture2D(uSand,vWPos.xz*0.26).rgb;\n" +
                  "vec3 cw=texture2D(uSnow,vWPos.xz*0.17).rgb;\n" +
                  "vec3 cd=texture2D(uDirt,vWPos.xz*0.52).rgb;\n" +
                  "vec3 tex=cg*wGrass+cr*wRock+cs*wSand+cw*wSnow;\n" +
                  "tex=mix(tex,cd,smoothstep(0.5,0.95,slope)*0.35);\n" +
                  /* Wide flat areas are only ~3m of tile across, so they used to read as
           one untextured slab. A large-scale mottle breaks that up. */
                  "float macro=texture2D(uDirt,vWPos.xz*0.0105).g;\n" +
                  "tex*=0.78+macro*0.44;\n" +
                  "diffuseColor.rgb*=tex*1.62;",
              );
          };
          MAT.terra.needsUpdate = true;
        }
        /* gentle wind sway for instanced foliage */
        function patchFoliageWind(mat, amp) {
          mat.userData.windUniform = null;
          mat.onBeforeCompile = function (shader) {
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uWind = { value: amp };
            mat.userData.windUniform = shader.uniforms;
            shader.vertexShader =
              "uniform float uTime;\nuniform float uWind;\n" +
              shader.vertexShader.replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\n" +
                  "#ifdef USE_INSTANCING\n" +
                  " vec3 iPos=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);\n" +
                  "#else\n" +
                  " vec3 iPos=vec3(0.0);\n" +
                  "#endif\n" +
                  " float ph=uTime*1.55+iPos.x*0.24+iPos.z*0.31;\n" +
                  " float amp2=uWind*max(0.0,transformed.y);\n" +
                  " transformed.x+=sin(ph)*amp2*0.085;\n" +
                  " transformed.z+=cos(ph*0.81+1.3)*amp2*0.062;\n",
              );
          };
          mat.needsUpdate = true;
        }

        /* ============================================================================
   Water — Gerstner-style waves, fresnel, shore foam from the heightmap depth.
   ========================================================================== */
        var WATER = { mat: null, heightTex: null };
        function buildWater() {
          var g = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 140, 140);
          g.rotateX(-Math.PI / 2);
          /* pack terrain height into a 16-bit RG texture so the shader knows the depth */
          var n = HM.n,
            data = new Uint8Array(n * n * 4);
          for (var i = 0; i < n * n; i++) {
            var v = clamp((HM.data[i] + 16) / 132, 0, 1);
            var q = Math.floor(v * 65535);
            data[i * 4] = q >> 8;
            data[i * 4 + 1] = q & 255;
            data[i * 4 + 2] = 0;
            data[i * 4 + 3] = 255;
          }
          var tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.needsUpdate = true;
          WATER.heightTex = tex;

          WATER.mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: true,
            uniforms: {
              uTime: { value: 0 },
              uHeight: { value: tex },
              uMap: { value: CFG.MAP },
              uHalf: { value: CFG.MAP / 2 },
              uSea: { value: CFG.SEA },
              uSun: { value: SKY.sunDir.clone() },
              uShallow: { value: col(0x2fa8c8) },
              uDeep: { value: col(0x0d2f6b) },
              uFoam: { value: col(0xe8f6ff) },
              uFog: { value: col(0xc3dcf2) },
              uCam: { value: new THREE.Vector3() },
            },
            vertexShader:
              "uniform float uTime; varying vec3 vW; varying vec2 vUv2; varying vec3 vN;" +
              "void main(){" +
              " vUv2=uv;" +
              " vec3 p=position;" +
              " float w1=sin(p.x*0.035+uTime*0.85)+sin(p.z*0.041-uTime*0.72);" +
              " float w2=sin((p.x+p.z)*0.017+uTime*0.5)*1.6;" +
              " float w3=sin(p.x*0.11-uTime*1.7)*0.35+cos(p.z*0.13+uTime*1.4)*0.35;" +
              " p.y+=w1*0.34+w2*0.22+w3*0.12;" +
              " float dx=cos(p.x*0.035+uTime*0.85)*0.035+w2*0.0+cos((p.x+p.z)*0.017+uTime*0.5)*1.6*0.017;" +
              " float dz=cos(p.z*0.041-uTime*0.72)*0.041+cos((p.x+p.z)*0.017+uTime*0.5)*1.6*0.017;" +
              " vN=normalize(vec3(-dx*3.4,1.0,-dz*3.4));" +
              " vec4 wp=modelMatrix*vec4(p,1.0); vW=wp.xyz;" +
              " gl_Position=projectionMatrix*viewMatrix*wp; }",
            fragmentShader:
              "uniform float uTime,uMap,uHalf,uSea; uniform sampler2D uHeight; uniform vec3 uSun,uShallow,uDeep,uFoam,uFog,uCam;" +
              "varying vec3 vW; varying vec2 vUv2; varying vec3 vN;" +
              "void main(){" +
              " vec2 huv=clamp((vW.xz+vec2(uHalf))/uMap,0.0,1.0);" +
              " vec4 hs=texture2D(uHeight,huv);" +
              " float hh=(hs.r*255.0*256.0+hs.g*255.0)/65535.0*132.0-16.0;" +
              " float depth=max(0.0,uSea-hh);" +
              " vec3 vd=normalize(uCam-vW);" +
              " vec3 nrm=normalize(mix(vN,vec3(0.0,1.0,0.0),0.42));" +
              " float fres=pow(1.0-clamp(dot(vd,nrm),0.0,1.0),3.0);" +
              " float dFac=clamp(depth/9.0,0.0,1.0);" +
              " vec3 water=mix(uShallow,uDeep,dFac);" +
              " vec3 hdir=normalize(uSun);" +
              " vec3 hf=normalize(hdir+vd);" +
              " float spec=pow(max(dot(nrm,hf),0.0),220.0)*1.5;" +
              " float glit=pow(max(dot(nrm,hdir),0.0),40.0)*0.25;" +
              " vec3 col=water+uSun*spec+vec3(1.0,0.95,0.85)*glit;" +
              " col=mix(col,uFog,fres*0.42);" +
              " float foam=smoothstep(2.2,0.0,depth)*0.9;" +
              " float wob=sin(vW.x*1.4+uTime*2.4)*0.5+sin(vW.z*1.7-uTime*2.1)*0.5;" +
              " foam*=0.62+wob*0.38;" +
              " col=mix(col,uFoam,clamp(foam,0.0,0.85));" +
              " float a=mix(0.72,0.94,dFac);" +
              " a=max(a,foam);" +
              " gl_FragColor=vec4(col,a); }",
          });
          waterMesh = new THREE.Mesh(g, WATER.mat);
          waterMesh.position.y = CFG.SEA;
          waterMesh.frustumCulled = false;
          waterMesh.renderOrder = 1;
          scene.add(waterMesh);
        }

        /* ============================================================================
   World core — renderer, scene, camera, lights, fog.
   ========================================================================== */
        function initWorldCore() {
          renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById("gl"),
            antialias: !IS_MOBILE,
            powerPreference: "high-performance",
            stencil: false,
          });
          var maxDpr = IS_MOBILE ? 1.5 : 2;
          renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, maxDpr),
          );
          renderer.setSize(window.innerWidth, window.innerHeight);
          renderer.outputEncoding = THREE.sRGBEncoding;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.04;
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          renderer.autoClear = true;

          scene = new THREE.Scene();
          scene.fog = new THREE.Fog(col(0xbcd8ee).getHex(), 220, 1000);
          scene.background = col(0x8fc6f2);
          camera = new THREE.PerspectiveCamera(
            SETTINGS.fov,
            window.innerWidth / window.innerHeight,
            0.12,
            3000,
          );
          camera.rotation.order = "YXZ";
          worldGroup = new THREE.Group();
          scene.add(worldGroup);

          makeMaterials();
          makeSky();
          makeClouds();

          sun = new THREE.DirectionalLight(0xfff0d6, 2.5);
          sun.position.copy(SKY.sunDir.clone().multiplyScalar(300));
          sun.castShadow = true;
          var sm = IS_MOBILE ? 1024 : SETTINGS.quality >= 3 ? 3072 : 2048;
          sun.shadow.mapSize.width = sm;
          sun.shadow.mapSize.height = sm;
          var sc = sun.shadow.camera;
          sc.left = -78;
          sc.right = 78;
          sc.top = 78;
          sc.bottom = -78;
          sc.near = 1;
          sc.far = 680;
          sc.updateProjectionMatrix();
          sun.shadow.bias = -0.0005;
          sun.shadow.normalBias = 0.5;
          scene.add(sun);
          scene.add(sun.target);

          hemi = new THREE.HemisphereLight(
            col(0xbcd8ff).getHex(),
            col(0x46502e).getHex(),
            0.9,
          );
          scene.add(hemi);

          bounce = new THREE.DirectionalLight(0x9fc0ff, 0.4);
          bounce.position.set(-140, 90, -160);
          scene.add(bounce);

          POST.init();
          POST.resize(
            Math.floor(window.innerWidth * renderer.getPixelRatio()),
            Math.floor(window.innerHeight * renderer.getPixelRatio()),
          );
          initDecals();
        }



export {
  renderer, scene, camera, sun, hemi, bounce, skyMesh, worldGroup, waterMesh,
  WORLD_SIZE, POST, SKY, CLOUDS, WATER,
  DECALS, initDecals, addDecal, updateDecals,
  makeSky, makeClouds, patchTerrainMaterial, patchFoliageWind,
  buildWater, initWorldCore, buildTerrainMesh
};
