<div align="center">
  <img src="public/logo.png" alt="AI Video Studio" width="320" height="120">

  # AI Video Studio

  ### Transform Your Stories into Stunning Videos with AI

  [![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.0-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
  [![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

  <p align="center">
    <a href="#features">Features</a> •
    <a href="#demo">Demo</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#usage">Usage</a> •
    <a href="#tech-stack">Tech Stack</a>
  </p>
</div>

---

## ✨ Features

<table>
  <tr>
    <td width="50%">
      <h3>🎬 Image to Video</h3>
      <p>Upload images and transform them into professional videos with AI-powered motion generation. Add camera movements, adjust aspect ratios, and create cinematic experiences.</p>
    </td>
    <td width="50%">
      <h3>📖 AI Story Generation</h3>
      <p>Automatically analyze stories, generate complete storyboards, and produce videos. Perfect for content creators, filmmakers, and storytellers.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🎨 Character Consistency</h3>
      <p>Upload character reference images and maintain visual consistency across all generated scenes using advanced image-to-image AI technology.</p>
    </td>
    <td width="50%">
      <h3>📱 Mobile Optimized</h3>
      <p>Fully responsive design with mobile-first approach. Add to home screen for a native app experience on any device.</p>
    </td>
  </tr>
</table>

### 🚀 Key Capabilities

- **Multiple Video Models**: Support for Sora 2, Veo 3.1, and more cutting-edge AI video models
- **Flexible Aspect Ratios**: 16:9 landscape, 9:16 portrait, and 1:1 square formats
- **Advanced Camera Controls**: Professional camera movements including pan, tilt, zoom, and dolly
- **Real-time Progress**: Live status updates during image and video generation
- **Batch Processing**: Generate multiple storyboard scenes simultaneously
- **Project Management**: Save, load, and export your projects with ease
- **Screenplay Fidelity**: Registered aliases and casting names share one character identity. Multiline authored shots retain their actions, camera instructions, and exact ordered dialogue during H3 preparation; partial series drafts receive at most one persisted missing-shot recovery in Companion, while explicit provider refusals remain stopped.
- **Series Studio**: Create anything from a one-episode short to a full season, generate character cards individually, reuse finished cast through the character library, separate automatic prop references from user-specified product images, and download each episode separately. New story shot-count presets use multiples of four and each four shots share one 2×2 storyboard reference sheet; formed screenplays retain their original count and fields. See [连续剧制片说明](docs/series-studio.md).

---

## 🎥 Demo

### Animated Story Examples

<div align="center">
  <img src="public/sample1.gif" alt="Animated Story Example 1" height="320">
  <img src="public/sample3.gif" alt="Animated Story Example 2" height="320">
  <p><em>AI-generated animated storyboard sequences with character consistency</em></p>
</div>

### Realistic Style Examples

<div align="center">
  <img src="public/sample2.gif" alt="Realistic Style Example 1" height="320">
  <img src="public/sample4.gif" alt="Realistic Style Example 2" height="320">
  <p><em>Photorealistic video generation with cinematic camera movements</em></p>
</div>

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- APIMart API Key ([Get one here](https://apimart.ai/))
- Cloudinary account for image hosting ([Sign up](https://cloudinary.com/))

### Installation

```bash
# Clone the repository
git clone https://github.com/lupus8023/aid.git
cd aid

# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
```

### Configuration

Edit `.env.local` and add your API keys:

```env
# APIMart API Key (required)
APIMART_API_KEY=your_apimart_key_here

# Cloudinary Configuration (required for image uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_key
CLOUDINARY_API_SECRET=your_cloudinary_secret
```

### ComfyUI（可选）

视频生成通道可在 Settings 中切换为 `Cloud ComfyUI · SSH Private Workflow`。该通道沿用 J18IP 的 MiniMax H3 接口链路：

1. aid 通过 SSH/SCP 上传首帧、可选尾帧，以及可选的角色音色参考；
2. 自动查找或读取单图、多图、首尾帧工作流；I2VA/FL2VA 默认锁定 pruned FL2VA、NVFP4 文本编码器、768P 专用 8-step LoRA、Sage Attention 与 6/3 调度，多参考 Ref2VA 继续使用独立路径；
3. 将前端工作流转换为 ComfyUI API prompt，并在提交前校验模型链与实际采样参数，通过 `/prompt` 提交；
4. 使用 `/history/{prompt_id}` 轮询，完成后从 `/view` 下载并上传到 Cloudinary。

运行 aid 的机器需要安装 `ssh` 和 `scp`，并能以无交互方式登录 ComfyUI 主机。H3 在一次原生音画生成中同步完成画面、口型、台词、环境声和拟音；Fish Audio 文件只作为可选音色参考，不作为成片台词音轨。连接字段既可在 Settings 中填写，也可通过 `.env.local.example` 中的 `COMFYUI_*` 变量配置。若两处都填写，以 Settings 为准。Settings 中的“FL2VA 加速方案”可临时切回旧版远端工作流，但该选项仅用于故障回退。

`pandais.beauty` 上的 ComfyUI 通道默认通过本机 aid companion 使用 SSH，不把私钥交给 Netlify。先在 aid 项目目录运行 `npm run companion`，保持 `http://127.0.0.1:3018` 可用；网页会把 ComfyUI 的测试、提交和轮询请求发给这个本地服务，由它使用 `~/.ssh`、ssh-agent 和持久控制连接完成 SSH/SFTP。长剧本规划、AI 扩写、MiniMax H3 视频以及 Z-Image-Turbo 图片任务都可通过 Companion 执行；APIMart 图片模型仍走 Netlify。companion 只允许 `pandais.beauty` 与本机 origin 跨域访问。

全局图片模型可选择 `ComfyUI · Z-Image-Turbo（本地）`。该分支使用官方 BF16 文生图工作流，支持 Story 四宫格、单分镜、角色草稿、定妆图和场景参考图；官方基础工作流不接受参考图编辑，因此图生图与严格身份参考请切换 APIMart 图片模型。

### fal MiniMax H3 Max（可选）

视频生成通道也可在 Settings 中选择 `fal · MiniMax H3 Max`。fal API Key 使用独立的密码输入框并保存在浏览器本地设置中，通过 AID 服务端代理提交和轮询任务；无需安装或更新 Companion。该通道支持 5–15 秒、480P/768P、可选尾帧和原生同步音频。Prompt Expansion 默认关闭，避免供应商扩写逐字台词。

fal 当前的 H3 Max 图生视频接口不接受 Fish Audio 音频参考或 Voice ID。Settings 中的固定 Seed 只用于复现性实验，不能作为跨片段声纹锁；需要严格音色一致性时请继续使用支持 `<Audio>` 音色参考的 ComfyUI H3 通道。

剧本生成通道可在 Settings 中明确选择 `Auto`、`DMX only` 或 `APIMart only`。Auto 模式优先 DMX，可恢复的接口故障会回退 APIMart，并保留失败原因；模型明确拒绝时停止自动切换与重提。仅使用模式不会静默切换供应商。单集剧本普通截断时保留完整镜头、只补缺失部分；明确拒绝会保留原稿并单独提示，不再误报缺少 `shots`。桌面版 Companion 对这两个 API 域名使用独立公网 DNS，避免代理或 VPN 的 Fake-IP 解析导致“授权正常但剧本 API 无法连接”。

Story 长片生成采用分阶段流程：一句话构想也可以先扩写为完整的故事目标、冲突、转折、选择与结局，再锁定全片故事脊柱、场次配额和精确镜头数；随后按场次以最多 6 镜一组建立因果镜头地图，统一完成全片台词稿，再逐镜展开演员可执行的详细剧本，最后生成导演分镜提示词。每个出场角色都会获得逐镜的走位、手势、微表情、视线、呼吸、即时反应、潜台词与逐字台词；这些表演卡会在分镜审核页展示，并继续进入视频提示词。批次之间会传递人物、道具、关系和物理状态；切换场次时允许明确重建时间、空间和光线，避免前后剧情漂移。

点击生成后，故事输入页会按真实任务进度显示“故事结构构思、电影镜头组织、交付检查”三个阶段，并展示当前构思内容、已等待时间与目标镜头数；长任务不再只显示一个无法判断是否卡住的转圈状态。

长剧本与导演分镜接口会持续发送保活响应，降低代理层在模型仍工作时返回 HTML 超时页的概率。网页默认要求本机 Companion 执行长任务；若无法连接，请确认 Companion 正在运行，并在浏览器网站权限中允许 `pandais.beauty` 访问“本地网络”。网页不会再把这类长任务静默回退到受时限约束的托管接口。

视频阶段采用保真与电影剪辑并行的 Hybrid 策略：长镜头、长对白、关键表演特写和终场落点保持为独立 I2VA/FL2VA 片段，锁定真实首帧与人物一致性；只有相邻分镜构成正反打、动作—反应、主镜头—近景推进、细节插入、蒙太奇或明确匹配剪辑时，系统才会在 15 秒与四镜上限内自动组合为一个电影化多镜片段。多镜提示词会指定切点、180 度轴线、视线、银幕方向、动作匹配和景别递进，并把每张参考图视为独立机位，禁止人物融合、画面插值和无动机软转场。用户仍可在片段编辑中手动调整组合边界。

有台词的 Story 片段使用单次 H3 原生音画流程：逐字台词只在官方 `d` 标签中出现一次，并在提交前与剧本逐字比对。相邻同角色短句可以成为一个连续发声块，但程序不再删除、替换或补写原台词标点。角色音频只绑定音色，动作、结果或观众反应不会重复解释台词含义。成片直接采用主 H3 同步音轨，不额外运行 ASR、重混人声或做人声分离；第一句前保留干净场景底噪，最后一句预留完整尾字和自然环境尾音。

v0.1.190 起，Story 和连续剧自动成片也不再执行额外的末镜 ASR 核验，或因其结果重生成末段。旧任务若卡在“末镜转写连接暂时失败”，更新后点击“从断点重试”会复用已完成且输入未改变的视频继续合成；导出仍检查片段齐全及媒体完整性，不把跳过转写标记为核验通过。

成片导出默认启用“智能标准”节奏：情绪特写和关键停顿接近原速，对白轻度提速，常规叙事、过场、蒙太奇与动作镜头采用更紧凑的倍率；同一多分镜 H3 片段也会按内部镜头时间窗分别处理。画面与同期对白通过 FFmpeg 同步变速并保持音高，编辑器同时提供“原速、电影、智能标准、紧凑”四档及全片实际平均倍率。

故事输入页的“改编剧本”会使用当前选择的目标镜头数和预计片长，把梗概、小说片段或既有剧本整理为精确编号的连续剧情节拍；用户明确指定的事实、事件顺序、结局和台词仍保持最高优先级。

普通用户可直接从 AID 首页下载桌面版 Companion。桌面版内置 Node.js 运行环境、FFmpeg/FFprobe 和独立 SSH 客户端，支持 macOS Apple Silicon、macOS Intel 与 Windows x64；启动时会生成仅保存在本机应用数据目录的专属 Ed25519 密钥，并可使用仙宫云 SSH 密码一键完成公钥授权。

Story 视频片段默认以本镜分镜图为首帧；只有在片段面板明确选择“上一段尾帧”且满足同场同地点的相邻接拍条件时才继承前段画面。原始分镜和视频预览分别显示。ComfyUI 的提示词预览及提交均由 Companion 编译，因此相关提示词更新也需要同步 Companion（当前最低 v0.1.100）；旧版自动接续的片段需重生成后再合并。

维护者可创建 `companion-v*` Git tag，或在 GitHub Actions 手动运行 `Release AID Companion`，自动生成三个平台包并发布到 GitHub Releases。首页下载链接始终指向 latest release。

无人值守的纯服务端部署仍可用 `COMFYUI_SSH_PRIVATE_KEY_B64` 作为后备密钥，并用 `COMFYUI_SSH_HOST_FINGERPRINT` 固定远端主机指纹；该模式不是浏览器默认路径。

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

---

## 📖 Usage

### Image to Video Mode

1. **Upload Images**
   - Upload your first frame image (required)
   - Optionally upload a last frame image for controlled motion
   - Image size must be under 6MB

2. **Configure Settings**
   - Select aspect ratio (16:9, 9:16, or 1:1)
   - Choose camera movements (pan, tilt, zoom, dolly, etc.)
   - Write motion description

3. **Generate Video**
   - Click "Generate Video" button
   - Wait for AI processing (typically 1-3 minutes)
   - Download or regenerate as needed

### AI Story Generation Mode

1. **Setup Characters & Objects**
   - Add character names and upload reference images
   - Add objects with descriptions (optional)
   - Upload your story file (Markdown or text)

2. **Generate Outline**
   - AI analyzes your story structure
   - Review and edit the generated outline
   - Proceed to scene breakdown

3. **Create Storyboards**
   - AI splits story into individual scenes
   - Each scene includes characters, description, and prompt
   - Review and edit scene details

4. **Render Images & Videos**
   - Generate images for all storyboard scenes
   - Convert images to videos with motion
   - Download individual scenes or export entire project

---

## 🛠️ Tech Stack

### Frontend
- **[Next.js 15](https://nextjs.org/)** - React framework with App Router
- **[React 18](https://react.dev/)** - UI library
- **[TypeScript](https://www.typescriptlang.org/)** - Type safety
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first styling
- **[Lucide React](https://lucide.dev/)** - Beautiful icons

### Backend & APIs
- **[APIMart AI](https://apimart.ai/)** - AI video and image generation
- **[Cloudinary](https://cloudinary.com/)** - Image hosting and CDN
- **Next.js API Routes** - Serverless functions

### AI Models
- **Sora 2** - OpenAI's video generation model
- **Veo 3.1** - Google's advanced video model
- **Doubao SeeDream 5.0** - ByteDance's image generation
- **Gemini 3 Pro** - Google's multimodal AI

---

## 📁 Project Structure

```
aid/
├── app/
│   ├── api/                    # API routes
│   │   ├── analyze/           # Story analysis
│   │   ├── generate/          # Image generation
│   │   ├── generate-video/    # Video generation
│   │   ├── check-image-status/
│   │   └── check-video-status/
│   ├── image-to-video/        # Image to video page
│   ├── story/                 # Story generation page
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx               # Home page
├── components/                 # React components
├── lib/                       # Utilities and helpers
├── types/                     # TypeScript definitions
└── public/                    # Static assets
```

---

## 💡 Tips & Best Practices

- **Image Quality**: Use high-resolution images (at least 1024px) for best results
- **Character Consistency**: Upload clear, well-lit reference images with consistent angles
- **Story Structure**: Write clear, descriptive scenes with specific visual details
- **Aspect Ratios**: Note that 1:1 square format is not supported by Veo models
- **Generation Time**: Video generation typically takes 1-3 minutes per scene
- **API Costs**: Monitor your APIMart usage to manage costs effectively

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [APIMart AI](https://apimart.ai/) for providing powerful AI APIs
- [Cloudinary](https://cloudinary.com/) for image hosting infrastructure
- [Next.js](https://nextjs.org/) team for the amazing framework
- All contributors and users of this project

---

## 📧 Contact & Support

- **Issues**: [GitHub Issues](https://github.com/lupus8023/aid/issues)
- **Discussions**: [GitHub Discussions](https://github.com/lupus8023/aid/discussions)

---

<div align="center">
  <p>Made with ❤️ by PANDA Skincare</p>
  <p>
    <a href="#top">Back to Top ↑</a>
  </p>
</div>
