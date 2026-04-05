// 角色类型
export interface Character {
  id: string;
  name: string;
  description: string; // 角色外观描述
  imageUrl: string;
  imageBase64?: string; // base64 格式的图片，用于 API 调用
  imageFile?: File;
  voiceId?: string; // fish.audio reference_id
}

// 物体类型
export interface ObjectItem {
  id: string;
  name: string;
  description: string; // 物体详细描述,包括细节、文字等
  imageUrl: string;
  imageBase64?: string; // base64 格式的图片，用于 API 调用
  imageFile?: File;
}

// 分镜类型
export interface Storyboard {
  id: string;
  sceneNumber: number;
  description: string;
  prompt: string;
  characters: string[]; // 角色名称列表
  objects?: string[]; // 物体名称列表
  imageUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  taskId?: string; // APIMart 任务 ID
  videoUrl?: string; // 视频 URL
  videoStatus?: 'pending' | 'generating' | 'completed' | 'failed'; // 视频生成状态
  videoTaskId?: string; // 视频任务 ID
  aspectRatio?: '16:9' | '9:16' | '1:1'; // 宽高比
  audioUrl?: string; // 生成的音频 URL
  audioStatus?: 'generating' | 'completed' | 'failed';
  dialogue?: Record<string, string>; // { 角色名: 台词 } - legacy
  dialogueLines?: { character: string; text: string }[]; // ordered dialogue lines
  videoPrompt?: string; // 视频生成提示词
  videoDuration?: number; // 视频时长（秒）5-15
  // 定妆/场景参考图
  characterCostume?: Record<string, string>; // { 角色名: 造型描述 }
  sceneStyle?: string;                       // 场景风格描述
  costumeStatus?: 'pending' | 'generating' | 'completed'; // 定妆图生成状态
  // costumeImages and sceneImage are now global, stored in page state
}

// 故事类型
export interface Story {
  title: string;
  content: string;
  storyboards: Storyboard[];
}

// APIMart API 响应类型
export interface ApiMartChatResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
}

export interface ApiMartImageTaskResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface ApiMartImageStatusResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: {
    images: Array<{
      url: string;
    }>;
  };
}

// 视频生成响应类型
export interface ApiMartVideoTaskResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface ApiMartVideoStatusResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: {
    videos: Array<{
      url: string;
    }>;
  };
}

// 应用设置类型
export interface AppSettings {
  apiProvider: 'apimart' | 'openai' | 'anthropic'; // API 提供商
  apiKey: string; // API Key
  scriptModel: string; // 脚本生成模型
  imageModel: string; // 图片生成模型
  videoModel: string; // 视频生成模型
  aspectRatio: '16:9' | '9:16' | '1:1'; // 横屏或竖屏
  fishAudioKey?: string; // fish.audio API key
  language?: 'zh' | 'en'; // output language for dialogue and descriptions
}
