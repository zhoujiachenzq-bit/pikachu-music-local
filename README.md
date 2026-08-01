# 音乐小屋

一个可在本机运行或用容器部署的全栈音乐播放器。界面参考原“皮卡丘的音乐站”，增加本地账户、SQLite 持久化、收藏、自建歌单、四源公开歌单导入、手动同步和 JSON 备份恢复。

当前版本：`v0.1`。这是首个可用版本，包含本地账户、四源搜索与歌单导入、收藏持久化、歌词时间定位和霓虹交互动效。

## 启动

环境要求：Node.js 24+、pnpm。

在 Windows PowerShell 中可直接运行：

```powershell
.\run-dev.ps1
```

开发地址为 `http://127.0.0.1:5173`，API 为 `http://127.0.0.1:3000`。

构建并以生产模式启动：

```powershell
.\run-start.ps1
```

生产地址为 `http://127.0.0.1:3000`。也可在已配置 Node/pnpm 的环境中使用：

```text
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

## 使用说明

- 首次打开时创建本地账户。用户名 2–24 位，密码 8–72 位；登录状态保留 30 天。
- 在左侧同时选择咪咕、网易云、QQ、酷我进行搜索。播放地址按需解析，不写入数据库。
- 在右侧“自建歌单”中创建歌单或导入公开歌单。粘贴完整链接时会自动识别平台；只输入数字 ID 时先选择平台。
- 已导入的同一歌单再次导入或点击同步会更新来源歌曲，同时保留本地添加及手动排除项。
- “备份”会导出当前账户的收藏、歌单和设置，不包含密码或会话；恢复采用不删除现有数据的幂等合并。

常见链接格式：

```text
咪咕    https://music.migu.cn/v3/music/playlist/221731526
网易云  https://music.163.com/playlist?id=3778678
QQ      https://y.qq.com/n/ryqq/playlist/7011264340
酷我    https://www.kuwo.cn/playlist_detail/2095581898
```

## 本地数据与安全

- SQLite 数据库位于 `data/pikachu-music.sqlite`；`data/` 已加入 `.gitignore`。
- 密码使用随机盐和 `scrypt` 哈希；会话 Cookie 为 HTTP-only、SameSite=Strict。
- 本地运行默认只绑定 `127.0.0.1`；容器部署通过 `HOST=0.0.0.0` 接收平台反向代理流量，生产 Cookie 仅通过 HTTPS 发送。
- 歌单链接仅允许四个平台的域名，短链接最多跟随四次且每一跳都重新校验域名，避免访问本机或任意网络地址。
- 不读取平台账户 Cookie，不支持私人歌单、付费或 DRM 内容，也不会绕过会员限制。

第三方公开接口可能临时限流或变化。每个平台适配器均独立设置超时、单次重试和错误报告，单一来源故障不会影响本地资料或其他来源。

## 部署到 Render

仓库内已经包含 `Dockerfile` 和 `render.yaml`。由于账户、收藏和歌单保存在 SQLite，部署必须挂载持久磁盘；Render 的免费 Web Service 没有持久磁盘，不能满足本项目的数据持久化要求。

1. 登录 Render，并连接保存此项目的 GitHub 账户。
2. 新建 Blueprint，选择 `zhoujiachenzq-bit/pikachu-music-local` 仓库。
3. 检查预览中的 `Starter` Web Service 和 1 GB `pikachu-data` 磁盘，确认费用后创建。
4. 等待健康检查通过，打开 Render 分配的 HTTPS 地址。

Blueprint 会在 GitHub 检查通过后自动部署 `main` 分支，并将数据库保存到 `/var/data/pikachu-music.sqlite`。首次打开公网地址时注册站内账户即可。若以后绑定自定义域名，可选设置 `APP_ORIGIN=https://你的域名`；多个域名用英文逗号分隔。

上线前建议先在本地账户菜单导出 JSON 备份。公开部署只支持四个平台无需登录的公开内容，平台接口是否允许数据中心网络访问仍取决于对方当时的策略。

## 项目结构

```text
src/client/   React 界面、播放器、歌词与响应式样式
src/server/   Fastify API、SQLite、认证、四源适配器与导入任务
src/shared/   前后端共享类型
public/       本地静态素材
```
