/* ============================================================
   ÆTHER — Birth of a Star
   A scroll-driven journey in four acts:
     galaxy -> collapsing core -> supernova -> a newborn planetary system.
   ~46k GPU particles morph between four shapes in one custom GLSL shader,
   lit by bloom, wrapped in drifting nebulae, and reacting to a
   self-generated ambient drone. Click anywhere to ripple the cosmos.

   Three.js (module) + custom GLSL + EffectComposer/UnrealBloomPass.
   ============================================================ */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ---------- Config ----------
const IS_MOBILE = matchMedia("(max-width: 820px)").matches;
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COUNT = IS_MOBILE ? 24000 : 46000; // scale particles to the device
// screenshot mode: ?shot=<0..1> snaps to a progress, hides UI, disables fly-in
const _SHOT = new URLSearchParams(location.search).get("shot");
const shotMode = _SHOT !== null;
const shotProgress = shotMode ? Math.max(0, Math.min(1, parseFloat(_SHOT) || 0)) : 0;
const _keepUI = new URLSearchParams(location.search).get("ui");
if (shotMode && !_keepUI) document.body.classList.add("photo");

// ---------- Shareable procedural seed: same seed → same universe ----------
function _mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function _hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
const _origRandom = Math.random;
let seedStr = new URLSearchParams(location.search).get("seed");
let seedNum;
if (seedStr) seedNum = _hashStr(seedStr);
else { seedNum = (Math.floor(_origRandom() * 4294967295)) >>> 0; seedStr = seedNum.toString(36); }
Math.random = _mulberry32(seedNum); // every generator below is now deterministic
if (!shotMode) {
  const q = new URLSearchParams(location.search);
  q.set("seed", seedStr);
  history.replaceState(null, "", location.pathname + "?" + q.toString());
}

// Per-act color themes (A = base, B = accent). Cross-faded by scroll.
const THEME_A = ["#59d5ff", "#ffd27f", "#ff7a3c", "#5affd0"].map((c) => new THREE.Color(c));
const THEME_B = ["#a56bff", "#ff6fc7", "#ff3d9a", "#6f8bff"].map((c) => new THREE.Color(c));
const _cA = new THREE.Color();
const _cB = new THREE.Color();

function themeAt(p, out, list) {
  const f = Math.min(0.9999, Math.max(0, p)) * 3; // 4 stops -> 3 segments
  const i = Math.floor(f);
  out.copy(list[i]).lerp(list[Math.min(3, i + 1)], f - i);
  return out;
}

// ---------- Renderer ----------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.6 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x030209, 0.016);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 260);
camera.position.set(0, 3, 18);

// ---------- Geometry: four target shapes packed into attributes ----------
function buildGeometry() {
  const posA = new Float32Array(COUNT * 3); // spiral galaxy
  const posB = new Float32Array(COUNT * 3); // dense core sphere
  const posC = new Float32Array(COUNT * 3); // supernova burst
  const posD = new Float32Array(COUNT * 3); // protoplanetary disk + star
  const scale = new Float32Array(COUNT);
  const rand = new Float32Array(COUNT);

  const ARMS = 5, SPIN = 1.1, GAL_R = 9.0;

  for (let i = 0; i < COUNT; i++) {
    const i3 = i * 3;
    const r = Math.random();

    // --- A: spiral galaxy (thin disk, curved arms) ---
    const radius = Math.pow(r, 0.6) * GAL_R;
    const branch = ((i % ARMS) / ARMS) * Math.PI * 2;
    const spin = radius * SPIN;
    const sc = (Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1)) * (0.35 + radius * 0.06);
    const scY = (Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1)) * (0.25 + radius * 0.02);
    posA[i3]     = Math.cos(branch + spin) * radius + sc;
    posA[i3 + 1] = scY;
    posA[i3 + 2] = Math.sin(branch + spin) * radius + sc;

    // --- B: dense glowing core (sphere shell) ---
    let u = Math.random(), v = Math.random();
    let theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
    const rb = 2.6 + Math.pow(Math.random(), 2.0) * 0.9;
    posB[i3]     = rb * Math.sin(phi) * Math.cos(theta);
    posB[i3 + 1] = rb * Math.sin(phi) * Math.sin(theta);
    posB[i3 + 2] = rb * Math.cos(phi);

    // --- C: supernova (blasted outward on random rays) ---
    u = Math.random(); v = Math.random();
    theta = 2 * Math.PI * u; phi = Math.acos(2 * v - 1);
    const rc = 5.5 + Math.pow(Math.random(), 0.5) * 11.0;
    posC[i3]     = rc * Math.sin(phi) * Math.cos(theta);
    posC[i3 + 1] = rc * Math.sin(phi) * Math.sin(theta);
    posC[i3 + 2] = rc * Math.cos(phi);

    // --- D: newborn system — a small star + a ringed disk with gaps ---
    if (Math.random() < 0.12) {
      // central star
      const rs = Math.pow(Math.random(), 2) * 1.4;
      const st = 2 * Math.PI * Math.random(), sp = Math.acos(2 * Math.random() - 1);
      posD[i3]     = rs * Math.sin(sp) * Math.cos(st);
      posD[i3 + 1] = rs * Math.sin(sp) * Math.sin(st);
      posD[i3 + 2] = rs * Math.cos(sp);
    } else {
      // disk: three concentric rings with dark gaps between them
      const ringPick = Math.random();
      let rd;
      if (ringPick < 0.38) rd = 3.2 + Math.random() * 1.6;
      else if (ringPick < 0.72) rd = 5.6 + Math.random() * 1.8;
      else rd = 8.0 + Math.random() * 2.2;
      const ang = Math.random() * Math.PI * 2;
      const thin = (Math.random() - 0.5) * (0.25 + rd * 0.03);
      posD[i3]     = Math.cos(ang) * rd;
      posD[i3 + 1] = thin;
      posD[i3 + 2] = Math.sin(ang) * rd;
    }

    scale[i] = 0.4 + Math.pow(Math.random(), 2) * 1.8;
    rand[i] = Math.random();
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(posA.slice(), 3)); // base for culling
  g.setAttribute("aPosA", new THREE.BufferAttribute(posA, 3));
  g.setAttribute("aPosB", new THREE.BufferAttribute(posB, 3));
  g.setAttribute("aPosC", new THREE.BufferAttribute(posC, 3));
  g.setAttribute("aPosD", new THREE.BufferAttribute(posD, 3));
  g.setAttribute("aScale", new THREE.BufferAttribute(scale, 1));
  g.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 24);
  return g;
}

const geometry = buildGeometry();

// ---------- Particle shader material ----------
const uniforms = {
  uTime:    { value: 0 },
  uProgress:{ value: 0 },
  uSize:    { value: 22.0 * renderer.getPixelRatio() },
  uAudio:   { value: 0 },
  uBass:    { value: 0 },      // low-frequency energy → particle size pulse
  uTreble:  { value: 0 },      // high-frequency energy → extra twinkle
  uBurst:   { value: 0 },      // click shockwave, decays to 0
  uEnergy:  { value: 0 },      // scroll-velocity turbulence
  uPointer: { value: new THREE.Vector3(0, 0, 0) }, // cursor gravity well
  uPointerStrength: { value: 0 },
  uColorA:  { value: new THREE.Color("#59d5ff") },
  uColorB:  { value: new THREE.Color("#a56bff") },
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uProgress;
    uniform float uSize;
    uniform float uAudio;
    uniform float uBass;
    uniform float uBurst;
    uniform float uEnergy;
    uniform vec3 uPointer;
    uniform float uPointerStrength;

    attribute vec3 aPosA;
    attribute vec3 aPosB;
    attribute vec3 aPosC;
    attribute vec3 aPosD;
    attribute float aScale;
    attribute float aRand;

    varying float vRand;
    varying float vGlow;

    // --- curl noise (divergence-free flow) ---
    float vhash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float vnoise3(vec3 x){
      vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(vhash(i + vec3(0,0,0)), vhash(i + vec3(1,0,0)), f.x),
                     mix(vhash(i + vec3(0,1,0)), vhash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(vhash(i + vec3(0,0,1)), vhash(i + vec3(1,0,1)), f.x),
                     mix(vhash(i + vec3(0,1,1)), vhash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    vec3 nvec(vec3 x){ return vec3(vnoise3(x), vnoise3(x + vec3(31.4,17.7,4.2)), vnoise3(x + vec3(-7.1,23.3,51.7))); }
    vec3 curlNoise(vec3 p){
      const float e = 0.1;
      vec3 dx = vec3(e,0.0,0.0), dy = vec3(0.0,e,0.0), dz = vec3(0.0,0.0,e);
      vec3 px0 = nvec(p - dx), px1 = nvec(p + dx);
      vec3 py0 = nvec(p - dy), py1 = nvec(p + dy);
      vec3 pz0 = nvec(p - dz), pz1 = nvec(p + dz);
      float x = (py1.z - py0.z) - (pz1.y - pz0.y);
      float y = (pz1.x - pz0.x) - (px1.z - px0.z);
      float z = (px1.y - px0.y) - (py1.x - py0.x);
      return vec3(x, y, z) * 4.0;
    }

    // morph across three segments: A -> B -> C -> D
    vec3 morph(float p){
      float seg = p * 3.0;
      if (seg < 1.0) return mix(aPosA, aPosB, smoothstep(0.0, 1.0, seg));
      if (seg < 2.0) return mix(aPosB, aPosC, smoothstep(0.0, 1.0, seg - 1.0));
      return mix(aPosC, aPosD, smoothstep(0.0, 1.0, seg - 2.0));
    }

    void main(){
      vRand = aRand;
      vec3 pos = morph(uProgress);

      // organic drift + audio- & scroll-driven turbulence
      float t = uTime * 0.12;
      float amp = 0.12 + uAudio * 0.55 + uEnergy * 0.6;
      pos.x += sin(t + aRand * 6.2831 + pos.y * 0.4) * amp;
      pos.y += cos(t * 1.1 + aRand * 6.2831 + pos.z * 0.4) * amp;
      pos.z += sin(t * 0.9 + aRand * 6.2831 + pos.x * 0.4) * amp;
      // fluid curl-noise flow layered on top
      pos += curlNoise(pos * 0.12 + vec3(uTime * 0.04)) * (0.14 + uAudio * 0.4 + uEnergy * 0.3);

      // click shockwave: push everything radially outward, then settle
      pos += normalize(pos + 0.0001) * uBurst * (2.6 + aRand * 1.5);

      // cursor gravity: particles near the pointer bend toward it
      vec3 toP = uPointer - pos;
      float pd = dot(toP, toP);
      float infl = uPointerStrength * exp(-pd * 0.05);
      pos += toP * infl;

      // brighter at the ignition (mid-late) and on audio / burst peaks
      float ignite = smoothstep(0.45, 0.66, uProgress) * (1.0 - smoothstep(0.66, 0.85, uProgress));
      vGlow = ignite * 0.7 + uAudio * 0.8 + uBurst * 0.9;

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mv;

      float size = uSize * aScale * (1.0 + uAudio * 1.4 + ignite * 0.6 + uBurst * 1.2 + uBass * 0.9);
      gl_PointSize = size * (1.0 / -mv.z);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uTreble;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    varying float vRand;
    varying float vGlow;

    void main(){
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv);
      if (d > 0.5) discard;
      float alpha = smoothstep(0.5, 0.0, d);
      alpha = pow(alpha, 1.6);

      float twinkle = 0.65 + 0.35 * sin(uTime * 2.2 + vRand * 24.0) + uTreble * 0.5;
      vec3 col = mix(uColorA, uColorB, vRand);
      col += vGlow * vec3(0.95, 0.75, 1.0);
      col *= twinkle;
      gl_FragColor = vec4(col, alpha);
    }
  `,
});

const points = new THREE.Points(geometry, material);
scene.add(points);

// ---------- Drifting nebula clouds (soft additive billboards) ----------
function softTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.35)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const nebulaTex = softTexture();
const nebulas = [];
for (let i = 0; i < 8; i++) {
  const mat = new THREE.SpriteMaterial({
    map: nebulaTex, transparent: true, opacity: 0.14,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  const ang = Math.random() * Math.PI * 2;
  const rad = 8 + Math.random() * 12;
  s.position.set(Math.cos(ang) * rad, (Math.random() - 0.5) * 10, Math.sin(ang) * rad - 4);
  const sz = 14 + Math.random() * 16;
  s.scale.set(sz, sz, 1);
  s.userData.spin = (Math.random() - 0.5) * 0.05;
  s.userData.seed = Math.random() * 10;
  scene.add(s);
  nebulas.push(s);
}

// A faint static starfield far behind, for depth
function makeStarfield() {
  const n = 1600;
  const p = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  // realistic stellar colours by temperature, weighted toward cool stars
  const TEMP = [
    [0.62, 0.71, 1.0], [0.81, 0.87, 1.0], [1.0, 1.0, 1.0],
    [1.0, 0.96, 0.87], [1.0, 0.88, 0.66], [1.0, 0.75, 0.55], [1.0, 0.6, 0.45],
  ];
  const WEIGHT = [0.03, 0.09, 0.16, 0.2, 0.24, 0.18, 0.1];
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const rr = 55 + Math.random() * 70;
    const u = Math.random(), v = Math.random();
    const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
    p[i * 3] = rr * Math.sin(ph) * Math.cos(th);
    p[i * 3 + 1] = rr * Math.sin(ph) * Math.sin(th);
    p[i * 3 + 2] = rr * Math.cos(ph);
    let r = Math.random(), k = 0;
    for (let j = 0; j < WEIGHT.length; j++) { r -= WEIGHT[j]; if (r <= 0) { k = j; break; } }
    const b = 0.55 + Math.random() * 0.6; // brightness variation
    col[i * 3] = TEMP[k][0] * b;
    col[i * 3 + 1] = TEMP[k][1] * b;
    col[i * 3 + 2] = TEMP[k][2] * b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({
    size: 0.16, vertexColors: true, transparent: true, opacity: 0.7,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  return new THREE.Points(g, m);
}
scene.add(makeStarfield());

// ---------- A few bright hero stars with cross-shaped flares ----------
function crossTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 18);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(64, 64, 18, 0, Math.PI * 2); ctx.fill();
  const line = ctx.createLinearGradient(0, 0, 128, 0);
  line.addColorStop(0, "rgba(255,255,255,0)");
  line.addColorStop(0.5, "rgba(255,255,255,0.9)");
  line.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = line;
  ctx.fillRect(0, 62, 128, 4);   // horizontal spike
  ctx.fillRect(62, 0, 4, 128);   // vertical spike
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const heroTex = crossTexture();
const heroStars = [];
for (let i = 0; i < 7; i++) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({
    map: heroTex, color: i % 2 ? 0xffd9c0 : 0xbfe0ff, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const rr = 28 + Math.random() * 40;
  const u = Math.random(), v = Math.random();
  const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
  m.position.set(rr * Math.sin(ph) * Math.cos(th), rr * Math.sin(ph) * Math.sin(th), rr * Math.cos(ph));
  const sz = 2.4 + Math.random() * 2.6;
  m.scale.set(sz, sz, 1);
  m.userData.seed = Math.random() * 10;
  scene.add(m);
  heroStars.push(m);
}

// ---------- Volumetric nebula skysphere (procedural fbm, tinted per act) ----------
const skyUniforms = {
  uTime: { value: 0 },
  uColA: { value: new THREE.Color("#59d5ff") },
  uColB: { value: new THREE.Color("#a56bff") },
};
const skysphere = new THREE.Mesh(
  new THREE.SphereGeometry(140, 48, 48),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColA;
      uniform vec3 uColB;
      varying vec3 vDir;

      float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){
        vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                       mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                       mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.0; a*=0.5; } return v; }

      void main(){
        vec3 p = vDir * 2.4 + vec3(0.0, 0.0, uTime * 0.02);
        float clouds = smoothstep(0.42, 0.95, fbm(p));
        vec3 tint = mix(uColA, uColB, fbm(vDir * 1.6 + 7.0));
        vec3 col = mix(vec3(0.012, 0.008, 0.035), tint, clouds * 0.55);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
skysphere.renderOrder = -10;
scene.add(skysphere);

// ---------- Aurora ribbons — flowing curtains of light in the deep field ----------
function auroraMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color("#59d5ff") }, uOpacity: { value: 0.16 } },
    transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `
      uniform float uTime; varying vec2 vUv;
      void main(){
        vUv = uv; vec3 p = position;
        p.z += sin(p.x * 0.15 + uTime * 0.6) * 3.0 + cos(p.x * 0.07 - uTime * 0.4) * 2.0;
        p.y += sin(p.x * 0.1 + uTime * 0.3) * 1.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
      void main(){
        float band = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
        float flow = 0.55 + 0.45 * sin(vUv.x * 22.0 + uTime * 1.6);
        float a = band * flow * uOpacity;
        gl_FragColor = vec4(uColor * (0.6 + flow * 0.7), a);
      }`,
  });
}
const auroras = [];
for (let i = 0; i < 3; i++) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(70, 16, 90, 1), auroraMaterial());
  mesh.position.set((i - 1) * 8, 4 + i * 3, -26 - i * 6);
  mesh.rotation.z = (i - 1) * 0.12;
  mesh.renderOrder = -5;
  scene.add(mesh);
  auroras.push(mesh);
}

// ---------- Act IV: central star + newborn planets on orbits ----------
const smooth01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

scene.add(new THREE.AmbientLight(0x2a3a5a, 0.7));
const sunLight = new THREE.PointLight(0xffe6bf, 40, 90, 1.5);
scene.add(sunLight);

const systemGroup = new THREE.Group();
scene.add(systemGroup);

// --- procedural planet surface texture (value-noise fbm on a canvas) ---
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm2(x, y) { let s = 0, a = 0.5; for (let i = 0; i < 4; i++) { s += a * vnoise(x, y); x *= 2; y *= 2; a *= 0.5; } return s; }
function planetTexture(cfg) {
  const w = 256, hgt = 128;
  const c = document.createElement("canvas"); c.width = w; c.height = hgt;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, hgt);
  const col = new THREE.Color(cfg.color);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      let n;
      if (cfg.ring) n = 0.5 + 0.5 * Math.sin(y * 0.16 + fbm2(x * 0.012, y * 0.05) * 3.0); // gas-giant bands
      else n = fbm2(x * 0.04, y * 0.04); // rocky terrain
      const l = 0.5 + n * 0.75;
      const o = (y * w + x) * 4;
      img.data[o] = Math.min(255, col.r * 255 * l);
      img.data[o + 1] = Math.min(255, col.g * 255 * l);
      img.data[o + 2] = Math.min(255, col.b * 255 * l);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// grayscale cloud density map
function cloudTexture() {
  const w = 256, hgt = 128;
  const c = document.createElement("canvas"); c.width = w; c.height = hgt;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, hgt);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm2(x * 0.05, y * 0.05);
      const v = Math.max(0, (n - 0.55)) / 0.45; // sparse wisps
      const o = (y * w + x) * 4;
      const g = Math.min(255, v * 255);
      img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}
const CLOUD_TEX = cloudTexture();

// --- planet surface shader: sun-lit day side, city lights on the night side, drifting clouds ---
function planetMaterial(cfg) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: planetTexture(cfg) },
      uClouds: { value: CLOUD_TEX },
      uTime: { value: 0 },
      uNight: { value: cfg.ring ? 0 : 1 },
      uCloud: { value: cfg.ring ? 0 : 1 },
      uNightColor: { value: new THREE.Color(0xffcf8a) },
    },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vWPos;
      void main(){
        vUv = uv;
        vN = mat3(modelMatrix) * normal;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform sampler2D uDay; uniform sampler2D uClouds;
      uniform float uTime; uniform float uNight; uniform float uCloud; uniform vec3 uNightColor;
      varying vec2 vUv; varying vec3 vN; varying vec3 vWPos;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      void main(){
        vec3 L = normalize(-vWPos);           // the sun sits at the origin
        float d = dot(normalize(vN), L);
        float lit = smoothstep(-0.12, 0.28, d);
        vec3 day = texture2D(uDay, vUv).rgb;
        vec3 col = day * (0.1 + lit * 1.15);
        // drifting clouds, lit on the day side
        float cloud = texture2D(uClouds, vec2(vUv.x + uTime * 0.008, vUv.y)).r;
        col += vec3(1.0) * cloud * lit * 0.5 * uCloud;
        // specular sun-glint (bright on ocean/ice, softened by cloud cover)
        vec3 V = normalize(cameraPosition - vWPos);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(normalize(vN), H), 0.0), 48.0) * lit;
        col += vec3(1.0, 0.98, 0.9) * spec * 0.7 * (1.0 - cloud * 0.7);
        // city lights on the dark hemisphere
        float night = 1.0 - lit;
        vec2 g = floor(vUv * 70.0);
        float city = step(0.9, h(g)) * night * uNight;
        col += uNightColor * city * 1.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
// --- fresnel atmosphere / corona shell ---
function atmoMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: `varying vec3 vN; varying vec3 vE;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vE = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vE;
      void main(){ float f = pow(1.0 - max(dot(vN, vE), 0.0), 2.6); gl_FragColor = vec4(uColor, 1.0) * f; }`,
  });
}
// planet atmosphere with sun-aware scattering (cool limb, warm terminator glow)
function planetAtmoMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    vertexShader: `varying vec3 vN; varying vec3 vWPos;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vWPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vWPos;
      void main(){
        vec3 V = normalize(cameraPosition - vWPos);
        vec3 L = normalize(-vWPos);                       // sun sits at the origin
        float f = pow(1.0 - max(dot(vN, V), 0.0), 2.6);   // fresnel rim
        float sf = max(dot(vN, L), 0.0);
        float term = smoothstep(0.0, 0.5, sf) * (1.0 - smoothstep(0.5, 1.0, sf)); // terminator band
        vec3 c = mix(uColor, vec3(1.0, 0.55, 0.3), term * 0.85);
        float lit = smoothstep(-0.2, 0.3, dot(vN, L));
        gl_FragColor = vec4(c, 1.0) * f * (0.28 + lit);
      }`,
  });
}

const sunMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    varying vec3 vPos; varying vec3 vN; varying vec3 vView;
    void main(){
      vPos = position;
      vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uTime; varying vec3 vPos; varying vec3 vN; varying vec3 vView;
    float h(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float n3(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(h(i+vec3(0,0,0)),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
    float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*n3(p); p*=2.0; a*=0.5; } return v; }
    void main(){
      vec3 sp = normalize(vPos);
      float gran = fbm(sp * 6.0 + vec3(uTime * 0.15));           // granulation cells
      float veins = fbm(sp * 14.0 - vec3(uTime * 0.25));         // finer plasma
      float f = gran * 0.7 + veins * 0.3;
      vec3 hot = mix(vec3(1.0, 0.32, 0.05), vec3(1.0, 0.8, 0.35), f);
      hot = mix(hot, vec3(1.0, 0.97, 0.88), smoothstep(0.62, 0.95, f));
      float limb = pow(max(dot(vN, vView), 0.0), 0.42);          // limb darkening
      vec3 col = hot * (0.55 + 0.7 * f) * (0.5 + 0.6 * limb) * 1.5; // HDR for bloom
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const sun = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 6), sunMat);
systemGroup.add(sun);
const sunCorona = new THREE.Mesh(
  new THREE.SphereGeometry(1.9, 32, 32),
  atmoMaterial(new THREE.Color(0xffd9a0))
);
systemGroup.add(sunCorona);
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: nebulaTex, color: 0xffd08a, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
sunGlow.scale.set(8, 8, 1);
systemGroup.add(sunGlow);

const PLANETS = [
  { r: 3.6, size: 0.30, speed: 0.55, color: 0x8fb3ff, ring: false },
  { r: 5.1, size: 0.22, speed: 0.42, color: 0xd8b0ff, ring: false },
  { r: 6.4, size: 0.46, speed: 0.30, color: 0xff9f6b, ring: true },
  { r: 9.0, size: 0.36, speed: 0.20, color: 0x7ef0d0, ring: false },
];
const clickable = []; // meshes the raycaster tests for planet clicks
const planets = PLANETS.map((cfg, idx) => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(cfg.size, 40, 28), planetMaterial(cfg));
  mesh.userData.planetIndex = idx;
  group.add(mesh);
  // fresnel atmosphere (also part of the click target)
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(cfg.size * 1.34, 32, 22),
    planetAtmoMaterial(new THREE.Color(cfg.color).lerp(new THREE.Color(0x9ec8ff), 0.6))
  );
  atmo.userData.planetIndex = idx;
  group.add(atmo);
  clickable.push(mesh, atmo);
  if (cfg.ring) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(cfg.size * 1.6, cfg.size * 2.6, 64),
      new THREE.MeshBasicMaterial({ color: 0xffd9a8, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
    );
    ring.rotation.x = Math.PI / 2.3;
    group.add(ring);
  }
  // faint orbit trail
  const pts = [];
  for (let a = 0; a <= 72; a++) {
    const ang = (a / 72) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(ang) * cfg.r, 0, Math.sin(ang) * cfg.r));
  }
  const trail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x6f8bff, transparent: true, opacity: 0 })
  );
  systemGroup.add(trail);
  systemGroup.add(group);
  return { group, mesh, trail, cfg, phase: Math.random() * Math.PI * 2 };
});

// a small moon orbiting the outer planet
const moonPivot = new THREE.Group();
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(0.08, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xc8cdd8, roughness: 1.0 })
);
moon.position.set(0.75, 0, 0);
moonPivot.add(moon);
planets[3].group.add(moonPivot);
planets[3].moonPivot = moonPivot;

// asteroid belt between the gas giant and the outer planet
const AST_N = 900;
const astPos = new Float32Array(AST_N * 3);
for (let i = 0; i < AST_N; i++) {
  const rr = 7.3 + Math.random() * 0.9;
  const ang = Math.random() * Math.PI * 2;
  astPos[i * 3] = Math.cos(ang) * rr;
  astPos[i * 3 + 1] = (Math.random() - 0.5) * 0.35;
  astPos[i * 3 + 2] = Math.sin(ang) * rr;
}
const asteroidBelt = new THREE.Points(
  new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(astPos, 3)),
  new THREE.PointsMaterial({ size: 0.06, color: 0x9fa6b8, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true })
);
systemGroup.add(asteroidBelt);

// ---------- Occasional shooting stars ----------
const comets = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({
    map: nebulaTex, color: 0xbfe0ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(m);
  comets.push({
    m, startAt: 2 + Math.random() * 8, dur: 1.3,
    from: new THREE.Vector3(), to: new THREE.Vector3(),
  });
}
function launchComet(c) {
  const y = 6 + Math.random() * 14;
  const side = Math.random() < 0.5 ? -1 : 1;
  c.from.set(-side * (24 + Math.random() * 10), y, -18 - Math.random() * 20);
  c.to.set(side * (24 + Math.random() * 10), y - 8 - Math.random() * 6, c.from.z + 6);
}
comets.forEach(launchComet);

// ---------- Anamorphic lens flare on the star (ignition + Act IV) ----------
function streakTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 16;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0.0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, "rgba(255,255,255,1)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const flareStreak = new THREE.Sprite(new THREE.SpriteMaterial({
  map: streakTexture(), color: 0x9fd4ff, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
flareStreak.scale.set(46, 1.2, 1);
scene.add(flareStreak);
const flareCore = new THREE.Sprite(new THREE.SpriteMaterial({
  map: nebulaTex, color: 0xfff0d0, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
flareCore.scale.set(7, 7, 1);
scene.add(flareCore);

// radial god-ray burst behind the star
function sunburstTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  ctx.translate(128, 128);
  const spikes = 18;
  for (let i = 0; i < spikes; i++) {
    ctx.rotate((Math.PI * 2) / spikes);
    const g = ctx.createLinearGradient(0, 0, 0, -128);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-2.5, 0); ctx.lineTo(0, -128); ctx.lineTo(2.5, 0);
    ctx.closePath(); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const godrays = new THREE.Sprite(new THREE.SpriteMaterial({
  map: sunburstTexture(), color: 0xffe6bf, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
godrays.scale.set(22, 22, 1);
scene.add(godrays);

// ---------- Warp streaks — radial speed lines that flash at the supernova ----------
function warpTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  ctx.translate(256, 256);
  const spikes = 90;
  for (let i = 0; i < spikes; i++) {
    ctx.rotate((Math.PI * 2) / spikes + (vnoise(i, 3.1) - 0.5) * 0.05);
    const g = ctx.createLinearGradient(0, -256, 0, -110);
    g.addColorStop(0, "rgba(255,255,255,0.65)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-0.9, -256, 1.8, 150);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const warp = new THREE.Sprite(new THREE.SpriteMaterial({
  map: warpTexture(), color: 0xcfe6ff, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
}));
warp.position.set(0, 0, -3);
warp.scale.set(9, 9, 1);
camera.add(warp);
scene.add(camera); // so camera-attached children render

// ---------- Meteor burst that sprays from the cursor on click ----------
const meteorPool = [];
for (let i = 0; i < 26; i++) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({
    map: nebulaTex, color: i % 3 ? 0xbfe6ff : 0xffd9b0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.scale.set(0.001, 0.001, 1);
  scene.add(m);
  meteorPool.push({ m, vel: new THREE.Vector3(), life: 0 });
}
function burstMeteors(origin) {
  for (const mp of meteorPool) {
    mp.life = 1;
    mp.m.position.copy(origin);
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    const sp = 1.5 + Math.random() * 2.8;
    mp.vel.set(Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)).multiplyScalar(sp);
  }
}

// ---------- Interactive constellations that draw themselves near the cursor ----------
const CONST_N = 150;
const constPos = [];
for (let i = 0; i < CONST_N; i++) {
  const rr = 16 + Math.random() * 30;
  const u = Math.random(), v = Math.random();
  const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
  constPos.push(new THREE.Vector3(rr * Math.sin(ph) * Math.cos(th), rr * Math.sin(ph) * Math.sin(th), rr * Math.cos(ph)));
}
const cStars = new THREE.Points(
  new THREE.BufferGeometry().setFromPoints(constPos),
  new THREE.PointsMaterial({ size: 0.45, color: 0xbfe0ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })
);
scene.add(cStars);

const MAX_SEG = 240;
const lineArr = new Float32Array(MAX_SEG * 2 * 3);
const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute("position", new THREE.BufferAttribute(lineArr, 3));
lineGeo.setDrawRange(0, 0);
const constLines = new THREE.LineSegments(
  lineGeo,
  new THREE.LineBasicMaterial({ color: 0x8be9ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
);
scene.add(constLines);

const _proj = new THREE.Vector3();
function updateConstellations() {
  const active = [];
  for (const p of constPos) {
    _proj.copy(p).project(camera);
    if (_proj.z > 1) continue;
    const d = Math.hypot(_proj.x - mouse.x, _proj.y - mouse.y);
    if (d < 0.34) active.push({ p, x: _proj.x, y: _proj.y });
  }
  let seg = 0;
  for (let i = 0; i < active.length && seg < MAX_SEG; i++) {
    for (let j = i + 1; j < active.length && seg < MAX_SEG; j++) {
      if (Math.hypot(active[i].x - active[j].x, active[i].y - active[j].y) < 0.17) {
        const o = seg * 6, a = active[i].p, b = active[j].p;
        lineArr[o] = a.x; lineArr[o + 1] = a.y; lineArr[o + 2] = a.z;
        lineArr[o + 3] = b.x; lineArr[o + 4] = b.y; lineArr[o + 5] = b.z;
        seg++;
      }
    }
  }
  lineGeo.setDrawRange(0, seg * 2);
  lineGeo.attributes.position.needsUpdate = true;
  const target = seg > 0 ? 0.5 : 0;
  constLines.material.opacity += (target - constLines.material.opacity) * 0.12;
}

// ---------- Post-processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// motion-blur trails during the supernova / fast scroll (damp driven in the loop)
const afterimagePass = new AfterimagePass(0.0);
composer.addPass(afterimagePass);
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.95, 0.65, 0.0 // strength, radius, threshold
);
composer.addPass(bloom);

// Chromatic aberration — subtle RGB split that flares on ignition & clicks
const RGBShiftShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.0012 }, uAngle: { value: 0.0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uAngle;
    varying vec2 vUv;
    void main(){
      vec2 off = uAmount * vec2(cos(uAngle), sin(uAngle));
      vec4 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      c.a = 1.0;
      gl_FragColor = c;
    }
  `,
};
// Volumetric light scattering — screen-space god rays radiating from the star
const GodRayShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uIntensity: { value: 0.0 },
    uDecay: { value: 0.945 },
    uWeight: { value: 0.5 },
    uDensity: { value: 0.9 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uIntensity, uDecay, uWeight, uDensity;
    varying vec2 vUv;
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 delta = (vUv - uSun) * (uDensity / 48.0);
      vec2 coord = vUv;
      float illum = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 48; i++){
        coord -= delta;
        vec3 s = texture2D(tDiffuse, coord).rgb;
        s *= smoothstep(0.35, 1.0, dot(s, vec3(0.333))); // only bright regions cast rays
        acc += s * illum;
        illum *= uDecay;
      }
      gl_FragColor = vec4(base + acc * uWeight * uIntensity, 1.0);
    }
  `,
};
const godRayPass = new ShaderPass(GodRayShader);
composer.addPass(godRayPass);

// Gravitational lensing — light bends radially around the star's mass
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0.0 },
    uAspect: { value: 1.0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uStrength;
    uniform float uAspect;
    varying vec2 vUv;
    void main(){
      vec2 d = vUv - uSun;
      d.x *= uAspect;
      float r = length(d);
      float bend = uStrength / (r + 0.05);   // deflection grows near the mass
      vec2 dir = d / max(r, 1e-4);
      vec2 off = dir * bend;
      off.x /= uAspect;
      gl_FragColor = texture2D(tDiffuse, vUv - off);
    }
  `,
};
const lensPass = new ShaderPass(LensShader);
composer.addPass(lensPass);

const rgbPass = new ShaderPass(RGBShiftShader);
composer.addPass(rgbPass);
composer.addPass(new OutputPass());

// Filmic color grade — S-curve contrast, split-tone (cool shadows / warm highlights), saturation
const ColorGradeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);                 // gentle S-curve contrast
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 shadow = vec3(0.86, 0.95, 1.10);                      // cool shadows
      vec3 high   = vec3(1.07, 1.00, 0.90);                      // warm highlights
      c *= mix(shadow, high, smoothstep(0.12, 0.85, l));
      c = mix(vec3(l), c, 1.12);                                 // subtle saturation lift
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};
const gradePass = new ShaderPass(ColorGradeShader);
composer.addPass(gradePass);

// Cinematic shallow depth-of-field — blurs everything away from the focus point
const FocusBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFocus: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0.0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uFocus; uniform float uStrength; uniform vec2 uRes;
    varying vec2 vUv;
    void main(){
      if (uStrength < 0.01){ gl_FragColor = texture2D(tDiffuse, vUv); return; }
      float d = distance(vUv, uFocus);
      float blur = smoothstep(0.04, 0.45, d) * uStrength;
      vec2 px = (blur * 16.0) / uRes;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float total = 1.0;
      for (int i = 0; i < 16; i++){
        float a = float(i) * 2.3999632;          // golden-angle spiral
        float r = sqrt((float(i) + 0.5) / 16.0);
        vec2 o = vec2(cos(a), sin(a)) * r * px;
        col += texture2D(tDiffuse, vUv + o).rgb;
        total += 1.0;
      }
      gl_FragColor = vec4(col / total, 1.0);
    }
  `,
};
const focusBlurPass = new ShaderPass(FocusBlurShader);
composer.addPass(focusBlurPass);
const _sunProj = new THREE.Vector3();
const _focusScreen = new THREE.Vector3();

// ---------- Adaptive quality: step down if the frame rate drops ----------
let baseBloom = 0.82;
let qLevel = 0;
function applyQuality(level) {
  if (level >= 1) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.3));
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    uniforms.uSize.value = 22.0 * renderer.getPixelRatio();
  }
  if (level >= 2) {
    rgbPass.enabled = false;
    godRayPass.enabled = false;
    focusBlurPass.enabled = false;
    baseBloom = 0.72;
  }
}

// ---------- Interaction state ----------
let targetProgress = 0, progress = 0;
const mouse = new THREE.Vector2(0, 0);
const mouseTarget = new THREE.Vector2(0, 0);
let burst = 0;
let energy = 0, energyTarget = 0, lastScrollY = 0;
let hoveredPlanet = -1;
let focusTarget = 0, focusT = 0; // camera focus on a clicked planet
let ringT = 0;                   // click shockwave ring
const _ray = new THREE.Vector3(), _n = new THREE.Vector3();
const _camTmp = new THREE.Vector3(), _lookTmp = new THREE.Vector3();
const _approach = new THREE.Vector3(), _off = new THREE.Vector3();
const _focusPos = new THREE.Vector3(), _fCam = new THREE.Vector3(), _ringPos = new THREE.Vector3();

const scrollHint = document.getElementById("scrollHint");

function computeScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  targetProgress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}
window.addEventListener("scroll", () => {
  computeScroll();
  const y = window.scrollY;
  energyTarget = Math.min(1, Math.abs(y - lastScrollY) / 70); // fast scroll = more energy
  lastScrollY = y;
  if (y > 40) scrollHint.classList.add("hidden");
}, { passive: true });

const aura = document.getElementById("aura");
window.addEventListener("pointermove", (e) => {
  mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseTarget.y = -((e.clientY / window.innerHeight) * 2 - 1);
  if (e.pointerType === "touch") { aura.style.opacity = "0"; return; }
  aura.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  aura.style.opacity = "1";
  // hover a planet in Act IV → pointer cursor + label + ring
  if (systemGroup.visible) {
    hoveredPlanet = pickPlanet(e);
    document.body.style.cursor = hoveredPlanet >= 0 ? "pointer" : "default";
  } else if (hoveredPlanet !== -1) {
    hoveredPlanet = -1;
    document.body.style.cursor = "default";
  }
});

// Mobile: tilt the phone to parallax the cosmos
if (IS_MOBILE) {
  window.addEventListener("deviceorientation", (e) => {
    if (piloting) return; // in-game: touch-drag steers, tilt must not fight it
    if (e.gamma == null || e.beta == null) return;
    mouseTarget.x = Math.max(-1, Math.min(1, e.gamma / 35));
    mouseTarget.y = Math.max(-1, Math.min(1, (e.beta - 45) / 35));
  });
  // iOS needs a user gesture to grant motion access
  window.addEventListener("pointerdown", () => {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === "function") D.requestPermission().catch(() => {});
  }, { once: true });
}

// Click / tap anywhere (except HUD & buttons) triggers a shockwave
window.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".hud, button, a")) return;
  if (piloting) { boostMouse = true; return; } // hold to boost in the game
  // in Act IV, a click on a planet opens its info card instead of rippling
  if (systemGroup.visible) {
    const pi = pickPlanet(e);
    if (pi >= 0) { showPlanetCard(pi); return; }
  }
  hidePlanetCard();
  burst = 1;
  playChime();
  burstMeteors(uniforms.uPointer.value);
  ringT = 1;
  _ringPos.copy(uniforms.uPointer.value);
});

// ---------- Narrative overlay ----------
const chapters = [...document.querySelectorAll(".chapter")].map((el) => ({
  el, center: parseFloat(el.dataset.center),
}));
const progressFill = document.getElementById("progressFill");

function updateOverlay(p) {
  for (const c of chapters) {
    const dist = Math.abs(p - c.center);
    const op = Math.max(0, 1 - Math.pow(dist / 0.11, 2));
    c.el.style.opacity = op.toFixed(3);
    c.el.style.transform = `translateY(${(1 - op) * 26}px)`;
  }
  progressFill.style.width = (p * 100).toFixed(1) + "%";
}

// ---------- Camera choreography (keyframes lerped by progress) ----------
const CAM_KEYS = [
  { p: 0.00, dist: 18, y: 3.0 },
  { p: 0.33, dist: 8.5, y: 1.4 },  // dive into the collapsing core
  { p: 0.55, dist: 12.0, y: 2.2 },
  { p: 0.667, dist: 17.5, y: 3.6 }, // pull back for the supernova
  { p: 0.86, dist: 11.0, y: 6.2 },  // rise to look down on the disk
  { p: 1.00, dist: 12.0, y: 7.2 },
];
function cameraFrame(p) {
  let a = CAM_KEYS[0], b = CAM_KEYS[CAM_KEYS.length - 1];
  for (let i = 0; i < CAM_KEYS.length - 1; i++) {
    if (p >= CAM_KEYS[i].p && p <= CAM_KEYS[i + 1].p) { a = CAM_KEYS[i]; b = CAM_KEYS[i + 1]; break; }
  }
  const span = b.p - a.p || 1;
  let t = (p - a.p) / span;
  t = t * t * (3 - 2 * t); // smoothstep
  return { dist: a.dist + (b.dist - a.dist) * t, y: a.y + (b.y - a.y) * t };
}

// ---------- Ambient audio (self-generated, reactive) + click chimes ----------
let audioCtx = null, analyser = null, audioData = null, audioOn = false, masterGain = null, ambientBuilt = false;
let melodyGain = null, schedTimer = null, nextNoteTime = 0, noteIdx = 4;
const audioBtn = document.getElementById("audioBtn");
const PENT = [523.25, 587.33, 659.25, 783.99, 880.0]; // C-major pentatonic (click chimes)
// A-minor pentatonic across two octaves (procedural melody)
const SCALE = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];

function ensureCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function buildAmbient() {
  ensureCtx();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.0;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 520;
  filter.Q.value = 6;

  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.frequency.value = 0.06;
  lfoGain.gain.value = 320;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();

  const freqs = [55, 82.4, 110, 164.8, 220];
  freqs.forEach((f, i) => {
    const o = audioCtx.createOscillator();
    o.type = i % 2 ? "sawtooth" : "sine";
    o.frequency.value = f;
    o.detune.value = Math.sin(i * 12.9) * 8;
    const g = audioCtx.createGain();
    g.gain.value = 0.12 / (i + 1);
    o.connect(g).connect(filter);
    o.start();
  });

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  audioData = new Uint8Array(analyser.frequencyBinCount);

  filter.connect(masterGain);
  masterGain.connect(analyser);
  masterGain.connect(audioCtx.destination);

  // melody bus with a feedback delay (echo) for space
  melodyGain = audioCtx.createGain();
  melodyGain.gain.value = 0.5;
  const delay = audioCtx.createDelay();
  delay.delayTime.value = 0.38;
  const fb = audioCtx.createGain();
  fb.gain.value = 0.34;
  delay.connect(fb).connect(delay);
  melodyGain.connect(delay).connect(masterGain);
  melodyGain.connect(masterGain); // dry path
  ambientBuilt = true;
}

// one soft melodic voice
function playNote(freq, time) {
  const o = audioCtx.createOscillator();
  o.type = "triangle";
  o.frequency.value = freq;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(0.13, time + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.7);
  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 1900;
  o.connect(g).connect(lp).connect(melodyGain);
  o.start(time); o.stop(time + 0.8);
}

// lookahead scheduler: a wandering pentatonic melody that quickens with progress
function scheduler() {
  while (nextNoteTime < audioCtx.currentTime + 0.1) {
    noteIdx += Math.floor(Math.random() * 3) - 1 + (Math.random() < 0.18 ? 2 : 0);
    noteIdx = Math.max(0, Math.min(SCALE.length - 1, noteIdx));
    if (Math.random() < 0.82) playNote(SCALE[noteIdx], nextNoteTime);
    nextNoteTime += Math.max(0.24, 0.5 - progress * 0.16);
  }
}

// short bell on click — independent of the ambient toggle
function playChime() {
  ensureCtx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  const now = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  o.type = "sine";
  o.frequency.value = PENT[Math.floor(Math.random() * PENT.length)];
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
  o.connect(g).connect(audioCtx.destination);
  o.start(now);
  o.stop(now + 1.3);
}

// dramatic rising whoosh + low boom at the moment of ignition
function playSwell() {
  if (!audioCtx || audioCtx.state !== "running") return;
  const now = audioCtx.currentTime, dur = 2.2;
  const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const bp = audioCtx.createBiquadFilter();
  bp.type = "bandpass"; bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(300, now);
  bp.frequency.exponentialRampToValueAtTime(4200, now + 1.4);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.2, now + 1.2);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(bp).connect(g).connect(audioCtx.destination);
  src.start(now); src.stop(now + dur);
  // sub-bass boom on the peak
  const o = audioCtx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(120, now + 1.0);
  o.frequency.exponentialRampToValueAtTime(40, now + 2.0);
  const og = audioCtx.createGain();
  og.gain.setValueAtTime(0.0001, now + 1.0);
  og.gain.exponentialRampToValueAtTime(0.28, now + 1.15);
  og.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
  o.connect(og).connect(audioCtx.destination);
  o.start(now + 1.0); o.stop(now + 2.5);
}

audioBtn.addEventListener("click", async () => {
  if (!ambientBuilt) buildAmbient();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  audioOn = !audioOn;
  audioBtn.setAttribute("aria-pressed", String(audioOn));
  masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
  masterGain.gain.linearRampToValueAtTime(audioOn ? 0.5 : 0.0, audioCtx.currentTime + 1.2);
  // run the melody scheduler only while sound is on
  if (audioOn) {
    nextNoteTime = audioCtx.currentTime + 0.15;
    if (!schedTimer) schedTimer = setInterval(scheduler, 25);
  } else if (schedTimer) {
    clearInterval(schedTimer); schedTimer = null;
  }
});

// split the spectrum into bass / mid / treble bands
const _bands = [0, 0, 0];
function sampleBands() {
  if (!(audioOn && analyser)) { _bands[0] = _bands[1] = _bands[2] = 0; return _bands; }
  analyser.getByteFrequencyData(audioData);
  const n = audioData.length;
  const b1 = Math.floor(n * 0.1), b2 = Math.floor(n * 0.4);
  let b = 0, m = 0, tr = 0;
  for (let i = 0; i < b1; i++) b += audioData[i];
  for (let i = b1; i < b2; i++) m += audioData[i];
  for (let i = b2; i < n; i++) tr += audioData[i];
  _bands[0] = b / (b1 * 255);
  _bands[1] = m / ((b2 - b1) * 255);
  _bands[2] = tr / ((n - b2) * 255);
  return _bands;
}

// ---------- Replay ----------
document.getElementById("replayBtn").addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- Seed controls: new universe / copy shareable link ----------
const toastEl = document.getElementById("toast");
let _toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}
document.getElementById("seedText").textContent = seedStr;
document.getElementById("seedNew").addEventListener("click", () => {
  const s = (Math.floor(Math.random() * 4294967295) >>> 0).toString(36);
  location.href = location.pathname + "?seed=" + s;
});
document.getElementById("seedCopy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); showToast("Link copied — share your universe"); }
  catch { showToast(seedStr); }
});

// ---------- Auto-tour (great for recording the demo video) ----------
const tourBtn = document.getElementById("tourBtn");
const tourLabel = tourBtn.querySelector(".audio-btn__label");
let tour = false, tourStart = 0;
const TOUR_SECS = 42;

function setTour(on) {
  tour = on;
  tourBtn.setAttribute("aria-pressed", String(on));
  tourLabel.textContent = on ? "❚❚ stop" : "▶ tour";
  if (on) {
    window.scrollTo(0, 0);
    tourStart = clock.getElapsedTime();
    scrollHint.classList.add("hidden");
  }
}
tourBtn.addEventListener("click", () => setTour(!tour));
// any manual wheel scroll cancels the tour
window.addEventListener("wheel", () => { if (tour) setTour(false); }, { passive: true });

// ---------- Keyboard: jump between acts, plus photo mode ----------
const centers = chapters.map((c) => c.center).sort((a, b) => a - b);
function scrollToFraction(f) {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo({ top: f * max, behavior: "smooth" });
}

// clickable chapter dots on the right edge
const actNav = document.getElementById("actNav");
const navDots = chapters.map((c) => {
  const b = document.createElement("button");
  b.className = "act-dot";
  b.setAttribute("aria-label", "Go to chapter");
  b.addEventListener("click", () => scrollToFraction(c.center));
  actNav.appendChild(b);
  return { b, center: c.center };
});

window.addEventListener("keydown", (e) => {
  if (piloting) return; // in-game keys are handled by the pilot listener
  if (e.key === "h" || e.key === "H") {
    document.body.classList.toggle("photo"); // hide UI for clean screenshots
    return;
  }
  const nav = ["ArrowDown", "PageDown", " ", "ArrowUp", "PageUp", "Home", "End"];
  if (!nav.includes(e.key)) return;
  if (tour) setTour(false);
  e.preventDefault();
  let target = progress;
  if (e.key === "Home") target = 0;
  else if (e.key === "End") target = 1;
  else if (e.key === "ArrowUp" || e.key === "PageUp") {
    for (let i = centers.length - 1; i >= 0; i--) if (centers[i] < progress - 0.02) { target = centers[i]; break; }
  } else {
    for (let i = 0; i < centers.length; i++) if (centers[i] > progress + 0.02) { target = centers[i]; break; }
  }
  scrollToFraction(target);
});

// ---------- Act indicator ----------
const actLabel = document.getElementById("actLabel");
const ACTS = [[0, "I · dust"], [0.3, "II · collapse"], [0.55, "III · ignition"], [0.78, "IV · new world"]];
let currentAct = "";
function updateAct(p) {
  let name = ACTS[0][1];
  for (const [th, n] of ACTS) if (p >= th) name = n;
  if (name !== currentAct) { currentAct = name; actLabel.textContent = name; }
}

// ---------- Planet info cards (click a planet in Act IV) ----------
const PLANET_INFO = [
  { name: "Aeria", type: "Ocean World", color: "#8fb3ff", facts: [
    "A warm ocean covers 91% of its surface — at night you can see the lights of floating cities from orbit.",
    "A single day lasts just 7 hours, so its sunrises and sunsets are forever chasing one another.",
    "Aeria's clouds glow faintly from bioluminescent plankton carried aloft by the wind.",
  ] },
  { name: "Vell", type: "Dwarf Planet", color: "#d8b0ff", facts: [
    "The smallest world in the system — gravity is so weak that a single jump carries you several meters.",
    "Its violet hue comes from manganese-rich dust that blankets the entire surface.",
    "Vell has no atmosphere, so its sky is always black and full of stars — even at noon.",
  ] },
  { name: "Cyclon", type: "Gas Giant", color: "#ff9f6b", facts: [
    "Its rings are billions of shards of ice — unrolled, they would circle the whole star.",
    "Its cloud bands race in opposite directions at over 1,500 km/h.",
    "The storm at its equator is larger than all of Aeria, and has raged for thousands of years.",
  ] },
  { name: "Thalia", type: "Moonlit World", color: "#7ef0d0", facts: [
    "Its lone moon pulls tides so vast they lay bare the ocean floor once every day.",
    "The green glow comes from forests that keep breathing even in the dead of night.",
    "The youngest world in the system — born from the ashes of the supernova you just witnessed.",
  ] },
];
const planetCard = document.getElementById("planetCard");
const pcType = document.getElementById("pcType");
const pcName = document.getElementById("pcName");
const pcFact = document.getElementById("pcFact");
const planetLabel = document.getElementById("planetLabel");
const raycaster = new THREE.Raycaster();
const _clickNDC = new THREE.Vector2();
const _projV = new THREE.Vector3();
let selectedPlanet = -1, factIndex = 0;

// billboarded ring that highlights the hovered planet
const selRing = new THREE.Mesh(
  new THREE.RingGeometry(1.35, 1.5, 48),
  new THREE.MeshBasicMaterial({ color: 0x8be9ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
);
scene.add(selRing);

function pickPlanet(e) {
  _clickNDC.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
  raycaster.setFromCamera(_clickNDC, camera);
  const hits = raycaster.intersectObjects(clickable, false);
  return hits.length ? hits[0].object.userData.planetIndex : -1;
}
function showPlanetCard(i) {
  const info = PLANET_INFO[i];
  if (i === selectedPlanet) factIndex = (factIndex + 1) % info.facts.length;
  else { selectedPlanet = i; factIndex = 0; }
  pcType.textContent = info.type;
  pcName.textContent = info.name;
  pcFact.textContent = info.facts[factIndex];
  planetCard.style.setProperty("--pc-accent", info.color);
  planetCard.style.setProperty("--pc-glow", info.color + "44");
  planetCard.classList.add("visible");
  planets[i].highlight = 1;
  focusTarget = 1; // ease the camera toward this planet
}
function hidePlanetCard() {
  planetCard.classList.remove("visible");
  selectedPlanet = -1;
  focusTarget = 0;
}

// expanding shockwave ring shown on empty-space clicks
const clickRing = new THREE.Mesh(
  new THREE.RingGeometry(0.9, 1.0, 64),
  new THREE.MeshBasicMaterial({ color: 0x8be9ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
);
scene.add(clickRing);

// ---------- PILOT MODE (arcade flight through the eras) ----------
const PILOT_Z0 = 12;
let piloting = false, pilotProgress = 0, shield = 100, stardust = 0;
let shipX = 0, shipY = 0, pilotShake = 0;
let boostMouse = false, boostKey = false, combo = 1, highScore = 0;
let magnetT = 0, slowT = 0, pilotDist = 0; // power-up timers (s) + distance folded (ly)
const pilotKeys = {};
try { highScore = parseInt(localStorage.getItem("aether_best") || "0", 10) || 0; } catch (e) {}
const hazards = [];
const hazardGroup = new THREE.Group();
hazardGroup.visible = false;
scene.add(hazardGroup);
const _rockGeo = new THREE.IcosahedronGeometry(0.55, 0);
// molten debris material for the ignition era (glows under bloom)
const _fireMat = new THREE.MeshStandardMaterial({ color: 0xff7b3a, roughness: 0.6, emissive: 0xff3a10, emissiveIntensity: 2.4 });
for (let i = 0; i < 24; i++) {
  const isOrb = i % 3 === 0;
  let mesh;
  if (isOrb) {
    mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: nebulaTex, color: 0x8ff0ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.scale.set(1.5, 1.5, 1);
  } else {
    mesh = new THREE.Mesh(_rockGeo, new THREE.MeshStandardMaterial({ color: 0x9a9384, roughness: 1.0, emissive: 0x241f17 }));
  }
  hazardGroup.add(mesh);
  hazards.push({ mesh, isOrb, baseMat: mesh.material, x: 0, y: 0, z: 0, prevZ: 0, scored: false, fire: false, drift: 0, rot: new THREE.Vector3(Math.random() * 2, Math.random() * 2, 0), size: 0.7 + Math.random() * 1.3 });
}
// power-ups: rare pickups with temporary effects
const POWERUPS = [
  { key: "repair", color: 0x7dffa6, label: "HULL +35" },
  { key: "magnet", color: 0x8be9ff, label: "MAGNET" },
  { key: "slow",   color: 0xc9a6ff, label: "TIME DILATION" },
];
const powerups = [];
for (let i = 0; i < POWERUPS.length; i++) {
  const p = POWERUPS[i];
  const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: nebulaTex, color: p.color, transparent: true, opacity: 0.98, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.scale.set(2.1, 2.1, 1);
  mesh.visible = false;
  hazardGroup.add(mesh);
  powerups.push({ mesh, key: p.key, color: p.color, label: p.label, x: 0, y: 0, z: 0, prevZ: 0, active: false, scored: false, cooldown: 6 + i * 4 });
}
function resetHazard(h) {
  h.x = (Math.random() * 2 - 1) * 7.5;
  h.y = (Math.random() * 2 - 1) * 5.2;
  h.z = PILOT_Z0 - (36 + Math.random() * 44);
  h.prevZ = h.z;
  h.scored = false;
  h.fire = false;
  h.drift = 0;
  if (!h.isOrb) {
    // ignition era: some debris arrives molten and hits harder
    if (pilotProgress > 0.55 && pilotProgress < 0.82 && Math.random() < 0.6) { h.fire = true; h.mesh.material = _fireMat; }
    else h.mesh.material = h.baseMat;
    // collapse era: gravity drags debris toward the center line
    if (pilotProgress > 0.3 && pilotProgress < 0.55) h.drift = 1;
    h.mesh.scale.setScalar(h.size);
  }
}
function spawnPowerup(p) {
  p.active = true; p.scored = false; p.mesh.visible = true;
  p.x = (Math.random() * 2 - 1) * 6.5;
  p.y = (Math.random() * 2 - 1) * 4.5;
  p.z = PILOT_Z0 - (52 + Math.random() * 40);
  p.prevZ = p.z;
}

// ---- Boss event: supernova shockwave (a glowing wall with one safe gap) ----
let shockActive = false, shockZ = 0, shockGateX = 0, shockGateY = 0, shockNext = 0;
const SHOCK_TRIGGERS = [0.58, 0.88]; // fires once when crossing each progress mark
const shockMesh = new THREE.Mesh(
  new THREE.RingGeometry(2.5, 17, 72, 1), // the hole (radius 2.5) is the safe gate
  new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
);
shockMesh.visible = false;
hazardGroup.add(shockMesh);

// ---- Dash: short lateral burst with i-frames (key E) ----
let dashT = 0, dashCd = 0;
function triggerDash() {
  if (!piloting || dashCd > 0 || dashT > 0) return;
  dashT = 0.45; dashCd = 2.6;
  const dir = (pilotKeys["a"] || pilotKeys["arrowleft"]) ? -1 : (pilotKeys["d"] || pilotKeys["arrowright"]) ? 1 : 0;
  shipX = Math.max(-7.8, Math.min(7.8, shipX + dir * 3.2)); // burst toward steer direction
  energyTarget = 1.0;
  showBuff("DASH", 0x8be9ff); playChime();
}
const damageFlash = document.getElementById("damageFlash");
function pilotFlash(kind) {
  damageFlash.className = "damage-flash " + kind;
  setTimeout(() => { damageFlash.className = "damage-flash"; }, 130);
}
// low percussive thud when the hull is hit
function playThud() {
  if (!audioCtx || audioCtx.state !== "running") return;
  const now = audioCtx.currentTime, dur = 0.4;
  const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = audioCtx.createBufferSource(); src.buffer = buf;
  const lp = audioCtx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380;
  const g = audioCtx.createGain(); g.gain.setValueAtTime(0.5, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(lp).connect(g).connect(audioCtx.destination);
  src.start(now); src.stop(now + dur);
}
const pilotBuffEl = document.getElementById("pilotBuff");
const pilotFxEl = document.getElementById("pilotFx");
let _buffTimer = 0;
function showBuff(text, color) {
  if (!pilotBuffEl) return;
  pilotBuffEl.textContent = text;
  pilotBuffEl.style.color = "#" + color.toString(16).padStart(6, "0");
  pilotBuffEl.classList.add("show");
  clearTimeout(_buffTimer);
  _buffTimer = setTimeout(() => pilotBuffEl.classList.remove("show"), 1400);
}
function applyPowerup(key) {
  pilotFlash("collect"); playChime();
  if (key === "repair") { shield = Math.min(100, shield + 35); showBuff("HULL +35", 0x7dffa6); }
  else if (key === "magnet") { magnetT = 6; showBuff("MAGNET ONLINE", 0x8be9ff); }
  else if (key === "slow") { slowT = 5; showBuff("TIME DILATION", 0xc9a6ff); }
}

const pilotPanel = document.getElementById("pilotPanel");
function showPilotPanel(html) { pilotPanel.innerHTML = html; pilotPanel.classList.add("show"); }
function hidePilotPanel() { pilotPanel.classList.remove("show"); }

function startPilot() {
  showPilotPanel(`
    <h2>Pilot's Log</h2>
    <p>You are a wanderer from a dead star. Fold time and dive <span class="big">60 million years</span> into the past — to the moment a new sun is born.</p>
    <p>Steer with your mouse. Gather ✦ stardust to fuel your jump home, and don't let the debris of creation tear your hull apart.</p>
    <button id="pilotLaunch">▶ Launch</button>`);
  document.getElementById("pilotLaunch").addEventListener("click", beginPilot, { once: true });
}
function beginPilot() {
  hidePilotPanel();
  document.getElementById("loader").classList.add("done"); // ensure the loader is gone
  document.body.classList.add("pilot");
  piloting = true; pilotProgress = 0; shield = 100; stardust = 0; shipX = 0; shipY = 0; pilotShake = 0;
  combo = 1; boostMouse = false; boostKey = false;
  magnetT = 0; slowT = 0; pilotDist = 0; dashT = 0; dashCd = 0;
  shockActive = false; shockNext = 0; shockMesh.visible = false; shockMesh.material.opacity = 0;
  hazardGroup.visible = true;
  for (const h of hazards) resetHazard(h);
  for (const p of powerups) { p.active = false; p.scored = false; p.mesh.visible = false; p.cooldown = 6 + Math.random() * 7; }
  if (pilotFxEl) pilotFxEl.textContent = "";
  ensureCtx(); if (audioCtx.state === "suspended") audioCtx.resume(); // enable SFX
}
function endPilot(win) {
  piloting = false;
  hazardGroup.visible = false;
  if (stardust > highScore) { highScore = stardust; try { localStorage.setItem("aether_best", String(highScore)); } catch (e) {} }
  const title = win ? "Arrival" : "Hull Breach";
  const msg = win
    ? "You rode the shockwave of a newborn star and lived to remember it."
    : "The debris of creation tore your ship apart. The cosmos keeps its secrets.";
  showPilotPanel(`
    <h2>${title}</h2>
    <p>${msg}</p>
    <p class="big">✦ ${stardust} stardust collected</p>
    <p>Distance folded · ${Math.round(pilotDist).toLocaleString()} light-years</p>
    <p>Best flight · ✦ ${highScore}</p>
    <button id="pilotAgain">↻ Fly again</button>
    <button id="pilotShare">✦ Share flight</button>
    <button id="pilotDone">✕ Back to the story</button>`);
  document.getElementById("pilotAgain").addEventListener("click", () => { hidePilotPanel(); beginPilot(); }, { once: true });
  document.getElementById("pilotDone").addEventListener("click", exitPilot, { once: true });
  document.getElementById("pilotShare").addEventListener("click", async () => {
    const url = location.origin + location.pathname + "?seed=" + encodeURIComponent(seedStr) + "&pilot=1";
    const text = `I folded ${Math.round(pilotDist).toLocaleString()} light-years and gathered ✦${stardust} stardust flying through the birth of a star in ÆTHER.`;
    try {
      if (navigator.share) await navigator.share({ title: "ÆTHER — Birth of a Star", text, url });
      else { await navigator.clipboard.writeText(text + " " + url); showToast("Flight copied — share your run"); }
    } catch (e) {}
  });
}
function exitPilot() {
  piloting = false;
  hazardGroup.visible = false;
  hidePilotPanel();
  document.body.classList.remove("pilot");
}
document.getElementById("pilotBtn").addEventListener("click", startPilot);
document.getElementById("pilotExit").addEventListener("click", () => endPilot(false));

// on-screen controls for touch devices (drag anywhere steers)
if (IS_MOBILE || matchMedia("(pointer: coarse)").matches) document.body.classList.add("touch");
const dashBtn = document.getElementById("pilotDashBtn");
const boostBtn = document.getElementById("pilotBoostBtn");
if (dashBtn) dashBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); triggerDash(); });
if (boostBtn) {
  const on = (e) => { e.preventDefault(); e.stopPropagation(); boostMouse = true; };
  const off = () => { boostMouse = false; };
  boostBtn.addEventListener("pointerdown", on);
  boostBtn.addEventListener("pointerup", off);
  boostBtn.addEventListener("pointerleave", off);
  boostBtn.addEventListener("pointercancel", off);
}

// keyboard steering (WASD / arrows), boost (space/shift), Esc to abort
window.addEventListener("keydown", (e) => {
  if (!piloting) return;
  const k = e.key.toLowerCase();
  if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) { pilotKeys[k] = true; e.preventDefault(); }
  if (k === " " || k === "shift") boostKey = true;
  if (k === "e") triggerDash();
  if (e.key === "Escape") endPilot(false);
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  pilotKeys[k] = false;
  if (k === " " || k === "shift") boostKey = false;
});
window.addEventListener("pointerup", () => { boostMouse = false; });

const pilotComboEl = document.getElementById("pilotCombo");
const PILOT_ERAS = [[0, "I · DUST"], [0.3, "II · COLLAPSE"], [0.55, "III · IGNITION"], [0.78, "IV · NEW WORLD"]];
const pilotEraEl = document.getElementById("pilotEra");
const pilotYearsEl = document.getElementById("pilotYears");
const pilotShieldEl = document.getElementById("pilotShield");
const pilotStardustEl = document.getElementById("pilotStardust");

function updatePilot(gdt) {
  const boosting = boostMouse || boostKey;
  pilotProgress = Math.min(1, pilotProgress + gdt * (boosting ? 0.024 : 0.014));
  targetProgress = pilotProgress;
  // steering — mouse pull + keyboard push
  shipX += (mouseTarget.x * 7.5 - shipX) * 0.10;
  shipY += (mouseTarget.y * 5.2 - shipY) * 0.10;
  const kx = (pilotKeys["d"] || pilotKeys["arrowright"] ? 1 : 0) - (pilotKeys["a"] || pilotKeys["arrowleft"] ? 1 : 0);
  const ky = (pilotKeys["w"] || pilotKeys["arrowup"] ? 1 : 0) - (pilotKeys["s"] || pilotKeys["arrowdown"] ? 1 : 0);
  shipX += kx * 16 * gdt; shipY += ky * 16 * gdt;
  shipX = Math.max(-7.8, Math.min(7.8, shipX));
  shipY = Math.max(-5.4, Math.min(5.4, shipY));
  if (boosting) energyTarget = 0.85; // warp streaks (afterimage + aberration) while boosting
  const slowing = slowT > 0;
  const speed = (26 + pilotProgress * 46) * (boosting ? 1.9 : 1) * (slowing ? 0.55 : 1);
  pilotDist += speed * gdt * 1.4;
  const orbR = magnetT > 0 ? 2.4 : 1.8;
  for (const h of hazards) {
    h.prevZ = h.z;
    h.z += speed * gdt;
    if (h.z > PILOT_Z0 + 4) resetHazard(h);
    // collapse era: gravity drags debris toward the center line
    if (h.drift) { h.x += (0 - h.x) * 0.6 * gdt; h.y += (0 - h.y) * 0.6 * gdt; }
    // magnet: haul stardust toward the ship
    if (h.isOrb && magnetT > 0) { h.x += (shipX - h.x) * 2.4 * gdt; h.y += (shipY - h.y) * 2.4 * gdt; }
    h.mesh.position.set(h.x, h.y, h.z);
    if (!h.isOrb) { h.mesh.rotation.x += h.rot.x * gdt; h.mesh.rotation.y += h.rot.y * gdt; }
    if (!h.scored && h.prevZ <= PILOT_Z0 && h.z > PILOT_Z0) {
      const r = Math.hypot(h.x - shipX, h.y - shipY);
      const hitR = h.isOrb ? orbR : 1.35;
      if (r < hitR) {
        h.scored = true;
        if (h.isOrb) { stardust += combo; combo = Math.min(combo + 1, 8); pilotFlash("collect"); playChime(); }
        else if (dashT <= 0) { shield -= h.fire ? 24 : 16; combo = 1; pilotShake = h.fire ? 1.4 : 1; pilotFlash("hit"); playThud(); }
      }
    }
  }
  // boss event: supernova shockwave — a wall of fire with one safe gap
  if (!shockActive && shockNext < SHOCK_TRIGGERS.length && pilotProgress >= SHOCK_TRIGGERS[shockNext]) {
    shockActive = true;
    shockZ = PILOT_Z0 - 72;
    shockGateX = (Math.random() * 2 - 1) * 4.5;
    shockGateY = (Math.random() * 2 - 1) * 3.2;
    shockMesh.visible = true; shockMesh.material.opacity = 0;
    showBuff("⚠ SHOCKWAVE — FLY THROUGH THE GAP", 0xffb066);
    shockNext++;
  }
  if (shockActive) {
    const sPrev = shockZ;
    shockZ += speed * gdt * 0.9; // a touch slower than the field, so the gap is reachable
    shockMesh.position.set(shockGateX, shockGateY, shockZ);
    shockMesh.rotation.z += gdt * 0.35;
    shockMesh.material.opacity = Math.min(0.85, (shockZ + 72) / 72 * 0.85);
    if (sPrev <= PILOT_Z0 && shockZ > PILOT_Z0) {
      const d = Math.hypot(shipX - shockGateX, shipY - shockGateY);
      if (d < 2.6) { stardust += 5; pilotFlash("collect"); playChime(); showBuff("SHOCKWAVE CLEARED +5", 0x7dffa6); }
      else { shield -= 40; combo = 1; pilotShake = 2.4; pilotFlash("hit"); playThud(); showBuff("SHOCKWAVE IMPACT", 0xff5a4a); }
    }
    if (shockZ > PILOT_Z0 + 6) { shockActive = false; shockMesh.visible = false; }
  }
  // power-ups: cooldown → spawn → fly past → collect
  for (const p of powerups) {
    if (!p.active) { p.cooldown -= gdt; if (p.cooldown <= 0) spawnPowerup(p); continue; }
    p.prevZ = p.z;
    p.z += speed * gdt;
    p.mesh.position.set(p.x, p.y, p.z);
    if (p.z > PILOT_Z0 + 4) { p.active = false; p.mesh.visible = false; p.cooldown = 9 + Math.random() * 8; continue; }
    if (!p.scored && p.prevZ <= PILOT_Z0 && p.z > PILOT_Z0) {
      if (Math.hypot(p.x - shipX, p.y - shipY) < 2.0) {
        p.scored = true; p.active = false; p.mesh.visible = false; p.cooldown = 9 + Math.random() * 8;
        applyPowerup(p.key);
      }
    }
  }
  if (magnetT > 0) magnetT -= gdt;
  if (slowT > 0) slowT -= gdt;
  if (dashT > 0) dashT -= gdt;
  if (dashCd > 0) dashCd -= gdt;
  let era = PILOT_ERAS[0][1];
  for (const [th, n] of PILOT_ERAS) if (pilotProgress >= th) era = n;
  pilotEraEl.textContent = era;
  pilotYearsEl.textContent = "≈ " + Math.max(0, Math.round((1 - pilotProgress) * 60)) + " million years ago";
  pilotShieldEl.style.width = Math.max(0, shield) + "%";
  pilotStardustEl.textContent = stardust;
  pilotComboEl.textContent = combo > 1 ? "×" + combo : "";
  if (pilotFxEl) {
    let fx = "";
    if (magnetT > 0) fx += "🧲 " + Math.ceil(magnetT) + "s  ";
    if (slowT > 0) fx += "⧗ " + Math.ceil(slowT) + "s  ";
    fx += dashCd > 0 ? "⟫ " + Math.ceil(dashCd) + "s" : "⟫ ready";
    pilotFxEl.textContent = fx;
  }
  pilotShake *= 0.9;
  if (shield <= 0) endPilot(false);
  else if (pilotProgress >= 1) endPilot(true);
}

// ---------- Resize ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  uniforms.uSize.value = 22.0 * renderer.getPixelRatio();
  computeScroll();
});

// ---------- Loader ----------
const loaderEl = document.getElementById("loader");
const loaderFill = document.getElementById("loaderFill");
if (shotMode) loaderEl.style.display = "none"; // no loader in capture mode
let warm = 0;
let introStart = -1; // stamped when the loader finishes, drives the fly-in
function finishLoad() {
  loaderEl.classList.add("done");
  scrollHint.classList.remove("hidden");
  introStart = clock.getElapsedTime();
}

// ---------- Render loop ----------
const clock = new THREE.Clock();
let audioLevel = 0, bassL = 0, midL = 0, trebleL = 0;
let lastT = 0, fpsTimer = 0, fpsFrames = 0; // adaptive-quality sampling

function tick() {
  const t = clock.getElapsedTime();

  // sample frame rate; degrade quality once if we're running slow
  const dt = t - lastT; lastT = t;
  fpsTimer += dt; fpsFrames++;
  if (fpsTimer >= 1.2) {
    const fps = fpsFrames / fpsTimer;
    fpsTimer = 0; fpsFrames = 0;
    if (fps < 40 && qLevel < 2) applyQuality(++qLevel);
  }

  // auto-tour drives the scroll from top to bottom over TOUR_SECS
  if (tour) {
    const k = (t - tourStart) / TOUR_SECS;
    if (k >= 1) {
      setTour(false);
    } else {
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, e * max);
    }
  }

  if (warm < 1) {
    warm = shotMode ? 1 : Math.min(1, warm + 0.012);
    loaderFill.style.width = (warm * 100).toFixed(0) + "%";
    if (warm >= 1) finishLoad();
  }

  const gdt = Math.min(dt, 0.05);
  if (piloting) updatePilot(gdt);
  const prevProg = progress;
  progress += (targetProgress - progress) * 0.06;
  if (shotMode) progress = shotProgress; // snap for clean captures
  if (prevProg < 0.6 && progress >= 0.6) playSwell(); // ignition swell, once per crossing
  mouse.x += (mouseTarget.x - mouse.x) * 0.05;
  mouse.y += (mouseTarget.y - mouse.y) * 0.05;
  const bands = sampleBands();
  bassL += (bands[0] - bassL) * 0.2;
  midL += (bands[1] - midL) * 0.15;
  trebleL += (bands[2] - trebleL) * 0.25;
  audioLevel += ((bands[0] + bands[1] + bands[2]) / 3 - audioLevel) * 0.15;
  burst *= 0.93; // decay shockwave
  energyTarget *= 0.9;
  energy += (energyTarget - energy) * 0.15;

  uniforms.uTime.value = t;
  uniforms.uProgress.value = progress;
  uniforms.uAudio.value = audioLevel;
  uniforms.uBass.value = bassL;
  uniforms.uTreble.value = trebleL;
  uniforms.uBurst.value = burst;
  uniforms.uEnergy.value = energy;

  // dynamic per-act palette
  themeAt(progress, _cA, THEME_A);
  themeAt(progress, _cB, THEME_B);
  uniforms.uColorA.value.copy(_cA);
  uniforms.uColorB.value.copy(_cB);
  skyUniforms.uTime.value = t;
  skyUniforms.uColA.value.copy(_cA);
  skyUniforms.uColB.value.copy(_cB);
  for (const a of auroras) {
    a.material.uniforms.uTime.value = t;
    a.material.uniforms.uColor.value.copy(_cB);
    a.material.uniforms.uOpacity.value = 0.11 + midL * 0.14 + energy * 0.1;
  }
  for (const h of heroStars) {
    h.material.opacity = 0.45 + 0.35 * Math.sin(t * 1.5 + h.userData.seed);
  }

  updateOverlay(progress);
  updateAct(progress);
  // highlight the nearest chapter dot
  let nearest = 0, nd = 2;
  for (let i = 0; i < navDots.length; i++) {
    const dd = Math.abs(progress - navDots[i].center);
    if (dd < nd) { nd = dd; nearest = i; }
  }
  for (let i = 0; i < navDots.length; i++) navDots[i].b.classList.toggle("active", i === nearest);

  // drifting nebulae, tinted to the current act
  for (const s of nebulas) {
    s.material.rotation += s.userData.spin * 0.02;
    s.material.color.copy(_cB).multiplyScalar(0.6);
    s.material.opacity = 0.10 + 0.06 * Math.sin(t * 0.2 + s.userData.seed) + burst * 0.15;
  }

  // Act IV: reveal the sun + orbiting planets as the disk settles
  const sysVis = smooth01(0.72, 0.92, progress);
  systemGroup.visible = sysVis > 0.005;
  sunLight.intensity = 40 * sysVis;
  if (systemGroup.visible) {
    sun.scale.setScalar(sysVis);
    sunCorona.scale.setScalar(sysVis);
    sunMat.uniforms.uTime.value = t;
    sun.rotation.y += 0.01;
    sunGlow.material.opacity = sysVis * 0.85;
    asteroidBelt.material.opacity = sysVis * 0.5;
    asteroidBelt.rotation.y += 0.004;
    for (const pl of planets) {
      const ang = pl.phase + t * pl.cfg.speed;
      pl.group.position.set(Math.cos(ang) * pl.cfg.r, 0, Math.sin(ang) * pl.cfg.r);
      pl.group.scale.setScalar(sysVis);
      pl.mesh.rotation.y += 0.02;
      pl.mesh.material.uniforms.uTime.value = t;
      pl.highlight = (pl.highlight || 0) * 0.9;
      pl.mesh.scale.setScalar(1 + pl.highlight * 0.28);
      pl.trail.material.opacity = sysVis * 0.16 + pl.highlight * 0.5;
      if (pl.moonPivot) pl.moonPivot.rotation.y += 0.05;
    }
  }
  if (sysVis < 0.25 && selectedPlanet >= 0) hidePlanetCard();

  // hovered-planet indicator: billboard ring + floating name label
  if (hoveredPlanet >= 0 && systemGroup.visible) {
    const pl = planets[hoveredPlanet];
    const wp = pl.group.position;
    selRing.position.copy(wp);
    selRing.lookAt(camera.position);
    selRing.scale.setScalar(pl.cfg.size * 1.6);
    selRing.material.opacity += (0.75 - selRing.material.opacity) * 0.2;
    selRing.material.color.set(PLANET_INFO[hoveredPlanet].color);
    _projV.copy(wp).project(camera);
    if (_projV.z < 1) {
      planetLabel.style.left = (_projV.x * 0.5 + 0.5) * window.innerWidth + "px";
      planetLabel.style.top = (-_projV.y * 0.5 + 0.5) * window.innerHeight + "px";
      planetLabel.textContent = PLANET_INFO[hoveredPlanet].name;
      planetLabel.classList.add("visible");
    }
  } else {
    selRing.material.opacity += (0 - selRing.material.opacity) * 0.2;
    planetLabel.classList.remove("visible");
  }

  // occasional shooting stars streaking through the far field
  for (const c of comets) {
    const local = t - c.startAt;
    if (local < 0) { c.m.material.opacity = 0; continue; }
    const k = local / c.dur;
    if (k > 1) {
      c.startAt = t + 4 + Math.random() * 9;
      launchComet(c);
      c.m.material.opacity = 0;
      continue;
    }
    c.m.position.lerpVectors(c.from, c.to, k);
    const head = Math.sin(k * Math.PI);
    c.m.material.opacity = head * 0.9;
    const s = 0.6 + head * 1.2;
    c.m.scale.set(s * 2.4, s * 0.5, 1);
  }

  // meteor spray from clicks
  for (const mp of meteorPool) {
    if (mp.life <= 0) continue;
    mp.life -= 0.02;
    mp.m.position.addScaledVector(mp.vel, 0.06);
    const s = Math.max(0, mp.life);
    mp.m.material.opacity = s * 0.9;
    const sc = 0.25 + (1 - s) * 0.55;
    mp.m.scale.set(sc, sc, 1);
  }

  // expanding shockwave ring
  if (ringT > 0) {
    ringT -= 0.03;
    clickRing.position.copy(_ringPos);
    clickRing.lookAt(camera.position);
    clickRing.scale.setScalar((1 - ringT) * 6 + 0.1);
    clickRing.material.opacity = Math.max(0, ringT) * 0.6;
  }

  // ignition intensity (mirrors the shader) drives exposure + aberration flares
  const ignite = smooth01(0.45, 0.66, progress) * (1 - smooth01(0.66, 0.86, progress));
  renderer.toneMappingExposure = 1.15 + ignite * 0.55 + burst * 0.35;
  rgbPass.uniforms.uAmount.value = 0.0011 + ignite * 0.004 + burst * 0.012 + energy * 0.006 + trebleL * 0.003;
  rgbPass.uniforms.uAngle.value = t * 0.6;

  // bloom breathes with the sound (bass punches hardest) and flares on ignition / clicks / fast scroll
  bloom.strength = baseBloom + audioLevel * 0.4 + bassL * 0.5 + ignite * 0.5 + burst * 0.4 + energy * 0.3;

  // motion-blur trails: light streaks during the supernova and fast scrolling
  afterimagePass.uniforms["damp"].value = Math.min(0.6, ignite * 0.55 + energy * 0.4 + burst * 0.25);

  // god rays radiate from the star's screen position
  _sunProj.set(0, 0, 0).project(camera);
  const sunOnScreen = _sunProj.z < 1 ? 1 : 0;
  godRayPass.uniforms.uSun.value.set(_sunProj.x * 0.5 + 0.5, _sunProj.y * 0.5 + 0.5);
  godRayPass.uniforms.uIntensity.value = sunOnScreen * (ignite * 0.45 + sysVis * 0.26 + burst * 0.2);
  // gravitational lensing around the star's mass
  lensPass.uniforms.uSun.value.copy(godRayPass.uniforms.uSun.value);
  lensPass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
  lensPass.uniforms.uStrength.value = sunOnScreen * (ignite * 0.006 + sysVis * 0.004 + burst * 0.004);

  // anamorphic lens flare on the star
  const flareAmt = ignite * 0.85 + sysVis * 0.25 + burst * 0.3;
  flareStreak.material.opacity = flareAmt * 0.6;
  flareCore.material.opacity = flareAmt * 0.8;
  flareStreak.scale.x = 30 * (1 + audioLevel * 0.3 + burst * 0.6);
  godrays.material.opacity = flareAmt * 0.7;
  godrays.material.rotation += 0.003;

  // warp streaks flash right at the supernova, and on fast scroll
  const warpAmt = smooth01(0.6, 0.67, progress) * (1 - smooth01(0.67, 0.82, progress));
  warp.material.opacity = warpAmt * 0.7 + energy * 0.22;
  warp.material.rotation += 0.0015;

  // cinematic fly-in on load: camera swoops in from far, then hands off to scroll
  const intro = (introStart < 0 ? 1 : 1 - smooth01(introStart, introStart + 3.4, t)) * (REDUCE || shotMode ? 0 : 1);

  // camera: keyframed dolly + slow orbit + mouse parallax
  const frame = cameraFrame(progress);
  const orbit = t * 0.04 + mouse.x * 0.4 + intro * 1.3;
  const dist = frame.dist + intro * 26;
  _camTmp.set(Math.sin(orbit) * dist, frame.y + mouse.y * 2.2 + intro * 5, Math.cos(orbit) * dist);
  _lookTmp.set(0, 0, 0);

  // finale: swoop toward the ringed planet for a close pass
  const finaleT = smooth01(0.9, 1.0, progress);
  if (finaleT > 0) {
    const pp = planets[2].group.position;
    _approach.copy(pp).add(_off.set(0.95, 1.15, 0.95));
    _camTmp.lerp(_approach, finaleT);
    _lookTmp.lerp(pp, finaleT);
  }
  // focus on a clicked planet (overrides the scroll cam while its card is open)
  if (selectedPlanet >= 0) _focusPos.copy(planets[selectedPlanet].group.position);
  focusT += (focusTarget - focusT) * 0.06;
  if (focusT > 0.001) {
    _fCam.copy(_focusPos).add(_off.set(1.0, 0.8, 1.5));
    _camTmp.lerp(_fCam, focusT);
    _lookTmp.lerp(_focusPos, focusT);
  }
  camera.position.copy(_camTmp);
  // camera shake at the supernova and on shockwaves
  const shake = (ignite * 0.4 + burst * 0.6) * (REDUCE ? 0 : 1);
  camera.position.x += Math.sin(t * 63.0) * shake * 0.18;
  camera.position.y += Math.cos(t * 57.0) * shake * 0.18;
  camera.lookAt(_lookTmp);

  // depth-of-field: keep the focused planet sharp, blur the rest
  const dofAmt = Math.max(finaleT, focusT);
  focusBlurPass.uniforms.uStrength.value = dofAmt;
  if (dofAmt > 0.01) {
    _focusScreen.copy(_lookTmp).project(camera);
    focusBlurPass.uniforms.uFocus.value.set(_focusScreen.x * 0.5 + 0.5, _focusScreen.y * 0.5 + 0.5);
    focusBlurPass.uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
  }

  // pilot mode overrides the camera: fly forward from the ship's position
  if (piloting) {
    camera.position.set(shipX + Math.sin(t * 70) * pilotShake * 0.4, shipY + Math.cos(t * 64) * pilotShake * 0.4, PILOT_Z0);
    camera.lookAt(shipX * 0.5, shipY * 0.5, -30);
    focusBlurPass.uniforms.uStrength.value = 0;
  }

  // tip the cloud into the galaxy plane early, upright later
  points.rotation.z = (1 - Math.min(progress * 2, 1)) * 0.5;
  // slow spin of the whole system, faster as the disk forms
  points.rotation.y = t * (0.02 + progress * 0.06);

  // cursor gravity: project the pointer onto the plane through the scene center
  if (!IS_MOBILE) {
    camera.getWorldDirection(_n);
    _ray.set(mouse.x, mouse.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const denom = _n.dot(_ray);
    if (Math.abs(denom) > 1e-4) {
      const d = -_n.dot(camera.position) / denom;
      uniforms.uPointer.value.copy(camera.position).addScaledVector(_ray, d);
    }
    uniforms.uPointerStrength.value += (0.42 - uniforms.uPointerStrength.value) * 0.05;
    updateConstellations();
  } else {
    constLines.material.opacity += (0 - constLines.material.opacity) * 0.1;
  }

  composer.render();
  requestAnimationFrame(tick);
}

Math.random = _origRandom; // restore true randomness for runtime (comets, meteors, melody)
if (new URLSearchParams(location.search).get("pilot")) beginPilot(); // deep-link straight into the game
computeScroll();
tick();
