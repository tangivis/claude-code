# Claude Code 源码架构深度分析

> 基于 `claude-code` (反编译版本) 与 `cc_src_unzipped` 源码目录的详细对比分析

---

## 目录

1. [项目概述](#1-项目概述)
2. [核心架构](#2-核心架构)
3. [Agent 编排系统](#3-agent-编排系统)
4. [Skills 系统](#4-skills-系统)
5. [Tools 系统](#5-tools-系统)
6. [Planning 机制](#6-planning-机制)
7. [上下文管理与 Compaction](#7-上下文管理与-compaction)
8. [状态管理](#8-状态管理)
9. [UI 层 (Ink)](#9-ui-层-ink)
10. [MCP 集成](#10-mcp-集成)
11. [版本差异分析](#11-版本差异分析)
12. [设计思想总结](#12-设计思想总结)

---

## 1. 项目概述

### 1.1 源码版本

| 目录 | 性质 | 说明 |
|------|------|------|
| `claude-code/` | 反编译版本 | Anthropic 官方 Claude Code CLI 的逆向工程版本，约 1341 个 tsc 错误（类型推断问题，不影响运行时） |
| `cc_src_unzipped/` | 早期版本 | 可能是较早期或较精简的源码版本，文件结构略有不同 |

### 1.2 技术栈

- **运行时**: Bun（不是 Node.js）
- **构建**: `bun build src/entrypoints/cli.tsx --outdir dist --target bun`（单文件 bundle，约 25MB）
- **模块系统**: ESM (`"type": "module"`)，TSX + React JSX transform
- **Monorepo**: Bun workspaces，内部包在 `packages/` 目录
- **UI 框架**: Ink（自定义 React reconciler，专为终端渲染）
- **类型系统**: TypeScript + Zod

### 1.3 入口与引导

```
src/entrypoints/cli.tsx          # 真正入口，注入运行时 polyfills
├── feature() → 始终返回 false（所有 feature flags 禁用）
├── globalThis.MACRO → 模拟构建时宏注入
└── BUILD_TARGET, BUILD_ENV, INTERFACE_TYPE globals

src/main.tsx                      # Commander.js CLI 定义
├── 解析命令行参数
├── 初始化服务（auth, analytics, policy）
└── 启动 REPL 或管道模式

src/entrypoints/init.ts           # 一次性初始化（telemetry, config, trust dialog）
```

---

## 2. 核心架构

### 2.1 核心循环 (Core Loop)

```
query.ts                          # 主 API 查询函数
├── 发送消息到 Claude API
├── 处理流式响应
├── 处理 tool calls
└── 管理对话轮次循环

QueryEngine.ts                    # 高级编排器（封装 query()）
├── 管理对话状态
├── 管理 compaction
├── 文件历史快照
├── 归因（attribution）
└── 轮次级 bookkeeping

screens/REPL.tsx                 # 交互式 REPL 屏幕（React/Ink）
├── 用户输入处理
├── 消息显示
├── 工具权限提示
└── 键盘快捷键
```

### 2.2 API 层

```
src/services/api/claude.ts        # 核心 API 客户端
├── 构建请求参数（system prompt, messages, tools, betas）
├── 调用 Anthropic SDK 流式端点
└── 处理 BetaRawMessageStreamEvent 事件

支持的 Provider:
├── Anthropic direct
├── AWS Bedrock
├── Google Vertex
└── Azure
```

### 2.3 特性开关系统

所有 `feature('FLAG_NAME')` 调用来自 `bun:bundle`（构建时 API）。

在反编译版本中，`cli.tsx` 将 `feature()` polyfill 为始终返回 `false`，意味着：
- 所有 Anthropic 内部特性（COORDINATOR_MODE, KAIROS, PROACTIVE 等）都被禁用
- Feature-flagged 代码路径是 dead code

```typescript
// 特性开关示例
if (feature('COORDINATOR_MODE')) {
  // 这个分支永远不会执行
}
```

---

## 3. Agent 编排系统

### 3.1 Coordinator Mode (协调者模式)

**文件**: `src/coordinator/coordinatorMode.ts`

Coordinator Mode 是 Claude Code 的**多智能体编排核心**。当启用时，Claude Code 本身成为协调者，将任务分派给多个 Worker Agent。

#### 核心职责

```
协调者 (Coordinator) 的职责:
├── 帮助用户实现目标
├── 指导 workers 进行研究、实现和验证代码变更
├── 综合 (Synthesize) 结果并与用户沟通
└── 直接回答问题（不需要工具的）

Workers 的职责:
├── 自主执行任务（研究、实现、验证）
└── 通过 task-notification 报告结果
```

#### 核心工具

| 工具 | 功能 |
|------|------|
| `AgentTool` | 启动新的 worker |
| `SendMessageTool` | 继续已有 worker（发送后续消息） |
| `TaskStopTool` | 停止运行中的 worker |

#### Worker 通信机制

Workers 通过 `<task-notification>` XML 格式报告结果：

```xml
<task-notification>
  <task-id>{agentId}</task-id>
  <status>completed|failed|killed</status>
  <summary>{human-readable status summary}</summary>
  <result>{agent's final text response}</result>
  <usage>
    <total_tokens>N</total_tokens>
    <tool_uses>N</tool_uses>
    <duration_ms>N</duration_ms>
  </usage>
</task-notification>
```

#### 工作流程 (Task Workflow)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Coordinator Mode                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Phase 1: Research (并行)                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │ Worker A │  │ Worker B │  │ Worker C │  ← 多个 workers     │
│  │ 调研文件  │  │ 调研测试  │  │ 调研依赖  │    同时工作       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                     │
│       │             │             │                            │
│       └─────────────┴─────────────┘                            │
│                      ↓                                          │
│  Phase 2: Synthesis (仅协调者)                                  │
│  ┌──────────────────────────────────────┐                       │
│  │  理解 findings                      │                       │
│  │  编写具体实现规格 (Implementation Spec) │                    │
│  │  选择 continue vs. spawn             │                       │
│  └──────────────────────────────────────┘                       │
│                      ↓                                          │
│  Phase 3: Implementation (并行)                                │
│  ┌──────────┐  ┌──────────┐                                    │
│  │ Worker A │  │ Worker B │  ← 针对规格执行                     │
│  │ 修复 bug │  │ 编写测试 │    (一次只改一组文件)              │
│  └────┬─────┘  └────┬─────┘                                    │
│       │             │                                           │
│       └─────────────┘                                           │
│                      ↓                                          │
│  Phase 4: Verification (可选并行)                               │
│  ┌──────────┐  ┌──────────┐                                    │
│  │Verifier A│  │Verifier B│  ← 独立验证，不依赖实现者            │
│  └──────────┘  └──────────┘                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Continue vs. Spawn 决策

| 情况 | 机制 | 原因 |
|------|------|------|
| 研究正好覆盖需要编辑的文件 | **Continue** (SendMessage) | Worker 已有上下文 + 清晰计划 |
| 研究广泛但实现狭窄 | **Spawn fresh** (AgentTool) | 避免探索噪声污染 |
| 纠正失败或扩展最近工作 | **Continue** | Worker 有错误上下文 |
| 验证其他 worker 刚写的代码 | **Spawn fresh** | 验证者应该独立，不带实现假设 |
| 第一次尝试方向完全错误 | **Spawn fresh** | 错误上下文会污染重试 |
| 完全无关的任务 | **Spawn fresh** | 没有可重用的上下文 |

### 3.2 内置 Agent

**文件**: `src/tools/AgentTool/built-in/`

#### Explore Agent

```typescript
{
  agentType: 'Explore',
  model: process.env.USER_TYPE === 'ant' ? 'inherit' : 'haiku',
  // 快速只读搜索 agent
  disallowedTools: [AgentTool, ExitPlanModeTool, FileEditTool, FileWriteTool, NotebookEditTool],
  omitClaudeMd: true,  // 不需要 CLAUDE.md 规则
}
```

**特点**:
- 只读模式，禁止任何文件修改
- 擅长 Glob/Grep 模式搜索
- 并行化工具调用以提高速度
- 用于快速定位文件和理解代码结构

#### Plan Agent

```typescript
{
  agentType: 'Plan',
  model: 'inherit',
  // 软件架构和规划专家
  disallowedTools: [AgentKit, ExitPlanModeTool, FileEditTool, FileWriteTool, NotebookEditTool],
  tools: EXPLORE_AGENT.tools,  // 与 Explore 相同的工具集
  omitClaudeMd: true,
}
```

**特点**:
- 只读规划任务
- 可以访问 CLAUDE.md（如果需要约定）
- 输出包含"关键实现文件"列表

#### General Purpose Agent

完整能力的 Agent，可以执行任意任务。

### 3.3 Agent 生命周期管理

**文件**: `src/tools/AgentTool/runAgent.ts`

```typescript
runAgent({
  agentDefinition,    // Agent 定义（来自 markdown 或内置）
  promptMessages,     // 初始提示消息
  toolUseContext,    // 工具执行上下文
  canUseTool,        // 权限检查函数
  isAsync,           // 是否异步（后台运行）
  querySource,       // 查询来源标识
  maxTurns,          // 最大轮次限制
  // ...
})
```

**关键机制**:

1. **MCP Server 初始化**: Agent 可以定义自己的 MCP servers（在 frontmatter 中）
2. **权限模式覆盖**: Agent 可以覆盖权限模式（如 `permissionMode: 'plan'`）
3. **Skill 预加载**: Agent 可以预加载特定 skills
4. **工作树隔离** (`isolation: "worktree"`): Agent 可以在独立 git worktree 中运行

---

## 4. Skills 系统

### 4.1 Skill 架构概览

Skills 是 Claude Code 的**可扩展命令系统**，允许用户定义自定义工作流。

```
src/skills/
├── bundled/               # 内置 skills（verify, batch, debug 等）
│   ├── index.ts          # 初始化所有内置 skills
│   ├── verify.ts         # 验证 skill
│   ├── batch.ts          # 批量并行处理 skill
│   ├── debug.ts          # 调试 skill
│   ├── loop.ts           # 循环 skill
│   └── ...
├── loadSkillsDir.ts      # Skill 加载器（从文件系统加载）
├── bundledSkills.ts       # Skill 注册表
└── mcpSkillBuilders.ts   # MCP skill 构建器
```

### 4.2 Skill 文件格式

Skills 使用 Markdown 文件格式，带 YAML frontmatter：

```markdown
---
name: verify
description: Verify a code change does what it should by running the app
when_to_use: Use when you need to verify code changes work correctly
allowed_tools:
  - Bash
  - Read
effort: medium
---

# Skill Body

Your skill content here...

## Variable Substitution
- ${CLAUDE_SKILL_DIR}  → Skill 所在目录
- ${CLAUDE_SESSION_ID}  → 当前会话 ID
```

### 4.3 Skill Frontmatter 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | Skill 名称 |
| `description` | string | 描述（用于模型选择） |
| `when_to_use` | string | 何时使用的指导 |
| `allowed_tools` | string[] | 允许使用的工具列表 |
| `argument-hint` | string | 参数提示 |
| `arguments` | string[] | 参数名称列表 |
| `model` | string | 模型覆盖（可选） |
| `effort` | string/number |  effort 级别 |
| `context` | `'fork'` | 是否 fork 执行 |
| `paths` | string[] | 条件激活路径模式 |
| `hooks` | object | 钩子配置 |
| `user-invocable` | boolean | 是否可通过 `/` 调用 |
| `disable-model-invocation` | boolean | 是否禁用模型调用 |

### 4.4 Skill 加载机制

**文件**: `src/skills/loadSkillsDir.ts`

```typescript
// Skill 加载优先级（后者覆盖前者）
1. Policy settings (managed)
2. User settings (~/.claude/skills)
3. Project settings (.claude/skills)
4. Additional directories (--add-dir)
5. Legacy commands/ format
```

**加载顺序**:
1. 扫描所有 skills 目录
2. 解析每个 SKILL.md 的 frontmatter
3. 去重（通过 realpath 解析 symlink）
4. 注册到命令表

### 4.5 Skill 执行模式

#### Inline 执行

Skill 内容直接注入对话，作为用户消息处理。

```typescript
// SkillTool.ts 中
if (command?.type === 'prompt' && command.context !== 'fork') {
  // Inline 执行
  return processPromptSlashCommand(commandName, args, commands, context)
}
```

#### Fork 执行

Skill 在独立 sub-agent 中执行，有自己的 token budget。

```typescript
// SkillTool.ts 中
if (command?.type === 'prompt' && command.context === 'fork') {
  return executeForkedSkill(command, commandName, args, context, ...)
}
```

### 4.6 内置 Skills

| Skill | 文件 | 功能 |
|-------|------|------|
| `verify` | `verify.ts` | 通过运行应用验证代码变更（ANT only） |
| `batch` | `batch.ts` | 大规模并行变更编排 |
| `debug` | `debug.ts` | 调试辅助 |
| `loop` | `loop.ts` | 循环执行（feature-gated） |
| `remember` | `remember.ts` | 记忆辅助 |
| `simplify` | `simplify.ts` | 简化变更 |
| `scheduleRemoteAgents` | `scheduleRemoteAgents.ts` | 远程 agent 调度 |
| `claudeApi` | `claudeApi.ts` | Claude API 辅助（feature-gated） |

### 4.7 Batch Skill 详解

**文件**: `src/skills/bundled/batch.ts`

Batch 是最复杂的内置 skill，展示完整的多 Agent 编排：

```typescript
// Phase 1: Research and Plan (Plan Mode)
// - 启动 subagents 进行深度研究
// - 分解为 5-30 个独立工作单元
// - 每个单元必须能在独立 git worktree 中执行
// - 确定 e2e 测试方案
// - 编写计划并等待批准

// Phase 2: Spawn Workers
// - 每个工作单元一个 background agent
// - 所有 agents 使用 isolation: "worktree"
// - 一次启动所有 agents（并行）

// Phase 3: Track Progress
// - 渲染状态表格
// - 解析 PR URL
// - 报告最终结果
```

---

## 5. Tools 系统

### 5.1 Tool 接口

**文件**: `src/Tool.ts`

```typescript
interface Tool<Input, Output, P extends ToolProgressData> {
  name: string
  description(input: Input): Promise<string>
  inputSchema: Input
  outputSchema?: z.ZodType<unknown>
  
  // 核心方法
  call(args: Input, context: ToolUseContext, ...): Promise<ToolResult<Output>>
  
  // 权限
  validateInput?(args: Input, context): Promise<ValidationResult>
  checkPermissions(args: Input, context): Promise<PermissionResult>
  
  // 工具特性
  isConcurrencySafe(args: Input): boolean
  isReadOnly(args: Input): boolean
  isDestructive?(args: Input): boolean
  
  // 渲染
  renderToolUseMessage(input: Partial<Input>, options): React.ReactNode
  renderToolResultMessage(content: Output, ...): React.ReactNode
  renderToolUseProgressMessage(progress: ProgressMessage<P>[], ...): React.ReactNode
}
```

### 5.2 工具注册表

**文件**: `src/tools.ts`

所有可用工具被组装成列表，部分工具通过 `feature()` 条件加载。

### 5.3 关键工具

| 工具 | 目录 | 功能 |
|------|------|------|
| `AgentTool` | `tools/AgentTool/` | 启动 sub-agents |
| `SkillTool` | `tools/SkillTool/` | 调用 skills |
| `BashTool` | `tools/BashTool/` | 执行 shell 命令 |
| `FileReadTool` | `tools/FileReadTool/` | 读取文件 |
| `FileEditTool` | `tools/FileEditTool/` | 编辑文件 |
| `FileWriteTool` | `tools/FileWriteTool/` | 写入文件 |
| `GrepTool` | `tools/GrepTool/` | 正则搜索 |
| `GlobTool` | `tools/GlobTool/` | glob 模式匹配 |
| `TeamCreateTool` | `tools/TeamCreateTool/` | 创建 team |
| `TeamDeleteTool` | `tools/TeamDeleteTool/` | 删除 team |
| `SendMessageTool` | `tools/SendMessageTool/` | 发送消息 |
| `TaskStopTool` | `tools/TaskStopTool/` | 停止任务 |
| `EnterPlanModeTool` | `tools/EnterPlanModeTool/` | 进入 plan 模式 |
| `ExitPlanModeTool` | `tools/ExitPlanModeTool/` | 退出 plan 模式 |
| `ToolSearchTool` | `tools/ToolSearchTool/` | 工具搜索 |

### 5.4 工具执行流程

```
用户输入 或 模型响应
        ↓
  Tool Call Block
        ↓
  validateInput()     ← 验证输入
        ↓
  checkPermissions()  ← 检查权限
        ↓
  canUseTool()       ← 权限决策
        ↓
  call()             ← 执行工具
        ↓
  渲染结果 (renderToolResultMessage)
        ↓
  返回 ToolResult
```

### 5.5 权限系统

**文件**: `src/utils/permissions/`

```typescript
type PermissionMode = 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits' | 'auto' | 'bubble'

// 权限决策
type PermissionDecision =
  | { behavior: 'allow', updatedInput?: Input }
  | { behavior: 'deny', message: string, decisionReason: ... }
  | { behavior: 'ask', message: string, suggestions: ... }
```

---

## 6. Planning 机制

### 6.1 Plan Mode V2

**文件**: `src/utils/planModeV2.ts`

Plan Mode 是 Claude Code 的规划系统：

```typescript
// Agent 数量配置
getPlanModeV2AgentCount(): number {
  // Max/Enterprise/Team: 3 agents
  // 其他: 1 agent
}

getPlanModeV2ExploreAgentCount(): number {
  return 3  // 探索 agent 数量
}
```

### 6.2 Plan Mode 工作流程

```
用户请求实现功能
        ↓
  EnterPlanMode
        ↓
  Phase 1: Interview (可选)
  └── 深入理解需求
        ↓
  Phase 2: Explore
  └── 启动 Explore agents 并行研究
        ↓
  Phase 3: Synthesize
  └── 综合研究发现
        ↓
  Phase 4: Write Plan
  └── 编写详细实施计划
        ↓
  ExitPlanMode (用户批准)
        ↓
  开始实施
```

### 6.3 Pewter Ledger

Plan 文件结构实验，控制 plan 输出的格式：

```typescript
type PewterLedgerVariant = 'trim' | 'cut' | 'cap' | null
// null = 控制组
// trim/cut/cap = 逐步更严格的 plan 大小指导
```

---

## 7. 上下文管理与 Compaction

### 7.1 Compaction 服务

**文件**: `src/services/compact/compact.ts`

Compaction 是 Claude Code 的**上下文窗口管理**系统。

#### 触发条件

- 自动触发（token 达到阈值）
- 手动触发（`/compact` 命令）

####  compaction 类型

| 类型 | 说明 |
|------|------|
| `autoCompact` | 自动上下文压缩 |
| `microCompact` | 微压缩（轻量级） |
| `snipCompact` | 历史截断 |
| `reactiveCompact` | 响应式压缩（API 错误后） |

### 7.2 Compaction 流程

```
消息历史（增长到阈值）
        ↓
  Pre-Compact Hooks
        ↓
  过滤图片/文档（节省 tokens）
        ↓
  Fork Summary Agent
  └── 使用独立 agent 生成摘要
        ↓
  保留最近 N 条消息
  替换为摘要消息
        ↓
  Post-Compact Hooks
        ↓
  重新加载文件附件
```

### 7.3 摘要生成策略

1. **Forked Agent 路径**（首选）:
   - 复用主对话的 prompt cache
   - 使用 `runForkedAgent()` 生成摘要

2. **流式路径**（回退）:
   - 直接调用 API 生成摘要
   - 较慢但更简单

### 7.4 会话内存

**文件**: `src/services/SessionMemory/sessionMemory.ts`

```typescript
interface SessionMemory {
  messages: Message[]
  summary?: string
  compactBoundary?: CompactBoundary
  invokedSkills: Map<string, SkillContent>
}
```

---

## 8. 状态管理

### 8.1 AppState

**文件**: `src/state/AppState.tsx`

```typescript
interface AppState {
  messages: Message[]
  tools: Tools
  mcp: {
    clients: MCPServerConnection[]
    commands: Command[]
    tools: Tools
  }
  toolPermissionContext: ToolPermissionContext
  agents: AgentDefinition[]
  todos: Record<string, Todo[]>
  fileHistory: FileHistoryState
  attribution: AttributionState
  // ...
}
```

### 8.2 状态管理模式

使用 **Zustand 风格**的 store：

```typescript
// src/state/store.ts
const useStore = create((set) => ({
  messages: [],
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  // ...
}))
```

### 8.3 Bootstrap State

**文件**: `src/bootstrap/state.ts`

模块级单例，用于会话级全局状态：

```typescript
// Session globals
let sessionId: string
let cwd: string
let projectRoot: string
let tokenCounts: TokenCounts

// Agent globals
const agentIdToSessionId = new Map<string, string>()
const invokedSkills = new Map<string, SkillContent>()
```

---

## 9. UI 层 (Ink)

### 9.1 Ink 框架

**文件**: `src/ink/`

Ink 是 Claude Code 自定义的 **React reconciler**，专为终端渲染设计：

```typescript
// 自定义 hooks
useInput()           // 键盘输入
useTerminalSize()    // 终端尺寸
useSearchHighlight() // 搜索高亮
useTerminalNotification()  // 通知
```

### 9.2 虚拟列表渲染

Ink 实现高效的虚拟列表，只渲染可见区域：

```typescript
// 虚拟列表实现
class VirtualList {
  visibleRange: { start: number, end: number }
  renderedItems: Item[]
  
  scrollTo(index: number)
  renderItem(index: number)
}
```

### 9.3 关键组件

| 组件 | 功能 |
|------|------|
| `App.tsx` | 根 provider（AppState, Stats, FpsMetrics） |
| `Messages.tsx` | 消息列表渲染 |
| `MessageRow.tsx` | 单条消息渲染 |
| `PromptInput/` | 用户输入处理 |
| `permissions/` | 工具权限 UI |
| `Spinner.tsx` | 加载动画 |

### 9.4 React Compiler Runtime

组件使用 React Compiler runtime（`react/compiler-runtime`）：

```typescript
// 解编译输出包含 memoization 调用
const $ = _c(N)  // React Compiler 生成
```

---

## 10. MCP 集成

### 10.1 MCP Client

**文件**: `src/services/mcp/client.ts`

```typescript
interface MCPServerConnection {
  name: string
  type: 'connected' | 'pending' | 'disconnected'
  tools: Tool[]
  cleanup?: () => Promise<void>
}
```

### 10.2 MCP 功能

- **动态工具发现**: 从 MCP 服务器加载工具
- **服务器管理**: 连接/断开 MCP 服务器
- **工具翻译**: 将 MCP 工具格式转换为内部格式

### 10.3 MCP 权限

MCP 工具通过标准权限系统管理：
- 首次使用提示
- 记住允许/拒绝决策
- 规则匹配（`mcp__server__tool` 模式）

---

## 11. 版本差异分析

### 11.1 文件结构差异

| 方面 | `claude-code` | `cc_src_unzipped` |
|------|---------------|-------------------|
| 内置 Agents | 完整实现 (`tools/AgentTool/built-in/`) | 相同 |
| 常量路径 | `constants/src/tools/AgentTool/builtInAgents.ts` | `constants/` 直接子目录 |
| Workflow | `tasks/LocalWorkflowTask/LocalWorkflowTask.ts` (stub) | 无 |
| Worker Agent | `coordinator/workerAgent.ts` (stub) | 相同 |

### 11.2 实现完整性

| 模块 | `claude-code` | `cc_src_unzipped` |
|------|---------------|-------------------|
| Coordinator Mode | 完整 | 相同 |
| AgentTool | 完整 | 相同 |
| SkillTool | 完整 | 相同 |
| Batch Skill | 完整 | 无 |
| Plan Mode | 完整 | 部分 |
| Compact Service | 完整 | 相同 |
| Analytics | 存根 | 相同 |

### 11.3 Feature Flags

两个版本中 `feature()` 都 polyfill 为返回 `false`，禁用了所有实验性特性。

---

## 12. 设计思想总结

### 12.1 核心设计原则

#### 1. 多 Agent 编排 (Multi-Agent Orchestration)

Claude Code 不是单一 AI，而是** AI 协调者 + 多 Worker Agent** 的生态系统。

**关键洞察**:
- 并行化是性能的关键（Research 阶段并行，Implementation 阶段串行）
- Worker 之间隔离（独立 git worktree，无共享状态）
- 协调者不直接修改代码，只负责任务分配和结果综合

#### 2. 技能可扩展性 (Skill Extensibility)

Skills 作为一等公民：
- Markdown 格式易于编写和维护
- Frontmatter 控制行为（权限、模型、工具）
- 支持条件激活（基于文件路径）

#### 3. 工具作为核心抽象 (Tools as Core Abstraction)

所有 Agent 能力通过工具暴露：
- 统一接口（`Tool<Input, Output, Progress>`）
- 可组合（工具可以调用其他工具）
- 可渲染（每种工具都有 UI 表示）

#### 4. 上下文管理自动化 (Automated Context Management)

Compaction 系统自动管理 token 消耗：
- 对话历史自动压缩
- 摘要保留关键信息
- Forked agent 复用 prompt cache

#### 5. 渐进式复杂度 (Progressive Complexity)

用户从简单开始，逐渐解锁高级功能：

```
简单使用                    高级使用
   │                          │
   ├─ 单个对话               ├─ Plan Mode
   ├─ 直接工具调用           ├─ Batch parallel
   ├─ 内置 skills           ├─ Coordinator Mode
   └─ 基础 skills           └─ Custom skills
```

### 12.2 架构亮点

#### 1. Streaming First

整个系统围绕流式处理设计：
- API 响应流式处理
- 工具执行流式输出
- 进度更新实时推送

#### 2. 权限最小化

默认拒绝，按需授权：
- 每个工具调用都经过权限检查
- Skill 有自己的工具权限
- 支持规则匹配（prefix, exact）

#### 3. 持久化优先

所有状态都持久化：
- 对话历史 → transcript 文件
- 文件状态 → file state cache
- Agent 状态 → sidechain transcript

#### 4. Feature Flag 驱动开发

所有实验性功能通过 feature flags 控制：
- 允许逐步发布
- 支持 A/B 测试
- 外部版本可完全禁用

### 12.3 未来演进方向

基于代码分析，Claude Code 的演进方向包括：

1. **更智能的 Planning**: Pewter ledger 等实验
2. **更好的 Skill 组合**: Skill 之间调用
3. **Team Collaboration**: 多 Agent 协作模式
4. **增强的 Memory**: 跨会话持久化
5. **IDE 集成**: 更深入的编辑器集成

---

## 13. Commands 命令系统

### 13.1 Command 架构概览

Commands 是 Claude Code 的**命令行接口**，用户通过 `/命令名` 语法调用。与 Skills 不同，Commands 是内置功能，不基于 Markdown 文件。

```
src/commands/                    # 命令实现目录
├── help/                        # 帮助命令
├── compact/                     # 压缩上下文命令
├── plan/                        # 规划模式命令
├── skills/                      # 技能管理命令
├── agent/                       # Agent 管理命令
├── config/                      # 配置命令
├── mcp/                         # MCP 管理命令
├── theme/                       # 主题命令
├── init.ts                      # 初始化命令
├── commit.ts                    # 提交命令
├── review.ts                    # 审查命令
└── ...（80+ 个命令）

src/commands.ts                  # 命令注册中心
├── COMMANDS()                   # 所有内置命令列表
├── getCommands(cwd)             # 获取所有可用命令
├── findCommand(name, commands)  # 查找命令
└── isCommandEnabled(cmd)        # 检查命令是否启用
```

### 13.2 Command 类型

**文件**: `src/types/command.ts`

```typescript
// 三种命令类型

// 1. Prompt 类型命令（可执行的 skill）
type PromptCommand = {
  type: 'prompt'
  progressMessage: string       // 进度消息
  contentLength: number          // 内容长度（用于 token 估算）
  argNames?: string[]            // 参数名
  allowedTools?: string[]        // 允许的工具
  model?: string                 // 模型覆盖
  source: SettingSource | 'builtin' | 'mcp' | 'plugin' | 'bundled'
  context?: 'inline' | 'fork'   // 执行上下文
  agent?: string                // Fork 时使用的 agent 类型
  effort?: EffortValue           // Effort 级别
  paths?: string[]               // 条件激活路径
  getPromptForCommand(args, context): Promise<ContentBlockParam[]>
}

// 2. Local 类型命令（立即执行）
type LocalCommand = {
  type: 'local'
  supportsNonInteractive: boolean
  load(): Promise<LocalCommandModule>  // 延迟加载
}

// 3. Local-JSX 类型命令（渲染 React UI）
type LocalJSXCommand = {
  type: 'local-jsx'
  load(): Promise<LocalJSXCommandModule>  // 延迟加载
}
```

### 13.3 命令注册机制

**文件**: `src/commands.ts`

```typescript
// 命令来源优先级（从高到低）
const loadAllCommands = memoize(async (cwd: string): Promise<Command[]> => {
  const [
    { skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills },
    pluginCommands,
    workflowCommands,
  ] = await Promise.all([
    getSkills(cwd),           // 1. Skills（skills/ 目录）
    getPluginCommands(),       // 2. 插件命令
    getWorkflowCommands(),     // 3. 工作流命令
  ])

  return [
    ...bundledSkills,          // 内置 skills
    ...builtinPluginSkills,    // 内置插件 skills
    ...skillDirCommands,       // 用户 skills
    ...workflowCommands,       // 工作流
    ...pluginCommands,         // 插件命令
    ...pluginSkills,           // 插件 skills
    ...COMMANDS(),             // 内置命令
  ]
})
```

### 13.4 Slash 命令处理流程

**文件**: `src/utils/processUserInput/processSlashCommand.tsx`

```
用户输入 "/命令 参数"
        ↓
parseSlashCommand()           # 解析命令名和参数
        ↓
findCommand()                 # 在命令列表中查找
        ↓
┌─────────────────────────────┐
│ 根据命令类型分发:            │
├─────────────────────────────┤
│ type === 'local-jsx'  →  渲染 React UI（HelpV2, Config 等）│
│ type === 'local'     →  执行 local 命令（compact, clear）  │
│ type === 'prompt'     →  获取 prompt 内容并送入 AI        │
└─────────────────────────────┘
        ↓
返回结果或触发 AI 查询
```

### 13.5 主要内置命令

#### `/help` - 帮助命令
```typescript
// src/commands/help/help.tsx
// 类型: local-jsx
// 功能: 渲染 HelpV2 组件，显示所有可用命令列表
```

#### `/compact` - 上下文压缩
```typescript
// src/commands/compact/compact.ts
// 类型: local
// 功能: 压缩对话历史，释放上下文窗口
// 实现: 
//   1. 尝试 Session Memory compaction
//   2. 回退到传统 microcompact + compactConversation
//   3. 支持 reactive compact（实验性）
```

#### `/plan` - 规划模式
```typescript
// src/commands/plan/plan.tsx
// 类型: local-jsx
// 功能: 启用/禁用 Plan Mode
// 用法:
//   /plan        - 启用 plan mode
//   /plan open   - 在编辑器中打开计划文件
```

#### `/skills` - 技能管理
```typescript
// src/commands/skills/skills.tsx
// 类型: local-jsx
// 功能: 显示/管理已加载的 skills
```

#### `/config` - 配置命令
```typescript
// src/commands/config/config.tsx
// 类型: local-jsx
// 功能: 打开配置面板（主题、模型、快捷键等）
```

### 13.6 SkillTool 与 Commands 的关系

**文件**: `src/tools/SkillTool/SkillTool.ts`

SkillTool 是一个特殊的 Tool，它允许 AI 模型**调用 Skills/Commands**：

```typescript
// SkillTool 输入格式
{
  skill: string    // 命令名称（如 "verify", "batch"）
  args?: string    // 可选参数
}

// SkillTool 执行流程
async call({ skill, args }, context, ...) {
  // 1. 验证 skill 存在
  const command = findCommand(skill, commands)
  
  // 2. 检查是否 fork 执行
  if (command.type === 'prompt' && command.context === 'fork') {
    return executeForkedSkill(...)  // 在子 agent 中运行
  }
  
  // 3. 内联执行 prompt 命令
  return processPromptSlashCommand(commandName, args, ...)
}
```

### 13.7 命令执行上下文

```typescript
// LocalJSXCommandContext - 用于 local-jsx 命令
type LocalJSXCommandContext = ToolUseContext & {
  canUseTool?: CanUseToolFn
  setMessages: (updater: (prev: Message[]) => Message[]) => void
  options: {
    dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>
    ideInstallationStatus: IDEExtensionInstallationStatus | null
    theme: ThemeName
  }
  onChangeAPIKey: () => void
  // ...
}

// LocalCommandCall - 用于 local 命令
type LocalCommandCall = (
  args: string,
  context: LocalJSXCommandContext,
) => Promise<LocalCommandResult>

// LocalCommandResult 类型
type LocalCommandResult =
  | { type: 'text'; value: string }      // 文本输出
  | { type: 'compact'; compactionResult } // 压缩结果
  | { type: 'skip' }                      // 跳过消息
```

### 13.8 远程模式安全命令

某些命令可在远程模式（`--remote`）下安全使用：

```typescript
export const REMOTE_SAFE_COMMANDS: Set<Command> = new Set([
  session,    // 显示远程会话二维码
  exit,       // 退出 TUI
  clear,      // 清屏
  help,       // 显示帮助
  theme,      // 更改主题
  color,      // 更改 agent 颜色
  vim,        // 切换 vim 模式
  cost,       // 显示会话成本
  usage,      // 显示使用信息
  copy,       // 复制最后消息
  btw,        // 快速笔记
  feedback,   // 发送反馈
  plan,       // 规划模式切换
  keybindings,# 快捷键管理
  statusline, # 状态行切换
  stickers,   # 贴纸
  mobile,     # 移动端二维码
])
```

### 13.9 命令可用性过滤

```typescript
// 命令可见性取决于用户类型和订阅状态
export function meetsAvailabilityRequirement(cmd: Command): boolean {
  if (!cmd.availability) return true
  
  for (const a of cmd.availability) {
    switch (a) {
      case 'claude-ai':
        // claude.ai 订阅者
        if (isClaudeAISubscriber()) return true
        break
      case 'console':
        // 直接 Console API 用户
        if (!isClaudeAISubscriber() && 
            !isUsing3PServices() && 
            isFirstPartyAnthropicBaseUrl())
          return true
        break
    }
  }
  return false
}
```

### 13.10 批量内置命令列表

**核心命令**:
- `/help` - 显示帮助
- `/exit` - 退出程序
- `/clear` - 清屏/清除对话
- `/compact` - 压缩上下文
- `/plan` - 规划模式
- `/config` - 打开配置
- `/model` - 切换模型
- `/theme` - 更改主题
- `/cost` - 显示会话成本

**Agent 相关**:
- `/agents` - 管理 agents
- `/tasks` - 查看后台任务
- `/resume` - 恢复会话
- `/rewind` - 回溯对话

**代码管理**:
- `/commit` - 提交更改
- `/review` - 代码审查
- `/diff` - 显示更改
- `/branch` - 分支管理

**Skills/Plugins**:
- `/skills` - 列出 skills
- `/plugins` - 管理插件
- `/mcp` - MCP 服务器管理

**工具类**:
- `/doctor` - 诊断问题
- `/usage` - 使用统计
- `/feedback` - 发送反馈
- `/version` - 显示版本

---

## 附录

### A. 关键文件索引

| 文件 | 行数 | 功能 |
|------|------|------|
| `src/query.ts` | ~1400 | 核心查询循环 |
| `src/QueryEngine.ts` | ~1300 | 查询编排器 |
| `src/Tool.ts` | ~800 | Tool 接口定义 |
| `src/commands.ts` | ~754 | 命令注册中心 |
| `src/coordinator/coordinatorMode.ts` | ~370 | 协调者模式 |
| `src/skills/loadSkillsDir.ts` | ~1080 | Skill 加载 |
| `src/tools/AgentTool/runAgent.ts` | ~970 | Agent 运行 |
| `src/services/compact/compact.ts` | ~1400+ | 上下文压缩 |
| `src/tools/SkillTool/SkillTool.ts` | ~1100 | Skill 执行 |
| `src/utils/processUserInput/processSlashCommand.tsx` | ~921 | Slash 命令处理 |

### B. 类型层次

```
AgentDefinition
├── BuiltInAgentDefinition (内置 agents)
├── CustomAgentDefinition (用户定义的 .md agents)
└── PluginAgentDefinition (插件 agents)

Command
├── PromptCommand (可执行的 skill/command)
└── ActionCommand (立即执行)

Tool
└── [各种工具实现]

Message
├── UserMessage
├── AssistantMessage
├── SystemMessage
└── AttachmentMessage
```

### C. 环境变量

| 变量 | 功能 |
|------|------|
| `CLAUDE_CODE_COORDINATOR_MODE` | 启用协调者模式 |
| `CLAUDE_CODE_SIMPLE` | 简单模式（仅内置功能） |
| `USER_TYPE` | 用户类型（`ant` = Anthropic 内部） |
| `BUILD_TARGET` | 构建目标 |
| `BUILD_ENV` | 构建环境 |

---

*本文档基于源码分析生成，如有疏漏请指正。*
