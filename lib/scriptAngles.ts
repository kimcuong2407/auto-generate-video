export interface ScriptAngle {
  id: string;
  title: string;
  description: string;
  /** Chỉ dẫn thêm cho AI khi viết theo góc này, gắn vào system prompt gọi AI chat API. */
  aiGuidance: string;
}

export const SCRIPT_ANGLES: ScriptAngle[] = [
  {
    id: 'unboxing',
    title: 'Unboxing + trải nghiệm đầu tiên',
    description:
      'Mở hộp, mô tả cảm nhận ban đầu về bao bì, phụ kiện, chất liệu. Phù hợp sản phẩm mới ra mắt, tạo cảm giác "khám phá cùng người xem".',
    aiGuidance:
      'Viết theo góc Unboxing: mở đầu bằng cảnh mở hộp/bao bì, mô tả cảm nhận đầu tiên khi chạm vào sản phẩm, khám phá từng phụ kiện/chi tiết, giọng điệu tò mò hào hứng như đang khám phá cùng người xem. ' +
      'Cấu trúc cảnh gợi ý: (1) cảnh mở hộp là cảnh đầu tiên bắt buộc, không bỏ qua; (2) 1-2 cảnh khám phá cận cảnh phụ kiện/chất liệu; (3) 1-2 cảnh thử dùng nhanh để cho thấy sản phẩm hoạt động; (4) CTA kết. Không cần cảnh "vấn đề/nỗi đau" mở đầu — người xem đã tò mò sẵn vì thấy hộp.',
  },
  {
    id: 'clickbait-shock',
    title: 'Hook giật gân: "Lừa rồi! Làm gì có hàng rẻ thế này"',
    description:
      'Cảnh đầu la lên kiểu vạch trần ("Lừa rồi lừa rồi... làm gì có hàng rẻ thế này!"), sau đó lật ngược lại chứng minh hàng thật giá thật. Giọng đọc nhanh, dồn dập, giữ chân người xem 3 giây đầu. Hợp sản phẩm giá tốt, đang chạy khuyến mãi.',
    aiGuidance:
      'Viết theo góc Hook giật gân (clickbait lật ngược): cảnh ĐẦU TIÊN bắt buộc là một câu la lên đầy hoài nghi/bức xúc như đang vạch trần lừa đảo, nói ngay trong 1-2 giây đầu, KHÔNG chào hỏi, KHÔNG giới thiệu tên, KHÔNG mở hộp. Mẫu tham khảo (viết lại cho hợp sản phẩm, không chép nguyên si): "Lừa rồi lừa rồi... làm gì có hàng rẻ thế này!", "Thôi xong, mua hớ rồi!", "Giá này là bán phá giá chứ review gì nữa!". ' +
      'Cấu trúc cảnh gợi ý: (1) cảnh hook la lên hoài nghi/tố giá rẻ bất thường — cảnh ngắn 3-5 giây, cận mặt hoặc cận sản phẩm, năng lượng cao nhất video; (2) 1 cảnh "soi hàng" kiểm chứng ngay tại chỗ (lật, bóp, cạo, thử...) để xem có phải hàng dỏm không; (3) 1-2 cảnh LẬT NGƯỢC — thừa nhận hàng thật, chỉ ra bằng chứng chất lượng cụ thể, cảm xúc chuyển từ nghi ngờ sang bất ngờ/thích thú; (4) CTA kết chốt đơn gấp, nhấn "giá này không giữ lâu". ' +
      'BẮT BUỘC về giọng đọc — khi chốt "chất giọng cố định" ở Bước 1.c và nhúng vào phần Dialogue của MỌI veoPrompt, phải mô tả đúng kiểu: giọng nói rất nhanh, dồn dập, cao và vang, năng lượng cao như đang livestream chốt đơn, nhấn mạnh từng từ ở cảnh hook rồi giữ nhịp nhanh xuyên suốt. Trong veoPrompt dùng các cụm tiếng Anh như "speaks very fast, rapid-fire delivery, high-energy, loud excited tone, urgent street-vendor livestream energy, rising intonation" đặt ngay trước câu thoại theo đúng cú pháp colon đã quy định. Giữ nguyên văn mô tả giọng này ở tất cả các cảnh. ' +
      'Vì nói nhanh nên voiceoverVi được phép dài hơn mức thường: ước lượng khoảng 4-5 từ/giây thay vì 2-3 từ/giây. Câu thoại ngắn, cụt, nhiều dấu chấm than, dùng khẩu ngữ đời thường như đang nói với bạn.',
  },
  {
    id: 'problem-solution',
    title: 'Problem → Solution',
    description:
      'Mở đầu bằng một vấn đề người xem hay gặp ("da dầu mà trời nồm thế này thì..."), sau đó giới thiệu sản phẩm như giải pháp, demo thực tế, chốt kết quả. Đây là kịch bản chuyển đổi tốt nhất cho TikTok Shop.',
    aiGuidance:
      'Viết theo góc Problem → Solution: mở đầu nêu 1 vấn đề/nỗi đau cụ thể mà người xem hay gặp phải (dùng ngôn ngữ đời thường, gây đồng cảm ngay), sau đó giới thiệu sản phẩm như giải pháp, demo cách sản phẩm giải quyết vấn đề, chốt lại kết quả rõ ràng. Đây là kịch bản chuyển đổi bán hàng, cần thúc đẩy hành động mua. ' +
      'Cấu trúc cảnh gợi ý: (1) cảnh nêu vấn đề là cảnh đầu tiên bắt buộc (không quay cảnh mở hộp dài dòng ở đây); (2) đưa sản phẩm vào ngay sau đó như giải pháp; (3) 1-2 cảnh demo sản phẩm giải quyết đúng vấn đề vừa nêu; (4) CTA kết nhấn mạnh kết quả + giá/ưu đãi.',
  },
  {
    id: 'honest-review',
    title: 'Review trung thực / ưu nhược điểm',
    description:
      'Dùng thử một thời gian rồi đánh giá cả điểm mạnh lẫn điểm yếu, chấm điểm từng tiêu chí. Tạo độ tin cậy cao, hợp với sản phẩm giá trị lớn.',
    aiGuidance:
      'Viết theo góc Review trung thực: giọng điệu khách quan như đã dùng thử một thời gian, nêu rõ cả điểm mạnh lẫn điểm yếu/hạn chế của sản phẩm, có thể chấm điểm hoặc tổng kết đánh giá ở cuối. Tạo cảm giác đáng tin cậy, không tâng bốc một chiều. ' +
      'Cấu trúc cảnh gợi ý: (1) cảnh mở đầu giới thiệu ngắn "mình đã dùng sản phẩm này được [thời gian]" — không cần cảnh mở hộp; (2) 1-2 cảnh nêu điểm mạnh kèm hình ảnh minh hoạ; (3) bắt buộc có ít nhất 1 cảnh nêu điểm yếu/hạn chế thật để giữ tính khách quan; (4) cảnh chấm điểm/tổng kết kèm CTA.',
  },
  {
    id: 'comparison',
    title: 'So sánh (A vs B)',
    description:
      'Đặt sản phẩm cạnh đối thủ cùng phân khúc, so từng khía cạnh (giá, chất lượng, trải nghiệm). Thu hút người xem đang phân vân giữa các lựa chọn.',
    aiGuidance:
      'Viết theo góc So sánh (A vs B): đặt sản phẩm cạnh 1 lựa chọn thay thế/đối thủ cùng phân khúc (có thể không nêu tên cụ thể, dùng "loại thông thường" hoặc "sản phẩm khác"), so sánh từng khía cạnh như giá, chất lượng, trải nghiệm sử dụng, kết luận vì sao sản phẩm này đáng chọn hơn. ' +
      'Cấu trúc cảnh gợi ý: (1) cảnh mở đầu đặt câu hỏi phân vân "nên chọn cái nào?" — không cần cảnh mở hộp; (2) mỗi tiêu chí so sánh (giá/chất lượng/trải nghiệm) là 1 cảnh riêng, đủ 2-4 tiêu chí; (3) cảnh kết luận vì sao chọn sản phẩm này + CTA.',
  },
  {
    id: 'challenge-test',
    title: 'Test / thử thách',
    description:
      'Đưa sản phẩm vào tình huống khắc nghiệt hoặc bất ngờ (thả rơi, dùng liên tục 24h, thử với 10 người). Tính giải trí cao, dễ viral.',
    aiGuidance:
      'Viết theo góc Test/Thử thách: đưa sản phẩm vào 1 tình huống khắc nghiệt hoặc bất ngờ để kiểm chứng độ bền/hiệu quả (thả rơi, dùng liên tục, thử nghiệm cực đoan phù hợp với loại sản phẩm), giọng điệu hào hứng, kịch tính, tạo cảm giác giải trí và bất ngờ. ' +
      'Cấu trúc cảnh gợi ý: (1) cảnh mở đầu tuyên bố thử thách "hôm nay mình sẽ thử..." là hook ngay, không cần cảnh mở hộp/nêu vấn đề riêng; (2) 2-3 cảnh diễn ra thử thách theo trình tự tăng dần độ khó/kịch tính; (3) cảnh kết quả bất ngờ + CTA.',
  },
  {
    id: 'before-after',
    title: 'Before – After',
    description: 'Cho thấy kết quả trước và sau khi dùng. Hợp mỹ phẩm, đồ gia dụng, dụng cụ vệ sinh.',
    aiGuidance:
      'Viết theo góc Before-After: mô tả rõ tình trạng/kết quả TRƯỚC khi dùng sản phẩm (vấn đề, sự bừa bộn, tình trạng chưa tốt), sau đó cho thấy kết quả SAU khi dùng thay đổi rõ rệt như thế nào. Nhấn mạnh sự tương phản. ' +
      'Cấu trúc cảnh gợi ý: (1) cảnh "before" là cảnh đầu tiên bắt buộc, cho thấy rõ tình trạng chưa tốt; (2) 1 cảnh ngắn đưa sản phẩm vào sử dụng; (3) cảnh "after" tương phản rõ với cảnh mở đầu; (4) CTA kết. Không cần cảnh mở hộp riêng.',
  },
  {
    id: 'storytelling',
    title: 'Kịch bản tình huống / storytelling',
    description:
      'Lồng sản phẩm vào một câu chuyện đời thường (một ngày của tôi, chuẩn bị đi du lịch...). Mềm mại, ít cảm giác quảng cáo.',
    aiGuidance:
      'Viết theo góc Storytelling: lồng sản phẩm vào 1 câu chuyện/tình huống đời thường tự nhiên (một ngày sinh hoạt, chuẩn bị đi đâu đó, một khoảnh khắc cụ thể), sản phẩm xuất hiện như 1 phần tự nhiên của câu chuyện chứ không phải quảng cáo lộ liễu. Giọng điệu mềm mại, gần gũi, kể chuyện. ' +
      'Cấu trúc cảnh gợi ý: các cảnh nối tiếp nhau theo dòng thời gian của câu chuyện (VD: sáng sớm → chuẩn bị → ra khỏi nhà), sản phẩm xuất hiện tự nhiên ở 1-2 khoảnh khắc giữa chuyện, không cần cảnh mở hộp/giới thiệu sản phẩm tách biệt. CTA cuối nên nhẹ nhàng, lồng vào cảm xúc câu chuyện thay vì hô hào mua hàng trực tiếp.',
  },
  {
    id: 'qa',
    title: 'Q&A / phản hồi bình luận',
    description:
      'Trả lời các câu hỏi người xem hay thắc mắc về sản phẩm, dạng "mọi người hỏi nhiều quá nên mình làm video này".',
    aiGuidance:
      'Viết theo góc Q&A: mở đầu kiểu "mọi người hỏi mình nhiều quá nên làm video này trả lời luôn", sau đó lần lượt trả lời các câu hỏi thường gặp về sản phẩm (chất lượng, cách dùng, giá, có đáng mua không...) một cách tự nhiên như đang trò chuyện trực tiếp với người xem. ' +
      'Cấu trúc cảnh gợi ý: (1) cảnh mở đầu nêu lý do làm video Q&A — không cần mở hộp; (2) mỗi câu hỏi thường gặp là 1 cảnh riêng (3-5 câu hỏi), có thể hiển thị câu hỏi dạng on-screen text như đang đọc comment; (3) cảnh kết tổng hợp/CTA.',
  },
  {
    id: 'hand-hold-voiceover',
    title: 'Đơn giản: Cầm sản phẩm + giọng giới thiệu (không lộ mặt)',
    description:
      'Video ngắn 16-24s, chỉ quay tay cầm/xoay sản phẩm cận cảnh kèm giọng voiceover giới thiệu, không cần diễn viên/người mẫu xuất hiện mặt. Dễ quay, dễ dựng, phù hợp khi không có người mẫu hoặc muốn ra video nhanh.',
    aiGuidance:
      'Viết theo góc Đơn giản — Cầm sản phẩm + voiceover: TUYỆT ĐỐI không để khuôn mặt người xuất hiện trong bất kỳ cảnh nào — chỉ quay cận cảnh bàn tay/cánh tay đang cầm, xoay, mở, hoặc thao tác với sản phẩm (khung hình cắt từ vai/cổ tay trở xuống, hoặc chỉ tay + sản phẩm trên nền/bàn). Không dùng góc quay selfie hướng lên mặt, không mô tả biểu cảm khuôn mặt. Giọng voiceover đóng vai trò dẫn dắt toàn bộ nội dung như 1 người đang giới thiệu ngoài khung hình (voice-over off-screen), giọng điệu thân thiện, tự nhiên, đi thẳng vào trọng tâm. ' +
      'Ràng buộc thời lượng BẮT BUỘC: bỏ qua tổng thời lượng mục tiêu được nêu ở phần mô tả sản phẩm nếu nó dài hơn — tổng thời lượng toàn bộ kịch bản PHẢI nằm trong khoảng 16-24 giây, chia thành đúng 2-3 cảnh ngắn (mỗi cảnh 6-10 giây). ' +
      'Cấu trúc cảnh gợi ý: (1) cảnh đầu tay cầm sản phẩm đưa vào khung hình cận cảnh, voiceover mở đầu nêu ngay tên/công dụng chính — đây là hook, không cần mở hộp hay nêu vấn đề dài dòng; (2) 1 cảnh tay thao tác/xoay sản phẩm để lộ chi tiết/tính năng nổi bật, voiceover mô tả tính năng đó; (3) (tuỳ chọn) cảnh cuối tay cầm sản phẩm hướng về khung hình như mời chốt đơn, voiceover CTA ngắn gọn kèm giá/ưu đãi nếu có. Mọi veoPrompt phải mô tả rõ "hands only, no face visible, off-screen voiceover narration" và tuân đúng chỉ dẫn Subject/Action/Scene/Style/Dialogue/Sounds/Technical đã nêu ở trên, với phần Subject chỉ mô tả bàn tay + sản phẩm.',
  },
  {
    id: 'feature-demo',
    title: 'Demo công năng / tính năng sản phẩm',
    description:
      'Vào thẳng cảnh sử dụng sản phẩm, demo lần lượt các công năng/tính năng chính, không cần đoạn intro dẫn dắt. Phù hợp sản phẩm có nhiều tính năng cụ thể muốn cho xem ngay (đồ gia dụng, dụng cụ, thiết bị công nghệ).',
    aiGuidance:
      'Viết theo góc Demo công năng: KHÔNG mở đầu bằng intro/nêu vấn đề/mở hộp — cảnh đầu tiên vào thẳng hành động sử dụng/demo sản phẩm để hook ngay trong 3 giây đầu. Xác định 3-5 công năng/tính năng chính của sản phẩm, mỗi công năng ứng với đúng 1 cảnh demo riêng biệt, trình bày theo thứ tự từ tính năng cơ bản đến tính năng nổi bật/khác biệt nhất. ' +
      'Cấu trúc cảnh gợi ý: (1) cảnh đầu tiên demo trực tiếp tính năng dễ thấy/ấn tượng nhất — đóng vai trò hook, tuyệt đối không phải cảnh intro/mở hộp; (2) các cảnh tiếp theo mỗi cảnh 1 tính năng, lời thoại mô tả ngắn gọn tính năng đó đang làm gì và lợi ích; (3) cảnh cuối chốt lại tổng thể công năng + CTA. Giọng điệu thực tế, đi thẳng vào trọng tâm, không dài dòng dẫn chuyện.',
  },
];

export function findScriptAngle(id: string | undefined | null): ScriptAngle | undefined {
  return SCRIPT_ANGLES.find((a) => a.id === id);
}
