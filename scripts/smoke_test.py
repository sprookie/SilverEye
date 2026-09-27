import sys, time, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from qwen_core import generate_image, comfy_online

TESTS = [
    ("A_dof", "Photograph of an elderly craftsman's hands carving a wooden bird, shot on a 85mm f/1.4 lens wide open at f/1.4, extremely shallow depth of field, background completely melted into creamy bokeh, only the fingertips in razor sharp focus, warm afternoon window light, Kodak Portra 400 film, natural skin texture, photorealistic documentary photography", 1152, 864, 41),
    ("B_panning", "Action photograph of a cyclist sprinting through a sunlit city street, panning shot with the camera tracking the rider, the cyclist is tack sharp while the background is streaked into horizontal motion blur lines, 1/30s shutter speed, shot on 200mm telephoto, vibrant color, dynamic energy, photojournalism, photorealistic", 1152, 864, 42),
    ("C_longexp", "Long exposure photograph of a rocky coastline at sunset, a 30 second exposure turning the ocean into a silky smooth mist around black volcanic rocks, 10-stop neutral density filter, deep saturated colors, graduated neutral density holding the bright sky, large format 4x5 detail, Fujifilm Velvia 50 slide film, ultra sharp, photorealistic landscape photography", 1152, 864, 43),
]

print("comfy online:", comfy_online(), flush=True)
out = os.path.join(ROOT, "web", "assets", "samples")
os.makedirs(out, exist_ok=True)
for name, prompt, w, h, seed in TESTS:
    t0 = time.time()
    r = generate_image(prompt=prompt, width=w, height=h, steps=25, cfg=1.0, seed=seed)
    path = os.path.join(out, name + ".png")
    open(path, "wb").write(r["png"])
    print(f"[OK] {name}  {len(r['png'])/1024:.0f}KB  {time.time()-t0:.1f}s  -> {path}", flush=True)
