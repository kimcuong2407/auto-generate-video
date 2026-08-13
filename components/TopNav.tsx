'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Video Review', icon: '🎬', match: (p: string) => p === '/' },
  { href: '/livestream', label: 'Livestream Script', icon: '📡', match: (p: string) => p.startsWith('/livestream') },
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
