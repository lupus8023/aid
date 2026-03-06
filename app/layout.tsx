import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Storyboard Studio',
  description: 'Generate storyboard images from story scripts using AI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
