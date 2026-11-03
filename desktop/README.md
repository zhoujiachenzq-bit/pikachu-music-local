# Windows 桌面安装包

首版使用 Electron 独立窗口，内置 Node 24 和现有 loopback 音源服务。后台程序隐藏运行，只监听本机；不连接开发项目的 3000 端口。

用户数据固定保存到 `%APPDATA%\MusicHouse`，与安装目录分开。更新时保持 appId 和此目录，不卸载清数据。安装器也不会默认删除该目录。首次创建自己的账户；原网页的数据可通过现有音乐备份恢复功能导入，不自动复制真实数据库或模型密钥。

## 构建

在项目根目录执行 `pnpm build`，然后：

```powershell
Push-Location desktop
pnpm install --ignore-workspace --ignore-scripts
node node_modules/electron/install.js
Pop-Location
node desktop/prepare.mjs
Push-Location data/windows/runtime
pnpm install --prod --ignore-workspace --ignore-scripts --frozen-lockfile
Pop-Location
node desktop/smoke-runtime.mjs
Push-Location desktop
pnpm exec electron-builder --win nsis --x64 --publish never
Pop-Location
```

输出：`data/windows/output/music-house-0.7.3-windows-x64-setup.exe`。

只分发静态构建、已提交的公共素材、生产依赖、运行程序和许可证；不分发 `.env`、本机数据库、日志、签名密钥及模型配置。

## 首版验证与限制

- 内置 Node 启动服务、健康接口、静态资源检查通过；临时账户注册和创建歌单后重启服务，重新登录仍能读取同一歌单。实际桌面窗口可显示独立登录页。
- 关闭窗口后自启后端退出。若已有音源服务占用 8080，会复用它，不会在退出时关闭它；仅关闭本应用启动的音源服务。
- 未执行安装器覆盖安装/卸载演练，没有 Windows 代码签名证书，安装时可能显示未知发布者。
- 首版没有自动更新、托盘常驻或跨端资料同步；麦克风等权限默认拒绝，语音输入尚未接入桌面授权提示。真实音源播放、系统媒体按键及睡眠唤醒需用户验收。
- Electron 窗口隔离 Node 权限，只允许自身本机地址导航；外部网页交给系统浏览器，同源下载沿用当前会话。
