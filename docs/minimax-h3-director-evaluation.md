# MiniMax H3 Director A/B 评估

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
