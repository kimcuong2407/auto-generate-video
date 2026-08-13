'use client';

import { useEffect } from 'react';

export function MediaModal({
  kind,
  src,
  alt,
  onClose,
}: {
  kind: 'image' | 'video';
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="media-modal-overlay" onClick={onClose}>
      <div className="media-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="media-modal-close" onClick={onClose} title="Đóng (Esc)">
          ✕
        </button>
        {kind === 'image' ? (
          <img src={src} alt={alt || ''} />
        ) : (
          <video src={src} controls autoPlay />
        )}
      </div>
    </div>
  );
}
