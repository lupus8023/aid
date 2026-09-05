"""AID deployment variant of MiniMax H3 Director's single-stage sampler.

Based on ``director/core_sampling.py`` from
https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director at commit
9e6b4fbe9011d41434a6c3b3757c40a5429cf278 (Apache-2.0). The AID-specific
change is the narrowly gated T8 dual-clock compatibility path below.

Matches ``video_minimax_h3_r2v.json``:
MiniMaxH3SigmaShift → BasicScheduler → BasicGuider (or CFGGuider) →
KSamplerSelect → RandomNoise → SamplerCustomAdvanced.
"""

from __future__ import annotations

import importlib
import logging
from typing import Any, Callable

log = logging.getLogger("ComfyUI-MiniMaxH3-Director.director.core_sampling")

PhaseCallback = Callable[[str, float], None]
StepPreviewCallback = Callable[[int, int, Any], None]


def _unpack_node_output(out):
    if hasattr(out, "args"):
        args = out.args
        if args:
            return args
    if isinstance(out, (tuple, list)):
        return out
    raise RuntimeError(f"Unexpected node output type: {type(out)!r}")


def _use_basic_guider(cfg: float, negative) -> bool:
    """Official r2v template uses BasicGuider (no CFG)."""
    if negative:
        return False
    return abs(float(cfg) - 1.0) < 1e-6


def _t8_dual_clock_setup(model, latent, steps, scheduler, shift_video, shift_audio):
    """Resolve the installed T8 sampler through ComfyUI's node registry."""
    from nodes import NODE_CLASS_MAPPINGS

    sampler_class = NODE_CLASS_MAPPINGS.get("MiniMaxH3DualClockSamplerT8")
    if sampler_class is None:
        raise RuntimeError(
            "AID four-step Director requires MiniMaxH3DualClockSamplerT8 on this older ComfyUI core"
        )
    package = sampler_class.__module__.rsplit(".", 1)[0]
    sampling = importlib.import_module(f"{package}.sampling")
    return sampling.setup_dual_clock_sampling(
        model,
        latent,
        int(steps),
        float(shift_video),
        float(shift_audio),
        sampler_name="dual_clock_euler",
        scheduler=str(scheduler),
    )


def sample_single_stage(
    *,
    model,
    positive,
    negative,
    latent,
    seed: int,
    cfg: float,
    steps: int,
    sampler_name: str,
    scheduler: str,
    shift_video: float = 12.0,
    shift_audio: float = 3.0,
    on_phase: PhaseCallback | None = None,
    on_step_preview: StepPreviewCallback | None = None,
    preview_every: int = 1,
    denoise: float = 1.0,
    phase_name: str = "sample",
    sigmas=None,
    apply_shift: bool = True,
):
    import torch
    from comfy_extras.nodes_custom_sampler import (
        BasicGuider,
        BasicScheduler,
        CFGGuider,
        KSamplerSelect,
        RandomNoise,
        SamplerCustomAdvanced,
    )
    from comfy_extras.nodes_minimax_h3 import MiniMaxH3SigmaShift

    def notify(phase: str, value: float) -> None:
        if on_phase:
            on_phase(phase, value)

    notify(phase_name, 0)
    use_aid_t8_compat = (
        str(sampler_name) == "euler"
        and int(steps) == 4
        and str(scheduler) == "simple"
        and abs(float(shift_video) - 12.0) < 1e-6
        and abs(float(shift_audio) - 3.0) < 1e-6
        and abs(float(denoise) - 1.0) < 1e-6
        and sigmas is None
        and apply_shift
    )
    if use_aid_t8_compat:
        model_use, sampler_obj, sigma_t = _t8_dual_clock_setup(
            model, latent, steps, scheduler, shift_video, shift_audio
        )
        log.info("AID Director: T8 dual-clock Euler compatibility path")
    else:
        model_use = model
        if apply_shift:
            shifted = MiniMaxH3SigmaShift.execute(model, float(shift_video), float(shift_audio))
            model_use = _unpack_node_output(shifted)[0]

    if not use_aid_t8_compat and sigmas is not None:
        if torch.is_tensor(sigmas):
            sigma_t = sigmas.detach().float().cpu().reshape(-1)
        else:
            sigma_t = torch.tensor([float(x) for x in sigmas], dtype=torch.float32)
    elif not use_aid_t8_compat:
        denoise_use = float(max(0.0, min(1.0, denoise)))
        sigma_out = BasicScheduler.execute(
            model_use, str(scheduler), int(steps), denoise_use
        )
        sigma_t = _unpack_node_output(sigma_out)[0]

    if not use_aid_t8_compat:
        sampler_obj = _unpack_node_output(KSamplerSelect.execute(str(sampler_name)))[0]
    noise_obj = _unpack_node_output(RandomNoise.execute(int(seed)))[0]

    neg = negative if negative else []
    if _use_basic_guider(cfg, neg):
        guider = _unpack_node_output(BasicGuider.execute(model_use, positive))[0]
    else:
        guider = _unpack_node_output(
            CFGGuider.execute(model_use, positive, neg, float(cfg))
        )[0]

    def _run_official() -> dict:
        sampled = SamplerCustomAdvanced.execute(
            noise_obj, guider, sampler_obj, sigma_t, latent
        )
        return _unpack_node_output(sampled)[0]

    if on_step_preview is None:
        out = _run_official()
    else:
        orig_sample = guider.sample
        every = max(1, int(preview_every))

        def sample_wrapped(noise, latent_image, sampler, sigmas_in, **kwargs):
            inner_cb = kwargs.get("callback")

            def callback(step, x0, x, total_steps):
                try:
                    last = max(0, int(total_steps) - 1)
                    if int(preview_every) < 0:
                        show = step >= last
                    else:
                        show = step % every == 0 or step >= last
                    if show:
                        on_step_preview(int(step), int(total_steps), x0)
                except Exception as exc:
                    log.debug("Step preview callback skipped: %s", exc)
                if inner_cb is not None:
                    inner_cb(step, x0, x, total_steps)

            kwargs["callback"] = callback
            return orig_sample(noise, latent_image, sampler, sigmas_in, **kwargs)

        guider.sample = sample_wrapped
        try:
            out = _run_official()
        finally:
            guider.sample = orig_sample

    notify(phase_name, 1)
    return out
