# H3 pruned＋4步统一（2026-09-06）

用户要求独立图生视频、Story、连续剧统一采用 pruned 模型＋4步，并反馈该方案的实际观感优于原8步方案。

## 修正

`applyH3Fl2vaProfile` 原来对 `aid_multi_reference` 提前返回，导致多镜保留远端模板中的未裁剪 FL2VA＋旧四步 LoRA＋8步采样。现在三种普通视频入口均在工作流编译后强制完整配置，不再允许旧浏览器设置、环境配置或旧任务里的 `balanced8` / `legacy` 恢复旧栈。

| 入口 | 模型 | 步数 |
| --- | --- | --- |
| 单镜 I2VA / 带声音 Hybrid | minimax_h3_fl2va_pruned_int8_convrot.safetensors | 4 |
| 首尾帧 FL2VA / Hybrid | minimax_h3_fl2va_pruned_int8_convrot.safetensors | 4 |
| 多图多镜 Ref2VA conditioning | minimax_h3_fl2va_pruned_int8_convrot.safetensors | 4 |
| Director 连续长视频（已有配置） | minimax_h3_fl2va_pruned_int8_convrot.safetensors | 4 |

普通入口共同使用 DaSiWa Ref2VA Hybrid T8 四步 LoRA、INT8 ConvRot 文本编码器、shift_video=12、shift_audio=3、dual_clock_euler、simple、LoRA strength=1。模型链仍为 UNET → Sage → LoRA → Sampler。Director 使用自身 Euler 节点，既有 pruned/4步配置保持。

设置页移除8步/legacy选择；加载及保存历史设置时统一迁移到 dasiwa4。类型保留旧枚举值以便读取旧数据，但服务端不执行旧方案。

本次范围为视频创作生成。Z-Image 的8步是生图配置；未被普通生成链路调用的 V2V 去字幕编辑构建器为独立25步源视频编辑流程，不属于创作生成，未把它生硬改为四步。没有新增生成后字幕质检或自动重跑。

## 验证

- 回归：原全量627项通过；随后增加旧设置归一与多图/多音色引用保持两项，H3定向34项通过。
- 网页及Companion生产构建、TypeScript通过；28份真实存档工作流全部归一成功，condition输入保持不变。
- 云端控制样本：原《什么值得买》第二集首段任务 `25698f73-c3f1-4d18-80ae-522a91c20675`，三张参考图、单人音色、15秒。保留原始提示词、图片、音色、完整整数种子和时长，只修改上述模型/采样配置及输出文件前缀。
- 新任务 `37a1d5ef-2061-4a78-940d-397e17a015eb`，ComfyUI 校验接受，node_errors 为空。排在已有生产任务后执行，没有取消或修改已有任务。执行成功，总耗时341.44秒；输出H264＋AAC，736×1280，15.084秒。抽查0/2/4/6/8/10/12/14秒8个时间点未见烧录对白字幕（包括原先第2秒位置），但6/8/12秒附近可见叠化或双影；仅证实该配置可执行和这些抽样结果，未证实所有视频字幕根治或整体电影观感更优。

源码修改不会自动更新正在运行的0.1.199 Companion或已提交云端的生产任务。当前修改尚未发布。

## 实测产物

- 视频：`outputs/subtitle-investigation-20260906/pruned4-multishot.mp4`
- 实际云端任务完整history：`outputs/subtitle-investigation-20260906/pruned4-history.json`
- 抽帧：`outputs/subtitle-investigation-20260906/pruned4-contact.png`
- 精确保留原始整数seed的对照提交脚本：`outputs/subtitle-investigation-20260906/pruned4-smoke.py`，远端回执用于避免重复提交。


### 后续叠影对照修正

本页早期多镜试用了Ref2VA pruned基座，运行成功但有持续叠影。随后同种子/同提示/同参考/同LoRA/同四步只换回FL2VA pruned，对照 `4d5da7ed-1a1b-4d13-85c3-c5733a8960f2` 消除了抽查中的数秒双机位叠影。因此最终源码所有普通入口均采用单镜同款FL2VA pruned，不再按task_type换成Ref2VA权重；多图仍通过Ref2VA conditioning输入。该修正替代本页早期模型选择；该样片字幕再次出现，不能认为四步或换pruned根治字幕。详见 `docs/h3-ghosting-investigation-20260906.md`。
