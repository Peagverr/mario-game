import { LinearMipmapLinearFilter, MathUtils, Matrix3, RepeatWrapping, ClampToEdgeWrapping, SRGBColorSpace, TextureLoader, type Camera, type Texture } from 'three'
import { atmo } from '../atmosphere/AtmosphereDriver'

/**
 * Дальний фон — панорамы 360° из Blender (art/lobby.blend, сцена Pano, скрипт art/pano_tools.py, рендер Cycles):
 * башни-руины, мосты и острова со всех сторон, море облаков внизу. Приём «скайбокс» из игр: дальний план
 * рендерится заранее и в браузере стоит одну картинку, а выглядит как кадр из Blender.
 * Три панорамы по времени суток (сумерки → золотой час → рассвет), между соседними — плавное смешивание по t.
 * Той же панорамой красятся дымка скал и море тумана — 3D-мир растворяется в фоне без шва.
 */

const BASE = `${import.meta.env.BASE_URL}textures/`
const loader = new TextureLoader()

function pano(name: string): Texture {
  const t = loader.load(`${BASE}sky_${name}.jpg`)
  t.colorSpace = SRGBColorSpace
  t.wrapS = RepeatWrapping
  t.wrapT = ClampToEdgeWrapping
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = 4
  return t
}

let textures: { dusk: Texture; golden: Texture; dawn: Texture } | null = null
const getTextures = () => (textures ??= { dusk: pano('dusk'), golden: pano('golden'), dawn: pano('dawn') })

/** Общие uniform-ы панорамы — их подключают небо, дымка и туман. */
export const panoUniforms = {
  panoA: { value: null as Texture | null },
  panoB: { value: null as Texture | null },
  panoMix: { value: 0 },
  /** Поворот из координат камеры в мировые (для дымки, которая знает только направление в камере). */
  viewToWorld: { value: new Matrix3() },
}

/**
 * GLSL: цвет панорамы по направлению в мире (y — вверх). lod — размытость (0 — резко, 6 — общий цвет для тумана).
 * Разметка совпадает с art/pano_tools.py: центр картинки — +x, сверху — зенит.
 */
export const PANO_GLSL = /* glsl */ `
uniform sampler2D panoA;
uniform sampler2D panoB;
uniform float panoMix;
vec3 panoSample(vec3 d, float lod) {
  d = normalize(d);
  float lon = atan(-d.z, d.x);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(0.5 + lon / 6.2831853, 0.5 + lat / 3.1415927);
  return mix(textureLod(panoA, uv, lod).rgb, textureLod(panoB, uv, lod).rgb, panoMix);
}`

/** Раз в кадр: какие две панорамы смешивать (по времени суток) и поворот камеры. */
export function updatePano(camera: Camera) {
  const tx = getTextures()
  const t = atmo.t
  if (t <= 0.55) {
    panoUniforms.panoA.value = tx.dusk
    panoUniforms.panoB.value = tx.golden
    panoUniforms.panoMix.value = MathUtils.smoothstep(t, 0.12, 0.55)
  } else {
    panoUniforms.panoA.value = tx.golden
    panoUniforms.panoB.value = tx.dawn
    panoUniforms.panoMix.value = MathUtils.smoothstep(t, 0.62, 1)
  }
  panoUniforms.viewToWorld.value.setFromMatrix4(camera.matrixWorld)
}

/** Уменьшенные копии панорам (64×32, линейный цвет) — чтобы брать цвет фона на процессоре (для обычного тумана). */
const SW = 64
const SH = 32
const small = new Map<Texture, Float32Array>()
function smallOf(t: Texture | null): Float32Array | null {
  if (!t || !t.image) return null
  const hit = small.get(t)
  if (hit) return hit
  const img = t.image as HTMLImageElement
  if (!img.complete || !img.naturalWidth) return null
  const c = document.createElement('canvas')
  c.width = SW
  c.height = SH
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, SW, SH)
  const px = ctx.getImageData(0, 0, SW, SH).data
  const out = new Float32Array(SW * SH * 3)
  for (let i = 0; i < SW * SH; i++)
    for (let k = 0; k < 3; k++) {
      const v = px[i * 4 + k] / 255
      out[i * 3 + k] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
  small.set(t, out)
  return out
}

/** Цвет фона в направлении (x, y, z) мира — в out (линейный). false, если панорамы ещё не загружены. */
export function panoColorAt(x: number, y: number, z: number, out: { r: number; g: number; b: number }) {
  const a = smallOf(panoUniforms.panoA.value)
  const b = smallOf(panoUniforms.panoB.value)
  if (!a || !b) return false
  const len = Math.hypot(x, y, z) || 1
  const lon = Math.atan2(-z / len, x / len)
  const lat = Math.asin(Math.max(-1, Math.min(1, y / len)))
  const u = 0.5 + lon / (Math.PI * 2)
  const v = 0.5 - lat / Math.PI // строки картинки — сверху вниз
  const ix = ((Math.floor(u * SW) % SW) + SW) % SW
  const iy = Math.max(0, Math.min(SH - 1, Math.floor(v * SH)))
  const i = (iy * SW + ix) * 3
  const m = panoUniforms.panoMix.value
  out.r = a[i] + (b[i] - a[i]) * m
  out.g = a[i + 1] + (b[i + 1] - a[i + 1]) * m
  out.b = a[i + 2] + (b[i + 2] - a[i + 2]) * m
  return true
}
