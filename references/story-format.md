# story.json 格式（引擎 v2）

`MV draft` 会生成一份只按关键词换场的初稿。故事版要按 [讲故事的方法](storytelling.md) 手写，完整例子见 `assets/examples/bad-girl.story.json`（《坏女孩》，7 段、3 个角色、桌面窗口）。

改完先运行 `MV check`，再运行 `MV board` 出分镜表给用户看。所有时间都是成片时间（秒，0 = 截取起点）。

## 顶层

```json
{
  "title": "歌名", "dur": 59.611, "look": "base", "intensity": "dj", "character": null,
  "cast": { "claude": { "kind": "claude", "note": "我：……" }, "girl": { "kind": "girl", "note": "她：……" } },
  "segments": [ … ],
  "lines": { "3": { "exit": "drip" }, "9": { "mode": "type" } },
  "events": [ { "t": 1.79, "type": "drop" }, { "t": 27.42, "type": "react", "who": "claude" } ],
  "outro": { "t0": 57.21 }
}
```

| 字段 | 取值 |
|---|---|
| `look` | `base` 夜色像素 · `neon` 潮流像素 · `classic` 古典 · `retro` 怀旧 |
| `intensity` | `dj` · `standard` · `soft` |
| `character` | `null` 用 Claude 小人；`"assets/character.png"` 用 `MV character` 生成的像素角色（替换 claude 这个角色） |
| `cast` | 角色表。键是角色 id，`kind` 是外形：`claude` · `girl`（粉色蝴蝶结）· `rival`（蓝灰）· `friend` · `ghost`。`note` 写“谁：一句话”，分镜表会取冒号前面当称呼 |
| `lines` | 按句号单独设置歌词怎么出现，见 [互动目录](interactions.md#歌词怎么出现) |
| `events` | `drop` 全屏冲击（闪白、抖动、故障条）；`react` 受惊反应包，全片最多 2 次 |
| `outro.t0` | 片名卡出现的时间 |

## 段（segments）

段必须首尾相接：第一段从 0 开始，每段的 `t0` 等于上一段的 `t1`，最后一段结束在 `dur`。

### 环境段

```json
{ "t0": 16.4, "t1": 19.9, "scene": "rainstreet", "time": "night", "weather": "rain", "trans": "pixel",
  "crowd": false, "zoomAt": [160, 80],
  "actors": [ … ], "beats": [ … ],
  "camKeys": [[16.4, { "cx": 170, "cy": 100, "z": 1.1 }], [19.9, { "cx": 170, "cy": 100, "z": 1.18 }]],
  "labels": [ { "text": "最近通话 · 没有记录", "at": [110, 24], "size": 5.5, "show": [19.9, 22.85] } ] }
```

| 字段 | 说明 |
|---|---|
| `scene` | `scenes.json` 的场景 id（27 个，含 `club` 酒吧舞池、`calllog` 手机通话记录） |
| `time` | `night` · `dusk` · `day` |
| `weather` | `none` · `rain` · `snow` · `petals` · `leaves` · `fireflies` · `fog` |
| `trans` | 这一段**怎么进来**：`pixel` · `train` · `whip` · `zoom` · `iris` · `flash` · `cut`。不写时，换了场景用 `pixel`，同场景用 `cut` |
| `zoomAt` | 下一段用 `zoom` 进来时，本段镜头往哪个点钻（场景坐标） |
| `crowd` | `true` 时背景有跟拍跳动的人群剪影（舞池用） |
| `cam` | 没写 `camKeys` 时的镜头预设：`wide` · `push` · `close` · `pullout` · `follow` |
| `camKeys` | 镜头关键帧 `[时间, {cx, cy, z}]`，场景坐标 320×180，`z` 是放大倍数（1 全景、1.5 近景、2.5 以上特写），关键帧之间平滑过渡 |
| `labels` | 画在场景里的小字（非歌词），`at` 是场景坐标，`show` 是出现区间 |

### 角色（actors）

```json
{ "id": "girl", "act": "walk", "x": 146, "y": 152, "face": -1, "eyes": "happy", "alpha": 0.6,
  "props": ["umbrella"], "hold": "claude", "show": [18.3, 19.9],
  "path": [[16.4, 190], [18.1, 248]], "cellTo": 2.2, "intro": false }
```

| 字段 | 说明 |
|---|---|
| `id` | `cast` 里的角色 id |
| `act` | 基础动作，见 [互动目录](interactions.md#基础动作act) |
| `x`, `y` | 站位（场景坐标，`y` 是脚底）。不写就用场景给的默认站位 |
| `face` | `1` 朝右，`-1` 朝左 |
| `eyes` | 整段的默认表情：`normal` · `closed` · `happy` · `scared` · `liner` |
| `alpha` | 透明度（回忆里的人用 0.5–0.7） |
| `props` | 道具：`glasses` 墨镜 · `scarf` 围巾 · `umbrella` 伞 · `phone` 手机 · `lantern` 灯笼 |
| `hold` | 牵着谁的手（对方要在同一段） |
| `show` | 只在这个时间区间出现（出场、退场） |
| `path` | 走位 `[[时间, x], …]`，之间匀速移动；走出画面就写超出 0–320 的 x |
| `cellTo` | 走位过程中角色像素格从 3 变到这个值（远去变小） |
| `intro` | 开场用：头上积雪、发抖 |

### 剧情动作（beats）

```json
{ "do": "heart-crack", "who": "claude", "t": 33.855, "dur": 1.2, "value": "closed", "target": "claude" }
```

`do` 的取值和各自的参数见 [互动目录](interactions.md#剧情动作beats)。`who` 写角色 id；`memory`、`crowd-out`、`lights-off` 不需要 `who`。

### 桌面段（frame: desktop）

观众看到一整块电脑桌面（菜单栏、Dock），场景放在桌面的窗口里演。

```json
{ "t0": 45.74, "t1": 55.38, "frame": "desktop", "trans": "iris",
  "windows": [
    { "id": "B", "title": "我 · 现在", "rect": [990, 150, 820, 500], "rectTo": [200, 70, 1520, 890], "move": [48.2, 48.7],
      "show": [45.74, 55.5], "toDock": null, "scene": "bedroom", "weather": "rain",
      "actors": [ { "id": "claude", "act": "window", "x": 205, "y": 106 } ],
      "beats": [ { "do": "glasses-off", "who": "claude", "t": 52.48 } ] } ] }
```

| 字段 | 说明 |
|---|---|
| `rect` | 窗口位置 `[x, y, 宽, 高]`，屏幕像素 1920×1080（含 40px 标题栏） |
| `rectTo` + `move` | 在 `move` 时间区间里从 `rect` 平滑变到 `rectTo`（放大、挪位） |
| `show` | 窗口出现到关闭的时间；开窗有回弹 |
| `toDock` | 到这个时间窗口缩进 Dock |
| 其余 | `scene`、`time`、`weather`、`actors`、`beats` 和环境段一样 |

桌面段的歌词条默认放在 Dock 上方（y 905）。窗口里的场景坐标仍是 320×180。

## 旧格式

v1 的段（`act`、`cam`、`lyric`、`intro`、`lines`，顶层 `lineModes`）引擎 v2 仍然认识：没写 `actors` 的段会自动放一个 Claude 小人。旧工程运行 `MV upgrade <工程>` 换上新引擎。
