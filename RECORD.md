# Claude Code 项目运行记录

> 项目: `/Users/konghayao/code/ai/claude-code`
> 日期: 2026-03-31
> 包管理器: bun

---

## 一、项目目标

**将 claude-code 项目运行起来，必要时可以删减次级能力。**

这是 Anthropic 官方 Claude Code CLI 工具的源码反编译/逆向还原项目。

### 核心保留能力

- API 通信（Anthropic SDK / Bedrock / Vertex）
- Bash/FileRead/FileWrite/FileEdit 等核心工具
- REPL 交互界面（ink 终端渲染）
- 对话历史与会话管理
- 权限系统（基础）
- Agent/子代理系统

### 已删减的次级能力

| 模块 | 处理方式 |
|------|----------|
| Computer Use (`@ant/computer-use-*`) | stub |
| Claude for Chrome (`@ant/claude-for-chrome-mcp`) | stub |
| Magic Docs / Voice Mode / LSP Server | 移除 |
| Analytics / GrowthBook / Sentry | 空实现 |
| Plugins/Marketplace / Desktop Upsell | 移除 |
| Ultraplan / Tungsten / Auto Dream | 移除 |
| MCP OAuth/IDP | 简化 |
| DAEMON / BRIDGE / BG_SESSIONS / TEMPLATES 等 | feature flag 关闭 |

---

## 二、当前状态：Dev 模式已可运行

```bash
# dev 运行
bun run dev
# 直接运行
bun run src/entrypoints/cli.tsx
# 测试 -p 模式
echo "say hello" | bun run src/entrypoints/cli.tsx -p
# 构建
bun run build
```

| 测试 | 结果 |
|------|------|
| `--version` | `2.1.87 (Claude Code)` |
| `--help` | 完整帮助信息输出 |
| `-p` 模式 | 成功调用 API 返回响应 |

### TS 类型错误说明

~~仍有 ~1341 个 tsc 错误~~ → 经过系统性类型修复，已降至 **~294 个**（减少 78%）。剩余错误分散在小文件中，均为反编译产生的源码级类型问题（`unknown`/`never`/`{}`），**不影响 Bun 运行时**。

---

## 三、关键修复记录

### 3.1 自动化 stub 生成

通过 3 个脚本自动处理了缺失模块问题：
- `scripts/create-type-stubs.mjs` — 生成 1206 个 stub 文件
- `scripts/fix-default-stubs.mjs` — 修复 120 个默认导出 stub
- `scripts/fix-missing-exports.mjs` — 补全 81 个模块的 161 个缺失导出

### 3.2 手动类型修复

- `src/types/global.d.ts` — MACRO 宏、内部函数声明
- `src/types/internal-modules.d.ts` — `@ant/*` 等私有包类型声明
- `src/entrypoints/sdk/` — 6 个 SDK 子模块 stub
- 泛型类型修复（DeepImmutable、AttachmentMessage 等）
- 4 个 `export const default` 非法语法修复

### 3.3 运行时修复

**Commander 非法短标志**：`-d2e, --debug-to-stderr` → `--debug-to-stderr`（反编译错误）

**`bun:bundle` 运行时 Polyfill**（`src/entrypoints/cli.tsx` 顶部）：
```typescript
const feature = (_name: string) => false;  // 所有 feature flag 分支被跳过
(globalThis as any).MACRO = { VERSION: "2.1.87", ... };  // 绕过版本检查
```

---

## 四、关键文件清单

| 文件 | 用途 |
|------|------|
| `src/entrypoints/cli.tsx` | 入口文件（含 MACRO/feature polyfill） |
| `src/main.tsx` | 主 CLI 逻辑（Commander 定义） |
| `src/types/global.d.ts` | 全局变量/宏声明 |
| `src/types/internal-modules.d.ts` | 内部 npm 包类型声明 |
| `src/entrypoints/sdk/*.ts` | SDK 类型 stub |
| `src/types/message.ts` | Message 系列类型 stub |
| `scripts/create-type-stubs.mjs` | 自动 stub 生成脚本 |
| `scripts/fix-default-stubs.mjs` | 修复默认导出 stub |
| `scripts/fix-missing-exports.mjs` | 补全缺失导出 |

---

## 五、Monorepo 改造（2026-03-31）

### 5.1 背景

`color-diff-napi` 原先是手工放在 `node_modules/` 下的 stub 文件，导出的是普通对象而非 class，导致 `new ColorDiff(...)` 报错：
```
ERROR Object is not a constructor (evaluating 'new ColorDiff(patch, firstLine, filePath, fileContent)')
```
同时 `@ant/*`、其他 `*-napi` 包也只有 `declare module` 类型声明，无运行时实现。

### 5.2 方案

将项目改造为 **Bun workspaces monorepo**，所有内部包统一放在 `packages/` 下，通过 `workspace:*` 依赖解析。

### 5.3 创建的 workspace 包

| 包名 | 路径 | 类型 |
|------|------|------|
| `color-diff-napi` | `packages/color-diff-napi/` | 完整实现（~1000行 TS，从 `src/native-ts/color-diff/` 移入） |
| `modifiers-napi` | `packages/modifiers-napi/` | stub（macOS 修饰键检测） |
| `audio-capture-napi` | `packages/audio-capture-napi/` | stub |
| `image-processor-napi` | `packages/image-processor-napi/` | stub |
| `url-handler-napi` | `packages/url-handler-napi/` | stub |
| `@ant/claude-for-chrome-mcp` | `packages/@ant/claude-for-chrome-mcp/` | stub |
| `@ant/computer-use-mcp` | `packages/@ant/computer-use-mcp/` | stub（含 subpath exports: sentinelApps, types） |
| `@ant/computer-use-input` | `packages/@ant/computer-use-input/` | stub |
| `@ant/computer-use-swift` | `packages/@ant/computer-use-swift/` | stub |

### 5.4 新增的 npm 依赖

| 包名 | 原因 |
|------|------|
| `@opentelemetry/semantic-conventions` | 构建报错缺失 |
| `fflate` | `src/utils/dxt/zip.ts` 动态 import |
| `vscode-jsonrpc` | `src/services/lsp/LSPClient.ts` import |
| `@aws-sdk/credential-provider-node` | `src/utils/proxy.ts` 动态 import |

### 5.5 关键变更

- `package.json`：添加 `workspaces`，添加所有 workspace 包和缺失 npm 依赖
- `src/types/internal-modules.d.ts`：删除已移入 monorepo 的 `declare module` 块，仅保留 `bun:bundle`、`bun:ffi`、`@anthropic-ai/mcpb`
- `src/native-ts/color-diff/` → `packages/color-diff-napi/src/`：移动并内联了对 `stringWidth` 和 `logError` 的依赖
- 删除 `node_modules/color-diff-napi/` 手工 stub

### 5.6 构建验证

```
$ bun run build
Bundled 5326 modules in 491ms
  cli.js  25.74 MB  (entry point)
```

---

## 六、系统性类型修复（2026-03-31）

### 6.1 背景

反编译产生的源码存在 ~1341 个 tsc 类型错误，主要成因：
- `unknown` 类型上的属性访问（714 个，占 54%）
- 类型赋值不兼容（212 个）
- 参数类型不匹配（140 个）
- 不可能的字面量比较（106 个，如 `"external" === 'ant'`）

### 6.2 修复策略

通过 4 轮并行 agent（每轮 7 个）系统性修复，**从 1341 降至 ~294**（减少 78%）。

#### 根因修复（影响面最大）

| 修复 | 影响 |
|------|------|
| `useAppState<R>` 添加泛型签名 (`AppState.tsx`) | 消除全局大量 `unknown` 返回值 |
| `Message` 类型重构 (`message.ts`) | content 改为 `string \| ContentBlockParam[] \| ContentBlock[]`；添加 `MessageType` 扩展联合；`GroupedToolUseMessage`/`CollapsedReadSearchGroup` 结构化 |
| `SDKAssistantMessageError` 命名冲突修复 (`coreTypes.generated.ts`) | 解决 37 个 errors.ts 类型错误 |
| SDK 消息类型增强 (`coreTypes.generated.ts`) | `SDKAssistantMessage`/`SDKUserMessage` 等添加具体字段声明 |
| `NonNullableUsage` 扩展 (`sdkUtilityTypes.ts`) | 添加 snake_case 属性声明 |

#### 批量模式修复

| 模式 | 修复方式 | 数量 |
|------|----------|------|
| `"external" === 'ant'` 编译常量比较 | `("external" as string) === 'ant'` | ~60 处 |
| `unknown` 属性访问 | 精确类型断言（`as SomeType`） | ~400 处 |
| `message.content` union 无法调用数组方法 | `Array.isArray()` 守卫 | ~80 处 |
| stub 包缺失方法/类型 | 补全 stub 类型声明 | ~15 个包 |

#### Stub 包类型补全

| 包 | 补全内容 |
|----|----------|
| `@ant/computer-use-swift` | `ComputerUseAPI` 完整接口（apps/display/screenshot） |
| `@ant/computer-use-input` | `ComputerUseInputAPI` 完整接口 |
| `audio-capture-napi` | 4 个函数签名 |

### 6.3 修复的关键文件

| 文件 | 修复错误数 |
|------|-----------|
| `src/screens/REPL.tsx` | ~100 |
| `src/utils/hooks.ts` | ~81 |
| `src/utils/sessionStorage.ts` | ~58 |
| `src/components/PromptInput/` | ~45 |
| `src/services/api/errors.ts` | ~37 |
| `src/utils/computerUse/executor.ts` | ~36 |
| `src/utils/messages.ts` | ~83 |
| `src/QueryEngine.ts` | ~39 |
| `src/services/api/claude.ts` | ~35 |
| `src/cli/print.ts` + `structuredIO.ts` | ~46 |
| 其他 ~50 个文件 | ~487 |

---
---

# Claude Code 源码深度解析

> 基于 `claude-code/src`（2,797 文件）与 `cc_src.zip`（1,902 文件）对比分析
> 分析日期: 2026-04-01

---

## 目录

- [第一部分：项目全景](#第一部分项目全景)
  - [第7章 项目概述](#第7章-项目概述)
  - [第8章 仓库结构总览](#第8章-仓库结构总览)
  - [第9章 启动流程与生命周期](#第9章-启动流程与生命周期)
- [第二部分：核心引擎](#第二部分核心引擎)
  - [第10章 查询引擎与对话循环](#第10章-查询引擎与对话循环)
  - [第11章 API 层与模型路由](#第11章-api-层与模型路由)
  - [第12章 系统提示词与上下文构建](#第12章-系统提示词与上下文构建)
- [第三部分：工具生态](#第三部分工具生态)
  - [第13章 工具系统架构](#第13章-工具系统架构)
  - [第14章 核心工具详解](#第14章-核心工具详解)
  - [第15章 Agent 系统](#第15章-agent-系统)
  - [第16章 Skills 系统](#第16章-skills-系统)
  - [第17章 Task 系统](#第17章-task-系统)
  - [第18章 Plan Mode](#第18章-plan-mode)
- [第四部分：安全与权限](#第四部分安全与权限)
  - [第19章 权限系统](#第19章-权限系统)
  - [第20章 Hooks 系统](#第20章-hooks-系统)
- [第五部分：记忆与持久化](#第五部分记忆与持久化)
  - [第21章 Memory 系统](#第21章-memory-系统)
  - [第22章 消息压缩](#第22章-消息压缩)
  - [第23章 会话管理与历史](#第23章-会话管理与历史)
- [第六部分：UI 与交互层](#第六部分ui-与交互层)
  - [第24章 Ink 终端 UI 框架](#第24章-ink-终端-ui-框架)
  - [第25章 REPL 交互界面](#第25章-repl-交互界面)
  - [第26章 Commands 系统](#第26章-commands-系统)
- [第七部分：外部集成](#第七部分外部集成)
  - [第27章 MCP 集成](#第27章-mcp-集成)
  - [第28章 设置与配置系统](#第28章-设置与配置系统)
- [第八部分：进阶架构](#第八部分进阶架构)
  - [第29章 状态管理](#第29章-状态管理)
  - [第30章 Daemon 与远程会话](#第30章-daemon-与远程会话)
  - [第31章 Coordinator 模式](#第31章-coordinator-模式)
- [第九部分：工程实践与版本对比](#第九部分工程实践与版本对比)
  - [第32章 构建与打包](#第32章-构建与打包)
  - [第33章 类型系统](#第33章-类型系统)
  - [第34章 两版本源码对比](#第34章-两版本源码对比)
- [附录](#附录)

---

# 第一部分：项目全景

## 第7章 项目概述

### 7.1 Claude Code 是什么

Claude Code 是 Anthropic 官方的 AI 辅助编码 CLI 工具，允许用户在终端中与 Claude 进行交互式编程协作。它不是简单的 chatbot——而是一个具备**文件读写、命令执行、代码搜索、子代理编排、任务规划**等完整能力的 agentic coding 系统。

### 7.2 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | **Bun**（非 Node.js） |
| 语言 | TypeScript + TSX |
| 终端 UI | 自定义 **Ink** 框架（React reconciler for terminal） |
| API 客户端 | `@anthropic-ai/sdk` |
| CLI 框架 | Commander.js |
| Schema 验证 | Zod 4.x |
| MCP 协议 | `@modelcontextprotocol/sdk` |
| 构建 | Bun bundler（单文件 ~25MB） |

### 7.3 代码规模

```
src/ 目录:          2,797 个文件
一级子目录:          44 个
packages/ 目录:      8 个 workspace 包
工具数量:            55+ 个
命令数量:            90+ 个
核心文件最大:         REPL.tsx (~5000 行), claude.ts (~3400 行)
```

### 7.4 设计哲学

1. **Agentic Loop**: 核心是 query → tool_use → tool_result → query 的循环，模型驱动一切
2. **Permission-first**: 每个工具调用都经过权限系统，支持从全自动到全手动的 6 种模式
3. **可扩展**: 通过 Skills（提示词技能）、MCP（外部工具协议）、Hooks（生命周期钩子）三重机制扩展
4. **Terminal-native**: 基于 React 的终端 UI 框架，支持虚拟滚动、搜索高亮、vim 模式

---

## 第8章 仓库结构总览

### 8.1 顶层目录

```
claude-code/
├── src/                          # 主要源码 (2,797 files)
│   ├── entrypoints/              # 入口文件
│   ├── main.tsx                  # CLI 定义 (234 KB)
│   ├── query.ts                  # 查询引擎核心 (69 KB)
│   ├── QueryEngine.ts            # 上层编排器 (48 KB)
│   ├── Tool.ts                   # 工具接口定义
│   ├── tools.ts                  # 工具注册表
│   ├── commands.ts               # 命令注册表
│   ├── context.ts                # 上下文构建
│   ├── history.ts                # 对话历史
│   │
│   ├── tools/                    # 55 个工具实现
│   ├── commands/                 # 90+ 个斜杠命令
│   ├── components/               # React 组件 (34 目录)
│   ├── screens/                  # 主屏幕 (REPL, Doctor)
│   ├── services/                 # 服务层 (26 目录)
│   ├── utils/                    # 工具函数 (34 目录)
│   ├── ink/                      # 自定义 Ink 框架 (48 文件)
│   ├── state/                    # 状态管理
│   ├── types/                    # 类型定义
│   ├── skills/                   # Skills 加载
│   ├── memdir/                   # Memory 系统
│   ├── schemas/                  # Zod schemas
│   ├── hooks/                    # React hooks
│   └── bootstrap/                # 启动状态
│
├── packages/                     # Monorepo workspace 包
│   ├── color-diff-napi/          # 完整实现 (~1000行)
│   ├── modifiers-napi/           # stub
│   ├── audio-capture-napi/       # stub
│   ├── image-processor-napi/     # stub
│   ├── url-handler-napi/         # stub
│   └── @ant/                     # Anthropic 内部包 stub
│       ├── computer-use-mcp/
│       ├── computer-use-swift/
│       ├── computer-use-input/
│       └── claude-for-chrome-mcp/
│
├── scripts/                      # 构建/修复脚本
├── package.json                  # Bun workspace 定义
├── tsconfig.json                 # TS 配置 (ESNext, react-jsx)
├── CLAUDE.md                     # Claude Code 自用指导文件
└── RECORD.md                     # 本文档
```

### 8.2 Monorepo 架构

采用 **Bun workspaces** 管理，`package.json` 配置：

```json
{
  "workspaces": ["packages/*", "packages/@ant/*"],
  "type": "module"
}
```

所有内部包通过 `workspace:*` 解析，构建时打包进单文件。

### 8.3 核心文件大小排名

| 文件 | 大小 | 职责 |
|------|------|------|
| `screens/REPL.tsx` | ~600 KB | 交互式主屏幕 |
| `main.tsx` | 234 KB | CLI 入口与定义 |
| `services/api/claude.ts` | 126 KB | API 客户端 |
| `ink/ink.tsx` | 77 KB | 终端 UI 渲染器 |
| `query.ts` | 69 KB | 查询引擎核心 |
| `QueryEngine.ts` | 48 KB | 上层编排器 |
| `commands.ts` | 25 KB | 命令注册表 |

---

## 第9章 启动流程与生命周期

### 9.1 完整启动链路

```
cli.tsx                         # 真实入口
  │
  ├─ 注入 polyfill:
  │   feature() → 永远返回 false
  │   MACRO.VERSION → "2.1.87"
  │   BUILD_TARGET, BUILD_ENV, INTERFACE_TYPE
  │
  ├─ 快速路径检查:
  │   --version → 直接输出版本号
  │   --daemon-worker → 启动守护进程
  │   --bridge → 启动远程桥接
  │
  └─ 动态加载 main.tsx
       │
       ├─ init()  ← entrypoints/init.ts
       │   ├─ 配置验证
       │   ├─ 环境变量应用
       │   ├─ Telemetry 初始化 (OpenTelemetry, lazy)
       │   ├─ Trust dialog
       │   └─ Keychain 预取 (OAuth/API key)
       │
       ├─ Commander.js CLI 定义
       │   ├─ 全局选项 (--model, --system-prompt, -p, etc.)
       │   ├─ 子命令 (resume, share, config, etc.)
       │   └─ 参数解析
       │
       └─ launchRepl() 或 pipeMode()
            │
            ├─ 交互模式 → REPL.tsx (React/Ink 渲染)
            │   ├─ AppState 初始化
            │   ├─ QueryEngine 创建
            │   ├─ MCP 服务器连接
            │   ├─ 工具注册
            │   └─ 等待用户输入 → 进入查询循环
            │
            └─ 管道模式 → 直接执行 query() → 输出结果
```

### 9.2 两种运行模式

**交互模式 (REPL)**:
```bash
bun run dev          # 或 claude
```
启动完整 React 终端 UI，用户在 PromptInput 中输入，消息通过 VirtualMessageList 渲染。

**管道模式 (Pipe)**:
```bash
echo "explain this code" | claude -p
```
跳过 UI，直接调用 query()，结果输出到 stdout。适合脚本集成。

---

# 第二部分：核心引擎

## 第10章 查询引擎与对话循环

这是 Claude Code 的心脏——理解了查询循环就理解了整个系统。

### 10.1 核心架构

```
┌─────────────────────────────────────────────┐
│                QueryEngine                   │
│  (对话编排、文件历史、归因追踪、turn 簿记)      │
│                                              │
│  ┌─────────────────────────────────────┐     │
│  │            query()                   │     │
│  │  (async generator 主循环)            │     │
│  │                                      │     │
│  │  while (true) {                      │     │
│  │    1. 构建请求 (messages + tools)     │     │
│  │    2. 调用 API (streaming)           │     │
│  │    3. 接收助手消息                    │     │
│  │    4. 提取 tool_use blocks           │     │
│  │    5. 执行工具 (并发/串行)            │     │
│  │    6. 注入 tool_result               │     │
│  │    7. 检查终止条件                    │     │
│  │    8. auto-compact 检查              │     │
│  │  }                                   │     │
│  └─────────────────────────────────────┘     │
└─────────────────────────────────────────────┘
        ↕                    ↕
   API Layer            Tool System
  (claude.ts)     (StreamingToolExecutor)
```

### 10.2 query.ts — 主循环

**文件**: `src/query.ts` (1732+ 行)

`query()` 是一个 **async generator**，每次迭代产出流式事件、消息或工具结果：

```typescript
// 简化的核心循环
async function* queryLoop(state: State, params: QueryParams) {
  while (true) {
    // 1. 调用模型
    const stream = queryModelWithStreaming(messages, tools, systemPrompt)
    
    // 2. 处理流式响应
    for await (const event of stream) {
      yield event  // 产出给 UI 层渲染
    }
    
    // 3. 提取工具调用
    const toolUseBlocks = extractToolUseBlocks(assistantMessage)
    if (toolUseBlocks.length === 0) break  // 无工具调用 = 对话结束
    
    // 4. 执行工具
    const results = await* runTools(toolUseBlocks, toolUseContext)
    
    // 5. 注入结果到消息列表
    messages.push(...toolResults)
    
    // 6. Auto-compact 检查
    if (tokenCount > autoCompactThreshold) {
      await compactConversation(messages)
    }
  }
}
```

**关键参数** (`QueryParams`):

| 参数 | 类型 | 说明 |
|------|------|------|
| `messages` | `Message[]` | 对话历史 |
| `systemPrompt` | `SystemPrompt` | 系统提示词 |
| `canUseTool` | `CanUseToolFn` | 权限检查函数 |
| `toolUseContext` | `ToolUseContext` | 工具执行上下文 |
| `taskBudget` | `{ total: number }` | Agent 行动预算 |
| `fallbackModel` | `string?` | 重试用的备选模型 |

### 10.3 QueryEngine — 上层编排

**文件**: `src/QueryEngine.ts` (1320 行)

QueryEngine 包装 query()，管理更高层面的关注点：

```typescript
class QueryEngine {
  private mutableMessages: Message[]
  private abortController: AbortController
  private permissionDenials: SDKPermissionDenial[]
  private totalUsage: NonNullableUsage
  private discoveredSkillNames = new Set<string>()
  
  async *submitMessage(prompt: string | ContentBlockParam[]) {
    // 1. 预处理用户输入
    // 2. 文件历史快照
    // 3. 调用 query()
    // 4. 后处理 (归因、token 统计)
    // 5. 产出 SDKMessage
  }
}
```

**职责分工**:

| 组件 | 职责 |
|------|------|
| `query.ts` | API 调用、工具循环、流式处理、compaction |
| `QueryEngine.ts` | 对话状态、文件历史、token 统计、归因 |
| `REPL.tsx` | 用户交互、消息渲染、权限 UI |

### 10.4 工具并发调度

**文件**: `src/services/tools/toolOrchestration.ts`

工具执行并非简单顺序——系统会区分 **并发安全** 和 **非并发安全** 工具：

```
工具调用批次: [FileRead, FileRead, Bash, FileEdit]
                ↓
分区:
  并发安全组: [FileRead, FileRead]  → 并行执行 (max 10)
  非并发组:   [Bash]               → 串行
  非并发组:   [FileEdit]           → 串行
```

**StreamingToolExecutor** (`services/tools/StreamingToolExecutor.ts`) 负责并发控制：

```typescript
class StreamingToolExecutor {
  private tools: TrackedTool[] = []     // 队列
  private siblingAbortController        // 工具间取消
  
  addTool(block, assistantMessage)      // 入队
  async *getRemainingResults()          // 产出完成的结果
}
```

最大并发数通过 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 环境变量控制，默认 10。

---

## 第11章 API 层与模型路由

### 11.1 API 客户端

**文件**: `src/services/api/claude.ts` (3400+ 行)

这是与 Claude API 通信的核心模块，支持流式和非流式两种调用方式。

**核心函数链**:

```
queryModel()
  ├─ 构建参数: system prompt blocks, tools schema, betas
  ├─ 选择 provider: Anthropic / Bedrock / Vertex / Azure
  ├─ getAnthropicClient() → SDK 客户端实例
  └─ queryModelWithStreaming()
       ├─ Anthropic SDK stream
       ├─ yield BetaRawMessageStreamEvent
       ├─ 处理 content_block_start/delta/stop
       └─ 组装 AssistantMessage
```

**支持的 Betas**:

| Beta | 说明 |
|------|------|
| thinking | 扩展思考能力 |
| tool_use_batches | 批量工具调用 |
| audio | 音频处理 |
| advisors | 顾问模型 |

### 11.2 多 Provider 支持

```
                    ┌─────────────────┐
                    │  queryModel()   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ↓              ↓              ↓
     ┌──────────────┐ ┌───────────┐ ┌────────────┐
     │  Anthropic   │ │ Bedrock   │ │  Vertex    │
     │  (直连 API)  │ │ (AWS SDK) │ │ (GCP SDK)  │
     └──────────────┘ └───────────┘ └────────────┘
                                          ↓
                                    ┌────────────┐
                                    │   Azure    │
                                    └────────────┘
```

Provider 选择通过 `getAPIProvider()` (`src/utils/model/providers.ts`)，依据环境变量和配置决定。

### 11.3 模型选择优先级

```
1. 会话内切换          (/model 命令)        ← 最高
2. 启动参数            (--model flag)
3. 环境变量            (ANTHROPIC_MODEL)
4. 用户设置            (settings.json)
5. 内置默认            (Opus 4.6)           ← 最低
```

**关键函数** (`src/utils/model/model.ts`):

| 函数 | 说明 |
|------|------|
| `getMainLoopModel()` | 获取当前会话模型 |
| `getDefaultOpusModel()` | 默认 Opus (4.6) |
| `getDefaultSonnetModel()` | 默认 Sonnet (4.6) |
| `getDefaultHaikuModel()` | 默认 Haiku (4.5) |
| `getSmallFastModel()` | 小快模型（工具用） |

### 11.4 错误处理与重试

**文件**: `src/services/api/withRetry.ts`

- 指数退避重试
- 可选 fallback 模型
- 错误分类（速率限制、认证失败、服务器错误）
- 提示缓存失效检测 (`promptCacheBreakDetection.ts`)

---

## 第12章 系统提示词与上下文构建

### 12.1 系统提示词组装

**文件**: `src/utils/systemPrompt.ts`

```typescript
function buildEffectiveSystemPrompt(): SystemPrompt {
  // 优先级从高到低:
  if (overrideSystemPrompt)    return override       // 完全替换
  if (coordinatorMode)         return coordinator     // 协调器模式
  if (agentDefinition)         return agent           // Agent 自定义
  if (customSystemPrompt)      return custom          // --system-prompt
  return defaultSystemPrompt + appendSystemPrompt     // 默认 + 追加
}
```

### 12.2 上下文注入

**文件**: `src/context.ts`

两类上下文在每次 API 调用时注入：

**系统上下文** (`getSystemContext()`):
- Git 状态（分支、最近提交、文件变更）
- 缓存打断器（仅内部使用）

**用户上下文** (`getUserContext()`):
- CLAUDE.md 文件内容（多层级发现）
- 当前日期
- Memory 文件内容

### 12.3 CLAUDE.md 发现机制

**文件**: `src/utils/claudemd.ts`

CLAUDE.md 是 Claude Code 的"项目级指令"——类似 `.editorconfig` 但面向 AI：

```
发现路径 (从上到下合并):
  ~/.claude/CLAUDE.md                    # 全局用户级
  {项目根}/CLAUDE.md                     # 项目级
  {项目根}/.claude/CLAUDE.md             # 项目级 (隐藏目录)
  {当前目录}/CLAUDE.md                   # 目录级
  {当前目录}/.claude/CLAUDE.md           # 目录级 (隐藏目录)
```

所有发现的 CLAUDE.md 内容会合并后作为 system context 的一部分注入到 API 调用中。

---

# 第三部分：工具生态

## 第13章 工具系统架构

### 13.1 Tool 接口

**文件**: `src/Tool.ts` (792 行)

每个工具都实现统一的 `Tool` 接口：

```typescript
type Tool<Input, Output, P extends ToolProgressData> = {
  // 基本属性
  name: string
  aliases?: string[]
  description(input, options): Promise<string>
  inputSchema: Input                    // Zod schema
  
  // 执行
  call(args, context, canUseTool, parentMessage, onProgress?): Promise<ToolResult<Output>>
  
  // 权限与安全
  checkPermissions(input, context): Promise<PermissionResult>
  isReadOnly(input): boolean
  isConcurrencySafe(input): boolean
  isDestructive?(input): boolean
  
  // 行为控制
  interruptBehavior?(): 'cancel' | 'block'
  maxResultSizeChars: number
  strict?: boolean
  
  // MCP 相关
  isMcp?: boolean
  mcpInfo?: { serverName: string; toolName: string }
  
  // 延迟加载
  shouldDefer?: boolean                  // ToolSearch 延迟加载
  alwaysLoad?: boolean
}
```

### 13.2 工具执行上下文

**`ToolUseContext`** 是工具调用的"运行环境"，包含了工具执行所需的一切：

```typescript
type ToolUseContext = {
  // 核心
  options: {
    commands: Command[]              // 可用命令列表
    tools: Tool[]                    // 可用工具列表
    mainLoopModel: string            // 当前模型
    mcpClients: MCPServerConnection[]// MCP 连接
    mcpResources: ServerResource[]   // MCP 资源
    agentDefinitions: AgentDefinition[]
    maxBudgetUsd?: number            // 预算限制
  }
  
  // 状态
  abortController: AbortController
  readFileState: FileStateCache      // 文件 LRU 缓存
  messages: Message[]                // 当前对话
  
  // 状态管理
  getAppState(): AppState
  setAppState(fn): void
  
  // Agent 相关
  agentId?: AgentId
  agentType?: string
  
  // 回调
  handleElicitation?(serverName, params, signal): Promise<ElicitResult>
  setToolJSX?(args): void            // 自定义 UI 渲染
  addNotification?(notif): void
  sendOSNotification?(opts): void
}
```

### 13.3 工具注册表

**文件**: `src/tools.ts`

工具注册分为三层：

```
必加载工具 (alwaysLoad):
  Bash, FileRead, FileWrite, FileEdit, Glob, Grep,
  WebFetch, WebSearch, NotebookEdit, Agent, Skill,
  TaskCreate, TaskUpdate, TaskGet, TaskList,
  EnterPlanMode, ExitPlanMode, EnterWorktree, ExitWorktree,
  SendMessage, TeamCreate, TeamDelete, AskUserQuestion,
  ToolSearch

条件加载工具 (feature-gated):
  SleepTool       → feature('PROACTIVE') || feature('KAIROS')
  MonitorTool     → feature('MONITOR_TOOL')
  CronCreate/Delete/List → feature('AGENT_TRIGGERS')
  RemoteTriggerTool → feature('AGENT_TRIGGERS_REMOTE')
  REPLTool        → process.env.USER_TYPE === 'ant'

MCP 工具 (运行时加载):
  从连接的 MCP 服务器动态获取
```

---

## 第14章 核心工具详解

### 14.1 完整工具清单

| 工具名 | 类别 | 只读 | 并发安全 | 说明 |
|--------|------|------|----------|------|
| **BashTool** | 命令执行 | 否 | 否 | Shell 命令执行，支持沙箱 |
| **PowerShellTool** | 命令执行 | 否 | 否 | Windows PowerShell |
| **FileReadTool** | 文件操作 | 是 | 是 | 读取文件（支持图片/PDF） |
| **FileWriteTool** | 文件操作 | 否 | 否 | 写入/创建文件 |
| **FileEditTool** | 文件操作 | 否 | 否 | 精确字符串替换编辑 |
| **GlobTool** | 搜索 | 是 | 是 | 文件名模式匹配 |
| **GrepTool** | 搜索 | 是 | 是 | 文件内容正则搜索 (ripgrep) |
| **WebFetchTool** | 网络 | 是 | 是 | 获取并解析网页内容 |
| **WebSearchTool** | 网络 | 是 | 是 | 网络搜索 |
| **WebBrowserTool** | 网络 | 是 | 否 | 浏览器交互 |
| **NotebookEditTool** | 编辑 | 否 | 否 | Jupyter notebook 编辑 |
| **AgentTool** | Agent | - | 否 | 启动子代理 |
| **SendMessageTool** | Agent | - | 否 | 向运行中的 Agent 发送消息 |
| **SkillTool** | Skill | - | - | 执行 skill/斜杠命令 |
| **ToolSearchTool** | 元工具 | 是 | 是 | 搜索延迟加载的工具 |
| **TaskCreateTool** | 任务 | 否 | 否 | 创建任务 |
| **TaskUpdateTool** | 任务 | 否 | 否 | 更新任务状态 |
| **TaskGetTool** | 任务 | 是 | 是 | 获取任务详情 |
| **TaskListTool** | 任务 | 是 | 是 | 列出所有任务 |
| **TaskStopTool** | 任务 | 否 | 否 | 停止任务 |
| **TaskOutputTool** | 任务 | 是 | 是 | 获取任务输出 |
| **EnterPlanModeTool** | 模式 | - | 否 | 进入规划模式 |
| **ExitPlanModeTool** | 模式 | - | 否 | 退出规划模式 |
| **EnterWorktreeTool** | 隔离 | 否 | 否 | 创建 git worktree |
| **ExitWorktreeTool** | 隔离 | 否 | 否 | 退出/删除 worktree |
| **TeamCreateTool** | 协作 | 否 | 否 | 创建团队 |
| **TeamDeleteTool** | 协作 | 否 | 否 | 删除团队 |
| **AskUserQuestionTool** | 交互 | 是 | 否 | 向用户提问 |
| **ReviewArtifactTool** | 审查 | 是 | 是 | 审查代码产物 |
| **TodoWriteTool** | 待办 | 否 | 否 | 写入待办事项 |
| **ListMcpResourcesTool** | MCP | 是 | 是 | 列出 MCP 资源 |
| **ReadMcpResourceTool** | MCP | 是 | 是 | 读取 MCP 资源 |
| **MCPTool** | MCP | - | - | 调用 MCP 工具 |
| **McpAuthTool** | MCP | 否 | 否 | MCP 认证 |
| **SleepTool** | 控制 | 是 | 是 | 等待（proactive 模式） |
| **MonitorTool** | 监控 | 是 | 是 | 监控工具 |
| **ScheduleCronTool** | 调度 | 否 | 否 | 创建定时任务 |
| **RemoteTriggerTool** | 远程 | 否 | 否 | 远程触发器 |
| **SnipTool** | 压缩 | - | - | 内容片段压缩 |
| **BriefTool** | 模式 | - | - | 简要模式 |
| **ConfigTool** | 配置 | 否 | 否 | 配置管理 |

### 14.2 BashTool 深入

BashTool 是最复杂的工具之一，因为它涉及安全执行外部命令：

**沙箱机制**: 可选的沙箱限制命令执行范围
**超时控制**: 默认 120 秒，最大 600 秒
**后台执行**: `run_in_background` 参数支持异步命令
**权限检查**: 每个命令都经过权限系统审核

### 14.3 FileEditTool 精确编辑

FileEditTool 实现**精确字符串替换**而非全文重写：

- 要求 `old_string` 在文件中唯一
- `replace_all` 模式替换所有匹配
- 编辑前必须先 Read 文件（安全检查）
- 保留原始缩进和格式

---

## 第15章 Agent 系统

Agent 系统是 Claude Code 实现复杂任务分解的核心机制。

### 15.1 架构概览

```
┌──────────────────────────────────────────┐
│            主会话 (Main Session)           │
│                                           │
│  用户: "搜索所有 API 端点并重构"            │
│                                           │
│  Claude: 我需要启动多个 Agent...           │
│                                           │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  │
│  │ Explore  │  │  Plan   │  │ General  │  │
│  │ Agent    │  │ Agent   │  │ Purpose  │  │
│  │ (搜索)   │  │ (规划)   │  │ (执行)   │  │
│  └────┬─────┘  └────┬────┘  └────┬─────┘  │
│       │             │            │         │
│       ↓             ↓            ↓         │
│   返回搜索结果   返回实施计划   返回执行结果   │
└──────────────────────────────────────────┘
```

### 15.2 三种 Agent 类型

**文件**: `src/tools/AgentTool/loadAgentsDir.ts`

```typescript
// 1. 内置 Agent — 动态系统提示词
type BuiltInAgentDefinition = {
  source: 'built-in'
  getSystemPrompt(): string     // 动态生成
  tools: ['*']                  // 所有工具
  useExactTools: true           // 缓存一致
}

// 2. 自定义 Agent — 用户/项目定义
type CustomAgentDefinition = {
  source: 'custom'
  systemPrompt: string          // 固定提示词
  tools?: string[]              // 可选工具限制
}

// 3. 插件 Agent — 来自插件
type PluginAgentDefinition = {
  source: 'plugin'
  // ...类似 Custom
}
```

**内置 Agent 类型**:

| Agent | 类型 | 说明 |
|-------|------|------|
| Explore | One-shot | 快速代码探索，只读工具 |
| Plan | One-shot | 架构设计，返回实施方案 |
| General-purpose | 长期运行 | 完整工具集，复杂任务 |

### 15.3 SubagentContext

**文件**: `src/utils/agentContext.ts`

每个 Agent 运行在独立的上下文中：

```typescript
type SubagentContext = {
  agentId: string                // UUID
  parentSessionId?: string       // 父会话 ID
  agentType: 'subagent'
  subagentName?: string          // "Explore", "Plan"
  isBuiltIn?: boolean
  invokingRequestId?: string     // 来自父级的请求 ID
  invocationKind?: 'spawn' | 'resume'
}
```

使用 `AsyncLocalStorage` 防止并发 Agent 上下文污染。

### 15.4 Worktree 隔离

**文件**: `src/utils/worktree.ts`

Agent 可以在独立的 git worktree 中工作，避免影响主工作区：

```
主工作区: /project/
  ↓ EnterWorktree
Agent 工作区: /tmp/worktree-abc123/
  ├─ 完整文件副本
  ├─ 独立 git 分支
  ├─ node_modules → symlink (节省磁盘)
  └─ sparse-checkout (可选，减少文件)
  ↓ ExitWorktree (keep/remove)
合并回主工作区 或 丢弃
```

```typescript
type WorktreeSession = {
  originalCwd: string
  worktreePath: string
  worktreeName: string
  worktreeBranch?: string
  sessionId: string
  creationDurationMs?: number
}
```

### 15.5 Fork Subagent — Prompt Cache 共享

**文件**: `src/tools/AgentTool/forkSubagent.ts`

这是一个精巧的优化：Fork subagent 继承父级的完整对话上下文，使得 Anthropic API 的 **prompt caching** 可以跨父子会话复用。

```
父会话: [sys_prompt + messages + tools]  → cached prefix
                                            ↓ (共享)
Fork 子代理: [同样的 prefix + 新任务]       → 只需发送增量
```

**关键约束**:
- 所有 fork 子代理使用 `tools: ['*']` + `useExactTools: true`
- 保证工具列表的 byte-identical 序列化，最大化缓存命中
- 权限模式设为 `'bubble'`（权限请求冒泡到父级）
- 递归 fork 保护：`isInForkChild()` 防止无限递归

### 15.6 Agent 通信

**One-shot Agent** (Explore, Plan):
- 执行一次，返回结果
- 跳过 agentId/SendMessage trailer（节省 token）

**长期运行 Agent**:
- 通过 `SendMessageTool` 接收后续消息
- `invokingRequestId` 追踪消息归属
- 支持 `run_in_background` 后台执行

---

## 第16章 Skills 系统

Skills 是 Claude Code 的"提示词扩展"机制——允许用户和系统定义可复用的提示词模板。

### 16.1 Skills 来源

```
┌─────────────────────────────────────┐
│           Skills 加载管线           │
│                                     │
│  1. Bundled Skills                  │
│     └─ 编译到二进制中               │
│                                     │
│  2. Disk Skills                     │
│     ├─ ~/.claude/skills/*.md        │
│     └─ .claude/skills/*.md          │
│                                     │
│  3. Plugin Skills                   │
│     └─ 已安装插件提供               │
│                                     │
│  4. Built-in Plugin Skills          │
│     └─ 核心插件提供                  │
│                                     │
│  5. MCP Skills                      │
│     └─ MCP 服务器提供的 prompts     │
└─────────────────────────────────────┘
```

### 16.2 Skill 定义规范

**文件**: `src/types/command.ts`

每个 Skill 是一个 `PromptCommand`：

```typescript
type PromptCommand = {
  type: 'prompt'
  name: string                    // 如 "commit", "review-pr"
  description: string
  progressMessage: string
  source: 'builtin' | 'bundled' | 'plugin' | 'mcp' | SettingSource
  
  // 执行配置
  context?: 'inline' | 'fork'    // 内联 vs 子代理
  agent?: string                  // fork 时的 agent 类型
  model?: string                  // 指定模型
  allowedTools?: string[]         // 允许的工具
  
  // 触发条件
  whenToUse?: string              // 何时使用（给模型的描述）
  paths?: string[]                // 文件 glob 匹配
  
  // 执行
  getPromptForCommand(args, context): Promise<ContentBlockParam[]>
}
```

### 16.3 Disk-based Skill Frontmatter

用户在 `.claude/skills/` 下创建 `.md` 文件，使用 YAML frontmatter：

```markdown
---
displayName: 代码审查
description: 对指定文件进行代码审查
allowedTools: ["FileRead", "Grep", "Glob"]
whenToUse: 当用户要求审查代码时
model: sonnet
context: inline
paths: ["src/**/*.ts"]
hooks:
  PostToolUse:
    - type: command
      command: echo "审查完成"
---

请审查以下代码文件，关注安全性和性能问题...
$ARGUMENTS
```

### 16.4 执行模式

**Inline 模式** (默认):
- Skill 内容直接展开到当前对话
- 共享父级的工具和权限

**Fork 模式**:
- 作为子代理在独立上下文中执行
- 有独立的 token 预算
- 通过 `runAgent()` 启动

---

## 第17章 Task 系统

Task 系统用于分解和追踪复杂任务，特别是在多 Agent 协作场景中。

### 17.1 数据模型

**文件**: `src/utils/tasks.ts`

```typescript
type Task = {
  id: string                      // 顺序生成
  subject: string                 // 简短标题
  description: string             // 详细描述
  activeForm?: string             // 进行时描述 ("Running tests")
  status: 'pending' | 'in_progress' | 'completed'
  owner?: string                  // Agent ID
  blocks: string[]                // 阻塞的任务 ID
  blockedBy: string[]             // 被阻塞的任务 ID
  metadata?: Record<string, unknown>
}
```

### 17.2 存储与并发

```
~/.claude/tasks/
  └─ {taskListId}/
       ├─ .highwatermark          # ID 高水位标记（防止重用）
       ├─ 1.json                  # 任务文件
       ├─ 2.json
       └─ ...
```

**并发控制**: 使用 lockfile 序列化，支持 ~10+ 并发 swarm agent 同时操作。

**Task List ID 解析优先级**:
1. `CLAUDE_CODE_TASK_LIST_ID` 环境变量
2. 进程内 teammate 的 leader team name
3. `CLAUDE_CODE_TEAM_NAME` 环境变量
4. Leader team name
5. Session ID (fallback)

### 17.3 Task 工具

| 工具 | 说明 |
|------|------|
| `TaskCreate` | 创建新任务，触发 taskCreated hooks |
| `TaskUpdate` | 更新状态/描述/owner，触发 taskCompleted hooks |
| `TaskGet` | 获取单个任务详情 |
| `TaskList` | 列出所有任务 |
| `TaskStop` | 停止运行中的任务 |
| `TaskOutput` | 获取任务输出 |

---

## 第18章 Plan Mode

Plan Mode 是一种**只读探索模式**，让 Claude 在修改代码前先制定计划。

### 18.1 工作流程

```
用户请求 → Claude 进入 Plan Mode
                ↓
┌───────────────────────────────────────┐
│           Plan Mode (只读)             │
│                                       │
│  可用: Read, Glob, Grep, WebFetch     │
│  禁用: Write, Edit, Bash (写操作)      │
│                                       │
│  1. 探索代码库                         │
│  2. 启动 Explore Agent 调研            │
│  3. 启动 Plan Agent 设计方案           │
│  4. 写入 plan 文件                     │
│  5. ExitPlanMode 提交审批              │
└───────────────────────────────────────┘
                ↓
用户审批 → 退出 Plan Mode → 开始执行
```

### 18.2 Plan 文件管理

**文件**: `src/utils/plans.ts`

```
存储路径: ~/.claude/plans/
文件名: {planSlug}.md              # 主会话
      : {planSlug}-agent-{id}.md   # 子代理

planSlug: 每会话唯一的 word slug
          如 "snoopy-tickling-dream"
```

**自定义路径**: 可通过 `settings.plansDirectory` 配置（相对于项目根目录）。

### 18.3 ExitPlanMode

**文件**: `src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`

退出时可附带**语义化权限请求**：

```typescript
type AllowedPrompt = {
  tool: 'Bash'            // 目前仅支持 Bash
  prompt: string          // 如 "run tests", "install dependencies"
}
```

这允许 plan 预先声明执行阶段需要的 Bash 命令类别。

---

# 第四部分：安全与权限

## 第19章 权限系统

权限系统是 Claude Code 的安全核心——每个工具调用都必须通过权限检查。

### 19.1 权限模式

**文件**: `src/utils/permissions/permissions.ts` (1487 行)

| 模式 | 说明 |
|------|------|
| `default` | 交互式逐个审批 |
| `auto` | AI 分类器自动决策 |
| `plan` | 只读模式（Plan Mode 激活） |
| `acceptEdits` | 自动允许工作目录内的文件编辑 |
| `bypassPermissions` | 企业级全自动（需权限） |
| `dontAsk` | 自动拒绝所有 ask |

### 19.2 决策流程

```
工具调用请求
    ↓
[1] 检查 deny 规则 ──── 命中 → 拒绝
    ↓ 未命中
[2] 检查 ask 规则 ───── 命中 → 进入审批 (除非沙箱内的 Bash)
    ↓ 未命中
[3] tool.checkPermissions() ── 工具自身的权限逻辑
    ↓
[4] requiresUserInteraction? ── 需要用户交互的工具强制 ask
    ↓
[5] 内容级 ask 规则检查 ── 特定参数触发 ask
    ↓
[6] safety check? ── 安全检查绕过 allow/deny 规则
    ↓
[7] dontAsk 模式? ── 转换 ask → deny
    ↓
[8] auto 模式:
    ├─ acceptEdits 快速通道
    ├─ 安全工具白名单（跳过分类器）
    └─ YOLO 分类器: classifyYoloAction()
        ├─ 通过 → 允许
        └─ 拒绝 → 交互式审批
    ↓
[9] 交互式审批 (UI 弹窗)
```

### 19.3 规则来源优先级

```typescript
type ToolPermissionContext = {
  mode: PermissionMode
  alwaysAllowRules: ToolPermissionRulesBySource   // 各来源的 allow 规则
  alwaysDenyRules: ToolPermissionRulesBySource     // 各来源的 deny 规则
  alwaysAskRules: ToolPermissionRulesBySource      // 各来源的 ask 规则
}
```

规则来源（优先级从高到低）:
1. `localSettings` — .claude/settings.local.json
2. `userSettings` — ~/.claude/settings.json
3. `projectSettings` — .claude/settings.json
4. `cliArg` — 命令行参数
5. `command` — 命令内置规则
6. `session` — 会话内动态规则

### 19.4 Auto 模式的 AI 分类器

Auto 模式使用 `classifyYoloAction()` 函数，通过一个小模型快速判断工具调用是否安全：

**Circuit Breaker**: 连续 3 次 auto-compact 失败后降级为交互式模式。

**拒绝追踪**: 记录连续拒绝次数，超限后降级。

---

## 第20章 Hooks 系统

Hooks 是用户可配置的**生命周期回调**——在特定事件发生时自动执行。

### 20.1 支持的事件

| 事件 | 触发时机 |
|------|---------|
| `PreToolUse` | 工具执行前 |
| `PostToolUse` | 工具执行后 |
| `UserPromptSubmit` | 用户提交输入后 |
| `SessionStart` | 会话开始 |
| `SessionEnd` | 会话结束 |
| `Stop` | 停止信号 |
| `SubagentStop` | 子代理停止 |
| `PreCompact` | 消息压缩前 |
| `PostCompact` | 消息压缩后 |
| `TeammateIdle` | 队友空闲 |
| `TaskCreated` | 任务创建后 |
| `TaskCompleted` | 任务完成后 |

### 20.2 Hook 类型

**文件**: `src/schemas/hooks.ts`

```yaml
# settings.json 中的 hooks 配置示例
hooks:
  PreToolUse:
    - type: command                    # Bash 命令
      command: "echo pre-tool"
      if: "Bash(git *)"               # 条件: 仅 git 命令
      timeout: 5000
      
    - type: prompt                     # LLM 评估
      prompt: "检查这个操作是否安全: $ARGUMENTS"
      model: haiku
      
    - type: agent                      # Agent 验证器
      prompt: "验证此操作的安全性"
      model: sonnet
      
    - type: http                       # HTTP POST
      url: "https://hooks.example.com/notify"
      allowedEnvVars: ["API_KEY"]
```

**5 种 Hook 类型**:

| 类型 | 说明 |
|------|------|
| `command` | 执行 shell 命令 |
| `prompt` | LLM 评估提示词 |
| `agent` | Agent 验证（更强大的 LLM 验证） |
| `http` | HTTP POST 请求 |
| `function` | 内部函数调用 |

### 20.3 条件执行

Hook 的 `if` 字段使用**权限规则语法**：

```
"Bash"                    → 匹配所有 Bash 调用
"Bash(npm publish:*)"     → 匹配 npm publish 开头的命令
"FileWrite"               → 匹配所有文件写入
"mcp__server__tool"       → 匹配特定 MCP 工具
```

### 20.4 异步 Hooks

**AsyncHookRegistry** (`src/utils/hooks/AsyncHookRegistry.ts`):
- `asyncRewake` 标志允许 hook 在后台运行，完成后唤醒主线程
- `registerPendingAsyncHook()` 注册待完成的异步 hook
- 支持 hook 完成回调

### 20.5 Hook 返回值

```typescript
type HookResult = {
  message?: string              // 反馈消息
  blockingError?: string        // 阻塞错误（阻止操作继续）
  outcome?: string              // 结果描述
  permissionBehavior?: PermissionBehavior  // 权限行为覆盖
}
```

---

# 第五部分：记忆与持久化

## 第21章 Memory 系统

Memory 系统让 Claude Code 在不同会话间保持"记忆"。

### 21.1 架构

```
~/.claude/projects/{project-hash}/memory/
  ├─ MEMORY.md                    # 索引文件 (指针列表)
  ├─ user_role.md                 # 用户信息
  ├─ feedback_testing.md          # 反馈记忆
  ├─ project_deadline.md          # 项目信息
  └─ reference_linear.md          # 外部引用
```

### 21.2 记忆类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `user` | 用户角色、偏好、知识水平 | "用户是资深 Go 工程师" |
| `feedback` | 用户对工作方式的反馈 | "不要在测试中 mock 数据库" |
| `project` | 项目相关信息 | "3月5日后合并冻结" |
| `reference` | 外部资源指针 | "bug 追踪在 Linear INGEST 项目" |

### 21.3 记忆文件格式

```markdown
---
name: 用户角色
description: 用户是数据科学家，关注日志/可观测性
type: user
---

用户是数据科学家，目前专注于可观测性/日志方面的工作。
```

### 21.4 扫描与加载

**文件**: `src/memdir/memoryScan.ts`

- `scanMemoryFiles()`: 扫描目录下的 .md 文件
- 最大 200 个文件
- 按 mtime 排序（最新优先）
- 读取前 30 行提取 frontmatter
- 输出 `MemoryHeader[]`：filename, filePath, description, type

### 21.5 与系统提示词集成

Memory 内容通过 `getUserContext()` → `getMemoryFiles()` 注入到系统上下文中，
MEMORY.md 索引始终加载到对话上下文，200 行后截断。

---

## 第22章 消息压缩

当对话过长时，auto-compact 自动压缩历史消息以维持上下文窗口。

### 22.1 触发机制

**文件**: `src/services/compact/autoCompact.ts`

```typescript
// 阈值计算
AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000

effectiveContext = contextWindow - reservedSummaryTokens (max 20k)
threshold = effectiveContext - AUTOCOMPACT_BUFFER_TOKENS

// 可通过环境变量覆盖
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = 0-100  // 百分比
```

### 22.2 压缩过程

```
Token 数超过阈值
    ↓
触发 auto-compact
    ↓
Fork agent 生成摘要
    ↓
创建 SystemCompactBoundaryMessage
    ↓
替换历史消息为摘要
    ↓
后置清理:
  ├─ 文件缓存更新
  ├─ ToolSearch 重置
  └─ 会话记忆更新
```

### 22.3 Circuit Breaker

**最大连续失败**: 3 次
- 超过后停止自动压缩，避免无限循环
- 通过 `AutoCompactTrackingState.consecutiveFailures` 跟踪

---

## 第23章 会话管理与历史

### 23.1 对话历史

**文件**: `src/history.ts`

```
存储: ~/.claude/history.jsonl       # 全局共享
格式: JSONL (每行一条记录)
上限: 100 条 (MAX_HISTORY_ITEMS)
```

**粘贴内容处理**:
- 短内容 (<1024 字符): 直接内联
- 长内容: 外部哈希引用 `[Pasted text #N +N lines]`
- 通过 `expandPastedTextRefs()` 恢复

### 23.2 Session 状态

**文件**: `src/bootstrap/state.ts`

模块级单例维护会话全局状态：

| 函数 | 说明 |
|------|------|
| `getSessionId()` | 当前会话 ID |
| `getCwd()` / `setCwd()` | 工作目录 |
| `getProjectRoot()` | 项目根目录 |
| `getTotalInputTokens()` | 累计输入 token |
| `getTotalOutputTokens()` | 累计输出 token |
| `getTotalCacheReadInputTokens()` | 缓存命中 token |
| `switchSession()` | 切换活动会话 |

### 23.3 会话恢复

`ResumeConversation.tsx` 组件支持恢复中断的对话，通过 session ID 从持久化存储加载历史消息。

### 23.4 成本追踪

**文件**: `src/cost-tracker.ts`

- `getTotalCost()`: 累计 API 成本
- `saveCurrentSessionCosts()`: 持久化会话成本
- `/cost` 命令查看当前会话消耗

---

# 第六部分：UI 与交互层

## 第24章 Ink 终端 UI 框架

Claude Code 使用**自定义 Ink 框架**——一个基于 React reconciler 的终端 UI 系统。

### 24.1 架构

```
React 组件
    ↓ React Reconciler
Ink Virtual DOM
    ↓ renderNodeToOutput()
ANSI 转义序列
    ↓
终端输出
```

### 24.2 核心文件

**目录**: `src/ink/` (48 文件)

| 文件 | 说明 |
|------|------|
| `ink.tsx` (77 KB) | 主渲染器与 hooks |
| `reconciler.ts` | React Fiber reconciler |
| `screen.ts` | 终端屏幕状态 |
| `render-node-to-output.ts` | ANSI 渲染逻辑 |
| `parse-keypress.ts` | 键盘事件解析 |
| `styles.ts` | CSS-like 样式系统 |

### 24.3 自定义 Hooks

| Hook | 说明 |
|------|------|
| `useInput()` | 键盘输入监听 |
| `useTerminalSize()` | 终端尺寸变化 |
| `useSearchHighlight()` | 搜索结果高亮 |
| `useTabStatus()` | Tab 状态栏 |
| `useTerminalNotification()` | 终端通知 |
| `useTerminalFocus()` | 终端焦点状态 |
| `useTerminalTitle()` | 终端标题 |

### 24.4 React Compiler 兼容

组件经过 React Compiler 处理，代码中有大量 `_c()` 记忆化调用：

```typescript
const $ = _c(12);  // 分配 12 个 slot
if ($[0] !== deps) {
  $[0] = deps;
  $[1] = computedValue;  // 缓存计算结果
}
```

这是正常的编译器输出，不影响运行时。

---

## 第25章 REPL 交互界面

### 25.1 REPL.tsx

**文件**: `src/screens/REPL.tsx` (~5000 行)

这是 Claude Code 的"主屏幕"——整个交互体验都在这个组件中。

**主要职责**:
- 消息列表渲染 (`VirtualMessageList`)
- 用户输入处理 (`PromptInput`)
- 工具权限审批 (`PermissionRequest`)
- 键盘快捷键 (vim 模式支持)
- QueryEngine 集成
- 实时 token 统计

### 25.2 组件层级

```
<App>
  ├─ <AppStateProvider>
  ├─ <ThemeProvider>
  └─ <REPL>
       ├─ <VirtualMessageList>
       │   ├─ <MessageRow>
       │   │   ├─ <AssistantMessage>
       │   │   ├─ <UserMessage>
       │   │   └─ <ToolResultMessage>
       │   └─ ...
       │
       ├─ <PermissionRequest>
       │   └─ 工具权限审批 UI
       │
       ├─ <PromptInput>
       │   ├─ 输入框
       │   ├─ 自动补全
       │   └─ 输入模式 (normal/vim/command)
       │
       └─ <StatusBar>
            ├─ Token 统计
            ├─ 模型名称
            └─ 成本信息
```

### 25.3 键盘快捷键

Claude Code 支持丰富的键盘快捷键，包括 vim 模式。快捷键通过 `~/.claude/keybindings.json` 可自定义。

---

## 第26章 Commands 系统

### 26.1 命令类型

**文件**: `src/types/command.ts`

```typescript
type Command = CommandBase & (PromptCommand | LocalCommand | LocalJSXCommand)
```

| 类型 | 说明 | 示例 |
|------|------|------|
| `PromptCommand` | 模型可调用的 Skill | `/commit`, `/review` |
| `LocalCommand` | 本地 CLI 命令 | `/clear`, `/cost`, `/exit` |
| `LocalJSXCommand` | React UI 命令 | `/config`, `/keybindings` |

### 26.2 命令注册

**文件**: `src/commands.ts`

```typescript
const COMMANDS = memoize(() => [
  // 静态内置命令 (~100+)
  ...staticCommands,
  
  // Feature-gated 命令
  ...(feature('KAIROS') ? kairosCommands : []),
  ...(feature('VOICE_MODE') ? voiceCommands : []),
  
  // 动态加载
  ...skillCommands,     // Disk/bundled/plugin skills
  ...mcpPrompts,        // MCP 提供的 prompts
  ...workflowCommands,  // Workflow 脚本
])
```

### 26.3 可用性过滤

命令可以限制在特定认证环境下可用：

```typescript
type CommandBase = {
  availability?: ['claude-ai' | 'console']
  // claude-ai: OAuth 用户 (Pro/Max/Team/Enterprise)
  // console:   API key 用户
}
```

### 26.4 完整命令清单

以下是 90+ 个命令目录：

| 命令 | 类别 | 说明 |
|------|------|------|
| `/add-dir` | 目录 | 添加工作目录 |
| `/agents` | Agent | Agent 管理 |
| `/branch` | Git | 分支管理 |
| `/clear` | 会话 | 清除对话 |
| `/compact` | 会话 | 手动压缩对话 |
| `/config` | 配置 | 设置管理 UI |
| `/copy` | 工具 | 复制到剪贴板 |
| `/cost` | 统计 | 查看 API 成本 |
| `/diff` | Git | 查看差异 |
| `/doctor` | 诊断 | 系统诊断 |
| `/effort` | 模型 | 调整推理力度 |
| `/exit` | 会话 | 退出 |
| `/export` | 会话 | 导出对话 |
| `/fast` | 模型 | 切换快速模式 |
| `/feedback` | 反馈 | 发送反馈 |
| `/files` | 文件 | 文件管理 |
| `/fork` | 会话 | 分叉会话 |
| `/help` | 帮助 | 帮助信息 |
| `/hooks` | 配置 | Hook 管理 |
| `/keybindings` | 配置 | 快捷键配置 |
| `/login` | 认证 | 登录 |
| `/logout` | 认证 | 登出 |
| `/mcp` | MCP | MCP 服务器管理 |
| `/memory` | 记忆 | 记忆管理 |
| `/model` | 模型 | 切换模型 |
| `/permissions` | 权限 | 权限设置 |
| `/plan` | 规划 | 进入规划模式 |
| `/resume` | 会话 | 恢复会话 |
| `/review` | 代码 | 代码审查 |
| `/session` | 会话 | 会话管理 |
| `/share` | 分享 | 分享对话 |
| `/skills` | Skill | Skill 管理 |
| `/status` | 状态 | 系统状态 |
| `/summary` | 会话 | 对话摘要 |
| `/tasks` | 任务 | 任务管理 |
| `/theme` | UI | 主题切换 |
| `/vim` | 编辑 | Vim 模式切换 |
| `/voice` | 语音 | 语音模式 |
| `/workflows` | 工作流 | 工作流管理 |
| `/upgrade` | 系统 | 检查更新 |

---

# 第七部分：外部集成

## 第27章 MCP 集成

MCP (Model Context Protocol) 是 Claude Code 的外部工具扩展协议。

### 27.1 传输类型

**文件**: `src/services/mcp/types.ts`

| 传输方式 | 说明 |
|----------|------|
| `stdio` | 子进程（最常用） |
| `sse` | Server-Sent Events |
| `sse-ide` | IDE 扩展 SSE |
| `http` | HTTP 轮询 |
| `ws` | WebSocket |
| `ws-ide` | IDE WebSocket |
| `sdk` | SDK 直连 |
| `claudeai-proxy` | Claude.ai 代理 |

### 27.2 连接状态机

```
                 初始化
                   ↓
            ┌──→ pending ──┐
            │      ↓       │ 失败
            │  connected   ↓
            │      ↓    failed
            │  needs-auth
            │      ↓
            └── disabled
```

```typescript
type MCPServerConnection =
  | ConnectedMCPServer      // client, capabilities, config
  | FailedMCPServer         // error info
  | NeedsAuthMCPServer      // 需要认证
  | PendingMCPServer        // 重连中
  | DisabledMCPServer       // 已禁用
```

### 27.3 MCP 资源

连接的 MCP 服务器可以提供：

| 资源类型 | 说明 |
|----------|------|
| Tools | 工具（注入到工具注册表） |
| Resources | 数据资源（通过 ListMcpResource / ReadMcpResource 访问） |
| Prompts | 提示词模板（注入到 Skills 系统） |

### 27.4 配置

在 `settings.json` 中配置 MCP 服务器：

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["server.js"],
      "env": { "API_KEY": "..." }
    }
  }
}
```

---

## 第28章 设置与配置系统

### 28.1 六级配置优先级

**文件**: `src/utils/settings/settings.ts` (1016 行)

```
1. flagSettings          ← CLI 标志、SDK 内联 (最高优先)
2. localSettings         ← .claude/settings.local.json (git-ignored)
3. projectSettings       ← .claude/settings.json (项目共享)
4. policySettings        ← 管理员策略 (MDM/远程)
5. userSettings          ← ~/.claude/settings.json (用户全局)
6. pluginSettings        ← 插件提供 (最低优先)
```

### 28.2 Policy 设置层级

Policy settings 自身有多层优先级：

```
1. Remote Managed Settings    ← 远程管理（最高）
2. MDM (HKLM on Win / plist on Mac)
3. managed-settings.json + managed-settings.d/*.json
4. HKCU (Windows 用户注册表)  ← 最低
```

### 28.3 核心配置项

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `permissions` | Object | 权限规则 (allow/deny/ask) |
| `hooks` | Object | 生命周期 hooks |
| `mcpServers` | Object | MCP 服务器配置 |
| `environmentVariables` | Object | 环境变量注入 |
| `defaultMode` | String | 默认权限模式 |
| `plansDirectory` | String | Plan 文件存储路径 |
| `worktree.sparsePaths` | String[] | Worktree 稀疏路径 |
| `model` | String | 默认模型 |

### 28.4 缓存与验证

- **Per-session 缓存**: 避免重复读取磁盘
- **Zod Schema 验证**: 所有配置项通过 Zod schema 验证
- **缓存失效**: 文件变更时自动重置缓存

---

# 第八部分：进阶架构

## 第29章 状态管理

### 29.1 AppState

**文件**: `src/state/AppState.tsx`

中央状态类型，包含整个应用的运行时状态：

```typescript
type AppState = {
  messages: Message[]                    // 对话消息
  tools: Tool[]                         // 可用工具
  toolPermissionContext: ToolPermissionContext  // 权限上下文
  mcpConnections: MCPServerConnection[] // MCP 连接
  settings: ReadonlySettings            // 当前设置
  // ...
}
```

通过 React Context API 提供给组件树。

### 29.2 Store 模式

**文件**: `src/state/store.ts`

Zustand 风格的状态管理：

```typescript
type AppStateStore = {
  getState(): AppState
  setState(updater: (prev: AppState) => Partial<AppState>): void
}
```

`useAppState<R>(selector)` hook 支持选择性订阅，避免不必要的重渲染。

---

## 第30章 Daemon 与远程会话

### 30.1 Daemon 模式

**目录**: `src/daemon/`

```
daemon/
  ├─ main.ts              # 守护进程主入口
  └─ workerRegistry.ts    # Worker 注册表
```

Daemon 在后台持续运行，管理多个 worker 进程。通过 `--daemon-worker` 标志启动。

### 30.2 远程会话

**目录**: `src/bridge/`

支持远程桥接模式——Claude Code 可以作为远程服务运行，通过 WebSocket 接收指令：

```
SessionsWebSocket.ts        # WebSocket 会话管理
remotePermissionBridge.ts   # 远程权限桥接
peerSessions.ts             # 对等会话
```

### 30.3 SSH 支持

**目录**: `src/ssh/`

支持通过 SSH 连接远程运行 Claude Code。

---

## 第31章 Coordinator 模式

Coordinator 模式实现**多 Agent 协调执行**：

```
┌──────────────────┐
│   Coordinator    │
│   (协调器)       │
│                  │
│  分配任务给 →    │
│                  │
│ ┌──────┐ ┌────┐ │
│ │Worker│ │Worker│
│ │  1   │ │  2  │ │
│ └──────┘ └────┘ │
└──────────────────┘
```

- Coordinator 管理 worker agent 的创建和任务分配
- Worker 权限通过 `awaitAutomatedChecksBeforeDialog` 上浮到 coordinator
- Team 级别的共享任务列表

> 注: Coordinator 模式在当前反编译版本中通过 `feature('COORDINATOR_MODE')` 关闭。

---

# 第九部分：工程实践与版本对比

## 第32章 构建与打包

### 32.1 构建命令

```bash
bun build src/entrypoints/cli.tsx --outdir dist --target bun
```

**输出**: `dist/cli.js` (~25 MB 单文件)

### 32.2 Feature Flag 死代码消除

```typescript
// cli.tsx 中的 polyfill
const feature = (_name: string) => false;

// 使用处
if (feature('KAIROS')) {
  // 这段代码永远不会执行
  // Bun bundler 在构建时消除
}
```

已知的 feature flags（约 40+）:

| Flag | 说明 |
|------|------|
| `KAIROS` | Assistant 模式 |
| `COORDINATOR_MODE` | 多 Agent 协调 |
| `VOICE_MODE` | 语音交互 |
| `BRIDGE_MODE` | 远程桥接 |
| `DAEMON` | 守护进程 |
| `PROACTIVE` | 主动操作 |
| `FORK_SUBAGENT` | Fork 子代理 |
| `AGENT_TRIGGERS` | 定时触发 |
| `MONITOR_TOOL` | 监控工具 |
| `ULTRAPLAN` | 超级规划 |
| `BUDDY` | Buddy 模式 |
| `WORKFLOW_SCRIPTS` | 工作流脚本 |

### 32.3 MACRO 注入

```typescript
globalThis.MACRO = {
  VERSION: "2.1.87",
  BUILD_TIME: "...",
  // ... 构建时常量
}
```

---

## 第33章 类型系统

### 33.1 全局类型

**文件**: `src/types/global.d.ts`

声明构建时注入的全局变量：

```typescript
declare const MACRO: {
  VERSION: string
  BUILD_TIME: string
  // ...
}
declare const BUILD_TARGET: string
declare const BUILD_ENV: string
declare const INTERFACE_TYPE: string
```

### 33.2 消息类型层级

**文件**: `src/types/message.ts`

```
Message (联合类型)
  ├─ UserMessage
  ├─ AssistantMessage
  ├─ SystemMessage
  ├─ ToolUseSummaryMessage
  ├─ AttachmentMessage
  ├─ TombstoneMessage
  └─ SystemCompactBoundaryMessage
```

### 33.3 Zod Schema 贯穿

整个项目使用 Zod 4.x 进行运行时 schema 验证：

- 工具输入: `inputSchema` 使用 Zod
- 配置文件: Settings schema
- Hook 配置: `HooksSchema`
- MCP 配置: Transport schemas
- API 响应: 部分使用 Zod 验证

---

## 第34章 两版本源码对比

### 34.1 总体对比

| 指标 | cc_src.zip | claude-code/src |
|------|------------|-----------------|
| 文件数 | 1,902 | 2,797 |
| 两边都有 | 1,901 | 1,901 |
| 独有文件 | 1 (`color-diff/index.ts`) | 896 |
| 内容相同 | 1,201 | 1,201 |
| 内容不同 | 700 | 700 |

### 34.2 Repo 版本新增的功能区域

| 目录 | 文件数 | 说明 |
|------|--------|------|
| `daemon/` | 2 | 守护进程模式 |
| `environment-runner/` | 1 | 环境隔离执行 |
| `jobs/` | 1 | 作业分类器 |
| `proactive/` | 1 | 主动操作模式 |
| `self-hosted-runner/` | 1 | 自托管 Agent runner |
| `ssh/` | 1 | SSH 会话支持 |
| `assistant/` | 4+ | Assistant 管理 |

### 34.3 新增命令

Repo 版本新增了 6 个命令族：

| 命令 | 说明 |
|------|------|
| `agents-platform` | Agent 平台集成 |
| `assistant` | Assistant 管理 |
| `buddy` | Buddy 模式/协同工作 |
| `fork` | 会话分叉 |
| `peers` | 对等协作 |
| `workflows` | 工作流管理 |

### 34.4 变更密集区域

700 个有内容差异的共有文件主要集中在：

- **权限系统**: 增强的规则匹配和 AI 分类器
- **MCP 集成**: 新增 transport 类型、OAuth 支持
- **Settings**: 企业级 MCP 服务器允许列表
- **UI**: REPL 功能增强（voice, coordinator）
- **Session**: 增强的历史管理和恢复
- **Model**: 更多 provider 和模型支持

### 34.5 设计趋势

从两版本对比可以看出 Claude Code 的发展方向：

1. **多 Agent 协作**: Coordinator、Team、Buddy 模式
2. **远程化**: Daemon、Bridge、SSH、Self-hosted runner
3. **企业级**: Policy 设置、MDM、远程管理
4. **主动化**: Proactive 模式、后台任务、定时触发
5. **平台化**: Workflows、Agent 平台、Plugin marketplace

---

# 附录

## 附录 A：关键文件索引

### 入口与启动

| 文件 | 说明 |
|------|------|
| `src/entrypoints/cli.tsx` | 真实入口（polyfill 注入） |
| `src/entrypoints/init.ts` | 一次性初始化 |
| `src/main.tsx` | CLI 定义（Commander.js） |
| `src/bootstrap/state.ts` | 会话级全局状态 |

### 核心引擎

| 文件 | 说明 |
|------|------|
| `src/query.ts` | 查询引擎主循环 |
| `src/QueryEngine.ts` | 上层编排器 |
| `src/services/api/claude.ts` | API 客户端 |
| `src/services/api/withRetry.ts` | 重试逻辑 |

### 工具系统

| 文件 | 说明 |
|------|------|
| `src/Tool.ts` | Tool 接口定义 |
| `src/tools.ts` | 工具注册表 |
| `src/services/tools/toolOrchestration.ts` | 并发调度 |
| `src/services/tools/StreamingToolExecutor.ts` | 流式执行器 |

### Agent

| 文件 | 说明 |
|------|------|
| `src/tools/AgentTool/AgentTool.tsx` | Agent 工具入口 |
| `src/tools/AgentTool/runAgent.ts` | Agent 执行 |
| `src/tools/AgentTool/loadAgentsDir.ts` | Agent 加载 |
| `src/tools/AgentTool/forkSubagent.ts` | Fork 优化 |
| `src/utils/agentContext.ts` | Agent 上下文 |
| `src/utils/worktree.ts` | Worktree 隔离 |

### Skills

| 文件 | 说明 |
|------|------|
| `src/tools/SkillTool/SkillTool.ts` | Skill 工具 |
| `src/skills/loadSkillsDir.ts` | Disk 加载 |
| `src/skills/bundledSkills.ts` | Bundled 注册 |

### 权限

| 文件 | 说明 |
|------|------|
| `src/utils/permissions/permissions.ts` | 权限核心 (1487 行) |
| `src/utils/permissions/PermissionMode.ts` | 模式定义 |
| `src/hooks/useCanUseTool.tsx` | React hook |

### 记忆与上下文

| 文件 | 说明 |
|------|------|
| `src/memdir/memoryScan.ts` | Memory 扫描 |
| `src/context.ts` | 上下文构建 |
| `src/utils/systemPrompt.ts` | 系统提示词 |
| `src/utils/claudemd.ts` | CLAUDE.md 发现 |

### 设置与 Hooks

| 文件 | 说明 |
|------|------|
| `src/utils/settings/settings.ts` | 设置核心 (1016 行) |
| `src/utils/hooks.ts` | Hooks 执行 |
| `src/schemas/hooks.ts` | Hook schema |

### UI

| 文件 | 说明 |
|------|------|
| `src/screens/REPL.tsx` | 主交互屏幕 |
| `src/ink/ink.tsx` | Ink 渲染器 |
| `src/components/App.tsx` | 根组件 |
| `src/components/PromptInput/` | 输入组件 |

### MCP

| 文件 | 说明 |
|------|------|
| `src/services/mcp/types.ts` | MCP 类型 |
| `src/services/mcp/client.ts` | MCP 客户端 |
| `src/services/mcp/config.ts` | MCP 配置 |

### 命令与任务

| 文件 | 说明 |
|------|------|
| `src/commands.ts` | 命令注册表 |
| `src/types/command.ts` | 命令类型定义 |
| `src/utils/tasks.ts` | 任务系统 |
| `src/utils/plans.ts` | Plan 管理 |

---

## 附录 B：术语表

| 英文 | 中文 | 说明 |
|------|------|------|
| Agent | 代理 | 独立执行复杂任务的子系统 |
| Subagent | 子代理 | 主会话中启动的 Agent |
| Skill | 技能 | 可复用的提示词模板 |
| Hook | 钩子 | 生命周期回调 |
| Plan Mode | 规划模式 | 只读探索 + 计划制定 |
| Worktree | 工作树 | Git worktree 隔离环境 |
| Compact/Compaction | 压缩 | 对话历史压缩 |
| MCP | 模型上下文协议 | 外部工具扩展协议 |
| CLAUDE.md | 项目指令 | 项目级 AI 指导文件 |
| Memory | 记忆 | 跨会话持久化信息 |
| Tool | 工具 | Claude 可调用的能力单元 |
| Permission | 权限 | 工具调用的安全控制 |
| Coordinator | 协调器 | 多 Agent 调度中心 |
| Fork | 分叉 | 会话/Agent 上下文复制 |
| REPL | 交互循环 | Read-Eval-Print Loop |
| Prompt Cache | 提示词缓存 | API 请求前缀缓存优化 |
| Feature Flag | 功能标志 | 编译时条件分支控制 |
| Bundled | 内置/打包 | 编译到二进制中的资源 |
