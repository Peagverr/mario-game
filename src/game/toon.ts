import { DataTexture, NearestFilter, RedFormat } from 'three'

/**
 * Карта ступенчатого света для MeshToonMaterial: вместо плавной тени — три «мультяшных» тона.
 */
function makeGradient(steps: number[]) {
  const tex = new DataTexture(new Uint8Array(steps), steps.length, 1, RedFormat)
  tex.minFilter = NearestFilter
  tex.magFilter = NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

export const toonGradient = makeGradient([110, 190, 255])
