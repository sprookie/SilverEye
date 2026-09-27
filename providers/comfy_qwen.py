"""本地 Qwen-Image 2.1（ComfyUI）—— 默认引擎，零 API 费用、支持负向提示词与种子。"""
from __future__ import annotations

from typing import Any

from .base import GenRequest, GenResult, Provider, ProviderError, session, redact


class ComfyQwen(Provider):
    id = "comfy_qwen"
    label = "本地 Qwen-Image 2.1"
    vendor = "ComfyUI"
    note = "本机 ComfyUI 上的 Qwen-Image 2.1。支持负向提示词与随机种子，不产生 API 费用。"
    docs = "https://github.com/comfyanonymous/ComfyUI"
    default_base = "http://127.0.0.1:8000"
    default_model = "qwen_image_2.1_int8_convrot"
    models = [
        "qwen_image_2.1_int8_convrot",
        "qwen_image_2.1_bf16 (需 QWEN21_UNET 环境变量配合)",
    ]
    key_hint = "本机服务无需密钥"
    #: 负向、种子、步数、cfg 全都支持 —— 是四个 provider 里最完整的一个
    caps = {
        "negative": True, "seed": True, "steps": True, "cfg": True,
        "sizes": [], "needs_key": False, "needs_base": False,
        "max_prompt": 0, "native_ratio": True,
        "steps_default": 25, "cfg_default": 1.0,
    }
    fields = ["base_url", "steps", "cfg", "unet", "clip", "vae"]

    def build_request(self, cfg: dict[str, Any], req: GenRequest) -> dict[str, Any]:
        # 真正的工作流在 qwen_core 里，这里只是占位，保证接口一致
        return {"method": "POST", "url": (cfg.get("base_url") or self.default_base).rstrip("/") + "/prompt",
                "headers": {}, "json": {}, "params": {}}

    def parse_response(self, payload: Any, sess=None) -> dict[str, Any]:
        return {"image": ""}

    def probe(self, cfg: dict[str, Any]) -> dict[str, Any]:
        base = (cfg.get("base_url") or self.default_base).rstrip("/")
        try:
            r = session().get(base + "/system_stats", timeout=12)
        except Exception as e:
            return {"ok": False, "detail": f"连不上 ComfyUI（{base}）：{e}"}
        if r.status_code != 200:
            return {"ok": False, "detail": f"ComfyUI 返回 HTTP {r.status_code}"}
        try:
            j = r.json()
        except Exception:
            return {"ok": False, "detail": "ComfyUI 返回了非 JSON 内容"}
        dev = (j.get("devices") or [{}])[0]
        vram = dev.get("vram_total")
        free = dev.get("vram_free")
        detail = f"ComfyUI {j.get('system', {}).get('comfyui_version', '?')}"
        if vram:
            detail += f" · 显存 {free / 1e9:.1f}G / {vram / 1e9:.1f}G 可用"
        return {"ok": True, "detail": detail}

    # ------------------------------------------------------------------ 真实出图
    def generate(self, cfg: dict[str, Any], req: GenRequest) -> GenResult:
        import qwen_core

        base = (cfg.get("base_url") or self.default_base).rstrip("/")
        old = qwen_core.COMFY_URL
        qwen_core.COMFY_URL = base
        if cfg.get("unet"):
            qwen_core.UNET = cfg["unet"]
        if cfg.get("clip"):
            qwen_core.CLIP = cfg["clip"]
        if cfg.get("vae"):
            qwen_core.VAE = cfg["vae"]
        try:
            res = qwen_core.generate_image(
                prompt=req.prompt,
                negative_prompt=req.negative_prompt,
                width=req.width, height=req.height,
                steps=int(cfg.get("steps") or req.steps or 25),
                cfg=float(cfg.get("cfg") if cfg.get("cfg") is not None else (req.cfg or 1.0)),
                seed=req.seed if req.seed is not None else -1,
                filename_prefix="photosim",
            )
        except (RuntimeError, TimeoutError, ValueError) as e:
            raise ProviderError(redact(e, cfg.get("api_key", "")))
        finally:
            qwen_core.COMFY_URL = old

        return GenResult(png=res["png"], seed=res["seed"],
                         model=qwen_core.UNET, provider=self.id,
                         size=(req.width, req.height))
