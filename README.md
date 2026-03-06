# AI 分镜生成应用 (AID)

这是一个基于 AI 的自动分镜生成应用，可以根据故事脚本自动拆解场景并生成分镜图片。

## 功能特点

- 📝 支持 Markdown 格式的故事文件上传
- 👤 角色形象管理（上传图片并命名）
- 🎬 AI 自动分析故事并拆解成分镜场景
- 🖼️ 使用 image-to-image 技术，严格按照角色形象生成分镜图片
- 🔄 实时显示生成进度和状态
- 🎨 自动生成详细的 AI 提示词

## 技术栈

- **前端框架**: Next.js 15 + React 18
- **样式**: Tailwind CSS
- **语言**: TypeScript
- **API**: APIMart AI (https://apimart.ai/)

## 安装步骤

### 1. 安装依赖

```bash
cd ~/Desktop/aid
npm install
```

### 2. 配置 API Key

复制环境变量示例文件：

```bash
cp .env.local.example .env.local
```

编辑 `.env.local` 文件，填入你的 APIMart API Key：

```
APIMART_API_KEY=your_api_key_here
```

**获取 API Key：**
1. 访问 https://apimart.ai/
2. 注册账号并登录
3. 在控制台获取你的 API Key

### 3. 启动开发服务器

```bash
npm run dev
```

应用将在 http://localhost:3000 启动。

## 使用方法

### 步骤 1: 添加角色

1. 在"角色管理"区域输入角色名字
2. 点击"上传角色形象"选择角色图片
3. 可以添加多个角色
4. 每个角色的形象将用于后续的分镜生成

### 步骤 2: 上传故事

1. 在"故事上传"区域点击"上传故事文件"
2. 选择 Markdown (.md) 或文本 (.txt) 格式的故事文件
3. 系统会显示故事内容预览

### 步骤 3: 生成分镜列表

1. 确保已添加角色和上传故事
2. 点击"生成分镜列表"按钮
3. AI 会分析故事内容，自动拆解成多个场景
4. 每个场景包含：
   - 场景编号
   - 场景描述（中文）
   - 出场角色
   - AI 提示词（英文）

### 步骤 4: 生成分镜图片

1. 点击"生成所有分镜图片"按钮
2. 系统会逐个为每个分镜生成图片
3. 生成过程中可以看到实时状态：
   - 等待中（灰色）
   - 生成中（蓝色）
   - 已完成（绿色）
   - 生成失败（红色）
4. 生成完成后，每个分镜卡片会显示对应的图片

## 项目结构

```
aid/
├── app/                    # Next.js 应用目录
│   ├── api/               # API 路由
│   │   ├── analyze/       # 故事分析 API
│   │   └── generate/      # 图片生成 API
│   ├── globals.css        # 全局样式
│   ├── layout.tsx         # 根布局
│   └── page.tsx           # 主页面
├── components/            # React 组件
│   ├── CharacterUpload.tsx    # 角色上传组件
│   ├── StoryUpload.tsx        # 故事上传组件
│   ├── StoryboardCard.tsx     # 分镜卡片组件
│   └── StoryboardList.tsx     # 分镜列表组件
├── lib/                   # 工具函数
│   ├── apimart.ts         # APIMart API 调用
│   ├── storyAnalyzer.ts   # 故事分析逻辑
│   └── imageGenerator.ts  # 图片生成逻辑
├── types/                 # TypeScript 类型定义
│   └── index.ts
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── next.config.js
```

## 注意事项

1. **API 费用**: APIMart API 是付费服务，请注意使用量和费用
2. **图片有效期**: 生成的图片链接有效期为 24 小时，请及时保存
3. **生成时间**: 每个分镜图片生成需要一定时间，请耐心等待
4. **角色一致性**: 系统会尽量保持角色形象一致，但 AI 生成结果可能有细微差异
5. **故事格式**: 建议故事内容清晰、结构完整，便于 AI 理解和拆解

## 故事文件示例

创建一个 `story.md` 文件：

```markdown
# 小红帽的故事

从前，有一个可爱的小女孩叫小红帽。她的奶奶生病了，妈妈让她去看望奶奶。

小红帽提着篮子，穿过森林去奶奶家。在森林里，她遇到了一只大灰狼。

大灰狼问小红帽要去哪里。小红帽天真地告诉了大灰狼奶奶家的地址。

大灰狼跑到奶奶家，假扮成小红帽，骗开了门。

最后，猎人救出了小红帽和奶奶，打败了大灰狼。
```

## 常见问题

### Q: API 调用失败怎么办？
A: 请检查：
- API Key 是否正确配置
- 网络连接是否正常
- API 账户余额是否充足

### Q: 生成的图片不符合预期？
A: 可以尝试：
- 使用更清晰的角色形象图片
- 在故事中提供更详细的场景描述
- 调整 `lib/storyAnalyzer.ts` 中的提示词模板

### Q: 如何保存生成的分镜图片？
A: 右键点击图片，选择"图片另存为"即可保存到本地。

## 开发说明

### 构建生产版本

```bash
npm run build
npm start
```

### 代码检查

```bash
npm run lint
```

## 许可证

MIT License

## 联系方式

如有问题或建议，欢迎提交 Issue。
