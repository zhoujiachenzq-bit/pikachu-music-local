# Android QQ / 咪咕与音源扩展

日期：2026-10-31。基于 v0.6.7，本地分支 codex/android-qq-migu，未发布。

## 实现

- Android QQ、咪咕搜索采用 go-music-api 所用 music-lib 的请求参数与真实平台 ID，通过 Android 原生 HTTP 发起；无结果时继续尝试内置 Go 服务。
- QQ 保留匿名 VIP 过滤；咪咕优先普通 MP3 的 contentId|resourceType|formatType，未知时长保持 0，由原播放链路补充验证。
- 内置 Go 固定到 bacdfbe6cf6a5ba7331463d2039e3aac915c627f，包括其锁定的更新版 music-lib；保留源码校验。
- Android 为咪咕上游所需的两个域名单独允许 HTTP；为 Go 配置 Android 14+ Conscrypt 与旧系统证书目录。并未证明这两点就是用户设备上的唯一故障原因。
- 新增酷狗、千千、5sing、Jamendo、JOOX、哔哩哔哩的搜索、同源 ID 解析和歌词，沿用 go-music-api inspect/stream。扩展平台歌单经 playlist/detail 接入；上游不支持或需要登录时返回错误，不冒充导入成功。
- 汽水保留公开歌单导入入口，不启用单曲搜索或加密播放。qq_wx 是 QQ 登录方式，不是新音源。
- 列表选择、名称、颜色、来源页校验、媒体域名校验、收藏/歌单/播放记录/音源健康均识别新增来源。
- SQLite 升级在事务中重建受 CHECK 限制的表，保留原行、索引、触发器和外键，失败回滚；兼容 Android sql.js。
- 自动跨源替代继续只选原四源，避免新增平台扩大自动替换范围。手动选择新源依然走同源公开资源核验。
- 授权文件见 third_party/go-music-api-NOTICE.md 和完整 AGPL 文本。

## 验证证据

- 新旧来源数据库写入、旧表依赖数据/索引保留、外键仍生效、重复升级安全，均有自动测试。
- 六个新增可搜索来源均有固定夹具，验证真实平台 ID 在 search / inspect / lyric / stream 地址链路中保持一致。
- QQ 匿名 VIP 过滤、咪咕复合 ID / MP3 格式、未知时长、请求编码、参数和取消信号均有测试。
- 本机真实 HTTP 烟测：晴天关键词 QQ 返回 3 首匿名候选，咪咕返回 10 首，分别约 401ms / 258ms。候选不等于原唱已确认或实际播放成功；QQ 首项是其他歌手的版本，未伪装成周杰伦原唱。
- 可复测：`pnpm exec tsx scripts/smoke-music-sources.ts --native`。
- 有内置服务时：`pnpm exec tsx scripts/smoke-music-sources.ts http://127.0.0.1:8080`，逐平台报告结果，空列表返回失败退出码。

## 待实机验证

当前环境没有发现 Android SDK / adb / Go 工具链，未构建新 libgomusic.so 或 APK，未运行 Android 模拟器/真机；新增音源的真实网络结果与播放、后台控制需要安装候选 APK 后验证。
本轮没有可用浏览器控制工具，新增选择项的手机视觉布局尚未浏览器实测。

验收应逐源分开记录搜索、播放对象、原唱/版本、歌词、收藏、歌单、重启数据、锁屏与下一首，失败区分平台授权、地域、HTTP/DNS/TLS 与播放器错误。不可用接口如实显示错误。
正式发版前须构建 Android 候选并完成上述验证；本地源码修改不会自动更新手机上已安装的 v0.6.7。
