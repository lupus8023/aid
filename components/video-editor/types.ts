import type { PacingSection } from '@/lib/videoPacing';

export interface VideoClip {
  id: string;
  url: string;
  name: string;
  duration: number;
  startTime: number;
  trimStart: number;
  trimEnd: number;
  pacingSections?: PacingSection[];
  preserveEndingSeconds?: number;
}

export interface Transition {
  type: 'fade' | 'dissolve' | 'wipe';
  duration: number;
}
