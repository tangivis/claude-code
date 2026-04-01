# Buddy 宠物系统开发指南

> 记录在 `buddy-minimax` 分支上开启 BUDDY 功能并实现 `/buddy` 命令的完整过程。

---

## 目录

1. [背景](#1-背景)
2. [Worktree 创建过程](#2-worktree-创建过程)
3. [代码修改详解](#3-代码修改详解)
4. [如何运行](#4-如何运行)
5. [Buddy 功能说明](#5-buddy-功能说明)
6. [MiniMax API 验证记录](#6-minimax-api-验证记录)
7. [后续计划](#7-后续计划)

---

## 1. 背景

Claude Code 源码中藏了一个**虚拟宠物系统**（代号 Buddy），在 `src/buddy/` 目录下有完整的实现：
- ASCII 精灵图（18 种物种，每种 3 帧动画）
- 稀有度抽卡系统（common 60% ~ legendary 1%）
- 属性系统（DEBUGGING / PATIENCE / CHAOS / WISDOM / SNARK）
- 帽子装饰（crown / tophat / wizard 等 8 种）
- 对话气泡、抚摸爱心动画

但该功能被 `feature('BUDDY')` 标志关闭，命令入口 `src/commands/buddy/index.ts` 也是 stub。

这是一个**愚人节彩蛋**——源码中明确写着：
```typescript
// Teaser window: April 1-7, 2026 only. Command stays live forever after.
```

本次修改的目标：**在独立分支上开启 Buddy 功能，实现命令入口，并验证 MiniMax API 为后续集成做准备。**

---

## 2. Worktree 创建过程

### 什么是 Git Worktree？

Git Worktree 允许你在**同一个仓库**下创建多个工作目录，每个目录可以在不同的分支上工作，互不干扰。这样修改 Buddy 功能不会影响 main 分支。

### 创建步骤

```bash
# 在 claude-code 项目根目录下执行
cd /home/keitenarch/workspace/test_claude/claude-code

# 创建一个新分支 buddy-minimax，基于 main，工作目录放在 ../claude-code-buddy
git worktree add -b buddy-minimax ../claude-code-buddy main
```

**参数说明：**
- `git worktree add` — 创建新的 worktree
- `-b buddy-minimax` — 同时创建一个新分支叫 `buddy-minimax`
- `../claude-code-buddy` — worktree 的目录路径（放在项目同级目录下）
- `main` — 基于 main 分支创建

**执行结果：**
```
Preparing worktree (new branch 'buddy-minimax')
HEAD is now at 0369319 docs: 添加源码学习指南 (10 大方向 + 学习路线)
```

### 验证 Worktree

```bash
# 进入 worktree 目录
cd ../claude-code-buddy

# 确认分支
git branch
# * buddy-minimax

# 安装依赖
bun install
```

### Worktree 管理命令

```bash
# 列出所有 worktree
git worktree list

# 删除 worktree（如果不需要了）
git worktree remove ../claude-code-buddy

# 或者强制删除（有未提交修改时）
git worktree remove --force ../claude-code-buddy
```

---

## 3. 代码修改详解

本次一共修改了 **3 个文件**，新增 **1 个文件**。

### 3.1 开启 BUDDY Feature Flag

**文件：** `src/entrypoints/cli.tsx`（第 2 行）

**修改前：**
```typescript
const feature = (_name: string) => false;
```
所有 feature flag 都返回 false，意味着所有实验性功能都被关闭。

**修改后：**
```typescript
const ENABLED_FEATURES = new Set(['BUDDY']);
const feature = (_name: string) => ENABLED_FEATURES.has(_name);
```

**为什么这样改：**
- 创建一个 `Set` 存放想要开启的 feature 名称
- `feature()` 函数改为检查传入的名称是否在 Set 中
- 只开启 `BUDDY`，其他所有 flag 仍然返回 false
- 如果以后想开启更多功能，只需往 `ENABLED_FEATURES` 里加名字

**影响范围：** 以下代码中的 `feature('BUDDY')` 检查现在返回 true：
- `src/buddy/CompanionSprite.tsx` — 宠物精灵渲染组件
- `src/buddy/prompt.ts` — 宠物介绍文本（注入 system prompt）
- `src/buddy/useBuddyNotification.tsx` — 启动时的彩虹提示
- `src/commands.ts` — buddy 命令注册

### 3.2 实现 Buddy 命令入口

**文件：** `src/commands/buddy/index.ts`

**修改前（stub）：**
```typescript
// Auto-generated stub — replace with real implementation
const _default: Record<string, unknown> = {};
export default _default;
```
这是反编译时自动生成的空 stub，没有任何功能。

**修改后：**
```typescript
import type { Command } from '../../commands.js'

const buddy = {
  type: 'local',           // 本地命令（非 AI prompt 命令）
  name: 'buddy',           // 命令名 → 用户输入 /buddy
  description: 'Hatch & manage your coding companion 🥚',
  isHidden: false,         // 在 /help 中显示
  supportsNonInteractive: false,  // 仅交互模式可用
  load: () => import('./buddy.js'),  // 延迟加载实际逻辑
} satisfies Command

export default buddy
```

**为什么是 `type: 'local'`：**
- Claude Code 有 3 种命令类型：`prompt`（AI 执行）、`local`（本地执行）、`local-jsx`（React UI）
- Buddy 命令的逻辑都是本地的（生成宠物、修改配置），不需要 AI 参与
- `load: () => import(...)` 实现延迟加载——只有用户真的输入 `/buddy` 时才加载代码

### 3.3 新增 Buddy 命令实现

**新文件：** `src/commands/buddy/buddy.tsx`（160 行）

这是 `/buddy` 命令的完整实现。核心逻辑：

```
/buddy 或 /buddy hatch
├── 已有宠物 → 显示宠物信息（精灵图、属性、稀有度）
└── 没有宠物 → 孵化新宠物
    ├── roll(userId) → 基于用户 ID 确定性生成宠物骨架（species, rarity, eye, hat, stats）
    ├── 从名字库中选名字
    ├── 生成性格描述
    └── 写入全局配置 → updateGlobalConfig({ companion: {...} })

/buddy pet
└── 显示爱心动画文本

/buddy rename <name>
└── 更新配置中的 companion.name

/buddy mute / unmute
└── 切换 companionMuted 配置（隐藏/显示宠物）

/buddy release
└── 清除配置中的 companion（删除宠物）
```

**关键函数调用链：**

```
buddy.tsx
  └── companion.ts: roll(userId)
       └── hashString(userId + SALT) → 32 位种子
            └── mulberry32(seed) → 确定性伪随机生成器
                 ├── rollRarity(rng) → 加权随机稀有度
                 ├── pick(rng, SPECIES) → 随机物种
                 ├── pick(rng, EYES) → 随机眼睛
                 ├── pick(rng, HATS) → 随机帽子（common 无帽子）
                 ├── rng() < 0.01 → 1% 概率闪光
                 └── rollStats(rng, rarity) → 5 个属性值
```

**为什么用 hash(userId)：**
- 同一个用户永远生成同一只宠物（确定性）
- 不能通过编辑配置文件修改稀有度（bones 每次从 userId 重新计算）
- 配置文件只存 soul（name, personality）和 hatchedAt

**返回值格式：**
```typescript
return {
  type: 'local-jsx' as const,  // 命令返回类型
  jsx: null,                    // 没有 React 组件
  message: '...'                // 纯文本输出
}
```

---

## 4. 如何运行

### 4.1 进入 Worktree 目录

```bash
cd /home/keitenarch/workspace/test_claude/claude-code-buddy
```

### 4.2 安装依赖（首次需要）

```bash
bun install
```

### 4.3 验证版本

```bash
bun run src/entrypoints/cli.tsx --version
# 输出: 2.1.888 (Claude Code)
```

### 4.4 启动交互模式

```bash
bun run dev
```

进入交互界面后：

```bash
# 孵化/查看宠物
> /buddy

# 抚摸宠物
> /buddy pet

# 重命名
> /buddy rename Pikachu

# 隐藏宠物
> /buddy mute

# 显示宠物
> /buddy unmute

# 释放宠物（删除）
> /buddy release
```

### 4.5 管道模式测试

```bash
echo "hello" | bun run src/entrypoints/cli.tsx -p
```

### 4.6 注意事项

- 需要有效的 Anthropic API Key 或 OAuth 认证（主对话仍然走 Claude API）
- Buddy 宠物数据存储在 `~/.claude/` 的全局配置中
- 宠物的精灵图在终端宽度 >= 100 列时完整显示，窄终端显示简化版
- 今天（2026-04-01）恰好在彩蛋窗口期（April 1-7），启动时会看到彩虹色的 `/buddy` 提示

---

## 5. Buddy 功能说明

### 5.1 宠物物种（18 种）

| 物种 | ASCII 脸 | 说明 |
|------|---------|------|
| duck | `(·>` | 鸭子 |
| goose | `(·>` | 鹅 |
| blob | `(··)` | 团子 |
| cat | `=·ω·=` | 猫 |
| dragon | `<·~·>` | 龙 |
| octopus | `~(··)~` | 章鱼 |
| owl | `(·)(·)` | 猫头鹰 |
| penguin | `(·>)` | 企鹅 |
| turtle | `[·_·]` | 乌龟 |
| snail | `·(@)` | 蜗牛 |
| ghost | `/··\` | 幽灵 |
| axolotl | `}·.·{` | 六角恐龙 |
| capybara | `(·oo·)` | 水豚 |
| cactus | `\|· ·\|` | 仙人掌 |
| robot | `[··]` | 机器人 |
| rabbit | `(·..·)` | 兔子 |
| mushroom | `\|· ·\|` | 蘑菇 |
| chonk | `(·.·)` | 胖猫 |

### 5.2 稀有度

| 稀有度 | 概率 | 星级 | 帽子 | 属性下限 |
|--------|------|------|------|---------|
| Common | 60% | ★ | 无 | 5 |
| Uncommon | 25% | ★★ | 随机 | 15 |
| Rare | 10% | ★★★ | 随机 | 25 |
| Epic | 4% | ★★★★ | 随机 | 35 |
| Legendary | 1% | ★★★★★ | 随机 | 50 |

### 5.3 帽子（8 种）

| 帽子 | ASCII |
|------|-------|
| none | (无) |
| crown | `\^^^/` |
| tophat | `[___]` |
| propeller | `-+-` |
| halo | `(   )` |
| wizard | `/^\` |
| beanie | `(___)` |
| tinyduck | `,>` |

### 5.4 眼睛（6 种）

`·` `✦` `×` `◉` `@` `°`

### 5.5 属性

每只宠物有 5 个属性（0-100），其中一个是高属性，一个是低属性：

- **DEBUGGING** — 调试能力
- **PATIENCE** — 耐心
- **CHAOS** — 混乱值
- **WISDOM** — 智慧
- **SNARK** — 毒舌

### 5.6 闪光（Shiny）

1% 概率获得闪光版本。

---

## 6. MiniMax API 验证记录

在开发过程中顺便验证了 MiniMax API 的可用性，为后续集成做准备。

### 6.1 API 基本信息

| 项目 | 值 |
|------|------|
| 端点 | `https://api.minimax.chat/v1/text/chatcompletion_v2` |
| OpenAI 兼容端点 | `https://api.minimax.chat/v1/chat/completions` |
| 认证方式 | `Authorization: Bearer $MINIMAX_API_KEY` |
| 可用模型 | `MiniMax-M2.7` |
| Tool Calling | ✅ 支持（OpenAI 格式） |
| Reasoning | ✅ 自带思考链 (`reasoning_content`) |

### 6.2 验证命令

```bash
# 基础对话测试
curl -s https://api.minimax.chat/v1/text/chatcompletion_v2 \
  -H "Authorization: Bearer $MINIMAX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [{"role": "user", "content": "hello"}],
    "max_tokens": 50
  }'

# Tool Calling 测试
curl -s https://api.minimax.chat/v1/text/chatcompletion_v2 \
  -H "Authorization: Bearer $MINIMAX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [{"role": "user", "content": "what is the weather in tokyo?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {"type": "string"}
          },
          "required": ["city"]
        }
      }
    }],
    "max_tokens": 200
  }'
```

### 6.3 Tool Calling 响应示例

```json
{
  "choices": [{
    "finish_reason": "tool_calls",
    "message": {
      "tool_calls": [{
        "id": "call_function_...",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"city\": \"Tokyo\"}"
        }
      }],
      "reasoning_content": "The user is asking about the weather..."
    }
  }]
}
```

---

## 7. MiniMax Provider 集成（已完成）

### 7.1 设计思路

**问题**：Claude Code 的 API 层（3000+ 行的 `claude.ts`）深度绑定了 Anthropic SDK 格式。直接替换意味着重写大量代码。

**解决方案**：**Adapter 模式**——在 API 调用的最上层拦截，当检测到 MiniMax provider 时，走一条完全独立的请求/响应路径。关键洞察是：

```
Claude Code 下游代码（工具执行、UI 渲染、消息管理）
  ↑ 只关心 Anthropic 的 BetaRawMessageStreamEvent 格式
  ↑ 不关心事件是从 Anthropic API 还是 MiniMax API 来的
```

所以只要把 MiniMax 的 OpenAI 格式响应**伪装成** Anthropic 格式，下游完全不需要改。

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude Code    │     │   Adapter       │     │  MiniMax API    │
│  (claude.ts)    │ ←── │   (adapter.ts)  │ ←── │  (OpenAI 格式)  │
│                 │     │                 │     │                 │
│ 期望 Anthropic  │     │ OpenAI → Anthro │     │ 返回 OpenAI    │
│ 事件格式        │     │ 格式转换        │     │ 事件格式        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 7.2 格式转换细节

**工具定义转换**（`convertToolsToOpenAI`）：

```
Anthropic:  { name, description, input_schema: {...} }
     ↓
OpenAI:     { type:'function', function:{ name, description, parameters: {...} } }
```

`input_schema` 和 `parameters` 内容完全相同，只是外层包装不同。

**消息转换**（`convertMessagesToOpenAI`）：

```
Anthropic content blocks:
  [{ type:'text', text:'...' }, { type:'tool_use', id, name, input }]
     ↓
OpenAI message:
  { content:'...', tool_calls:[{ id, function:{ name, arguments:'...' } }] }

Anthropic tool_result:
  { role:'user', content:[{ type:'tool_result', tool_use_id, content }] }
     ↓
OpenAI tool message:
  { role:'tool', tool_call_id, content }
```

**流式事件转换**（`parseOpenAIStreamChunk`）：

```
OpenAI SSE:
  data: {"choices":[{"delta":{"content":"Hello"}}]}
  data: {"choices":[{"delta":{"tool_calls":[...]}}]}
  data: {"choices":[{"finish_reason":"stop"}]}
     ↓
Anthropic events:
  { type:'message_start', message:{...} }
  { type:'content_block_start', index:0, content_block:{type:'text'} }
  { type:'content_block_delta', index:0, delta:{type:'text_delta', text:'Hello'} }
  { type:'content_block_stop', index:0 }
  { type:'message_delta', delta:{stop_reason:'end_turn'} }
  { type:'message_stop' }
```

**stop_reason 映射**：

| OpenAI finish_reason | Anthropic stop_reason |
|----------------------|-----------------------|
| `stop` | `end_turn` |
| `length` | `max_tokens` |
| `tool_calls` | `tool_use` |
| `content_filter` | `end_turn` |

### 7.3 代码结构

```
src/services/api/minimax/
├── adapter.ts          # 格式转换层（320 行）
│   ├── convertToolsToOpenAI()       — 工具定义转换
│   ├── convertMessagesToOpenAI()     — 消息转换
│   ├── convertSystemPromptToOpenAI() — 系统提示词转换
│   ├── parseOpenAIResponse()         — 非流式响应 → Anthropic 事件
│   └── parseOpenAIStreamChunk()      — 流式 chunk → Anthropic 事件
│
├── client.ts           # MiniMax API 客户端（180 行）
│   ├── getMinimaxConfig()           — 从环境变量读配置
│   ├── buildMinimaxRequest()        — 构建请求体
│   ├── streamMinimaxRequest()       — 流式请求（核心入口）
│   ├── callMinimaxNonStreaming()    — 非流式请求
│   └── parseSSEStream()             — SSE 文本流解析器
│
├── adapter.test.ts     # 16 个单元测试
└── client.test.ts      # 7 个集成测试（含真实 API 调用）
```

### 7.4 修改的已有文件

**`src/utils/model/providers.ts`**（2 行改动）：

```diff
-export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'
+export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'minimax'

 export function getAPIProvider(): APIProvider {
-  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
+  return isEnvTruthy(process.env.CLAUDE_CODE_USE_MINIMAX)
+    ? 'minimax'
+    : isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
```

**`src/services/api/claude.ts`**（在 `queryModel()` 开头插入 ~45 行）：

在 `queryModel()` 函数最开始检查 `getAPIProvider() === 'minimax'`，如果是就：
1. 动态导入 `minimax/client.ts`
2. 从内部 Message 类型提取 API 消息
3. 提取工具的 JSON schema
4. 调用 `streamMinimaxRequest()` 获取 Anthropic 格式事件流
5. yield 所有事件给下游
6. return（跳过整个 Anthropic 调用链）

### 7.5 TDD 测试覆盖

**adapter.test.ts**（16 个测试）：

| 测试组 | 数量 | 覆盖内容 |
|--------|------|---------|
| `convertToolsToOpenAI` | 3 | 正常转换、空数组、undefined |
| `convertMessagesToOpenAI` | 4 | 简单消息、text blocks、tool_use、tool_result |
| `convertSystemPromptToOpenAI` | 3 | 字符串、数组 blocks、空值 |
| `parseOpenAIResponse` | 3 | 纯文本、tool_calls、finish_reason 映射 |
| `parseOpenAIStreamChunk` | 3 | text delta、tool_calls delta、finish chunk |

**client.test.ts**（7 个测试）：

| 测试组 | 数量 | 覆盖内容 |
|--------|------|---------|
| `getMinimaxConfig` | 1 | 环境变量读取 |
| `buildMinimaxRequest` | 3 | 基础请求、带工具、空工具 |
| `MiniMax API integration` | 3 | 非流式调用、流式调用、tool calling（需要真实 API Key） |

**运行测试**：
```bash
# 运行所有 MiniMax 测试
bun test src/services/api/minimax/

# 输出：23 pass, 0 fail
```

### 7.6 如何使用

```bash
# 进入 worktree 目录
cd /home/keitenarch/workspace/test_claude/claude-code-buddy

# 设置环境变量
export CLAUDE_CODE_USE_MINIMAX=1          # 启用 MiniMax provider
export MINIMAX_API_KEY="你的key"           # MiniMax API Key

# 可选：自定义模型和端点
export MINIMAX_MODEL="MiniMax-M2.7"        # 默认值
export MINIMAX_BASE_URL="https://api.minimax.chat/v1"  # 默认值

# 管道模式测试
echo "你好" | bun run src/entrypoints/cli.tsx -p

# 交互模式
bun run dev
```

**验证确实在用 MiniMax**：在交互模式中问"你是什么模型？"，应该回答自己是 MiniMax 而不是 Claude。

---

## 8. 后续计划

| 任务 | 难度 | 状态 | 说明 |
|------|------|------|------|
| ~~MiniMax 替代主模型~~ | ~~高~~ | ✅ 已完成 | adapter 模式 + 23 个测试 |
| Buddy 用 MiniMax 生成性格 | 中 | 待做 | 替换硬编码的名字/性格为 MiniMax API 调用 |
| Buddy 对话能力 | 中 | 待做 | 让宠物用 MiniMax 回应用户 |
| 支持更多 MiniMax 模型 | 低 | 待做 | M2.5-highspeed 等 |
| 精灵图动画优化 | 低 | 待做 | 添加更多交互动效 |

---

## 附录：完整文件变更清单

```
# BUDDY 功能
modified:   src/entrypoints/cli.tsx               # 开启 BUDDY feature flag
modified:   src/commands/buddy/index.ts           # 替换 stub 为命令注册
new file:   src/commands/buddy/buddy.tsx          # 命令实现（160 行）

# MiniMax Provider
new file:   src/services/api/minimax/adapter.ts   # 格式转换层（320 行）
new file:   src/services/api/minimax/client.ts    # API 客户端（180 行）
new file:   src/services/api/minimax/adapter.test.ts  # 16 个单元测试
new file:   src/services/api/minimax/client.test.ts   # 7 个集成测试
modified:   src/utils/model/providers.ts          # 添加 'minimax' provider
modified:   src/services/api/claude.ts            # queryModel() 添加 MiniMax 路由

# 文档
new file:   BUDDY_DEV_GUIDE.md                    # 本文档
```
