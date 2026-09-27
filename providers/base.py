"""生图提供商抽象层。

设计要点
--------
1. **构造请求与解析响应分离**：每个 provider 都暴露
   `build_request(cfg, req)` 与 `parse_response(payload)`，
   两者都是纯函数 —— 没有 API key 也能把请求体结构和响应解析测清楚。
2. **能力声明**：各家支持的东西差很多（Qwen 支持负向提示词和种子，
   OpenAI/Gemini 都不支持），所以每个 provider 声明 `caps`，
   由 base 统一做降级：负向折进正向、种子忽略、尺寸吸附、提示词截断。
3. **绝不把 key 写进日志或异常**：`redact()` 统一脱敏。
"""
from __future__ import annotations

import base64
import json
import math
import mimetypes
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

import requests

DEFAULT_TIMEOUT = int(os.environ.get("SILVEREYE_TIMEOUT", "600"))


# --------------------------------------------------------------------------- 数据
@dataclass
class GenRequest:
    prompt: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    steps: int = 25
    cfg: float = 1.0
    seed: int | None = None


@dataclass
class GenResult:
    png: bytes
    seed: int = -1
    model: str = ""
    provider: str = ""
    size: tuple[int, int] = (0, 0)
    revised_prompt: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


class ProviderError(RuntimeError):
    """带用户可读信息的错误。"""


# --------------------------------------------------------------------------- HTTP
def session() -> requests.Session:
    """绕过系统代理的 session —— 本机 ComfyUI 走代理会连不上，
    而且用户环境常常挂着代理，不能让它污染所有请求。"""
    s = requests.Session()
    s.trust_env = False
    s.proxies = {"http": None, "https": None}
    return s


def redact(text: Any, *secrets: str) -> str:
    """把出现在文本里的密钥抹掉，避免泄漏到日志 / 前端提示。"""
    out = str(text)
    for sec in secrets:
        if sec and len(sec) >= 8:
            out = out.replace(sec, "***")
    return out


def http_error(status: int, payload: Any, *secrets: str) -> ProviderError:
    """从厂商返回体里抠出人能看懂的错误。"""
    msg = ""
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict):
            msg = err.get("message") or err.get("msg") or ""
        elif isinstance(err, str):
            msg = err
        msg = msg or payload.get("message") or payload.get("detail") or ""
    elif isinstance(payload, str):
        msg = payload
    msg = redact(msg or f"HTTP {status}", *secrets)[:400]

    hint = {
        400: "请求被拒（多半是模型名、尺寸或参数不被支持）",
        401: "密钥无效或未授权",
        402: "余额不足",
        403: "没有权限（可能是地区限制或模型未开通）",
        404: "接口或模型不存在（检查 Base URL 与模型名）",
        413: "请求体过大",
        422: "参数校验失败",
        429: "触发限流或配额用尽",
        500: "厂商内部错误",
        502: "厂商网关错误",
        503: "服务暂时不可用",
    }.get(status, "")
    return ProviderError(f"{hint}（HTTP {status}）：{msg}" if hint else msg)


# --------------------------------------------------------------------------- 尺寸
def nearest_size(w: int, h: int, sizes: list[tuple[int, int]]) -> tuple[int, int]:
    """在厂商允许的尺寸里挑一个宽高比最接近的（保持横竖方向）。"""
    if not sizes:
        return w, h
    want_land = w >= h
    same = [s for s in sizes if (s[0] >= s[1]) == want_land]
    pool = same or sizes
    target = w / max(1, h)
    return min(pool, key=lambda s: abs(math.log((s[0] / s[1]) / target)))


ASPECTS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"]


def nearest_aspect(w: int, h: int) -> str:
    target = w / max(1, h)
    return min(ASPECTS, key=lambda a: abs(math.log((int(a.split(":")[0]) / int(a.split(":")[1])) / target)))


# --------------------------------------------------------------------------- 降级
def fold_negative(prompt: str, negative: str, limit: int = 14) -> str:
    """把负向提示词折进正向。

    模型不支持 negative_prompt 时，硬塞进正向是最不坏的做法 ——
    只取前若干条，免得把正向提示词稀释掉。
    """
    if not negative:
        return prompt
    items = [x.strip() for x in negative.split(",") if x.strip()][:limit]
    if not items:
        return prompt
    return f"{prompt}\n\nStrictly avoid depicting: {', '.join(items)}."


def clip_prompt(prompt: str, limit: int) -> str:
    if limit and len(prompt) > limit:
        return prompt[: limit - 20].rstrip(" ,") + ", highly detailed"
    return prompt


# --------------------------------------------------------------------------- 图片
_DATA_URI = re.compile(r"^data:(?P<mime>[^;,]+)?(?:;charset=[^;,]+)?(?P<b64>;base64)?,(?P<data>.*)$", re.S)


def to_png_bytes(value: str, sess: requests.Session | None = None, timeout: int = 180) -> bytes:
    """把 b64 / data URI / http URL 统一变成 PNG 字节。"""
    if not value:
        raise ProviderError("厂商没有返回图片数据")

    if value.startswith("http://") or value.startswith("https://"):
        s = sess or session()
        r = s.get(value, timeout=timeout)
        if r.status_code != 200:
            raise ProviderError(f"下载生成结果失败（HTTP {r.status_code}）")
        return ensure_png(r.content)

    m = _DATA_URI.match(value)
    if m:
        if not m.group("b64"):
            from urllib.parse import unquote_to_bytes

            return ensure_png(unquote_to_bytes(m.group("data")))
        value = m.group("data")

    try:
        raw = base64.b64decode(value, validate=False)
    except Exception as e:
        raise ProviderError(f"图片数据不是合法的 base64：{e}")
    return ensure_png(raw)


def ensure_png(data: bytes) -> bytes:
    """厂商常常返回 JPEG/WEBP，统一转成 PNG，前端和落盘逻辑就不用管格式了。"""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return data
    try:
        from PIL import Image
        import io

        im = Image.open(io.BytesIO(data))
        im = im.convert("RGB" if im.mode not in ("RGB", "RGBA") else im.mode)
        buf = io.BytesIO()
        im.save(buf, "PNG")
        return buf.getvalue()
    except Exception:
        # 转不了就原样返回，至少别把图丢了
        return data


def sniff_media(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


# --------------------------------------------------------------------------- 基类
class Provider:
    id: str = ""
    label: str = ""
    vendor: str = ""
    note: str = ""
    docs: str = ""
    key_hint: str = ""
    default_base: str = ""
    default_model: str = ""
    models: list[str] = []

    #: negative / seed / steps / cfg / sizes / ratio / max_prompt / needs_key / needs_base
    caps: dict[str, Any] = {}
    fields: list[str] = ["api_key", "base_url", "model"]

    def meta(self) -> dict[str, Any]:
        return {
            "id": self.id, "label": self.label, "vendor": self.vendor, "note": self.note,
            "docs": self.docs, "key_hint": self.key_hint,
            "default_base": self.default_base, "default_model": self.default_model,
            "models": self.models, "caps": self.caps, "fields": self.fields,
        }

    # ---------------------------------------------------------------- 子类实现
    def build_request(self, cfg: dict[str, Any], req: GenRequest) -> dict[str, Any]:
        """返回 {method, url, headers, json, params}。纯函数，可单测。"""
        raise NotImplementedError

    def parse_response(self, payload: Any, sess: requests.Session | None = None) -> dict[str, Any]:
        """返回 {image: str(b64|url|data-uri), revised_prompt: str, size: (w,h)|None}。纯函数。"""
        raise NotImplementedError

    def probe(self, cfg: dict[str, Any]) -> dict[str, Any]:
        """轻量鉴权/连通性检查（尽量不花钱）。"""
        return {"ok": True, "detail": "该提供商未实现预检，请直接试拍"}

    # ---------------------------------------------------------------- 通用流程
    def sizes_for(self, cfg: dict[str, Any]) -> list[tuple[int, int]]:
        """该引擎在当前模型下允许的尺寸。子类可按模型细化。"""
        return [tuple(s) for s in (self.caps.get("sizes") or [])]

    def normalize(self, req: GenRequest, cfg: dict[str, Any]) -> GenRequest:
        caps = self.caps
        p = clip_prompt(req.prompt, caps.get("max_prompt", 0))
        neg = req.negative_prompt
        if neg and not caps.get("negative"):
            p = fold_negative(p, neg)
            neg = ""
        w, h = req.width, req.height
        sizes = self.sizes_for(cfg)
        if sizes:
            w, h = nearest_size(w, h, sizes)
        steps = req.steps if caps.get("steps") else 0
        cfgv = req.cfg if caps.get("cfg") else 0.0
        seed = req.seed if caps.get("seed") else None
        return GenRequest(prompt=p, negative_prompt=neg, width=w, height=h,
                          steps=steps or 0, cfg=cfgv, seed=seed)

    def generate(self, cfg: dict[str, Any], req: GenRequest) -> GenResult:
        if self.caps.get("needs_key") and not (cfg.get("api_key") or "").strip():
            raise ProviderError(f"{self.label} 需要 API Key，请先在「生图引擎」里填上")
        if self.caps.get("needs_base") and not (cfg.get("base_url") or self.default_base or "").strip():
            raise ProviderError(f"{self.label} 需要 Base URL")

        r = self.normalize(req, cfg)
        built = self.build_request(cfg, r)
        sess = session()
        t0 = time.time()
        try:
            resp = sess.request(
                built.get("method", "POST"),
                built["url"],
                headers=built.get("headers"),
                json=built.get("json"),
                params=built.get("params"),
                timeout=int(cfg.get("timeout") or DEFAULT_TIMEOUT),
            )
        except requests.exceptions.Timeout:
            raise ProviderError(f"{self.label} 请求超时（超过 {cfg.get('timeout') or DEFAULT_TIMEOUT}s）")
        except requests.exceptions.RequestException as e:
            raise ProviderError(
                f"连不上 {self.label}：{redact(e, cfg.get('api_key', ''))}\n"
                "（如果这个域名在你的网络下访问不到，把 Base URL 换成可达的中转地址即可）"
            )

        try:
            payload = resp.json()
        except Exception:
            payload = resp.text[:800]
        if resp.status_code >= 400:
            raise http_error(resp.status_code, payload, cfg.get("api_key", ""))

        parsed = self.parse_response(payload, sess)
        png = to_png_bytes(parsed.get("image", ""), sess)
        size = parsed.get("size") or (r.width, r.height)
        return GenResult(png=png, seed=r.seed if r.seed is not None else -1,
                         model=(cfg.get("model") or self.default_model),
                         provider=self.id, size=tuple(size),
                         revised_prompt=parsed.get("revised_prompt", ""),
                         raw={k: v for k, v in parsed.items() if k != "image"})


# --------------------------------------------------------------------------- 通用工具
def deep_get(obj: Any, path: str, default=None):
    cur = obj
    for part in path.split("."):
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return default
        elif isinstance(cur, dict):
            if part not in cur:
                return default
            cur = cur[part]
        else:
            return default
    return cur


def find_first(data: Any, keys: tuple[str, ...]) -> Any:
    """递归找出第一个命中的 key —— 各家返回体的嵌套结构差太多，硬编码路径很脆。"""
    if isinstance(data, dict):
        for k in keys:
            if k in data and data[k]:
                return data[k]
        for v in data.values():
            got = find_first(v, keys)
            if got:
                return got
    elif isinstance(data, list):
        for v in data:
            got = find_first(v, keys)
            if got:
                return got
    return None


__all__ = [
    "GenRequest", "GenResult", "ProviderError", "Provider",
    "session", "redact", "http_error", "nearest_size", "nearest_aspect", "ASPECTS",
    "fold_negative", "clip_prompt", "to_png_bytes", "ensure_png", "sniff_media",
    "deep_get", "find_first",
]
