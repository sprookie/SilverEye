#!/usr/bin/env python
"""摄影模拟器本地服务。

    F:\\.venv\\Scripts\\python.exe server.py
    # 然后浏览器打开 http://127.0.0.1:8770

职责只有三件事：
  1. 托管 web/ 静态站点
  2. /api/shot   —— 前端把"提示词工程"组装好的提示词丢过来，这里直连 ComfyUI 出图
  3. /api/gallery —— 把出好的图落到 web/assets/gallery/，用一个 JSON 索引管理

刻意不做的：不做鉴权、不监听 0.0.0.0。要远程用请自己套一层反向代理。
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import Body, FastAPI, HTTPException                     # noqa: E402
from fastapi.middleware.cors import CORSMiddleware                    # noqa: E402
from fastapi.responses import FileResponse, JSONResponse              # noqa: E402
from fastapi.staticfiles import StaticFiles                           # noqa: E402

import qwen_core                                                      # noqa: E402

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
GALLERY = WEB / "assets" / "gallery"
INDEX = GALLERY / "index.json"
GALLERY.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="SilverEye Photo Simulator", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------- 画廊索引
def load_index() -> list[dict[str, Any]]:
    if INDEX.exists():
        try:
            return json.loads(INDEX.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def save_index(items: list[dict[str, Any]]) -> None:
    INDEX.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")


def live_items() -> list[dict[str, Any]]:
    """只返回文件确实还在的条目。

    索引可能残留已经被 .gitignore 掉或手动删掉的照片（比如刚 clone 下来的仓库），
    前端不该拿到一堆打不开的链接。
    """
    return [it for it in load_index() if (GALLERY / str(it.get("file", ""))).exists()]


# --------------------------------------------------------------------- API
@app.get("/api/status")
def status():
    online = qwen_core.comfy_online()
    return {
        "ok": online,
        "comfy_url": qwen_core.COMFY_URL,
        "models": {"unet": qwen_core.UNET, "clip": qwen_core.CLIP, "vae": qwen_core.VAE},
        "gallery_count": len(live_items()),
    }


@app.post("/api/shot")
def shot(req: dict[str, Any] = Body(...)):
    """出一张"照片"。

    请求体：
      prompt / negative_prompt / width / height / steps / cfg / seed
      meta: 任意 JSON，会原样存进画廊索引（机身、光圈、快门、胶片、算出来的景深……）
    """
    prompt = (req.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "prompt 不能为空")

    t0 = time.time()
    try:
        res = qwen_core.generate_image(
            prompt=prompt,
            negative_prompt=req.get("negative_prompt", ""),
            width=int(req.get("width", 1152)),
            height=int(req.get("height", 864)),
            steps=int(req.get("steps", 25)),
            cfg=float(req.get("cfg", 1.0)),
            seed=int(req.get("seed", -1)),
            filename_prefix="photosim",
        )
    except (RuntimeError, TimeoutError, ValueError) as e:
        raise HTTPException(502, str(e))

    sid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    name = f"{sid}.png"
    (GALLERY / name).write_bytes(res["png"])

    item = {
        "id": sid,
        "file": name,
        "url": f"/assets/gallery/{name}",
        "seed": res["seed"],
        "elapsed": round(time.time() - t0, 1),
        "created": int(time.time()),
        "width": res["params"]["width"],
        "height": res["params"]["height"],
        "prompt": prompt,
        "negative_prompt": req.get("negative_prompt", ""),
        "meta": req.get("meta") or {},
        "label": req.get("label") or "",
    }
    items = load_index()
    items.insert(0, item)
    save_index(items[:400])
    return JSONResponse(item)


@app.get("/api/gallery")
def gallery(limit: int = 120):
    return {"items": live_items()[:limit]}


@app.delete("/api/gallery/{sid}")
def gallery_delete(sid: str):
    items = load_index()
    keep, gone = [], None
    for it in items:
        if it["id"] == sid:
            gone = it
        else:
            keep.append(it)
    if not gone:
        raise HTTPException(404, "没有这张照片")
    try:
        (GALLERY / gone["file"]).unlink(missing_ok=True)
    except Exception:
        pass
    save_index(keep)
    return {"ok": True}


@app.delete("/api/gallery")
def gallery_clear():
    items = load_index()
    for it in items:
        try:
            (GALLERY / it["file"]).unlink(missing_ok=True)
        except Exception:
            pass
    save_index([])
    return {"ok": True, "removed": len(items)}


@app.get("/")
def root():
    return FileResponse(WEB / "index.html")


app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")


def main() -> int:
    import argparse

    import uvicorn

    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8770)
    a = ap.parse_args()

    print(f"\n  SilverEye 摄影模拟器  ->  http://{a.host}:{a.port}\n")
    print(f"  ComfyUI   : {qwen_core.COMFY_URL}   ({'在线' if qwen_core.comfy_online() else '未连接'})")
    print(f"  画廊目录  : {GALLERY}")
    print("  按 Ctrl+C 停止\n")
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
