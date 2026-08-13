'use client';

import { useState } from 'react';
import { Camera, Clapperboard, Smartphone, Video } from 'lucide-react';

interface CameraSelectorProps {
  onParamsChange: (params: string) => void;
}

const cameras = [
  { id: 'sony-a7', name: 'Sony A7', icon: Camera },
  { id: 'canon-5d', name: 'Canon 5D', icon: Camera },
  { id: 'iphone-15', name: 'iPhone 15 Pro', icon: Smartphone },
  { id: 'red-komodo', name: 'RED Komodo', icon: Video },
  { id: 'arri-alexa', name: 'ARRI Alexa', icon: Clapperboard },
];

const focalLengths = [
  { value: '24mm', label: '24mm (Wide)' },
  { value: '35mm', label: '35mm (Standard)' },
  { value: '50mm', label: '50mm (Portrait)' },
  { value: '85mm', label: '85mm (Close-up)' },
  { value: '135mm', label: '135mm (Telephoto)' },
];

const apertures = [
  { value: 'f/1.4', label: 'f/1.4 (Wide)' },
  { value: 'f/2.8', label: 'f/2.8' },
  { value: 'f/4', label: 'f/4' },
  { value: 'f/5.6', label: 'f/5.6' },
  { value: 'f/8', label: 'f/8 (Narrow)' },
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
    <div>
      <div className="mb-4"><p className="aid-step-kicker">04 · 镜头语言</p><h2 className="mt-1 text-base font-semibold text-white">相机参数</h2></div>
      <div>
        <div className="space-y-4">
          {/* Camera Selection */}
          <div>
            <label className="aid-field-label">相机型号</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {cameras.map((cam) => {
                const Icon = cam.icon;
                return (
                <button
                  key={cam.id}
                  onClick={() => {
                    setCamera(cam.id);
                    updateParams(cam.id, focal, aperture, iso);
                  }}
                  className={`min-h-[76px] rounded-xl border p-2 text-xs ${
                    camera === cam.id
                      ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                      : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
                  }`}
                >
                  <Icon size={18} className="mx-auto mb-2" />
                  <div className="text-[10px] font-mono">{cam.name}</div>
                </button>
              );})}
            </div>
          </div>

          {/* Focal Length, Aperture, ISO in one row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Focal Length */}
            <div>
              <label className="aid-field-label">焦距</label>
              <select
                value={focal}
                onChange={(e) => {
                  setFocal(e.target.value);
                  updateParams(camera, e.target.value, aperture, iso);
                }}
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded p-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              >
                <option value="">Select Focal Length</option>
                {focalLengths.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            {/* Aperture */}
            <div>
              <label className="aid-field-label">光圈</label>
              <select
                value={aperture}
                onChange={(e) => {
                  setAperture(e.target.value);
                  updateParams(camera, focal, e.target.value, iso);
                }}
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded p-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              >
                <option value="">Select Aperture</option>
                {apertures.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>

            {/* ISO */}
            <div>
              <label className="aid-field-label">感光度</label>
              <select
                value={iso}
                onChange={(e) => {
                  setIso(e.target.value);
                  updateParams(camera, focal, aperture, e.target.value);
                }}
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded p-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              >
                <option value="">Select ISO</option>
                {isoValues.map((i) => (
                  <option key={i.value} value={i.value}>{i.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
