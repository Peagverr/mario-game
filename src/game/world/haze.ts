import { Color, Vector3, type Camera, type MeshStandardMaterial } from 'three'
import { atmo } from '../atmosphere/AtmosphereDriver'
import { PANO_GLSL, panoUniforms } from './skyPano'

/** Общие для дымки: направление на солнце в координатах камеры и его цвет (обновляет updateHaze каждый кадр). */
const haze = {
  sunView: { value: new Vector3(0, 0, -1) },
  sunTint: { value: new Color() },
}

/**
 * Дальняя дымка для скал и башен. Обычный туман целиком съедает всё дальше 60 м — здесь он доходит максимум
 * до 88% и растянут дальше: башни остаются силуэтами. Плюс туман по высоте: низ островов тонет в бездне.
 * Цвет дымки берётся из панорамы неба в том же направлении (размыто) — скала тает ровно в тот фон, что за ней.
 * Без pow и перевёрнутых smoothstep — на части видеокарт они дают NaN, а свечение размазывает его по экрану.
 */
export type HazeOpts = {
  /** Предел дальней дымки (0..1). */
  far?: number
  /** Предел тумана по высоте — низ тонет в бездне (0..1). */
  low?: number
  /** Контровой свет по краям: цветом неба за предметом + тёплый со стороны солнца. Даёт объём силуэтам. */
  rim?: number
  /** Ближе этого к камере (м) — растворяется (дизеринг): декорация, к которой подлетела камера, не закрывает кадр. */
  nearFade?: number
}

export function hazy<T extends MeshStandardMaterial>(mt: T, { far = 0.9, low = 0.85, rim = 0, nearFade = 0 }: HazeOpts = {}): T {
  const f = (x: number) => x.toFixed(3)
  mt.onBeforeCompile = (shader) => {
    shader.uniforms.sunView = haze.sunView
    shader.uniforms.sunTint = haze.sunTint
    Object.assign(shader.uniforms, panoUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying float vHzY;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvHzY = (modelMatrix * vec4(transformed, 1.0)).y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\nuniform vec3 sunView; uniform vec3 sunTint; uniform mat3 viewToWorld; varying float vHzY;\n' + PANO_GLSL)
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          ${
            nearFade > 0
              ? `float nf = smoothstep(${f(nearFade * 0.55)}, ${f(nearFade)}, vFogDepth);
          float dith = fract(dot(floor(gl_FragCoord.xy), vec2(0.5, 0.25)) + fract(floor(gl_FragCoord.y) * 0.5) * 0.5);
          if (nf < 0.999 && nf <= dith) discard;`
              : ''
          }
          float hz = max(smoothstep(fogNear, fogFar * 1.7, vFogDepth) * ${f(far)}, (1.0 - smoothstep(-12.0, -0.5, vHzY)) * ${f(low)});
          // цвет дымки — из панорамы в том же направлении (размыто): скала тает ровно в тот фон, что за ней
          vec3 wdir = viewToWorld * normalize(-vViewPosition);
          vec3 hc = panoSample(wdir, 5.0) * 1.25; // та же яркость, что у неба (gain в Sky)
          ${
            rim > 0
              ? `float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          rimF *= rimF;
          float sunF = clamp(dot(normal, sunView), 0.0, 1.0);
          gl_FragColor.rgb += (hc * 0.45 + sunTint * 2.0 * sunF) * rimF * ${f(rim)};`
              : ''
          }
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hc, hz);
        #endif`,
      )
  }
  mt.customProgramCacheKey = () => `world-haze-${f(far)}-${f(low)}-${f(rim)}-${f(nearFade)}`
  return mt
}

/** Вызывать раз в кадр (HazeDriver в GameCanvas). */
export function updateHaze(camera: Camera) {
  haze.sunView.value.copy(atmo.sunDir).transformDirection(camera.matrixWorldInverse)
  haze.sunTint.value.copy(atmo.sunColor).multiplyScalar(0.38 * atmo.sunGlow)
}
