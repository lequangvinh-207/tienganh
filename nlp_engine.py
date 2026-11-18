import re
import eng_to_ipa as ipa_lib

# Fallback comprehensive offline English stopwords list
FALLBACK_STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
    "but", "by", "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
    "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had",
    "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
    "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd",
    "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself",
    "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off",
    "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over",
    "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
    "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
    "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've",
    "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't",
    "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when",
    "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's",
    "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your",
    "yours", "yourself", "yourselves", "will", "shall", "may", "might", "can", "must"
}

# Try loading NLTK wordnet and stopwords
STOPWORDS = set(FALLBACK_STOPWORDS)
try:
    from nltk.corpus import stopwords
    STOPWORDS.update(stopwords.words('english'))
except Exception:
    pass

try:
    from nltk.corpus import wordnet as wn
except Exception:
    wn = None


def get_synonyms_antonyms(word: str, max_items: int = 5):
    """
    Extract up to max_items synonyms and antonyms using offline NLTK WordNet.
    """
    synonyms = []
    antonyms = []

    if not wn or not word:
        return synonyms, antonyms

    clean_word = word.strip().lower()
    seen_syn = {clean_word}
    seen_ant = set()

    try:
        synsets = wn.synsets(clean_word)
        for syn in synsets:
            for lemma in syn.lemmas():
                lem_name = lemma.name().replace('_', ' ').lower()
                # Synonyms
                if lem_name not in seen_syn and len(lem_name) > 1:
                    seen_syn.add(lem_name)
                    synonyms.append(lem_name)
                    if len(synonyms) >= max_items:
                        break

                # Antonyms
                for ant in lemma.antonyms():
                    ant_name = ant.name().replace('_', ' ').lower()
                    if ant_name not in seen_ant and len(ant_name) > 1:
                        seen_ant.add(ant_name)
                        antonyms.append(ant_name)
                        if len(antonyms) >= max_items:
                            break

            if len(synonyms) >= max_items and len(antonyms) >= max_items:
                break
    except Exception as e:
        print(f"WordNet lookup error for {word}: {e}")

    return synonyms[:max_items], antonyms[:max_items]


def get_wordnet_examples(word: str, max_examples: int = 2):
    """Extract example sentences from WordNet synsets."""
    if not wn or not word:
        return []

    clean_word = word.strip().lower()
    examples = []
    try:
        synsets = wn.synsets(clean_word)
        for syn in synsets:
            for ex in syn.examples():
                if ex and ex not in examples:
                    examples.append(ex.strip())
                    if len(examples) >= max_examples:
                        return examples
    except Exception:
        pass
    return examples


def get_ipa_pronounce(word: str, dict_ipa: str = ""):
    """
    Returns clean IPA pronunciation.
    Prefers dictionary IPA if available, falls back to offline eng-to-ipa library.
    """
    if dict_ipa and dict_ipa.strip():
        # Clean formatting like leading/trailing slashes or brackets
        cleaned = dict_ipa.strip().strip("/[]")
        return f"/{cleaned}/"

    try:
        res = ipa_lib.convert(word.strip())
        # eng-to-ipa puts an asterisk if word has unknown symbols or fails
        if res and not res.endswith("*"):
            return f"/{res}/"
    except Exception:
        pass

    return ""


def extract_words_from_paragraph(paragraph: str):
    """
    Extract meaningful English words and their contextual sentences from a paragraph.
    Returns list of tuples: [(word, context_sentence), ...]
    """
    if not paragraph or not paragraph.strip():
        return []

    # Split into sentences using punctuation boundaries
    sentences = re.split(r'(?<=[.!?])\s+', paragraph.strip())
    extracted = []
    seen_words = set()

    for sent in sentences:
        sent_clean = sent.strip()
        if not sent_clean:
            continue
        # Find all words with letters and hyphens (at least 3 characters)
        raw_words = re.findall(r'\b[a-zA-Z]{3,}\b', sent_clean)
        for w in raw_words:
            w_lower = w.lower()
            if w_lower in STOPWORDS:
                continue
            if w_lower not in seen_words:
                seen_words.add(w_lower)
                extracted.append((w_lower, sent_clean))

    return extracted
