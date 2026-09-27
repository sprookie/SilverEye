"""SilverEye 生图提供商。

统一出口：
    from providers import registry, base
    provider = registry.get("openrouter")
    result = provider.generate(cfg, base.GenRequest(prompt="..."))
"""
from . import base, registry  # noqa: F401

__all__ = ["base", "registry"]
