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
    # сумерки: глубокий сине-бирюзовый, не фиолетовый; тёмная сторона подсвечена луной; тёплые огни в окнах
    'dusk':   dict(el=-4.0, top='#0c2038', hor='#5f8db0', low='#355a7c', deep='#1a3048', sun='#ffae62', sunE=5.0, glow=1.0, sky=4.0, fog='#7fa6c8', cloud='#d4e4f4', moon=2.6, win=9.0, exp=0.35, cloudE=0.0012),
    # золотой час: бирюзовый верх, тёплое зарево только у солнца; дымка и облака холодные (иначе фон — бежевая пустыня)
    'golden': dict(el=2.0,  top='#1f4a74', hor='#ffb46e', low='#6a7c9a', deep='#2a3a52', sun='#ffb066', sunE=3.8, glow=1.5, sky=3.6, fog='#8fa6c6', cloud='#e2e6f4', moon=2.8, win=4.0, exp=0.45, cloudE=0.002),
    'dawn':   dict(el=17.0, top='#4f92dc', hor='#ffdcb0', low='#a9c4e6', deep='#6d8cbf', sun='#fff0d4', sunE=6.0, glow=0.45, sky=1.6, fog='#b8cbe8', cloud='#ffffff', moon=0.0, win=0.0, exp=0.0),
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
    # облака светятся изнутри цветом неба у горизонта — иначе в тени от низкого солнца они грязно-бурые
    cv.inputs['Emission Color'].default_value = (*srgb(k['hor']), 1)
    cv.inputs['Emission Strength'].default_value = k.get('cloudE', 0.0)
    # тёплые огни в окнах башен (на рассвете гаснут)
    wb = bpy.data.materials['TowerWindow'].node_tree.nodes['Principled BSDF']
    wb.inputs['Emission Color'].default_value = (1.0, 0.62, 0.3, 1)
    wb.inputs['Emission Strength'].default_value = k.get('win', 0.0)
    fw = bpy.data.materials.get('PanoFarWindow')
    if fw:
        fb = fw.node_tree.nodes['Principled BSDF']
        fb.inputs['Emission Color'].default_value = (1.0, 0.62, 0.3, 1)
        fb.inputs['Emission Strength'].default_value = k.get('win', 0.0) * 0.35
    # AgX — мягкий переход в светах (ореол солнца не выбивает в белое), тени не проваливаются в черноту
    PANO.view_settings.view_transform = 'AgX'
    PANO.view_settings.look = 'AgX - Medium High Contrast'
    PANO.view_settings.exposure = k.get('exp', 0.0)

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

# Корень проекта: из переменной MARIO_ROOT, иначе папка на ноутбуке.
ROOT = os.environ.get('MARIO_ROOT', r'C:\Users\User\Desktop\mario')

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


def add_far_city(seed=7, count=48):
    """Дальний слой: город-руины на 520–1000 м, гуще и выше ближних башен. Тонет в дымке — даёт глубину
    (ближние башни тёмные и чёткие, дальние — бледные силуэты, как на референсе). Пересоздаётся при каждом вызове."""
    import bmesh, random
    rnd = random.Random(seed)
    old = bpy.data.objects.get('PanoFarCity')
    if old: bpy.data.objects.remove(old, do_unlink=True)
    mat = bpy.data.materials.get('PanoFarStone') or bpy.data.materials.new('PanoFarStone')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb('#5c544c'), 1); b.inputs['Roughness'].default_value = 0.95
    # окна дальнего города — свой материал, тусклее ближних (иначе башни как гирлянды)
    win = bpy.data.materials.get('PanoFarWindow') or bpy.data.materials['TowerWindow'].copy()
    win.name = 'PanoFarWindow'
    bm = bmesh.new()

    def box(cx, cy, z0, sx, sy, h, rot, mi):
        r = bmesh.ops.create_cube(bm, size=1.0)
        vs = r['verts']
        for v in vs:
            x, y, z = v.co.x * sx, v.co.y * sy, (v.co.z + 0.5) * h + z0
            c, s_ = math.cos(rot), math.sin(rot)
            v.co = Vector((cx + x * c - y * s_, cy + x * s_ + y * c, z))
        for f in {f for v in vs for f in v.link_faces}: f.material_index = mi

    for i in range(count):
        az = (i / count) * 2 * math.pi + rnd.uniform(-0.05, 0.05)
        r = rnd.uniform(520, 1000)
        cx, cy = math.cos(az) * r, math.sin(az) * r
        rot = rnd.uniform(0, math.pi)
        if rnd.random() < 0.3:
            # широкая низкая крепость: стены и обломки
            w = rnd.uniform(140, 260); d = w * rnd.uniform(0.3, 0.6)
            H = rnd.uniform(40, 130); tiers = 2
        else:
            w = rnd.uniform(55, 130); d = w * rnd.uniform(0.5, 0.9)
            H = 110 + 330 * rnd.random() ** 1.6; tiers = rnd.randint(2, 4)
        z = rnd.uniform(-150, -100); top = H
        # ступенчатая башня: 2–4 яруса, каждый уже и сдвинут — силуэт «крепости», а не шпиль
        for t in range(tiers):
            h = (top - z) / (tiers - t) * rnd.uniform(0.8, 1.2)
            ox, oy = rnd.uniform(-0.15, 0.15) * w, rnd.uniform(-0.15, 0.15) * d
            box(cx + ox, cy + oy, z, w, d, h, rot, 0)
            # выступы-контрфорсы и обломки
            if rnd.random() < 0.5:
                bw = w * rnd.uniform(0.2, 0.4)
                box(cx + ox + w * 0.55 * rnd.choice((-1, 1)), cy + oy, z + h * 0.2, bw, bw, h * rnd.uniform(0.4, 0.9), rot, 0)
            # окна: редкие тусклые огни
            for _ in range(rnd.randint(0, 2) if rnd.random() < 0.5 else 0):
                a = rnd.uniform(0, 2 * math.pi)
                box(cx + ox + math.cos(a) * w * 0.52, cy + oy + math.sin(a) * d * 0.52, z + rnd.uniform(0.2, 0.8) * h, 4, 4, 7, rot, 1)
            z += h
            w *= rnd.uniform(0.55, 0.8); d *= rnd.uniform(0.55, 0.8)
        if rnd.random() < 0.12:  # шпиль
            box(cx, cy, z, 6, 6, rnd.uniform(20, 50), rot, 0)
        # мост к соседу
        if rnd.random() < 0.3:
            a2 = az + 2 * math.pi / count
            mx, my = (cx + math.cos(a2) * r) / 2, (cy + math.sin(a2) * r) / 2
            L = math.hypot(cx - math.cos(a2) * r, cy - math.sin(a2) * r)
            box(mx, my, rnd.uniform(0, 120), 6, L * 0.9, 10, math.atan2(-(cx - math.cos(a2) * r), cy - math.sin(a2) * r), 0)
    me = bpy.data.meshes.new('PanoFarCity')
    bm.to_mesh(me); bm.free()
    me.materials.append(mat); me.materials.append(win)
    ob = bpy.data.objects.new('PanoFarCity', me)
    PANO.collection.objects.link(ob)
    # дымка и море облаков — шире дальнего города (иначе за 400 м воздух прозрачный и край облаков виден)
    for name, half in (('PanoFogBox', 1300), ('PanoCloudSea', 1400)):
        o = bpy.data.objects[name]
        xs = [v.co.x for v in o.data.vertices]
        cur = max(abs(x) for x in xs) * o.scale.x
        if cur < half - 1:
            k = half / cur
            for v in o.data.vertices: v.co.x *= k; v.co.y *= k
    return ob


def build_v2(tag, W=4096, samples=32, out=None, step_rate=6.0):
    """Новая версия: дальний город + AgX + огни, рендер Cycles на процессоре тоже возможен (bpy из pip)."""
    if not bpy.data.objects.get('PanoFarCity'): add_far_city()
    set_time(tag)
    P = PANO
    P.render.engine = 'CYCLES'; P.cycles.samples = samples; P.cycles.use_denoising = True
    P.cycles.volume_step_rate = step_rate
    P.render.resolution_x = W; P.render.resolution_y = W // 2; P.render.resolution_percentage = 100
    P.render.image_settings.file_format = 'PNG'; P.render.image_settings.color_depth = '8'
    raw = os.path.join(ROOT, 'art', 'export', 'pano', f'cy_{tag}_{W}.png')
    os.makedirs(os.path.dirname(raw), exist_ok=True)
    P.render.filepath = raw
    bpy.ops.render.render(write_still=True, scene=P.name)
    a = load_rgb(raw)[:, ::-1]
    dst = out or os.path.join(ROOT, 'public', 'textures', f'sky_{tag}.jpg')
    save_jpg(np.ascontiguousarray(a), dst, quality=84)
    return a.shape
