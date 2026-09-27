#!/usr/bin/env python
"""生图引擎的离线单测 —— 不需要任何 API Key。

思路：每个 provider 的 `build_request` 与 `parse_response` 都是纯函数，
所以请求体结构和各家五花八门的响应解析可以完全离线验证。
这正是"多厂商适配"最容易出错、也最该被测住的地方。

    F:\\.venv\\Scripts\\python.exe scripts/test_providers.py
"""
from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image                                          # noqa: E402
from providers import base as B                                # noqa: E402
from providers import registry as R                            # noqa: E402

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = ""):
    (PASS if cond else FAIL).append(name)
    print(("  ✓ " if cond else "  ✗ ") + name + (f"   {detail}" if detail and not cond else ""))


def png_b64(color=(200, 60, 40), size=(8, 8)) -> str:
    im = Image.new("RGB", size, color)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def jpeg_b64() -> str:
    im = Image.new("RGB", (8, 8), (10, 120, 200))
    buf = io.BytesIO()
    im.save(buf, "JPEG")
    return base64.b64encode(buf.getvalue()).decode()


# =========================================================================== base
print("\n[base] 通用工具")
check("尺寸吸附保持横竖方向", B.nearest_size(1600, 900, [(1024, 1024), (1024, 1536)]) == (1024, 1024))
check("尺寸吸附选最接近比例",
      B.nearest_size(1408, 938, [(1024, 1024), (1536, 1024), (1024, 1536)]) == (1536, 1024))
check("宽高比吸附 3:2", B.nearest_aspect(1408, 938) == "3:2")
check("宽高比吸附 9:16", B.nearest_aspect(720, 1280) == "9:16")
check("负向折进正向", "blurry" in B.fold_negative("a cat", "blurry, text, watermark"))
check("负向为空时不动正向", B.fold_negative("a cat", "") == "a cat")
check("密钥脱敏", "sk-abc" not in B.redact("bad sk-abcdef123456", "sk-abcdef123456"))
check("PNG 原样返回", B.ensure_png(base64.b64decode(png_b64()))[:8] == b"\x89PNG\r\n\x1a\n")
check("JPEG 自动转 PNG", B.ensure_png(base64.b64decode(jpeg_b64()))[:8] == b"\x89PNG\r\n\x1a\n")
check("data URI 解析", B.to_png_bytes("data:image/png;base64," + png_b64())[:4] == b"\x89PNG")
check("裸 base64 解析", B.to_png_bytes(png_b64())[:4] == b"\x89PNG")

print("\n[base] 错误信息")
e = B.http_error(401, {"error": {"message": "Incorrect API key provided: sk-abcdef123456"}}, "sk-abcdef123456")
check("401 有中文提示", "密钥无效" in str(e))
check("错误里的密钥被脱敏", "sk-abcdef123456" not in str(e))
e = B.http_error(404, {"error": {"message": "model not found"}})
check("404 提示检查模型名", "模型" in str(e))

# =========================================================================== 能力降级
print("\n[base] 能力降级（不支持负向的引擎）")
prov = R.get("openai_images")
norm = prov.normalize(B.GenRequest(prompt="a cat", negative_prompt="blurry, text",
                                   width=1408, height=938, seed=42, steps=30), {"model": "gpt-image-1"})
check("负向被折进正向", "Strictly avoid" in norm.prompt)
check("负向字段被清空", norm.negative_prompt == "")
check("尺寸被吸附到合法值", (norm.width, norm.height) == (1536, 1024))
check("不支持的种子被丢弃", norm.seed is None)

prov = R.get("comfy_qwen")
norm = prov.normalize(B.GenRequest(prompt="a cat", negative_prompt="blurry",
                                   width=1408, height=938, seed=42, steps=30), {})
check("Qwen 保留负向", norm.negative_prompt == "blurry")
check("Qwen 保留种子", norm.seed == 42)
check("Qwen 保留尺寸", (norm.width, norm.height) == (1408, 938))

# =========================================================================== OpenAI
print("\n[openai_images] 请求构造")
p = R.get("openai_images")
req = B.GenRequest(prompt="a cat", width=1408, height=938)
built = p.build_request({"api_key": "sk-test", "model": "gpt-image-1"}, req)
check("URL 正确", built["url"] == "https://api.openai.com/v1/images/generations", built["url"])
check("用 Bearer 鉴权", built["headers"]["Authorization"] == "Bearer sk-test")
check("请求体含 model/prompt/n/size",
      all(k in built["json"] for k in ("model", "prompt", "n", "size")))
check("gpt-image-1 不发 response_format", "response_format" not in built["json"])

built = p.build_request({"api_key": "k", "model": "dall-e-3"}, req)
check("dall-e-3 发 response_format=b64_json", built["json"].get("response_format") == "b64_json")
check("dall-e-3 尺寸取 1792x1024 系",
      p.normalize(B.GenRequest(prompt="x", width=1408, height=938), {"model": "dall-e-3"}).width == 1792)

built = p.build_request({"api_key": "k", "model": "Kwai-Kolors/Kolors",
                         "base_url": "https://api.siliconflow.cn/v1"}, req)
check("自定义 base_url 生效", built["url"].startswith("https://api.siliconflow.cn/v1"))
check("兼容服务不发多余字段", set(built["json"]) <= {"model", "prompt", "n", "size"})

print("\n[openai_images] 响应解析")
got = p.parse_response({"created": 1, "data": [{"b64_json": png_b64(), "revised_prompt": "a nice cat"}]})
check("解析 b64_json", got["image"] == png_b64() or len(got["image"]) > 50)
check("解析 revised_prompt", got["revised_prompt"] == "a nice cat")
got = p.parse_response({"data": [{"url": "https://cdn.example.com/a.png", "size": "1536x1024"}]})
check("解析 url 形式", got["image"].startswith("https://"))
check("解析返回尺寸", got["size"] == (1536, 1024))
try:
    p.parse_response({"data": []})
    check("空 data 抛错", False)
except B.ProviderError:
    check("空 data 抛错", True)

# =========================================================================== Gemini
print("\n[gemini] 请求构造")
g = R.get("gemini")
built = g.build_request({"api_key": "AIza-test", "model": "gemini-2.5-flash-image"},
                        B.GenRequest(prompt="a cat", width=1408, height=938))
check("走 generateContent", built["url"].endswith(":generateContent"), built["url"])
check("用 x-goog-api-key 头", built["headers"]["x-goog-api-key"] == "AIza-test")
check("contents 结构正确", built["json"]["contents"][0]["parts"][0]["text"] == "a cat")
check("带上 structured aspectRatio",
      built["json"]["generationConfig"]["imageConfig"]["aspectRatio"] == "3:2")

built = g.build_request({"api_key": "k", "model": "imagen-4.0-generate-001"},
                        B.GenRequest(prompt="a cat", width=1152, height=864))
check("imagen 走 :predict", built["url"].endswith(":predict"), built["url"])
check("imagen 用 instances 结构", built["json"]["instances"][0]["prompt"] == "a cat")
check("imagen 参数含 aspectRatio", "aspectRatio" in built["json"]["parameters"])

cfg2 = {"api_key": "k", "model": "gemini-2.5-flash-image", "_drop_image_config": True}
built = g.build_request(cfg2, B.GenRequest(prompt="x", width=1024, height=1024))
check("兼容模式会摘掉 imageConfig", "imageConfig" not in built["json"]["generationConfig"])

print("\n[gemini] 响应解析")
got = g.parse_response({"candidates": [{"content": {"parts": [
    {"inlineData": {"mimeType": "image/png", "data": png_b64()}}]}, "finishReason": "STOP"}]})
check("解析 inlineData（驼峰）", len(got["image"]) > 50)
got = g.parse_response({"candidates": [{"content": {"parts": [
    {"inline_data": {"mime_type": "image/png", "data": png_b64()}}]}}]})
check("解析 inline_data（下划线）", len(got["image"]) > 50)
got = g.parse_response({"predictions": [{"bytesBase64Encoded": png_b64()}]})
check("解析 imagen predictions", len(got["image"]) > 50)
try:
    g.parse_response({"candidates": [{"finishReason": "SAFETY", "content": {"parts": []}}]})
    check("安全拦截给出可读错误", False)
except B.ProviderError as ex:
    check("安全拦截给出可读错误", "安全策略" in str(ex))
try:
    g.parse_response({"candidates": [{"content": {"parts": [{"text": "I can't help with that"}]}}]})
    check("只回文字时抛错并回显", False)
except B.ProviderError as ex:
    check("只回文字时抛错并回显", "I can't help" in str(ex))

# =========================================================================== OpenRouter
print("\n[openrouter] 请求构造")
r = R.get("openrouter")
built = r.build_request({"api_key": "sk-or-v1-test", "model": "google/gemini-2.5-flash-image-preview"},
                        B.GenRequest(prompt="a cat", width=1408, height=938))
check("走 chat/completions", built["url"].endswith("/chat/completions"))
check("声明 modalities", built["json"]["modalities"] == ["image", "text"])
check("带 image_config.aspect_ratio",
      built["json"]["image_config"]["aspect_ratio"] == "3:2")
check("带 X-Title 标识", "X-Title" in built["headers"])

print("\n[openrouter] 响应解析")
got = r.parse_response({"choices": [{"message": {"content": "here you go", "images": [
    {"type": "image_url", "image_url": {"url": "data:image/png;base64," + png_b64()}}]}}]})
check("解析 message.images", got["image"].startswith("data:image/png"))
got = r.parse_response({"choices": [{"message": {"content": [
    {"type": "text", "text": "ok"},
    {"type": "image_url", "image_url": {"url": "https://x/y.png"}}]}}]})
check("解析 content 数组形式", got["image"] == "https://x/y.png")
try:
    r.parse_response({"choices": [{"message": {"content": "sorry, no image"}}]})
    check("无图时抛错", False)
except B.ProviderError:
    check("无图时抛错", True)

# =========================================================================== 注册表
print("\n[registry] 完整性")
cat = R.catalog()
check("至少 5 个引擎", len(cat["providers"]) >= 5)
check("预设都指向存在的引擎",
      all(pr["provider"] in {p["id"] for p in cat["providers"]} for pr in cat["presets"]))
check("预设字段齐全",
      all(all(k in pr for k in ("id", "label", "provider", "base_url", "model")) for pr in cat["presets"]))
try:
    R.get("nope")
    check("未知引擎会报错", False)
except KeyError:
    check("未知引擎会报错", True)

meta_keys = {"id", "label", "vendor", "note", "docs", "key_hint", "default_base",
             "default_model", "models", "caps", "fields"}
check("引擎元信息字段齐全", all(meta_keys <= set(p) for p in cat["providers"]))
check("caps 都声明了负向支持与否", all("negative" in p["caps"] for p in cat["providers"]))

# =========================================================================== 汇总
print("\n" + "=" * 64)
print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
if FAIL:
    print("失败项：")
    for f in FAIL:
        print("  ✗ " + f)
print("=" * 64)
sys.exit(1 if FAIL else 0)
