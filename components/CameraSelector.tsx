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
      <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">Camera Parameters</h2>
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-4">
        <div className="space-y-4">
          {/* Camera Selection */}
          <div>
            <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">Camera Model</label>
            <div className="grid grid-cols-5 gap-2">
              {cameras.map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => {
                    setCamera(cam.id);
                    updateParams(cam.id, focal, aperture, iso);
                  }}
                  className={`p-2 rounded border text-xs font-mono ${
                    camera === cam.id
                      ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                      : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
                  }`}
                >
                  <div className="text-lg mb-1">{cam.icon}</div>
                  <div className="text-[10px]">{cam.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Focal Length, Aperture, ISO in one row */}
          <div className="grid grid-cols-3 gap-3">
            {/* Focal Length */}
            <div>
              <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">Focal Length</label>
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
              <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">Aperture</label>
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
              <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">ISO</label>
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
