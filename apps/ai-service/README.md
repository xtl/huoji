# huoji ai-service

一期 AI 服务骨架：OCR/图片识别入口、LLM 结构化抽取、多模型网关、调用成本记录字段。

默认 `AI_PROVIDER=mock`，无需 API Key 也能本地联调。接 DeepSeek 或 SiliconFlow 时，两家都走 OpenAI 兼容协议：

```powershell
$env:AI_PROVIDER="deepseek"
$env:DEEPSEEK_API_KEY="..."
$env:DEEPSEEK_MODEL="deepseek-v4-flash" # 或 deepseek-v4-pro
uvicorn app.main:app --reload --port 8010
```

SiliconFlow：

```powershell
$env:AI_PROVIDER="siliconflow"
$env:SILICONFLOW_API_KEY="..."
$env:SILICONFLOW_MODEL="deepseek-ai/DeepSeek-V3"
uvicorn app.main:app --reload --port 8010
```

核心接口：

- `POST /v1/extractions/goods`：文本结构化抽取
- `POST /v1/ocr`：OCR 占位入口，一期可替换为 PaddleOCR/云 OCR
- `GET /health`
