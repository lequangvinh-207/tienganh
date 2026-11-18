import sqlite3
import os
import json
from datetime import datetime, timedelta, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DICT_DB_PATH = os.path.join(BASE_DIR, "dict_hh.db")
USER_DB_PATH = os.path.join(BASE_DIR, "user_data.db")


def get_dict_connection():
    """Connect to dict_hh.db in read-only mode."""
    conn = sqlite3.connect(DICT_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_user_connection():
    """Connect to user_data.db."""
    conn = sqlite3.connect(USER_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_user_db():
    """Initialize user_data.db tables if not already present."""
    conn = get_user_connection()
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS vocab_words (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT UNIQUE NOT NULL,
        meaning TEXT NOT NULL,
        pronounce TEXT,
        example TEXT,
        synonyms TEXT DEFAULT '[]',
        antonyms TEXT DEFAULT '[]',
        status TEXT DEFAULT 'learning',
        repetition INTEGER DEFAULT 0,
        interval INTEGER DEFAULT 1,
        ease_factor REAL DEFAULT 2.5,
        next_review TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_reviewed TEXT,
        review_count INTEGER DEFAULT 0,
        correct_count INTEGER DEFAULT 0
    )
    """)
    c.execute("""
    CREATE INDEX IF NOT EXISTS idx_vocab_word ON vocab_words(word);
    """)
    c.execute("""
    CREATE INDEX IF NOT EXISTS idx_vocab_next_review ON vocab_words(next_review);
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)
    # Set default settings if not exists
    c.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('review_cycle', '60')")  # seconds
    c.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('speech_voice', 'en-US')")
    c.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('speech_rate', '1.0')")
    c.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('user_xp', '50')")
    c.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('user_streak', '1')")
    c.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('last_checkin', '')")
    c.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('lock_enabled', '0')")
    conn.commit()
    conn.close()


def lookup_in_dict(word: str):
    """
    Look up a single word in dict_hh.db.
    Returns dict with word, pronounce, description, html, or None if not found.
    """
    clean_word = word.strip()
    if not clean_word:
        return None

    conn = get_dict_connection()
    c = conn.cursor()
    try:
        # Case insensitive exact match
        row = c.execute(
            "SELECT word, pronounce, description, html FROM av WHERE word = ? COLLATE NOCASE LIMIT 1",
            (clean_word,)
        ).fetchone()

        if not row:
            # Try lowercased match with TRIM
            row = c.execute(
                "SELECT word, pronounce, description, html FROM av WHERE LOWER(TRIM(word)) = ? LIMIT 1",
                (clean_word.lower(),)
            ).fetchone()

        if row:
            return {
                "word": row["word"].strip(),
                "pronounce": (row["pronounce"] or "").strip(),
                "description": (row["description"] or "").strip(),
                "html": (row["html"] or "").strip(),
            }
        return None
    finally:
        conn.close()


def get_all_vocab(search: str = "", status: str = "all"):
    """Fetch words with filtering and sorting."""
    conn = get_user_connection()
    c = conn.cursor()
    query = "SELECT * FROM vocab_words WHERE 1=1"
    params = []

    if search:
        query += " AND (word LIKE ? OR meaning LIKE ?)"
        pattern = f"%{search.strip()}%"
        params.extend([pattern, pattern])

    if status and status != "all":
        now_iso = datetime.now(timezone.utc).isoformat()
        if status == "due":
            query += " AND next_review <= ?"
            params.append(now_iso)
        else:
            query += " AND status = ?"
            params.append(status)

    query += " ORDER BY id DESC"
    rows = c.execute(query, params).fetchall()
    conn.close()

    result = []
    for r in rows:
        d = dict(r)
        d["synonyms"] = json.loads(d["synonyms"]) if d["synonyms"] else []
        d["antonyms"] = json.loads(d["antonyms"]) if d["antonyms"] else []
        result.append(d)
    return result


def get_vocab_by_id(vocab_id: int):
    conn = get_user_connection()
    c = conn.cursor()
    row = c.execute("SELECT * FROM vocab_words WHERE id = ?", (vocab_id,)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d["synonyms"] = json.loads(d["synonyms"]) if d["synonyms"] else []
    d["antonyms"] = json.loads(d["antonyms"]) if d["antonyms"] else []
    return d


def get_vocab_by_word(word: str):
    conn = get_user_connection()
    c = conn.cursor()
    row = c.execute("SELECT * FROM vocab_words WHERE LOWER(word) = ?", (word.strip().lower(),)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d["synonyms"] = json.loads(d["synonyms"]) if d["synonyms"] else []
    d["antonyms"] = json.loads(d["antonyms"]) if d["antonyms"] else []
    return d


def add_or_update_vocab(word: str, meaning: str, pronounce: str = "", example: str = "",
                        synonyms: list = None, antonyms: list = None, initial_delay_seconds: int = 10):
    """Add new word or update existing one."""
    word = word.strip().lower()
    if not word or not meaning:
        raise ValueError("Từ vựng và Nghĩa không được để trống")

    syn_json = json.dumps(synonyms or [], ensure_ascii=False)
    ant_json = json.dumps(antonyms or [], ensure_ascii=False)
    now = datetime.now(timezone.utc)
    next_review = (now + timedelta(seconds=max(0, initial_delay_seconds))).isoformat()
    now_iso = now.isoformat()

    conn = get_user_connection()
    c = conn.cursor()
    try:
        existing = c.execute("SELECT id FROM vocab_words WHERE LOWER(word) = ?", (word,)).fetchone()
        if existing:
            c.execute("""
            UPDATE vocab_words
            SET meaning = ?, pronounce = ?, example = ?, synonyms = ?, antonyms = ?
            WHERE id = ?
            """, (meaning, pronounce, example, syn_json, ant_json, existing["id"]))
            vocab_id = existing["id"]
        else:
            c.execute("""
            INSERT INTO vocab_words (
                word, meaning, pronounce, example, synonyms, antonyms,
                status, repetition, interval, ease_factor, next_review, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'learning', 0, 1, 2.5, ?, ?)
            """, (word, meaning, pronounce, example, syn_json, ant_json, next_review, now_iso))
            vocab_id = c.lastrowid
        conn.commit()
        if not existing:
            # Award +10 XP for discovering and adding a new word
            add_xp(10)
        return vocab_id
    finally:
        conn.close()


def update_vocab(vocab_id: int, meaning: str, pronounce: str, example: str, synonyms: list, antonyms: list):
    syn_json = json.dumps(synonyms or [], ensure_ascii=False)
    ant_json = json.dumps(antonyms or [], ensure_ascii=False)

    conn = get_user_connection()
    c = conn.cursor()
    c.execute("""
    UPDATE vocab_words
    SET meaning = ?, pronounce = ?, example = ?, synonyms = ?, antonyms = ?
    WHERE id = ?
    """, (meaning, pronounce, example, syn_json, ant_json, vocab_id))
    conn.commit()
    conn.close()


def delete_vocab(vocab_id: int):
    conn = get_user_connection()
    c = conn.cursor()
    c.execute("DELETE FROM vocab_words WHERE id = ?", (vocab_id,))
    conn.commit()
    conn.close()


def get_due_vocab():
    """Retrieve all words due for review right now."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_user_connection()
    c = conn.cursor()
    rows = c.execute(
        "SELECT * FROM vocab_words WHERE next_review <= ? ORDER BY next_review ASC",
        (now_iso,)
    ).fetchall()
    conn.close()

    result = []
    for r in rows:
        d = dict(r)
        d["synonyms"] = json.loads(d["synonyms"]) if d["synonyms"] else []
        d["antonyms"] = json.loads(d["antonyms"]) if d["antonyms"] else []
        result.append(d)
    return result


def process_sm2_review(vocab_id: int, is_correct: bool, used_hint: bool = False, cycle_multiplier: int = 60):
    """
    Process review with SM-2 spaced repetition logic.
    - If incorrect or used hint: reset repetition to 0, interval = 2 minutes, ease factor lowered.
    - If correct without hint: increment repetition, calculate next interval via SM-2.
    """
    conn = get_user_connection()
    c = conn.cursor()
    row = c.execute("SELECT * FROM vocab_words WHERE id = ?", (vocab_id,)).fetchone()
    if not row:
        conn.close()
        return None

    rep = row["repetition"]
    interval = row["interval"]
    ef = row["ease_factor"]
    rev_count = row["review_count"] + 1
    corr_count = row["correct_count"] + (1 if is_correct and not used_hint else 0)

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    if not is_correct or used_hint:
        # Penalize: Reset repetition, set 2 minutes review delay
        new_rep = 0
        new_interval = 2  # 2 minutes
        new_ef = max(1.3, ef - 0.2)
        next_review = (now + timedelta(minutes=2)).isoformat()
        status = "learning"
    else:
        # Successful recall without hint
        new_rep = rep + 1
        if new_rep == 1:
            step_factor = 1
        elif new_rep == 2:
            step_factor = 3
        else:
            step_factor = round(interval * ef)

        new_interval = max(1, step_factor)
        # SM-2 EF adjustment: grade assumed 5 if flawless
        new_ef = min(2.8, max(1.3, ef + 0.1))

        # Time calculation: base step scales by user's chosen cycle
        # If cycle_multiplier <= 60s (test mode): intervals are in multiples of 10-30s
        if cycle_multiplier <= 10:
            delay_seconds = new_interval * 15
        elif cycle_multiplier <= 60:
            delay_seconds = new_interval * 60
        else:
            # 5m (300s), 15m (900s), 30m (1800s)
            delay_seconds = new_interval * cycle_multiplier

        next_review = (now + timedelta(seconds=delay_seconds)).isoformat()
        status = "mastered" if new_rep >= 5 else "learning"
        # Award +20 XP for successful recall
        add_xp(20)

    c.execute("""
    UPDATE vocab_words
    SET repetition = ?, interval = ?, ease_factor = ?, next_review = ?,
        status = ?, last_reviewed = ?, review_count = ?, correct_count = ?
    WHERE id = ?
    """, (new_rep, new_interval, new_ef, next_review, status, now_iso, rev_count, corr_count, vocab_id))
    conn.commit()

    updated = c.execute("SELECT * FROM vocab_words WHERE id = ?", (vocab_id,)).fetchone()
    conn.close()

    d = dict(updated)
    d["synonyms"] = json.loads(d["synonyms"]) if d["synonyms"] else []
    d["antonyms"] = json.loads(d["antonyms"]) if d["antonyms"] else []
    return d


def process_flashcard_review(vocab_id: int, quality: str):
    """
    Process flashcard review with Anki-style 4-button SM-2 quality grades.
    quality: 'again' | 'hard' | 'good' | 'easy'
      - again (0): Forgot -> review in 1 minute, reset repetition
      - hard  (1): Barely recalled -> review in 12 hours, EF slightly lowered
      - good  (2): Correct recall -> review in 1-3 days based on SM-2
      - easy  (3): Instant recall -> review in 7+ days, EF boosted
    """
    conn = get_user_connection()
    c = conn.cursor()
    row = c.execute("SELECT * FROM vocab_words WHERE id = ?", (vocab_id,)).fetchone()
    if not row:
        conn.close()
        return None

    rep = row["repetition"]
    interval = row["interval"]  # in days
    ef = row["ease_factor"]
    rev_count = row["review_count"] + 1

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    xp_earned = 0

    if quality == "again":
        # Forgot: reset, show again in 1 minute
        new_rep = 0
        new_interval = 1
        new_ef = max(1.3, ef - 0.2)
        next_review = (now + timedelta(minutes=1)).isoformat()
        status = "learning"
        corr_delta = 0
    elif quality == "hard":
        # Barely recalled: 12 hours, slight EF decrease
        new_rep = rep + 1
        new_interval = max(1, round(interval * 1.2))
        new_ef = max(1.3, ef - 0.15)
        next_review = (now + timedelta(hours=12)).isoformat()
        status = "learning"
        corr_delta = 1
        xp_earned = 5
    elif quality == "good":
        # Correct recall: SM-2 standard progression
        new_rep = rep + 1
        if new_rep == 1:
            new_interval = 1
        elif new_rep == 2:
            new_interval = 3
        else:
            new_interval = max(1, round(interval * ef))
        new_ef = max(1.3, ef + 0.0)  # keep stable
        next_review = (now + timedelta(days=new_interval)).isoformat()
        status = "mastered" if new_rep >= 5 else "learning"
        corr_delta = 1
        xp_earned = 15
    else:  # easy
        # Instant recall: big interval jump, EF boost
        new_rep = rep + 1
        if new_rep <= 2:
            new_interval = 7
        else:
            new_interval = max(7, round(interval * ef * 1.5))
        new_ef = min(2.8, ef + 0.15)
        next_review = (now + timedelta(days=new_interval)).isoformat()
        status = "mastered" if new_rep >= 3 else "learning"
        corr_delta = 1
        xp_earned = 25

    corr_count = row["correct_count"] + corr_delta

    c.execute("""
    UPDATE vocab_words
    SET repetition = ?, interval = ?, ease_factor = ?, next_review = ?,
        status = ?, last_reviewed = ?, review_count = ?, correct_count = ?
    WHERE id = ?
    """, (new_rep, new_interval, new_ef, next_review, status, now_iso, rev_count, corr_count, vocab_id))
    conn.commit()

    updated = c.execute("SELECT * FROM vocab_words WHERE id = ?", (vocab_id,)).fetchone()
    conn.close()

    # Award XP
    if xp_earned > 0:
        add_xp(xp_earned)

    d = dict(updated)
    d["synonyms"] = json.loads(d["synonyms"]) if d["synonyms"] else []
    d["antonyms"] = json.loads(d["antonyms"]) if d["antonyms"] else []
    d["xp_earned"] = xp_earned
    return d


def get_flashcard_deck(mode: str = "due", limit: int = 20):
    """
    Get a deck of flashcards for a study session.
    mode: 'due' (only due words), 'all' (all words shuffled)
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_user_connection()
    c = conn.cursor()

    if mode == "due":
        rows = c.execute(
            "SELECT * FROM vocab_words WHERE next_review <= ? ORDER BY next_review ASC LIMIT ?",
            (now_iso, limit)
        ).fetchall()
    else:
        rows = c.execute(
            "SELECT * FROM vocab_words ORDER BY RANDOM() LIMIT ?",
            (limit,)
        ).fetchall()

    conn.close()

    result = []
    for r in rows:
        d = dict(r)
        d["synonyms"] = json.loads(d["synonyms"]) if d["synonyms"] else []
        d["antonyms"] = json.loads(d["antonyms"]) if d["antonyms"] else []
        result.append(d)
    return result


def get_stats():
    """Retrieve summary counts for dashboard."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_user_connection()
    c = conn.cursor()
    total = c.execute("SELECT COUNT(*) FROM vocab_words").fetchone()[0]
    mastered = c.execute("SELECT COUNT(*) FROM vocab_words WHERE status = 'mastered'").fetchone()[0]
    learning = c.execute("SELECT COUNT(*) FROM vocab_words WHERE status = 'learning'").fetchone()[0]
    due = c.execute("SELECT COUNT(*) FROM vocab_words WHERE next_review <= ?", (now_iso,)).fetchone()[0]
    conn.close()
    return {
        "total": total,
        "mastered": mastered,
        "learning": learning,
        "due": due
    }


def get_setting(key: str, default: str = ""):
    conn = get_user_connection()
    c = conn.cursor()
    row = c.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    conn = get_user_connection()
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()


def get_gamification():
    """Retrieve XP, Level, Streak, and Check-in state."""
    xp = int(get_setting("user_xp", "50"))
    streak = int(get_setting("user_streak", "1"))
    last_checkin = get_setting("last_checkin", "")
    lock_enabled = get_setting("lock_enabled", "0") == "1"

    today_str = datetime.now().strftime("%Y-%m-%d")
    checked_in_today = (last_checkin == today_str)

    # 100 XP per level
    level = (xp // 100) + 1
    xp_in_level = xp % 100
    xp_needed = 100

    return {
        "xp": xp,
        "level": level,
        "streak": streak,
        "checked_in_today": checked_in_today,
        "xp_in_level": xp_in_level,
        "xp_needed": xp_needed,
        "lock_enabled": lock_enabled
    }


def add_xp(amount: int):
    """Add XP to user profile and return new gamification state."""
    current_xp = int(get_setting("user_xp", "50"))
    new_xp = max(0, current_xp + amount)
    set_setting("user_xp", str(new_xp))
    return get_gamification()


def check_in_today():
    """Perform daily check-in: +50 XP and increment streak if eligible."""
    today = datetime.now().date()
    today_str = today.strftime("%Y-%m-%d")
    last_checkin_str = get_setting("last_checkin", "")

    if last_checkin_str == today_str:
        return {"success": False, "message": "Bạn đã điểm danh hôm nay rồi!", "gamification": get_gamification()}

    current_streak = int(get_setting("user_streak", "1"))
    if last_checkin_str:
        try:
            last_date = datetime.strptime(last_checkin_str, "%Y-%m-%d").date()
            diff_days = (today - last_date).days
            if diff_days == 1:
                current_streak += 1
            elif diff_days > 1:
                current_streak = 1
        except Exception:
            current_streak = 1
    else:
        current_streak = 1

    set_setting("user_streak", str(current_streak))
    set_setting("last_checkin", today_str)

    # Award 50 XP for daily check-in
    add_xp(50)

    return {
        "success": True,
        "message": f"Điểm danh thành công! +50 XP, Chuỗi streak: {current_streak} ngày 🔥",
        "gamification": get_gamification()
    }
