# 货记 huoji-platform

面向 GPU 服务器/整机/模组及零配件贸易产业链的 AI 货源记录、关系管理、报价协作与交易推进系统。

设计依据：[docs/货记系统总体设计说明书-V1.0.docx](docs/货记系统总体设计说明书-V1.0.docx)
开发排期：[docs/00-阶段执行计划.md](docs/00-阶段执行计划.md)

## 仓库结构（说明书第 5 章）

```
├── apps/
│   ├── api/          # 核心业务 API（模块化单体，NestJS + TypeScript）
│   ├── ai-service/   # AI 处理服务（Python FastAPI，OCR/ASR/LLM 结构化，一期骨架）
│   ├── worker/       # 异步任务（占位）
│   └── (miniapp/ web/ 后续加入)
├── packages/
│   └── domain-types/ # 前后端共享类型：状态机枚举、实体类型（第 10/15 章）
├── database/
│   ├── migrations/   # PostgreSQL 迁移（第 9/10/27 章）
│   ├── seeds/
│   └── dictionaries/ # GPU/品牌别名等字典
├── infra/
├── docs/             # 设计说明书、阶段计划、补充章节
└── demo_ui/          # 【高保真交互稿】AI Studio 原型，不是产品代码
                      # 改造清单见 docs/00-阶段执行计划.md §4
```

## 关键开发约束（第 28 章，不可违反）

1. 每条业务数据必须有 `workspace_id`；禁止跨空间直接查询
2. 货源（goods_offers）、库存（inventory_lots）、报价（quotes）是三个不同对象
3. 价格、数量、状态必须保留历史；报价必须保存版本快照
4. AI 抽取结果必须经用户确认后才能成为正式业务数据
5. 无权限字段后端不得返回（不是前端隐藏）
