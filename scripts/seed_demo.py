#!/usr/bin/env python
"""生成一组演示作品，写进画廊索引，让模拟器第一次打开时胶卷里就有东西。

提示词的组装顺序与 web/js/engine.js 一致，测光/景深/视角也与 optics() 一致，
所以灯箱里显示的 EXIF 和前端算出来的分毫不差（含滤镜减光）。

DEMOS 里每条的 ev 是该场景的真实环境 EV100，aperture/shutter/iso 是"测光正确"的组合，
所以每张的测光偏差都落在 ±0.2 EV 内。
"""
from __future__ import annotations

import io
import json
import math
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image                       # noqa: E402
from qwen_core import generate_image        # noqa: E402

GALLERY = ROOT / "web" / "assets" / "gallery"
GALLERY.mkdir(parents=True, exist_ok=True)
INDEX = GALLERY / "index.json"

NEG_BASE = ("cartoon, illustration, anime, 3d render, cgi, painting, drawing, sketch, "
            "watermark, text, signature, logo, username, lowres, jpeg artifacts, "
            "deformed hands, extra fingers, mutated anatomy, oversaturated hdr, plastic skin")
NEG_COLOR = ", black and white, monochrome, grayscale, heavy film grain"
NEG_BW = ", colour, colorful, saturated color, sepia tone, heavy film grain"

# 弥散圈 c / 感光面宽 (mm) / 画幅比
FORMAT = {
    "ff": (0.029, 36, 3 / 2), "apsc": (0.019, 23.5, 3 / 2), "mft": (0.015, 17.3, 4 / 3),
    "mf44": (0.037, 44, 4 / 3), "mf66": (0.053, 56, 1), "mf67": (0.059, 70, 7 / 6),
    "lf45": (0.100, 102, 5 / 4), "phone": (0.007, 9.8, 4 / 3),
}
FILTER_STOPS = {"none": 0, "cpl": -1.5, "nd6": -3, "nd10": -10, "gnd": -1, "soft": -0.4,
                "star": -0.3, "ir": -3}
SHUTTER_LABEL = {
    1 / 8000: "1/8000", 1 / 4000: "1/4000", 1 / 2000: "1/2000", 1 / 1000: "1/1000",
    1 / 500: "1/500", 1 / 250: "1/250", 1 / 125: "1/125", 1 / 60: "1/60", 1 / 30: "1/30",
    1 / 15: "1/15", 1 / 8: "1/8", 1 / 4: "1/4", 1 / 2: "1/2", 1: "1s", 2: "2s", 4: "4s",
    8: "8s", 15: "15s", 30: "30s", 120: "2min (B门)", 600: "10min (B门)",
}


def shutter_t(sec: float) -> float:
    return min(SHUTTER_LABEL.keys(), key=lambda x: abs(math.log(x) - math.log(sec)))


def measure(f, N, c, sensor_w, dist, ev, iso, filt="none"):
    """与 engine.js 的 optics() 同一套公式。"""
    d = max(0.05, dist) * 1000
    H = f * f / (N * c) + f
    near = d * (H - f) / (H + d - 2 * f) / 1000
    far = (d * (H - f) / (H - d) / 1000) if d < H else math.inf
    fov = 2 * math.atan(sensor_w / (2 * f)) * 180 / math.pi
    return near, far, fov, H / 1000, ev + FILTER_STOPS.get(filt, 0)


_COMMON = {"comp": "三分法", "technique": "none"}

DEMOS: list[dict] = [
    dict(
        file="demo-01-neon.jpg", scene="雨夜霓虹", scene_id="neon-night",
        body="尼康 FM2", body_id="fm2", fmt="ff",
        focal=50, aperture=1.4, shutter=1 / 125, iso=800, ev=5, filter="none", dist=6,
        film="CineStill 800T（电影卷）", film_id="cinestill800t", film_short="CineStill", bw=False,
        tech="常规拍摄",
        prompt=(
            "rain-soaked city street at night, walls of glowing neon signs in Japanese and Chinese "
            "reflecting in the wet asphalt, pedestrians with umbrellas silhouetted against the light, "
            "steam rising from a vent, composed with the subject placed on a rule-of-thirds intersection, "
            "off-centre and balanced, 50mm standard lens, perspective closest to human vision, standard "
            "framing, the subject filling about half the frame, aperture wide open at f/1.4, extremely "
            "shallow depth of field, background melted into creamy bokeh, shutter speed 1/125s, safe "
            "handheld speed for careful technique, CineStill 800T tungsten-balanced motion picture film, "
            "glowing red halation blooming around highlights, cyan teal shadows, neon night cinematic look, "
            "teal shadows, glowing red halation around lights, cinematic neon, exposed at ISO 800, mixed "
            "artificial light sources at night, deep shadows, glowing highlights, shot on a Nikon FM2 35mm "
            "film SLR with a Nikkor lens, mechanical film camera, hand-framed, photorealistic, professional "
            "photograph, highly detailed, natural lighting, realistic textures"),
    ),
    dict(
        file="demo-02-portrait.jpg", scene="老人肖像", scene_id="elder",
        body="佳能 EOS R5", body_id="r5", fmt="ff",
        focal=85, aperture=1.4, shutter=1 / 250, iso=400, ev=7, filter="none", dist=1.8,
        film="柯达 Portra 400", film_id="portra400", film_short="Kodak", bw=False,
        tech="伦勃朗光",
        prompt=(
            "intimate portrait of an elderly craftsman with deeply lined hands and weathered face, looking "
            "down at his work, soft window light from the side, every wrinkle and pore rendered with dignity, "
            "Rembrandt lighting, a single light at 45 degrees above and to the side, forming a small inverted "
            "triangle of light on the shadowed cheek, the subject framed within a natural frame such as a "
            "doorway, arch or window, adding depth and enclosure, 85mm portrait lens, flattering compression, "
            "subject isolated from background, tight framing, the subject filling the frame with a clean "
            "compressed background, aperture wide open at f/1.4, extremely shallow depth of field, background "
            "melted into creamy bokeh, shutter speed 1/250s, typical flash sync, mild motion registration, "
            "Kodak Portra 400 colour negative film, famous warm skin tones, fine natural grain, wide exposure "
            "latitude, low saturation elegance, warm flattering skin tones, muted elegant saturation, fine "
            "grain, exposed at ISO 400, shot on a Canon EOS R5 full-frame mirrorless, Canon colour science, "
            "clean modern digital rendering, photorealistic, professional photograph, highly detailed, natural "
            "lighting, realistic textures"),
    ),
    dict(
        file="demo-03-seaside.jpg", scene="海岸礁石", scene_id="seaside",
        body="尼康 D850", body_id="d850", fmt="ff",
        focal=24, aperture=16, shutter=30, iso=100, ev=13, filter="nd10", dist=30,
        film="数码原始文件", film_id="digital", film_short="RAW", bw=False,
        tech="长时间曝光",
        prompt=(
            "rocky coastline with black volcanic boulders under a dramatic clearing sky, waves washing over "
            "dark wet rocks, sea spray suspended in the air, long exposure photograph, time compressed into a "
            "single frame, water smoothed to glass, clouds streaked into ribbons, layered composition with a "
            "distinct foreground, midground and background creating depth and narrative, 24mm wide angle lens, "
            "environmental context with mild edge stretching, wide environmental framing, the subject placed "
            "within its full surroundings, aperture at f/16, extremely deep depth of field, sunstars radiating "
            "from bright highlights, shutter speed 30 seconds, extreme long exposure, clouds smeared into "
            "streaks, water like mist, 10-stop neutral density filter, enabling multi-second exposures in "
            "bright daylight, digital capture, exposed at ISO 100, natural landscape light with clear depth "
            "and atmospheric layering, shot on a Nikon D850 DSLR, optical viewfinder framing, high dynamic "
            "range digital file, photorealistic, professional photograph, highly detailed, natural lighting, "
            "realistic textures"),
    ),
    dict(
        file="demo-04-panning.jpg", scene="公路自行车", scene_id="sport-cycle",
        body="尼康 Z9", body_id="z9", fmt="ff",
        focal=200, aperture=5.6, shutter=1 / 30, iso=100, ev=10, filter="none", dist=12,
        film="数码原始文件", film_id="digital", film_short="RAW", bw=False,
        tech="追随拍摄（摇拍）",
        prompt=(
            "a road cyclist sprinting out of the saddle, muscle definition and tendons straining, water "
            "bottle rattling, sweat spray, motion implied by the body position, panning shot with the camera "
            "tracking the moving subject, the subject is pin sharp while the background is smeared into long "
            "horizontal motion blur streaks, composed with the subject placed on a rule-of-thirds "
            "intersection, off-centre and balanced, 200mm telephoto lens, tight framing, heavily compressed "
            "perspective, telephoto crop, the subject isolated and enlarged, background crushed into a flat "
            "blur, aperture at f/5.6, moderate depth of field, lens at its optical sweet spot, shutter speed "
            "1/30s, moving subjects show clear directional motion blur, digital capture, exposed at ISO 100, "
            "clear late afternoon light, low and directional, shot on a Nikon Z9 flagship full-frame "
            "mirrorless, crisp neutral rendering, esports-grade high-speed capture, photorealistic, "
            "professional photograph, highly detailed, natural lighting, realistic textures"),
    ),
    dict(
        file="demo-05-bw.jpg", scene="街头纪实", scene_id="street-doc",
        body="徕卡 M6", body_id="m6", fmt="ff",
        focal=35, aperture=5.6, shutter=1 / 250, iso=400, ev=11, filter="none", dist=8,
        film="柯达 Tri-X 400（黑白）", film_id="tri-x400", film_short="Kodak", bw=True,
        tech="常规拍摄",
        prompt=(
            "a decisive-moment street photograph, a man stepping over a puddle mid-stride, his reflection "
            "perfect in the still water, layered pedestrians and signage behind him, complex urban "
            "choreography, composed with the subject placed on a rule-of-thirds intersection, off-centre and "
            "balanced, 35mm lens, the classic documentary focal length, subject and environment in balance, "
            "medium framing, subject and environment given roughly equal weight, aperture at f/5.6, moderate "
            "depth of field, lens at its optical sweet spot, shutter speed 1/250s, typical flash sync, mild "
            "motion registration, Kodak Tri-X 400 black and white negative film, gritty documentary grain, "
            "rich silver blacks, legendary photojournalism look, black and white photograph, monochrome, "
            "grayscale, rich silver gelatin blacks, gritty grain, classic reportage tonality, exposed at ISO "
            "400, uncontrolled available light, honest documentary illumination, shot on a Leica M6 35mm "
            "rangefinder with a Summicron lens, Leica glow and micro-contrast, discreet documentary framing, "
            "photorealistic, professional photograph, highly detailed, natural lighting, realistic textures, "
            "fine art monochrome"),
    ),
    dict(
        file="demo-06-velvia.jpg", scene="沙漠沙丘", scene_id="desert",
        body="玛米亚 RB67", body_id="rb67", fmt="mf67",
        focal=200, aperture=11, shutter=1 / 125, iso=50, ev=15, filter="none", dist=200,
        film="富士 Velvia 50", film_id="velvia50", film_short="Fujifilm", bw=False,
        tech="黄金时刻",
        prompt=(
            "abstract sand dunes in late afternoon, one sharp sinuous ridge curving across the frame, "
            "wind-blown sand streaming off the crest, razor-sharp light-shadow boundary, minimalist "
            "composition, photographed during golden hour, the low sun raking across the scene in warm amber "
            "light, long soft shadows stretching toward the camera, strong leading lines drawing the eye from "
            "the foreground into the depth of the frame toward the subject, 200mm telephoto lens, tight "
            "framing, heavily compressed perspective, medium format 6x7 large-format optical rendering, "
            "telephoto crop, the subject isolated and enlarged, background crushed into a flat blur, aperture "
            "at f/11, very deep depth of field, landscape-grade focus from foreground to horizon, shutter "
            "speed 1/125s, safe handheld speed for careful technique, Fujifilm Velvia 50 slide film, "
            "legendary hyper-saturated landscape colour, deep ruby reds and emerald greens, high contrast, "
            "ultra fine grain, hyper-saturated deep colour, high contrast, velvet blacks, exposed at ISO 50, "
            "natural landscape light with clear depth and atmospheric layering, shot on a Mamiya RB67 medium "
            "format 6x7 film camera, huge 6x7 negative, incredible tonality, photorealistic, professional "
            "photograph, highly detailed, natural lighting, realistic textures"),
    ),
]


def main() -> int:
    items: list[dict] = []
    if INDEX.exists():
        try:
            items = json.loads(INDEX.read_text(encoding="utf-8"))
        except Exception:
            items = []
    items = [it for it in items if not it.get("id", "").startswith("demo-")]

    only = sys.argv[1:]
    for d in DEMOS:
        if only and d["file"] not in only:
            continue
        dest = GALLERY / d["file"]
        c, sw, ratio = FORMAT[d["fmt"]]
        near, far, fov, hyper, ev_eff = measure(
            d["focal"], d["aperture"], c, sw, d["dist"], d["ev"], d["iso"], d["filter"])
        dof_txt = f"{near:.2f}m → ∞" if far == math.inf else f"{near:.2f}–{far:.2f}m"
        ev_set = math.log2(d["aperture"] ** 2 / d["shutter"]) - math.log2(d["iso"] / 100)
        bias = ev_eff - ev_set

        neg = NEG_BASE + (NEG_BW if d["bw"] else NEG_COLOR)
        t0 = time.time()
        try:
            r = generate_image(prompt=d["prompt"], negative_prompt=neg,
                               width=1408, height=int(round(1408 / ratio / 32) * 32),
                               steps=25, cfg=1.0, seed=-1)
        except Exception as e:
            print(f"[ERR] {d['file']}: {e}", flush=True)
            continue
        Image.open(io.BytesIO(r["png"])).convert("RGB").save(dest, "JPEG", quality=90, optimize=True)

        items.append({
            "id": "demo-" + uuid.uuid4().hex[:8],
            "file": d["file"],
            "url": f"/assets/gallery/{d['file']}",
            "seed": r["seed"],
            "elapsed": round(time.time() - t0, 1),
            "created": int(time.time()),
            "width": 1408,
            "height": int(round(1408 / ratio / 32) * 32),
            "prompt": d["prompt"],
            "negative_prompt": neg,
            "label": d["scene"],
            "meta": {
                "sceneCn": d["scene"], "bodyCn": d["body"],
                "focal": d["focal"], "equiv": round(d["focal"] * 36 / sw),
                "aperture": f"f/{d['aperture']:g}",
                "shutter": SHUTTER_LABEL[shutter_t(d["shutter"])],
                "iso": d["iso"], "filmCn": d["film"], "filmShort": d["film_short"], "bw": d["bw"],
                "techCn": d["tech"], "compCn": "三分法",
                "dist": f"{d['dist']:g}m", "fov": f"{fov:.1f}°", "dof": dof_txt,
                "meter": f"{bias:+.1f} EV", "aspect": ratio,
            },
            "state": {
                "scene": d["scene_id"], "body": d["body_id"], "lens": d["focal"],
                "lensMod": "none", "aperture": d["aperture"], "shutter": shutter_t(d["shutter"]),
                "iso": d["iso"], "film": d["film_id"], "filter": d["filter"], "flash": "none",
                "technique": "none", "composition": "thirds", "dist": d["dist"],
                "steps": 25, "extra": "", "evComp": 0,
            },
        })
        INDEX.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[OK] {d['file']}  {dest.stat().st_size//1024:4d}KB  {time.time()-t0:5.1f}s  "
              f"fov={fov:5.1f}  f/{d['aperture']:g} {SHUTTER_LABEL[shutter_t(d['shutter'])]} "
              f"ISO{d['iso']}  dof={dof_txt}  bias={bias:+.2f}EV", flush=True)

    print(f"完成，画廊共 {len(items)} 张", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
