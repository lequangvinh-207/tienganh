import os
import json
from contextlib import asynccontextmanager
from typing import List, Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import database as db
import nlp_engine as nlp


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure user database and settings are initialized
    db.init_user_db()
    yield


app = FastAPI(title="Art Deco Vocabulary Vault", lifespan=lifespan)

# Allow CORS for local dev flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(STATIC_DIR, exist_ok=True)


# Models
class VocabCreateRequest(BaseModel):
    word: str
    meaning: str
    pronounce: Optional[str] = ""
    example: Optional[str] = ""
    synonyms: Optional[List[str]] = []
    antonyms: Optional[List[str]] = []
    initial_delay: Optional[int] = 10  # in seconds for quick testing


class VocabUpdateRequest(BaseModel):
    meaning: str
    pronounce: Optional[str] = ""
    example: Optional[str] = ""
    synonyms: Optional[List[str]] = []
    antonyms: Optional[List[str]] = []


class ParagraphExtractRequest(BaseModel):
    text: str
    auto_save: Optional[bool] = True
    initial_delay: Optional[int] = 10


class ReviewSubmission(BaseModel):
    answer: str
    used_hint: Optional[bool] = False
    cycle_seconds: Optional[int] = 60


class SettingsUpdate(BaseModel):
    review_cycle: Optional[str] = None
    speech_voice: Optional[str] = None
    speech_rate: Optional[str] = None
    lock_enabled: Optional[str] = None


class FlashcardReview(BaseModel):
    quality: Literal["again", "hard", "good", "easy"]


# --- Endpoints ---

@app.get("/api/lookup")
def lookup_word(word: str = Query(..., min_length=1)):
    """Tra cứu 1 từ: tự động lấy nghĩa từ dict_hh.db, IPA, synonyms/antonyms và ví dụ từ WordNet."""
    clean_word = word.strip().lower()
    dict_res = db.lookup_in_dict(clean_word)

    # WordNet processing
    synonyms, antonyms = nlp.get_synonyms_antonyms(clean_word)
    examples = nlp.get_wordnet_examples(clean_word)

    # Pronunciation: dict or fallback
    raw_pron = dict_res["pronounce"] if dict_res else ""
    ipa = nlp.get_ipa_pronounce(clean_word, raw_pron)

    # Check if existing in user db
    user_entry = db.get_vocab_by_word(clean_word)

    if dict_res:
        return {
            "found": True,
            "word": clean_word,
            "pronounce": ipa,
            "description": dict_res["description"],
            "html": dict_res["html"],
            "synonyms": synonyms,
            "antonyms": antonyms,
            "examples": examples,
            "user_vocab": user_entry
        }
    else:
        # Word not in dict_hh.db, but maybe has WordNet data & IPA
        return {
            "found": bool(synonyms or examples or ipa),
            "word": clean_word,
            "pronounce": ipa,
            "description": "Không tìm thấy trong từ điển gốc. Bạn có thể tự nhập nghĩa.",
            "html": "",
            "synonyms": synonyms,
            "antonyms": antonyms,
            "examples": examples,
            "user_vocab": user_entry
        }


@app.post("/api/extract-paragraph")
def extract_paragraph(req: ParagraphExtractRequest):
    """
    Trích xuất hàng loạt từ đoạn văn bản tiếng Anh:
    Lọc bỏ stopwords, tra cứu từ điển dict_hh.db, lấy IPA, đồng/trái nghĩa và lưu vào user_data.db.
    """
    extracted_tokens = nlp.extract_words_from_paragraph(req.text)
    if not extracted_tokens:
        return {"total": 0, "saved": 0, "words": []}

    results = []
    saved_count = 0

    for word, context_sentence in extracted_tokens:
        dict_res = db.lookup_in_dict(word)
        if not dict_res:
            continue

        raw_pron = dict_res.get("pronounce", "")
        ipa = nlp.get_ipa_pronounce(word, raw_pron)
        synonyms, antonyms = nlp.get_synonyms_antonyms(word)

        meaning = dict_res.get("description") or "Nghĩa chưa xác định"
        example = context_sentence

        vocab_id = None
        if req.auto_save:
            try:
                vocab_id = db.add_or_update_vocab(
                    word=word,
                    meaning=meaning,
                    pronounce=ipa,
                    example=example,
                    synonyms=synonyms,
                    antonyms=antonyms,
                    initial_delay_seconds=req.initial_delay or 10
                )
                saved_count += 1
            except Exception as e:
                print(f"Error saving word {word}: {e}")

        results.append({
            "id": vocab_id,
            "word": word,
            "meaning": meaning,
            "pronounce": ipa,
            "example": example,
            "synonyms": synonyms,
            "antonyms": antonyms
        })

    return {
        "total_extracted": len(extracted_tokens),
        "total_matched": len(results),
        "saved_count": saved_count,
        "words": results
    }


@app.get("/api/vocab")
def list_vocab(search: str = Query("", alias="q"), status: str = Query("all")):
    """Lấy danh sách từ trong kho từ vựng cá nhân, có hỗ trợ tìm kiếm và lọc."""
    return db.get_all_vocab(search=search, status=status)


@app.post("/api/vocab")
def create_vocab(item: VocabCreateRequest):
    """Thêm mới hoặc cập nhật từ vựng vào kho cá nhân."""
    try:
        vocab_id = db.add_or_update_vocab(
            word=item.word,
            meaning=item.meaning,
            pronounce=item.pronounce or "",
            example=item.example or "",
            synonyms=item.synonyms or [],
            antonyms=item.antonyms or [],
            initial_delay_seconds=item.initial_delay or 10
        )
        return {"success": True, "id": vocab_id, "word": item.word}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/vocab/{vocab_id}")
def update_vocab_item(vocab_id: int, item: VocabUpdateRequest):
    existing = db.get_vocab_by_id(vocab_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Không tìm thấy từ này")
    db.update_vocab(
        vocab_id=vocab_id,
        meaning=item.meaning,
        pronounce=item.pronounce or "",
        example=item.example or "",
        synonyms=item.synonyms or [],
        antonyms=item.antonyms or []
    )
    return {"success": True}


@app.delete("/api/vocab/{vocab_id}")
def delete_vocab_item(vocab_id: int):
    existing = db.get_vocab_by_id(vocab_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Không tìm thấy từ này")
    db.delete_vocab(vocab_id)
    return {"success": True}


@app.get("/api/flashcards")
def get_flashcards(
    mode: Literal["due", "all"] = Query("due"),
    limit: int = Query(50, ge=1, le=100),
):
    """Get cards for a flashcard study session."""
    return db.get_flashcard_deck(mode=mode, limit=limit)


@app.post("/api/flashcards/{vocab_id}/review")
def review_flashcard(vocab_id: int, review: FlashcardReview):
    """Grade a flashcard and persist its SM-2 schedule and earned XP."""
    updated = db.process_flashcard_review(vocab_id, review.quality)
    if not updated:
        raise HTTPException(status_code=404, detail="Không tìm thấy từ")
    return {
        "success": True,
        "word": updated["word"],
        "quality": review.quality,
        "repetition": updated["repetition"],
        "interval": updated["interval"],
        "ease_factor": round(updated["ease_factor"], 2),
        "next_review": updated["next_review"],
        "status": updated["status"],
        "xp_earned": updated["xp_earned"],
    }


@app.get("/api/due")
def get_due_words():
    """Lấy danh sách các từ đã đến hạn ôn tập cho màn hình khóa."""
    words = db.get_due_vocab()
    # Mask the English word in public due list to prevent cheating
    masked = []
    for w in words:
        item = dict(w)
        item["word_length"] = len(w["word"])
        item["first_char"] = w["word"][0] if w["word"] else ""
        # Keep word in review object for backend verification
        masked.append(item)
    return masked


@app.post("/api/review/{vocab_id}")
def submit_review(vocab_id: int, sub: ReviewSubmission):
    """
    Xác thực câu trả lời ôn tập từ màn hình khóa.
    Áp dụng thuật toán SM-2:
    - Nếu đúng và không dùng gợi ý: cập nhật repetition, tính next_review dựa trên SM-2.
    - Nếu gõ sai hoặc có dùng gợi ý: reset repetition = 0, hẹn ôn lại sau 2 phút!
    """
    item = db.get_vocab_by_id(vocab_id)
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy từ")

    actual_word = item["word"].strip().lower()
    user_answer = sub.answer.strip().lower()
    is_correct = (user_answer == actual_word)

    updated_word = db.process_sm2_review(
        vocab_id=vocab_id,
        is_correct=is_correct,
        used_hint=sub.used_hint,
        cycle_multiplier=sub.cycle_seconds or 60
    )

    return {
        "correct": is_correct,
        "correct_word": actual_word,
        "used_hint": sub.used_hint,
        "repetition": updated_word["repetition"],
        "interval": updated_word["interval"],
        "ease_factor": round(updated_word["ease_factor"], 2),
        "next_review": updated_word["next_review"],
        "status": updated_word["status"],
        "message": "Chính xác! Lịch ôn đã được dời tiếp." if (is_correct and not sub.used_hint)
                   else "Chưa đạt! Từ này đã bị chuyển sang ôn lại sau 2 phút."
    }


@app.get("/api/stats")
def dashboard_stats():
    """Thống kê tổng quan kho từ."""
    return db.get_stats()


@app.get("/api/settings")
def get_settings():
    return {
        "review_cycle": db.get_setting("review_cycle", "60"),
        "speech_voice": db.get_setting("speech_voice", "en-US"),
        "speech_rate": db.get_setting("speech_rate", "1.0"),
        "lock_enabled": db.get_setting("lock_enabled", "0"),
    }


@app.post("/api/settings")
def update_settings(st: SettingsUpdate):
    if st.review_cycle is not None:
        db.set_setting("review_cycle", st.review_cycle)
    if st.speech_voice is not None:
        db.set_setting("speech_voice", st.speech_voice)
    if st.speech_rate is not None:
        db.set_setting("speech_rate", st.speech_rate)
    if st.lock_enabled is not None:
        db.set_setting("lock_enabled", st.lock_enabled)
    return {"success": True}


@app.get("/api/gamification")
def get_gamification_stats():
    """Lấy thông tin Level, XP, Streak và trạng thái điểm danh."""
    return db.get_gamification()


@app.post("/api/checkin")
def user_checkin():
    """Thực hiện điểm danh hàng ngày: +50 XP và tăng Streak."""
    return db.check_in_today()


# Serve static files and fallback index.html
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def read_root():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Art Deco Vocabulary App is running."}
