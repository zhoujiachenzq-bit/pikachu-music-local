# 暮光花园

替代原酒红剧场。保留内部 burgundy ID，兼容已有账户偏好；不改变其他五个主题、导航、播放器队列或聊天业务。

依据用户提供的蓝紫天空、暖灯小屋、花海插画参考，放弃翡翠听音室与写实森林方向。应用 design-taste-frontend 的局部重设计原则：保持信息结构、统一色彩与圆角、先保证阅读对比，再添加环境动效。DESIGN_VARIANCE 4 / MOTION_INTENSITY 4 / VISUAL_DENSITY 6。紫色是用户明确参考方向。

背景素材：public/twilight-garden.png，使用内置 imagegen 生成。远景天空和山丘、中景小屋与树、近景花海提供画面景深；不是实时 3D。独立薄雾和少量萤光仅移动透明度与 transform，不移动镜头，手机及减少动态模式关闭循环。

生成提示：Create an original background illustration inspired by the attached reference's comforting dreamy mood. Portrait 2:3 image for a music app. Painterly softly pixel-textured fantasy illustration, NOT a photograph. Periwinkle blue twilight sky fading into warm pink lavender at horizon, a small cozy cottage in lower left with glowing golden windows and thin gently curling chimney smoke, large beautiful violet flowering tree on right, sweeping lavender pink wildflower meadow in bottom quarter, distant hazy hills. Strong atmospheric layers, gentle magic, friendly healing fairytale mood. Cottage and tree occupy lower half so upper half remains calm open blue sky for music player controls. Keep middle central column softly shaded lavender with low detail for lyrics overlay. Rich but soft colors matching reference, no black horror forest, no neon outlines, no giant moon. No text, no WEDNESDAY, no labels, no watermark, no UI. Balanced beautiful landscape with small fireflies near meadow, not excessive particles.

验证：43 个测试文件、224 项测试通过；typecheck、build 通过。浏览器查看 1146×986 桌面播放器与 390×844 手机聊天，手机输入区、迷你播放器和底栏无重叠。使用本地隔离静音夹具，不代表真实音乐接口、听感或真机性能验证。构建仍有原 Three.js 分块大于 500 kB 提示。未发布或部署。
