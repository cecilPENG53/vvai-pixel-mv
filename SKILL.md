---
name: vvai-pixel-mv
description: 把一首歌（音频 + 带时间的歌词 srt/lrc）做成有故事的像素小人卡拍 MV（ClaudeMV 系列做法）。流程是先写故事线，再出带画面的分镜表给用户看、反复修改，用户确认后才渲染。支持多角色（我、她、新男友……）、剧情动作（松手、转身、哭、心碎、摘墨镜……）、7 种歌词互动、7 种转场、电脑桌面窗口视角、27 个像素场景和天气、卡拍特效，用 HyperFrames 渲染 MP4。用户说“做个像素 MV”“把这首歌做成 Claude MV”“像素小人 MV”“卡拍 MV”“上传了歌和歌词”时使用。只做口播或解说视频时用 /xumu。
---

# vvai-pixel-mv · 像素小人卡拍 MV

顺序固定：**故事线 → 分镜表（用户看、改，可以来回多次）→ 用户确认 → 出片**。没有经过用户确认的分镜，不渲染。

完整范例在 `assets/examples/`：一首歌的故事线和 story.json，7 段、3 个角色、带桌面窗口。

## 准备

- `PY`：装了 librosa、faster-whisper、numpy、Pillow 的 Python 3.10 以上，安装见 [INSTALL.md](INSTALL.md)。用户的 CLAUDE.md 或记忆里写了 Python 路径时用那个；没写就先确认 `python` 能导入这几个包，不行再问用户。
- `MV`：`PY -X utf8 <本 skill>/scripts/pixel_mv.py`。
- 需要 ffmpeg、Node。渲染默认走 `npx --yes hyperframes@0.8.81`；要换 CLI 时设置环境变量 `HF_CLI`，多个参数用 `|` 隔开。

## 流程

1. **收素材**。必须有音频、带时间的歌词（srt 或 lrc）和歌名。
   - 可选：截取起止秒、调色档（base / neon / classic / retro）、强度（dj / standard / soft）、角色图。
   - 还要问故事：用户心里有没有剧情？没有就在第 3 步提方案。
   - 没有歌词文件就向用户要，不要用转写去猜。转写不出人声的段落要先问用户，不能当成前奏。第 1 集就把主歌误判成了前奏。
2. **建工程**：`MV new <工程目录> --audio <音频> --lyrics <srt/lrc> --title <歌名> [--start 秒 --end 秒] [--look base] [--character 图片]`。
   - 这一步会剪音频、测节拍和能量高潮点、逐字对齐歌词。
   - 同时生成一份只按关键词换场的初稿 `story.json`，以及 `故事线.md` 模板。
   - 工程放在用户指定的目录；用户有固定的系列目录时（写在 CLAUDE.md 或记忆里）放那里。
3. **写故事线**。按 [讲故事的方法](references/storytelling.md) 填 `故事线.md`：一句话故事、角色、母题、分幕、逐句。给用户确认。
4. **写 story.json**。把故事线翻成 story.json。
   - 字段见 [格式](references/story-format.md)，可用的动作、歌词方式、转场见 [互动目录](references/interactions.md)。
   - 照着 `assets/examples/bad-girl.story.json` 写最快。
   - 写完运行 `MV check <工程>`，直到没有错误。
5. **出分镜表给用户看**。
   - 运行 `MV board <工程> --frames`：每段截 1–3 张画面，生成 `分镜表.md`，内容有总览、逐段的角色、剧情动作、歌词句号和出现方式、转场、镜头、卡点。
   - 用 SendUserFile 把 `分镜表.md` 和 `分镜/画面/` 里的 contact sheet 发给用户。
   - 告诉用户哪些地方可以改。
6. **改到满意**。用户提修改，就改 story.json，再运行 `board`。
   - 版本号自动加 1，旧版存在 `分镜/历史/`。
   - 可以来回多次，每次都把新版分镜表发给用户。
7. **确认后出片**。
   - 用户明确说“可以出片”，才运行 `MV approve <工程>`，再运行 `MV render <工程> --sample 12`。
   - 含糊的回复（“好的”“看着办”）不算确认。
   - `render` 会核对 story.json 指纹，确认后又改过就拒绝渲染。
   - 超过 30 MB 的另压一份 `_预览.mp4` 给手机。
8. **交付**。按 1 帧/秒拼图自己看一遍：故事看得懂，场景、歌词、转场、标题都在，时长和原音频一致、有音轨。
   - 出片后用户还要改，回到第 6 步：改 story.json → 出新版分镜表 → 再确认 → 再渲染。

## 关键规则

- **故事先于特效**。每句至少一个剧情动作或一种歌词互动；剧情动作落在关键字的时间上；转场要有剧情理由。详见 [讲故事的方法](references/storytelling.md)。
- **换场**：没有故事要求时，默认“桌面为主 + 意象插入”，见 [分镜规则](references/rules.md)。有故事时按分幕来，觉悟、回看类的段落用电脑桌面窗口视角。
- **角色**：
  - 默认 Claude 小人当“我”。
  - 其他角色用 `cast` 声明（girl、rival、friend、ghost）。
  - 用户给图时运行 `MV character <工程> <图片>`，转成 16×16 像素角色。
- **卡拍**：
  - 小人每拍正好落地，落地压扁，脚下扩散水波。
  - 每拍有镜头冲击和色闪，强拍加 RGB 分离。
  - 全屏闪白只放在转场和 drop 上，每秒不超过 3 次。
- **受惊反应包**全片最多 2 次，只放在真正的反转上。
- **歌词正文**：
  - 只出现在画面里和工程文件里；聊天回复和分镜表只写句号。
  - 歌曲版权由用户负责，发布前提醒一句。

## 命令一览

| 命令 | 作用 |
|---|---|
| `new` | 建工程：analyze + align + draft + story |
| `story` | 生成 `故事线.md` 模板（`--force` 重建） |
| `check` | 检查 story.json 里的名字、时间、窗口是否都是引擎认识的 |
| `board [--frames]` | 出分镜表（第 N 版），存历史 |
| `approve` | 记下用户确认的版本；之后 `render` 才放行 |
| `render [--sample 12] [--name 文件名]` | 渲染；`--force` 跳过确认，只在用户明说时用 |
| `sync` | 只同步 story.json → `assets/story.js`（调试用；board 和 render 会自动同步） |
| `upgrade` | 把旧工程换成当前模板引擎，旧文件留 `.before-upgrade` 备份 |
| `character` | 角色图 → 像素角色 |
| `analyze` / `align` / `draft` | `new` 的分步，单独重跑用 |

## 超出模板的定制

模板引擎 v2 已经覆盖下面这些，见 [互动目录](references/interactions.md)：

- 27 个场景、16 种基础动作；
- 23 种剧情动作；
- 7 种歌词方式、6 种进场、9 种退场；
- 7 种转场；
- 桌面窗口。

还不够时，在该工程的 `assets/engine.js` 里加，不要改本 skill 里的模板。可以参考 [第 1 集手法](references/episode1.md)。想把新桥段沉淀进模板，先和用户确认。沉淀时要同时改这几处：

- 模板 `engine.js`；
- `pixel_mv.py` 的 `BEAT_NAMES` 等名单，以及分镜表用的中文名 `ZH_*`；
- `interactions.md`。

## 场景库

- 数据在 `assets/scene-library/scenes.json`。
- 增加场景要同时改两处：在 `scenes.json` 里登记关键词和互动，在模板 `engine.js` 的 `SCENES` 里写绘制方法。
