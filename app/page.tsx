'use client';

import Link from 'next/link';
import { Camera, Sparkles } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-6">
      <div className="max-w-6xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4">AI Video Studio</h1>
          <p className="text-gray-400 text-lg">选择你的创作方式</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* 图片转视频 */}
          <Link href="/image-to-video">
            <div className="group relative bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl p-8 cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-2xl">
              <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity"></div>
              <div className="relative z-10">
                <div className="w-16 h-16 bg-white/20 rounded-xl flex items-center justify-center mb-6">
                  <Camera className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-3xl font-bold text-white mb-3">图片转视频</h2>
                <p className="text-blue-100 mb-4">上传图片，添加动作描述和镜头参数，生成专业视频</p>
                <ul className="text-sm text-blue-100 space-y-2">
                  <li>• 支持多种相机参数</li>
                  <li>• 自定义镜头规格</li>
                  <li>• 专业动作描述</li>
                </ul>
              </div>
            </div>
          </Link>

          {/* AI故事生成 */}
          <Link href="/story">
            <div className="group relative bg-gradient-to-br from-purple-600 to-pink-600 rounded-2xl p-8 cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-2xl">
              <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity"></div>
              <div className="relative z-10">
                <div className="w-16 h-16 bg-white/20 rounded-xl flex items-center justify-center mb-6">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-3xl font-bold text-white mb-3">AI故事生成</h2>
                <p className="text-purple-100 mb-4">自动分析故事，生成完整分镜和视频</p>
                <ul className="text-sm text-purple-100 space-y-2">
                  <li>• 智能故事分析</li>
                  <li>• 自动生成分镜</li>
                  <li>• 批量视频生成</li>
                </ul>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
