from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Literal

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="货记 AI Service", version="0.1.0")


class ExtractionRequest(BaseModel):
    capture_item_id: str | None = None
    raw_text: str = Field(min_length=1)
    image_urls: list[str] = Field(default_factory=list)
    provider: Literal["mock", "deepseek", "siliconflow"] | None = None
    model: str | None = None


class OcrRequest(BaseModel):
    file_id: str | None = None
    image_url: str | None = None


class ExtractionResponse(BaseModel):
    provider: str
    model: str
    schema_version: str = "v1"
    result: dict[str, Any]
    token_usage: dict[str, Any] = Field(default_factory=dict)
    cost_amount: float | None = None
    latency_ms: int


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/ocr")
def ocr(_: OcrRequest) -> dict[str, Any]:
    return {
        "status": "PENDING_PROVIDER",
        "text": "",
        "confidence": 0,
        "message": "OCR provider is not configured in phase-one skeleton.",
    }


@app.post("/v1/extractions/goods", response_model=ExtractionResponse)
async def extract_goods(req: ExtractionRequest) -> ExtractionResponse:
    provider = req.provider or os.getenv("AI_PROVIDER", "mock")
    started = time.perf_counter()
    if provider == "mock":
        result = mock_extract(req.raw_text)
        return ExtractionResponse(
            provider="mock",
            model="huoji-extractor-mock",
            result=result,
            latency_ms=elapsed_ms(started),
        )
    if provider not in {"deepseek", "siliconflow"}:
        raise HTTPException(status_code=400, detail={"code": "AI_PROVIDER_UNSUPPORTED"})

    gateway_result = await call_openai_compatible(provider, req.raw_text, req.model)
    return ExtractionResponse(
        provider=provider,
        model=gateway_result["model"],
        result=gateway_result["result"],
        token_usage=gateway_result.get("token_usage", {}),
        cost_amount=gateway_result.get("cost_amount"),
        latency_ms=elapsed_ms(started),
    )


async def call_openai_compatible(
    provider: Literal["deepseek", "siliconflow"], raw_text: str, model: str | None
) -> dict[str, Any]:
    if provider == "deepseek":
        api_key = os.getenv("DEEPSEEK_API_KEY")
        base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
        model_name = model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    else:
        api_key = os.getenv("SILICONFLOW_API_KEY")
        base_url = os.getenv("SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1")
        model_name = model or os.getenv("SILICONFLOW_MODEL", "deepseek-ai/DeepSeek-V3")

    if not api_key:
        raise HTTPException(status_code=400, detail={"code": "AI_API_KEY_MISSING", "provider": provider})

    payload = {
        "model": model_name,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": raw_text},
        ],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    data = response.json()
    content = data["choices"][0]["message"]["content"]
    try:
        result = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail={"code": "AI_JSON_INVALID", "message": str(exc)}) from exc
    return {"model": model_name, "result": normalize_result(result), "token_usage": data.get("usage", {})}


SYSTEM_PROMPT = """
你是 GPU 服务器贸易货源结构化抽取器。只输出 JSON object，字段必须匹配：
intent: SELL_OFFER | BUY_DEMAND | CONTACT | UNKNOWN
goods: product_category, gpu_model, gpu_form_factor, gpu_count, server_brand, server_model,
quantity, quantity_unit, condition, availability_type, location
commercial: price, currency, price_unit, tax_included, tax_rate, delivery_days_min, delivery_days_max
parties: [{name, role}]
missing_fields: string[]
conflicts: [{field, values, note}]
field_confidence: object, value between 0 and 1
不得编造未出现的信息；缺失字段写入 missing_fields。
""".strip()


def mock_extract(text: str) -> dict[str, Any]:
    gpu_match = re.search(r"\b(H100|H200|B200|B300|A100|A800|H800|L40S)\b", text, re.I)
    qty_match = re.search(r"(\d+(?:\.\d+)?)\s*(台|套|块|pcs?|片)", text, re.I)
    price_match = re.search(r"(\d+(?:\.\d+)?)\s*(万|w|W)?", text)
    city_match = re.search(r"(深圳|北京|上海|广州|杭州|香港|苏州|成都)", text)
    gpu_model = gpu_match.group(1).upper() if gpu_match else None
    quantity = float(qty_match.group(1)) if qty_match else None
    price = float(price_match.group(1)) if price_match else None
    if price is not None and price_match and price_match.group(2):
        price *= 10000
    result = {
        "intent": "SELL_OFFER" if gpu_model or quantity else "UNKNOWN",
        "goods": {
            "product_category": "SERVER",
            "gpu_model": gpu_model,
            "gpu_form_factor": first_match(text, ["SXM", "PCIE", "NVL", "HGX"]),
            "gpu_count": int(first_number_before(text, "卡") or 8),
            "server_brand": first_match(text, ["Dell", "戴尔", "Supermicro", "超微", "浪潮", "新华三", "H3C"]),
            "server_model": None,
            "quantity": quantity,
            "quantity_unit": qty_match.group(2) if qty_match else "台",
            "condition": "NEW" if re.search(r"全新|新货|未拆", text) else None,
            "availability_type": "SPOT" if re.search(r"现货|现", text) else None,
            "location": {"city": city_match.group(1) if city_match else None},
        },
        "commercial": {"price": price, "currency": "CNY", "price_unit": "PER_UNIT"},
        "parties": [],
        "missing_fields": [],
        "conflicts": [],
        "field_confidence": {},
    }
    required = ["gpu_model", "quantity"]
    for field in required:
        if not result["goods"].get(field):
            result["missing_fields"].append(field)
        else:
            result["field_confidence"][field] = 0.72
    if price:
        result["field_confidence"]["commercial.price"] = 0.58
    return normalize_result(result)


def normalize_result(result: dict[str, Any]) -> dict[str, Any]:
    result.setdefault("intent", "UNKNOWN")
    result.setdefault("goods", {})
    result.setdefault("commercial", {})
    result.setdefault("parties", [])
    result.setdefault("missing_fields", [])
    result.setdefault("conflicts", [])
    result.setdefault("field_confidence", {})
    return result


def first_match(text: str, values: list[str]) -> str | None:
    lowered = text.lower()
    for value in values:
        if value.lower() in lowered:
            return value.upper() if value.isascii() else value
    return None


def first_number_before(text: str, marker: str) -> float | None:
    match = re.search(rf"(\d+(?:\.\d+)?)\s*{re.escape(marker)}", text)
    return float(match.group(1)) if match else None


def elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
