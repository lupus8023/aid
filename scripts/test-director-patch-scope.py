"""CPU-only contract probe on the installed ComfyUI/T8 runtime; no weights or generation."""
import importlib
import importlib.util
import sys
import types

sys.path.insert(0, "/root/ComfyUI")
patch_path = sys.argv[1]
sys.argv = [sys.argv[0], "--cpu"]
package = types.ModuleType("aid_scope_t8_probe")
package.__path__ = ["/root/ComfyUI/custom_nodes/comfyui-minimax-h3-audio-T8"]
sys.modules[package.__name__] = package
t8 = importlib.import_module(package.__name__ + ".conditioning")
spec = importlib.util.spec_from_file_location("aid_director_scope_probe", patch_path)
patches = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = patches
spec.loader.exec_module(patches)
import comfy.model_base as model_base
import comfy.ldm.minimax.model as model

layout_original = model.PackedLayout.__init__
payload_original = model_base.MiniMaxH3.extra_conds
assert t8.assert_hybrid_layout_contract() == "legacy_sentinel"

@patches.scoped_continuity_patches
def director_like_call(fail=False):
    patches.ensure_layout_patch()  # Includes Director's real tensor layout self-test.
    patches.ensure_payload_patch()
    assert model.PackedLayout.__init__ is not layout_original
    try:
        t8.assert_hybrid_layout_contract()
    except RuntimeError as error:
        assert "Hybrid path is disabled" in str(error)
    else:
        raise AssertionError("baseline reproduction failed")
    if fail:
        raise ValueError("simulated sampling interruption")
    return "director-finished"

for fail in (False, True, False):
    try:
        result = director_like_call(fail)
        assert result == "director-finished"
    except ValueError as error:
        assert fail and str(error) == "simulated sampling interruption"
    assert model.PackedLayout.__init__ is layout_original
    assert model_base.MiniMaxH3.extra_conds is payload_original
    assert not patches.layout_patch_applied()
    assert not patches.payload_patch_applied()
    assert t8.assert_hybrid_layout_contract() == "legacy_sentinel"

print("PASS: reproduced Director->T8 conflict; cleanup restores exact core functions after success/failure/reuse; T8 guard remains enabled")
