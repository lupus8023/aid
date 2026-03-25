# FreeCut 编辑器集成测试指南

## 已完成的集成

### 1. 编辑器页面
- 路径: `/editor`
- 通过 iframe 嵌入 FreeCut (http://localhost:5173)

### 2. 编辑按钮位置

**Image to Video 页面**
- 生成视频后，在预览区域显示绿色 "Edit Video" 按钮
- 点击后跳转到编辑器，自动加载生成的视频

**Story 页面**
- 每个 storyboard 卡片生成视频后显示蓝色 "Edit" 按钮
- 点击后跳转到编辑器，自动加载该场景视频

## 测试步骤

### 测试 1: Image to Video 编辑
1. 访问 http://localhost:3000
2. 点击 "Image to Video"
3. 上传图片，输入描述，生成视频
4. 视频生成完成后，点击 "Edit Video" 按钮
5. 应该跳转到 `/editor` 页面，看到 FreeCut 编辑器

### 测试 2: Story 编辑
1. 访问 http://localhost:3000
2. 点击 "AI Story Generation"
3. 上传故事，生成分镜，生成视频
4. 在任意 storyboard 卡片上点击 "Edit" 按钮
5. 应该跳转到 `/editor` 页面，看到 FreeCut 编辑器

## 当前状态

✅ FreeCut 运行在 5173 端口
✅ aid 运行在 3000 端口
✅ 编辑按钮已添加到两个页面
✅ 路由跳转已配置

## 下一步优化（可选）

1. **视频自动导入**: 通过 postMessage 将视频 URL 传递给 FreeCut
2. **UI 统一**: 调整 FreeCut 主题颜色匹配 aid 风格
3. **批量编辑**: Story 模式支持一次导入多个场景视频
4. **返回按钮**: 在编辑器添加返回 aid 的按钮

## 注意事项

- 两个服务器必须同时运行
- FreeCut 需要 Chrome 113+ (WebGPU 支持)
- 视频 URL 通过 query 参数传递
