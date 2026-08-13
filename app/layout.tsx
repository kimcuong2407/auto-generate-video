import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Veo Product Review Pipeline',
  description: 'Pipeline tạo video review sản phẩm bằng Google Veo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
