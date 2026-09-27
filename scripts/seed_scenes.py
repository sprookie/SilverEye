#!/usr/bin/env python
"""为每个场景生成一张"取景器底图"。

思路：模拟器里的取景器要一直有东西可看，所以每个场景需要一张广角的环境照
（等价于 28mm / f5.6 的现场视角），前端再根据用户选的焦距做真实视角缩放。

输出：web/assets/scenes/<id>.jpg   +  web/assets/scenes/index.json
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image                       # noqa: E402
from qwen_core import generate_image        # noqa: E402

OUT = ROOT / "web" / "assets" / "scenes"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1536, 1024

NEG = ("text, watermark, signature, logo, letters, caption, frame, border, "
       "cartoon, illustration, anime, 3d render, cgi, painting, drawing, "
       "lowres, jpeg artifacts, deformed, extra limbs, blurry mess, oversaturated hdr")

SUFFIX = ("wide establishing view of the whole scene, shot on a 28mm lens at f/5.6, "
          "deep depth of field, natural balanced lighting, photorealistic, highly detailed, "
          "professional photograph, clean composition")


def scene_list() -> list[tuple[str, str]]:
    """从 scenes.js 里抠出 id 与英文 prompt（避免再维护一份数据）。"""
    js = (ROOT / "web" / "js" / "scenes.js").read_text(encoding="utf-8")
    body = js.split("window.SCENES", 1)[1]
    out = []
    for m in re.finditer(r"id:\s*'([\w-]+)',\s*cn:\s*'[^']*',\s*cat:\s*'[^']*',[^}]*?prompt:\s*'((?:[^'\\]|\\.)*)'", body, re.S):
        sid, prompt = m.group(1), m.group(2).replace("\\'", "'")
        out.append((sid, prompt))
    return out


def save_jpg(png: bytes, path: Path, quality: int = 88) -> int:
    im = Image.open(io.BytesIO(png)).convert("RGB")
    im.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    return path.stat().st_size


def main() -> int:
    only = sys.argv[1:] or None
    scenes = scene_list()
    print(f"共 {len(scenes)} 个场景", flush=True)
    meta = {}
    idx_path = OUT / "index.json"
    if idx_path.exists():
        try:
            meta = json.loads(idx_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}

    for i, (sid, prompt) in enumerate(scenes, 1):
        if only and sid not in only:
            continue
        dest = OUT / f"{sid}.jpg"
        if dest.exists() and not only:
            print(f"[{i}/{len(scenes)}] skip {sid}（已存在）", flush=True)
            continue
        t0 = time.time()
        try:
            r = generate_image(prompt=f"{prompt}, {SUFFIX}", negative_prompt=NEG,
                               width=W, height=H, steps=25, cfg=1.0, seed=-1)
            size = save_jpg(r["png"], dest)
            meta[sid] = {"file": f"{sid}.jpg", "seed": r["seed"], "prompt": prompt}
            idx_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"[{i}/{len(scenes)}] ok  {sid:22s} {size//1024:4d}KB  {time.time()-t0:5.1f}s", flush=True)
        except Exception as e:
            print(f"[{i}/{len(scenes)}] ERR {sid}: {e}", flush=True)
    print("完成", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
