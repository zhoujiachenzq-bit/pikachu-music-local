# Windows 桌面安装包

Windows v0.8.1 使用 Electron 独立窗口，内置 Node 24 和本地音源服务。后台只监听本机，登录状态在变更和退出时保存。

用户数据固定保存到 `%APPDATA%\MusicHouse`，与安装目录分开。更新时保持 appId 和此目录，不卸载清数据。安装器也不会默认删除该目录。首次创建自己的账户；原网页的数据可通过现有音乐备份恢复功能导入，不自动复制真实数据库或模型密钥。

## 构建

在项目根目录执行 `pnpm build`，然后：

```powershell
Push-Location desktop
pnpm install --ignore-workspace --ignore-scripts
node node_modules/electron/install.js
Pop-Location
node desktop/prepare.mjs
Push-Location data/windows/portable-runtime
npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund
Pop-Location
Push-Location desktop
pnpm exec electron-builder --win nsis --x64 --publish never
Pop-Location
```

输出：`data/windows/output/music-house-0.8.1-windows-x64-setup.exe`。`afterPack` 会自动在仓库以外的临时目录运行实际打包资源检查，失败即停止构建；手动复查可执行 `node desktop/smoke-runtime.mjs`。包含真实 Electron 会话存储的登录、退出、重启和端口变化检查。

只分发静态构建、已提交的公共素材、生产依赖、运行程序和许可证；不分发 `.env`、本机数据库、日志、签名密钥及模型配置。

## 首版验证与限制

- 原首版检查在仓库目录内误用了祖先目录的依赖，不能证明安装包完整。修复版显式复制扁平生产依赖，并把实际打包资源复制到仓库之外，验证启动、网页、账户写入、歌单和重启保留。
- 登录默认保持30天，不保存明文密码；主动退出后移除登录会话。登录Cookie变更时及正常退出前强制保存到Electron会话目录。
- 关闭窗口后自启后端退出。若已有音源服务占用 8080，会复用它，不会在退出时关闭它；仅关闭本应用启动的音源服务。
- 已用 v0.7.4 安装器覆盖更新本机 v0.7.3，退出码0，随后从实际安装目录打开登录页，并验证安装后组件的独立启动与临时账户重启持久化。未做卸载演练或真实历史资料迁移；没有 Windows 代码签名证书，安装时可能显示未知发布者。
- 首版没有自动更新、托盘常驻或跨端资料同步；麦克风等权限默认拒绝，语音输入尚未接入桌面授权提示。真实音源播放、系统媒体按键及睡眠唤醒需用户验收。
- Electron 窗口隔离 Node 权限，只允许自身本机地址导航；外部网页交给系统浏览器，同源下载沿用当前会话。
