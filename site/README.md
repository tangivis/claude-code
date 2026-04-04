# Claude Code 源码深度分析 — 静态网站

> 深入 Anthropic 官方 CLI 工具的内部实现 — 从架构设计到 Agent Loop，从 40+ 工具系统到多层权限模型，完整拆解一个工业级 AI 编程智能体是如何构建的。

## 在线预览

直接用浏览器打开 `site/index.html`，或启动本地服务器：

```bash
cd site
python3 -m http.server 8080
# 访问 http://localhost:8080
```

## 网站结构

```
site/
├── index.html              # 首页：架构概览 + 12 章节导航
├── css/style.css           # 暗色主题样式
├── js/main.js              # 交互逻辑 (搜索、Tab、动画)
└── pages/
    ├── architecture.html   # Ch01: 整体架构
    ├── agent-loop.html     # Ch02: Agent Loop
    ├── tools.html          # Ch03: 工具系统
    ├── permissions.html    # Ch04: 权限与安全
    ├── agents.html         # Ch05: 多智能体系统
    ├── context.html        # Ch06: 上下文管理
    ├── hooks.html          # Ch07: Hook 系统
    ├── mcp.html            # Ch08: MCP 协议
    ├── api.html            # Ch09: API 与模型集成
    ├── ui.html             # Ch10: 终端 UI
    ├── comparison.html     # Ch11: 对比 Codex CLI
    └── internals.html      # Ch12: 内部机制
```

## 章节内容详解

### Chapter 01 — 整体架构

Claude Code 的技术栈和启动引导流程：

- **运行时 & 构建**：TypeScript + Bun（非 Node.js），ESM 模块系统，TSX + react-jsx transform，单文件 bundle ~25MB
- **启动流程**：`cli.tsx`（polyfills）→ `main.tsx`（Commander.js CLI）→ `init.ts`（初始化）→ `REPL.tsx`（交互界面）
- **架构分层**：表现层（Ink/React）→ 业务逻辑层（QueryEngine/query()）→ 服务层（API/Tools/MCP）→ 基础设施层（State/Config/Hooks）
- **状态管理**：AppState（中央状态 Context）+ Store（Zustand 风格）+ Session Singletons（模块级单例）
- **Feature Flags**：`feature()` 在反编译版中始终返回 `false`，所有内部功能（COORDINATOR_MODE, KAIROS 等）禁用

### Chapter 02 — Agent Loop

核心 `query()` 循环的详细剖析：

- **AsyncGenerator 驱动**：`async function* query()` 通过 yield 逐个返回流式事件
- **Turn 结构**：预处理 → 消息标准化 → System Prompt 组装 → API 流式调用 → 响应解析 → 工具编排 → 退出判断
- **流式事件**：`stream_request_start`、`stream_delta`、`Message`（Assistant/User/Progress/ToolUseSummary）、`TombstoneMessage`
- **工具执行**：StreamingToolExecutor 编排 — 权限检查 → 执行 → 结果收集，并行安全的工具可并行执行
- **错误恢复**：Max Output Tokens（3 次重试 + recompact）、Prompt Too Long（microcompact）、Fallback Model（自动切换备用模型）
- **上下文压缩**：Auto Compact（模型生成摘要）、Snip Compact（直接删除中间消息）、Reactive Compact（主动式提前介入）

### Chapter 03 — 工具系统

40+ 内置工具的完整目录：

| 分类 | 工具 |
|------|------|
| **文件操作** | FileReadTool（支持 PDF/图片/Notebook）、FileEditTool（字符串替换）、FileWriteTool、NotebookEditTool |
| **搜索导航** | GlobTool（文件名 glob）、GrepTool（ripgrep 正则）、LSPTool（Language Server Protocol）、ToolSearchTool |
| **Shell 执行** | BashTool（后台/超时/流式）、PowerShellTool（Windows） |
| **Web 工具** | WebFetchTool（URL 抓取 + AI 处理）、WebSearchTool（网络搜索） |
| **Agent 工具** | AgentTool（子 Agent 生成）、SkillTool（技能/命令）、SendMessageTool、TeamCreateTool、PlanMode 工具 |
| **任务管理** | TaskCreate/List/Get/Update/Stop/Output |
| **MCP 工具** | ListMcpResourcesTool、ReadMcpResourceTool、MCPTool（通用代理） |
| **配置交互** | AskUserQuestionTool、BriefTool、WorktreeTool、CronTool、RemoteTriggerTool |

工具注册在 `src/tools.ts`，通过 Feature Flag、环境变量、用户类型、运行时检查进行条件加载。

### Chapter 04 — 权限与安全

多层权限架构：

- **6 种权限模式**：`default`（逐一确认）、`plan`（计划审批）、`acceptEdits`（自动批准编辑）、`bypassPermissions`（全部跳过）、`auto`（LLM 分类器）、`dontAsk`（自动拒绝）
- **7 层规则来源**（优先级从高到低）：flagSettings → cliArg → userSettings → projectSettings → policySettings → command → session
- **权限检查链**：Deny Rules → Allow Rules → Ask Rules → LLM Classifier → Hook Check → Default Fallback
- **LLM 分类器**：bashClassifier（2 秒推测性检查）+ yoloClassifier（auto 模式的模型推理）
- **危险命令检测**：`isDangerousBashPermission()` 检测通配符、解释器、包管理器等危险模式
- **与 Codex CLI 对比**：LLM 分类器（概率性/语义理解）vs OS 内核沙箱 Landlock/Seatbelt（确定性/系统调用级）

### Chapter 05 — 多智能体系统

Agent 的生成、隔离和协作：

- **7 种内置 Agent**：general-purpose、Explore（只读搜索）、Plan（架构规划）、code-reviewer、verification、claude-code-guide、statusline-setup
- **生成流程**：AgentTool 调用 → 定义解析 → 工具池组装（allowlist/denylist 过滤）→ System Prompt 构建 → 独立 query() 循环
- **3 级隔离**：进程内（默认，共享工作目录）、Worktree（Git Worktree 独立分支）、Remote（远程 CCR 环境）
- **Fork 机制**：继承父 Agent 完整上下文，权限冒泡到父会话，防递归保护，Prompt Cache 复用
- **Team Swarm**：TeamCreateTool 创建多 Agent 团队，SendMessageTool 点对点/广播通信，隔离任务列表

### Chapter 06 — 上下文管理

从 System Prompt 到 Memory 到 Compaction：

- **System Prompt 构建**：基础 Prompt + 环境信息 + CLAUDE.md 内容 + 用户/系统上下文 → cache-eligible block
- **CLAUDE.md 加载**：从项目目录向上遍历 + 用户级 `~/.claude/CLAUDE.md`
- **Memory 系统**：4 种类型（user/feedback/project/reference），基于文件持久化在 `~/.claude/projects/` 下，MEMORY.md 索引始终加载到上下文
- **Compaction 策略**：Auto（20 turn 后超阈值触发，模型生成摘要）→ Snip（轻量级删除中间消息）→ Reactive（实时监控提前介入）
- **Token Budget**：会话级（tokenBudget，超限触发 auto-continue）+ Turn 级（task budget，Beta 功能）

### Chapter 07 — Hook 系统

15+ 生命周期事件的可扩展机制：

- **核心事件**：SessionStart、Setup、UserPromptSubmit、Stop
- **工具钩子**：PreToolUse（exit 2=阻止）、PostToolUse、PostToolUseFailure、PermissionRequest、PermissionDenied
- **Agent 钩子**：SubagentStart、SubagentStop
- **压缩钩子**：PreCompact（exit 2=阻止压缩）、PostCompact
- **配置方式**：settings.json 中的 `hooks` 字段，指定 event + matcher + command
- **执行机制**：子进程执行，stdin 接收 JSON 输入，通过 exit code 控制行为
- **异步 Hook**：AsyncHookRegistry 管理长时间运行的 Hook，15 秒超时，每秒进度事件

### Chapter 08 — MCP 协议

Model Context Protocol 集成：

- **架构**：Claude Code 作为 MCP Client，连接多个 MCP Server（GitHub、Database、自定义等）
- **工具注入**：MCP Server 工具以 `mcp__{server}__{tool}` 前缀加入工具池
- **MCPTool 代理**：开放式 schema 透传，运行时动态覆盖工具名和参数
- **资源系统**：ListMcpResourcesTool（LRU 缓存列出资源）+ ReadMcpResourceTool（URI 读取内容）
- **生命周期**：配置注册 → 连接建立 → 工具发现 → 使用 → Agent 退出时清理

### Chapter 09 — API 与模型集成

多 Provider 支持和流式调用：

- **4 个 Provider**：Anthropic 直连、AWS Bedrock、Google Vertex AI、Azure Foundry
- **API 客户端**：`src/services/api/claude.ts`，构建请求参数 → Anthropic SDK 流式调用 → 事件解析
- **流式事件**：message_start → content_block_start → content_block_delta（text/json/thinking）→ content_block_stop → message_stop
- **Thinking 模式**：Adaptive（自动）、Explicit（手动）、Disabled，默认 10,000 tokens
- **Fallback**：主模型失败自动切换备用模型
- **Prompt Caching**：System Prompt 作为 cache-eligible block，Fork Agent 复用父级缓存

### Chapter 10 — 终端 UI

React in Terminal：

- **Ink 框架**：自定义 fork，自定义 reconciler，虚拟列表渲染
- **自定义 Hooks**：useInput（键盘）、useTerminalSize（尺寸）、useSearchHighlight（搜索高亮）
- **组件树**：App → REPL → Messages/MessageRow + PromptInput + permissions
- **每个工具有独立的 React UI 组件**：BashTool（命令输出）、FileEditTool（diff）、AgentTool（进度）等
- **React Compiler**：自动注入 `_c(N)` memoization，组件级别缓存优化

### Chapter 11 — 对比：Claude Code vs Codex CLI

两种 AI 编程智能体的设计哲学对比：

| 维度 | Claude Code | Codex CLI |
|------|-------------|-----------|
| 语言 | TypeScript + Bun | Rust (81 crates) |
| 安全模型 | LLM 分类器 + 多层规则 | OS 内核沙箱 (Landlock/Seatbelt) |
| 安全保证 | 概率性（依赖模型判断） | 确定性（依赖 OS 内核） |
| 工具数量 | 40+ (+ MCP 动态工具) | ~3 (shell, read, patch) |
| 多 Agent | 7+ 类型, Worktree, Team Swarm | 无 |
| 扩展性 | MCP 协议 + Hook + 自定义 Agent | 有限 |
| UI 框架 | React + Ink | Ratatui |

核心差异：**一个用 TypeScript 做了 40 多个工具，靠额外调一次 LLM 来判断命令安全性（灵活但概率性）；另一个用 Rust 写了 81 个 crate，靠操作系统内核来保证安全（确定但刚性）。**

### Chapter 12 — 内部机制

Feature Flags、Session、Stub 模块：

- **14+ Feature Flags**：COORDINATOR_MODE, KAIROS, PROACTIVE, AGENT_TRIGGERS, WEB_BROWSER_TOOL, MONITOR_TOOL 等（全部禁用，但代码已就位，揭示开发方向）
- **Session 管理**：模块级单例维护 sessionId、cwd、projectRoot、token 计数
- **File History**：追踪会话期间所有文件修改，支持意外修改检测和 Git Diff 生成
- **Stub 模块**：Computer Use、*-napi 包、Analytics/GrowthBook/Sentry（空实现）、Magic Docs/Voice Mode/LSP Server/Plugins（已删除）
- **React Compiler 输出**：`_c(N)` + `$[i]` memoization 模式，阅读时可忽略

## 技术实现

- **纯静态**：HTML + CSS + JS，无需构建工具或依赖
- **暗色主题**：紫色渐变主色调，JetBrains Mono 等宽字体
- **响应式设计**：桌面端侧边栏导航 + 移动端自适应
- **交互功能**：工具搜索过滤、Tab 切换、动画入场、锚点平滑滚动
- **总大小**：~212KB，15 个 HTML 文件

## 数据来源

基于 Claude Code 逆向工程/反编译版本的源码分析。所有架构图、工具目录、权限模型、Agent 系统等信息均从实际源码中提取。

---

*Built for learning purposes. Not affiliated with Anthropic.*
