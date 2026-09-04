# MiniMax H3 Director A/B 评估

## 2026-09-05 独立图生视频已接入（v0.1.194）

用户已明确选择先接独立“图生视频”页面，支持 30/60 秒连续生成；取代下面 9 月 4 日“尚未接入/本次只研究”的阶段状态，不改变历史实测结论。

- 页面新增 `director_continuous` 可选模式，默认原模式不变。约 30/60 秒分别整理为 3/6 个 10 秒段，H3 帧对齐与边界相位处理会造成少量实际时长偏差。
- `/api/prepare-long-video` 使用所配置的文本模型整理原稿，按段分配已有动作与完整台词，不重复整篇；支持提交前编辑。一次请求、保留草稿，不加入视觉/ASR 质检。原稿或时长改变后旧计划不可误用。
- `lib/h3Director.ts` 直接构造 Director API 图，仅第一段连接原始图片，后续连接 22 帧 AV 上下文；每段动作/台词本地时间移动到引导前缀之后，前缀由 Director 自行裁切。单任务输出全部片段合成的 MP4，不把第一段预览当终稿。
- 首版 480P 级（864×480 / 480×864，方形 640×640），DaSiWa 4-step，关闭 Refine；不支持外部音色、多图和尾帧，额外输入会明确提示，不默默忽略。原短视频仍可使用已有参考音色功能。
- 复用 SSH `/prompt`、`/queue`、`/history` 与下载链路；Director 数字节点 ID 每个新任务独立，避免跨任务磁盘缓存串用。已提交 ID 在浏览器持久化，刷新/查询失败/下载失败可继续查询，不重提 GPU 生成。
- 进度只读云端队列与可用的分段落盘计数；旧节点无该查询接口时显示“连续生成中（共 N 段）”，不伪造百分比、不阻断任务。完成只能选最终合并 `SaveVideo` 输出。
- Companion `h3DirectorLongVideo` 能力检查防止旧后端将请求降成短片；云端节点/权重检查失败在付费提交前报明缺项，不安装节点、不自动切回短视频。发布必须同步网站和 Companion。
- 自动测试及构建不等同于 GPU 效果实测。本轮未实际生成 30/60 秒视频、未测试长对白；仍为实验入口。历史 15.292 秒实测仅证明当时三段续接可工作。

验证：`npm run test:h3-director`，`npm run build`。v0.1.194 同步发布网站与 Companion；不重启或更新 GPU，不将模拟测试视为实际长视频效果验证。发布验收记录位于 `out/releases/v0.1.194/release-verification.json`。

另有 `scripts/i2v-director-ui-smoke.mjs` 浏览器冒烟：选择 60 秒、编辑六段中的一段、只提交一次、刷新后按原编号继续查询、旧 Companion 能力拦截；所有 API 均模拟，不消耗模型/GPU 额度。可通过 `AID_PLAYWRIGHT_MODULE` 与 `AID_BROWSER_EXECUTABLE` 使用本机已安装的 Playwright/Chrome，默认本地测试地址为 3041。

## 2026-09-04 长视频接入复核

- 当前官方仓库复核至 `6b585412a838473e94c68cd0a215f23c8dd0a1b7`。以下是源码/文档复核，不是新的 GPU 实测。
- 可以把一张图作为首段起点，一次提交多个片段，得到超过 15 秒的输出；不是将现有单段 H3 API 的 duration 改成 30/60。Director 内部逐段采样，将前段末尾音视频上下文钉入下一段，解码后裁掉引导前缀并合并。
- 首段使用指定图片，后续同场连续段使用前段运动状态，不应在每段重新锁回最初图片。R2V 可以另保留公共参考图/音频，但需要 ref2va，不能当作 FL2VA 的同一个接口。
- 现有独立 `app/image-to-video/page.tsx` 仍为单段提交；`lib/h3MotionContext.ts` 和已有 Director A/B builder 可复用部分分段/上下文经验，但独立页面尚未接入 Director 长视频。
- 建议首版单独增加可选 Director 长视频模式（30/60 秒作为产品预设，不是声称已经实测的模型档位），保留当前短视频后端。展示分段进度、任务 ID 与恢复状态，末段覆盖与音视频裁切要按同一时间轴处理。默认不启用 Refine，不加入视觉或 ASR 质检。
- 对白应先在生成输入中分配到各段，不能将整段台词重复传给每段，也不能把引导区裁切算入有效台词时间。当前任务未验证 30/60 秒带对白的实际效果，不将历史无对白 15.292 秒测试扩展为“长对白已通过”。
- 2026-09-04 新提交包含分段落盘后的像素释放，改善内存工作集；不能仅凭代码提交断言任意长度、分辨率都可稳定生成。
- 开源仓库 LICENSE 为 Apache-2.0；本次只研究接入，未复制其实现或更新 GPU 上已安装的节点。

来源：[官方 README](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/blob/6b585412a838473e94c68cd0a215f23c8dd0a1b7/README.md)、[连续段说明](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/blob/6b585412a838473e94c68cd0a215f23c8dd0a1b7/director/segment_continuity.py)、[执行与裁切](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/blob/6b585412a838473e94c68cd0a215f23c8dd0a1b7/director/executor_core.py)。本轮抓取副本保存在 `.firecrawl/h3-director-*`，不进入版本库。

---

测试日期：2026-09-02（Asia/Shanghai）

## 结论

建议把 MiniMax H3 Director 作为 AID 的实验性长镜头/无对白连续段后端，不要替换当前生产 H3 后端。

- 单段同分辨率测试比现有 4-step 私有工作流快约 18.5%，首帧硬锁更准。
- 三段连续生成可用：15.292 秒成片在 195.996 秒内完成，没有冻结，两个接缝的像素跳变仅为普通帧间运动的 1.05× 和 1.24×。
- 当前 `lanczos → 1344×768 → 二采` 不可作为生产高清化：二采发生 conditioning/latent shape mismatch，节点回退为单纯放大；输出更软，但 ComfyUI 总任务仍显示成功。
- 当前测试没有覆盖精确对白。插件仍有“段间引导吞末尾对白”的公开问题，AID 原有逐字台词和音色绑定仍需保留。更新说明：v0.1.190 已按用户要求移除自动成片的额外末尾 ASR gate；结尾由生成提示词约束，旧诊断不阻止交付，详见 `film-ending-audit.md`。

## 测试环境

- GPU：NVIDIA GeForce RTX 4090 D，49140 MiB
- ComfyUI：0.30.0
- Director：`9e6b4fb`（2026-09-01）
- 一采：MiniMax H3 FL2VA pruned INT8 + Sage Attention + DaSiWa 4-step LoRA
- Seed：`8829421`
- 输入：Nana 上海街拍首帧及同一份 H3 提示词
- 音频：H3 原生生成；本轮为无对白镜头

## 实测结果

| 测试 | 输出 | 实际执行 | 每秒成片耗时 | 峰值显存 | 首帧 RMSE | 首帧锐度 | 结果 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 现有基线 | 8s, 1280×736 | 156.800s | 19.600s | 未采集 | 29.292 | 1.283 | 成功 |
| Director 单段 | 8s, 1280×736 | 127.763s | 15.970s | 41.09 GiB | 8.013 | 0.939 | 成功 |
| Director 三段续拍 | 15.292s, 864×480 | 195.996s | 12.817s | 44.10 GiB | 9.435 | 1.324 | 成功 |
| Director 放大后二采 | 8s, 1344×768 | 151.248s | 18.906s | 采样器记录 43.27 GiB；瞬时观察约 46.3 GiB | 26.103 | 0.677 | 二采失败，回退为放大 |

RMSE 越低表示输出第一帧越接近输入首帧。锐度只衡量第一输出帧的高频信息，不等价于主观成片质量。三段续拍的两个边界位于 5.167 秒和 10.333 秒；相对普通运动跳变分别为 1.05×、1.24×，没有检测到 0.5 秒以上冻结。

## 画质观察

Director 单段保留了人物脸型、衣着、纸袋、街景构图和前景遮挡，首帧比当前基线更接近原图。动作范围仍偏保守，但没有明显身份漂移或额外人物突变。

三段续拍中人物身份、服装和街道方向保持稳定，前景行人遮挡自然。第二个接缝的像素跳变略高，但仍接近镜头内正常遮挡运动，没有形成冻结或明显重置。

高清分支先成功生成 864×480 一采，再把 192 帧放大到 1344×768。二采开始时出现：

```text
shape mismatch: value tensor of shape [405, 96] cannot be broadcast to indexing result of shape [1008, 96]
```

插件保留上一次成功结果，因此最终 MP4 分辨率正确但不是二采成片。前端不能只根据 ComfyUI `success` 判断高清化成功，必须读取 Director `report` 并把 `refine failed` 显示为降级状态。

## 与现有 AID 前端的匹配

### 可直接复用

- `videoSegmentPlan` 的分段、Seed、项目缓存和已生成视频持久化。
- `sequenceId/locationId/videoStartMode` 可转换成 Director 的逐边界 continuity 开关。
- 现有 Companion SSH、ComfyUI `/prompt`、`/history`、下载和本地视频缓存链路。
- 现有导出编辑器仍负责最终节奏、变速和整片拼接。

### 必须新增

1. 新增 `Director（实验）` 后端，不覆盖现有三套 H3 工作流。
2. 用直接 API prompt builder，不使用当前 `compileFrontendWorkflow`。Director 的自定义前端 widgets 与通用编译器索引不兼容，会把 `frame_rate/width/timeline_data/steps` 错位。
3. 展示 `排队耗时` 与 `实际执行耗时`，并显示当前任务归属；测试中生产任务曾先进入队列，端到端等待不能算作模型速度。
4. 解析 Director `report`，区分 `成功 / refine 降级 / 缓存命中 / 选段跳过`。
5. 显示逐段进度、段间引导 22 帧、每个边界的硬切/续拍状态和单段重跑入口。
6. 高清档显示显存风险：当前 48GB 卡在 1MP 放大阶段瞬时接近 46.3GB。
7. 提供一采/终稿对比，不允许“仅放大”被标为“二采高清成功”。
8. 保存质量/CRF 需要可控。Director 当前直出码率低于基线，分辨率提高不自动代表细节提高。

## 建议的上线范围

第一阶段只开放：

- 无对白或弱对白的连续镜头；
- 同场同地点、连续屏幕方向；
- 每批最多 3 段、约 15 秒；
- 864×480 生成或 1280×736 单段；
- continuity 默认 22 帧；
- 关闭 Refine/高清化；
- 原生产后端保留为一键回退。

后续只有在以下验证完成后再扩大范围：

- 带三角色精确对白的逐字 ASR、音色和尾字测试；
- 45 秒以上滚动批次的磁盘缓存、断点恢复和 CPU 内存压力；
- I2V/FL2V 放大后二采 shape mismatch 修复；
- H3 latent upscaler 权重安装后的独立 A/B；
- Director 运行报告接入 AID 前端的降级提示。

## 相关风险证据

- [I2V / FL2V 二采或 latent 放大失败](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/issues/47)
- [竖屏二采 shape mismatch](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/issues/68)
- [段间引导后长视频逐段劣化](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/issues/58)
- [段间引导吞掉长对话末尾](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/issues/87)
- [多段全部导出 CPU 内存 OOM](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/issues/32)

## 复现

```bash
npm run test:h3-director-ab
AID_COMFYUI_URL=http://127.0.0.1:8199 \
  AID_DIRECTOR_CASES=single,continuity,refine \
  npm run smoke:h3-director-ab
```

测试脚本会生成 API prompt、视频、逐秒 contact sheet、首帧误差、锐度、冻结检测、接缝跳变、队列/执行耗时、峰值 RAM/VRAM 和 JSON 结果。
