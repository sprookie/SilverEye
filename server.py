#!/usr/bin/env python
"""摄影模拟器本地服务。

    F:\\.venv\\Scripts\\python.exe server.py
    # 然后浏览器打开 http://127.0.0.1:8770

职责：
  1. 托管 web/ 静态站点
  2. /api/providers  —— 生图引擎清单（本地 Qwen / OpenRouter / OpenAI / Gemini / 自定义）
  3. /api/shot       —— 前端把"提示词工程"组装好的提示词丢过来，按选定引擎出图
  4. /api/config     —— 把各家密钥存在服务端（providers.json，已 gitignore），
                        密钥只进不出：GET 只回 has_key 标记，永远不回明文
  5. /api/gallery    —— 出好的图落到 web/assets/gallery/，用 JSON 索引管理

刻意不做的：不做鉴权、不监听 0.0.0.0。要远程用请自己套一层反向代理。
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import Body, FastAPI, HTTPException                     # noqa: E402
from fastapi.middleware.cors import CORSMiddleware                    # noqa: E402
from fastapi.responses import FileResponse, JSONResponse              # noqa: E402
from fastapi.staticfiles import StaticFiles                           # noqa: E402

import qwen_core                                                      # noqa: E402
from providers import base as pbase                                   # noqa: E402
from providers import registry as pregistry                           # noqa: E402

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
GALLERY = WEB / "assets" / "gallery"
INDEX = GALLERY / "index.json"
#: 服务端保存的生图引擎配置（含密钥）。已在 .gitignore 里，绝不会提交。
CONFIG = ROOT / "providers.json"
GALLERY.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="SilverEye Photo Simulator", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------- 引擎配置
def load_config() -> dict[str, Any]:
    if CONFIG.exists():
        try:
            return json.loads(CONFIG.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_config(cfg: dict[str, Any]) -> None:
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")


def saved_key(provider_id: str) -> str:
    return (load_config().get(provider_id) or {}).get("api_key", "")


def merge_provider_config(incoming: dict[str, Any]) -> dict[str, Any]:
    """请求里的配置优先；缺密钥时回落到服务端保存的那份。

    这样前端可以完全不持有密钥 —— 只在设置页里填一次存到服务端，
    之后每次出图都不用再把密钥发来发去。
    """
    pid = (incoming or {}).get("id") or "comfy_qwen"
    cfg = dict(incoming or {})
    if pid != "comfy_qwen" and not (cfg.get("api_key") or "").strip():
        k = saved_key(pid)
        if k:
            cfg["api_key"] = k
    return cfg



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
    return {
        "ok": qwen_core.comfy_online(),
        "comfy_url": qwen_core.COMFY_URL,
        "models": {"unet": qwen_core.UNET, "clip": qwen_core.CLIP, "vae": qwen_core.VAE},
        "gallery_count": len(live_items()),
        "providers": [p.id for p in pregistry.PROVIDERS],
    }


@app.get("/api/providers")
def providers():
    """生图引擎清单 + 常见服务预设。"""
    return pregistry.catalog()


# --------------------------------------------------------------- 连通性探测
# 刻意不把"哪个服务在哪个国家能不能连通"写死：这是运行环境的事，不是产品的事。
# 所以改成实测一次并缓存，谁跑这套代码，看到的就是谁自己网络的真实情况。
#
# 两个坑都踩过：
#   1) requests 的 timeout 会被"多 A 记录重试"成倍放大 —— api.openai.com 10 秒、
#      generativelanguage.googleapis.com 80 秒（16 个地址 × 5s）。
#      所以这里改成裸 TCP connect，并且只试第一个 IPv4 地址。
#   2) 探测本身绝不能阻塞接口 —— 改成后台线程刷新，接口永远立刻返回当前快照。
_REACH: dict[str, Any] = {"at": 0.0, "data": {}, "running": False}
_REACH_LOCK = threading.Lock()
REACH_TTL = 600.0          # 秒


def _probe_tcp(host: str, port: int = 443, timeout: float = 2.5) -> bool:
    """能建起 TCP 连接就算网络可达。不看 HTTP 状态，也不做 TLS 握手。"""
    import socket

    try:
        infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
    except Exception:
        return False
    if not infos:
        return False
    af, st, proto, _, sa = infos[0]          # 只试第一个地址，避免被重试拖死
    s = socket.socket(af, st, proto)
    s.settimeout(timeout)
    try:
        s.connect(sa)
        return True
    except Exception:
        return False
    finally:
        try:
            s.close()
        except Exception:
            pass


def _refresh_reach() -> None:
    from concurrent.futures import ThreadPoolExecutor

    hosts = pregistry.preset_hosts()
    results: dict[str, bool] = {}
    if hosts:
        with ThreadPoolExecutor(max_workers=min(8, len(hosts))) as ex:
            futs = {h: ex.submit(_probe_tcp, h) for h in hosts}
            for h, f in futs.items():
                try:
                    results[h] = bool(f.result(timeout=5.0))
                except Exception:
                    results[h] = False

    presets: dict[str, bool] = {}
    for pr in pregistry.PRESETS:
        if pr["provider"] == "comfy_qwen":
            presets[pr["id"]] = qwen_core.comfy_online()
            continue
        base = (pr.get("base_url") or "").strip()
        if not base:
            continue                                    # 自定义服务没有地址，不做判断
        presets[pr["id"]] = results.get(urlparse(base).netloc, False)

    _REACH["at"] = time.time()
    _REACH["data"] = {"hosts": results, "presets": presets}


def _start_refresh() -> None:
    with _REACH_LOCK:
        if _REACH["running"]:
            return
        _REACH["running"] = True

    def run() -> None:
        try:
            _refresh_reach()
        except Exception:
            pass
        finally:
            with _REACH_LOCK:
                _REACH["running"] = False

    threading.Thread(target=run, daemon=True, name="reach").start()


@app.get("/api/reachability")
def reachability(refresh: int = 0):
    """返回当前网络到各预设端点的实测结果。

    永远立刻返回：数据可能在后台刷新中，此时 `loading` 为 true，
    客户端过一两秒再拉一次即可。
    """
    stale = (time.time() - _REACH["at"]) > REACH_TTL
    if refresh or not _REACH["data"] or stale:
        _start_refresh()
    return JSONResponse({
        **_REACH["data"],
        "checked_at": _REACH["at"],
        "loading": _REACH["running"],
    })


@app.post("/api/provider/probe")
def provider_probe(req: dict[str, Any] = Body(...)):
    """试连一次（尽量不产生费用）。密钥不会回显。"""
    pid = req.get("id") or "comfy_qwen"
    try:
        p = pregistry.get(pid)
    except KeyError as e:
        raise HTTPException(404, str(e))
    cfg = merge_provider_config(req.get("config") or {"id": pid})
    try:
        r = p.probe(cfg)
    except pbase.ProviderError as e:
        return JSONResponse({"ok": False, "detail": str(e)}, status_code=200)
    except Exception as e:
        return JSONResponse({"ok": False, "detail": pbase.redact(e, cfg.get("api_key", ""))},
                            status_code=200)
    r["provider"] = pid
    return JSONResponse(r)


@app.get("/api/config")
def get_config():
    """只回"有没有存密钥"，不回明文。"""
    saved = load_config()
    return {
        "providers": {
            k: {
                "base_url": v.get("base_url", ""),
                "model": v.get("model", ""),
                "has_key": bool(v.get("api_key")),
                "extra_json": v.get("extra_json", ""),
                "quality": v.get("quality", ""),
                "steps": v.get("steps"),
                "cfg": v.get("cfg"),
                "unet": v.get("unet", ""),
                "clip": v.get("clip", ""),
                "vae": v.get("vae", ""),
            }
            for k, v in saved.items()
        },
        "active": saved.get("_active", "comfy_qwen"),
    }


@app.post("/api/config")
def set_config(req: dict[str, Any] = Body(...)):
    """保存引擎配置。

    body: {"active": "openrouter", "providers": {"openrouter": {...}}}
    传 api_key: null 表示保留原密钥，传 "" 表示清除。
    """
    saved = load_config()
    if req.get("active"):
        saved["_active"] = req["active"]
    for pid, cfg in (req.get("providers") or {}).items():
        cur = dict(saved.get(pid) or {})
        cur.update({k: v for k, v in (cfg or {}).items() if k != "api_key"})
        if "api_key" in (cfg or {}):
            if cfg["api_key"] is None:
                pass                                   # 保留原值
            else:
                cur["api_key"] = cfg["api_key"]
        saved[pid] = cur
    save_config(saved)
    return {"ok": True, "saved": sorted(k for k in saved if k != "_active")}


@app.post("/api/shot")
def shot(req: dict[str, Any] = Body(...)):
    """出一张"照片"。

    请求体：
      prompt / negative_prompt / width / height / steps / cfg / seed
      provider: {id, api_key, base_url, model, extra_json, ...}
      meta:     任意 JSON，原样存进画廊索引（机身、光圈、快门、胶片、算出来的景深……）
    """
    prompt = (req.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "prompt 不能为空")

    pin = req.get("provider") or {}
    pid = pin.get("id") or "comfy_qwen"
    try:
        prov = pregistry.get(pid)
    except KeyError as e:
        raise HTTPException(404, str(e))
    cfg = merge_provider_config(pin)

    greq = pbase.GenRequest(
        prompt=prompt,
        negative_prompt=req.get("negative_prompt", "") or "",
        width=int(req.get("width", 1024)),
        height=int(req.get("height", 1024)),
        steps=int(req.get("steps", 25)),
        cfg=float(req.get("cfg", 1.0)),
        seed=(None if req.get("seed") in (None, "", -1) else int(req["seed"])),
    )

    t0 = time.time()
    try:
        res = prov.generate(cfg, greq)
    except pbase.ProviderError as e:
        raise HTTPException(502, pbase.redact(str(e), cfg.get("api_key", "")))
    except (RuntimeError, TimeoutError, ValueError) as e:
        raise HTTPException(502, pbase.redact(e, cfg.get("api_key", "")))
    elapsed = round(time.time() - t0, 1)

    sid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    name = f"{sid}.png"
    (GALLERY / name).write_bytes(res.png)

    w, h = res.size if res.size and res.size[0] else (greq.width, greq.height)
    item = {
        "id": sid,
        "file": name,
        "url": f"/assets/gallery/{name}",
        "seed": res.seed,
        "elapsed": elapsed,
        "created": int(time.time()),
        "width": w,
        "height": h,
        "prompt": prompt,
        "negative_prompt": req.get("negative_prompt", "") or "",
        "meta": dict(req.get("meta") or {}, engine=prov.label, engine_id=prov.id,
                     engine_model=res.model, revised_prompt=res.revised_prompt),
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

    _start_refresh()          # 预热：后台先探一次，用户打开面板时通常已有结果

    print(f"\n  SilverEye 摄影模拟器  ->  http://{a.host}:{a.port}\n")
    print(f"  ComfyUI   : {qwen_core.COMFY_URL}   ({'在线' if qwen_core.comfy_online() else '未连接'})")
    print(f"  画廊目录  : {GALLERY}")
    print("  按 Ctrl+C 停止\n")
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
