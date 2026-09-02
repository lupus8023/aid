#!/usr/bin/env python3
"""Run temporal subtitle removal as a recoverable remote Companion task."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import traceback
import urllib.request
from pathlib import Path


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def run(command: list[str], cwd: Path | None = None) -> None:
    subprocess.run(command, check=True, cwd=str(cwd) if cwd else None)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: aid_subtitle_repair_runner.py CONFIG.json")
    config = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    status_path = Path(config["status_path"])
    output_dir = status_path.parent
    source = Path(config["source_path"])
    final_path = Path(config["final_path"])
    python = Path(config.get("engine_python", "/root/aid-video-repair/venv/bin/python"))
    propainter = Path(config.get("propainter_root", "/root/aid-video-repair/ProPainter"))
    mask_script = Path(config["mask_script"])
    work = output_dir / "work"
    frames = work / "frames"
    masks = work / "masks"
    result = work / "propainter"
    try:
        if not source.is_file() or source.stat().st_size <= 0:
            raise RuntimeError("去字幕源视频不存在或为空")
        for required in (python, propainter / "inference_propainter.py", mask_script):
            if not required.exists():
                raise RuntimeError(f"时序去字幕运行环境缺少 {required}")
        if work.exists():
            shutil.rmtree(work)
        frames.mkdir(parents=True)
        masks.mkdir(parents=True)
        result.mkdir(parents=True)
        atomic_json(status_path, {"status": "processing", "stage": "detecting_subtitles", "progress": 5})
        run([
            str(python), str(mask_script),
            "--input", str(source),
            "--frames-dir", str(frames),
            "--mask-dir", str(masks),
        ])
        mask_count = len(list(masks.glob("*.png")))
        frame_count = len(list(frames.glob("*.png")))
        if frame_count <= 0 or mask_count != frame_count:
            raise RuntimeError("字幕检测没有生成完整逐帧掩膜")
        atomic_json(status_path, {
            "status": "processing", "stage": "temporal_inpainting", "progress": 30,
            "completedSegments": 0, "totalSegments": 1,
        })
        # Ask ComfyUI to release cached models. A short subvideo window keeps
        # peak VRAM bounded even when the backend retains part of its H3 stack.
        try:
            request = urllib.request.Request(
                config.get("comfy_url", "http://127.0.0.1:8188") + "/free",
                data=b'{"unload_models":true,"free_memory":true}',
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(request, timeout=10).read()
        except Exception:
            pass
        run([
            str(python), str(propainter / "inference_propainter.py"),
            "--video", str(frames),
            "--mask", str(masks),
            "--output", str(result),
            "--mask_dilation", "2",
            "--ref_stride", "10",
            "--neighbor_length", "8",
            "--subvideo_length", "10",
            "--raft_iter", "20",
            "--save_fps", str(config.get("fps", 24)),
            "--fp16",
        ], cwd=propainter)
        repaired = result / frames.name / "inpaint_out.mp4"
        if not repaired.is_file() or repaired.stat().st_size <= 0:
            raise RuntimeError("时序补帧没有生成视频")
        atomic_json(status_path, {"status": "processing", "stage": "muxing_source_audio", "progress": 92})
        run([
            config.get("ffmpeg", "ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(repaired), "-i", str(source),
            "-map", "0:v:0", "-map", "1:a:0?",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
            str(final_path),
        ])
        if not final_path.is_file() or final_path.stat().st_size <= 0:
            raise RuntimeError("时序去字幕成片为空")
        shutil.rmtree(work, ignore_errors=True)
        atomic_json(status_path, {
            "status": "completed", "stage": "completed", "progress": 100,
            "completedSegments": 1, "totalSegments": 1,
            "output": {
                "filename": final_path.name,
                "subfolder": config["output_subfolder"],
                "type": "output",
            },
        })
    except Exception as exc:
        atomic_json(status_path, {
            "status": "failed", "stage": "failed", "progress": 0,
            "error": str(exc)[:1800], "trace": traceback.format_exc()[-4000:],
        })
        raise


if __name__ == "__main__":
    main()
