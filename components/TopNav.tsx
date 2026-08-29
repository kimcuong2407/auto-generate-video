'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Video Review', icon: '🎬', match: (p: string) => p === '/' },
  {
    href: '/livestream',
    label: 'Livestream Script',
    icon: '📡',
    // Loại trừ /livestream-v2 vì startsWith('/livestream') cũng khớp nó — nếu không, mở tab V2 sẽ
    // thấy CẢ HAI tab cùng sáng.
    match: (p: string) => p.startsWith('/livestream') && !p.startsWith('/livestream-v2'),
  },
  {
    href: '/livestream-v2',
    label: 'Livestream Shopee V2',
    icon: '🛒',
    match: (p: string) => p.startsWith('/livestream-v2'),
  },
  { href: '/shopee-crawl', label: 'Shopee Crawl', icon: '🛍️', match: (p: string) => p.startsWith('/shopee-crawl') },
  { href: '/settings/ai', label: 'Cài đặt AI', icon: '⚙️', match: (p: string) => p === '/settings/ai' },
  { href: '/settings/flow', label: 'Tài khoản Veo', icon: '🔑', match: (p: string) => p === '/settings/flow' },
];

export function TopNav() {
  const pathname = usePathname() || '/';

  return (
    <nav className="top-nav">
      <div className="top-nav-inner">
        <div className="top-nav-brand">
          🎬 <span>Veo</span> Pipeline
        </div>
        <div className="top-nav-tabs">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`top-nav-tab${tab.match(pathname) ? ' active' : ''}`}
            >
              <span className="top-nav-tab-icon">{tab.icon}</span> {tab.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
