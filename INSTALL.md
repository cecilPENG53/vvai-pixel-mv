# 在另一台电脑上安装 /vvai-pixel-mv

## 1. 放进 skills 目录

把解压出来的 `vvai-pixel-mv` 文件夹整个放到：

- Windows：`C:\Users\<用户名>\.claude\skills\vvai-pixel-mv\`
- Mac：`~/.claude/skills/vvai-pixel-mv/`

确认 `SKILL.md` 就在这个文件夹的第一层，不要多套一层文件夹。

也可以从 GitHub 私有仓库直接拉（那台电脑要先 `gh auth login` 登录同一个账号），以后用 `git pull` 更新：

```
git clone https://github.com/cecilPENG53/vvai-pixel-mv.git ~/.claude/skills/vvai-pixel-mv
```然后重启 Claude Code，输入 `/vvai-pixel-mv` 能看到它就装好了。

## 2. 装依赖

| 需要 | 用途 | 怎么装 |
|---|---|---|
| Python 3.10 以上 | 音频分析、歌词对齐、分镜表 | python.org 或 `uv python install 3.12` |
| Python 包 | 同上 | `python -m pip install librosa faster-whisper numpy Pillow` |
| ffmpeg | 剪音频、压缩预览版 | Windows：`winget install Gyan.FFmpeg`；Mac：`brew install ffmpeg`。装完在新终端里运行 `ffmpeg -version` 能出版本号 |
| Node.js 18 以上 | 运行 HyperFrames 渲染 | nodejs.org 下载 LTS 版 |

第一次运行时还会自动下载两样东西，要联网：

- `align`（歌词逐字对齐）会下载 faster-whisper 的 medium 模型，约 1.5 GB；
- `render` 和 `board --frames` 会通过 `npx` 下载 `hyperframes@0.8.81` 和它用的浏览器。

## 3. 告诉 Claude 用哪个 Python

如果 `python` 命令找不到，或者装了多个 Python，跟 Claude 说一句“这台电脑的 Python 是 `<路径>`”，或者写进你的 CLAUDE.md。

## 4. 试一下

```
python -X utf8 <skills目录>/vvai-pixel-mv/scripts/pixel_mv.py --help
```

能列出 new / story / check / board / approve / render 这些命令，就说明脚本正常。然后把一首歌的音频和 srt 歌词发给 Claude，说“用 /vvai-pixel-mv 做个像素 MV”。

## 包里有什么

- `SKILL.md`：流程说明，Claude 读它；
- `scripts/pixel_mv.py`：所有命令；
- `assets/template/`：工程模板，渲染引擎是 `assets/engine.js`；
- `assets/scene-library/scenes.json`：27 个像素场景；
- `assets/fonts/`：歌词用的 Noto Serif SC / Noto Sans SC，SIL Open Font License 1.1，授权全文在 `assets/fonts/OFL.txt`；
- `assets/examples/`：一首歌（《坏女孩》）的故事线和 story.json，可以当范例；
- `references/`：分镜格式、互动目录、讲故事的方法、分镜规则。
