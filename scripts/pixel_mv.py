"""vvai-pixel-mv 命令行：从歌曲 + 歌词做出像素小人卡拍 MV 工程。

子命令（都以工程目录为第一个参数）：
  new       建工程：复制模板、字体、场景库，然后依次跑 analyze / align / draft / story
  analyze   剪音频、测节拍、算频谱和能量高潮点 → assets/bgm.mp3、assets/mvdata.js
  align     歌词（srt / lrc）逐字对齐到音频 → assets/lyrics.js、cues.json
  draft     按场景库和换场规则出初版分镜（只有关键词换场，没有故事）→ story.json、分镜.md
  story     生成故事线模板（逐句表，时间已填）→ 故事线.md；故事要先写这一页
  check     检查 story.json：场景、角色、剧情动作、歌词方式、转场是否都是引擎认识的
  sync      检查通过后把 story.json 同步到 assets/story.js
  upgrade   把旧工程换成当前 skill 的引擎和页面
  character 把一张角色图转成 16×16 像素角色 → assets/character.png
  board     把 story.json 翻成给用户看的分镜表（--frames 每段截画面）→ 分镜表.md，每版存一份历史
  approve   用户说可以出片后记下 story.json 指纹；render 只认确认过的版本
  render    渲染 MP4（超过 30 MB 另压一份 _预览.mp4），可选再切一段样片

歌词正文只在工程文件里流转，本脚本的终端输出只报句数和时间，不打印歌词。
"""
import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL / "assets" / "template"
LIB_JSON = SKILL / "assets" / "scene-library" / "scenes.json"
FONT_CANDIDATES = [SKILL / "assets" / "fonts", Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts", Path.home() / "AppData/Local/Microsoft/Windows/Fonts"]
FONTS = ["NotoSerifSC-VF.ttf", "NotoSansSC-VF.ttf"]
TWIST = ["却", "原来", "竟然", "突然", "没想到", "谁", "为什么", "不知道", "怎么会", "居然"]
DIALOG = ["说", "解释", "问", "回复", "消息", "告诉", "答应", "电话", "打字", "输入"]
# words that contain an imagery character but don't mean the place (潮流 isn't the sea)
FALSE_FRIENDS = ["潮流", "时尚潮", "网站", "站在", "站起", "星期", "明星", "球星", "窗口", "海报", "上海", "脑海", "花钱", "花费", "花心思",
                 "风格", "风险", "作风", "月份", "个月", "岁月", "云盘", "台词", "舞台", "后台", "平台", "电台", "梦想", "雪糕"]


def cfg_path(p):
    return Path(p) / "config.json"


def load_cfg(p):
    return json.loads(cfg_path(p).read_text(encoding="utf-8"))


def save_cfg(p, cfg):
    cfg_path(p).write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")


def write_js(path, var, obj):
    Path(path).write_text(f"window.{var}=" + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore", **kw)
    if r.returncode != 0:
        sys.exit(f"命令失败：{' '.join(map(str, cmd))}\n{r.stderr[-2000:]}")
    return r


# ---------------------------------------------------------------- new
def cmd_new(a):
    proj = Path(a.project)
    if proj.exists() and any(proj.iterdir()):
        sys.exit(f"{proj} 已存在且不为空；换个目录，或删掉后重来。")
    (proj / "assets" / "fonts").mkdir(parents=True)
    (proj / "renders").mkdir()
    for f in ["index.html", "hyperframes.json", "package.json", "meta.json"]:
        shutil.copy(TEMPLATE / f, proj / f)
    shutil.copy(TEMPLATE / "assets" / "engine.js", proj / "assets" / "engine.js")
    meta = json.loads((proj / "meta.json").read_text(encoding="utf-8"))
    meta.update({"id": proj.name, "name": proj.name})
    (proj / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    pkg = json.loads((proj / "package.json").read_text(encoding="utf-8"))
    pkg["name"] = re.sub(r"[^a-z0-9-]", "-", proj.name.lower()) or "pixel-mv"
    (proj / "package.json").write_text(json.dumps(pkg, ensure_ascii=False, indent=2), encoding="utf-8")
    html = (proj / "index.html").read_text(encoding="utf-8").replace("__TITLE__", a.title)
    (proj / "index.html").write_text(html, encoding="utf-8")
    missing = []
    for f in FONTS:
        src = next((d / f for d in FONT_CANDIDATES if (d / f).exists()), None)
        if src:
            shutil.copy(src, proj / "assets" / "fonts" / f)
        else:
            missing.append(f)
    if missing:
        print(f"⚠ 没找到字体 {missing}：把同名字体放进 {proj / 'assets' / 'fonts'}，否则歌词会退回系统字体。")
    lib = json.loads(LIB_JSON.read_text(encoding="utf-8"))
    write_js(proj / "assets" / "scenes-data.js", "SCENE_LIB", lib)
    cfg = {"title": a.title, "audio": str(Path(a.audio).resolve()), "lyrics": str(Path(a.lyrics).resolve()),
           "start": a.start, "end": a.end, "look": a.look, "intensity": a.intensity, "character": None}
    save_cfg(proj, cfg)
    print(f"工程已建：{proj}")
    cmd_analyze(argparse.Namespace(project=str(proj)))
    cmd_align(argparse.Namespace(project=str(proj), model=a.model))
    cmd_draft(argparse.Namespace(project=str(proj)))
    cmd_story(argparse.Namespace(project=str(proj), force=False))
    if a.character:
        cmd_character(argparse.Namespace(project=str(proj), image=a.character))


# ---------------------------------------------------------------- analyze
def cmd_analyze(a):
    import numpy as np
    import librosa

    proj = Path(a.project)
    cfg = load_cfg(proj)
    full, sr0 = librosa.load(cfg["audio"], sr=22050, mono=True)
    song_len = len(full) / sr0
    start = float(cfg.get("start") or 0.0)
    end = float(cfg.get("end") or song_len)
    end = min(end, song_len)
    dur = round(end - start, 3)
    bgm = proj / "assets" / "bgm.mp3"
    fade = f"afade=t=in:d=0.03,afade=t=out:st={max(0, dur - 0.6):.3f}:d=0.6"
    run(["ffmpeg", "-v", "error", "-y", "-i", cfg["audio"], "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-af", fade, "-c:a", "libmp3lame", "-b:a", "320k", str(bgm)])

    tempo, beats = librosa.beat.beat_track(y=full, sr=sr0, units="time")
    bpm = float(np.atleast_1d(tempo)[0])
    beats = [round(float(x) - start, 3) for x in beats if start - 0.5 <= x <= end]

    y = full[int(start * sr0):int(end * sr0)]
    fps = 30
    hop = sr0 // fps
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop, center=True))
    f = librosa.fft_frequencies(sr=sr0, n_fft=2048)
    nb = 36
    edges = np.geomspace(60, 9000, nb + 1)
    B = np.stack([S[(f >= edges[i]) & (f < edges[i + 1])].mean(0) for i in range(nb)])
    B = np.clip((librosa.amplitude_to_db(B, ref=np.max) + 60) / 60, 0, 1)
    B = np.clip(B / np.maximum(np.percentile(B, 98, axis=1, keepdims=True), 1e-3), 0, 1)
    sm = np.zeros_like(B)
    for t in range(B.shape[1]):
        prev = sm[:, t - 1] if t else B[:, 0]
        sm[:, t] = np.where(B[:, t] > prev, B[:, t], prev * 0.86 + B[:, t] * 0.14)
    q = (sm * 15).round().astype(int)
    spec = ["".join("0123456789abcdef"[v] for v in q[:, i]) for i in range(q.shape[1])]

    # energy jumps per 4-beat bar → candidate "drops"
    rms = librosa.feature.rms(y=y, hop_length=512)[0]
    rt = librosa.times_like(rms, sr=sr0, hop_length=512)
    bars = [beats[i] for i in range(0, len(beats), 4) if beats[i] >= 0]
    energy = []
    for i in range(len(bars) - 1):
        m = (rt >= bars[i]) & (rt < bars[i + 1])
        energy.append(float(rms[m].mean()) if m.any() else 0.0)
    jumps = sorted(((energy[i] - energy[i - 1], bars[i]) for i in range(1, len(energy))), reverse=True)
    mean_e = float(np.mean(energy)) if energy else 0.0
    drops = []
    for dv, t in jumps:
        if dv <= 0.12 * max(mean_e, 1e-6) or len(drops) >= 3:
            break
        if all(abs(t - d) > 6 for d in drops) and 1.0 < t < dur - 3:
            drops.append(round(t, 3))
    loud = float(20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9))

    data = {"offset": start, "dur": dur, "fps": fps, "bpm": round(bpm, 1), "loudness_db": round(loud, 1), "beats": beats, "drops": sorted(drops), "spec": spec}
    write_js(proj / "assets" / "mvdata.js", "MV_DATA", data)
    (proj / "mvdata.json").write_text(json.dumps({k: v for k, v in data.items() if k != "spec"}, ensure_ascii=False, indent=1), encoding="utf-8")
    html = (proj / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'data-duration="[^"]*"', f'data-duration="{dur}"', html)
    (proj / "index.html").write_text(html, encoding="utf-8")
    print(f"音频：{dur}s（原曲 {start:.2f}–{end:.2f}s），{bpm:.0f} BPM，{len(beats)} 拍，能量高潮点 {data['drops']}")


# ---------------------------------------------------------------- align
def parse_lyrics(path):
    raw = Path(path).read_text(encoding="utf-8-sig")
    cues = []
    if Path(path).suffix.lower() == ".lrc" or re.search(r"^\[\d+:\d+", raw, re.M):
        items = []
        for line in raw.splitlines():
            tags = re.findall(r"\[(\d+):(\d+(?:[.:]\d+)?)\]", line)
            text = re.sub(r"\[[^\]]*\]", "", line).strip()
            for m, s in tags:
                items.append((int(m) * 60 + float(s.replace(":", ".")), text))
        items = sorted(i for i in items if i[1])
        for k, (t, text) in enumerate(items):
            e = items[k + 1][0] if k + 1 < len(items) else t + 4.0
            cues.append({"id": k + 1, "s": t, "e": e, "text": text})
        return cues

    def ts(x):
        h, m, r = x.strip().split(":")
        sec, ms = r.replace(".", ",").split(",")
        return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000

    for blk in re.split(r"\n\s*\n", raw.strip()):
        L = [l for l in blk.strip().splitlines() if l.strip()]
        if len(L) < 3 or "-->" not in L[1]:
            continue
        a_, b_ = L[1].split("-->")
        cues.append({"id": int(L[0]) if L[0].strip().isdigit() else len(cues) + 1, "s": ts(a_), "e": ts(b_), "text": "".join(L[2:]).strip()})
    return sorted(cues, key=lambda c: c["s"])


def cmd_align(a):
    import numpy as np
    from faster_whisper import WhisperModel

    proj = Path(a.project)
    cfg = load_cfg(proj)
    cues = parse_lyrics(cfg["lyrics"])
    if not cues:
        sys.exit("歌词文件里没读到带时间的句子：需要 srt 或 lrc。")
    pcm = proj / "cache_16k.raw"
    run(["ffmpeg", "-v", "error", "-y", "-i", cfg["audio"], "-ac", "1", "-ar", "16000", "-f", "f32le", str(pcm)])
    audio = np.fromfile(pcm, dtype=np.float32)
    SR = 16000
    model = WhisperModel(getattr(a, "model", None) or "medium", device="cpu", compute_type="int8")
    for c in cues:
        a0 = max(0, c["s"] - 0.35)
        a1 = min(len(audio) / SR, c["e"] + 0.35)
        segs, _ = model.transcribe(audio[int(a0 * SR):int(a1 * SR)], language="zh", word_timestamps=True, beam_size=5,
                                   initial_prompt=c["text"], condition_on_previous_text=False, vad_filter=False)
        rc, rt = [], []
        for s in segs:
            for w in s.words:
                chs = [ch for ch in w.word if re.match(r"[\u4e00-\u9fffA-Za-z0-9]", ch)]
                for k, ch in enumerate(chs):
                    rc.append(ch)
                    rt.append(a0 + w.start + (w.end - w.start) * k / max(1, len(chs)))
        tgt = list(c["text"])
        times = [None] * len(tgt)
        for blk in difflib.SequenceMatcher(a=tgt, b=rc, autojunk=False).get_matching_blocks():
            for k in range(blk.size):
                times[blk.a + k] = rt[blk.b + k]
        # whisper pins the first word to the clip start: drop anything before the cue and anchor char 0 on the subtitle start
        times = [None if (t is not None and t < c["s"] - 0.05) else t for t in times]
        times[0] = c["s"]
        known = [(j, t) for j, t in enumerate(times) if t is not None]
        for j in range(len(times)):
            if times[j] is None:
                prev = [k for k in known if k[0] < j]
                nxt = [k for k in known if k[0] > j]
                if prev and nxt:
                    (p, tp), (n, tn) = prev[-1], nxt[0]
                    times[j] = tp + (tn - tp) * (j - p) / (n - p)
                elif prev:
                    p, tp = prev[-1]
                    times[j] = min(c["e"] - 0.1, tp + 0.2 * (j - p))
        t = times
        if 1 < len(t) <= 3:  # ad-libs collapse in alignment: spread evenly over the subtitle span
            t[:] = [c["s"] + (c["e"] - 0.25 - c["s"]) * j / (len(t) - 1) for j in range(len(t))]
        for j in range(1, len(t)):
            t[j] = max(t[j], t[j - 1] + 0.05)
        if len(t) > 2 and t[1] - t[0] > 0.6:  # subtitle start chained to the previous line
            t[0] = t[1] - (t[2] - t[1])
        c["chars"] = [round(x, 3) for x in t]
        c["s"] = c["chars"][0]
    pcm.unlink(missing_ok=True)
    (proj / "cues.json").write_text(json.dumps(cues, ensure_ascii=False, indent=1), encoding="utf-8")
    write_js(proj / "assets" / "lyrics.js", "MV_LYRICS", cues)
    print(f"歌词：{len(cues)} 句已逐字对齐（{cues[0]['s']:.2f}s–{cues[-1]['e']:.2f}s，原曲时间）")


# ---------------------------------------------------------------- draft
def cmd_draft(a):
    proj = Path(a.project)
    cfg = load_cfg(proj)
    md = json.loads((proj / "mvdata.json").read_text(encoding="utf-8"))
    cues = json.loads((proj / "cues.json").read_text(encoding="utf-8"))
    lib = json.loads(LIB_JSON.read_text(encoding="utf-8"))
    OFF, DUR, beats = md["offset"], md["dur"], md["beats"]
    scenes = {s["id"]: s for s in lib["scenes"]}

    def prev_beat(t):
        c = [b for b in beats if b <= t]
        return c[-1] if c else max(0.0, t)

    def next_beat(t):
        c = [b for b in beats if b >= t]
        return c[0] if c else t

    lines = []
    for c in cues:
        t0, t1 = c["chars"][0] - OFF, c["chars"][-1] - OFF + 0.3
        if t1 <= 0 or t0 >= DUR:
            continue
        txt = c["text"]
        for comp in FALSE_FRIENDS:  # compounds that contain an imagery character but mean something else
            txt = txt.replace(comp, "□" * len(comp))
        hits = {}
        for s in lib["scenes"]:
            if s["id"] == "desk":
                continue
            h = [k for k in s["kw"] if k in txt]
            if h:
                hits[s["id"]] = h
        best = max(hits, key=lambda k: (len(hits[k]), -list(scenes).index(k)), default=None)
        lines.append({"id": c["id"], "t0": round(max(0, t0), 3), "t1": round(min(DUR, t1), 3), "text": c["text"], "n": len(c["text"]), "best": best, "hits": hits.get(best, [])})
    if not lines:
        sys.exit("所选音频范围里没有歌词。")
    # short ad-libs follow the scene of the line before them
    for k, L in enumerate(lines):
        if L["n"] <= 3 and k:
            L["best"] = lines[k - 1]["best"]

    # runs of consecutive lines that want the same environment → one insert (2–8 s), desktop elsewhere
    inserts, k = [], 0
    while k < len(lines):
        L = lines[k]
        if not L["best"]:
            k += 1
            continue
        j = k
        while j + 1 < len(lines) and lines[j + 1]["best"] == L["best"]:
            j += 1
        s = prev_beat(L["t0"] - 0.05)
        e = next_beat(lines[j]["t1"])
        if e - s < 2.0:
            e = next_beat(s + 2.0)
        if e - s > 8.0:
            cand = [b for b in beats if s + 2.0 <= b <= s + 8.0]
            e = cand[-1] if cand else s + 8.0
        if inserts and s < inserts[-1]["t1"]:
            s = inserts[-1]["t1"]
        if inserts and inserts[-1]["scene"] == L["best"] and s - inserts[-1]["t1"] < 1.2:
            inserts[-1]["t1"] = round(max(inserts[-1]["t1"], e), 3)
            inserts[-1]["lines"] += [x["id"] for x in lines[k:j + 1]]
            inserts[-1]["hits"] += sum((x["hits"] for x in lines[k:j + 1]), [])
        elif e - s >= 1.0:
            inserts.append({"scene": L["best"], "t0": round(s, 3), "t1": round(min(DUR, e), 3), "lines": [x["id"] for x in lines[k:j + 1]], "hits": sum((x["hits"] for x in lines[k:j + 1]), [])})
        k = j + 1

    # less than 2 s of desktop between two environments flickers: go straight from one environment to the next
    for i in range(1, len(inserts)):
        if inserts[i]["t0"] - inserts[i - 1]["t1"] < 2.0:
            inserts[i - 1]["t1"] = inserts[i]["t0"]
    if inserts and inserts[0]["t0"] < 1.0:
        inserts[0]["t0"] = 0.0

    first, last = lines[0], lines[-1]
    outro_t = next_beat(last["t1"] + 0.5)
    outro = round(outro_t, 3) if DUR - outro_t >= 2.0 else round(max(last["t1"], DUR - 3.0), 3)
    segs, cur = [], 0.0
    intro_end = prev_beat(first["t0"] - 0.1) if first["t0"] > 1.5 else 0.0
    if intro_end > 0.5 and (not inserts or inserts[0]["t0"] > 0.6):
        segs.append({"scene": "desk", "t0": 0.0, "t1": round(min(intro_end, inserts[0]["t0"]) if inserts else intro_end, 3), "intro": True, "cam": "pullout"})
        cur = segs[-1]["t1"]
    for ins in inserts:
        if ins["t0"] - cur > 0.05:
            segs.append({"scene": "desk", "t0": round(cur, 3), "t1": ins["t0"]})
        segs.append(dict(ins, cam="push"))
        cur = ins["t1"]
    if DUR - cur > 0.05:
        segs.append({"scene": "desk", "t0": round(cur, 3), "t1": DUR})
    # long desktop stretches: one camera move per lyric line (wide / push alternating), same scene so no wipe
    split = []
    for s in segs:
        if s["scene"] != "desk" or s.get("intro"):
            split.append(s)
            continue
        cuts = [prev_beat(L["t0"] - 0.05) for L in lines if s["t0"] + 1.0 < L["t0"] < s["t1"] - 1.0]
        edges = [s["t0"]] + sorted(set(c for c in cuts if s["t0"] + 1.0 < c < s["t1"] - 1.0)) + [s["t1"]]
        for n in range(len(edges) - 1):
            split.append({"scene": "desk", "t0": edges[n], "t1": edges[n + 1], "cam": "push" if n % 2 else "wide"})
    segs = []
    for s in split:  # nothing shorter than 0.6 s
        if segs and s["t1"] - s["t0"] < 0.6:
            segs[-1]["t1"] = s["t1"]
        else:
            segs.append(s)
    for s in segs:
        s["lines"] = [L["id"] for L in lines if s["t0"] <= L["t0"] < s["t1"]]
        s.setdefault("cam", "wide")

    # weather / time / act / lyric display per segment
    def cue_words(cue):
        return [w for w in cue.split(" · ") if w and not w.startswith("默认")]

    text_of = {L["id"]: L["text"] for L in lines}
    for s in segs:
        meta = scenes[s["scene"]]
        txt = "".join(text_of.get(i, "") for i in s["lines"])
        s["time"] = meta["times"][0]
        w = next((x["id"] for x in lib["weathers"] if x["cue"] and any(c in txt for c in cue_words(x["cue"])) and x["id"] in meta["weathers"]), meta["weathers"][0])
        s["weather"] = w
        act = next((x["id"] for x in lib["acts"] if any(c in txt for c in cue_words(x["cue"])) and x["id"] in meta["acts"]), meta["acts"][0])
        short = all(len(text_of.get(i, "")) <= 12 for i in s["lines"])
        if s["scene"] in ("desk", "phone") and s["lines"] and short:
            s["lyric"], s["act"] = "type", "type"
        else:
            s["lyric"], s["act"] = "band", (act if act != "type" else meta["acts"][0])
        if s.get("intro"):
            s["act"], s["lyric"] = "hop", "band"
        s["t0"], s["t1"] = round(s["t0"], 3), round(s["t1"], 3)

    # events: energy drops (big hits) and up to two reaction packs on twist lines
    events = [{"t": d, "type": "drop"} for d in md.get("drops", []) if 1.0 < d < outro - 1]
    reacts = []
    for L in lines:
        if any(w in L["text"] for w in TWIST) and L["t0"] > max(2.5, intro_end) and all(abs(L["t0"] - r) > 10 for r in reacts) and len(reacts) < 2:
            reacts.append(L["t0"])
    events += [{"t": round(min(beats, key=lambda b: abs(b - r)) if beats else r, 3), "type": "react", "line": next(L["id"] for L in lines if L["t0"] == r)} for r in reacts]

    bpm, loud = md.get("bpm", 100), md.get("loudness_db", -20)
    intensity = cfg.get("intensity") or ("dj" if bpm >= 115 and loud > -18 else "soft" if bpm < 85 else "standard")
    story = {"title": cfg["title"], "dur": DUR, "look": cfg.get("look") or "base", "intensity": intensity,
             "character": "assets/character.png" if cfg.get("character") else None,
             "segments": [{k: v for k, v in s.items() if k != "hits"} for s in segs], "events": sorted(events, key=lambda e: e["t"]), "outro": {"t0": outro}}
    (proj / "story.json").write_text(json.dumps(story, ensure_ascii=False, indent=1), encoding="utf-8")
    write_js(proj / "assets" / "story.js", "STORY", story)

    # 分镜.md for the user: line numbers and hit words only
    name = {s["id"]: s["name"] for s in lib["scenes"]}
    wname = {w["id"]: w["name"] for w in lib["weathers"]}
    aname = {x["id"]: x["name"] for x in lib["acts"]}
    cam = {"wide": "全景卡拍", "push": "慢推", "pullout": "近景 → 拉远", "close": "近景"}
    rows = ["| 段 | 时间 | 场景 | 天气 | 互动 | 镜头 | 歌词 | 依据 |", "|---|---|---|---|---|---|---|---|"]
    for i, s in enumerate(segs, 1):
        why = "开场" if s.get("intro") else ("命中：" + "、".join(dict.fromkeys(s.get("hits", []))) if s["scene"] != "desk" else "没命中环境意象")
        ln = ("第 " + "、".join(str(x) for x in s["lines"]) + " 句") if s["lines"] else "—"
        rows.append(f"| {i} | {s['t0']:.1f}–{s['t1']:.1f}s | {name[s['scene']]} | {wname.get(s['weather'], s['weather'])} | {aname.get(s['act'], s['act'])} | {cam.get(s['cam'], s['cam'])} | {ln} ({'打字' if s['lyric'] == 'type' else '大字'}) | {why} |")
    ev = "；".join(f"{e['t']:.1f}s {'能量高潮（闪白 + 冲击）' if e['type'] == 'drop' else '受惊反应（第 ' + str(e['line']) + ' 句）'}" for e in story["events"]) or "无"
    doc = [f"# {cfg['title']} · 像素 MV 分镜（初版，自动生成）", "",
           f"- 时长 {DUR}s，{md.get('bpm')} BPM，强度：{intensity}，调色：{story['look']}",
           "- 换场规则：桌面为主 + 意象插入（命中强意象的句子切到环境 2–8 秒，再回桌面）",
           f"- 特效事件：{ev}", f"- 片尾标题：{outro:.1f}s 起", "", *rows, "",
           "改分镜：直接改 story.json 里的 scene / weather / act / cam / lyric，然后运行 `pixel_mv.py sync <工程>`。重新跑 draft 会覆盖手改。"]
    (proj / "分镜.md").write_text("\n".join(doc), encoding="utf-8")
    n_ins = sum(1 for s in segs if s["scene"] != "desk" and not s.get("intro"))
    print(f"分镜：{len(segs)} 段（其中环境插入 {n_ins} 段），事件 {len(story['events'])} 个，强度 {intensity} → 分镜.md")


# ---------------------------------------------------------------- character
def cmd_character(a):
    from PIL import Image

    proj = Path(a.project)
    im = Image.open(a.image).convert("RGBA")
    N = 16
    im.thumbnail((N, N), Image.LANCZOS)
    canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    canvas.paste(im, ((N - im.width) // 2, N - im.height), im)
    px = canvas.load()
    solid = [[px[x, y][3] > 110 for x in range(N)] for y in range(N)]
    q = lambda v: min(255, round(v / 85) * 85)
    for y in range(N):
        for x in range(N):
            r, g, b, al = px[x, y]
            if solid[y][x]:
                px[x, y] = (q(r), q(g), q(b), 255)
            elif any(0 <= x + dx < N and 0 <= y + dy < N and solid[y + dy][x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px[x, y] = (27, 20, 32, 255)
            else:
                px[x, y] = (0, 0, 0, 0)
    canvas.save(proj / "assets" / "character.png")
    cfg = load_cfg(proj)
    cfg["character"] = str(Path(a.image).resolve())
    save_cfg(proj, cfg)
    story_p = proj / "story.json"
    if story_p.exists():
        story = json.loads(story_p.read_text(encoding="utf-8"))
        story["character"] = "assets/character.png"
        story_p.write_text(json.dumps(story, ensure_ascii=False, indent=1), encoding="utf-8")
        write_js(proj / "assets" / "story.js", "STORY", story)
    print("角色已转成 16×16 像素：assets/character.png")


# ---------------------------------------------------------------- story-first: scaffold 故事线.md
def cmd_story(a):
    proj = Path(a.project)
    out = proj / "故事线.md"
    if out.exists() and not a.force:
        sys.exit(f"{out} 已存在；要重建加 --force。")
    md = json.loads((proj / "mvdata.json").read_text(encoding="utf-8"))
    cues = json.loads((proj / "cues.json").read_text(encoding="utf-8"))
    OFF, DUR = md["offset"], md["dur"]
    rows = ["| 句 | 时间 | 场景 | 谁在场（站位、表情、道具） | 发生了什么（剧情动作） | 歌词怎么出现 | 转场进来 |", "|---|---|---|---|---|---|---|"]
    for c in sorted(cues, key=lambda c: c["chars"][0]):
        t0, t1 = c["chars"][0] - OFF, c["chars"][-1] - OFF
        if t1 <= 0 or t0 >= DUR:
            continue
        rows.append(f"| {c['id']} | {t0:.1f}–{t1:.1f}s |  |  |  |  |  |")
    doc = [f"# {load_cfg(proj)['title']} · 故事线", "",
           "> 先写这一页，给用户确认，再翻译成 story.json。方法见 skill 的 references/storytelling.md。", "",
           "## 一句话故事", "", "（谁、对谁、做了什么、结局怎样。）", "",
           "## 角色", "", "| id | 是谁 | 外形（kind） | 贯穿全片的标志 |", "|---|---|---|---|", "| claude | 主角“我” | claude | |", "|  |  |  |  |", "",
           "## 贯穿道具 / 母题（2–3 个，首尾呼应）", "", "- ", "",
           "## 分幕", "", "| 幕 | 时间 | 情绪 | 场景 |", "|---|---|---|---|", "|  |  |  |  |", "",
           "## 逐句", "", *rows, "",
           "可用的剧情动作、歌词出现方式、转场：见 references/interactions.md。"]
    out.write_text("\n".join(doc), encoding="utf-8")
    print(f"故事线模板 → {out}（{len(rows) - 2} 句）")


# ---------------------------------------------------------------- validate story.json against what the engine understands
BEAT_NAMES = {"turn", "eyes", "wave", "armsUp", "reach", "glance", "fade", "fade-in", "dissolve", "glasses-off", "scarf-out", "drop-umbrella",
              "cry", "scared", "spotlight", "hands-break", "sparkle", "heart", "heart-crack", "puff", "memory", "crowd-out", "lights-off"}
LINE_MODES = {"band", "type", "say", "memory", "behind", "glass", "split"}
ENTERS = {"pop", "bounce", "spot", "sparkle", "swipe", "lift"}
EXITS = {"smash", "shatter", "drift", "drip", "recede", "wash", "scatter", "blown", "dissolve"}
TRANS_TYPES = {"pixel", "train", "whip", "zoom", "iris", "flash", "cut"}
CAMS = {"wide", "push", "close", "pullout", "follow"}
KINDS = {"claude", "girl", "rival", "friend", "ghost"}
PROPS = {"glasses", "scarf", "umbrella", "phone", "lantern"}


def check_story(proj):
    lib = json.loads(LIB_JSON.read_text(encoding="utf-8"))
    scenes = {s["id"] for s in lib["scenes"]}
    acts = {x["id"] for x in lib["acts"]} | {"dance", "idle"}
    weathers = {w["id"] for w in lib["weathers"]}
    st = json.loads((proj / "story.json").read_text(encoding="utf-8"))
    errs, warns = [], []
    cast = {"claude"} | set((st.get("cast") or {}).keys())
    for cid, c in (st.get("cast") or {}).items():
        if c.get("kind", cid) not in KINDS:
            errs.append(f"cast.{cid}: kind 只能是 {sorted(KINDS)}")
    segs = st.get("segments", [])
    if not segs:
        errs.append("没有 segments")
    t = 0.0
    for i, s in enumerate(segs, 1):
        tag = f"第 {i} 段（{s.get('t0')}–{s.get('t1')}s）"
        if abs(s.get("t0", -1) - t) > 0.02:
            errs.append(f"{tag}：起点应接上一段的终点 {t:.3f}")
        if s.get("t1", 0) <= s.get("t0", 0):
            errs.append(f"{tag}：t1 必须大于 t0")
        t = s.get("t1", t)
        if s.get("trans") and s["trans"] not in TRANS_TYPES:
            errs.append(f"{tag}：trans 只能是 {sorted(TRANS_TYPES)}")
        frames = s.get("windows", []) if s.get("frame") == "desktop" else [s]
        if s.get("frame") == "desktop" and not frames:
            errs.append(f"{tag}：desktop 段要有 windows")
        if s.get("cam") and s["cam"] not in CAMS:
            errs.append(f"{tag}：cam 只能是 {sorted(CAMS)}")
        for f in frames:
            ftag = tag + (f"·窗口 {f.get('id')}" if f is not s else "")
            if f.get("scene", "desk") not in scenes:
                errs.append(f"{ftag}：未知场景 {f.get('scene')}")
            if f.get("weather", "none") not in weathers:
                errs.append(f"{ftag}：未知天气 {f.get('weather')}")
            if f is not s and not (f.get("id") and f.get("rect")):
                errs.append(f"{ftag}：窗口要有 id 和 rect [x,y,w,h]")
            ids = set()
            for a in f.get("actors", []) or []:
                ids.add(a.get("id"))
                if a.get("id") not in cast and a.get("id") not in KINDS:
                    errs.append(f"{ftag}：角色 {a.get('id')} 没在 cast 里")
                if a.get("act", "hop") not in acts:
                    errs.append(f"{ftag}：角色 {a.get('id')} 的 act {a.get('act')} 不存在")
                for p in a.get("props", []):
                    if p not in PROPS:
                        errs.append(f"{ftag}：道具 {p} 不存在（可用 {sorted(PROPS)}）")
                if a.get("path") and any(not (s["t0"] - 0.01 <= k[0] <= s["t1"] + 0.01) for k in a["path"]):
                    warns.append(f"{ftag}：角色 {a.get('id')} 的 path 时间超出本段")
                if a.get("hold") and a["hold"] not in [x.get("id") for x in f.get("actors", [])]:
                    errs.append(f"{ftag}：{a.get('id')} 牵手的对象 {a['hold']} 不在本段")
            for bt in f.get("beats", []) or []:
                if bt.get("do") not in BEAT_NAMES:
                    errs.append(f"{ftag}：未知剧情动作 {bt.get('do')}")
                if not (s["t0"] - 0.01 <= bt.get("t", -1) <= s["t1"] + 0.01):
                    warns.append(f"{ftag}：{bt.get('do')} 的时间 {bt.get('t')} 不在本段里")
                if bt.get("who") and bt["who"] not in ids and bt.get("do") not in ("memory", "lights-off", "crowd-out"):
                    warns.append(f"{ftag}：{bt.get('do')} 的 who={bt['who']} 不在本段角色里")
    if segs and abs(t - st.get("dur", t)) > 0.05:
        errs.append(f"最后一段应结束在 dur={st.get('dur')}，现在是 {t}")
    for lid, cfg in (st.get("lines") or {}).items():
        if cfg.get("mode", "band") not in LINE_MODES:
            errs.append(f"lines.{lid}：mode 只能是 {sorted(LINE_MODES)}")
        if cfg.get("enter", "pop") not in ENTERS:
            errs.append(f"lines.{lid}：enter 只能是 {sorted(ENTERS)}")
        if cfg.get("exit", "smash") not in EXITS:
            errs.append(f"lines.{lid}：exit 只能是 {sorted(EXITS)}")
        if cfg.get("mode") == "glass" and not cfg.get("win"):
            errs.append(f"lines.{lid}：glass 要写 win（窗口 id）和 at [x,y]")
    reacts = [e for e in st.get("events", []) if e.get("type") == "react"]
    if len(reacts) > 2:
        warns.append(f"受惊反应有 {len(reacts)} 次，规则是全片最多 2 次")
    return errs, warns


def cmd_check(a):
    errs, warns = check_story(Path(a.project))
    for w in warns:
        print("⚠", w)
    for e in errs:
        print("✗", e)
    print(f"story.json：{len(errs)} 个错误，{len(warns)} 个提醒")
    if errs:
        sys.exit(1)


# ---------------------------------------------------------------- sync story.json → story.js after hand edits
def cmd_sync(a):
    proj = Path(a.project)
    errs, warns = check_story(proj)
    for w in warns:
        print("⚠", w)
    if errs:
        for e in errs:
            print("✗", e)
        sys.exit("story.json 有错误，没有同步。")
    story = json.loads((proj / "story.json").read_text(encoding="utf-8"))
    write_js(proj / "assets" / "story.js", "STORY", story)
    lib = json.loads(LIB_JSON.read_text(encoding="utf-8"))
    write_js(proj / "assets" / "scenes-data.js", "SCENE_LIB", lib)
    print("story.json → assets/story.js 已同步")


# ---------------------------------------------------------------- bring an older project onto the current engine
def cmd_upgrade(a):
    proj = Path(a.project)
    html = (proj / "index.html").read_text(encoding="utf-8")
    m = re.search(r'data-duration="([^"]+)"', html)
    t = re.search(r"<title>(.*?) · 像素 MV</title>", html)
    dur = m.group(1) if m else str(json.loads((proj / "mvdata.json").read_text(encoding="utf-8"))["dur"])
    title = t.group(1) if t else load_cfg(proj)["title"]
    for f in ["engine.js"]:
        if (proj / "assets" / f).exists():
            shutil.copy(proj / "assets" / f, proj / "assets" / (f + ".before-upgrade"))
        shutil.copy(TEMPLATE / "assets" / f, proj / "assets" / f)
    shutil.copy(proj / "index.html", proj / "index.html.before-upgrade")
    new = (TEMPLATE / "index.html").read_text(encoding="utf-8").replace("__TITLE__", title).replace("__DUR__", dur)
    (proj / "index.html").write_text(new, encoding="utf-8")
    write_js(proj / "assets" / "scenes-data.js", "SCENE_LIB", json.loads(LIB_JSON.read_text(encoding="utf-8")))
    print(f"已换成当前引擎（旧文件留了 .before-upgrade 备份）：{proj}")


# ---------------------------------------------------------------- storyboard for the user to review before any render
ZH_BEAT = {"turn": "转身", "eyes": "表情", "wave": "挥手", "armsUp": "举手", "reach": "伸手", "glance": "瞟一眼", "fade": "渐渐变淡",
           "fade-in": "渐渐出现", "dissolve": "像素消散", "glasses-off": "摘墨镜", "scarf-out": "拿出围巾", "drop-umbrella": "伞掉在地上",
           "cry": "哭", "scared": "受惊", "spotlight": "追光打在身上", "hands-break": "松开牵着的手", "sparkle": "身上闪光", "heart": "冒爱心",
           "heart-crack": "爱心碎掉", "puff": "哼一口气", "memory": "回忆气泡", "crowd-out": "人群散去", "lights-off": "灯一盏盏灭掉"}
ZH_EYES = {"closed": "闭眼", "scared": "惊恐", "happy": "笑眼", "liner": "眼线特写", "sad": "难过"}
ZH_MODE = {"band": "大字条", "type": "打字框里打出", "say": "对话气泡", "memory": "回忆气泡里", "behind": "大字在角色身后",
           "glass": "写在窗玻璃上", "split": "左右分屏"}
ZH_ENTER = {"pop": "弹出", "bounce": "逐字跳入", "spot": "追光亮起", "sparkle": "闪光出现", "swipe": "划入", "lift": "缓缓升起"}
ZH_EXIT = {"smash": "砸碎", "shatter": "碎裂", "drift": "飘走", "drip": "往下滴落", "recede": "退远", "wash": "被雨冲掉",
           "scatter": "散开", "blown": "被吹散", "dissolve": "像素消散"}
ZH_TRANS = {"pixel": "像素块擦除", "train": "列车穿过画面", "whip": "甩镜", "zoom": "推进穿越", "iris": "圆圈收拢", "flash": "闪白", "cut": "硬切"}
ZH_CAM = {"wide": "全景", "push": "慢推", "close": "特写", "pullout": "拉远", "follow": "跟拍"}
ZH_PROP = {"glasses": "墨镜", "scarf": "围巾", "umbrella": "伞", "phone": "手机", "lantern": "灯笼"}
ZH_EVENT = {"drop": "重拍（全屏冲击）", "react": "受惊反应包（速度线、问号、慢推猛拉）"}
ZH_TIME = {"day": "白天", "dusk": "黄昏", "night": "夜", "dawn": "清晨"}


def story_hash(proj):
    import hashlib
    return hashlib.sha256((Path(proj) / "story.json").read_bytes()).hexdigest()[:12]


def _shot(z):
    return "特写" if z >= 2.5 else "近景" if z >= 1.5 else "中景" if z >= 1.15 else "全景"


def _cast_name(st, cid):
    note = ((st.get("cast") or {}).get(cid) or {}).get("note", "")
    return note.split("：")[0] if note else {"claude": "我"}.get(cid, cid)


def _actors(st, f, lib):
    acts = {x["id"]: x["name"] for x in lib["acts"]}
    out = []
    for a in f.get("actors", []) or []:
        s = f"{_cast_name(st, a['id'])}·{acts.get(a.get('act', 'hop'), a.get('act'))}"
        if a.get("props"):
            s += "（" + "、".join(ZH_PROP.get(p, p) for p in a["props"]) + "）"
        if a.get("path"):
            s += "，会移动"
        if a.get("hold"):
            s += f"，牵着{_cast_name(st, a['hold'])}"
        if a.get("show"):
            s += f"，{a['show'][0]:.1f}s 出场"
        out.append(s)
    return "；".join(out) or "—"


def _beats(st, f):
    out = []
    for b in sorted(f.get("beats", []) or [], key=lambda b: b.get("t", 0)):
        d = ZH_BEAT.get(b["do"], b["do"])
        if b["do"] == "eyes":
            d = ZH_EYES.get(b.get("value"), b.get("value"))
        who = _cast_name(st, b["who"]) if b.get("who") else ""
        out.append(f"{b.get('t', 0):.1f}s {who}{d}")
    return "；".join(out) or "—"


def _camera(s):
    if s.get("frame") == "desktop":
        return "桌面固定"
    if s.get("camKeys"):
        seq = []
        for _, k in s["camKeys"]:
            n = _shot(k.get("z", 1))
            if not seq or seq[-1] != n:
                seq.append(n)
        return "→".join(seq)
    return ZH_CAM.get(s.get("cam"), "自动")


def _line_way(cfg):
    mode = cfg.get("mode", "band")
    w = ZH_MODE.get(mode, mode)
    if mode in ("band", "behind", "split"):
        w += "，" + ZH_ENTER.get(cfg.get("enter", "pop"), "")
    w += "，" + ZH_EXIT.get(cfg.get("exit", "smash"), "")
    if cfg.get("win"):
        w += f"（窗口 {cfg['win']}）"
    return w


def cmd_board(a):
    proj = Path(a.project)
    errs, warns = check_story(proj)
    if errs:
        for e in errs:
            print("✗", e)
        sys.exit("story.json 有错误，先改好再出分镜表。")
    st = json.loads((proj / "story.json").read_text(encoding="utf-8"))
    lib = json.loads(LIB_JSON.read_text(encoding="utf-8"))
    scn = {s["id"]: s["name"] for s in lib["scenes"]}
    wth = {w["id"]: w["name"] for w in lib["weathers"]}
    md = json.loads((proj / "mvdata.json").read_text(encoding="utf-8"))
    cues = json.loads((proj / "cues.json").read_text(encoding="utf-8"))
    OFF = md["offset"]
    cfg = load_cfg(proj)
    rev = cfg.get("board_rev", 0) + 1
    hist = proj / "分镜" / "历史"
    hist.mkdir(parents=True, exist_ok=True)
    shutil.copy(proj / "story.json", hist / f"story_第{rev}版.json")
    lines_cfg = st.get("lines") or {}
    segs = st["segments"]
    write_js(proj / "assets" / "story.js", "STORY", st)

    shots = {}
    if a.frames:
        times = []
        for i, s in enumerate(segs):
            span = s["t1"] - s["t0"]
            n = 1 if span < 7 else 2 if span < 14 else 3
            for k in range(n):
                times.append((i, round(s["t0"] + span * (k + 0.5) / n, 2)))
        imgdir = proj / "分镜" / "画面"
        if imgdir.exists():
            shutil.rmtree(imgdir)
        base = hf_cmd()
        run(base + ["snapshot", ".", "-o", str(imgdir), "--describe", "false", "--no-end", "--timeout", "15000",
                    "--at", ",".join(str(t) for _, t in times)], cwd=proj, shell=os.name == "nt" and base[0] == "npx")
        pngs = sorted(imgdir.glob("frame-*.png"))
        for (i, t), p in zip(times, pngs):
            shots.setdefault(i, []).append(f"![{t}s](分镜/画面/{p.name})")

    doc = [f"# {cfg['title']} · 分镜表（第 {rev} 版）", "",
           "> 看完告诉我哪一段要改：换场景、换动作、换转场、换歌词出现方式、改时间都行。改完再出一版分镜表；你说“可以出片”才渲染。",
           f"> story.json 指纹 `{story_hash(proj)}`。全片 {st['dur']:.1f}s，{len(segs)} 段，调色 {st.get('look', 'base')}，强度 {st.get('intensity') or '自动'}。", ""]
    tale = proj / "故事线.md"
    if tale.exists():
        m = re.search(r"## 一句话故事\s*\n+([^\n（#][^\n]*)", tale.read_text(encoding="utf-8"))
        if m:
            doc += ["## 一句话故事", "", m.group(1).strip(), ""]
    if st.get("cast"):
        doc += ["## 角色", "", "| id | 是谁 |", "|---|---|"] + [f"| {k} | {v.get('note', '')} |" for k, v in st["cast"].items()] + [""]
    doc += ["## 总览", "", "| 段 | 时间 | 画面 | 转场进来 | 镜头 | 歌词句 |", "|---|---|---|---|---|---|"]
    seg_lines = []
    for i, s in enumerate(segs):
        ids = [c["id"] for c in cues if s["t0"] - 0.05 <= c["chars"][0] - OFF < s["t1"] - 0.05]
        seg_lines.append(ids)
        if s.get("frame") == "desktop":
            pic = "电脑桌面：" + " / ".join(f"窗口 {w['id']}「{w.get('title', '')}」{scn.get(w.get('scene'), w.get('scene'))}" for w in s.get("windows", []))
        else:
            pic = scn.get(s.get("scene"), s.get("scene"))
            if s.get("weather") and s["weather"] != "none":
                pic += " · " + wth.get(s["weather"], s["weather"])
            if s.get("time"):
                pic += " · " + ZH_TIME.get(s["time"], s["time"])
        if i == 0:
            trans = "开场"
        else:
            p = segs[i - 1]
            changed = p.get("scene") != s.get("scene") or p.get("frame", "") != s.get("frame", "")
            trans = ZH_TRANS[s.get("trans") or ("pixel" if changed else "cut")]
        doc.append(f"| {i + 1} | {s['t0']:.1f}–{s['t1']:.1f}s | {pic} | {trans} | {_camera(s)} | {'、'.join(map(str, ids)) or '—'} |")
    doc += ["", "## 逐段", ""]
    for i, s in enumerate(segs):
        doc += [f"### 第 {i + 1} 段 · {s['t0']:.1f}–{s['t1']:.1f}s", ""]
        if shots.get(i):
            doc += [" ".join(shots[i]), ""]
        frames = s.get("windows", []) if s.get("frame") == "desktop" else [s]
        for f in frames:
            if f is not s:
                mv = f"，{f['move'][0]:.1f}s 放大" if f.get("move") else ""
                dock = f"，{f['toDock']:.1f}s 收进 Dock" if f.get("toDock") else ""
                doc.append(f"**窗口 {f['id']}「{f.get('title', '')}」** {scn.get(f.get('scene'), f.get('scene'))}{mv}{dock}")
                doc.append("")
            doc.append(f"- 角色：{_actors(st, f, lib)}")
            doc.append(f"- 剧情动作：{_beats(st, f)}")
            if f is not s:
                doc.append("")
        for lb in s.get("labels", []) or []:
            doc.append(f"- 画面文字：「{lb['text']}」")
        if seg_lines[i]:
            doc.append("- 歌词：" + "；".join(f"第 {lid} 句{_line_way(lines_cfg.get(str(lid), {}))}" for lid in seg_lines[i]))
        doc.append("")
    ev = st.get("events", [])
    if ev or st.get("outro"):
        doc += ["## 卡点与片尾", ""] + [f"- {e['t']:.1f}s {ZH_EVENT.get(e['type'], e['type'])}" for e in ev]
        if st.get("outro"):
            doc.append(f"- {st['outro']['t0']:.1f}s 片名卡")
        doc.append("")
    if warns:
        doc += ["## 检查提醒", ""] + [f"- {w}" for w in warns] + [""]
    (proj / "分镜表.md").write_text("\n".join(doc), encoding="utf-8")
    cfg["board_rev"] = rev
    save_cfg(proj, cfg)
    n = sum(len(v) for v in shots.values())
    print(f"分镜表第 {rev} 版 → {proj / '分镜表.md'}（{len(segs)} 段" + (f"，{n} 张画面" if n else "") + "）")
    print("用户说可以出片以后运行 approve，再 render。")


def cmd_approve(a):
    proj = Path(a.project)
    errs, _ = check_story(proj)
    if errs:
        sys.exit("story.json 有错误，不能确认。先运行 check。")
    cfg = load_cfg(proj)
    if not cfg.get("board_rev"):
        sys.exit("还没出过分镜表，先运行 board 给用户看。")
    cfg["approved"] = {"hash": story_hash(proj), "rev": cfg["board_rev"]}
    save_cfg(proj, cfg)
    cmd_sync(a)
    print(f"已记下用户确认：分镜表第 {cfg['board_rev']} 版，story.json 指纹 {cfg['approved']['hash']}。现在可以 render。")


# ---------------------------------------------------------------- render
def hf_cmd():
    custom = os.environ.get("HF_CLI")
    if custom:
        return custom.split("|")
    return ["npx", "--yes", "hyperframes@0.8.81"]


def cmd_render(a):
    proj = Path(a.project).resolve()
    cfg = load_cfg(proj)
    if cfg.get("approved", {}).get("hash") != story_hash(proj) and not a.force:
        sys.exit("分镜还没被用户确认，或确认后 story.json 又改过。先 board 给用户看，用户说可以出片后 approve，再 render。")
    write_js(proj / "assets" / "story.js", "STORY", json.loads((proj / "story.json").read_text(encoding="utf-8")))
    out = proj / "renders" / (a.name or f"{cfg['title']}_像素MV.mp4")
    base = hf_cmd()
    shell = os.name == "nt" and base[0] == "npx"
    run(base + ["render", ".", "-o", str(out), "--fps", "30"], cwd=proj, shell=shell)
    size = out.stat().st_size / 1e6
    print(f"渲染完成：{out}（{size:.1f} MB）")
    if size > 30:
        prev = out.with_name(out.stem + "_预览.mp4")
        run(["ffmpeg", "-v", "error", "-y", "-i", str(out), "-c:v", "libx264", "-crf", "26", "-preset", "medium", "-c:a", "aac", "-b:a", "160k", str(prev)])
        print(f"手机预览版：{prev}（{prev.stat().st_size / 1e6:.1f} MB）")
    if a.sample:
        smp = out.with_name(out.stem + f"_样片{int(a.sample)}秒.mp4")
        run(["ffmpeg", "-v", "error", "-y", "-i", str(out), "-t", str(a.sample), "-c:v", "libx264", "-crf", "24", "-c:a", "aac", "-b:a", "160k", str(smp)])
        print(f"样片：{smp}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("new")
    p.add_argument("project"); p.add_argument("--audio", required=True); p.add_argument("--lyrics", required=True); p.add_argument("--title", required=True)
    p.add_argument("--start", type=float, default=None); p.add_argument("--end", type=float, default=None)
    p.add_argument("--look", default="base", choices=["base", "neon", "classic", "retro"])
    p.add_argument("--intensity", default=None, choices=["dj", "standard", "soft"])
    p.add_argument("--character", default=None); p.add_argument("--model", default="medium")
    p.set_defaults(fn=cmd_new)
    for name, fn in (("analyze", cmd_analyze), ("draft", cmd_draft), ("sync", cmd_sync), ("check", cmd_check), ("upgrade", cmd_upgrade)):
        q = sub.add_parser(name); q.add_argument("project"); q.set_defaults(fn=fn)
    q = sub.add_parser("story"); q.add_argument("project"); q.add_argument("--force", action="store_true"); q.set_defaults(fn=cmd_story)
    q = sub.add_parser("align"); q.add_argument("project"); q.add_argument("--model", default="medium"); q.set_defaults(fn=cmd_align)
    q = sub.add_parser("character"); q.add_argument("project"); q.add_argument("image"); q.set_defaults(fn=cmd_character)
    q = sub.add_parser("render"); q.add_argument("project"); q.add_argument("--name", default=None); q.add_argument("--sample", type=float, default=None); q.add_argument("--force", action="store_true", help="跳过分镜确认（只在用户明说时用）"); q.set_defaults(fn=cmd_render)
    q = sub.add_parser("board"); q.add_argument("project"); q.add_argument("--frames", action="store_true", help="每段截画面插进分镜表"); q.set_defaults(fn=cmd_board)
    q = sub.add_parser("approve"); q.add_argument("project"); q.set_defaults(fn=cmd_approve)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
