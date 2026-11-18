/**
 * Usagi Vocab - Frontend Engine
 * Modern Language Learning Dashboard (Parroto / Duolingo Inspired)
 * Mascot: Usagi Bunny (static/mascot.png)
 * 100% Offline (Zero External API)
 */

// Application State
const state = {
    currentTab: 'tab-home',
    currentSubTab: 'subtab-single',
    activeFilter: 'all',
    searchQuery: '',
    sidebarCollapsed: false,
    settings: {
        review_cycle: 60,
        speech_voice: 'en-US',
        speech_rate: 1.0
    },
    gamification: {
        xp: 50,
        level: 1,
        streak: 1,
        checked_in_today: false,
        xp_in_level: 50,
        xp_needed: 100
    },
    lockEnabled: localStorage.getItem('lockEnabled') === 'true', // Defaults to false
    dueWords: [],
    currentLockIndex: 0,
    lockActive: false,
    lockUsedHint: false,
    titleIntervalId: null,
    originalTitle: document.title,
    checkIntervalId: null,
    currentLookupData: null,
    quickLookupData: null,
    flashcards: {
        queue: [],
        initialCount: 0,
        completed: 0,
        mode: 'due',
        isFlipped: false,
        isLoading: false,
        againQueue: [],
        retryTimeoutId: null,
        retryIntervalId: null
    }
};

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initNavigation();
    initSpeechSynthesis();
    loadSettings();
    initGamification();
    initHomeTab();
    initAddWordTab();
    initVaultTab();
    initFlashcardsTab();
    initReviewTab();
    initLockScreen();
    initTopQuickSearch();
    startBackgroundDueCheck();
    refreshDashboard();
});

/* ==========================================================================
   1. SIDEBAR & NAVIGATION
   ========================================================================== */
function initSidebar() {
    const btnToggle = document.getElementById('btnToggleSidebar');
    const sidebar = document.getElementById('sidebar');
    const icon = document.getElementById('collapseIcon');

    if (btnToggle && sidebar) {
        btnToggle.addEventListener('click', () => {
            state.sidebarCollapsed = !state.sidebarCollapsed;
            sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
            if (icon) {
                icon.textContent = state.sidebarCollapsed ? '▶▶' : '◀◀';
            }
        });
    }
}

function initNavigation() {
    const navButtons = document.querySelectorAll('.nav-item');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            switchTab(targetTab);
        });
    });

    // Request notification permission button
    const btnNotify = document.getElementById('btnRequestNotify');
    if (btnNotify) {
        if ('Notification' in window && Notification.permission === 'granted') {
            btnNotify.innerHTML = '<span>🔔</span> <span class="hidden lg:inline">Đã Bật</span>';
            btnNotify.classList.add('border-emerald-500', 'text-emerald-600', 'bg-emerald-50');
        }
        btnNotify.addEventListener('click', requestNotificationPermission);
    }

    // Toggle Lock button in Header
    const btnToggleLock = document.getElementById('btnToggleLock');
    if (btnToggleLock) {
        btnToggleLock.addEventListener('click', toggleLockEnabled);
    }

    // Header review cycle change
    const headerCycle = document.getElementById('headerReviewCycle');
    if (headerCycle) {
        headerCycle.addEventListener('change', async (e) => {
            const cycle = e.target.value;
            state.settings.review_cycle = parseInt(cycle);
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ review_cycle: cycle })
            });
            const cfgCycle = document.getElementById('cfgReviewCycle');
            if (cfgCycle) cfgCycle.value = cycle;
        });
    }

    updateLockToggleUI();
}

function switchTab(tabId) {
    state.currentTab = tabId;
    document.querySelectorAll('.nav-item').forEach(b => {
        if (b.getAttribute('data-tab') === tabId) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });

    document.querySelectorAll('.tab-content').forEach(sec => {
        if (sec.id === tabId) {
            sec.classList.remove('hidden');
        } else {
            sec.classList.add('hidden');
        }
    });

    if (tabId === 'tab-vault') {
        loadVocabList();
    }
    if (tabId === 'tab-home') {
        refreshDashboard();
    }
    if (tabId === 'tab-flashcards' && !state.flashcards.initialCount && !state.flashcards.isLoading) {
        startFlashcardSession();
    }
}

function initFlashcardsTab() {
    const card = document.getElementById('flashcard');
    const startButton = document.getElementById('btnStartFlashcards');
    const audioButton = document.getElementById('btnFlashcardAudio');
    const exampleAudioButton = document.getElementById('btnFlashcardExampleAudio');

    if (startButton) startButton.addEventListener('click', startFlashcardSession);
    if (card) card.addEventListener('click', flipFlashcard);
    if (audioButton) {
        audioButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const current = state.flashcards.queue[0];
            if (current) speakText(current.word);
        });
    }
    if (exampleAudioButton) {
        exampleAudioButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const current = state.flashcards.queue[0];
            if (current && current.example) speakText(current.example);
        });
    }
    document.querySelectorAll('.flashcard-rating').forEach(button => {
        button.addEventListener('click', () => submitFlashcardReview(button.dataset.quality));
    });
    document.addEventListener('keydown', (event) => {
        if (state.currentTab !== 'tab-flashcards' || event.code !== 'Space') return;
        const target = event.target;
        if (target instanceof HTMLElement && (
            target.isContentEditable || target.matches('button, input, select, textarea, a')
        )) return;
        event.preventDefault();
        flipFlashcard();
    });
}

async function startFlashcardSession() {
    const modeSelect = document.getElementById('flashcardDeckMode');
    const startButton = document.getElementById('btnStartFlashcards');
    const mode = modeSelect ? modeSelect.value : 'due';
    const message = document.getElementById('flashcardMessage');

    clearFlashcardRetryTimers();
    state.flashcards.isLoading = true;
    state.flashcards.queue = [];
    state.flashcards.againQueue = [];
    state.flashcards.initialCount = 0;
    state.flashcards.completed = 0;
    state.flashcards.mode = mode;
    state.flashcards.isFlipped = false;
    if (startButton) startButton.disabled = true;
    if (message) message.textContent = 'Usagi đang chuẩn bị bộ thẻ...';
    renderFlashcardSession();

    try {
        const response = await fetch(`/api/flashcards?mode=${encodeURIComponent(mode)}&limit=50`);
        if (!response.ok) throw new Error('Không thể tải bộ flashcard.');
        const deck = await response.json();
        state.flashcards.queue = deck;
        state.flashcards.initialCount = deck.length;
        if (!deck.length) {
            if (message) {
                message.textContent = mode === 'due'
                    ? 'Hôm nay chưa có thẻ đến hạn. Hãy chọn “Tất cả từ” để luyện thêm nhé!'
                    : 'Kho từ vựng đang trống. Hãy thêm từ trước khi bắt đầu học.';
            }
        } else {
            renderFlashcardSession(true);
        }
    } catch (error) {
        console.error('Failed to load flashcard deck:', error);
        if (message) message.textContent = error.message || 'Không thể tải bộ thẻ. Vui lòng thử lại.';
    } finally {
        state.flashcards.isLoading = false;
        if (startButton) startButton.disabled = false;
    }
}

function flipFlashcard() {
    if (!state.flashcards.queue.length || state.flashcards.isLoading) return;
    state.flashcards.isFlipped = !state.flashcards.isFlipped;
    const card = document.getElementById('flashcard');
    const ratings = document.getElementById('flashcardRatings');
    if (card) {
        card.classList.toggle('is-flipped', state.flashcards.isFlipped);
        card.setAttribute('aria-label', state.flashcards.isFlipped
            ? 'Mặt sau flashcard. Nhấn Space để lật lại'
            : 'Mặt trước flashcard. Nhấn Space để lật thẻ');
    }
    if (ratings) ratings.classList.toggle('hidden', !state.flashcards.isFlipped);
}

async function submitFlashcardReview(quality) {
    const current = state.flashcards.queue[0];
    if (!current || state.flashcards.isLoading) return;

    state.flashcards.isLoading = true;
    const startButton = document.getElementById('btnStartFlashcards');
    if (startButton) startButton.disabled = true;
    document.querySelectorAll('.flashcard-rating').forEach(button => {
        button.disabled = true;
    });
    try {
        const response = await fetch(`/api/flashcards/${current.id}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quality })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Không thể lưu đánh giá thẻ.');

        state.flashcards.queue.shift();
        if (quality === 'again') {
            state.flashcards.againQueue.push({
                card: current,
                dueAt: new Date(result.next_review).getTime()
            });
        } else {
            state.flashcards.completed += 1;
        }

        const message = document.getElementById('flashcardMessage');
        const qualityText = {
            again: 'Thẻ sẽ quay lại sau 1 phút.',
            hard: 'Đã ghi nhận: Khó. Hẹn ôn sau 12 giờ.',
            good: 'Tốt lắm! Đã ghi nhận: Nhớ.',
            easy: 'Tuyệt vời! Đã ghi nhận: Rất dễ.'
        };
        await loadGamificationStats();
        refreshDashboard();
        renderFlashcardSession(true);
        if (state.flashcards.queue.length || state.flashcards.againQueue.length) {
            if (message) message.textContent = `${qualityText[quality]} +${result.xp_earned} XP`;
        }
        scheduleFlashcardRetry();
    } catch (error) {
        console.error('Failed to submit flashcard review:', error);
        const message = document.getElementById('flashcardMessage');
        if (message) message.textContent = error.message || 'Không thể lưu đánh giá. Vui lòng thử lại.';
    } finally {
        state.flashcards.isLoading = false;
        if (startButton) startButton.disabled = false;
        document.querySelectorAll('.flashcard-rating').forEach(button => {
            button.disabled = false;
        });
    }
}

function renderFlashcardSession(autoSpeak = false) {
    const card = document.getElementById('flashcard');
    const ratings = document.getElementById('flashcardRatings');
    const message = document.getElementById('flashcardMessage');
    const current = state.flashcards.queue[0];
    const done = state.flashcards.completed;
    const total = state.flashcards.initialCount;
    const progressLabel = document.getElementById('flashcardProgressLabel');
    const progressBar = document.getElementById('flashcardProgressBar');
    const deckLabel = document.getElementById('flashcardDeckLabel');

    if (progressLabel) progressLabel.textContent = total ? `Đã ôn ${done}/${total} thẻ` : 'Chưa bắt đầu';
    if (progressBar) progressBar.style.width = `${total ? Math.min(100, (done / total) * 100) : 0}%`;
    if (deckLabel) deckLabel.textContent = state.flashcards.mode === 'due' ? 'Bộ thẻ đến hạn' : 'Luyện tất cả từ';
    if (ratings) ratings.classList.add('hidden');
    if (card) {
        card.classList.remove('is-flipped');
        card.setAttribute('aria-label', 'Mặt trước flashcard. Nhấn Space để lật thẻ');
    }
    state.flashcards.isFlipped = false;

    if (!current) {
        if (card) card.classList.add('flashcard-empty');
        if (state.flashcards.againQueue.length) {
            if (message) message.textContent = getFlashcardRetryMessage();
            return;
        }
        if (total && done >= total) {
            if (message) message.textContent = 'Hoàn thành phiên học! Usagi tự hào về bạn 🐰✨';
            const mascotMessage = document.getElementById('flashcardMascotMessage');
            if (mascotMessage) mascotMessage.textContent = 'Bạn đã hoàn thành phiên học. Hẹn gặp lại nhé!';
        }
        return;
    }

    if (card) card.classList.remove('flashcard-empty');
    document.getElementById('flashcardWord').textContent = current.word;
    document.getElementById('flashcardIpa').textContent = current.pronounce || '/.../';
    document.getElementById('flashcardMeaning').textContent = current.meaning;

    const exampleBlock = document.getElementById('flashcardExampleBlock');
    const example = document.getElementById('flashcardExample');
    example.textContent = current.example || '';
    exampleBlock.classList.toggle('hidden', !current.example);

    renderFlashcardTags('flashcardSynonyms', 'flashcardSynonymsBlock', current.synonyms || [], 'tag-synonym');
    renderFlashcardTags('flashcardAntonyms', 'flashcardAntonymsBlock', current.antonyms || [], 'tag-antonym');
    if (message) message.textContent = 'Hãy tự nhớ nghĩa trước khi lật thẻ.';
    const mascotMessage = document.getElementById('flashcardMascotMessage');
    if (mascotMessage) mascotMessage.textContent = 'Cố lên! Mỗi thẻ là một bước tiến ✨';
    if (autoSpeak) speakText(current.word);
}

function renderFlashcardTags(containerId, blockId, tags, className) {
    const container = document.getElementById(containerId);
    const block = document.getElementById(blockId);
    container.replaceChildren();
    tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = className;
        chip.textContent = tag;
        container.appendChild(chip);
    });
    block.classList.toggle('hidden', tags.length === 0);
}

function scheduleFlashcardRetry() {
    clearFlashcardRetryTimers();
    if (!state.flashcards.againQueue.length) return;

    const wait = Math.max(0, Math.min(...state.flashcards.againQueue.map(item => item.dueAt)) - Date.now());
    state.flashcards.retryTimeoutId = setTimeout(() => {
        const now = Date.now();
        const ready = state.flashcards.againQueue.filter(item => item.dueAt <= now);
        const wasWaiting = state.flashcards.queue.length === 0;
        state.flashcards.againQueue = state.flashcards.againQueue.filter(item => item.dueAt > now);
        state.flashcards.queue.push(...ready.map(item => item.card));
        if (wasWaiting && ready.length) {
            renderFlashcardSession(state.currentTab === 'tab-flashcards');
        }
        scheduleFlashcardRetry();
    }, wait);
    state.flashcards.retryIntervalId = setInterval(() => {
        if (!state.flashcards.queue.length && state.flashcards.againQueue.length) {
            const message = document.getElementById('flashcardMessage');
            if (message) message.textContent = getFlashcardRetryMessage();
        }
    }, 1000);
}

function getFlashcardRetryMessage() {
    const next = Math.min(...state.flashcards.againQueue.map(item => item.dueAt));
    const seconds = Math.max(0, Math.ceil((next - Date.now()) / 1000));
    return `Usagi sẽ đưa thẻ “Quên” trở lại sau ${seconds} giây. Bạn có thể chờ hoặc luyện thêm bộ thẻ khác.`;
}

function clearFlashcardRetryTimers() {
    if (state.flashcards.retryTimeoutId) clearTimeout(state.flashcards.retryTimeoutId);
    if (state.flashcards.retryIntervalId) clearInterval(state.flashcards.retryIntervalId);
    state.flashcards.retryTimeoutId = null;
    state.flashcards.retryIntervalId = null;
}

function toggleLockEnabled() {
    state.lockEnabled = !state.lockEnabled;
    localStorage.setItem('lockEnabled', state.lockEnabled ? 'true' : 'false');
    updateLockToggleUI();

    // Sync with backend
    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lock_enabled: state.lockEnabled ? '1' : '0' })
    }).catch(() => {});

    if (!state.lockEnabled && state.lockActive) {
        unlockScreen();
    }
}

function updateLockToggleUI() {
    const btn = document.getElementById('btnToggleLock');
    const icon = document.getElementById('lockStatusIcon');
    const text = document.getElementById('lockStatusText');
    const settingBtn = document.getElementById('btnSettingToggleLock');

    if (state.lockEnabled) {
        if (icon) icon.textContent = '🔒';
        if (text) text.textContent = 'Khóa: ĐANG BẬT';
        if (btn) {
            btn.className = 'text-xs py-1.5 px-3 rounded-full flex items-center gap-1.5 font-bold transition border border-emerald-500 text-emerald-700 bg-emerald-50';
        }
        if (settingBtn) {
            settingBtn.textContent = 'Đang Bật';
            settingBtn.className = 'btn-orange-cta text-xs py-2 px-5 font-bold';
        }
    } else {
        if (icon) icon.textContent = '⏸️';
        if (text) text.textContent = 'Khóa: ĐANG TẠM DỪNG';
        if (btn) {
            btn.className = 'text-xs py-1.5 px-3 rounded-full flex items-center gap-1.5 font-bold transition border border-amber-400 text-amber-700 bg-amber-50';
        }
        if (settingBtn) {
            settingBtn.textContent = 'Đang Tạm Dừng';
            settingBtn.className = 'btn-matcha text-xs py-2 px-5 font-bold';
        }
    }
}

/* ==========================================================================
   2. GAMIFICATION (STREAK, XP, LEVEL, CHECK-IN)
   ========================================================================== */
async function initGamification() {
    const btnCheckin = document.getElementById('btnDailyCheckin');
    if (btnCheckin) {
        btnCheckin.addEventListener('click', performDailyCheckin);
    }
    await loadGamificationStats();
}

async function loadGamificationStats() {
    try {
        const res = await fetch('/api/gamification');
        if (res.ok) {
            const data = await res.json();
            state.gamification = data;
            renderGamificationUI();
        }
    } catch (e) {
        console.error('Failed to load gamification stats:', e);
    }
}

function renderGamificationUI() {
    const g = state.gamification;

    // Header XP & Level
    const headerLevel = document.getElementById('headerLevel');
    const headerXpBar = document.getElementById('headerXpBar');
    const headerXpText = document.getElementById('headerXpText');
    if (headerLevel) headerLevel.textContent = g.level;
    if (headerXpText) headerXpText.textContent = `${g.xp} XP`;
    if (headerXpBar) {
        const pct = Math.min(100, Math.max(5, (g.xp_in_level / g.xp_needed) * 100));
        headerXpBar.style.width = `${pct}%`;
    }

    // Home Gamification Card
    const homeStreak = document.getElementById('homeStreakCount');
    const homeLevel = document.getElementById('homeLevelText');
    const homeCurrentXp = document.getElementById('homeCurrentXp');
    const homeNextXp = document.getElementById('homeNextLevelXp');
    const homeBar = document.getElementById('homeXpProgressBar');
    const btnCheckin = document.getElementById('btnDailyCheckin');

    if (homeStreak) homeStreak.textContent = g.streak;
    if (homeLevel) homeLevel.textContent = g.level;
    if (homeCurrentXp) homeCurrentXp.textContent = g.xp;
    if (homeNextXp) homeNextXp.textContent = g.level * 100;
    if (homeBar) {
        const pct = Math.min(100, Math.max(5, (g.xp_in_level / g.xp_needed) * 100));
        homeBar.style.width = `${pct}%`;
    }

    if (btnCheckin) {
        if (g.checked_in_today) {
            btnCheckin.textContent = '✓ ĐÃ ĐIỂM DANH HÔM NAY';
            btnCheckin.className = 'btn-matcha px-4 py-2.5 text-xs whitespace-nowrap cursor-default';
            btnCheckin.disabled = true;
        } else {
            btnCheckin.textContent = '🔥 ĐIỂM DANH (+50 XP)';
            btnCheckin.className = 'btn-orange-cta px-4 py-2.5 text-xs whitespace-nowrap';
            btnCheckin.disabled = false;
        }
    }
}

async function performDailyCheckin() {
    try {
        const res = await fetch('/api/checkin', { method: 'POST' });
        const data = await res.json();
        if (data.gamification) {
            state.gamification = data.gamification;
            renderGamificationUI();
        }
        alert(data.message || 'Điểm danh thành công! +50 XP 🐰');
    } catch (e) {
        alert('Lỗi điểm danh: ' + e.message);
    }
}

/* ==========================================================================
   3. WEB SPEECH API & AUDIO CHIME (100% OFFLINE)
   ========================================================================== */
function initSpeechSynthesis() {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = () => {};
    }
}

function speakText(text, langOverride = null) {
    if (!('speechSynthesis' in window) || !text) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const targetLang = langOverride || state.settings.speech_voice || 'en-US';
    utterance.lang = targetLang;
    utterance.rate = parseFloat(state.settings.speech_rate) || 1.0;

    const voices = window.speechSynthesis.getVoices();
    const matchedVoice = voices.find(v => v.lang.replace('_', '-') === targetLang) ||
                         voices.find(v => v.lang.startsWith('en'));
    if (matchedVoice) {
        utterance.voice = matchedVoice;
    }

    window.speechSynthesis.speak(utterance);
}

// Gentle pleasant chime (Web Audio API)
function playLockChime() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();

        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
        gain1.gain.setValueAtTime(0.12, ctx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start();
        osc1.stop(ctx.currentTime + 0.7);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.2);
        gain2.gain.setValueAtTime(0.14, ctx.currentTime + 0.2);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.1);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(ctx.currentTime + 0.2);
        osc2.stop(ctx.currentTime + 1.1);
    } catch (e) {
        console.warn('AudioContext failed:', e);
    }
}

/* ==========================================================================
   4. SETTINGS & NOTIFICATIONS
   ========================================================================== */
async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        if (res.ok) {
            const data = await res.json();
            state.settings.review_cycle = parseInt(data.review_cycle) || 60;
            state.settings.speech_voice = data.speech_voice || 'en-US';
            state.settings.speech_rate = parseFloat(data.speech_rate) || 1.0;

            const cycleEl = document.getElementById('cfgReviewCycle');
            const voiceEl = document.getElementById('cfgSpeechVoice');
            const rateEl = document.getElementById('cfgSpeechRate');
            const headerCycle = document.getElementById('headerReviewCycle');

            if (cycleEl) cycleEl.value = state.settings.review_cycle.toString();
            if (headerCycle) headerCycle.value = state.settings.review_cycle.toString();
            if (voiceEl) voiceEl.value = state.settings.speech_voice;
            if (rateEl) rateEl.value = state.settings.speech_rate.toString();
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        alert('Trình duyệt của bạn không hỗ trợ Web Notification API.');
        return;
    }
    const perm = await Notification.requestPermission();
    const btnNotify = document.getElementById('btnRequestNotify');
    if (perm === 'granted') {
        if (btnNotify) {
            btnNotify.innerHTML = '<span>🔔</span> <span class="hidden lg:inline">Đã Bật</span>';
            btnNotify.classList.add('border-emerald-500', 'text-emerald-600', 'bg-emerald-50');
        }
        new Notification('Usagi Vocab 🐰', {
            body: 'Bé thỏ Usagi đã sẵn sàng nhắc bạn học từ vựng mỗi ngày!',
            icon: '/static/mascot.png'
        });
    } else {
        alert('Quyền thông báo bị từ chối hoặc chưa được cấp.');
    }
}

/* ==========================================================================
   5. TAB 1: TRANG CHỦ (HOME DASHBOARD)
   ========================================================================== */
function initHomeTab() {
    const btnGoAdd = document.getElementById('btnQuickGoAdd');
    const btnGoReview = document.getElementById('btnQuickGoReview');

    if (btnGoAdd) {
        btnGoAdd.addEventListener('click', () => switchTab('tab-add'));
    }
    if (btnGoReview) {
        btnGoReview.addEventListener('click', forceTestLockScreen);
    }
}

/* ==========================================================================
   6. TAB 2: THÊM TỪ TỰ ĐỘNG & TRÍCH XUẤT ĐOẠN VĂN
   ========================================================================== */
function initAddWordTab() {
    // Sub-tab toggling
    const subTabButtons = document.querySelectorAll('.add-subtab-btn');
    subTabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-subtab');
            state.currentSubTab = target;
            subTabButtons.forEach(b => {
                b.classList.remove('active', 'bg-[#e8f3dc]', 'text-[#5e8346]', 'border-[#c3dcab]');
                b.classList.add('text-slate-500', 'border-transparent');
            });
            btn.classList.add('active', 'bg-[#e8f3dc]', 'text-[#5e8346]', 'border-[#c3dcab]');
            btn.classList.remove('text-slate-500', 'border-transparent');

            if (target === 'subtab-single') {
                document.getElementById('subtab-single').classList.remove('hidden');
                document.getElementById('subtab-batch').classList.add('hidden');
            } else {
                document.getElementById('subtab-single').classList.add('hidden');
                document.getElementById('subtab-batch').classList.remove('hidden');
            }
        });
    });

    // Single Word Lookup
    const input = document.getElementById('lookupInput');
    const btnLookup = document.getElementById('btnDoLookup');
    const btnSave = document.getElementById('btnSaveToVault');
    const btnToggleHtml = document.getElementById('btnToggleDictHtml');

    const handleLookup = () => {
        const query = input.value.trim();
        if (query) doWordLookup(query);
    };

    if (btnLookup) btnLookup.addEventListener('click', handleLookup);
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLookup();
        });
    }

    if (btnToggleHtml) {
        btnToggleHtml.addEventListener('click', () => {
            const box = document.getElementById('dictHtmlContainer');
            box.classList.toggle('hidden');
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', saveCurrentLookupToVault);
    }

    // Audio handlers
    const btnWordAudio = document.getElementById('btnPlayWordAudio');
    if (btnWordAudio) {
        btnWordAudio.addEventListener('click', () => {
            if (state.currentLookupData) speakText(state.currentLookupData.word);
        });
    }

    const btnExAudio = document.getElementById('btnPlayExampleAudio');
    if (btnExAudio) {
        btnExAudio.addEventListener('click', () => {
            const ex = document.getElementById('resExampleInput').value.trim();
            if (ex) speakText(ex);
        });
    }

    // Batch Extraction
    const btnBatch = document.getElementById('btnExtractParagraph');
    if (btnBatch) {
        btnBatch.addEventListener('click', handleBatchExtract);
    }
}

async function doWordLookup(word) {
    const resultCard = document.getElementById('lookupResultCard');
    const btn = document.getElementById('btnDoLookup');
    btn.textContent = 'Đang tra...';
    btn.disabled = true;

    try {
        const res = await fetch(`/api/lookup?word=${encodeURIComponent(word)}`);
        const data = await res.json();
        state.currentLookupData = data;

        document.getElementById('resWordTitle').textContent = data.word;
        document.getElementById('resIpaBadge').textContent = data.pronounce || '/.../';
        document.getElementById('resMeaningInput').value = data.description || '';
        document.getElementById('resExampleInput').value = (data.examples && data.examples.length) ? data.examples[0] : '';

        const existBadge = document.getElementById('existingBadge');
        if (data.user_vocab) {
            existBadge.classList.remove('hidden');
            existBadge.textContent = `✓ Đã có trong kho (Lần ôn: ${data.user_vocab.repetition})`;
        } else {
            existBadge.classList.add('hidden');
        }

        // Synonyms
        const synList = document.getElementById('resSynonymsList');
        synList.innerHTML = '';
        if (data.synonyms && data.synonyms.length > 0) {
            data.synonyms.forEach(syn => {
                const tag = document.createElement('span');
                tag.className = 'tag-synonym';
                tag.textContent = syn;
                tag.title = `Bấm để tra từ '${syn}'`;
                tag.onclick = () => {
                    document.getElementById('lookupInput').value = syn;
                    doWordLookup(syn);
                };
                synList.appendChild(tag);
            });
        } else {
            synList.innerHTML = '<span class="text-xs text-slate-400 italic">Không có</span>';
        }

        // Antonyms
        const antList = document.getElementById('resAntonymsList');
        antList.innerHTML = '';
        if (data.antonyms && data.antonyms.length > 0) {
            data.antonyms.forEach(ant => {
                const tag = document.createElement('span');
                tag.className = 'tag-antonym';
                tag.textContent = ant;
                tag.title = `Bấm để tra từ '${ant}'`;
                tag.onclick = () => {
                    document.getElementById('lookupInput').value = ant;
                    doWordLookup(ant);
                };
                antList.appendChild(tag);
            });
        } else {
            antList.innerHTML = '<span class="text-xs text-slate-400 italic">Không có</span>';
        }

        const htmlContainer = document.getElementById('dictHtmlContainer');
        htmlContainer.innerHTML = data.html || '<p class="text-slate-400 italic">Không có định dạng HTML.</p>';

        resultCard.classList.remove('hidden');
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
        alert('Lỗi tra cứu: ' + err.message);
    } finally {
        btn.textContent = '🔍 Tra Cứu Ngay';
        btn.disabled = false;
    }
}

async function saveCurrentLookupToVault() {
    if (!state.currentLookupData) return;

    const word = state.currentLookupData.word;
    const meaning = document.getElementById('resMeaningInput').value.trim();
    const example = document.getElementById('resExampleInput').value.trim();
    const delay = parseInt(document.getElementById('selectInitialDelay').value) || 10;
    const pronounce = document.getElementById('resIpaBadge').textContent;

    if (!meaning) {
        alert('Vui lòng nhập nghĩa tiếng Việt.');
        return;
    }

    const payload = {
        word: word,
        meaning: meaning,
        pronounce: pronounce,
        example: example,
        synonyms: state.currentLookupData.synonyms || [],
        antonyms: state.currentLookupData.antonyms || [],
        initial_delay: delay
    };

    try {
        const res = await fetch('/api/vocab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            const btnSave = document.getElementById('btnSaveToVault');
            btnSave.textContent = '✓ ĐÃ LƯU (+10 XP)!';
            btnSave.classList.replace('btn-orange-cta', 'btn-matcha');
            setTimeout(() => {
                btnSave.textContent = '💾 Lưu Vào Kho Từ Vựng (+10 XP)';
                btnSave.classList.replace('btn-matcha', 'btn-orange-cta');
            }, 2000);
            refreshDashboard();
            loadGamificationStats();
        } else {
            const err = await res.json();
            alert('Lỗi: ' + (err.detail || 'Không thể lưu.'));
        }
    } catch (e) {
        alert('Lỗi kết nối: ' + e.message);
    }
}

async function handleBatchExtract() {
    const text = document.getElementById('paragraphInput').value.trim();
    if (!text) {
        alert('Vui lòng dán một đoạn văn bản tiếng Anh.');
        return;
    }

    const autoSave = document.getElementById('chkAutoSaveBatch').checked;
    const initialDelay = parseInt(document.getElementById('batchInitialDelay').value) || 10;
    const btn = document.getElementById('btnExtractParagraph');

    btn.textContent = 'Đang trích xuất...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/extract-paragraph', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, auto_save: autoSave, initial_delay: initialDelay })
        });
        const data = await res.json();

        document.getElementById('batchCountBadge').textContent = data.total_matched || 0;
        renderBatchResults(data.words || []);
        document.getElementById('batchResultsSection').classList.remove('hidden');

        refreshDashboard();
        loadGamificationStats();
    } catch (err) {
        alert('Lỗi trích xuất: ' + err.message);
    } finally {
        btn.textContent = '⚡ Bắt Đầu Trích Xuất & Lưu';
        btn.disabled = false;
    }
}

function renderBatchResults(words) {
    const grid = document.getElementById('batchCardsGrid');
    grid.innerHTML = '';

    if (!words || words.length === 0) {
        grid.innerHTML = '<p class="col-span-3 text-slate-400 italic py-6 text-center">Không tìm thấy từ vựng phù hợp trong từ điển gốc.</p>';
        return;
    }

    words.forEach(w => {
        const card = document.createElement('div');
        card.className = 'card-soft p-4 space-y-2 border border-slate-200';

        card.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-base font-black text-slate-800 capitalize">${escapeHtml(w.word)}</span>
                <span class="text-xs font-mono text-slate-400">${escapeHtml(w.pronounce || '')}</span>
                <button class="btn-speaker text-xs w-6 h-6" onclick="speakText('${escapeHtml(w.word)}')">🔊</button>
            </div>
            <p class="text-xs text-slate-600 line-clamp-2">${escapeHtml(w.meaning)}</p>
            ${w.example ? `<p class="text-[11px] text-slate-500 italic bg-slate-50 p-2 rounded-xl border-l-2 border-[#f97316]">${escapeHtml(w.example)}</p>` : ''}
            <div class="flex flex-wrap gap-1 pt-1">
                ${(w.synonyms || []).slice(0, 3).map(s => `<span class="tag-synonym text-[10px]">${escapeHtml(s)}</span>`).join('')}
            </div>
        `;
        grid.appendChild(card);
    });
}

/* ==========================================================================
   7. TAB 3: KHO TỪ VỰNG & QUẢN LÝ
   ========================================================================== */
function initVaultTab() {
    const searchInput = document.getElementById('vaultSearchInput');
    const filterPills = document.querySelectorAll('.filter-pill');

    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                state.searchQuery = searchInput.value;
                loadVocabList();
            }, 300);
        });
    }

    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active', 'border-2', 'border-slate-800'));
            pill.classList.add('active', 'border-2', 'border-slate-800');
            state.activeFilter = pill.getAttribute('data-filter');
            loadVocabList();
        });
    });

    const btnCancel = document.getElementById('btnCancelEdit');
    const btnCancel2 = document.getElementById('btnCancelEdit2');
    const btnSaveEdit = document.getElementById('btnSaveEdit');

    if (btnCancel) btnCancel.onclick = closeEditModal;
    if (btnCancel2) btnCancel2.onclick = closeEditModal;
    if (btnSaveEdit) btnSaveEdit.onclick = submitEditVocab;
}

async function loadVocabList() {
    const grid = document.getElementById('vocabCardsGrid');
    const emptyMsg = document.getElementById('emptyVaultMsg');

    try {
        const res = await fetch(`/api/vocab?q=${encodeURIComponent(state.searchQuery)}&status=${state.activeFilter}`);
        const words = await res.json();

        grid.innerHTML = '';
        if (!words || words.length === 0) {
            emptyMsg.classList.remove('hidden');
            return;
        }
        emptyMsg.classList.add('hidden');

        const now = new Date();

        words.forEach(w => {
            const card = document.createElement('div');
            card.className = 'card-soft p-5 space-y-4 flex flex-col justify-between border border-slate-200/90';

            const nextDate = new Date(w.next_review);
            const isDue = nextDate <= now;

            card.innerHTML = `
                <div class="space-y-2">
                    <div class="flex items-center justify-between pb-2 border-b border-slate-100">
                        <div class="flex items-center gap-2">
                            <h3 class="text-xl font-black text-slate-800 capitalize">${escapeHtml(w.word)}</h3>
                            <button class="btn-speaker text-xs w-6 h-6" onclick="speakText('${escapeHtml(w.word)}')">🔊</button>
                        </div>
                        <span class="text-xs px-2.5 py-0.5 rounded-full font-bold ${isDue ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-slate-100 text-slate-500'}">
                            ${isDue ? '⏰ Đến hạn ôn' : formatRelativeTime(nextDate)}
                        </span>
                    </div>

                    <p class="text-xs font-mono text-slate-400">${escapeHtml(w.pronounce || '')}</p>
                    <p class="text-sm text-slate-700 font-semibold leading-relaxed">${escapeHtml(w.meaning)}</p>

                    ${w.example ? `
                        <div class="bg-[#fffdf5] p-2.5 rounded-xl border-l-2 border-[#f97316] flex items-start justify-between gap-2">
                            <p class="text-xs text-slate-600 italic">${escapeHtml(w.example)}</p>
                            <button class="text-slate-400 hover:text-[#f97316] text-xs" onclick="speakText('${escapeHtml(w.example)}')">🔊</button>
                        </div>
                    ` : ''}

                    <div class="flex flex-wrap gap-1 pt-1">
                        ${(w.synonyms || []).slice(0, 3).map(s => `<span class="tag-synonym text-[10px]">${escapeHtml(s)}</span>`).join('')}
                        ${(w.antonyms || []).slice(0, 2).map(a => `<span class="tag-antonym text-[10px]">${escapeHtml(a)}</span>`).join('')}
                    </div>
                </div>

                <div class="pt-3 border-t border-slate-100 space-y-3">
                    <div class="grid grid-cols-3 text-center text-[11px] text-slate-400 font-mono bg-slate-50 py-1.5 rounded-xl">
                        <div>Lần: <b class="text-slate-700">${w.repetition}</b></div>
                        <div>Cách: <b class="text-slate-700">${w.interval}d</b></div>
                        <div>Độ dễ: <b class="text-slate-700">${w.ease_factor}</b></div>
                    </div>

                    <div class="flex items-center justify-between gap-2">
                        <button class="btn-slate-cta text-xs py-1.5 px-3 flex-grow font-bold" onclick="triggerSingleWordReview(${w.id})">
                            ⚡ Ôn ngay
                        </button>
                        <button class="btn-matcha text-xs py-1.5 px-3" onclick="openEditModal(${w.id})">
                            ✏️ Sửa
                        </button>
                        <button class="btn-pink text-xs py-1.5 px-3" onclick="deleteVocabWord(${w.id}, '${escapeHtml(w.word)}')">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (e) {
        console.error('Failed to load vocab list:', e);
    }
}

async function refreshDashboard() {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();

        // Update home dashboard counters
        document.getElementById('statHomeTotal').textContent = stats.total;
        document.getElementById('statHomeLearning').textContent = stats.learning;
        document.getElementById('statHomeDue').textContent = stats.due;
        document.getElementById('statHomeMastered').textContent = stats.mastered;

        // Update sidebar badge
        const badge = document.getElementById('sidebarVaultBadge');
        if (badge) badge.textContent = stats.total;

        // Update Usagi message on home banner
        const homeDue = document.getElementById('homeDueCount');
        if (homeDue) homeDue.textContent = stats.due;

        const tip = document.getElementById('sidebarMascotTip');
        if (tip) {
            if (stats.due > 0) {
                tip.textContent = `Bạn có ${stats.due} từ đến hạn ôn tập ngay!`;
            } else {
                tip.textContent = 'Tuyệt vời! Không còn từ nào bị trễ hạn.';
            }
        }
    } catch (e) {
        console.error('Failed to refresh dashboard stats:', e);
    }
}

function openEditModal(vocabId) {
    fetch(`/api/vocab`)
        .then(res => res.json())
        .then(words => {
            const target = words.find(w => w.id === vocabId);
            if (!target) return;

            document.getElementById('editVocabId').value = target.id;
            document.getElementById('editModalTitle').textContent = `Sửa từ: ${target.word}`;
            document.getElementById('editMeaningInput').value = target.meaning;
            document.getElementById('editIpaInput').value = target.pronounce || '';
            document.getElementById('editExampleInput').value = target.example || '';

            document.getElementById('editModal').classList.remove('hidden');
        });
}

function closeEditModal() {
    document.getElementById('editModal').classList.add('hidden');
}

async function submitEditVocab() {
    const id = document.getElementById('editVocabId').value;
    const meaning = document.getElementById('editMeaningInput').value.trim();
    const pronounce = document.getElementById('editIpaInput').value.trim();
    const example = document.getElementById('editExampleInput').value.trim();

    if (!meaning) {
        alert('Nghĩa không được để trống.');
        return;
    }

    try {
        await fetch(`/api/vocab/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meaning, pronounce, example, synonyms: [], antonyms: [] })
        });
        closeEditModal();
        loadVocabList();
    } catch (e) {
        alert('Lỗi cập nhật: ' + e.message);
    }
}

async function deleteVocabWord(id, word) {
    if (!confirm(`Bạn có chắc muốn xóa từ "${word}" khỏi kho từ vựng không?`)) return;

    try {
        await fetch(`/api/vocab/${id}`, { method: 'DELETE' });
        loadVocabList();
        refreshDashboard();
    } catch (e) {
        alert('Lỗi xóa từ: ' + e.message);
    }
}

/* ==========================================================================
   8. TAB 4: ÔN TẬP BẮT BUỘC & CÀI ĐẶT
   ========================================================================== */
function initReviewTab() {
    const btnSave = document.getElementById('btnSaveSettings');
    const btnTestVoice = document.getElementById('btnTestVoice');
    const btnForce = document.getElementById('btnForceStartReview');
    const btnSettingToggle = document.getElementById('btnSettingToggleLock');

    if (btnSettingToggle) {
        btnSettingToggle.addEventListener('click', toggleLockEnabled);
    }

    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const cycle = document.getElementById('cfgReviewCycle').value;
            const voice = document.getElementById('cfgSpeechVoice').value;
            const rate = document.getElementById('cfgSpeechRate').value;

            try {
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ review_cycle: cycle, speech_voice: voice, speech_rate: rate })
                });
                state.settings.review_cycle = parseInt(cycle);
                state.settings.speech_voice = voice;
                state.settings.speech_rate = parseFloat(rate);
                alert('Đã lưu thiết lập thành công! 🐰');
            } catch (err) {
                alert('Lỗi lưu thiết lập: ' + err);
            }
        });
    }

    if (btnTestVoice) {
        btnTestVoice.addEventListener('click', () => {
            const voice = document.getElementById('cfgSpeechVoice').value;
            speakText('Hello! Usagi Vocab is ready to help you practice English offline.', voice);
        });
    }

    if (btnForce) {
        btnForce.addEventListener('click', forceTestLockScreen);
    }
}

/* ==========================================================================
   9. MANDATORY LOCK SCREEN OVERLAY ENGINE (USAGI THEME)
   ========================================================================== */
function initLockScreen() {
    const input = document.getElementById('lockInputAnswer');
    const btnSubmit = document.getElementById('btnLockSubmit');
    const btnHint = document.getElementById('btnLockHint');
    const btnAudio = document.getElementById('btnLockAudio');
    const btnDismiss = document.getElementById('btnDismissLock');

    if (btnSubmit) btnSubmit.onclick = submitLockAnswer;
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitLockAnswer();
        });
    }

    if (btnHint) btnHint.onclick = useLockHint;
    if (btnAudio) {
        btnAudio.onclick = () => {
            const currentWord = state.dueWords[state.currentLockIndex];
            if (currentWord) speakText(currentWord.word);
        };
    }

    if (btnDismiss) {
        btnDismiss.onclick = () => {
            state.lockEnabled = false;
            localStorage.setItem('lockEnabled', 'false');
            updateLockToggleUI();
            unlockScreen();
        };
    }

    window.addEventListener('keydown', (e) => {
        if (state.lockActive && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            unlockScreen();
        }
    }, true);
}

function startBackgroundDueCheck() {
    if (state.checkIntervalId) clearInterval(state.checkIntervalId);

    // Check every 5 seconds for due words
    state.checkIntervalId = setInterval(async () => {
        if (!state.lockEnabled || state.lockActive) return;

        try {
            const res = await fetch('/api/due');
            if (res.ok) {
                const dueWords = await res.json();
                if (dueWords && dueWords.length > 0) {
                    triggerLockScreen(dueWords);
                }
            }
        } catch (e) {
            // Background polling error
        }
    }, 5000);
}

function triggerLockScreen(dueWords) {
    if (state.lockActive) return;

    state.lockActive = true;
    state.dueWords = dueWords;
    state.currentLockIndex = 0;
    state.lockUsedHint = false;

    document.body.style.overflow = 'hidden';
    playLockChime();

    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('[🐰 ĐẾN GIỜ ÔN TẬP!]', {
            body: `Bé thỏ Usagi nhắc bạn có ${dueWords.length} từ vựng cần kiểm tra ngay!`,
            icon: '/static/mascot.png',
            requireInteraction: true
        });
    }

    startTitleFlashing();

    const overlay = document.getElementById('lockScreenOverlay');
    overlay.style.display = 'flex';

    renderCurrentLockQuestion();
}

function renderCurrentLockQuestion() {
    if (state.currentLockIndex >= state.dueWords.length) {
        unlockScreen();
        return;
    }

    state.lockUsedHint = false;
    const item = state.dueWords[state.currentLockIndex];

    document.getElementById('lockRemainingCount').textContent = state.dueWords.length - state.currentLockIndex;
    document.getElementById('lockMeaningText').textContent = item.meaning;
    document.getElementById('lockIpaText').textContent = item.pronounce || '/.../';

    const len = item.word ? item.word.length : (item.word_length || 5);
    let mask = '';
    for (let i = 0; i < len; i++) {
        mask += '_ ';
    }
    document.getElementById('lockMaskedWord').textContent = mask.trim();

    const input = document.getElementById('lockInputAnswer');
    input.value = '';
    input.disabled = false;
    input.focus();

    const msg = document.getElementById('lockFeedbackMsg');
    msg.textContent = '';
    msg.className = 'min-h-[24px] text-xs font-black';
}

function useLockHint() {
    state.lockUsedHint = true;
    const item = state.dueWords[state.currentLockIndex];
    if (!item) return;

    const actual = item.word || '';
    let hintStr = '';
    for (let i = 0; i < actual.length; i++) {
        if (i === 0 || i === actual.length - 1) {
            hintStr += actual[i].toUpperCase() + ' ';
        } else {
            hintStr += '_ ';
        }
    }

    document.getElementById('lockMaskedWord').textContent = hintStr.trim();
    const msg = document.getElementById('lockFeedbackMsg');
    msg.textContent = '⚠️ Đã mở gợi ý ký tự! (Từ này sẽ bị phạt ôn lại sau 2 phút)';
    msg.className = 'min-h-[24px] text-xs font-black text-amber-600';

    document.getElementById('lockInputAnswer').focus();
}

async function submitLockAnswer() {
    const item = state.dueWords[state.currentLockIndex];
    if (!item) return;

    const input = document.getElementById('lockInputAnswer');
    const answer = input.value.trim().toLowerCase();
    const msg = document.getElementById('lockFeedbackMsg');

    if (!answer) {
        msg.textContent = 'Vui lòng gõ từ tiếng Anh.';
        msg.className = 'min-h-[24px] text-xs font-black text-red-500';
        shakeLockCard();
        return;
    }

    input.disabled = true;

    try {
        const res = await fetch(`/api/review/${item.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                answer: answer,
                used_hint: state.lockUsedHint,
                cycle_seconds: state.settings.review_cycle
            })
        });

        const data = await res.json();

        if (data.correct && !state.lockUsedHint) {
            msg.textContent = '✓ CHÍNH XÁC TUYỆT ĐỐI! +20 XP ĐÃ ĐƯỢC CỘNG! 🐰';
            msg.className = 'min-h-[24px] text-xs font-black text-emerald-600';

            loadGamificationStats();

            setTimeout(() => {
                state.currentLockIndex++;
                renderCurrentLockQuestion();
            }, 1200);
        } else {
            shakeLockCard();
            if (data.correct && state.lockUsedHint) {
                msg.textContent = `✓ Đúng, nhưng bạn đã dùng gợi ý! Từ "${data.correct_word}" bị hẹn lại sau 2 phút.`;
                msg.className = 'min-h-[24px] text-xs font-black text-amber-600';
            } else {
                msg.textContent = `✗ SAI RỒI! Đáp án đúng là "${data.correct_word}". Bị hẹn lại sau 2 phút.`;
                msg.className = 'min-h-[24px] text-xs font-black text-red-500';
            }

            setTimeout(() => {
                state.currentLockIndex++;
                renderCurrentLockQuestion();
            }, 2000);
        }
    } catch (e) {
        msg.textContent = 'Lỗi kết nối máy chủ: ' + e.message;
        msg.className = 'min-h-[24px] text-xs font-black text-red-500';
        input.disabled = false;
    }
}

function unlockScreen() {
    state.lockActive = false;
    state.dueWords = [];
    document.body.style.overflow = '';
    stopTitleFlashing();

    const overlay = document.getElementById('lockScreenOverlay');
    overlay.style.display = 'none';

    refreshDashboard();
    loadGamificationStats();
    if (state.currentTab === 'tab-vault') {
        loadVocabList();
    }
}

function shakeLockCard() {
    const card = document.querySelector('.lock-container');
    if (card) {
        card.classList.remove('lock-shake');
        void card.offsetWidth;
        card.classList.add('lock-shake');
    }
}

function startTitleFlashing() {
    if (state.titleIntervalId) clearInterval(state.titleIntervalId);
    let flag = false;
    state.titleIntervalId = setInterval(() => {
        document.title = flag ? '[🐰 ĐẾN GIỜ ÔN TẬP!]' : state.originalTitle;
        flag = !flag;
    }, 800);
}

function stopTitleFlashing() {
    if (state.titleIntervalId) {
        clearInterval(state.titleIntervalId);
        state.titleIntervalId = null;
    }
    document.title = state.originalTitle;
}

// Force test review mode
async function forceTestLockScreen() {
    try {
        const res = await fetch('/api/due');
        const due = await res.json();
        if (due && due.length > 0) {
            triggerLockScreen(due);
            return;
        }

        const vRes = await fetch('/api/vocab');
        const words = await vRes.json();
        if (words && words.length > 0) {
            triggerLockScreen([words[0]]);
        } else {
            alert('Kho từ vựng đang trống. Đang tạo 1 từ mẫu "serendipity" để bạn kiểm tra màn hình khóa...');
            await fetch('/api/vocab', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    word: 'serendipity',
                    meaning: 'khả năng tình cờ phát hiện những điều bất ngờ và may mắn',
                    pronounce: "/,seren'dipiti/",
                    example: 'A fortunate stroke of serendipity.',
                    initial_delay: 1
                })
            });
            setTimeout(async () => {
                const testRes = await fetch('/api/due');
                const testDue = await testRes.json();
                triggerLockScreen(testDue.length > 0 ? testDue : [{
                    id: 1,
                    word: 'serendipity',
                    meaning: 'khả năng tình cờ phát hiện những điều bất ngờ và may mắn',
                    pronounce: "/,seren'dipiti/",
                    word_length: 11
                }]);
            }, 500);
        }
    } catch (e) {
        alert('Lỗi thử nghiệm: ' + e.message);
    }
}

function triggerSingleWordReview(vocabId) {
    fetch('/api/vocab')
        .then(res => res.json())
        .then(words => {
            const item = words.find(w => w.id === vocabId);
            if (item) {
                triggerLockScreen([item]);
            }
        });
}

/* ==========================================================================
   10. TOP QUICK DICTIONARY LOOKUP POPUP
   ========================================================================== */
function initTopQuickSearch() {
    const input = document.getElementById('topQuickSearchInput');
    const btn = document.getElementById('btnTopQuickSearch');
    const modal = document.getElementById('quickLookupModal');
    const btnClose = document.getElementById('btnCloseQuickLookup');
    const btnAdd = document.getElementById('btnQuickAddToVault');
    const btnAudio = document.getElementById('btnQuickAudio');

    const handleQuickSearch = async () => {
        const query = input.value.trim();
        if (!query) return;

        try {
            const res = await fetch(`/api/lookup?word=${encodeURIComponent(query)}`);
            const data = await res.json();
            state.quickLookupData = data;

            document.getElementById('quickWordTitle').textContent = data.word;
            document.getElementById('quickIpaBadge').textContent = data.pronounce || '/.../';
            document.getElementById('quickMeaningText').textContent = data.description || 'Không có mô tả nghĩa.';

            const exBox = document.getElementById('quickExampleBox');
            const exText = document.getElementById('quickExampleText');
            if (data.examples && data.examples.length > 0) {
                exText.textContent = data.examples[0];
                exBox.classList.remove('hidden');
            } else {
                exBox.classList.add('hidden');
            }

            modal.classList.remove('hidden');
        } catch (e) {
            alert('Lỗi tra nhanh: ' + e.message);
        }
    };

    if (btn) btn.addEventListener('click', handleQuickSearch);
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleQuickSearch();
        });
    }

    if (btnClose) {
        btnClose.onclick = () => modal.classList.add('hidden');
    }

    if (btnAudio) {
        btnAudio.onclick = () => {
            if (state.quickLookupData) speakText(state.quickLookupData.word);
        };
    }

    if (btnAdd) {
        btnAdd.onclick = async () => {
            if (!state.quickLookupData) return;
            const d = state.quickLookupData;
            try {
                await fetch('/api/vocab', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        word: d.word,
                        meaning: d.description || 'Nghĩa từ điển',
                        pronounce: d.pronounce || '',
                        example: (d.examples && d.examples.length) ? d.examples[0] : '',
                        synonyms: d.synonyms || [],
                        antonyms: d.antonyms || [],
                        initial_delay: 60
                    })
                });
                modal.classList.add('hidden');
                refreshDashboard();
                loadGamificationStats();
                alert(`Đã thêm từ "${d.word}" vào kho từ vựng (+10 XP)! 🐰`);
            } catch (err) {
                alert('Lỗi thêm từ: ' + err.message);
            }
        };
    }
}

/* ==========================================================================
   11. UTILITIES
   ========================================================================== */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatRelativeTime(date) {
    const diffSec = Math.round((date - new Date()) / 1000);
    if (diffSec <= 0) return 'Đến hạn';
    if (diffSec < 60) return `sau ${diffSec}s`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `sau ${diffMin}p`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `sau ${diffHours}h`;
    const diffDays = Math.round(diffHours / 24);
    return `sau ${diffDays} ngày`;
}
