import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SCIMEM — project memory for AI dev',
  description: 'Captured context → retrieved evidence → cited answers. Cloud project-memory + context compiler for AI-assisted development.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}