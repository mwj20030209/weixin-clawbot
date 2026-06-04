<div align="center">

# 🤖 微信 ClawBot 管理面板

**基于微信 iLink API 的多 Bot 管理系统，支持 AI 自动回复、人设定制、多模型切换**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)](https://nodejs.org)
[![Vue3](https://img.shields.io/badge/Vue-3-42b883?logo=vue.js)](https://vuejs.org)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-blue?logo=mysql)](https://mysql.com)
[![License](https://img.shields.io/badge/license-MIT-orange)](LICENSE)

</div>

---

## ✨ 功能特性

- 🤖 **多 Bot 管理** — 同时管理多个微信 Bot，扫码登录即用
- 💬 **AI 自动回复** — 接入任意 OpenAI 兼容接口（DeepSeek / OpenAI / DusAPI 等）
- 🎭 **人设系统** — 可复用的 AI 人设模板库，支持 AI 从聊天记录自动生成人设
- 📨 **多段发送** — 拟人化将长回复拆分成多条消息，随机间隔模拟真人打字
- 👥 **用户管理** — 管理员 / 普通用户角色分离
- 📊 **聊天记录** — 可查看每个 Bot 与用户的完整聊天历史
- 📱 **全端适配** — PC 端 / 手机端均可正常使用

---

## 🖼️ 截图预览

> 可在此放置项目截图

---

## 🗂️ 项目结构

```
weixin-ClawBot/
├── server.js              # 后端主文件（Express + MySQL）
├── config.json            # 配置文件（需自行创建，见下方说明）
├── config.example.json    # 配置文件示例
├── package.json
├── frontend/              # Vue3 前端
│   ├── src/
│   ├── .env.production.example   # 生产环境变量示例
│   └── vite.config.js
└── README.md
```

---

## 🚀 快速开始

### 前置要求

| 环境 | 版本要求 |
|------|---------|
| Node.js | ≥ 18 |
| MySQL | 5.7 / 8.0 均可 |
| npm | ≥ 9 |

---

### 第一步：克隆项目

```bash
git clone https://github.com/你的用户名/weixin-ClawBot.git
cd weixin-ClawBot
```

---

### 第二步：创建数据库

#### Windows（使用 MySQL Workbench 或命令行）

```sql
CREATE DATABASE weixin_clawbot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'clawbot'@'localhost' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON weixin_clawbot.* TO 'clawbot'@'localhost';
FLUSH PRIVILEGES;
```

#### macOS / Linux

```bash
mysql -u root -p
```
```sql
CREATE DATABASE weixin_clawbot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'clawbot'@'localhost' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON weixin_clawbot.* TO 'clawbot'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> **macOS 提示**：如果 `mysql` 命令不可用，可使用 `mysql.server start` 启动服务，或通过系统偏好设置启动 MySQL。

---

### 第三步：建表

在 MySQL 中执行以下 SQL（可在 Workbench、宝塔 phpMyAdmin、Navicat 等工具中执行）：

```sql
CREATE TABLE IF NOT EXISTS bots (
  id          VARCHAR(36)  PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  persona     TEXT,
  persona_id  INT NULL,
  gender      VARCHAR(10)  DEFAULT 'unknown',
  created_by  INT NULL,
  token       TEXT,
  base_url    VARCHAR(500),
  login_time  BIGINT,
  status      VARCHAR(50)  DEFAULT 'offline',
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_histories (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  bot_id     VARCHAR(36)  NOT NULL,
  user_id    VARCHAR(255) NOT NULL,
  role       VARCHAR(20)  NOT NULL,
  content    TEXT         NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bot_user (bot_id, user_id),
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS personas (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  content    TEXT         NOT NULL,
  is_default TINYINT(1)   DEFAULT 0,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  base_url   VARCHAR(500) NOT NULL,
  api_key    TEXT         NOT NULL,
  model      VARCHAR(255) NOT NULL,
  prompt     TEXT,
  is_active  TINYINT(1)   DEFAULT 0,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  content    TEXT         NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(100) NOT NULL UNIQUE,
  password       VARCHAR(255) NOT NULL,
  password_plain VARCHAR(255) DEFAULT '',
  role           ENUM('admin','user') DEFAULT 'user',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

### 第四步：配置文件

复制示例配置并填入你的信息：

```bash
cp config.example.json config.json
```

编辑 `config.json`：

```json
{
  "mysql": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "clawbot",
    "password": "你的数据库密码",
    "database": "weixin_clawbot"
  },
  "provider": "deepseek",
  "providers": {
    "deepseek": {
      "api_key": "sk-你的DeepSeek密钥",
      "base_url": "https://api.deepseek.com",
      "model": "deepseek-chat",
      "prompt": "你是一个友好的助手，请用中文简洁回复。"
    }
  }
}
```

> ⚠️ `config.json` 已加入 `.gitignore`，不会被提交到 Git，请妥善保管。

---

### 第五步：安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd frontend && npm install && cd ..
```

---

## 💻 本地开发运行

### 方式一：一键启动前后端（推荐）

```bash
npm run dev
```

- 后端：`http://localhost:8849`
- 前端：`http://localhost:5173`

### 方式二：分别启动

```bash
# 终端1：启动后端
node server.js

# 终端2：启动前端
cd frontend && npm run dev
```

> **默认管理员账号**：`1001` / `1001`（首次启动自动创建）

---

## 🌐 生产部署（宝塔面板 Linux）

### 1. 服务器环境准备

```bash
# 安装 Node.js 18+（宝塔面板 → 软件商店 → Node.js 版本管理器）
# 安装 PM2
npm install -g pm2
```

### 2. 上传项目文件

将以下文件上传到服务器（例如 `/www/wwwroot/wenixinclawbot/`）：

```
server.js
package.json
config.json          ← 上传你自己的（含真实配置）
frontend/dist/       ← 打包后的前端文件
```

### 3. 前端打包

在本地配置生产环境变量：

```bash
# 复制示例文件
cp frontend/.env.production.example frontend/.env.production

# 编辑，填入你的服务器地址
# VITE_API_BASE=http://你的服务器IP:8849
```

然后打包：

```bash
cd frontend && npm run build
```

将生成的 `frontend/dist/` 目录上传到服务器。

### 4. 服务器安装依赖并启动

```bash
cd /www/wwwroot/wenixinclawbot

# 安装生产依赖
npm install --production

# 用 PM2 启动
pm2 start server.js --name clawbot
pm2 save
pm2 startup  # 设置开机自启
```

### 5. 放行防火墙端口

宝塔面板 → **安全** → **防火墙** → 添加规则，放行 `8849` 端口（TCP）。

### 6. 访问

浏览器打开 `http://你的服务器IP:8849`，使用默认账号 `1001` / `1001` 登录。

---

## 🔧 常用命令

```bash
# 查看运行状态
pm2 list

# 查看日志
pm2 logs clawbot --lines 50

# 重启服务
pm2 restart clawbot

# 停止服务
pm2 stop clawbot
```

---

## 🪟 Windows 本地运行

1. 安装 [Node.js 18+](https://nodejs.org)
2. 安装 [MySQL 8.0](https://dev.mysql.com/downloads/installer/)
3. 按上方步骤创建数据库和配置文件
4. 在项目目录打开 PowerShell 或 CMD：

```cmd
npm install
cd frontend && npm install && cd ..
npm run dev
```

浏览器访问 `http://localhost:5173`

---

## 🍎 macOS 本地运行

```bash
# 安装 Node.js（推荐用 nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18 && nvm use 18

# 安装 MySQL（推荐用 Homebrew）
brew install mysql
brew services start mysql

# 进入项目
cd weixin-ClawBot
npm install
cd frontend && npm install && cd ..
npm run dev
```

---

## 🐧 Linux 本地运行

```bash
# 安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 MySQL
sudo apt-get install -y mysql-server
sudo systemctl start mysql

# 进入项目
cd weixin-ClawBot
npm install
cd frontend && npm install && cd ..
npm run dev
```

---

## ⚙️ 环境变量说明

| 变量 | 文件 | 说明 |
|------|------|------|
| `VITE_API_BASE` | `frontend/.env.production` | 生产环境后端地址，如 `http://1.2.3.4:8849` |
| `PORT` | 系统环境变量 | 后端监听端口，默认 `8849` |

---

## 🔑 AI 接口配置

系统支持任何 **OpenAI Chat Completions 兼容接口**：

| 服务商 | base_url | 获取密钥 |
|--------|---------|---------|
| DeepSeek | `https://api.deepseek.com` | [platform.deepseek.com](https://platform.deepseek.com) |
| OpenAI | `https://api.openai.com` | [platform.openai.com](https://platform.openai.com) |
| DusAPI | `https://api.dusapi.com` | [dusapi.com](https://dusapi.com) |
| 其他中转 | 自定义 | — |

> AI Provider 也可在管理面板 → **AI 配置** 中直接添加，无需修改配置文件。

---

## ❓ 常见问题

**Q: 启动报错 `Incorrect arguments to with cursor`**

A: MySQL 版本兼容性问题，确保使用最新版 `server.js`，该问题已修复（所有 DDL 语句使用 `db.query()` 而非 `db.execute()`）。

**Q: 前端接口报 404 / CORS 错误**

A: 检查 `frontend/.env.production` 中的 `VITE_API_BASE` 是否指向正确的后端地址，并重新执行 `npm run build`。

**Q: 登录提示"未登录或会话已过期"**

A: Token 过期，重新登录即可。若频繁出现，检查服务器时间是否准确。

**Q: 宝塔面板无法访问 8849 端口**

A: 需要在宝塔**安全 → 防火墙**放行 8849 端口，同时确认云服务商控制台（阿里云/腾讯云等）的安全组也已放行。

---

## 📄 License

[MIT](LICENSE)

---

<div align="center">
如果对你有帮助，欢迎 ⭐ Star 支持！
</div>
