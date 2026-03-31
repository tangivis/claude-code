# Claude Code 源码版 —— 从零开始的详细启动指南

> 面向技术小白，每一步都有详细解释。即使你从没用过终端/命令行，也能跟着做。

---

## 目录

1. [你需要准备什么](#1-你需要准备什么)
2. [第一步：安装 Bun](#第一步安装-bun)
3. [第二步：获取源码](#第二步获取源码)
4. [第三步：安装依赖](#第三步安装依赖)
5. [第四步：配置 API Key](#第四步配置-api-key)
6. [第五步：运行 Claude Code](#第五步运行-claude-code)
7. [第六步：构建（可选）](#第六步构建可选)
8. [常见问题](#常见问题)

---

## 1. 你需要准备什么

在开始之前，确认你有以下东西：

| 需要什么 | 说明 |
|----------|------|
| **一台电脑** | macOS、Linux 或 Windows（推荐 macOS/Linux） |
| **终端/命令行** | macOS 用"终端"app，Windows 用 WSL 或 Git Bash，Linux 用自带终端 |
| **网络连接** | 需要访问互联网下载工具和调用 API |
| **Anthropic API Key** | 用来调用 Claude AI 的"钥匙"（下面会教你怎么获取） |

### 什么是终端？

终端就是那个黑色（或白色）背景、可以输入文字命令的窗口。你在里面输入命令，电脑就会执行。

- **macOS**: 按 `Cmd + 空格`，输入"终端"或"Terminal"，回车打开
- **Linux**: 按 `Ctrl + Alt + T` 打开
- **Windows**: 推荐先安装 [WSL](https://learn.microsoft.com/zh-cn/windows/wsl/install)（Windows 下的 Linux 环境），然后在 WSL 终端里操作

打开终端后，你会看到类似这样的提示符：

```
$ _
```

`$` 后面是你输入命令的地方。本文档中所有以 `$` 开头的行都是要你输入的命令（不要输入 `$` 本身）。

---

## 第一步：安装 Bun

### Bun 是什么？

Bun 是一个 JavaScript/TypeScript 运行工具（类似 Node.js，但更快）。Claude Code 源码需要用 Bun 来运行。

**一定要安装最新版本！** 旧版本会出各种奇怪的 bug。

### macOS / Linux 安装方法

在终端中输入以下命令（复制粘贴即可）：

```bash
$ curl -fsSL https://bun.sh/install | bash
```

**这条命令做了什么？**
- `curl` = 从网上下载东西的工具
- `https://bun.sh/install` = Bun 官方安装脚本的地址
- `| bash` = 下载完后自动执行安装

安装完成后，**关闭终端再重新打开**（这样新安装的命令才能生效），然后验证：

```bash
$ bun --version
```

如果看到一个版本号（比如 `1.3.11` 或更高），说明安装成功。

**如果版本低于 1.3.11**，运行升级命令：

```bash
$ bun upgrade
```

### Windows 安装方法

如果你用 WSL（推荐），在 WSL 终端里用上面的 macOS/Linux 方法安装。

如果不用 WSL，在 PowerShell 中运行：

```powershell
> powershell -c "irm bun.sh/install.ps1 | iex"
```

### 还需要 Node.js

部分依赖需要 Node.js（版本 18 以上）。检查是否已安装：

```bash
$ node --version
```

如果没有或版本太低，去 [Node.js 官网](https://nodejs.org/) 下载安装 LTS 版本。

### 还需要 Git

用来下载源码。检查是否已安装：

```bash
$ git --version
```

如果没有：
- **macOS**: 输入 `xcode-select --install`
- **Linux**: 输入 `sudo apt install git`（Ubuntu/Debian）或 `sudo pacman -S git`（Arch）
- **Windows**: 去 [Git 官网](https://git-scm.com/) 下载

---

## 第二步：获取源码

### 方法 A：用 Git 克隆（推荐）

```bash
$ git clone https://github.com/anthropics/claude-code.git
$ cd claude-code
```

**这两条命令做了什么？**
1. `git clone ...` = 从 GitHub 下载项目的完整源码到你电脑上，会创建一个叫 `claude-code` 的文件夹
2. `cd claude-code` = 进入这个文件夹（cd = change directory，切换目录）

> 注意：如果这个仓库被删除了，你可能需要从其他来源获取。README 中提到"fork 不好使，git clone 或者下载 .zip 包才稳健"。

### 方法 B：下载 ZIP 包

1. 在浏览器中打开项目的 GitHub 页面
2. 点击绿色的 "Code" 按钮
3. 选择 "Download ZIP"
4. 下载后解压
5. 在终端中进入解压后的目录：

```bash
$ cd 你解压的路径/claude-code
```

### 确认你在正确的目录

输入以下命令：

```bash
$ ls
```

你应该看到这些文件：

```
CLAUDE.md          README.md          package.json       src/
RECORD.md          bun.lock           packages/          scripts/
tsconfig.json      ...
```

如果看到了 `package.json` 和 `src/`，说明你在正确的位置。

---

## 第三步：安装依赖

### 什么是依赖？

Claude Code 不是一个独立的程序——它依赖了很多其他人写的代码库（比如 Anthropic 的 SDK、React 等）。"安装依赖"就是把这些需要的代码库下载到项目里。

### 执行安装

```bash
$ bun install
```

**这条命令做了什么？**
- Bun 读取 `package.json` 文件（项目的"清单"），知道需要哪些依赖
- 从网上下载所有需要的代码库
- 把它们放到 `node_modules/` 目录里

这个过程需要一些时间（取决于网速），通常 10-60 秒。

成功后你会看到类似：

```
1137 packages installed [6.96s]
```

### 如果安装失败怎么办

**网络问题**：如果下载慢或失败，可能需要设置代理或镜像：

```bash
# 使用淘宝 npm 镜像（中国大陆用户）
$ bunx npm config set registry https://registry.npmmirror.com
$ bun install
```

**权限问题**：如果报 `EACCES` 权限错误：

```bash
$ sudo bun install
```

`sudo` = 以管理员身份运行（会要求输入你的电脑密码）。

---

## 第四步：配置 API Key

### 什么是 API Key？

API Key 就像一把"钥匙"——Claude Code 需要用它来调用 Anthropic 的 AI 服务。没有钥匙就无法与 AI 对话。

### 获取方式

你有以下几种选择：

#### 选项 A：Anthropic API Key（最直接）

1. 打开 [Anthropic Console](https://console.anthropic.com/)
2. 注册/登录账号
3. 进入 [API Keys 页面](https://console.anthropic.com/settings/keys)
4. 点击 "Create Key"
5. 复制生成的 key（以 `sk-ant-` 开头的一长串字符）

然后在终端中设置环境变量：

```bash
# macOS / Linux
$ export ANTHROPIC_API_KEY="sk-ant-你的key粘贴在这里"
```

**`export` 是什么意思？** 它设置了一个"环境变量"——一个所有程序都能读到的配置值。Claude Code 启动时会读取 `ANTHROPIC_API_KEY` 这个变量来获取你的 key。

**注意**：这种方式设置的环境变量在关闭终端后会失效。如果想永久生效：

```bash
# 写入到 shell 配置文件（永久生效）
# 如果你用的是 zsh（macOS 默认）：
$ echo 'export ANTHROPIC_API_KEY="sk-ant-你的key"' >> ~/.zshrc

# 如果你用的是 bash（Linux 默认）：
$ echo 'export ANTHROPIC_API_KEY="sk-ant-你的key"' >> ~/.bashrc

# 然后重新加载配置：
$ source ~/.zshrc   # 或 source ~/.bashrc
```

#### 选项 B：通过 OAuth 登录（如果你有 Claude 订阅）

如果你已经安装过官方版 Claude Code 并登录了（比如 Claude Pro/Max 订阅），认证信息会缓存在你的系统里。这个源码版可以自动读取这些缓存的认证信息，不需要额外设置 API Key。

你可以通过官方 Claude Code 登录：

```bash
# 用官方 claude 命令登录
$ claude login
```

登录后，源码版的 Claude Code 也能用同样的认证。

#### 选项 C：AWS Bedrock / Google Vertex / Azure

如果你用云厂商的 AI 服务：

**AWS Bedrock**：
```bash
$ export CLAUDE_CODE_USE_BEDROCK=1
# 确保 AWS 凭据已配置（~/.aws/credentials 或环境变量）
```

**Google Vertex**：
```bash
$ export CLAUDE_CODE_USE_VERTEX=1
$ export CLOUD_ML_REGION="us-east5"
$ export ANTHROPIC_VERTEX_PROJECT_ID="你的项目ID"
```

---

## 第五步：运行 Claude Code

现在到了激动人心的时刻——启动 Claude Code！

### 方式 1：快速测试（管道模式）

先用最简单的方式测试是否能正常工作：

```bash
$ echo "say hello" | bun run src/entrypoints/cli.tsx -p
```

**这条命令做了什么？**
- `echo "say hello"` = 输出文字 "say hello"
- `|` = 管道符，把左边的输出送给右边的程序
- `bun run src/entrypoints/cli.tsx` = 用 Bun 运行 Claude Code 的入口文件
- `-p` = pipe（管道）模式，不进入交互界面，直接输出结果

如果一切正常，你会看到 AI 的回复，比如：

```
Hello! How can I help you today?
```

**如果报错了**，跳到下面的[常见问题](#常见问题)。

### 方式 2：查看版本号

```bash
$ bun run src/entrypoints/cli.tsx --version
```

应该输出：

```
2.1.888 (Claude Code)
```

看到 `888` 说明源码版运行正确。

### 方式 3：交互模式（完整体验）

```bash
$ bun run dev
```

**这条命令做了什么？**
- `bun run dev` = 运行 `package.json` 里定义的 `dev` 脚本
- 实际上等价于 `bun run src/entrypoints/cli.tsx`
- 会启动完整的交互式终端界面（REPL）

启动后你会看到一个交互界面，可以直接输入问题和 Claude AI 对话：

```
╭─────────────────────────────────────────╮
│ Claude Code                             │
│ Model: claude-opus-4-6                  │
╰─────────────────────────────────────────╯

> _
```

**在交互界面中你可以：**
- 直接输入问题，回车发送
- 输入 `/help` 查看所有可用命令
- 输入 `/exit` 或按 `Ctrl + C` 退出
- 输入 `/model` 切换模型（如 sonnet、haiku）
- 输入 `/cost` 查看已消耗的 API 费用

### 方式 4：指定模型运行

```bash
# 使用 Sonnet 模型（更快更便宜）
$ echo "你好" | bun run src/entrypoints/cli.tsx -p --model sonnet

# 使用 Haiku 模型（最快最便宜）
$ echo "你好" | bun run src/entrypoints/cli.tsx -p --model haiku
```

### 方式 5：让 AI 处理文件

```bash
# 让 AI 读取并解释一个文件
$ echo "解释这个文件的作用" | bun run src/entrypoints/cli.tsx -p README.md
```

---

## 第六步：构建（可选）

### 什么是构建？

"构建"就是把很多源码文件打包成一个可以直接运行的文件。日常开发不需要构建（用 `bun run dev` 就行），但如果你想：

- 把 Claude Code 部署到其他地方
- 获得更快的启动速度
- 生成一个可分发的程序

就需要构建。

### 执行构建

```bash
$ bun run build
```

成功后你会看到：

```
Bundled 5326 modules in 491ms
  cli.js  25.74 MB  (entry point)
```

构建产物在 `dist/cli.js`——一个 25MB 的单文件。

### 运行构建产物

```bash
$ bun dist/cli.js --version
```

---

## 常见问题

### Q1: `bun: command not found`

Bun 没安装成功或终端没刷新。解决：
```bash
# 重新安装
$ curl -fsSL https://bun.sh/install | bash
# 重新打开终端，再试
```

### Q2: `bun install` 报网络错误

可能是网络问题。尝试：
```bash
# 设置超时更长
$ bun install --timeout 120000

# 或使用代理
$ export https_proxy=http://你的代理地址:端口
$ bun install
```

### Q3: 运行时报 `ANTHROPIC_API_KEY` 或认证错误

API Key 没有正确设置。检查：
```bash
# 查看是否设置了
$ echo $ANTHROPIC_API_KEY
```

如果输出为空，回到[第四步](#第四步配置-api-key)重新设置。

### Q4: 运行时报 `Cannot find module` 错误

依赖没装好。重新安装：
```bash
$ rm -rf node_modules    # 删除旧的依赖
$ bun install             # 重新安装
```

### Q5: `bun run dev` 后界面显示异常

可能是终端不支持。尝试：
- 使用更好的终端（推荐 iTerm2 / Warp / Windows Terminal）
- 确保终端窗口够大（至少 80 列宽）

### Q6: 运行很慢或经常超时

可能是模型太大或网络慢。尝试用更快的模型：
```bash
$ echo "hello" | bun run src/entrypoints/cli.tsx -p --model haiku
```

### Q7: 什么是 `bun run dev` 和 `bun run src/entrypoints/cli.tsx` 的区别？

没有区别。`bun run dev` 只是一个快捷方式，定义在 `package.json` 的 `scripts` 里：
```json
{
  "scripts": {
    "dev": "bun run src/entrypoints/cli.tsx"
  }
}
```

### Q8: 和官方 Claude Code 有什么区别？

这是官方版本的**源码逆向还原版**。主要区别：
- 源码可见，可以学习和修改
- 部分高级功能（语音、Computer Use 等）被关闭
- 版本号显示 `888`（官方版会显示正式版本号）
- 可能存在一些反编译导致的小 bug

### Q9: API 要花钱吗？

是的。每次调用 Claude API 都会消耗 token 计费。价格取决于使用的模型：
- **Opus**：最聪明但最贵
- **Sonnet**：平衡性价比（推荐日常使用）
- **Haiku**：最便宜最快

可以在交互界面中输入 `/cost` 查看当前会话已花费多少。

---

## 快速参考卡

```bash
# ===== 安装 =====
curl -fsSL https://bun.sh/install | bash    # 安装 Bun
git clone <repo-url>                         # 下载源码
cd claude-code                               # 进入目录
bun install                                  # 安装依赖

# ===== 配置 =====
export ANTHROPIC_API_KEY="sk-ant-..."        # 设置 API Key

# ===== 运行 =====
bun run dev                                  # 交互模式
echo "问题" | bun run src/entrypoints/cli.tsx -p   # 管道模式
bun run src/entrypoints/cli.tsx --version     # 查看版本

# ===== 交互模式常用命令 =====
/help          # 帮助
/model         # 切换模型
/cost          # 查看费用
/compact       # 压缩对话（对话太长时用）
/exit          # 退出

# ===== 构建 =====
bun run build                                # 构建单文件
bun dist/cli.js                              # 运行构建产物
```

---

*如有问题，可以在项目的 GitHub Issues 中提问。*
