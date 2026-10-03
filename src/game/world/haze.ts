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
export function hazy<T extends MeshStandardMaterial>(mt: T): T {
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
          float hz = max(smoothstep(fogNear, fogFar * 2.6, vFogDepth) * 0.88, (1.0 - smoothstep(-12.0, -0.5, vHzY)) * 0.85);
          // цвет дымки — из панорамы в том же направлении (размыто): скала тает ровно в тот фон, что за ней
          vec3 wdir = viewToWorld * normalize(-vViewPosition);
          vec3 hc = panoSample(wdir, 5.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hc, hz);
        #endif`,
      )
  }
  mt.customProgramCacheKey = () => 'world-haze'
  return mt
}

/** Вызывать раз в кадр (HazeDriver в GameCanvas). */
export function updateHaze(camera: Camera) {
  haze.sunView.value.copy(atmo.sunDir).transformDirection(camera.matrixWorldInverse)
  haze.sunTint.value.copy(atmo.sunColor).multiplyScalar(0.38 * atmo.sunGlow)
}
