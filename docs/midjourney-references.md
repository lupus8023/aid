# MJ 人物与风格参考

核验日期：2026-08-31。以 APIMart 的文档、请求格式和上游回传结果为接口依据，不用 Midjourney 官方站点的产品限制代替网关验证。不要把通用 `image_urls`、人物参考、风格参考当成同一类输入。

| 本地适配方案 | 人物身份 | 画面风格 | API 路径 |
| --- | --- | --- | --- |
| V6.1 | `cref` + `cw`（0–100） | `sref` + `sw`（0–1000） | `/v1/midjourney/generations` |
| V7 | `--oref URL --ow N`，经 `extra` 传递 | `sref` + `sw` | `/v1/midjourney/generations` |
| V8.2 | 编辑模型的 `image_urls`，最多4张内容参考 | 独立 `sref` + `sw` | `/v1/midjourney/generations/edits` |

上表描述本地适配方案，不是 APIMart 的完整版本兼容矩阵。APIMart 列出了 `cref/cw`、`sref/sw` 和 `extra`，但没有逐版本说明全部组合；不能仅凭其他站点的说明，断言某个组合在 APIMart 一定不可用。V6.1/V7 尚未通过本项目的成图验收。V8.2 样片使用已经在 APIMart 实测成功的编辑参考加 `sref/sw`，不依赖未经验证的 `cref` 组合。

## 本项目的默认工作流

- 保持 V8.2，每镜单独生成。人物图始终来自固定角色参考，不用上一张生成结果反复传递身份。
- 同一影片使用固定风格参考和权重；`sref` 只传递色调、照明、材质与媒介，不把风格图中的人物加入演员表。
- 多人镜头按角色、道具、场景分配最多4个内容名额；独立风格参考不占这个名额。超过容量报错，不静默丢掉人物。
- 有 `sref` 时减少通用风格形容词堆叠，保留具体动作、机位、光源、角色和服装描述。
- 一致性仍需逐镜验收。APIMart 没有在该页承诺每个角色都可独立绑定到一个参考槽；不要把多个不同人物混进一个角色参考值，再假定它能自动区分任意多人。

## 实测与修复

旧实现存在两个问题：`referenceMode: character` 在部分入口仍走普通垫图；编辑请求白名单移除了专用 `sref/sw`。

现已分离人物与风格输入，支持显式版本参数，并为 V8.2 编辑请求保留已验证的 `sref/sw/raw`。只有风格图而没有内容图时走 Imagine，避免提交缺少 `image_urls` 的空编辑任务。默认生产模型未降级。

真实请求 `task_01M1BTG84PTMF52N1XCVXV28SE` 返回 `SUCCESS` 和4张图片；上游 `prompt_en` 明确包含 `--v 8.2 --sw 100 --sref … --raw`。V6.1/V7 对照请求被上游图片审核拒绝，没有可比较的生成结果；不把接收任务编号当作生成成功，也不自动绕过审核重试。

本地实测材料：`outputs/pearl-material-rebuild-142/reference-api-test/`。参考传参回归测试：`tests/midjourney-references.test.mjs`。这些记录验证参数链路，不代表最终影片已达到用户质感要求。

## 一手资料

- [APIMart Imagine](https://docs.apimart.ai/cn/api-reference/images/midjourney/imagine)
- [APIMart Edits](https://docs.apimart.ai/cn/api-reference/images/midjourney/edits)
- [APIMart 最佳实践](https://docs.apimart.ai/cn/api-reference/images/midjourney/best-practices)

## 2026-08-31 提示词和参数审计

发现并修复一个场景内容丢失问题：旧编译器在整段输入中搜索 `character sheet`，把世界场景模板中的 `not a portrait, character sheet...` 当作生成角色卡的指令。全剧14个地点因此被编译成完全相同的通用肖像提示词，地点描述没有进入最终请求。现在只有正向输出声明能触发角色卡编译，显式 `story-shot` 不会被否定句覆盖；场景原文、构图和输出要求会保留。

角色卡另外移除了与定妆展示冲突的剧情抓拍/表演提示，以及没有填写内容的元数据占位句。保留角色外观、物种、服装、正侧背面要求；不再按总字符数静默截掉身份细节。概念候选和单一身份多视图分开处理。空景不会再收到人物表演或人物占画幅比例要求。

APIMart Imagine 仅要求 `prompt`；Edits 要求 `prompt` 和 `image_urls`，两者文档均允许结构化可选参数。**可选不代表不支持**。本项目默认请求现在仅保留 `prompt/size/version/raw`，按需增加 `image_urls` 和独立 `sref/sw`。用户明确启用的 profile、V6.1/V7 身份参考设置仍保留。删除自动填入的 `quality/hd/stylize/chaos/iw/negative_prompt/speed/metadata`；审核设置未改动。

证据边界：

- `outputs/mj-full-episode1-20260831/payload-audit-before.json` 和 `payload-audit-after.json` 是从已保存项目、对应编译器离线重建的28项请求，不冒充历史抓包。旧场景共有1种提示词，新场景各自保留对应地点内容。
- 旧角色卡 Edits 实际白名单原本就不发送 `quality/hd/stylize/chaos/iw/negative_prompt`，不能把这些字段归因于角色卡拒绝。成功与失败角色卡的字段集合相同；成功与失败场景的字段集合也相同。
- 上游失败记录只给出 `upstream code=9` / `Prompt图片未通过审核`，没有指出具体哪个字段、文字或图像。代码缺陷已经证实，**拒绝的具体根因仍未证实**。
- 不通过清除审核状态、自动改写被拒任务或切换渠道绕过拒绝。独立空房间请求只验证最小接口格式，不替代原任务审核或成片验收。
- `tests/midjourney-prompt-contract.test.mjs` 覆盖否定句误判、场景差异、构图保留、角色卡与概念候选、长身份描述和可选参数；最终 HTTP 请求字段另由 `midjourney-references.test.mjs` 检查。安全日志记录实际提交字段名，不记录密钥。

修改尚未发布；第一集完整成片通过验收后再更新线上及安装版 Companion。

独立协议实测：`task_01M1C4P778PX9KQ83F255W4REP` 仅发送 `prompt/size/version/raw`，上游返回 `SUCCESS` 和4张图片，按供应商创建/完成时间计算为36秒。第一张已下载检查，内容为窗边木桌、陶杯和亚麻布，没有人物；文件为 `outputs/mj-full-episode1-20260831/independent-minimal-control.png`。这是单独的中性空房间测试，未重提全剧28项任务中的任何一项，不验证原拒绝原因。

本次本地验证：406项测试通过，Next生产构建通过。旧14个场景只有1种最终提示词；修复后14个场景各有自己的提示词。证据见同目录 `payload-audit-before.json`、`payload-audit-after.json`、`independent-minimal-control.json`。
