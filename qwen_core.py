#!/usr/bin/env python
"""Qwen-Image 2.1 直连核心（不经过 8600 封装层）。

为什么直连 ComfyUI：
  1. 少一层进程，少一个要维护的常驻服务；
  2. 可以显式 `trust_env = False`，避免系统/沙箱的 http_proxy 把 127.0.0.1 的请求
     也代理出去（这是本项目踩过的坑：代理会把 localhost 请求转成
     "upstream connect failed: 目标计算机积极拒绝"）。

对外只暴露一个函数：`generate_image(**params) -> dict`
"""
from __future__ import annotations

import io
import os
import random
import threading
import time
import uuid
from typing import Any

import requests

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
COMFY_URL = os.environ.get("PHOTOSIM_COMFY_URL", os.environ.get("QWEN21_COMFY_URL", "http://127.0.0.1:8000"))

UNET = os.environ.get("PHOTOSIM_UNET", os.environ.get("QWEN21_UNET", "qwen_image_2.1_int8_convrot.safetensors"))
CLIP = os.environ.get("PHOTOSIM_CLIP", os.environ.get("QWEN21_CLIP", "qwen3vl_8b_int8_convrot.safetensors"))
VAE = os.environ.get("PHOTOSIM_VAE", os.environ.get("QWEN21_VAE", "qwen_image_2.1_vae_bf16.safetensors"))

JOB_TIMEOUT = int(os.environ.get("PHOTOSIM_TIMEOUT", "900"))

DEFAULTS: dict[str, Any] = {
    "prompt": "",
    "negative_prompt": "",
    "width": 1152,
    "height": 864,
    "batch_size": 1,
    "steps": 25,
    "cfg": 1.0,
    "sampler": "euler",
    "scheduler": "simple",
    "resolution": 1024,
    "seed": -1,
    "filename_prefix": "photosim",
}

#: 单卡 3090 跑 7B DiT + 8B 编码器不能并发，用信号量串行化
_SEM = threading.BoundedSemaphore(int(os.environ.get("PHOTOSIM_CONCURRENCY", "1")))


def session() -> requests.Session:
    """返回一个绕过系统代理的 session。"""
    s = requests.Session()
    s.trust_env = False          # 关键：忽略 http_proxy / https_proxy / no_proxy
    s.proxies = {"http": None, "https": None}
    return s


_S = session()


def build_workflow(p: dict[str, Any]) -> dict[str, Any]:
    """把请求参数拼成 ComfyUI API 格式的工作流（与 qwen21_api 完全一致）。"""
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": p.get("unet", UNET), "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": p.get("clip", CLIP), "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": p.get("vae", VAE)}},
        "4": {"class_type": "TextEncodeQwenImage21",
              "inputs": {"clip": ["2", 0], "prompt": p["prompt"],
                         "negative_prompt": p.get("negative_prompt", ""),
                         "resolution": int(p.get("resolution", 1024))}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": int(p["width"]), "height": int(p["height"]),
                         "batch_size": int(p.get("batch_size", 1))}},
        "6": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["4", 1],
                         "latent_image": ["5", 0], "seed": int(p["seed"]),
                         "steps": int(p["steps"]), "cfg": float(p["cfg"]),
                         "sampler_name": p.get("sampler", "euler"),
                         "scheduler": p.get("scheduler", "simple"), "denoise": 1.0}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage",
              "inputs": {"images": ["7", 0], "filename_prefix": p.get("filename_prefix", "photosim")}},
    }


def normalize(req: dict[str, Any]) -> dict[str, Any]:
    p = dict(DEFAULTS)
    p.update({k: v for k, v in (req or {}).items() if v is not None})
    if not str(p.get("prompt", "")).strip():
        raise ValueError("prompt 不能为空")
    if p["seed"] is None or int(p["seed"]) < 0:
        p["seed"] = random.randint(0, 2**31 - 1)
    for k in ("width", "height"):
        p[k] = max(256, min(4096, int(p[k]) // 32 * 32))
    return p


def _url(path: str) -> str:
    return COMFY_URL.rstrip("/") + path


def comfy_online() -> bool:
    try:
        return requests.get(_url("/system_stats"), timeout=5).status_code == 200
    except Exception:
        return False


def submit(p: dict[str, Any]) -> str:
    body = {"prompt": build_workflow(p), "client_id": str(uuid.uuid4())}
    r = _S.post(_url("/prompt"), json=body, timeout=60)
    if r.status_code != 200:
        detail = r.text[:2000]
        try:
            j = r.json()
            detail = j.get("error", {}).get("message", detail)
            if j.get("node_errors"):
                detail += " | node_errors=" + str(j["node_errors"])[:800]
        except Exception:
            pass
        raise RuntimeError(f"ComfyUI 拒绝任务 (HTTP {r.status_code}): {detail}")
    pid = r.json().get("prompt_id")
    if not pid:
        raise RuntimeError(f"ComfyUI 返回异常: {r.text[:500]}")
    return pid


def wait(pid: str, timeout: int = JOB_TIMEOUT) -> dict[str, Any]:
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = _S.get(_url(f"/history/{pid}"), timeout=30)
        if r.status_code == 200:
            rec = r.json().get(pid)
            if rec:
                status = (rec.get("status") or {}).get("status_str", "")
                if status == "error":
                    msgs = (rec.get("status") or {}).get("messages") or []
                    raise RuntimeError(f"生成失败: {str(msgs)[:1200]}")
                if rec.get("outputs"):
                    rec["_elapsed"] = round(time.time() - t0, 2)
                    return rec
        time.sleep(0.8)
    raise TimeoutError(f"等待超时（{timeout}s），prompt_id={pid}")


def _fetch(item: dict[str, Any]) -> bytes:
    r = _S.get(_url("/view"), params={"filename": item["filename"],
                                      "subfolder": item.get("subfolder", ""),
                                      "type": item.get("type", "output")}, timeout=180)
    r.raise_for_status()
    return r.content


def generate_image(**kwargs: Any) -> dict[str, Any]:
    """提交 → 等待 → 取图。返回 {seed, elapsed, png: bytes, params: {...}}。"""
    p = normalize(kwargs)
    with _SEM:
        pid = submit(p)
        rec = wait(pid, timeout=int(kwargs.get("timeout") or JOB_TIMEOUT))
    outs: list[dict[str, Any]] = []
    for node_id, node_out in (rec.get("outputs") or {}).items():
        for img in node_out.get("images") or []:
            outs.append({"filename": img.get("filename"), "subfolder": img.get("subfolder", ""),
                         "type": img.get("type", "output"), "node_id": node_id})
    if not outs:
        raise RuntimeError("任务完成但没有输出图片")
    return {"prompt_id": pid, "seed": p["seed"], "elapsed": rec.get("_elapsed"),
            "png": _fetch(outs[0]), "params": p}


__all__ = ["generate_image", "comfy_online", "normalize", "COMFY_URL"]
