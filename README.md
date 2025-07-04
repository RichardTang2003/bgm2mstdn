# BGM2MSTDN

一个自动将 Bangumi 上最新观看的番剧同步到 Mastodon 的工具。

## 功能特性

- 🎬 自动从 Bangumi 获取你最近标记为"看过"的番剧
- 📱 将番剧信息自动发布到 Mastodon
- 🖼️ 自动上传番剧封面图片
- ⏰ 支持定时任务，每天自动执行
- 💾 记录同步状态，避免重复发布
- 📝 支持同步你在 Bangumi 上的评论

## 安装步骤

### 1. 克隆项目

```bash
git clone <你的仓库地址>
cd bgm2mstdn
```

### 2. 安装依赖

首先请安装 [Node.js](https://nodejs.org/) 环境。

再安装项目依赖

```bash
npm install
```

### 3. 配置环境变量

创建 `.env` 文件并配置以下参数（复制 `.env.example` 文件作为模板）：

```bash
cp .env.example .env
```

然后编辑 `.env` 文件：

```env
# Bangumi 配置
BANGUMI_USERNAME=你的Bangumi用户名
BANGUMI_USER_AGENT=bgm2mstdn/1.0  # 可选

# Mastodon 配置
MASTODON_SERVER_URL=https://你的实例地址.com  # 注意：结尾不要带斜杠
MASTODON_ACCESS_TOKEN=你的访问令牌

# 定时任务配置
CRON_SCHEDULE=0 10 * * *  # 可选，默认每天上午10点执行
DISABLE_CRON=false  # 可选，设置为 true 禁用定时任务，默认为 false

# 其他配置
MAX_ITEMS=10  # 可选，每次获取的最大条目数，默认为10
```

### 4. 获取 Mastodon 访问令牌

1. 登录你的 Mastodon 实例
2. 进入 `设置` → `开发` → `应用程序`
3. 点击 `新建应用程序`
4. 填写应用信息，确保勾选以下权限：
   - `write:statuses` (发布状态)
   - `write:media` (上传媒体)
5. 创建后复制访问令牌到 `.env` 文件

## 使用方法

### 后台运行

项目启动后会自动设置定时任务，按照配置的时间定期执行。

```bash
node index.js
```

### 仅执行一次（不启用定时任务）

如果你只想执行一次同步而不启用定时任务（或者用其他软件实现定时任务），可以在 `.env` 文件中设置：

```env
DISABLE_CRON=true
```

然后运行：

```bash
node index.js
```

程序会执行一次同步后自动退出，不会设置定时任务。

### 定时任务表达式说明

使用标准的 cron 表达式格式：

- `0 9 * * *` - 每天上午9点
- `0 */6 * * *` - 每6小时执行一次
- `0 12 * * 0` - 每周日中午12点

## 发布内容格式

发布到 Mastodon 的内容格式如下：

```
看完一部番！

📺 番剧名称
✅ 完成于: 2025-07-04 15:30:00

💬 我的评论:
[你在 Bangumi 上的评论内容]

同步自 #Bangumi #番剧
```

## 文件说明

- `index.js` - 主程序文件
- `package.json` - 项目依赖配置
- `.env` - 环境变量配置（需要自己创建）
- `.env.example` - 环境变量配置示例文件
- `last_sync_time.log` - 记录最后同步时间的文件（自动生成）