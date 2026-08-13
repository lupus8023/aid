#!/usr/bin/env python3
"""Run SCAIL2 Base + Extend segments against a local ComfyUI server.

The AID companion uploads this script and a per-run config to the GPU host.
Progress is persisted beside the output so browser polling survives page reloads.
"""

import json
import os
import fcntl
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path


COMFY_URL = "http://127.0.0.1:8188"


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json_atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False)
    os.replace(temporary, path)


def request_json(route, payload=None, timeout=120):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        COMFY_URL + route,
        data=body,
        headers={"Content-Type": "application/json"} if body is not None else {},
        method="POST" if body is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ComfyUI API {route} returned {error.code}: {details[:2000]}") from error


def patch_node(prompt, node_id, **inputs):
    node = prompt.get(node_id)
    if not node or not isinstance(node.get("inputs"), dict):
        raise RuntimeError(f"SCAIL2 template is missing node {node_id}")
    node["inputs"].update(inputs)


def common_values(config, segment_index):
    seed = int(config["seed"])
    return {
        "source": config["source_file"],
        "reference": config["reference_file"],
        "prompt": config["prompt"],
        "video_subject": config.get("video_subject") or "person",
        "reference_subject": config.get("reference_subject") or "person",
        "width": int(config["width"]),
        "height": int(config["height"]),
        "seed": seed,
        "segment_index": segment_index,
    }


def add_product_preservation(prompt, config, namespace, generated_image, source_image, create_video, trim_overlap):
    subject = str(config.get("product_subject") or "product").strip() or "product"
    prefix = f"aid_product_{namespace.replace(':', '_')}"
    text_id = prefix + "_text"
    track_id = prefix + "_track"
    mask_id = prefix + "_mask"
    grow_id = prefix + "_grow"
    feather_id = prefix + "_feather"
    sam_model_id = namespace + ("193" if namespace == "213:" else "243")
    source_for_composite = source_image
    mask_for_composite = [feather_id, 0]
    prompt[text_id] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": subject, "clip": [sam_model_id, 1]},
        "_meta": {"title": "AID Product Detection Text"},
    }
    prompt[track_id] = {
        "class_type": "SAM3_VideoTrack",
        "inputs": {
            "detection_threshold": 0.35, "max_objects": 8, "detect_interval": 1,
            "images": source_image, "model": [sam_model_id, 0], "conditioning": [text_id, 0],
        },
        "_meta": {"title": "AID Track Original Product"},
    }
    prompt[mask_id] = {
        "class_type": "SAM3_TrackToMask",
        "inputs": {"track_data": [track_id, 0], "object_indices": ""},
        "_meta": {"title": "AID Product Protection Mask"},
    }
    prompt[grow_id] = {
        "class_type": "GrowMask",
        "inputs": {"expand": 2, "tapered_corners": True, "mask": [mask_id, 0]},
        "_meta": {"title": "AID Expand Product Protection"},
    }
    prompt[feather_id] = {
        "class_type": "FeatherMask",
        "inputs": {"left": 4, "top": 4, "right": 4, "bottom": 4, "mask": [grow_id, 0]},
        "_meta": {"title": "AID Feather Product Protection"},
    }
    white_id = prefix + "_white"
    neutral_id = prefix + "_neutral_fill"
    exclude_id = prefix + "_exclude_from_person"
    size_id = namespace + ("163" if namespace == "213:" else "220")
    scail_id = namespace + ("114" if namespace == "213:" else "259")
    colored_mask_id = namespace + ("197" if namespace == "213:" else "245")
    prompt[white_id] = {
        "class_type": "EmptyImage",
        "inputs": {
            "width": [size_id, 0], "height": [size_id, 1], "batch_size": [size_id, 2],
            "color": 16777215,
        },
        "_meta": {"title": "AID White Replacement Background"},
    }
    prompt[neutral_id] = {
        "class_type": "ImageBlur",
        "inputs": {"blur_radius": 31, "sigma": 10.0, "image": source_image},
        "_meta": {"title": "AID Neutralise Product During Generation"},
    }
    prompt[exclude_id] = {
        "class_type": "ImageCompositeMasked",
        "inputs": {
            "x": 0, "y": 0, "resize_source": False,
            "destination": [colored_mask_id, 0], "source": [white_id, 0], "mask": [grow_id, 0],
        },
        "_meta": {"title": "AID Exclude Product from Person Replacement"},
    }
    patch_node(prompt, scail_id, pose_video_mask=[exclude_id, 0])
    pose_video_id = namespace + ("156" if namespace == "213:" else "218")
    pose_neutral_id = prefix + "_pose_neutral"
    prompt[pose_neutral_id] = {
        "class_type": "ImageCompositeMasked",
        "inputs": {
            "x": 0, "y": 0, "resize_source": False,
            "destination": source_image, "source": [neutral_id, 0], "mask": [grow_id, 0],
        },
        "_meta": {"title": "AID Hide Product from Generative Pose Input"},
    }
    patch_node(prompt, scail_id, pose_video=[pose_neutral_id, 0])
    if trim_overlap:
        source_trim_id = prefix + "_source_trim"
        mask_trim_id = prefix + "_mask_trim"
        prompt[source_trim_id] = {
            "class_type": "ImageFromBatch",
            "inputs": {"batch_index": 5, "length": 4096, "image": source_image},
            "_meta": {"title": "AID Trim Product Source Overlap"},
        }
        prompt[mask_trim_id] = {
            "class_type": "GetImageRangeFromBatch",
            "inputs": {"start_index": 5, "num_frames": 4096, "masks": [feather_id, 0]},
            "_meta": {"title": "AID Trim Product Mask Overlap"},
        }
        source_for_composite = [source_trim_id, 0]
        mask_for_composite = [mask_trim_id, 1]
    composite_id = prefix + "_composite"
    prompt[composite_id] = {
        "class_type": "ImageCompositeMasked",
        "inputs": {
            "x": 0, "y": 0, "resize_source": False,
            "destination": generated_image, "source": source_for_composite, "mask": mask_for_composite,
        },
        "_meta": {"title": "AID Restore Original Product Pixels"},
    }
    patch_node(prompt, create_video, images=[composite_id, 0])


def add_product_replacement(prompt, config, namespace):
    product_reference = str(config.get("product_reference_file") or "").strip()
    if not product_reference:
        raise RuntimeError("Product replacement mode requires product_reference_file")
    prefix = f"aid_replace_{namespace.replace(':', '_')}"
    product_loader = prefix + "_product_reference"
    sam_model_id = namespace + ("193" if namespace == "213:" else "243")
    reference_batch = prefix + "_reference_batch"
    prompt[product_loader] = {
        "class_type": "LoadImage",
        "inputs": {"image": product_reference},
        "_meta": {"title": "AID Product Reference"},
    }
    character_text = prefix + "_character_text"
    product_text = prefix + "_product_text"
    character_mask = prefix + "_character_mask"
    product_mask = prefix + "_product_mask"
    reference_mask_batch = prefix + "_reference_mask_batch"
    prompt[reference_batch] = {
        "class_type": "BatchImagesNode",
        "inputs": {"images.image0": ["30", 0], "images.image1": [product_loader, 0]},
        "_meta": {"title": "AID Character and Product References"},
    }
    product_subject = str(config.get("product_subject") or "product").strip() or "product"
    product_reference_subject = str(config.get("product_reference_subject") or product_subject).strip() or product_subject
    video_subject = str(config.get("video_subject") or "person").strip() or "person"
    reference_subject = str(config.get("reference_subject") or "person").strip() or "person"
    prompt[character_text] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": reference_subject, "clip": [sam_model_id, 1]},
        "_meta": {"title": "AID Character Reference Detection"},
    }
    prompt[product_text] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": product_reference_subject, "clip": [sam_model_id, 1]},
        "_meta": {"title": "AID Product Reference Detection"},
    }
    prompt[character_mask] = {
        "class_type": "SAM3_Detect",
        "inputs": {
            "threshold": 0.4, "refine_iterations": 2, "individual_masks": False,
            "model": [sam_model_id, 0], "image": ["30", 0], "conditioning": [character_text, 0],
        },
        "_meta": {"title": "AID Character Reference Mask"},
    }
    prompt[product_mask] = {
        "class_type": "SAM3_Detect",
        "inputs": {
            "threshold": 0.4, "refine_iterations": 2, "individual_masks": False,
            "model": [sam_model_id, 0], "image": [product_loader, 0], "conditioning": [product_text, 0],
        },
        "_meta": {"title": "AID Product Reference Mask"},
    }
    prompt[reference_mask_batch] = {
        "class_type": "MaskBatchMulti",
        "inputs": {"inputcount": 2, "mask_1": [character_mask, 0], "mask_2": [product_mask, 0]},
        "_meta": {"title": "AID Character and Product Reference Masks"},
    }
    # Extend prompts are cloned from the base workflow under a different group,
    # and their node suffixes are not identical to the base group. Keep the
    # mapping explicit so segment 2+ never tries to patch a non-existent
    # `262:191` node (the extend equivalent is `262:242`).
    if namespace == "213:":
        nodes = {
            "video_text": "213:191",
            "video_track": "213:196",
            "colored_mask": "213:197",
            "reference_resize": "213:76",
            "scail": "213:114",
        }
    else:
        nodes = {
            "video_text": "262:242",
            "video_track": "262:244",
            "colored_mask": "262:245",
            "reference_resize": "262:256",
            "scail": "262:259",
        }
    patch_node(prompt, nodes["video_text"], text=f"{video_subject}. {product_subject}.")
    patch_node(prompt, nodes["video_track"], max_objects=8)
    patch_node(prompt, nodes["colored_mask"], sort_by="area", ref_track_data=[reference_mask_batch, 0])
    patch_node(prompt, nodes["reference_resize"], image=[reference_batch, 0])
    patch_node(prompt, nodes["scail"], reference_image=[reference_batch, 0])


def apply_product_mode(prompt, config, namespace, generated_image, source_image, create_video, trim_overlap=False):
    mode = str(config.get("product_mode") or "preserve")
    if mode == "preserve":
        add_product_preservation(
            prompt, config, namespace, generated_image, source_image, create_video, trim_overlap,
        )
    elif mode == "replace":
        add_product_replacement(prompt, config, namespace)


def build_base_prompt(config, frame_count):
    prompt = read_json(config["base_template"])
    values = common_values(config, 1)
    patch_node(prompt, "155", file=values["source"])
    patch_node(prompt, "30", image=values["reference"])
    patch_node(prompt, "213:3", text=values["prompt"])
    patch_node(prompt, "213:191", text=values["video_subject"])
    patch_node(prompt, "213:212", text=values["reference_subject"])
    patch_node(prompt, "213:177", length=frame_count)
    patch_node(prompt, "213:178", value=values["width"])
    patch_node(prompt, "213:179", value=values["height"])
    patch_node(prompt, "213:183", value=1)
    patch_node(prompt, "213:203", value=True)
    patch_node(prompt, "213:19", noise_seed=values["seed"])
    patch_node(prompt, "202", filename_prefix=f'{config["output_prefix"]}/segment_001')
    # Audio is restored once after all video segments have been concatenated.
    prompt["201"]["inputs"].pop("audio", None)
    apply_product_mode(prompt, config, "213:", ["213:6", 0], ["213:156", 0], "201")
    return prompt


BASE_TO_EXTEND = {
    "213:11": "262:216", "213:7": "262:217", "213:156": "262:218", "213:157": "262:219",
    "213:163": "262:220", "213:9": "262:221", "213:75": "262:222", "213:154": "262:223",
    "213:95": "262:224", "213:27": "262:225", "213:18": "262:226", "213:19": "262:227",
    "213:168": "262:228", "213:167": "262:229", "213:165": "262:230", "213:166": "262:231",
    "213:169": "262:232", "213:170": "262:233", "213:171": "262:234", "213:177": "262:235",
    "213:178": "262:236", "213:179": "262:237", "213:180": "262:238", "213:182": "262:239",
    "213:183": "262:240", "213:184": "262:241", "213:191": "262:242", "213:193": "262:243",
    "213:196": "262:244", "213:197": "262:245", "213:198": "262:246", "213:203": "262:247",
    "213:6": "262:250", "213:172": "262:255", "213:76": "262:256", "213:4": "262:257",
    "213:3": "262:258", "213:114": "262:259", "213:212": "262:261", "213:318": "262:319",
}


def rename_base_links(value):
    if isinstance(value, list):
        if len(value) == 2 and value[0] in BASE_TO_EXTEND:
            return [BASE_TO_EXTEND[value[0]], value[1]]
        return [rename_base_links(item) for item in value]
    if isinstance(value, dict):
        return {key: rename_base_links(item) for key, item in value.items()}
    return value


def build_extend_prompt(config, segment_index, frame_count, previous_input_file):
    base = read_json(config["base_template"])
    prompt = {key: base[key] for key in ("30", "155", "215")}
    for base_id, extend_id in BASE_TO_EXTEND.items():
        if base_id not in base:
            raise RuntimeError(f"SCAIL2 base template is missing node {base_id}")
        prompt[extend_id] = rename_base_links(base[base_id])
    values = common_values(config, segment_index)
    patch_node(prompt, "155", file=values["source"])
    patch_node(prompt, "30", image=values["reference"])
    patch_node(prompt, "262:258", text=values["prompt"])
    patch_node(prompt, "262:242", text=values["video_subject"])
    patch_node(prompt, "262:261", text=values["reference_subject"])
    patch_node(prompt, "262:235", length=frame_count)
    patch_node(prompt, "262:236", value=values["width"])
    patch_node(prompt, "262:237", value=values["height"])
    patch_node(prompt, "262:240", value=segment_index)
    patch_node(prompt, "262:241", **{"values.b": 81, "values.c": 5})
    patch_node(prompt, "262:247", value=True)
    patch_node(prompt, "262:227", noise_seed=values["seed"])
    patch_node(prompt, "262:259", previous_frames=["aid_previous_components", 0])
    prompt["262:251"] = {
        "class_type": "ImageFromBatch",
        "inputs": {"batch_index": 5, "length": 4096, "image": ["262:250", 0]},
        "_meta": {"title": "AID Remove Five Overlap Frames"},
    }
    prompt["262:253"] = {
        "class_type": "ImageFromBatch",
        "inputs": {"batch_index": -1, "length": 1, "image": ["aid_previous_components", 0]},
        "_meta": {"title": "AID Previous Last Frame"},
    }
    prompt["262:252"] = {
        "class_type": "ColorTransfer",
        "inputs": {
            "method": "reinhard_lab", "source_stats": "per_frame", "strength": 1.0,
            "image_target": ["262:251", 0], "image_ref": ["262:253", 0],
        },
        "_meta": {"title": "AID Segment Color Match"},
    }
    prompt["aid_previous_video"] = {
        "class_type": "LoadVideo",
        "inputs": {"file": previous_input_file, "video-preview": ""},
        "_meta": {"title": "AID Previous Segment"},
    }
    prompt["aid_previous_components"] = {
        "class_type": "GetVideoComponents",
        "inputs": {"video": ["aid_previous_video", 0]},
        "_meta": {"title": "AID Previous Frames"},
    }
    prompt["aid_segment_video"] = {
        "class_type": "CreateVideo",
        "inputs": {"fps": ["215", 2], "bit_depth": 8, "images": ["262:252", 0]},
        "_meta": {"title": "AID Create Extend Segment"},
    }
    prompt["aid_segment_save"] = {
        "class_type": "SaveVideo",
        "inputs": {
            "filename_prefix": f'{config["output_prefix"]}/segment_{segment_index:03d}',
            "format": "auto",
            "codec": "auto",
            "video": ["aid_segment_video", 0],
        },
        "_meta": {"title": "AID Save Extend Segment"},
    }
    apply_product_mode(
        prompt, config, "262:", ["262:252", 0], ["262:218", 0], "aid_segment_video", True,
    )
    return prompt


def execution_error(item):
    for message in item.get("status", {}).get("messages", []):
        if not isinstance(message, list) or len(message) < 2 or message[0] != "execution_error":
            continue
        details = message[1] or {}
        node = details.get("node_type") or details.get("node_id") or "ComfyUI"
        reason = details.get("exception_message") or details.get("exception_type") or "unknown error"
        return f"{node}: {reason}"
    return "ComfyUI execution failed"


def find_video_output(value):
    if isinstance(value, list):
        for item in value:
            result = find_video_output(item)
            if result:
                return result
    elif isinstance(value, dict):
        filename = str(value.get("filename") or "")
        if Path(filename).suffix.lower() in {".mp4", ".mov", ".webm", ".mkv", ".m4v"}:
            return {
                "filename": filename,
                "subfolder": str(value.get("subfolder") or ""),
                "type": str(value.get("type") or "output"),
            }
        for item in value.values():
            result = find_video_output(item)
            if result:
                return result
    return None


def run_prompt(prompt, client_id, status, status_path, segment_index):
    submitted = request_json("/prompt", {"prompt": prompt, "client_id": client_id})
    prompt_id = str(submitted.get("prompt_id") or "")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {submitted}")
    status["promptId"] = prompt_id
    status["currentSegment"] = segment_index
    write_json_atomic(status_path, status)
    while True:
        history = request_json(f"/history/{prompt_id}", timeout=30)
        item = history.get(prompt_id)
        if not item:
            time.sleep(3)
            continue
        state = item.get("status", {})
        if state.get("status_str") == "error":
            raise RuntimeError(execution_error(item))
        output = find_video_output(item.get("outputs", {}))
        if output:
            return output
        if state.get("completed"):
            raise RuntimeError("ComfyUI completed without returning a video file")
        time.sleep(3)


def output_path(config, output):
    root = Path(config["comfy_root"])
    bucket = "temp" if output.get("type") == "temp" else "output"
    return root / bucket / output.get("subfolder", "") / output["filename"]


def concat_and_restore_audio(config, segment_paths, final_path):
    final_path.parent.mkdir(parents=True, exist_ok=True)
    concat_file = final_path.parent / "segments.txt"
    with open(concat_file, "w", encoding="utf-8") as handle:
        for segment in segment_paths:
            escaped = str(segment).replace("'", "'\\''")
            handle.write(f"file '{escaped}'\n")
    source_path = Path(config["comfy_root"]) / "input" / config["source_file"]
    command = [
        "ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-i", str(source_path), "-map", "0:v:0", "-map", "1:a?", "-c:v", "copy", "-c:a", "aac",
        "-shortest", "-movflags", "+faststart", str(final_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode == 0:
        return
    command[command.index("copy")] = "libx264"
    command[command.index("libx264") + 1:command.index("-c:a")] = ["-preset", "medium", "-crf", "18"]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {result.stderr[-2000:]}")


def main(config_path):
    config = read_json(config_path)
    global COMFY_URL
    COMFY_URL = config.get("comfy_url") or COMFY_URL
    status_path = Path(config["status_path"])
    status_path.parent.mkdir(parents=True, exist_ok=True)
    lock_handle = open(status_path.parent / "runner.lock", "w", encoding="utf-8")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        # A companion request can be retried while the detached SSH command is
        # still returning. Only one runner may own and update a task directory.
        return
    lock_handle.write(str(os.getpid()))
    lock_handle.flush()
    total_segments = len(config["segment_frames"])
    status = {
        "status": "processing",
        "stage": "segment",
        "runId": config["run_id"],
        "totalSegments": total_segments,
        "completedSegments": 0,
        "currentSegment": 1,
        "progress": 1,
        "segments": [],
        "sourceFrames": int(config.get("source_frames") or 0),
        "targetFrames": int(config.get("target_frames") or sum(config["segment_frames"])),
        "productMode": str(config.get("product_mode") or "preserve"),
    }
    try:
        write_json_atomic(status_path, status)
        segment_paths = []
        previous_input_file = None
        for index, frame_count in enumerate(config["segment_frames"], start=1):
            status["currentSegment"] = index
            status["progress"] = round(((index - 1) / total_segments) * 90)
            write_json_atomic(status_path, status)
            if index == 1:
                prompt = build_base_prompt(config, int(frame_count))
            else:
                prompt = build_extend_prompt(config, index, int(frame_count), previous_input_file)
            output = run_prompt(prompt, f'aid-scail2-long-{config["run_id"]}-{index}', status, status_path, index)
            segment_path = output_path(config, output)
            if not segment_path.is_file():
                raise RuntimeError(f"ComfyUI output file not found: {segment_path}")
            segment_paths.append(segment_path)
            previous_input_file = f'{config["input_subfolder"]}/previous_{index:03d}.mp4'
            previous_path = Path(config["comfy_root"]) / "input" / previous_input_file
            previous_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(segment_path, previous_path)
            status["completedSegments"] = index
            status["segments"].append(output)
            status["progress"] = round((index / total_segments) * 90)
            write_json_atomic(status_path, status)

        status["stage"] = "stitching"
        status["progress"] = 94
        write_json_atomic(status_path, status)
        final_path = Path(config["final_path"])
        concat_and_restore_audio(config, segment_paths, final_path)
        status.update({
            "status": "completed",
            "stage": "completed",
            "progress": 100,
            "output": {
                "filename": final_path.name,
                "subfolder": str(final_path.parent.relative_to(Path(config["comfy_root"]) / "output")),
                "type": "output",
            },
        })
        write_json_atomic(status_path, status)
    finally:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
        lock_handle.close()


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except Exception as error:
        try:
            config = read_json(sys.argv[1])
            status_path = Path(config["status_path"])
            current = read_json(status_path) if status_path.exists() else {}
            current.update({
                "status": "failed",
                "stage": "failed",
                "error": str(error),
                "traceback": traceback.format_exc()[-6000:],
            })
            write_json_atomic(status_path, current)
        except Exception:
            traceback.print_exc()
        raise
