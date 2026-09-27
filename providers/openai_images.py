"""OpenAI Images API 及其所有兼容实现。

一个适配器覆盖一大票服务（它们都遵循 `POST {base}/images/generations`）：

  · OpenAI 官方           gpt-image-1 / dall-e-3
  · 火山方舟（豆包）        doubao-seedream-3-0-t2i-250415
  · 硅基流动               Kwai-Kolors/Kolors / black-forest-labs/FLUX.1-schnell
  · 智谱 BigModel         cogview-4 / cogview-3-flash
  · 阿里百炼 DashScope     wanx2.1-t2i-turbo
  · 任意自建 / 中转站       只要兼容这个路径就行

各家的尺寸与参数差异靠 `caps` + 启动时的 `preset` 描述，不写死在代码里。
"""
from __future__ import annotations

from typing import Any

from .base import GenRequest, Provider, ProviderError, deep_get, find_first, session

# 常见服务的默认尺寸集合
SIZES_OPENAI_GPT_IMAGE = [(1024, 1024), (1536, 1024), (1024, 1536)]
SIZES_DALLE3 = [(1024, 1024), (1792, 1024), (1024, 1792)]
SIZES_SEEDREAM = [(1024, 1024), (1152, 864), (864, 1152), (1280, 720), (720, 1280), (2048, 2048)]
SIZES_SILICON = [(1024, 1024), (960, 1280), (1280, 960), (768, 1024), (1024, 768)]
SIZES_COGVIEW = [(1024, 1024), (1344, 768), (768, 1344), (1440, 720), (720, 1440)]
SIZES_WANX = [(1024, 1024), (1280, 720), (720, 1280), (1024, 768), (768, 1024)]


def sizes_for_model(model: str) -> list[tuple[int, int]]:
    """按模型名挑尺寸表 —— 同一个 /images/generations 协议下各家允许的尺寸完全不同。"""
    m = (model or "").lower()
    if m.startswith("dall-e"):
        return SIZES_DALLE3
    if "seedream" in m or "doubao" in m:
        return SIZES_SEEDREAM
    if "kolors" in m or "flux" in m or "qwen-image" in m:
        return SIZES_SILICON
    if "cogview" in m or m.startswith("glm"):
        return SIZES_COGVIEW
    if m.startswith("wanx") or m.startswith("wan2"):
        return SIZES_WANX
    if m.startswith("gpt-image"):
        return SIZES_OPENAI_GPT_IMAGE
    # 认不出来就只给 1:1，最保守
    return SIZES_OPENAI_GPT_IMAGE


class OpenAIImages(Provider):
    id = "openai_images"
    label = "OpenAI Images"
    vendor = "OpenAI"
    note = "gpt-image-1 / dall-e-3，也可指向任何兼容 /images/generations 的服务。"
    docs = "https://platform.openai.com/docs/api-reference/images"
    default_base = "https://api.openai.com/v1"
    default_model = "gpt-image-1"
    models = [
        "gpt-image-1",
        "gpt-image-1-mini",
        "dall-e-3",
        # 国内可直达的兼容服务
        "doubao-seedream-3-0-t2i-250415",
        "Kwai-Kolors/Kolors",
        "black-forest-labs/FLUX.1-schnell",
        "cogview-4",
        "cogview-3-flash",
        "wanx2.1-t2i-turbo",
    ]
    key_hint = "OpenAI 用 sk-... ；中转站用各自发的 key"
    caps = {
        "negative": False, "seed": False, "steps": False, "cfg": False,
        "sizes": SIZES_OPENAI_GPT_IMAGE, "needs_key": True, "needs_base": True,
        "max_prompt": 32000, "native_ratio": False,
    }
    fields = ["api_key", "base_url", "model", "size_preset", "quality", "extra_json"]

    def sizes_for(self, cfg: dict) -> list[tuple[int, int]]:
        return sizes_for_model(cfg.get("model") or self.default_model)

    def build_request(self, cfg: dict[str, Any], req: GenRequest) -> dict[str, Any]:
        base = (cfg.get("base_url") or self.default_base).rstrip("/")
        model = (cfg.get("model") or self.default_model).strip()
        body: dict[str, Any] = {
            "model": model,
            "prompt": req.prompt,
            "n": 1,
            "size": f"{req.width}x{req.height}",
        }
        if model.startswith("dall-e"):
            body["response_format"] = "b64_json"
            if cfg.get("quality") in ("standard", "hd"):
                body["quality"] = cfg["quality"]
        elif model.startswith("gpt-image"):
            if cfg.get("quality") in ("low", "medium", "high", "auto"):
                body["quality"] = cfg["quality"]
        # 其余兼容服务：只发最小公共字段，避免被不认识的参数拒掉
        body.update(_extra(cfg))
        return {
            "method": "POST",
            "url": base + "/images/generations",
            "headers": {
                "Authorization": f"Bearer {(cfg.get('api_key') or '').strip()}",
                "Content-Type": "application/json",
            },
            "json": body,
        }

    def parse_response(self, payload: Any, sess=None) -> dict[str, Any]:
        data = payload.get("data") if isinstance(payload, dict) else None
        if not data:
            # 少数兼容服务把结果放在 images / output 里
            alt = find_first(payload, ("b64_json", "image", "url"))
            if alt:
                return {"image": alt}
            raise ProviderError("响应里没有找到图片字段（期望 data[0].b64_json 或 data[0].url）")
        first = data[0]
        img = first.get("b64_json") or first.get("url") or first.get("image")
        if not img:
            raise ProviderError("data[0] 里既没有 b64_json 也没有 url")
        return {
            "image": img,
            "revised_prompt": first.get("revised_prompt", "") or "",
            "size": _parse_size(first.get("size")) or None,
        }

    def probe(self, cfg: dict[str, Any]) -> dict[str, Any]:
        base = (cfg.get("base_url") or self.default_base).rstrip("/")
        key = (cfg.get("api_key") or "").strip()
        if not key:
            return {"ok": False, "detail": "还没填 API Key"}
        try:
            r = session().get(base + "/models", headers={"Authorization": f"Bearer {key}"}, timeout=25)
        except Exception as e:
            return {"ok": False, "detail": f"连不上 {base}：{e}\n国内网络访问 OpenAI 官方域名通常需要自建/购买可达的中转 Base URL"}
        if r.status_code == 200:
            try:
                ids = [m.get("id", "") for m in r.json().get("data", [])]
            except Exception:
                ids = []
            hit = [i for i in ids if "image" in i.lower() or i.startswith("dall")]
            detail = f"鉴权通过，该服务共 {len(ids)} 个模型"
            if hit:
                detail += "；可用生图模型：" + ", ".join(hit[:4])
            return {"ok": True, "detail": detail}
        try:
            j = r.json()
        except Exception:
            j = r.text[:200]
        from .base import http_error

        return {"ok": False, "detail": str(http_error(r.status_code, j, key))}


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


def _parse_size(s: Any):
    if not isinstance(s, str) or "x" not in s:
        return None
    try:
        w, h = s.lower().split("x")
        return int(w), int(h)
    except ValueError:
        return None


class OpenRouter(Provider):
    """OpenRouter：用 chat/completions + modalities=["image","text"] 出图。

    目前能出图的模型不多，主要是 google/gemini-2.5-flash-image（nano banana）。
    好处是它在国内可达，且一个 key 能横向切模型。
    """

    id = "openrouter"
    label = "OpenRouter"
    vendor = "OpenRouter"
    note = "一个 key 横向切换多家模型，国内可直连。目前出图主力是 google/gemini-2.5-flash-image。"
    docs = "https://openrouter.ai/docs/features/multimodal/image-generation"
    default_base = "https://openrouter.ai/api/v1"
    default_model = "google/gemini-2.5-flash-image-preview"
    models = [
        "google/gemini-2.5-flash-image-preview",
        "google/gemini-2.5-flash-image",
        "openai/gpt-image-1",
        "black-forest-labs/flux-1.1-pro",
    ]
    key_hint = "sk-or-v1-..."
    caps = {
        "negative": False, "seed": False, "steps": False, "cfg": False,
        "sizes": [], "needs_key": True, "needs_base": True,
        "max_prompt": 32000, "native_ratio": True,
    }
    fields = ["api_key", "base_url", "model", "extra_json"]

    def build_request(self, cfg: dict[str, Any], req: GenRequest) -> dict[str, Any]:
        base = (cfg.get("base_url") or self.default_base).rstrip("/")
        body: dict[str, Any] = {
            "model": (cfg.get("model") or self.default_model).strip(),
            "messages": [{"role": "user", "content": req.prompt}],
            "modalities": ["image", "text"],
        }
        from .base import nearest_aspect

        body["image_config"] = {"aspect_ratio": nearest_aspect(req.width, req.height)}
        body.update(_extra(cfg))
        return {
            "method": "POST",
            "url": base + "/chat/completions",
            "headers": {
                "Authorization": f"Bearer {(cfg.get('api_key') or '').strip()}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/sprookie/SilverEye",
                "X-Title": "SilverEye Photo Simulator",
            },
            "json": body,
        }

    def parse_response(self, payload: Any, sess=None) -> dict[str, Any]:
        msg = deep_get(payload, "choices.0.message", {}) or {}
        # 形态一：message.images[*].image_url.url
        for im in (msg.get("images") or []):
            url = im.get("image_url", {}).get("url") if isinstance(im.get("image_url"), dict) else im.get("url")
            if url:
                return {"image": url, "revised_prompt": msg.get("content") or ""}
        # 形态二：message.content 是数组，里面夹 image_url
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") in ("image_url", "output_image", "image"):
                    url = part.get("image_url", {}).get("url") if isinstance(part.get("image_url"), dict) else part.get("url") or part.get("data")
                    if url:
                        return {"image": url, "revised_prompt": ""}
        # 形态三：整个响应里递归找
        found = find_first(payload, ("image_url", "b64_json", "data"))
        if isinstance(found, dict):
            found = found.get("url") or found.get("b64_json")
        if found:
            return {"image": found}
        raise ProviderError("响应里没有图片。该模型可能不支持出图，或 content 被安全策略拦截")

    def probe(self, cfg: dict[str, Any]) -> dict[str, Any]:
        base = (cfg.get("base_url") or self.default_base).rstrip("/")
        key = (cfg.get("api_key") or "").strip()
        if not key:
            return {"ok": False, "detail": "还没填 API Key"}
        try:
            r = session().get(base + "/key", headers={"Authorization": f"Bearer {key}"}, timeout=25)
        except Exception as e:
            return {"ok": False, "detail": f"连不上 {base}：{e}"}
        if r.status_code != 200:
            try:
                j = r.json()
            except Exception:
                j = r.text[:200]
            from .base import http_error

            # 402 也能说明 key 是有效的（只是没余额）
            if r.status_code == 402:
                return {"ok": True, "detail": "密钥有效，但额度不足（image 模型需要余额）"}
            return {"ok": False, "detail": str(http_error(r.status_code, j, key))}
        j = r.json().get("data", {})
        lim = j.get("limit")
        used = j.get("usage") or 0
        detail = "鉴权通过"
        if lim is not None:
            detail += f" · 额度已用 ${used:.2f} / ${lim:.2f}"
        else:
            detail += f" · 已用 ${used:.2f}（无上限）"
        if j.get("is_free_tier"):
            detail += " · 免费档"
        return {"ok": True, "detail": detail}
