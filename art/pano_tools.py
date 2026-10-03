# Панорама 360° для фона игры: рендер 6 граней куба в EEVEE и сборка в равнопромежуточную картинку (2:1).
# Запуск внутри Blender (сцена Pano в art/lobby.blend): exec(open(r'...\art\pano_tools.py').read())
import bpy, math, os
import numpy as np
from mathutils import Vector, Matrix, Color

PANO = bpy.data.scenes['Pano']

def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

# Время суток — те же цвета, что таблица KEYS в src/game/atmosphere/atmosphere.ts, но богаче.
TIMES = {
    'dusk':   dict(el=-5.0, top='#0a1430', hor='#4a5a90', low='#30428a', deep='#1c2a60', sun='#ff8a5a', sunE=5.0, glow=1.3, sky=3.2, fog='#6a84c8', cloud='#c8d6ff', moon=2.2),
    'golden': dict(el=1.5,  top='#1d3266', hor='#f0925e', low='#3a3a5e', deep='#1c1c38', sun='#ffa060', sunE=6.0, glow=1.6, sky=1.2, fog='#8a7aa0', cloud='#e8c0b0'),
    'dawn':   dict(el=17.0, top='#4f92dc', hor='#ffdcb0', low='#a9c4e6', deep='#6d8cbf', sun='#fff0d4', sunE=6.0, glow=0.45, sky=1.6, fog='#b8cbe8', cloud='#ffffff'),
}
AZ = math.radians(38)  # солнце справа позади (как SUN_AZIMUTH в atmosphere.ts)

def sun_dir(el_deg):
    el = math.radians(el_deg)
    # игра: (sin az·cos el, sin el, −cos az·cos el) → Blender: (x, −z, y)
    return Vector((math.sin(AZ) * math.cos(el), math.cos(AZ) * math.cos(el), math.sin(el))).normalized()

def set_time(name):
    k = TIMES[name]
    nt = PANO.world.node_tree
    r = nt.nodes['ramp'].color_ramp
    while len(r.elements) > 2: r.elements.remove(r.elements[-1])
    r.elements[0].position = 0.0; r.elements[0].color = (*srgb(k['deep']), 1)
    r.elements[1].position = 1.0; r.elements[1].color = (*srgb(k['top']), 1)
    e = r.elements.new(0.42); e.color = (*srgb(k['low']), 1)
    e = r.elements.new(0.5); e.color = (*srgb(k['hor']), 1)
    e = r.elements.new(0.62); e.color = (*[c * 0.6 + t * 0.4 for c, t in zip(srgb(k['hor']), srgb(k['top']))], 1)
    sd = sun_dir(k['el'])
    nt.nodes['dot'].inputs[1].default_value = sd
    sc = srgb(k['sun'])
    nt.nodes['add1'].inputs['B'].default_value = (sc[0] * k['glow'], sc[1] * k['glow'], sc[2] * k['glow'], 1)
    nt.nodes['add2'].inputs['B'].default_value = (sc[0] * 40, sc[1] * 40, sc[2] * 40, 1)
    nt.nodes['bglight'].inputs['Strength'].default_value = k['sky']
    sun = bpy.data.objects['PanoSun']
    # свет — не ниже 8°, иначе руины снизу совсем чёрные
    ld = sun_dir(max(k['el'], 8))
    sun.rotation_euler = ld.to_track_quat('Z', 'Y').to_euler()
    sun.data.color = sc; sun.data.energy = k['sunE']
    # лунный свет с противоположной от солнца стороны — чтобы тёмная сторона панорамы не была чёрной
    md = bpy.data.lights.get('PanoMoon') or bpy.data.lights.new('PanoMoon', 'SUN')
    mo = bpy.data.objects.get('PanoMoon') or bpy.data.objects.new('PanoMoon', md)
    if mo.name not in PANO.collection.objects: PANO.collection.objects.link(mo)
    mdir = Vector((-ld.x, -ld.y, 0.6)).normalized()
    mo.rotation_euler = mdir.to_track_quat('Z', 'Y').to_euler()
    md.color = (0.55, 0.68, 1.0); md.energy = k.get('moon', 0.0)
    fv = bpy.data.materials['PanoFog'].node_tree.nodes['V']
    fv.inputs['Color'].default_value = (*srgb(k['fog']), 1)
    cv = bpy.data.materials['PanoClouds'].node_tree.nodes['V']
    cv.inputs['Color'].default_value = (*srgb(k['cloud']), 1)

# Грани: направление взгляда и «верх» (в координатах Blender).
FACES = {
    'px': (Vector((1, 0, 0)), Vector((0, 0, 1))),
    'nx': (Vector((-1, 0, 0)), Vector((0, 0, 1))),
    'py': (Vector((0, 1, 0)), Vector((0, 0, 1))),
    'ny': (Vector((0, -1, 0)), Vector((0, 0, 1))),
    'pz': (Vector((0, 0, 1)), Vector((0, -1, 0))),
    'nz': (Vector((0, 0, -1)), Vector((0, 1, 0))),
}

def render_faces(res, outdir, tag):
    os.makedirs(outdir, exist_ok=True)
    cam = bpy.data.objects['PanoCam']
    PANO.render.resolution_x = PANO.render.resolution_y = res
    PANO.render.image_settings.file_format = 'PNG'
    PANO.render.image_settings.color_depth = '8'
    for name, (f, u) in FACES.items():
        r = f.cross(u)
        m = Matrix((r, u, -f)).transposed()  # столбцы: X=право, Y=верх, Z=−вперёд
        cam.matrix_world = Matrix.Translation(cam.location) @ m.to_4x4()
        PANO.render.filepath = os.path.join(outdir, f'{tag}_{name}.png')
        bpy.ops.render.render(write_still=True, scene=PANO.name)

def load_rgb(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'Non-Color'  # сырые значения файла, без пересчёта цвета
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1, :, :3]  # сверху вниз
    bpy.data.images.remove(img)
    return a

def assemble(outdir, tag, W=2048):
    H = W // 2
    faces = {n: load_rgb(os.path.join(outdir, f'{tag}_{n}.png')) for n in FACES}
    S = faces['px'].shape[0]
    v, u = np.mgrid[0:H, 0:W].astype(np.float32)
    lon = ((u + 0.5) / W - 0.5) * 2 * math.pi
    lat = (0.5 - (v + 0.5) / H) * math.pi  # верх картинки — зенит
    d = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)
    out = np.zeros((H, W, 3), np.float32)
    best = np.full((H, W), -1.0, np.float32)
    for name, (f, up) in FACES.items():
        fv = np.array(f, np.float32); uv_ = np.array(up, np.float32); rv = np.array(f.cross(up), np.float32)
        z = d @ fv
        mask = (z > best) & (z > 0)
        if not mask.any(): continue
        x = (d @ rv) / np.maximum(z, 1e-6); y = (d @ uv_) / np.maximum(z, 1e-6)
        col = np.clip(((x + 1) / 2 * S).astype(np.int32), 0, S - 1)
        row = np.clip(((1 - y) / 2 * S).astype(np.int32), 0, S - 1)
        out[mask] = faces[name][row[mask], col[mask]]
        best[mask] = z[mask]
    return out

def save_jpg(arr, path, quality=88):
    """Сохранить как есть (значения уже в sRGB, как в отрендеренных гранях)."""
    H, W, _ = arr.shape
    img = bpy.data.images.new('pano_out', W, H, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.concatenate([arr[::-1], np.ones((H, W, 1), np.float32)], -1)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = 'JPEG'
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)

ROOT = r'C:\Users\User\Desktop\mario'

def build(tag, res=1024, W=2048):
    out = os.path.join(ROOT, 'art', 'export', 'pano')
    set_time(tag)
    render_faces(res, out, tag)
    eq = assemble(out, tag, W)
    save_jpg(eq, os.path.join(ROOT, 'public', 'textures', f'sky_{tag}.jpg'))
    return eq.shape


def build_cycles(tag, W=2048, samples=48):
    """Панорама одним кадром в Cycles (без швов). Cycles кладёт долготу в обратную сторону — отражаем."""
    set_time(tag)
    P = PANO
    P.render.engine = 'CYCLES'; P.cycles.samples = samples
    P.render.resolution_x = W; P.render.resolution_y = W // 2
    P.render.image_settings.file_format = 'PNG'; P.render.image_settings.color_depth = '8'
    raw = os.path.join(ROOT, 'art', 'export', 'pano', f'cy_{tag}.png')
    os.makedirs(os.path.dirname(raw), exist_ok=True)
    P.render.filepath = raw
    bpy.ops.render.render(write_still=True, scene=P.name)
    a = load_rgb(raw)[:, ::-1]
    save_jpg(np.ascontiguousarray(a), os.path.join(ROOT, 'public', 'textures', f'sky_{tag}.jpg'))
    return a.shape
