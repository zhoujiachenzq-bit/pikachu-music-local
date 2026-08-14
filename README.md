# 音乐小屋

一个可在本机运行或用容器部署的全栈音乐播放器。界面参考原“皮卡丘的音乐站”，增加本地账户、SQLite 持久化、收藏、自建歌单、四源公开歌单导入、手动同步和 JSON 备份恢复。

当前开发版本：`v0.2.1（草稿）`。在 v0.2.0 的每日推荐与备用音源基础上，保持开放注册体验并加入分层限流、安全响应头、严格备份校验、第三方响应上限和容器健康检查。继续支持 Android 后台播放、PWA、精确歌词定位和三种播放模式。

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
- 公开注册默认保留，但同一 IP 每天最多注册 3 个账户，全站每小时最多注册 20 个；触发限制时只要求稍后重试，不改变正常注册步骤。
- 登录、搜索、播放解析、导入、推荐和备份使用相互独立的账户/IP配额；限流状态保存在 SQLite，服务重启不会绕过冷却时间。
- 生产环境必须让应用正确识别真实客户端 IP。自建 Caddy/Docker 推荐设置 `TRUST_PROXY=实际代理IP或CIDR`，例如确认网络范围后设置 `TRUST_PROXY=172.17.0.0/16,127.0.0.1/8`；不要设置 `TRUST_PROXY=true`。只有一个受控代理跳数的平台可设置 `TRUST_PROXY_HOPS=1`。
- 歌单链接仅允许四个平台的域名，短链接最多跟随四次且每一跳都重新校验域名，避免访问本机或任意网络地址。
- 不读取平台账户 Cookie，不支持私人歌单、付费或 DRM 内容，也不会绕过会员限制。

默认资源配额可通过环境变量微调：

| 功能 | 默认值 | 环境变量 |
| --- | ---: | --- |
| 同 IP 注册 | 3 个/天 | `RATE_REGISTER_IP_DAILY` |
| 全站注册 | 20 个/小时 | `RATE_REGISTER_GLOBAL_HOURLY` |
| 单账户登录 | 5 次/15 分钟 | `RATE_LOGIN_ACCOUNT_15M` |
| 单 IP 登录 | 30 次/15 分钟 | `RATE_LOGIN_IP_15M` |
| 单账户搜索 | 30 次/分钟 | `RATE_SEARCH_USER_MINUTE` |
| 单账户解析 | 20 次/分钟 | `RATE_RESOLVE_USER_MINUTE` |
| 单账户导入/同步 | 10 次/天；新账户首日 3 次 | `RATE_IMPORT_USER_DAILY` |
| 单次导入 | 2000 首 | `MAX_IMPORT_TRACKS` |

生产容器还建议在启动参数中加入 `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --memory 512m --pids-limit 200`。数据库卷 `/var/data` 保持可写，备份文件应保存到未挂载进应用容器的 root 专用目录并设置为 `600` 权限。

腾讯云现有服务器升级可使用 [deploy/tencent-v0.2.1.sh](deploy/tencent-v0.2.1.sh)，完整的防火墙、SSH、备份和回滚准备见 [deploy/TENCENT_SECURITY.md](deploy/TENCENT_SECURITY.md)。脚本不会修改 Caddy 或 SSH，并会保留旧应用容器供验收后回滚。

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

## 可选备用音源

项目可以把 `go-music-api` 作为最后一级备用解析服务。原有四源和内置跨源匹配仍然优先，备用服务不可用时不会影响本地收藏、歌单或其他来源。

Windows 首次安装运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup-go-music-api.ps1
```

脚本会校验 Go 官方压缩包的 SHA-256，固定检出 `go-music-api v1.0.1`，并将其修改为只监听 `127.0.0.1:8080` 后在 `data/tools/` 下本地编译。之后桌面快捷方式、`run-start.ps1` 和 `run-dev.ps1` 会自动启动并配置备用服务。

其他运行环境可设置 `GO_MUSIC_API_URL=http://受信任的内部服务:8080`；不要把原版 `go-music-api` 的 8080 端口直接暴露到公网。该第三方项目采用 AGPL-3.0，独立部署和修改时需遵守其许可证。
