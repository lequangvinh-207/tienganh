# VAI TRÒ & MỤC TIÊU
Bạn là Senior Full-Stack Python Developer & UI/UX Designer. Hãy xây dựng hoàn chỉnh một ứng dụng Web học từ vựng tiếng Anh chạy **100% OFFLINE (Zero External API)** sử dụng **Python (FastAPI + SQLite)** cho Backend và **HTML5 + TailwindCSS + Vanilla JavaScript** cho Frontend.

---

# 1. DỮ LIỆU TỪ ĐIỂN CÓ SẴN TRONG THƯ MỤC GỐC
Trong thư mục gốc của dự án đã có sẵn file cơ sở dữ liệu SQLite tên là **`dict_hh.db`** (chứa bảng `av` với các cột: `word`, `html`, `description`, `pronounce`).
- Hãy viết code kết nối trực tiếp tới `dict_hh.db` (chỉ đọc - read-only) để tra cứu nghĩa tiếng Việt (`description` hoặc trích xuất sạch từ `html`) và phiên âm (`pronounce`).
- Tạo thêm một file database thứ hai là **`user_data.db`** để lưu danh sách từ vựng cá nhân của người dùng và tiến độ ôn tập.

---

# 2. YÊU CẦU 4 CHỨC NĂNG CỐT LÕI (KHÔNG DÙNG API NGOÀI)

## Chức năng 1: Quản lý & Nhập từ vựng tự động hóa
- **Auto-fill 1 từ:** Khi người dùng nhập từ tiếng Anh và bấm "Tra cứu", Backend tự động lấy nghĩa tiếng Việt & phiên âm từ `dict_hh.db`, đồng thời lấy câu ví dụ từ `nltk.corpus.wordnet`.
- **Trích xuất hàng loạt từ đoạn văn:** Cho phép dán một đoạn văn bản tiếng Anh; Backend tự lọc các từ có nghĩa (bỏ stopwords), tự điền đầy đủ nghĩa từ `dict_hh.db`, IPA, đồng/trái nghĩa và lưu hàng loạt vào `user_data.db`.
- **Quản lý kho từ:** Tìm kiếm, lọc theo trạng thái ôn tập, chỉnh sửa và xóa từ.

## Chức năng 2: Đề xuất từ đồng nghĩa & trái nghĩa
- Dùng `nltk.corpus.wordnet` chạy offline để tự động trích xuất tối đa 5 từ đồng nghĩa (*Synonyms*) và 5 từ trái nghĩa (*Antonyms*) cho mỗi từ. Hiển thị dạng thẻ tag bấm được để tra nhanh.

## Chức năng 3: Phát âm & Phiên âm quốc tế (IPA)
- Lấy phiên âm từ cột `pronounce` của `dict_hh.db` (nếu từ nào trống thì dùng thư viện Python `eng-to-ipa` để tự sinh).
- Dùng **Web Speech API (`window.speechSynthesis`)** trên trình duyệt để đọc từ vựng và câu ví dụ với giọng chuẩn Anh-Mỹ (`en-US`) và Anh-Anh (`en-GB`), có nút chọn tốc độ đọc (1.0x / 0.75x).

## Chức năng 4: Nhắc học từ vựng bắt buộc (Mandatory Lock Screen)
- Tích hợp thuật toán lặp lại ngắt quãng **SM-2** tính toán thời điểm ôn tập (`next_review`).
- Cho phép cài đặt chu kỳ kiểm tra (10 giây để test, 5 phút, 15 phút, 30 phút).
- Khi có từ đến hạn ôn tập:
  1. Kích hoạt **Web Notification API** (thông báo đẩy ngoài màn hình desktop) + âm thanh chuông nhẹ + nhấp nháy tiêu đề tab (`[🔒 ĐẾN GIỜ ÔN TẬP!]`) nếu người dùng đang mở tab/ứng dụng khác.
  2. Trên web app bật **Modal Overlay khóa toàn màn hình (không có nút đóng `X`, khóa phím `Esc` và khóa cuộn trang)**.
  3. Hiển thị nghĩa tiếng Việt + phiên âm + nút nghe phát âm (ẩn từ tiếng Anh). Người dùng **bắt buộc phải gõ đúng từ tiếng Anh** thì hệ thống mới cập nhật lịch ôn và mở khóa màn hình. (Có nút "Gợi ý chữ cái", nhưng nếu dùng gợi ý hoặc gõ sai thì từ đó bị reset hẹn 2 phút sau hỏi lại).

---

# 3. CẤU TRÚC THƯ MỤC CẦN TẠO
Tạo đầy đủ code chạy được ngay cho các file:
- `database.py` (kết nối `dict_hh.db` và quản lý `user_data.db`)
- `nlp_engine.py` (xử lý WordNet đồng/trái nghĩa, IPA dự phòng, lọc từ đoạn văn)
- `main.py` (FastAPI backend)
- `static/index.html`, `static/style.css`, `static/app.js` (Giao diện Neo-Noir Art Deco hoàn chỉnh)

Hãy kiểm tra cấu trúc bảng thực tế trong `dict_hh.db` trước khi viết truy vấn SQL để đảm bảo không lỗi tên cột, sau đó tạo toàn bộ các file trên.

## Học Flashcard

Tab **Học Flashcard** trong sidebar tạo phiên học từ các từ đến hạn hoặc toàn bộ kho từ. Nhấn thẻ hoặc phím `Space` để lật; các mức Quên, Khó, Nhớ và Rất dễ lưu lịch ôn SM-2 cùng XP vào `user_data.db`. Thẻ Quên được đưa lại vào phiên sau một phút.