import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Planner',
  description: 'Your personal day planner',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
