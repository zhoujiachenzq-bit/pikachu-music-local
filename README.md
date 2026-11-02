# 音乐小屋

个人使用的电脑本地与 Android 音乐播放器，提供 SQLite 持久化、收藏、自建歌单、公开歌单导入、手动同步和 JSON 备份恢复。

当前版本：`v0.6.12`。Android 安装包内置 go-music-api，扩展多平台音源，不需要服务器或电脑。

v0.6.12 修复发现服务慢启动后的连接与歌单导入，补查网易云完整目录，不完整同步保留原歌曲；加入平台歌单推荐、优化本地推荐排序，并统一六主题控件、手机横滑与实心红心反馈。安卓支持系统文件备份和应用内恢复预览。

从 v0.6.12 起使用固定签名，之后保持相同签名与应用标识覆盖更新，以保留本机数据。旧 v0.6.11 及以前使用过一次性签名，首次切换不能保证直接覆盖；卸载会清除本地资料，请先确认迁移安排。

个人音乐操作不设频次配额：搜索、播放解析、导入同步、推荐、播放记录和备份均不限次数，前端不再因解析冷却阻止播放。网络超时、平台授权和失败重试上限仍按实际情况处理。

v0.6.10 修复 QQ 搜索和失败缓存，隔离音源故障；播放及音质查询检查实际音频字节，拒绝 JSON、网页等错误响应，并修正错误音频类型。Android 内置服务同步验证规则，千千搜索保留付费条目的真实目录信息，播放仍遵循平台授权。验证范围见 [音源检查与修复记录](docs/music-source-audit-2026-11-01.md)。

v0.6.9 新增“发现音乐”，支持歌单、专辑、分享链接、平台推荐和分类浏览，预览后可保存为本地歌单；手机本地模式提供平台扫码登录入口。QQ 搜索展示完整候选目录，实际播放仍取决于平台授权。账户修改密码改为页面内表单，并修正六主题配色。

v0.6.8 扩展酷狗、千千、5sing、Jamendo、JOOX、哔哩哔哩的搜索和公开音频播放入口，以及扩展平台的公开歌单导入。新增平台通过 go-music-api 接入；汽水仅提供导入入口，无单曲搜索或加密音频播放。平台授权、地区和接口可用性仍决定具体歌曲是否可播放。实现和验证范围见 [音源扩展记录](docs/android-sources-2026-10-31.md)。

## Android 安装包

每个版本的 [Release](https://github.com/zhoujiachenzq-bit/pikachu-music-local/releases) 都附带 `music-house-<版本>.apk`，在手机上下载后允许安装即可。App 内置完整的音乐服务，不需要服务器或电脑，也不用注册；收藏、歌单和播放记录只保存在这台手机上，卸载 App 后会清除。64 位手机内置 go-music-api，支持上述扩展音源；32 位手机只有网易云和酷我。

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
- 音乐操作已取消本地配额与播放冷却；账户注册与密码登录保留独立保护。
- 生产环境必须让应用正确识别真实客户端 IP。自建 Caddy/Docker 推荐设置 `TRUST_PROXY=实际代理IP或CIDR`，例如确认网络范围后设置 `TRUST_PROXY=172.17.0.0/16,127.0.0.1/8`；不要设置 `TRUST_PROXY=true`。只有一个受控代理跳数的平台可设置 `TRUST_PROXY_HOPS=1`。
- 歌单链接仅允许四个平台的域名，短链接最多跟随四次且每一跳都重新校验域名，避免访问本机或任意网络地址。
- 网页服务不开放平台账号登录；手机本地模式可扫码授权，平台凭据留在本机音源服务。播放遵循平台授权，不绕过会员限制或 DRM。

账户保护可通过环境变量微调：

| 功能 | 默认值 | 环境变量 |
| --- | ---: | --- |
| 同 IP 注册 | 3 个/天 | `RATE_REGISTER_IP_DAILY` |
| 全站注册 | 20 个/小时 | `RATE_REGISTER_GLOBAL_HOURLY` |
| 单账户登录 | 5 次/15 分钟 | `RATE_LOGIN_ACCOUNT_15M` |
| 单 IP 登录 | 30 次/15 分钟 | `RATE_LOGIN_IP_15M` |
| 单次导入 | 2000 首 | `MAX_IMPORT_TRACKS` |

生产容器还建议在启动参数中加入 `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --memory 512m --pids-limit 200`。数据库卷 `/var/data` 保持可写，备份文件应保存到未挂载进应用容器的 root 专用目录并设置为 `600` 权限。

腾讯云服务器的历史升级脚本在 `deploy/` 目录，新版本部署前需按对应版本更新脚本。脚本保留当前环境配置和网络，使用 SQLite 一致性备份及独立数据库副本验证候选，再切换正式容器；本地或公网校验失败会恢复旧容器。备份和旧镜像保留，不修改 Caddy、SSH 或本机模型配置。防火墙、SSH 和备份准备见 [deploy/TENCENT_SECURITY.md](deploy/TENCENT_SECURITY.md)。

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

项目可以把 `go-music-api` 作为备用解析服务。解析会先校准平台身份与时长，再尝试经验证的同平台 ID；确需跨源时仅接受原唱、歌手与时长均一致的候选。备用服务不可用时不会影响本地收藏、歌单或其他来源。

Windows 首次安装运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup-go-music-api.ps1
```

脚本会校验 Go 官方压缩包的 SHA-256，固定检出 `go-music-api v1.0.1`，并将其修改为只监听 `127.0.0.1:8080` 后在 `data/tools/` 下本地编译。之后桌面快捷方式、`run-start.ps1` 和 `run-dev.ps1` 会自动启动并配置备用服务。

其他运行环境可设置 `GO_MUSIC_API_URL=http://受信任的内部服务:8080`；不要把原版 `go-music-api` 的 8080 端口直接暴露到公网。该第三方项目采用 AGPL-3.0，独立部署和修改时需遵守其许可证。Android 安装包内含它的编译版本，以库的形式运行在 App 进程内，只监听 127.0.0.1，并增加了自检接口，源码见 https://github.com/guohuiyuan/go-music-api（v1.0.1），改动见 `.github/build-go-music-api.sh` 和 `.github/go-music-api-android.go`。
