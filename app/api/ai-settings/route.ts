import { NextRequest, NextResponse } from 'next/server';
import { readAppSettings, writeAppSettings } from '@/lib/data/appSettingsStore';
import { IMAGE_MODEL_OPTIONS, DEFAULT_STORYBOARD_MODEL } from '@/lib/imageModels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = readAppSettings();
  return NextResponse.json({
    chatModel: settings.chatModel,
    defaultModel: process.env.AI_CHAT_API_MODEL || null,
    imageModel: settings.imageModel,
    imageModelOptions: IMAGE_MODEL_OPTIONS,
    defaultImageModel: DEFAULT_STORYBOARD_MODEL,
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    chatModel?: string | null;
    imageModel?: string | null;
  };
  if (body.chatModel !== undefined && body.chatModel !== null && typeof body.chatModel !== 'string') {
    return NextResponse.json({ error: 'chatModel không hợp lệ' }, { status: 400 });
  }
  // Chỉ nhận giá trị có trong dropdown. Khác chatModel (danh sách động từ 9router nên không
  // whitelist được), model ảnh là tập đóng — lưu giá trị lạ sẽ khiến MỌI luồng gen ảnh rơi
  // xuống nhánh Google Flow với model không tồn tại, hỏng toàn cục chứ không riêng 1 job.
  if (
    body.imageModel !== undefined &&
    body.imageModel !== null &&
    !(IMAGE_MODEL_OPTIONS as readonly { value: string }[]).some((o) => o.value === body.imageModel)
  ) {
    return NextResponse.json({ error: `Model ảnh không hợp lệ: ${body.imageModel}` }, { status: 400 });
  }

  const settings = writeAppSettings({
    ...(body.chatModel === undefined ? {} : { chatModel: body.chatModel?.trim() || null }),
    ...(body.imageModel === undefined ? {} : { imageModel: body.imageModel || null }),
  });
  return NextResponse.json({
    chatModel: settings.chatModel,
    defaultModel: process.env.AI_CHAT_API_MODEL || null,
    imageModel: settings.imageModel,
  });
}
