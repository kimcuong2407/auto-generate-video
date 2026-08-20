/**
 * Stream 1 file local qua HTTP với hỗ trợ Range (video/audio seek được) — dùng chung cho mọi
 * route media (livestream job, livestream merge, project...) thay vì lặp lại ~60 dòng này mỗi nơi.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json',
};

function mimeFor(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export async function streamFileResponse(req: NextRequest, absPath: string): Promise<NextResponse> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return NextResponse.json({ error: 'File không tồn tại' }, { status: 404 });
  }
  if (!stat.isFile()) {
    return NextResponse.json({ error: 'Không phải file' }, { status: 400 });
  }

  const contentType = mimeFor(absPath);
  const range = req.headers.get('range');

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const end = match?.[2] ? parseInt(match[2], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    const stream = createReadStream(absPath, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType,
      },
    });
  }

  const stream = createReadStream(absPath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Length': String(stat.size),
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    },
  });
}
