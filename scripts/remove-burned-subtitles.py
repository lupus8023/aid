#!/usr/bin/env python3
"""Build frame masks for bright, non-diegetic burned subtitles.

The detector supplies text boxes, while a luminance/saturation/top-hat mask
limits removal to the bright glyph strokes inside those boxes.  This avoids
masking dark printing that legitimately belongs to a referenced product.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import easyocr
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--frames-dir", required=True)
    parser.add_argument("--mask-dir", required=True)
    parser.add_argument("--overlay-dir")
    parser.add_argument("--min-y-ratio", type=float, default=0.42)
    return parser.parse_args()


def subtitle_boxes(reader: easyocr.Reader, frame: np.ndarray, min_y_ratio: float) -> list[tuple[int, int, int, int]]:
    height, width = frame.shape[:2]
    horizontal, free = reader.detect(
        frame,
        min_size=14,
        text_threshold=0.55,
        low_text=0.25,
        link_threshold=0.3,
        canvas_size=max(width, height),
        mag_ratio=1.0,
        slope_ths=0.2,
        add_margin=0.08,
    )
    boxes: list[tuple[int, int, int, int]] = []
    for entry in horizontal[0] if horizontal else []:
        x0, x1, y0, y1 = map(int, entry)
        box_height = y1 - y0
        if (y0 + y1) / 2 < height * min_y_ratio:
            continue
        # H3's dialogue captions use a large screen-space type size. Tiny OCR
        # boxes in this band are normally immutable package printing, not the
        # burned caption that this repair is allowed to remove.
        if box_height < max(30, int(height * 0.025)) or box_height > height * 0.12 or x1 - x0 < 16:
            continue
        boxes.append((max(0, x0), min(width, x1), max(0, y0), min(height, y1)))
    for polygon in free[0] if free else []:
        points = np.asarray(polygon, dtype=np.int32)
        x0, y0 = points.min(axis=0)
        x1, y1 = points.max(axis=0)
        if (
            (y0 + y1) / 2 >= height * min_y_ratio
            and max(30, int(height * 0.025)) <= y1 - y0 <= height * 0.12
        ):
            boxes.append((max(0, int(x0)), min(width, int(x1)), max(0, int(y0)), min(height, int(y1))))
    return boxes


def glyph_mask(frame: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> np.ndarray:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    top_hat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (11, 7)))
    candidate = (
        (hsv[:, :, 2] >= 165)
        & (hsv[:, :, 1] <= 105)
        & ((top_hat >= 22) | (hsv[:, :, 2] >= 232))
    ).astype(np.uint8) * 255
    mask = np.zeros(gray.shape, dtype=np.uint8)
    for x0, x1, y0, y1 in boxes:
        region = candidate[y0:y1, x0:x1]
        # Subtitle glyphs have a meaningful amount of bright, neutral ink.
        # Physical dark product printing therefore does not enter the mask.
        if region.size and np.count_nonzero(region) / region.size >= 0.008:
            mask[y0:y1, x0:x1] = cv2.bitwise_or(mask[y0:y1, x0:x1], region)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    # H3 captions carry a dark outline/drop shadow well beyond the white fill.
    # Cover that ring too; otherwise an inpainting pass can leave readable
    # black character ghosts even though the bright strokes are gone.
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)), iterations=1)
    return mask


def main() -> None:
    args = parse_args()
    frames_dir = Path(args.frames_dir)
    mask_dir = Path(args.mask_dir)
    overlay_dir = Path(args.overlay_dir) if args.overlay_dir else None
    frames_dir.mkdir(parents=True, exist_ok=True)
    mask_dir.mkdir(parents=True, exist_ok=True)
    if overlay_dir:
        overlay_dir.mkdir(parents=True, exist_ok=True)

    capture = cv2.VideoCapture(args.input)
    if not capture.isOpened():
        raise SystemExit(f"Cannot open video: {args.input}")
    reader = easyocr.Reader(["en"], gpu=True, recognizer=False, verbose=False)
    index = 0
    masked = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        name = f"{index:05d}.png"
        boxes = subtitle_boxes(reader, frame, args.min_y_ratio)
        mask = glyph_mask(frame, boxes)
        cv2.imwrite(str(frames_dir / name), frame)
        cv2.imwrite(str(mask_dir / name), mask)
        if np.any(mask):
            masked += 1
        if overlay_dir:
            overlay = frame.copy()
            overlay[mask > 0] = (0, 0, 255)
            for x0, x1, y0, y1 in boxes:
                cv2.rectangle(overlay, (x0, y0), (x1, y1), (255, 128, 0), 2)
            cv2.imwrite(str(overlay_dir / name), overlay)
        index += 1
    capture.release()
    if not index:
        raise SystemExit("Video contained no frames")
    print(f"frames={index} masked_frames={masked}")


if __name__ == "__main__":
    main()
