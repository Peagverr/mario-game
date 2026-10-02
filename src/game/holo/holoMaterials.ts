import {
  AdditiveBlending,
  Color,
  CustomBlending,
  DoubleSide,
  MinEquation,
  NormalBlending,
  OneFactor,
  ShaderMaterial,
} from 'three'

/**
 * Материалы голограммы. Главная задача — читаться на ЯРКОМ фоне (голубое небо, трава, светлый камень):
 * чистый «светящийся» циан там пропадает. Поэтому каждый штрих рисуется в два прохода:
 *  1) подложка — тёмно-бирюзовый контур чуть шире штриха, режим «затемнение» (min): там, где фон светлее,
 *     он темнеет, а наложения подложек не темнеют дважды — на суставах нет грязных пятен;
 *  2) свет — бирюзовое тело с бело-горячим ядром (значения больше 1 — их ловит Bloom, тело — нет).
 * Тот же приём, что у мира — чернильный контур, только из цвета голограммы.
 */

/** Цвета — в линейном пространстве (Color из hex переводит сам). Одна гамма: бирюза палитры → циан → белый. */
export const HOLO = {
  /** Тело штриха. Чуть светлее и холоднее бирюзы палитры #2ec4b6, чтобы это был «свет», а не краска. */
  body: new Color('#38e0d2'),
  /** Край тела темнее — объём линии. */
  edge: new Color('#11a3a6'),
  /** Ядро — белое с бирюзовым отливом, яркость больше 1. */
  core: new Color('#e9fffb').multiplyScalar(2.6),
  /** Подложка — глубокая бирюза, почти чернила. */
  ink: new Color('#06363f'),
}

const STROKE_VERT = /* glsl */ `
  attribute vec3 aA;
  attribute vec3 aB;
  attribute vec2 aR;
  attribute vec2 aS;
  attribute vec3 aK;
  uniform float uScale;
  uniform float uPad;
  varying vec2 vP;
  varying float vLen;
  varying vec2 vR;
  varying vec2 vS;
  varying vec3 vK;
  void main() {
    // Штрих строим в плоскости экрана: квадрат вокруг отрезка A→B с запасом на скругления и контур.
    vec3 A = (modelViewMatrix * vec4(aA, 1.0)).xyz;
    vec3 B = (modelViewMatrix * vec4(aB, 1.0)).xyz;
    vec2 d = B.xy - A.xy;
    float len = length(d);
    vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float ra = aR.x * uScale;
    float rb = aR.y * uScale;
    float r = max(ra, rb) + uPad * uScale;
    float along = mix(-r, len + r, position.x * 0.5 + 0.5);
    float side = position.y * r;
    vec2 p = A.xy + dir * along + nrm * side;
    float k = len > 1e-6 ? clamp(along / len, 0.0, 1.0) : 0.0;
    vP = vec2(along, side);
    vLen = len;
    vR = vec2(ra, rb);
    vS = aS;
    vK = aK;
    gl_Position = projectionMatrix * vec4(p, mix(A.z, B.z, k), 1.0);
  }
`

/** Расстояние до «конуса со скруглёнными концами» (отрезок с разными радиусами на концах), по Иниго Килесу. */
const SD_CAPSULE = /* glsl */ `
  float sdTaper(vec2 p, float r1, float r2, float h) {
    if (h < 1e-5) return length(p) - r1;
    vec2 q = vec2(abs(p.y), p.x);
    float b = (r1 - r2) / h;
    float a = sqrt(max(0.0, 1.0 - b * b));
    float k = dot(q, vec2(-b, a));
    if (k < 0.0) return length(q) - r1;
    if (k > a * h) return length(q - vec2(0.0, h)) - r2;
    return dot(q, vec2(a, b)) - r1;
  }
`

const STROKE_HEAD = /* glsl */ `
  varying vec2 vP;
  varying float vLen;
  varying vec2 vR;
  varying vec2 vS;
  varying vec3 vK;
  ${SD_CAPSULE}
  float shape(out float t, out float w) {
    t = vLen > 1e-6 ? clamp(vP.x / vLen, 0.0, 1.0) : 0.0;
    w = mix(vR.x, vR.y, t);
    return sdTaper(vP, vR.x, vR.y, vLen);
  }
`

/** Проход 1: тёмная подложка (режим «затемнение»). */
const INK_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform float uInkWidth;
  uniform float uScale;
  uniform float uOpacity;
  ${STROKE_HEAD}
  void main() {
    float t, w;
    float d0 = shape(t, w);
    float aa = fwidth(d0) * 0.8;
    // Контур не тоньше ~1.5 пикселя: издалека рука не должна терять обводку.
    float d = d0 - max(uInkWidth * uScale, aa * 1.9);
    float cover = (1.0 - smoothstep(-aa, aa, d)) * vK.y * uOpacity;
    if (cover < 0.004) discard;
    // min(фон, цвет): частичное покрытие = цвет / покрытие — край сглажен, а вне штриха фон не трогаем.
    gl_FragColor = vec4(uInk / cover, 1.0);
  }
`

/** Проход 2: свет — тело, ядро, бегущий импульс. */
const LIGHT_FRAG = /* glsl */ `
  uniform vec3 uBody;
  uniform vec3 uEdge;
  uniform vec3 uCore;
  uniform float uIntensity;
  uniform float uOpacity;
  uniform float uPulse;
  uniform float uTime;
  ${STROKE_HEAD}
  void main() {
    float t, w;
    float d = shape(t, w);
    float aa = fwidth(d) * 0.8;
    float cover = 1.0 - smoothstep(-aa, aa, d);
    if (cover < 0.004) discard;
    float n = clamp(-d / max(w, 1e-5), 0.0, 1.0);
    // Импульс: светлая волна от запястья к кончикам раз в ~2.6 с.
    float s = mix(vS.x, vS.y, t);
    float ph = fract(uTime * 0.38) * 1.7 - 0.35;
    float x = (s - ph) / 0.09;
    float pulse = exp(-x * x) * uPulse;
    vec3 body = mix(uEdge, uBody, smoothstep(0.0, 0.55, n));
    float core = smoothstep(0.5, 0.92, n) * vK.x;
    vec3 col = mix(body, uCore, core) * vK.z * uIntensity * (1.0 + 0.9 * pulse);
    gl_FragColor = vec4(col, cover * vK.y * uOpacity);
  }
`

function strokeUniforms() {
  return {
    uScale: { value: 1 },
    uPad: { value: 0.004 },
    uOpacity: { value: 1 },
  }
}

export function makeInkMaterial() {
  return new ShaderMaterial({
    vertexShader: STROKE_VERT,
    fragmentShader: INK_FRAG,
    uniforms: { ...strokeUniforms(), uInk: { value: HOLO.ink.clone() }, uInkWidth: { value: 0.0013 } },
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: MinEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    toneMapped: false,
    fog: false,
  })
}

export function makeLightMaterial() {
  return new ShaderMaterial({
    vertexShader: STROKE_VERT,
    fragmentShader: LIGHT_FRAG,
    uniforms: {
      ...strokeUniforms(),
      uBody: { value: HOLO.body.clone() },
      uEdge: { value: HOLO.edge.clone() },
      uCore: { value: HOLO.core.clone() },
      uIntensity: { value: 1 },
      uPulse: { value: 1 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    toneMapped: false,
    fog: false,
  })
}

/**
 * Заливка ладони: светлое «матовое стекло», к краям плотнее — ладонь читается пятном, а не палочками.
 * Именно светлое: бирюза на зелёной траве отличается только оттенком и пропадает, а светлое — по яркости.
 */
export function makePalmMaterial() {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aEdge;
      varying float vEdge;
      void main() {
        vEdge = aEdge;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uRim;
      uniform float uOpacity;
      uniform float uGlow;
      varying float vEdge;
      void main() {
        float e = smoothstep(0.3, 1.0, vEdge);
        vec3 col = mix(uColor, uRim, e) * (1.0 + 0.6 * uGlow);
        gl_FragColor = vec4(col, (0.34 + 0.22 * e) * uOpacity);
      }
    `,
    uniforms: {
      uColor: { value: new Color('#c4fbf4') },
      uRim: { value: new Color('#7fefe4') },
      uOpacity: { value: 0 },
      uGlow: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    fog: false,
  })
}

/** Подставка-проектор на земле: мягкое пятно света, кольцо с тёмным ободом, три медленные дуги, линза в центре. */
export function makeBaseMaterial() {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBody;
      uniform vec3 uCore;
      uniform vec3 uInk;
      uniform float uOpen;
      uniform float uIntensity;
      uniform float uTime;
      varying vec2 vUv;
      float band(float x, float c, float w, float aa) { return 1.0 - smoothstep(w - aa, w + aa, abs(x - c)); }
      void main() {
        float r = length(vUv) / max(uOpen, 1e-3);
        if (r > 1.05) discard;
        float aa = fwidth(r) * 1.2;
        float a = atan(vUv.y, vUv.x);
        // Пятно света: от центра к краю гаснет.
        float pool = pow(1.0 - smoothstep(0.0, 0.95, r), 1.6) * 0.32;
        float ink = band(r, 0.9, 0.04, aa);
        float ring = band(r, 0.9, 0.012, aa);
        // Три дуги по 50°, медленно вращаются — знак «устройство работает».
        float arcs = band(r, 0.7, 0.012, aa) * step(0.5, fract((a + uTime * 0.35) / 2.0944 + 0.5)) * step(fract((a + uTime * 0.35) / 2.0944), 0.42);
        float lens = 1.0 - smoothstep(0.1 - aa, 0.1 + aa, r);
        vec3 col = uBody * 0.9;
        float alpha = pool;
        col = mix(col, uInk, ink * 0.85); alpha = max(alpha, ink * 0.55);
        col = mix(col, uBody * 1.1, arcs); alpha = max(alpha, arcs * 0.85);
        col = mix(col, uCore * 0.7, ring); alpha = max(alpha, ring);
        col = mix(col, uCore, lens); alpha = max(alpha, lens);
        gl_FragColor = vec4(col * uIntensity, alpha * min(1.0, uOpen * 1.5));
      }
    `,
    uniforms: {
      uBody: { value: HOLO.body.clone() },
      uCore: { value: HOLO.core.clone() },
      uInk: { value: HOLO.ink.clone() },
      uOpen: { value: 0 },
      uIntensity: { value: 1 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  })
}

/** Луч проектора: прозрачный конус, ярче по краям силуэта и у основания, к руке растворяется. */
export function makeBeamMaterial() {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying float vY;
      varying float vRim;
      void main() {
        vY = position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vRim = clamp(1.0 - abs(dot(n, normalize(-mv.xyz))), 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying float vY;
      varying float vRim;
      void main() {
        float fade = pow(clamp(1.0 - vY, 0.0, 1.0), 1.4) * smoothstep(0.0, 0.06, vY);
        float rim = 0.2 + 0.8 * pow(clamp(vRim, 0.0, 1.0), 2.5);
        // Редкие полосы света ползут вверх — луч «несёт» изображение.
        float bands = 0.8 + 0.2 * smoothstep(0.7, 1.0, sin((vY * 5.0 - uTime * 0.8) * 6.2832));
        gl_FragColor = vec4(uColor, fade * rim * bands * uOpacity);
      }
    `,
    uniforms: { uColor: { value: new Color('#bff9f3') }, uOpacity: { value: 0 }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
    fog: false,
  })
}

/** Круг-джойстик за ладонью (клип «ладонь из круга»): тонкое кольцо с тёмной подложкой; вспыхивает, когда ладонь вышла. */
export function makeGuideRingMaterial() {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBody;
      uniform vec3 uInk;
      uniform float uWidth;
      uniform float uOpacity;
      uniform float uHot;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        float aa = fwidth(r) * 1.2;
        float d = abs(r - 0.86);
        float ink = 1.0 - smoothstep(uWidth * 2.4 - aa, uWidth * 2.4 + aa, d);
        float ring = 1.0 - smoothstep(uWidth - aa, uWidth + aa, d);
        vec3 col = mix(uInk, uBody * (1.0 + 0.9 * uHot), ring);
        float alpha = max(ink * 0.45, ring * (0.55 + 0.45 * uHot));
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha * uOpacity);
      }
    `,
    uniforms: {
      uBody: { value: HOLO.body.clone() },
      uInk: { value: HOLO.ink.clone() },
      uWidth: { value: 0.03 },
      uOpacity: { value: 0 },
      uHot: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    fog: false,
  })
}
