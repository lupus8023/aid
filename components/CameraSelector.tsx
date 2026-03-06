'use client';

import { useState } from 'react';
import { Camera } from 'lucide-react';

interface CameraSelectorProps {
  onParamsChange: (params: string) => void;
}

const cameras = [
  { id: 'sony-a7', name: 'Sony A7', icon: '📷' },
  { id: 'canon-5d', name: 'Canon 5D', icon: '📷' },
  { id: 'iphone-15', name: 'iPhone 15 Pro', icon: '📱' },
  { id: 'red-komodo', name: 'RED Komodo', icon: '🎥' },
  { id: 'arri-alexa', name: 'ARRI Alexa', icon: '🎬' },
];

const focalLengths = [
  { value: '24mm', label: '24mm (广角)' },
  { value: '35mm', label: '35mm (标准)' },
  { value: '50mm', label: '50mm (人像)' },
  { value: '85mm', label: '85mm (特写)' },
  { value: '135mm', label: '135mm (长焦)' },
];

const apertures = [
  { value: 'f/1.4', label: 'f/1.4 (大光圈)' },
  { value: 'f/2.8', label: 'f/2.8' },
  { value: 'f/4', label: 'f/4' },
  { value: 'f/5.6', label: 'f/5.6' },
  { value: 'f/8', label: 'f/8 (小光圈)' },
];

const isoValues = [
  { value: '100', label: 'ISO 100' },
  { value: '400', label: 'ISO 400' },
  { value: '800', label: 'ISO 800' },
  { value: '1600', label: 'ISO 1600' },
  { value: '3200', label: 'ISO 3200' },
];

export default function CameraSelector({ onParamsChange }: CameraSelectorProps) {
  const [camera, setCamera] = useState('');
  const [focal, setFocal] = useState('');
  const [aperture, setAperture] = useState('');
  const [iso, setIso] = useState('');

  const updateParams = (c: string, f: string, a: string, i: string) => {
    const parts = [];
    if (c) parts.push(`Shot on ${cameras.find(cam => cam.id === c)?.name}`);
    if (f) parts.push(f);
    if (a) parts.push(a);
    if (i) parts.push(i);
    onParamsChange(parts.join(', '));
  };

  return (
    <div className="bg-[#252526] rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center">
        <Camera className="w-5 h-5 mr-2" />
        镜头参数
      </h2>

      <div className="space-y-4">
        {/* 相机选择 */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">相机型号</label>
          <div className="grid grid-cols-3 gap-2">
            {cameras.map((cam) => (
              <button
                key={cam.id}
                onClick={() => {
                  setCamera(cam.id);
                  updateParams(cam.id, focal, aperture, iso);
                }}
                className={`p-3 rounded border ${
                  camera === cam.id
                    ? 'border-blue-500 bg-blue-500/20'
                    : 'border-gray-600 hover:border-gray-500'
                }`}
              >
                <div className="text-2xl mb-1">{cam.icon}</div>
                <div className="text-xs">{cam.name}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 焦距 */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">焦距</label>
          <select
            value={focal}
            onChange={(e) => {
              setFocal(e.target.value);
              updateParams(camera, e.target.value, aperture, iso);
            }}
            className="w-full bg-[#1e1e1e] border border-gray-600 rounded p-2 text-white"
          >
            <option value="">选择焦距</option>
            {focalLengths.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        {/* 光圈 */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">光圈</label>
          <select
            value={aperture}
            onChange={(e) => {
              setAperture(e.target.value);
              updateParams(camera, focal, e.target.value, iso);
            }}
            className="w-full bg-[#1e1e1e] border border-gray-600 rounded p-2 text-white"
          >
            <option value="">选择光圈</option>
            {apertures.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>

        {/* ISO */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">ISO</label>
          <select
            value={iso}
            onChange={(e) => {
              setIso(e.target.value);
              updateParams(camera, focal, aperture, e.target.value);
            }}
            className="w-full bg-[#1e1e1e] border border-gray-600 rounded p-2 text-white"
          >
            <option value="">选择ISO</option>
            {isoValues.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
