# 音乐小屋

一个可在本机运行或用容器部署的全栈音乐播放器。界面参考原“皮卡丘的音乐站”，增加本地账户、SQLite 持久化、收藏、自建歌单、四源公开歌单导入、手动同步和 JSON 备份恢复。

当前开发版本：`v0.4.0-beta.1`（分支 `codex/v0.4.0-zhenqi-agent`）。线上稳定版仍保持 v0.3.1；本地开发版在 v0.3.2 音乐能力之上加入受控音乐知己“珍奇”，不会在本地验收前合并或部署。

## v0.4.0 珍奇开发流程

GitHub 同类项目的可取做法已经转换为本项目自己的确定性流程，而不是直接引入新的重型智能体框架：

1. **Beta 1A：真实歌曲与安全动作**——先验证自然语言意图、真实站内歌曲映射、严格原唱版本校验、流式对话、直接切歌与动作防重复。
2. **Beta 1B：可编辑预览**——推荐和歌单先形成情境队列/草案，播放是可逆操作；收藏、歌单、缓存与重新生成必须经过程序确认。
3. **Beta 2：最小记忆与知识**——先去重和识别冲突，再写入加密长期记忆；短时心情只在近期上下文中生效，不覆盖长期偏好。公共音乐知识与私密记忆分域检索。
4. **Beta 3：语音、主动陪伴与自动更新**——最后接入 ASR/TTS、联网引用、每天两次且间隔六小时的主动气泡，以及带 HMAC、校验和与回滚的知识发布。

推荐候选采用“用户意图 → 本地偏好/知识召回 → 四源真实歌曲搜索 → 衍生版本和身份校验 → 确定性排序 → 模型解释”的顺序。模型不能生成歌曲 ID 或音频地址；跳过、部分播放、完整播放、重听和时间衰减只作为排序信号，一次短期行为不会改写用户的稳定偏好。

珍奇配置模板见 `.env.example`。开发环境没有所选模型服务的密钥时会进入本地安全降级模式，暂停完整陪伴聊天、联网和语音，但切歌、找歌、推荐和诊断仍可工作，音乐小屋的其他功能完全不受影响。

### 可替换模型接口

珍奇的对话层采用类似 Hello-Agents 的“统一接口＋服务商适配器＋能力声明”结构，业务工具不直接依赖任何模型厂商。目前提供：

- `deepseek`：默认选择，使用 DeepSeek V4 Flash/Pro 负责文字对话、推理和受控工具规划。
- `bailian`：百炼 Qwen 对话模型；百炼的向量、联网、ASR 和 TTS 仍是彼此独立的辅助能力。
- `custom`：任何真正兼容 OpenAI Chat Completions 和工具调用协议的服务。
- `auto`：只在没有明确隐私路由要求时，按 DeepSeek、百炼、Custom 的固定顺序选择已经配置的服务。

显式设置 `AGENT_MODEL_PROVIDER=deepseek|bailian|custom` 后，目标服务不可用只会进入本地安全降级，不会把对话自动转发给另一家服务。站长可通过 `/api/admin/agent/providers` 查看脱敏后的选择状态、模型名与能力声明，接口永不返回 API Key。

本地密钥写入仓库根目录的 `.env`；该文件已被 Git 忽略，Node 服务启动时会自动加载。最小 DeepSeek 配置：

```dotenv
AGENT_MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=只保存在本机的密钥
DEEPSEEK_MODEL_FLASH=deepseek-v4-flash
DEEPSEEK_MODEL_PLUS=deepseek-v4-pro
```

当前 DeepSeek 默认模型按文本模型使用，不把图片或语音伪装成可用能力。图片理解后续交给独立视觉 Provider，语音由 ASR/TTS Provider 处理；这样更换主对话模型不会影响这些功能。

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

腾讯云现有服务器升级可使用 [deploy/tencent-v0.3.2.sh](deploy/tencent-v0.3.2.sh)，完整的防火墙、SSH、备份和回滚准备见 [deploy/TENCENT_SECURITY.md](deploy/TENCENT_SECURITY.md)。脚本不会修改 Caddy 或 SSH，并会保留旧应用容器供验收后回滚。

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

其他运行环境可设置 `GO_MUSIC_API_URL=http://受信任的内部服务:8080`；不要把原版 `go-music-api` 的 8080 端口直接暴露到公网。该第三方项目采用 AGPL-3.0，独立部署和修改时需遵守其许可证。
