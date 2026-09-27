"""提供商注册表 + 常见服务预设。

`PRESETS` 是给前端"一键填好"用的：国内可达的服务优先排前面，
毕竟 OpenAI / Google 官方域名在这台机器上直连不通。
"""
from __future__ import annotations

from typing import Any

from .base import GenRequest, Provider
from .comfy_qwen import ComfyQwen
from .gemini_image import GeminiImage
from .openai_images import OpenAIImages, OpenRouter


class CustomOpenAI(OpenAIImages):
    """完全由用户定义的自建 / 中转服务。

    和 OpenAIImages 是同一套协议，只是不给任何默认值 ——
    逼着用户把 Base URL 和模型名填清楚，避免"以为在用官方其实是中转"的困惑。
    """

    id = "custom_openai"
    label = "自定义（OpenAI 兼容）"
    vendor = "自定义"
    note = "任何兼容 POST {base}/images/generations 的服务：自建、公司内网、中转站都行。"
    default_base = ""
    default_model = ""
    models = []
    key_hint = "按你的服务填写，不需要就留空"
    caps = dict(OpenAIImages.caps)
    caps["needs_key"] = False          # 自建服务常常没有鉴权
    fields = ["base_url", "api_key", "model", "size_preset", "extra_json"]


PROVIDERS: list[Provider] = [
    ComfyQwen(),
    OpenRouter(),
    OpenAIImages(),
    GeminiImage(),
    CustomOpenAI(),
]

_BY_ID = {p.id: p for p in PROVIDERS}

#: 前端"常用服务"下拉：一键填写 provider / base / model
PRESETS: list[dict[str, Any]] = [
    {"id": "local", "label": "本地 Qwen-Image 2.1（免费）", "provider": "comfy_qwen",
     "base_url": "http://127.0.0.1:8000", "model": "qwen_image_2.1_int8_convrot",
     "note": "本机 ComfyUI，唯一支持负向提示词与种子的引擎", "reachable_cn": True},

    {"id": "openrouter-nano", "label": "OpenRouter · nano-banana", "provider": "openrouter",
     "base_url": "https://openrouter.ai/api/v1", "model": "google/gemini-2.5-flash-image-preview",
     "note": "国内可直连，一个 key 横向切多家模型", "reachable_cn": True},
    {"id": "openrouter-gptimg", "label": "OpenRouter · gpt-image-1", "provider": "openrouter",
     "base_url": "https://openrouter.ai/api/v1", "model": "openai/gpt-image-1",
     "note": "通过 OpenRouter 调用 OpenAI 出图，绕开官方域名", "reachable_cn": True},

    {"id": "siliconflow-kolors", "label": "硅基流动 · Kolors", "provider": "openai_images",
     "base_url": "https://api.siliconflow.cn/v1", "model": "Kwai-Kolors/Kolors",
     "note": "国内直连，中文提示词友好，便宜", "reachable_cn": True},
    {"id": "siliconflow-flux", "label": "硅基流动 · FLUX.1-schnell", "provider": "openai_images",
     "base_url": "https://api.siliconflow.cn/v1", "model": "black-forest-labs/FLUX.1-schnell",
     "note": "快、便宜，画质偏插画感", "reachable_cn": True},

    {"id": "volc-seedream", "label": "火山方舟 · 豆包 Seedream", "provider": "openai_images",
     "base_url": "https://ark.cn-beijing.volces.com/api/v3", "model": "doubao-seedream-3-0-t2i-250415",
     "note": "国内直连，中文语义理解好", "reachable_cn": True},
    {"id": "zhipu-cogview", "label": "智谱 · CogView", "provider": "openai_images",
     "base_url": "https://open.bigmodel.cn/api/paas/v4", "model": "cogview-3-flash",
     "note": "flash 版本基本免费", "reachable_cn": True},
    {"id": "dashscope-wanx", "label": "阿里百炼 · 通义万相", "provider": "openai_images",
     "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "wanx2.1-t2i-turbo",
     "note": "国内直连，走兼容模式端点", "reachable_cn": True},

    {"id": "openai-official", "label": "OpenAI 官方", "provider": "openai_images",
     "base_url": "https://api.openai.com/v1", "model": "gpt-image-1",
     "note": "⚠️ 国内直连不通，需自备可达线路", "reachable_cn": False},
    {"id": "gemini-official", "label": "Google Gemini 官方（nano-banana）", "provider": "gemini",
     "base_url": "https://generativelanguage.googleapis.com/v1beta", "model": "gemini-2.5-flash-image",
     "note": "⚠️ 国内直连不通，需自备可达线路", "reachable_cn": False},
    {"id": "gemini-imagen", "label": "Google Imagen 4", "provider": "gemini",
     "base_url": "https://generativelanguage.googleapis.com/v1beta", "model": "imagen-4.0-generate-001",
     "note": "⚠️ 国内直连不通；走 :predict 接口", "reachable_cn": False},

    {"id": "custom", "label": "自定义 / 自建 / 中转", "provider": "custom_openai",
     "base_url": "", "model": "", "note": "自己填 Base URL 与模型名", "reachable_cn": True},
]


def get(provider_id: str) -> Provider:
    p = _BY_ID.get(provider_id or "")
    if p is None:
        raise KeyError(f"未知的提供商：{provider_id}")
    return p


def catalog() -> dict[str, Any]:
    """给前端的完整元信息。"""
    return {
        "providers": [p.meta() for p in PROVIDERS],
        "presets": PRESETS,
        "default": "comfy_qwen",
    }


__all__ = ["PROVIDERS", "PRESETS", "get", "catalog", "CustomOpenAI"]
