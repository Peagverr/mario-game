import { Color, NormalBlending, ShaderMaterial, Vector2, Vector3 } from 'three'

/**
 * Материалы духа Окна.
 *
 * Тело — поле расстояний (SDF): голова-эллипсоид, туловище, две ручки и хвост из трёх звеньев,
 * склеенные мягким объединением — одна гладкая «призрачная» форма. Рисуем лучом в квадрате перед духом:
 * видна только передняя поверхность (полупрозрачный объём без внутренних швов).
 * Глаза и ротик рисуются прямо на поверхности головы — без отдельных мешей.
 *
 * Читаемость в светлом дневном мире (небо, трава, светлый камень): снаружи силуэта — тёмно-синий
 * контур того же «чернильного» языка, что у мира (его толщину даёт сам луч, прошедший мимо);
 * тело — насыщенный электрик-синий, светлее к центру (свет изнутри), край — яркий холодный ободок
 * больше 1 (его ловит Bloom), глаза — самое яркое на экране.
 */

export const SPIRIT_COLORS = {
  /** Глубина тела у краёв. */
  deep: new Color('#1663e6'),
  /** Тело в центре (свет изнутри). */
  mid: new Color('#3fbcff'),
  /** Внутреннее свечение вокруг центра головы. */
  core: new Color('#9ff0ff').multiplyScalar(1.1),
  /** Ободок по краю силуэта — больше 1: ледяной электрический голубой, как на референсе. */
  rim: new Color('#86f0ff').multiplyScalar(1.8),
  /** Глаза — самое яркое. */
  eye: new Color('#f4fdff').multiplyScalar(3.2),
  /** Контур и ротик — «чернила» мира, чуть синее. */
  ink: new Color('#16204d'),
  /** Тревога (подсказка об ошибке) — тёплый оттенок. */
  warm: new Color('#ffb257'),
}

const BODY_VERT = /* glsl */ `
  uniform vec3 uQuadCenter;
  uniform vec2 uQuadSize;
  varying vec3 vLocal;
  void main() {
    vLocal = vec3(uQuadCenter.xy + position.xy * uQuadSize, uQuadCenter.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vLocal, 1.0);
  }
`

const BODY_FRAG = /* glsl */ `
  uniform vec3 uCam;
  uniform int uSteps;
  uniform float uTime;
  uniform vec3 uHead;
  uniform vec3 uHeadR;
  uniform vec3 uB0;
  uniform vec3 uB1;
  uniform vec3 uT[4];
  uniform vec3 uArm[4];
  uniform vec3 uEyeL;
  uniform vec3 uEyeR;
  uniform vec2 uEyeSize;
  uniform float uOpen;
  uniform float uHappy;
  uniform vec3 uMouthPos;
  uniform float uMouth;
  uniform float uVoice;
  uniform float uAlert;
  uniform float uGlow;
  uniform float uOpacity;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uCore;
  uniform vec3 uRim;
  uniform vec3 uEye;
  uniform vec3 uInk;
  uniform vec3 uWarm;
  uniform vec3 uLight;
  varying vec3 vLocal;

  float smin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
  }
  float cap(vec3 p, vec3 a, vec3 b, float r1, float r2) {
    vec3 pa = p - a;
    vec3 ba = b - a;
    float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return length(pa - ba * t) - mix(r1, r2, t);
  }
  float ellipsoid(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-6);
  }
  float body(vec3 p) {
    float d = smin(ellipsoid(p - uHead, uHeadR), cap(p, uB0, uB1, 0.2, 0.15), 0.16);
    float tail = smin(cap(p, uT[0], uT[1], 0.15, 0.1), cap(p, uT[1], uT[2], 0.1, 0.052), 0.05);
    tail = smin(tail, cap(p, uT[2], uT[3], 0.052, 0.01), 0.04);
    d = smin(d, tail, 0.09);
    float arms = min(cap(p, uArm[0], uArm[1], 0.068, 0.052), cap(p, uArm[2], uArm[3], 0.068, 0.052));
    return smin(d, arms, 0.06);
  }
  vec3 normalAt(vec3 p) {
    const vec2 e = vec2(0.002, -0.002);
    return normalize(e.xyy * body(p + e.xyy) + e.yyx * body(p + e.yyx) + e.yxy * body(p + e.yxy) + e.xxx * body(p + e.xxx));
  }
  /** Доля пути по хвосту: 0 — у туловища (и вся голова), 1 — кончик. */
  float tailT(vec3 p) {
    vec3 ax = uT[3] - uT[0];
    return clamp(dot(p - uT[0], ax) / max(dot(ax, ax), 1e-6), 0.0, 1.0);
  }
  /** Хвост к кончику растворяется: 1 — плотно, 0 — нет. */
  float tailFade(vec3 p) {
    return 1.0 - smoothstep(0.4, 1.0, tailT(p)) * 0.95;
  }
  /** Глаз: < 0 — внутри. Овал, при моргании сплющивается; «довольный» — дужка ^ . */
  float eye(vec3 p, vec3 e) {
    vec2 q = (p - e).xy;
    if (uHappy > 0.5) {
      vec2 c = vec2(0.0, -uEyeSize.y * 0.55);
      float rr = uEyeSize.x * 1.35;
      float arc = abs(length(q - c) - rr) - uEyeSize.x * 0.38;
      return q.y < c.y + rr * 0.2 ? 1.0 : arc / uEyeSize.x;
    }
    vec2 s = vec2(uEyeSize.x, uEyeSize.y * max(uOpen, 0.12));
    return length(q / s) - 1.0;
  }

  void main() {
    vec3 rd = normalize(vLocal - uCam);
    float tMax = 1.5 / max(abs(rd.z), 0.25);
    float t = 0.0;
    float dMin = 1e3;
    vec3 pMin = vLocal;
    vec3 p = vLocal;
    bool hit = false;
    for (int i = 0; i < 64; i++) {
      if (i >= uSteps) break;
      float d = body(p);
      if (d < dMin) { dMin = d; pMin = p; }
      if (d < 0.0015) { hit = true; break; }
      t += d * 0.9;
      if (t > tMax) break;
      p = vLocal + rd * t;
    }
    // Пиксель в единицах духа — контур и сглаживание не тоньше пикселя на любом расстоянии.
    float px = max(fwidth(vLocal.x), 1e-4);
    if (!hit) {
      // Снаружи: голубой ореол без контура — дух из света, а не нарисованный (как на референсе).
      float fade = tailFade(pMin);
      float aura = exp(-max(dMin, 0.0) / 0.09) * 0.5 * fade * (1.0 + 0.8 * uVoice);
      if (aura < 0.01) discard;
      gl_FragColor = vec4(uRim * 0.55 * uGlow, aura * uOpacity);
      return;
    }

    vec3 n = normalAt(p);
    float ndv = clamp(abs(dot(n, -rd)), 0.0, 1.0);
    float lam = dot(n, uLight) * 0.5 + 0.5;
    // Тело: к центру светлее (свет изнутри), к краю глубже; мягкий объём от света сверху слева.
    // Яркость тела держим около 1: тональная кривая ACES уводит яркий синий в розовый.
    vec3 col = mix(uDeep, uMid, pow(ndv, 1.2)) * (0.75 + 0.3 * lam);
    // Свет внутри: ядро в голове, видное сквозь тело (по тому, как близко луч проходит мимо центра головы);
    // больше 1 — Bloom даёт ореол. Когда Окно говорит — разгорается.
    vec3 hc = uHead + vec3(0.0, 0.03, 0.0) - uCam;
    float along = dot(hc, rd);
    float b2 = max(dot(hc, hc) - along * along, 0.0);
    float glow = exp(-b2 / 0.03) * (0.55 + 0.7 * uVoice);
    col += uCore * glow;
    // Хвост — струящийся: медленные светлые прожилки вдоль.
    float tf = tailT(p);
    col += uCore * 0.15 * smoothstep(0.2, 0.6, tf) * (0.5 + 0.5 * sin(p.x * 34.0 + p.y * 9.0 - uTime * 5.0));
    // Ободок по силуэту; когда Окно говорит — ярче.
    float rim = pow(1.0 - ndv, 3.0);
    col = mix(col, uRim * (1.0 + 0.6 * uVoice), rim);
    // Блик — чёткий, «мультяшный», как у мира.
    float spec = smoothstep(0.9, 0.93, dot(reflect(rd, n), uLight));
    col = mix(col, vec3(2.0), spec * 0.45);
    // Почти плотное тело (сквозь сильно прозрачное просвечивают тёплые лучи — и дух розовеет).
    float alpha = mix(0.8, 1.0, max(rim, glow * 0.6)) * tailFade(p);

    // Глаза: тонкое тёмное кольцо и светящаяся сердцевина.
    float de = min(eye(p, uEyeL), eye(p, uEyeR));
    float aa = max(fwidth(de), 1e-3);
    float inner = 1.0 - smoothstep(-aa, aa, de);
    float ring = (1.0 - smoothstep(0.32 - aa, 0.32 + aa, de)) - inner;
    vec3 eyeCol = uEye * (1.0 + 0.5 * uVoice) * (0.85 + 0.3 * smoothstep(0.0, -0.7, de));
    col = mix(col, uDeep * 0.6, ring * 0.6);
    col = mix(col, eyeCol, inner);
    // Ротик — только когда Окно говорит: маленький тёмный овал, открывается с громкостью.
    if (uMouth > 0.02) {
      vec2 mq = (p - uMouthPos).xy / vec2(0.05, 0.006 + 0.034 * uMouth);
      float dm = length(mq) - 1.0;
      float am = max(fwidth(dm), 1e-3);
      col = mix(col, uInk, (1.0 - smoothstep(-am, am, dm)) * 0.9);
    }
    // Тревога: короткий тёплый оттенок.
    col = mix(col, uWarm * (0.75 + 0.6 * ndv + glow) + uWarm * rim * 0.8, uAlert * 0.8);
    gl_FragColor = vec4(col * uGlow, alpha * uOpacity);
  }
`

export function makeBodyMaterial() {
  return new ShaderMaterial({
    vertexShader: BODY_VERT,
    fragmentShader: BODY_FRAG,
    uniforms: {
      uQuadCenter: { value: new Vector3(0, 0.25, 0.6) },
      uQuadSize: { value: new Vector2(0.85, 0.95) },
      uCam: { value: new Vector3(0, 0, 10) },
      uSteps: { value: 56 },
      uTime: { value: 0 },
      uHead: { value: new Vector3(0, 0.6, 0) },
      uHeadR: { value: new Vector3(0.39, 0.35, 0.34) },
      uB0: { value: new Vector3(0, 0.36, 0) },
      uB1: { value: new Vector3(0, 0.14, 0) },
      uT: { value: [new Vector3(), new Vector3(), new Vector3(), new Vector3()] },
      uArm: { value: [new Vector3(), new Vector3(), new Vector3(), new Vector3()] },
      uEyeL: { value: new Vector3() },
      uEyeR: { value: new Vector3() },
      uEyeSize: { value: new Vector2(0.06, 0.095) },
      uOpen: { value: 1 },
      uHappy: { value: 0 },
      uMouthPos: { value: new Vector3() },
      uMouth: { value: 0 },
      uVoice: { value: 0 },
      uAlert: { value: 0 },
      uGlow: { value: 1 },
      uOpacity: { value: 1 },
      uDeep: { value: SPIRIT_COLORS.deep.clone() },
      uMid: { value: SPIRIT_COLORS.mid.clone() },
      uCore: { value: SPIRIT_COLORS.core.clone() },
      uRim: { value: SPIRIT_COLORS.rim.clone() },
      uEye: { value: SPIRIT_COLORS.eye.clone() },
      uInk: { value: SPIRIT_COLORS.ink.clone() },
      uWarm: { value: SPIRIT_COLORS.warm.clone() },
      uLight: { value: new Vector3(-0.5, 0.7, 0.5).normalize() },
    },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    toneMapped: false,
    fog: false,
  })
}

/** След-лента: светлая сердцевина, синие края, к хвосту тает. Позиции — в мире, строит CPU. */
export function makeTrailMaterial() {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec2 aUv;
      attribute float aAlpha;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vUv = aUv;
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uEdge;
      uniform vec3 uCore;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        // Мягкая лента: тонкая светлая жилка в середине, синие края тают; к хвосту — тоньше и прозрачнее.
        float v = abs(vUv.y);
        float core = exp(-v * v * 14.0);
        vec3 col = mix(uEdge, uCore, core);
        float a = exp(-v * v * 3.5) * (1.0 - smoothstep(0.8, 1.0, v)) * pow(max(1.0 - vUv.x, 0.0), 1.6) * vAlpha * uOpacity * 0.85;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
    uniforms: {
      uEdge: { value: SPIRIT_COLORS.deep.clone() },
      uCore: { value: SPIRIT_COLORS.core.clone().multiplyScalar(1.15) },
      uOpacity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    toneMapped: false,
    fog: false,
  })
}

/** Искорки: четырёхлучевые звёздочки, синие с белым ядром (синие — чтобы читались на светлом небе). */
export function makeSparkleMaterial() {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec3 aData;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float c = cos(aData.z);
        float s = sin(aData.z);
        vUv = mat2(c, -s, s, c) * position.xy;
        vAlpha = aData.y;
        vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
        mv.xy += position.xy * aData.x;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBlue;
      uniform vec3 uWhite;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float r = length(vUv);
        float core = exp(-r * r * 30.0);
        float rays = max(exp(-abs(vUv.x) * 26.0) * (1.0 - abs(vUv.y)), exp(-abs(vUv.y) * 26.0) * (1.0 - abs(vUv.x)));
        float a = clamp(core + rays * 0.9, 0.0, 1.0) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(uBlue, uWhite, core), a);
      }
    `,
    uniforms: {
      uBlue: { value: new Color('#2f74ff') },
      uWhite: { value: new Color('#ffffff').multiplyScalar(2.4) },
    },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    toneMapped: false,
    fog: false,
  })
}

