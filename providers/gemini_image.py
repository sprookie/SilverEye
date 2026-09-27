"""Google Gemini / Imagen 图像生成。

两条路径：
  1. `gemini-2.5-flash-image`（俗称 nano-banana）→ `:generateContent`
     —— 多模态出口，提示词跟随能力强，支持结构化宽高比
  2. `imagen-4.0-*` / `imagen-3.0-*` → `:predict`（纯文生图，质量更"摄影"）

注意：`generativelanguage.googleapis.com` 在国内直连不通，
需要在「Base URL」里填一个可达的中转地址。
"""
from __future__ import annotations

from typing import Any

from .base import (
    GenRequest, Provider, ProviderError, deep_get, find_first,
    nearest_aspect, session,
)

IMAGEN_SIZES = {
    "1:1": (1024, 1024), "3:4": (864, 1152), "4:3": (1152, 864),
    "9:16": (720, 1280), "16:9": (1280, 720),
}


class GeminiImage(Provider):
    id = "gemini"
    label = "Google Gemini / Imagen"
    vendor = "Google"
    note = "gemini-2.5-flash-image 就是 nano-banana，指令跟随很好；imagen-4.0 走另一条 :predict 接口。"
    docs = "https://ai.google.dev/gemini-api/docs/image-generation"
    default_base = "https://generativelanguage.googleapis.com/v1beta"
    default_model = "gemini-2.5-flash-image"
    models = [
        "gemini-2.5-flash-image",
        "gemini-2.5-flash-image-preview",
        "gemini-2.0-flash-preview-image-generation",
        "imagen-4.0-generate-001",
        "imagen-4.0-fast-generate-001",
        "imagen-3.0-generate-002",
    ]
    key_hint = "Google AI Studio 的 API Key（AIza...）"
    caps = {
        "negative": False, "seed": False, "steps": False, "cfg": False,
        "sizes": [], "needs_key": True, "needs_base": True,
        "max_prompt": 8000, "native_ratio": True,
    }
    fields = ["api_key", "base_url", "model", "extra_json"]

    # ------------------------------------------------------------------ 分流
    @staticmethod
    def _is_imagen(model: str) -> bool:
        return model.strip().lower().startswith("imagen")

    def normalize(self, req: GenRequest, cfg: dict[str, Any]) -> GenRequest:
        req = super().normalize(req, cfg)
        # Gemini 的结构化宽高比只认 ASPECTS 里那几种，吸附一下并回写尺寸
        if not self._is_imagen((cfg.get("model") or self.default_model)):
            a = nearest_aspect(req.width, req.height)
            if a in IMAGEN_SIZES:
                req.width, req.height = IMAGEN_SIZES[a]
        return req

    # ------------------------------------------------------------------ 构造
    def build_request(self, cfg: dict[str, Any], req: GenRequest) -> dict[str, Any]:
        base = (cfg.get("base_url") or self.default_base).rstrip("/")
        model = (cfg.get("model") or self.default_model).strip()
        key = (cfg.get("api_key") or "").strip()
        headers = {"Content-Type": "application/json", "x-goog-api-key": key}

        if self._is_imagen(model):
            aspect = nearest_aspect(req.width, req.height)
            body: dict[str, Any] = {
                "instances": [{"prompt": req.prompt}],
                "parameters": {"sampleCount": 1, "aspectRatio": aspect if aspect in IMAGEN_SIZES else "1:1"},
            }
            url = f"{base}/models/{model}:predict"
        else:
            gen: dict[str, Any] = {"responseModalities": ["IMAGE"]}
            if not cfg.get("_drop_image_config"):
                gen["imageConfig"] = {"aspectRatio": nearest_aspect(req.width, req.height)}
            body = {
                "contents": [{"role": "user", "parts": [{"text": req.prompt}]}],
                "generationConfig": gen,
            }
            url = f"{base}/models/{model}:generateContent"

        body.update(_extra(cfg))
        return {"method": "POST", "url": url, "headers": headers, "json": body}

    # ------------------------------------------------------------------ 解析
    def parse_response(self, payload: Any, sess=None) -> dict[str, Any]:
        # imagen
        preds = payload.get("predictions") if isinstance(payload, dict) else None
        if preds:
            for p in preds:
                b64 = p.get("bytesBase64Encoded") or p.get("bytes_base64_encoded")
                if b64:
                    return {"image": b64, "revised_prompt": ""}
        # gemini generateContent
        parts = deep_get(payload, "candidates.0.content.parts", []) or []
        text = ""
        for part in parts:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData") or part.get("inline_data")
            if isinstance(inline, dict) and inline.get("data"):
                return {"image": inline["data"], "revised_prompt": text}
            if part.get("text"):
                text += part["text"]

        # 被安全策略拦掉时，finishReason 会说明原因
        reason = deep_get(payload, "candidates.0.finishReason") or deep_get(payload, "promptFeedback.blockReason")
        if reason in ("SAFETY", "PROHIBITED_CONTENT", "IMAGE_SAFETY", "BLOCKLIST"):
            raise ProviderError(f"Gemini 以安全策略拒绝了这次生成（{reason}）。换个描述或减少人体/暴力类词汇再试。")
        # 兜底递归找
        got = find_first(payload, ("inlineData", "inline_data", "bytesBase64Encoded"))
        if isinstance(got, dict) and got.get("data"):
            return {"image": got["data"]}
        raise ProviderError(f"响应里没有图片。模型可能只回了文字：{(text or '')[:200]}")

    # ------------------------------------------------------------------ 预检
    def probe(self, cfg: dict[str, Any]) -> dict[str, Any]:
        base = (cfg.get("base_url") or self.default_base).rstrip("/")
        key = (cfg.get("api_key") or "").strip()
        if not key:
            return {"ok": False, "detail": "还没填 API Key"}
        try:
            r = session().get(base + "/models", headers={"x-goog-api-key": key}, timeout=25)
        except Exception as e:
            return {"ok": False, "detail": f"连不上 {base}：{e}\n国内直连 generativelanguage.googleapis.com 不通，请在 Base URL 填一个可达的中转地址"}
        if r.status_code != 200:
            try:
                j = r.json()
            except Exception:
                j = r.text[:200]
            from .base import http_error

            return {"ok": False, "detail": str(http_error(r.status_code, j, key))}
        try:
            models = [m.get("name", "").split("/")[-1] for m in r.json().get("models", [])]
        except Exception:
            models = []
        imgs = [m for m in models if "image" in m.lower() or "imagen" in m.lower()]
        detail = f"鉴权通过，共 {len(models)} 个模型"
        if imgs:
            detail += "；可用生图模型：" + ", ".join(imgs[:4])
        return {"ok": True, "detail": detail}

    # ------------------------------------------------------------------ 重试
    def generate(self, cfg: dict[str, Any], req: GenRequest):
        """老版本 / 部分中转实现不认 generationConfig.imageConfig，
        遇到 400 就摘掉这个字段再试一次，而不是直接失败。"""
        try:
            return super().generate(cfg, req)
        except ProviderError as e:
            msg = str(e)
            looks_like_ratio_issue = "HTTP 400" in msg and (
                "imageConfig" in msg or "aspect" in msg.lower() or "Unknown name" in msg
            )
            if not looks_like_ratio_issue:
                raise
            cfg2 = dict(cfg)
            cfg2["_drop_image_config"] = True
            return super().generate(cfg2, req)


def _extra(cfg: dict[str, Any]) -> dict[str, Any]:
    raw = (cfg.get("extra_json") or "").strip()
    if not raw:
        return {}
    import json

    try:
        got = json.loads(raw)
        return got if isinstance(got, dict) else {}
    except Exception:
        return {}
