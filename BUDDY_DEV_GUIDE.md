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

## 7. 后续计划

| 任务 | 难度 | 说明 |
|------|------|------|
| Buddy 用 MiniMax 生成性格 | 中 | 替换硬编码的名字/性格为 MiniMax API 调用 |
| MiniMax 替代主模型 | 高 | 需要适配 Anthropic→OpenAI 消息格式转换层 |
| Buddy 对话能力 | 中 | 让宠物用 MiniMax 回应用户（独立于主对话） |
| 精灵图动画优化 | 低 | 已有 3 帧动画，可添加更多交互动效 |

### 接入 MiniMax 的技术难点

Claude Code 的 API 层（`src/services/api/claude.ts`）深度绑定了 Anthropic SDK 格式：
- Anthropic: `content: [{type: 'tool_use', id, name, input}]`
- OpenAI/MiniMax: `tool_calls: [{id, type: 'function', function: {name, arguments}}]`

需要写一个格式转换层（adapter），或者直接在 API 客户端加 MiniMax provider。

---

## 附录：文件变更清单

```
modified:   src/entrypoints/cli.tsx        # 开启 BUDDY feature flag
modified:   src/commands/buddy/index.ts    # 替换 stub 为命令注册
new file:   src/commands/buddy/buddy.tsx   # 命令实现（160 行）
new file:   BUDDY_DEV_GUIDE.md            # 本文档
```
