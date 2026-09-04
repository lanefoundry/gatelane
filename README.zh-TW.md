<div align="center">

# gatelane

**AI 代理的預生產安全與評估閘門。**
紅隊攻擊探測。回測升級閘門。共用引擎。

[![CI](https://github.com/lanefoundry/gatelane/actions/workflows/ci.yml/badge.svg)](https://github.com/lanefoundry/gatelane/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-early_preview-orange.svg)

[為什麼選 gatelane](#為什麼選-gatelane) · [模式](#模式) · [快速開始](#快速開始) · [部署](#部署到-cloudflare) · [文件](#文件) · [路線圖](docs/roadmap.md)

[English](README.md) · [繁體中文](README.zh-TW.md)

</div>

gatelane 是 [lanefoundry](https://github.com/lanefoundry) *-lane 家族的第三個產品。它在「發現漏洞」和「驗證修補沒有造成退化」之間建立閉環，透過在同一個捕獲管線和同一個升級原語上執行紅隊攻擊和回測重播。

- [groundlane](https://github.com/lanefoundry/groundlane) — AI 代理的可信內容存取層
- [looplane](https://github.com/lanefoundry/looplane) — 程式碼代理迭代迴圈
- **gatelane** — 預生產安全與評估閘門

> [!IMPORTANT]
> gatelane 目前是早期預覽版（`0.0.0-dev`）。5-6 週的 demo 目標，首個 demo 目標是 looplane（內部使用）。請勿部署到生產環境；預計每週都會有破壞性更新。

## 為什麼選 gatelane

2025-2026 年 AI 代理可觀測性與評估市場已經整合。四個最知名的開源專案已被收購：WhyLabs → Apple、Helicone → Mintlify、Portkey → Palo Alto Networks、Langfuse → ClickHouse。剩餘的領導者（Braintrust、Arize、LangSmith、Maxim、Datadog、MLflow）資金充足。

每個產品都有「回測」功能文件，但**沒有任何一個將其轉化為升級原語**：

- **LangSmith**：「回測根據歷史生產資料評估新版應用程式」——教程等級，但無自動升級。
- **Langfuse**：2026 年 4 月實驗重構支援在「分片生產追蹤視窗」上執行——但無簽章升級報告。
- **Datadog**：Playground「以替代 prompt/provider 重播追蹤」——單一追蹤原語，非資料集層級。
- **Braintrust**：「將低分追蹤拉入資料集」+ Loop 代理——但 Loop 迭代 prompt，不控制流量。
- **Vellum**：「如果你捕獲生產輸入/輸出，回測是可能的」——部落格文章中的簡短提及。

**沒有產品提供 CI/CD 原生的 `如果新模型在凍結的生產切片上勝過基線 Δ ≥ X，則路由 100% 流量；否則自動回滾` 原語。** 這就是 gatelane。

「升級閘門」（promotion gate）是借自發佈工程的術語。在 CI/CD 中，「升級」表示將一個建置從一個階段移到下一個（`dev → staging → canary → production`）。「升級閘門」是版本被允許推進之前必須通過的檢查。在 AI 代理時代，被升級的版本可以是新模型、新 prompt、新的代理路由配置或新的工具 schema——閘門需要驗證新版本在凍結的生產流量切片上至少與當前版本一樣好，**且**不會在已知攻擊有效載荷上退化。

gatelane 提供這個原語。

## 模式

gatelane 在共用引擎上運行。三種模式使用它。

### 紅隊 — "能被攻破嗎？"

對已部署的代理執行攻擊探測。輸出：包含有效載荷、代理回應、證據和結構化修補建議的漏洞清單。

```text
攻擊有效載荷 → 代理回應 → 成功/失敗
                              ↓
                      漏洞記錄
                      + 修補建議
```

攻擊庫包含 50+ 個 prompt injection 向量，涵蓋直接 prompt injection、透過工具的間接 injection、連鎖攻擊、上下文視窗洪泛、記憶體投毒和工具濫用。整合 [garak](https://github.com/NVIDIA/garak)（NVIDIA）、[PyRIT](https://github.com/Azure/PyRIT)（Microsoft）和 [Promptfoo](https://github.com/promptfoo/promptfoo)（OpenAI）。

### 藍隊 — "生產環境健康嗎？"

將凍結的生產流量切片重播到新模型版本。輸出：簽章升級報告。如果 `Δ ≥ threshold`，路由到 canary。否則自動回滾。

```text
凍結的生產切片 → 對新模型重播
                     ↓
              計算 Δ vs 基線
                     ↓
             簽章升級報告
                     ↓
         Δ ≥ X → canary → 100%
         Δ < X → 自動回滾
```

這是其他產品都沒有提供的原語。詳見 [positioning](docs/positioning.md#compare-view-vs-promotion-gate)。

### 評測 — "輸出品質夠好嗎？"

自動化評估 LLM 輸出，支援可配置的評分標準。支援多輪對話評分、結構化輸出驗證和自訂裁判 prompt。評測執行整合共用引擎的評分和追蹤管線。

```text
prompt + 回應 → 裁判模型評估
                    ↓
               結構化分數
                    ↓
          追蹤 + 分數記錄
```

## 威脅模型範圍（v1）

| 來源 | v1 涵蓋範圍 |
|---|---|
| [OWASP Top 10 for Agentic Applications (ASI01–ASI10)](https://genai.owasp.org/) | 完整 |
| [MITRE ATLAS (v5.4.0, 2026 年 2 月)](https://atlas.mitre.org/) | 16 戰術、84 技術、關鍵子技術 |
| [OWASP LLM Top 10 (2026)](https://genai.owasp.org/) | 完整 |
| [NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) | 12 風險類別 |
| 台灣人工智慧基本法 (2025/12/23) | v2 範圍 — v1 出貨後的合規模式 |

## 為什麼選 gatelane，而非替代方案

| 需求 | 替代方案 | 為什麼選 gatelane |
|---|---|---|
| LLM 閘道 / 路由 | OpenRouter ($1.3B)、LiteLLM (28k★)、Bifrost (4k★)、Cloudflare AI Gateway | gatelane 不是閘道。使用以上方案。gatelane 的捕獲 SDK 讀取代理呼叫的內容。 |
| LLM APM / 追蹤 | Datadog、New Relic、Honeycomb | gatelane 不是 APM。gatelane 的稽核日誌記錄對升級重要的事件；APM 記錄一切。 |
| LLM 評估 / 資料集 | LangSmith、Braintrust、Arize、DeepEval、Vellum | 這些是評估執行器。gatelane 的升級閘門是評估**之後**發生的事。 |
| 紅隊 / 攻擊庫 | Mindgard、Lakera (Check Point)、Pillar、Straiker、CyCraft、Noma | 這些競爭攻擊面涵蓋範圍。gatelane 的紅隊模式刻意較小；價值在於與回測形成閉環，而非更廣泛的攻擊。 |
| 工作流控制平面 | Temporal、Inngest、LangGraph、Cloudflare Workflows | gatelane 不是工作流執行時。升級閘門在你使用的任何執行時**之上**運行。 |

gatelane 是**市場上其他產品都沒有提供的一個原語**：基於回測差異的升級，由紅隊在後端形成閉環。

## 快速開始

> [!NOTE]
> 5-6 週的 demo 目標會端到端交付捕獲 SDK、資料集、重播、比較和升級原語。以下快速開始是 v0.1 demo 工作流程。生產級功能（canary 編排器、簽章報告、稽核匯出）在 v0.2 出貨。

### 需求

- Node.js 22+、pnpm 10、Git
- Cloudflare 帳戶（用於生產部署）
- 用於評估/回測裁判模型的 LLM API 金鑰（OpenAI、Anthropic、Gemini 或自建）

### 安裝

```bash
git clone https://github.com/lanefoundry/gatelane.git
cd gatelane
pnpm install
cp .env.example .env
```

在 `.env` 中設定所需的密鑰：

```bash
# 回測評分用的 LLM 裁判（選一個）
GATELANE_JUDGE_PROVIDER=openai
GATELANE_JUDGE_API_KEY=sk-...
GATELANE_JUDGE_MODEL=gpt-4o

# 捕獲 API 認證（>= 32 個隨機字元）
GATELANE_CAPTURE_TOKEN=$(openssl rand -hex 32)
```

啟動本地開發伺服器：

```bash
pnpm dev
```

gatelane 現在在 `http://localhost:8787` 上提供本地 API。

### 捕獲單一 LLM 呼叫

透過 Worker API 整合到代理端：

```typescript
const res = await fetch("http://localhost:8787/v1/capture", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${GATELANE_CAPTURE_TOKEN}`,
  },
  body: JSON.stringify({
    prompt: [{ role: "user", content: userInput }],
    model: "gpt-4o",
    response: openaiResponse,
    metadata: { traceId: "...", agentVersion: "..." },
  }),
});
// 回傳 { id, traceId }
// gatelane 現在有：prompt、response、model、cost、latency、trace
```

或透過 engine 套件以程式方式使用（用於同進程整合）：

```typescript
import { capture } from "@gatelane/engine";

const { response, record } = await capture(env, {
  prompt: [{ role: "user", content: userInput }],
  model: "gpt-4o",
  metadata: { traceId: "...", agentVersion: "..." },
}, async () => {
  return await openai.chat.completions.create({ /* ... */ });
});
```

### 對代理執行紅隊測試

程式化 API（CLI 封裝計劃在 v0.2）：

```typescript
import { allVectors, runAttack, generateReport } from "@gatelane/mode-red-team";

const results = await Promise.all(
  allVectors.map((v) => runAttack(v, "http://localhost:3000/agent")),
);
const report = generateReport(results, ["http://localhost:3000/agent"]);
// report 包含：成功的攻擊、有效載荷、證據、修補建議
```

### 凍結生產切片並回測

程式化 API（CLI 封裝計劃在 v0.2）：

```typescript
import { backtest } from "@gatelane/mode-blue-team";

const report = await backtest(env, {
  window: "7d",
  candidateModel: "gpt-5",
  baselineModel: "gpt-4o",
  threshold: 0.02,
  judge: async (prompt, response) => { /* 回傳 0-1 分數 */ },
  execute: async (prompt, model) => { /* 呼叫 LLM */ },
});
// report.decision === "promote" → Δ >= threshold
// report.decision === "rollback" → Δ < threshold
```

## 部署到 Cloudflare

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm exec wrangler d1 create gatelane
pnpm exec wrangler r2 bucket create gatelane-captures
pnpm exec wrangler kv namespace create GATELANE_KV
# 將回傳的 id 貼到 wrangler.toml

pnpm secrets:status
pnpm secrets:setup
pnpm run deploy
```

推送到 `main` 會在 CI 品質任務成功後自動部署。儲存庫必須有 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` GitHub Actions 密鑰，以及 `GATELANE_CAPTURE_TOKEN` 用於部署後煙霧測試。

## 使用案例

### 正在出貨代理的資安團隊

> 「我們是否暴露於已知的攻擊向量？我們怎麼知道修補有效？」

在每次發佈前執行**紅隊**。修補後執行**藍隊**，驗證新版本不會在品質**或**攻擊抵抗力上退化。

### 正在出貨 LLM 功能的 ML / 平台團隊

> 「我們能否在不整天盯著比較視圖的情況下出貨新模型版本？」

在每個修改模型配置的 PR 上執行**藍隊**。升級閘門自動路由到 canary 或回滾。

### 程式碼代理團隊

> 「如果我的程式碼代理被 prompt injection 劫持怎麼辦？我怎麼知道什麼時候修好了？」

使用程式碼代理特定的攻擊向量（工具濫用、透過程式碼執行的間接 injection）執行**紅隊**。使用代理生產流量的凍結資料集執行**藍隊** 來驗證修補。

### CISO / 合規長（v2 範圍）

> 「我們是否符合人工智慧基本法 / NIST AI 600-1？」

v2 在相同引擎上添加合規模式。涵蓋範圍由 v1 攻擊庫 + OWASP Agentic Top 10 + MITRE ATLAS + NIST 600-1 對照表建立。

## 技術堆疊

| 層級 | 選擇 | 原因 |
|---|---|---|
| 執行時 | Cloudflare Workers | 邊緣運算、低延遲、可用 queue + DO + Workflows |
| 儲存 | D1（中繼資料）+ R2（原始捕獲）+ KV（速率限制、短期視窗） | 與 groundlane 和 looplane 相同堆疊 |
| 前端 | React + TanStack Start (Vite 8) + Hono | 統一 Cloudflare Worker：SSR + API 合一 |
| 攻擊庫 | garak (NVIDIA) + PyRIT (Microsoft) + Promptfoo (OpenAI) | 不重新發明攻擊目錄 |
| 授權 | Apache 2.0 | 與 groundlane 和 looplane 相同 |

## 開發

```bash
pnpm install          # 安裝所有相依套件
pnpm dev              # 啟動統一 Worker 開發伺服器（SSR + API，localhost:8787）
pnpm typecheck        # 執行 TypeScript 型別檢查（tsc -b）
pnpm lint             # 執行 ESLint（flat config + typescript-eslint）
pnpm test             # 執行測試（vitest）
pnpm format:check     # 檢查 Prettier 格式
pnpm format           # 以 Prettier 自動格式化
```

### Worker API 端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/v1/capture` | 捕獲一次 LLM 呼叫（需要 Bearer token） |
| GET | `/v1/datasets` | 列出所有資料集 |
| GET | `/v1/datasets/:id` | 取得指定資料集 |
| GET | `/v1/replay-runs` | 列出所有重播執行 |
| GET | `/v1/replay-runs/:id` | 取得指定重播執行 |
| GET | `/v1/promotions` | 列出所有升級報告 |
| GET | `/v1/promotions/:id` | 取得指定升級報告 |
| GET | `/v1/audit-log` | 列出稽核日誌項目 |
| GET | `/v1/traces` | 列出所有追蹤 |
| GET | `/v1/traces/:id` | 取得指定追蹤（含 spans、generations、scores） |

### 儀表板

儀表板是一個 TanStack Start SSR 應用，包含 8 個頁面（捕獲、資料集、重播執行、升級報告、紅隊、稽核日誌、追蹤列表、追蹤詳情），與 API 一起在同一個統一 Cloudflare Worker 中提供（`apps/web/`）。使用檔案式路由、透過 `createServerFn` 實作伺服器函式、透過 `cloudflare:workers` 存取環境變數。

```bash
pnpm dev              # 在 localhost:8787 同時提供 API 和儀表板
```

### 套件

| 套件 | 說明 |
|---|---|
| `@gatelane/shared` | 共用型別（CaptureRecord、Dataset、ReplayRun、PromotionReport、Env）和 D1 schema |
| `@gatelane/engine` | 捕獲 SDK、資料集（freeze-slice）、重播、比較、稽核日誌、升級原語 |
| `@gatelane/mode-red-team` | 50+ 攻擊向量（6 類別）、執行器、報告產生器 |
| `@gatelane/mode-blue-team` | 端到端回測流程（凍結 → 重播 → 比較 → 升級/回滾） |
| `@gatelane/mode-eval` | 自動化 LLM 輸出評估，可配置裁判 prompt |

## 儲存庫結構

```text
gatelane/
├── README.md
├── README.zh-TW.md             — 繁體中文 README
├── eslint.config.mjs           — ESLint 9 flat config（typescript-eslint）
├── vitest.config.ts            — Vitest 配置
├── docs/
│   ├── positioning.md          — 切入點、市場整合、目標客戶
│   ├── roadmap.md              — 5-6 週 demo 計劃、v0.2 / v1.0
│   ├── strategic-record.md     — 為什麼從 Agent Platform 轉向
│   ├── threat-model.md         — OWASP / MITRE / NIST 對照
│   ├── attack-library.md       — 50+ 攻擊向量參考
│   ├── architecture.md         — 共用引擎內部、資料流、schema
│   └── product-scope.md        — 產品範圍與功能邊界
├── packages/
│   ├── engine/                 — 捕獲 SDK + 資料集 + 重播 + 比較 + 稽核日誌 + 升級原語
│   ├── mode-red-team/          — 紅隊：6 攻擊類別、50+ 向量、執行器、報告
│   ├── mode-blue-team/         — 藍隊：資料集重播 + 比較 + 升級閘門
│   ├── mode-eval/              — 評測：自動化 LLM 輸出評估
│   └── shared/                 — 共用型別、D1 schema
├── apps/
│   ├── web/                    — 統一 Cloudflare Worker（TanStack Start SSR + Hono API）
│   ├── worker/                 — （舊版）獨立 Hono Worker
│   └── dashboard/              — （舊版）React + Vite SPA
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── schema/d1.sql               — D1 資料庫 schema（位於 packages/shared）
├── package.json                — pnpm workspace 根目錄
├── pnpm-workspace.yaml
└── LICENSE                     — Apache 2.0
```

## 文件

- [Why gatelane](docs/positioning.md) — 基於回測差異升級的切入點
- [Roadmap](docs/roadmap.md) — 5-6 週 demo 目標、v0.2 和 v1.0 計劃
- [Strategic record](docs/strategic-record.md) — 為什麼從 Agent Platform 轉向
- [Threat model](docs/threat-model.md) — OWASP Agentic/LLM Top 10、MITRE ATLAS、NIST AI 600-1
- [Attack library](docs/attack-library.md) — 50+ 攻擊向量參考
- [Architecture](docs/architecture.md) — 系統架構、資料流、升級原語
- [Product scope](docs/product-scope.md) — 產品範圍與功能邊界

## 狀態

| 項目 | 狀態 |
|---|---|
| 儲存庫 + README + 定位 | ✅ 完成 (2026-08-30) |
| 專案鷹架（package.json、pnpm-workspace、wrangler.toml、.env.example、CI） | ✅ 完成 (2026-09-03) |
| D1 schema / migrations | ✅ 完成 (2026-09-03) |
| 捕獲 SDK（一行整合） | ✅ 完成 (2026-09-03) |
| 共用引擎（資料集 / 重播 / 比較 / 稽核日誌 / 升級） | ✅ 完成 (2026-09-03) |
| Worker API（捕獲端點 + 重播 API） | ✅ 完成 (2026-09-03) |
| 紅隊（50+ 攻擊） | ✅ 完成 (2026-09-03) — 6 類別、50+ 向量、執行器、報告 |
| 藍隊（回測 + 升級閘門） | ✅ 完成 (2026-09-03) |
| 儀表板（攻擊報告 + 升級報告 UI） | ✅ 完成 (2026-09-03) — 8 頁面、TanStack Start SSR、檔案式路由 |
| 前端遷移：TanStack Start + Hono 統一 Worker | ✅ 完成 (2026-09-04) |
| 評測模式 | ✅ 完成 (2026-09-04) |
| 追蹤檢視器（時間軸 + 分數） | ✅ 完成 (2026-09-04) |
| 文件：threat-model.md | ✅ 完成 (2026-09-03) |
| 文件：attack-library.md | ✅ 完成 (2026-09-03) |
| 文件：architecture.md | ✅ 完成 (2026-09-03) |
| 首個 demo 目標：looplane 漏洞報告 | ❌ 尚未開始 |
| 首份升級報告：gatelane 驗證 looplane 的修補 | ❌ 尚未開始 |
| v0.1 demo 出貨 | 🎯 目標：2026-10-11 |

## 這不是什麼

- **不是通用 LLM 閘道。** 使用 OpenRouter / LiteLLM / Bifrost 進行路由。
- **不是純 APM。** 使用 Datadog / New Relic / Honeycomb 進行追蹤分析。
- **不是工作流控制平面。** Agent Platform 轉向已暫停；詳見 [strategic-record.md](docs/strategic-record.md)。
- **不是託管服務。** 自行部署在你的 Cloudflare 帳戶。
- **不是研究專案。** 5-6 週的 demo 目標是要出貨，不是要發論文。

## 授權

Apache 2.0.

## 相關

- [lanefoundry/groundlane](https://github.com/lanefoundry/groundlane) — 可信內容存取層
- [lanefoundry/looplane](https://github.com/lanefoundry/looplane) — 程式碼代理迭代迴圈
- [Lanefoundry 品牌規範](docs/strategic-record.md#5-brand-pivot-from-agent-platform-to--lane-family) — *-lane 家族定位
- `.research/2026-08-30-ai-agent-security-market.md` — 代理安全市場（含台灣）
- `.research/2026-08-30-ai-response-observability-market.md` — 回測空白市場
