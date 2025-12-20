// static/js/main.js
let sentences = [];
let sentenceAudioUrls = [];
let globalDone = 0;      // how many chunks are generated (from backend)
let audio = null;
let currentIndex = null; // index currently playing (or to be played)
let playedUntil = -1;    // highest index fully played
let waitingForNext = false;
let autoScrollEnabled = true;
let totalLogicalSentences = 0;

// JOB_ID, FULL_TEXT, LAST_PLAYED_INDEX, MODE are defined in index.html

async function onProviderChange() {
    const providerId = document.getElementById('provider').value;
    let defaultLanguage = null;
    let defaultVoice = null;

    // Fetch settings first to get defaults
    try {
        const sRes = await fetch(`/api/providers/${providerId}/settings`);
        if (sRes.ok) {
            const settings = await sRes.json();
            defaultLanguage = settings.default_language;
            defaultVoice = settings.default_voice;
        }
    } catch (e) { console.error("Error fetching settings", e); }

    // 1. Fetch languages for the new provider
    try {
        const lRes = await fetch(`/api/providers/${providerId}/languages`);
        if (lRes.ok) {
            const lData = await lRes.json();
            const langSelect = document.getElementById('language');
            langSelect.innerHTML = '';
            lData.languages.forEach(lang => {
                const opt = document.createElement('option');
                opt.value = lang;
                opt.textContent = lang;
                langSelect.appendChild(opt);
            });

            if (defaultLanguage && lData.languages.includes(defaultLanguage)) {
                langSelect.value = defaultLanguage;
            }
        }
    } catch (e) { console.error("Error fetching languages", e); }

    // 2. Automatically trigger voice fetch
    onLanguageChange(defaultVoice);
}

async function onLanguageChange(preferredVoice = null) {
    const providerId = document.getElementById('provider').value;
    const language = document.getElementById('language').value;
    const speakerSelect = document.getElementById('speaker');
    const speakerHint = document.getElementById('speaker-hint');

    if (!language) {
        speakerSelect.innerHTML = '<option value="">Select language first</option>';
        return;
    }

    speakerHint.textContent = "Loading voices...";

    try {
        const vRes = await fetch(`/api/providers/${providerId}/voices?language=${language}`);
        if (vRes.ok) {
            const vData = await vRes.json();
            speakerSelect.innerHTML = '';
            vData.voices.forEach(voice => {
                const opt = document.createElement('option');
                opt.value = voice;
                opt.textContent = voice;
                speakerSelect.appendChild(opt);
            });
            speakerHint.textContent = `Choose one of the ${vData.voices.length} voices available for ${language}.`;

            if (preferredVoice && vData.voices.includes(preferredVoice)) {
                speakerSelect.value = preferredVoice;
            }
        }
    } catch (e) {
        console.error("Error fetching voices", e);
        speakerHint.textContent = "Error loading voices.";
    }
}

async function saveAsDefault(type) {
    const providerId = document.getElementById('provider').value;
    const val = document.getElementById(type === 'language' ? 'language' : 'speaker').value;
    if (!val) return;

    try {
        // First get existing settings
        const res = await fetch(`/api/providers/${providerId}/settings`);
        let settings = {};
        if (res.ok) {
            settings = await res.json();
        }

        if (type === 'language') {
            settings.default_language = val;
        } else {
            settings.default_voice = val;
        }

        const saveRes = await fetch(`/api/providers/${providerId}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (saveRes.ok) {
            alert(`Saved ${val} as default ${type} for ${providerId}`);
        } else {
            alert("Error saving default");
        }
    } catch (e) {
        console.error("Error saving default", e);
        alert("Error saving default");
    }
}


function openSettings() {
    document.getElementById('settings-modal').style.display = 'block';
    loadProviderSettings();
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

async function loadProviderSettings() {
    const providerId = document.getElementById('settings-provider-select').value;
    const fieldsDiv = document.getElementById('settings-fields');
    const defaultLangSelect = document.getElementById('settings-default-language');
    const defaultVoiceSelect = document.getElementById('settings-default-voice');

    fieldsDiv.innerHTML = '<p style="color: #94a3b8;">Loading settings...</p>';
    defaultLangSelect.innerHTML = '<option>Loading...</option>';
    defaultVoiceSelect.innerHTML = '<option>Loading...</option>';

    try {
        // Fetch languages and voices to populate dropdowns
        const lRes = await fetch(`/api/providers/${providerId}/languages`);
        const lData = lRes.ok ? await lRes.json() : { languages: [] };

        defaultLangSelect.innerHTML = '<option value="">(None)</option>';
        lData.languages.forEach(lang => {
            const opt = document.createElement('option');
            opt.value = lang;
            opt.textContent = lang;
            defaultLangSelect.appendChild(opt);
        });

        const vRes = await fetch(`/api/providers/${providerId}/voices`);
        const vData = vRes.ok ? await vRes.json() : { voices: [] };

        defaultVoiceSelect.innerHTML = '<option value="">(None)</option>';
        vData.voices.forEach(voice => {
            const opt = document.createElement('option');
            opt.value = voice;
            opt.textContent = voice;
            defaultVoiceSelect.appendChild(opt);
        });

        const res = await fetch(`/api/providers/${providerId}/settings`);
        if (res.ok) {
            const settings = await res.json();
            fieldsDiv.innerHTML = '';

            if (providerId === 'google') {
                fieldsDiv.innerHTML = `
                    <div class="form-group">
                        <label for="google_service_account">Google Cloud Service Account JSON</label>
                        <textarea id="google_service_account" rows="10" placeholder='Paste your Service Account JSON here...' style="width: 100%; box-sizing: border-box; font-family: monospace;">${settings.google_service_account || ''}</textarea>
                        <div class="small-hint">You can create a service account and download the JSON key from the Google Cloud Console.</div>
                    </div>
                `;
            } else if (providerId === 'local') {
                fieldsDiv.innerHTML = `<p style="color: #94a3b8;">No specific settings for local provider.</p>`;
            } else {
                fieldsDiv.innerHTML = `<p style="color: #94a3b8;">No configuration fields defined for this provider yet.</p>`;
            }

            // Populate defaults
            if (settings.default_language) defaultLangSelect.value = settings.default_language;
            if (settings.default_voice) defaultVoiceSelect.value = settings.default_voice;
        }
    } catch (e) {
        console.error("Error loading settings", e);
        fieldsDiv.innerHTML = '<p style="color: #ef4444;">Error loading settings.</p>';
    }
}


async function saveSettings() {
    const providerId = document.getElementById('settings-provider-select').value;
    const settings = {};

    if (providerId === 'google') {
        const field = document.getElementById('google_service_account');
        if (field) settings.google_service_account = field.value;
    }

    settings.default_language = document.getElementById('settings-default-language').value;
    settings.default_voice = document.getElementById('settings-default-voice').value;


    try {
        const res = await fetch(`/api/providers/${providerId}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (res.ok) {
            alert("Settings saved successfully.");
            closeSettings();
        } else {
            alert("Error saving settings.");
        }
    } catch (e) { console.error("Error saving settings", e); }
}

const PARAGRAPH_DELIMITER = "||PARAGRAPH_BREAK||";

function splitSentences(text) {
    if (!text) return [];
    // 1. Normalize line endings
    const normalized = text.replace(/\r\n/g, "\n");

    // 2. Split by double newlines to find paragraphs
    const paragraphs = normalized.split(/\n\s*\n/);

    const chunks = [];

    paragraphs.forEach((para, pIdx) => {
        // Normalize single newlines to spaces within paragraph
        const cleanPara = para.replace(/\s+/g, " ").trim();
        if (!cleanPara) return; // skip empty

        // Split by punctuation
        const sents = cleanPara.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

        sents.forEach(s => chunks.push(s));

        // Marker for later rendering, unless it's the last paragraph
        if (pIdx < paragraphs.length - 1) {
            chunks.push(PARAGRAPH_DELIMITER);
        }
    });

    return chunks;
}

function renderSentences() {
    const container = document.getElementById("sentences-container");
    container.innerHTML = "";

    let realIndex = 0;

    sentences.forEach((s) => {
        if (s === PARAGRAPH_DELIMITER) {
            const br = document.createElement("br");
            const br2 = document.createElement("br"); // double break for paragraph
            container.appendChild(br);
            container.appendChild(br2);
            return;
        }

        const span = document.createElement("span");
        span.className = "sentence pending";
        span.dataset.index = String(realIndex);
        span.textContent = s + " ";
        span.addEventListener("click", () => onSentenceClick(parseInt(span.dataset.index, 10)));
        container.appendChild(span);

        realIndex++;
    });
}

function updateSentenceStyles(total) {
    const container = document.getElementById("sentences-container");
    if (!container) return;

    const nodes = container.querySelectorAll(".sentence");

    nodes.forEach(el => {
        const idx = parseInt(el.dataset.index, 10);
        el.classList.remove("pending", "converting", "ready", "playing", "played");

        // currently playing
        if (audio && currentIndex === idx && !audio.paused) {
            el.classList.add("playing");
            return;
        }

        // finished playback
        if (idx <= playedUntil) {
            el.classList.add("played");
            return;
        }

        // audio ready but not yet played
        if (sentenceAudioUrls[idx]) {
            el.classList.add("ready");
            return;
        }

        // If not ready, and it's within "done" range but maybe sparse list logic?
        // Actually sentenceAudioUrls[idx] is the source of truth for "ready"

        // currently being converted (approx: next chunk to be generated)
        // With database updates, status is granular.
        if (idx === globalDone && idx < total) {
            el.classList.add("converting");
            return;
        }

        // not started at all
        el.classList.add("pending");
    });

    // Auto-scroll logic if playing
    if (audio && !audio.paused && currentIndex !== null && autoScrollEnabled) {
        const el = container.querySelector(`.sentence[data-index="${currentIndex}"]`);
        if (el) {
            // Smart Scroll: Keep in top 3rd
            // Calculate target scroll position
            // We want el.offsetTop to be around 30% of the container height visible
            const containerHeight = container.clientHeight;
            const targetTop = el.offsetTop - (containerHeight * 0.3);

            // Smooth scroll to that position
            container.scrollTo({
                top: Math.max(0, targetTop),
                behavior: "smooth"
            });
        }
    }
}

function ensureAudio() {
    if (!audio) {
        audio = new Audio();
        audio.addEventListener("ended", onAudioEnded);
        audio.addEventListener("play", () => {
            updateSentenceStyles(totalLogicalSentences);
            updateControls();
            updateDurationDisplay();
        });
        audio.addEventListener("pause", () => {
            updateSentenceStyles(totalLogicalSentences);
            updateControls();
            updateDurationDisplay();
        });
        audio.addEventListener("timeupdate", () => {
            updateDurationDisplay();
        });

        const speedInput = document.getElementById("playback-speed");
        if (speedInput) {
            audio.playbackRate = parseFloat(speedInput.value);
        }
    }
}

function playFromIndex(idx) {
    if (!sentenceAudioUrls[idx]) {
        console.log("Sentence audio not ready yet:", idx);
        return;
    }
    ensureAudio();
    audio.pause();
    currentIndex = idx;
    audio.src = sentenceAudioUrls[idx];

    // Enforce speed (must be AFTER src change as src change resets rate)
    const speedInput = document.getElementById("playback-speed");
    if (speedInput) {
        audio.playbackRate = parseFloat(speedInput.value);
    }

    // update UI immediately (likely "loading" or "ready" until play event fires)
    updateSentenceStyles(totalLogicalSentences);

    audio.play().catch(err => console.error("Play error:", err));
    waitingForNext = false;

    // Persist progress
    saveProgress(idx);
}

function onSentenceClick(idx) {
    if (!sentenceAudioUrls[idx]) {
        console.log("Sentence not ready yet, cannot play.");
        return;
    }
    // Reset played state for following sentences
    playedUntil = idx - 1;
    playFromIndex(idx);
    updateSentenceStyles(totalLogicalSentences);
}

function onAudioEnded() {
    if (currentIndex != null) {
        playedUntil = Math.max(playedUntil, currentIndex);
    }

    const nextIndex = (currentIndex ?? -1) + 1;
    if (nextIndex < totalLogicalSentences) {
        if (sentenceAudioUrls[nextIndex]) {
            playFromIndex(nextIndex);
        } else {
            // wait until next sentence audio exists
            currentIndex = nextIndex;
            waitingForNext = true;
            updateControls();
        }
    } else {
        // Playback finished
        waitingForNext = false;
        currentIndex = 0; // Reset to start
        updateControls();
        updateSentenceStyles(totalLogicalSentences);
    }
}

async function saveProgress(idx) {
    if (!JOB_ID) return;
    try {
        await fetch("/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversion_id: JOB_ID, index: idx })
        });
    } catch (e) {
        console.error("Failed to save progress", e);
    }
}

async function generateDownload() {
    // Generate full audio on demand (or check if exists)
    // and trigger download from the link in metadata
    // This might be redundant if the link is updated directly in pollStatus,
    // but if we need to trigger generation:

    // For now, pollStatus will just set the link href if done.
    // Sentinel to keep function if needed, but logic moves to pollStatus/link behavior.
}

function updateControls() {
    const btn = document.getElementById("btn-play-pause");
    const prevBtn = document.getElementById("btn-prev");
    const nextBtn = document.getElementById("btn-next");
    if (!btn) return;

    // enable play/pause if we have sentences to play (even if not ready yet, for buffering)
    const canPlay = totalLogicalSentences > 0;
    btn.disabled = !canPlay;

    // Navigation buttons
    if (prevBtn) prevBtn.disabled = !canPlay || (currentIndex || 0) <= 0;
    if (nextBtn) nextBtn.disabled = !canPlay || (currentIndex != null && currentIndex >= totalLogicalSentences - 1);

    const svgPlay = document.getElementById("svg-play");
    const svgPause = document.getElementById("svg-pause");

    if (waitingForNext) {
        btn.classList.add("buffering");
        if (svgPlay) svgPlay.style.display = "block";
        if (svgPause) svgPause.style.display = "none";
    } else if (audio && !audio.paused) {
        btn.classList.remove("buffering");
        if (svgPlay) svgPlay.style.display = "none";
        if (svgPause) svgPause.style.display = "block";
    } else {
        btn.classList.remove("buffering");
        if (svgPlay) svgPlay.style.display = "block";
        if (svgPause) svgPause.style.display = "none";
    }
}

function setupControls() {
    const btn = document.getElementById("btn-play-pause");
    const prevBtn = document.getElementById("btn-prev");
    const nextBtn = document.getElementById("btn-next");
    const speed = document.getElementById("playback-speed");
    const seekBar = document.getElementById("global-seek-bar");

    if (btn) {
        btn.addEventListener("click", () => {
            ensureAudio();
            if (!audio.paused) {
                audio.pause();
                return;
            }

            // Start playing
            if (currentIndex == null) currentIndex = 0;
            if (currentIndex >= totalLogicalSentences) currentIndex = 0;

            if (sentenceAudioUrls[currentIndex]) {
                playFromIndex(currentIndex);
            } else {
                waitingForNext = true;
                updateControls();
            }
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            const idx = (currentIndex || 0);
            if (idx > 0) {
                onSentenceClick(idx - 1);
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            const idx = currentIndex != null ? currentIndex : -1;
            if (idx < totalLogicalSentences - 1) {
                onSentenceClick(idx + 1);
            }
        });
    }

    if (speed) {
        const updateSpeed = () => {
            const val = parseFloat(speed.value);
            if (audio) {
                audio.playbackRate = val;
            }
            const valDisplay = document.getElementById("speed-val");
            if (valDisplay) {
                valDisplay.textContent = val.toFixed(1);
            }
            updateDurationDisplay(); // update remaining/total estimates
        };

        speed.addEventListener("change", updateSpeed);
        speed.addEventListener("input", updateSpeed);
    }

    if (seekBar) {
        seekBar.addEventListener("input", (e) => {
            // Manual seek logic
            const targetTime = parseFloat(e.target.value);
            seekToTime(targetTime);
        });
    }

    const autoScrollCheckbox = document.getElementById("auto-scroll");
    if (autoScrollCheckbox) {
        autoScrollEnabled = autoScrollCheckbox.checked; // sync initial
        autoScrollCheckbox.addEventListener("change", (e) => {
            autoScrollEnabled = e.target.checked;
        });
    }

    setupSeekBarInteractions();
}

function seekToTime(targetSeconds) {
    const seekBar = document.getElementById("global-seek-bar");
    const displaySecs = parseFloat(seekBar?.max || 0);

    let sum = 0;
    for (let i = 0; i < totalLogicalSentences; i++) {
        const d = getChunkDuration(i, displaySecs);
        if (sum + d > targetSeconds) {
            // This is the sentence we want
            const offsetInSentence = targetSeconds - sum;

            // If it's the current sentence, just seek. 
            // If not, click it, then seek when it starts.
            if (currentIndex === i && audio) {
                audio.currentTime = offsetInSentence;
                updateDurationDisplay();
            } else {
                // If not ready, we just jump to the sentence for now.
                // Within-sentence accurate seeking across sentence boundaries 
                // requires the audio to be loaded (playFromIndex).
                onSentenceClick(i);
                // We'd need a one-time "onplay" seek to be truly accurate, 
                // but jump-to-sentence is a good start.
            }
            return;
        }
        sum += d;
    }
}

let chunkDurations = [];
let estimatedDuration = 0;
let totalDuration = 0;

function formatDuration(seconds) {
    if (!seconds || seconds < 0) return "0s";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/**
 * Get accurate or estimated duration for a chunk.
 */
function getChunkDuration(i, totalTime) {
    if (chunkDurations[i] && chunkDurations[i] > 0) return chunkDurations[i];

    const activeSentences = sentences.filter(s => s !== PARAGRAPH_DELIMITER);
    const count = activeSentences.length;
    if (count === 0) return 0;

    // Use character counts for a better proportional estimate than equal split
    const charCounts = activeSentences.map(s => s.length);
    const totalChars = charCounts.reduce((a, b) => a + b, 0);

    if (totalChars > 0 && totalTime > 0) {
        return (charCounts[i] / totalChars) * totalTime;
    }
    return totalTime / count;
}

function updateDurationDisplay() {
    const playerCurrent = document.getElementById("player-time-current");
    const playerTotal = document.getElementById("player-time-total");
    const playerRemaining = document.getElementById("player-time-remaining");
    const seekBar = document.getElementById("global-seek-bar");
    if (!playerCurrent || !playerTotal) return;

    let displaySeconds = (totalDuration > 0 && globalDone >= totalLogicalSentences) ? totalDuration : estimatedDuration;

    // Get current speed multiplier
    const speedInput = document.getElementById("playback-speed");
    let speed = 1.0;
    if (speedInput) {
        speed = parseFloat(speedInput.value) || 1.0;
    }

    let playedSeconds = 0;
    const currentIdx = currentIndex !== null ? currentIndex : 0;

    for (let i = 0; i < currentIdx; i++) {
        playedSeconds += getChunkDuration(i, displaySeconds);
    }

    if (audio && currentIndex !== null) {
        playedSeconds += audio.currentTime;
    }

    // Update labels (adjusted for speed)
    playerTotal.textContent = formatDuration(displaySeconds / speed);
    playerCurrent.textContent = formatDuration(playedSeconds / speed);

    if (playerRemaining) {
        const remaining = Math.max(0, displaySeconds - playedSeconds);
        playerRemaining.textContent = `-${formatDuration(remaining / speed)}`;
    }

    // Update seek bar (raw seconds for max and value)
    if (seekBar) {
        seekBar.max = displaySeconds;
        seekBar.value = playedSeconds;
    }

    // Update Segment Styles
    updateSegmentStyles();
}

function renderSegments() {
    const container = document.getElementById("segments-container");
    const seekBar = document.getElementById("global-seek-bar");
    if (!container || !seekBar) return;

    // Only sentences, no paragraph delimiters
    const activeSentences = sentences.filter(s => s !== PARAGRAPH_DELIMITER);
    const count = activeSentences.length;
    if (count === 0) return;

    const displaySecs = parseFloat(seekBar.max || 0);

    container.innerHTML = "";

    activeSentences.forEach((s, i) => {
        const seg = document.createElement("div");
        seg.className = "segment pending";
        seg.dataset.index = i;

        // Calculate proportional weights based on durations if available, 
        // otherwise use the same equal-split fallback as the hover logic.
        const dur = getChunkDuration(i, displaySecs);
        const widthPct = (displaySecs > 0) ? (dur / displaySecs) * 100 : (100 / count);

        seg.style.width = `calc(${widthPct}% - 2px)`;
        container.appendChild(seg);
    });
}

/**
 * Setup hover and mouse interaction for the seek bar once.
 */
function setupSeekBarInteractions() {
    const seekBar = document.getElementById("global-seek-bar");
    const previewArea = document.getElementById("seek-preview-area");
    const container = document.getElementById("segments-container");

    if (!seekBar || !previewArea || !container) return;

    // Remove existing if any (to be safe if called multiple times, though setupControls should call once)
    const onMouseMove = (e) => {
        const activeSentences = sentences.filter(s => s !== PARAGRAPH_DELIMITER);
        if (activeSentences.length === 0) return;

        const rect = seekBar.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        const displaySecs = parseFloat(seekBar.max || 0);
        const targetTime = pct * displaySecs;

        // Find which sentence this is
        let sum = 0;
        let foundIdx = -1;

        for (let i = 0; i < activeSentences.length; i++) {
            const dur = getChunkDuration(i, displaySecs);
            if (sum + dur > targetTime) {
                foundIdx = i;
                break;
            }
            sum += dur;
        }

        const segs = container.querySelectorAll(".segment");
        if (foundIdx !== -1) {
            const text = activeSentences[foundIdx];
            previewArea.textContent = text.trim();
            previewArea.classList.add("visible");

            // Update segment hover highlighting
            segs.forEach((seg, sIdx) => {
                seg.classList.toggle("hover-manual", sIdx === foundIdx);
            });
        } else {
            segs.forEach(seg => seg.classList.remove("hover-manual"));
        }
    };

    const onMouseLeave = () => {
        previewArea.classList.remove("visible");
        const segs = container.querySelectorAll(".segment");
        segs.forEach(seg => seg.classList.remove("hover-manual"));
    };

    seekBar.addEventListener("mousemove", onMouseMove);
    seekBar.addEventListener("mouseleave", onMouseLeave);
}

function updateSegmentStyles() {
    const container = document.getElementById("segments-container");
    if (!container) return;

    const segs = container.querySelectorAll(".segment");
    segs.forEach(el => {
        const idx = parseInt(el.dataset.index, 10);
        el.classList.remove("pending", "converting", "ready", "playing", "played");

        // Use same logic as sentence styles
        if (audio && currentIndex === idx && !audio.paused) {
            el.classList.add("playing");
            return;
        }

        if (idx <= playedUntil) {
            el.classList.add("played");
            return;
        }

        if (sentenceAudioUrls[idx]) {
            el.classList.add("ready");
            return;
        }

        if (idx === globalDone && idx < totalLogicalSentences) {
            el.classList.add("converting");
            return;
        }

        el.classList.add("pending");
    });
}


async function pollStatus() {
    if (!JOB_ID || MODE !== 'view') return;

    const metaStatus = document.getElementById("meta-status-text");
    const metaProgress = document.getElementById("meta-progress-text");
    const metaDlLink = document.getElementById("meta-download-link");
    const resultDiv = document.getElementById("result");

    try {
        const res = await fetch(`/status/${JOB_ID}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.error) {
            if (metaStatus) metaStatus.textContent = "Error";
            resultDiv.style.display = "block";
            resultDiv.innerHTML = `<h2>Job error</h2><p>${data.error}</p>`;
            return;
        }

        const total = data.total || 0;
        globalDone = data.done || 0;
        const pct = Math.round((data.progress || 0) * 100);

        estimatedDuration = data.estimated_duration || 0;
        totalDuration = data.total_duration || 0;

        if (Array.isArray(data.chunk_durations)) {
            chunkDurations = data.chunk_durations;
        }

        // Update Top Metadata
        if (metaStatus) metaStatus.textContent = data.status;
        if (metaProgress) metaProgress.textContent = `${data.done} / ${total} (${pct}%)`;
        const metaProvider = document.getElementById("meta-provider-text");
        if (metaProvider) metaProvider.textContent = data.provider;

        // Duration Display update (also called on timeupdate)
        updateDurationDisplay();

        // Always attempt to render segments if they aren't there or if durations updated
        const container = document.getElementById("segments-container");
        if (container) {
            const activeSentences = sentences.filter(s => s !== PARAGRAPH_DELIMITER);
            // Re-render if count mismatch or state is active or if we just finished
            if (container.children.length !== activeSentences.length ||
                data.status === 'converting' ||
                data.status === 'processing' ||
                data.status === 'done') {
                renderSegments();
            }
        }

        // Update Sidebar
        // Find the active link
        const sidebarLink = document.querySelector(`.conversion-link.active`);
        if (sidebarLink) {
            // Update status text
            const statusText = sidebarLink.querySelector(".conv-status-text");
            if (statusText) {
                if (data.status === 'done') {
                    statusText.innerHTML = "";
                } else {
                    statusText.innerHTML = `<span class="status-indicator legend-dot ${data.status}"></span> ${data.status} (${data.done}/${total})`;
                }
            }

            // Add/Update Class for color
            sidebarLink.classList.remove("conv-item-queued", "conv-item-processing", "conv-item-done", "conv-item-converting");
            // Mapping status to class. If status is 'converting', use 'conv-item-converting'
            sidebarLink.classList.add(`conv-item-${data.status}`);

            // Update Progress Bar
            let progBar = sidebarLink.querySelector(".sidebar-progress-bar");
            if (!progBar && data.status !== 'done') {
                progBar = document.createElement("div");
                progBar.className = "sidebar-progress-bar";
                const inner = document.createElement("div");
                inner.className = "sidebar-progress-inner";
                progBar.appendChild(inner);
                sidebarLink.appendChild(progBar);
            }

            if (progBar) {
                const inner = progBar.querySelector(".sidebar-progress-inner");
                if (inner) inner.style.width = pct + "%";
                if (data.status === 'done' || pct >= 100) {
                    progBar.remove();
                }
            }
        }

        // update URLs for ready chunks
        if (Array.isArray(data.chunk_urls)) {
            data.chunk_urls.forEach((url, idx) => {
                if (url) sentenceAudioUrls[idx] = url;
            });
        }

        updateSentenceStyles(total);
        updateControls();

        // Play next if waiting
        if (waitingForNext && currentIndex != null &&
            currentIndex < totalLogicalSentences &&
            sentenceAudioUrls[currentIndex]) {
            playFromIndex(currentIndex);
        }

        if (data.status === "done") {
            if (metaDlLink) {
                if (metaDlLink.getAttribute('href') === "#" || metaDlLink.style.display === "none") {
                    // Trigger generation to get path
                    fetch(`/generate_full/${JOB_ID}`, { method: 'POST' })
                        .then(r => r.json())
                        .then(d => {
                            if (d.audio_url) {
                                metaDlLink.href = d.audio_url;
                                metaDlLink.style.display = "inline-block"; // or block
                            }
                        });
                }
            }
        } else if (data.status === "error") {
            // handled above
        } else {
            setTimeout(pollStatus, 1000);
        }
    } catch (e) {
        console.error(e);
    }
}

function init() {
    // Poll sidebar on all pages
    pollSidebar();

    if (MODE !== 'view' || !JOB_ID || !FULL_TEXT) return;

    // sentences-container is always visible
    sentences = splitSentences(FULL_TEXT);
    totalLogicalSentences = sentences.filter(s => s !== PARAGRAPH_DELIMITER).length;
    renderSentences();
    renderSegments();

    // Restore played state
    if (typeof LAST_PLAYED_INDEX !== 'undefined' && LAST_PLAYED_INDEX >= 0) {
        playedUntil = LAST_PLAYED_INDEX;
        // Resume logic: pick up at last read sentence needed
        // Since LAST_PLAYED_INDEX is the one *played*, we start at +1
        const nextMeta = LAST_PLAYED_INDEX + 1;
        if (nextMeta < totalLogicalSentences) {
            currentIndex = nextMeta;
        } else {
            // Finished? Reset to 0 or leave at end
            currentIndex = 0;
        }
    }

    updateSentenceStyles(totalLogicalSentences);
    setupControls();

    pollStatus();
}

async function pollSidebar() {
    try {
        const res = await fetch("/api/jobs/status");
        if (res.ok) {
            const data = await res.json();
            const activeIds = new Set();
            data.jobs.forEach(job => {
                activeIds.add(job.id);
                updateSidebarItem(job);
            });

            document.querySelectorAll(".sidebar-progress-bar").forEach(bar => {
                const link = bar.closest(".conversion-link");
                if (link && link.id) {
                    const id = link.id.replace("conv-", "");
                    if (!activeIds.has(id)) {
                        bar.remove();
                        // Also update status dot to done (remove it)
                        const statusText = link.querySelector(".conv-status-text");
                        // If it disappeared from active list it means it's done or deleted.
                        // Clean status text if it was processing
                        if (statusText && statusText.textContent.toUpperCase().includes("PROCESSING")) {
                            statusText.textContent = "";
                        }
                        link.classList.remove("conv-item-queued", "conv-item-processing", "conv-item-converting");
                        link.classList.add("conv-item-done");
                    }
                }
            });
        }
    } catch (e) {
        console.error("Sidebar poll error", e);
    }

    setTimeout(pollSidebar, 2000); // 2s polling
}

function updateSidebarItem(job) {
    const link = document.getElementById(`conv-${job.id}`);
    if (!link) return;

    // Check if fully played
    const fullyPlayed = (job.total > 0 && job.last_played_index >= job.total - 1);

    // Update status text
    const statusText = link.querySelector(".conv-status-text");
    if (statusText) {
        if (fullyPlayed) {
            const durText = formatDuration(job.total_duration);
            statusText.innerHTML = `<span class="conv-item-completed">✔ Completed</span> <span class="conv-item-duration">(${durText})</span>`;
        } else if (job.status === 'done') {
            // Show remaining time ONLY
            // "right after a conversion completed... remaining time is not shown"
            // Typically last_played_index is default -1 or some value.
            let lastIdx = (typeof job.last_played_index !== 'undefined') ? job.last_played_index : -1;

            // Chunks played count: lastIdx + 1 (since 0-based index)
            let playedCount = lastIdx + 1;
            let chunksLeft = Math.max(0, job.total - playedCount);

            let avg = (job.total > 0 && job.total_duration > 0) ? (job.total_duration / job.total) : 0;
            let rem = chunksLeft * avg;

            // If rem is 0 (but not fully played?), maybe total duration unknown or very short?
            if (rem < 0) rem = 0;

            // If just finished, playedCount=0, chunksLeft=total, rem=total_duration. Correct.

            statusText.innerHTML = `<span class="conv-item-duration">-${formatDuration(rem)}</span>`;
        } else {
            // Processing / Queued
            statusText.innerHTML = `<span class="status-indicator legend-dot ${job.status}"></span>${job.status} (${job.processed}/${job.total})`;
        }
    }

    // Update classes
    link.classList.remove("conv-item-queued", "conv-item-processing", "conv-item-done", "conv-item-converting");
    link.classList.add(`conv-item-${job.status}`);

    // Recalc playPct for bars
    let playPct = 0;
    if (job.total > 0 && job.last_played_index >= -1) {
        playPct = ((job.last_played_index + 1) / job.total) * 100;
        if (playPct > 100) playPct = 100;
    }

    // Progress Bars
    // Container: .sidebar-progress-bar
    let progBar = link.querySelector(".sidebar-progress-bar");

    // Conditions to show bars:
    // Conv Bar: show if status != 'done'
    // Play Bar: show if status == 'done' (or playable) AND playPct > 0 AND !fullyPlayed

    // BUT user said: "only show the pink conversion progress bar while conversion is acitive, once converstion is complete, hide"
    // AND "same goes for the playback bar" (hide if complete)
    // So if BOTH are complete/hidden, remove container.

    // Conv bar is ONLY for active conversion.
    const showConv = (job.status !== 'done');
    // Play bar is ONLY for active playback (partially played).
    const showPlay = (!fullyPlayed && playPct > 0);

    if (!showConv && !showPlay) {
        if (progBar) progBar.remove();
        // Return or continue? We already updated status.
        return;
    }

    // Create container if needed
    if (!progBar) {
        progBar = document.createElement("div");
        progBar.className = "sidebar-progress-bar";
        link.appendChild(progBar);
    }
    progBar.style.display = 'block';

    // 1. Conversion Bar (Pink)
    let convBar = progBar.querySelector(".bar-conversion");
    if (showConv) {
        if (!convBar) {
            convBar = document.createElement("div");
            convBar.className = "bar-conversion";
            Object.assign(convBar.style, {
                position: "absolute",
                top: "0",
                left: "0",
                height: "100%",
                background: "linear-gradient(135deg, #a855f7, #ec4899)", // Original pink gradient
                zIndex: "1",
                transition: "width 0.3s ease"
            });
            progBar.appendChild(convBar);
        }
        // If status done, pct is 100, but showConv would be false. 
        // So here status is NOT done.
        const convPct = (job.progress * 100).toFixed(1);
        convBar.style.width = convPct + "%";
    } else {
        if (convBar) convBar.remove();
    }

    // 2. Playback Bar (Gradient)
    let playBar = progBar.querySelector(".bar-playback");
    if (showPlay) {
        if (!playBar) {
            playBar = document.createElement("div");
            playBar.className = "bar-playback";
            Object.assign(playBar.style, {
                position: "absolute",
                top: "0",
                left: "0",
                height: "100%",
                background: "linear-gradient(135deg, #6366f1, #22c55e)", // Blue-Green gradient
                zIndex: "2",
                transition: "width 0.3s ease"
            });
            progBar.appendChild(playBar);
        }
        playBar.style.width = playPct + "%";
    } else {
        if (playBar) playBar.remove();
    }
}

/* Sidebar Menu Logic */
function toggleMenu(event, id) {
    event.preventDefault();
    event.stopPropagation();

    // Close other menus
    document.querySelectorAll('.sidebar-menu.show').forEach(el => {
        if (el.id !== `menu-${id}`) {
            el.classList.remove('show');
        }
    });

    const menu = document.getElementById(`menu-${id}`);
    if (menu) {
        menu.classList.toggle('show');
    }
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.sidebar-menu') && !e.target.closest('.sidebar-menu-btn')) {
        document.querySelectorAll('.sidebar-menu.show').forEach(el => {
            el.classList.remove('show');
        });
    }
});

function renameConversion(event, id, currentTitle) {
    event.stopPropagation();
    // Close menu immediately so it doesn't stay open while prompting
    toggleMenu(event, id);

    const newTitle = prompt("Enter new title:", currentTitle);
    if (!newTitle || newTitle === currentTitle) return;

    fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversion_id: id, title: newTitle })
    }).then(res => res.json())
        .then(data => {
            if (data.status === 'ok') {
                location.reload();
            } else {
                alert("Error renaming: " + (data.error || "Unknown"));
            }
        });
}

function deleteConversion(event, id) {
    event.preventDefault();
    event.stopPropagation();

    if (!confirm("Are you sure you want to delete this conversion? This cannot be undone.")) return;

    fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversion_id: id })
    }).then(res => res.json())
        .then(data => {
            if (data.status === 'ok') {
                if (window.location.href.includes(id)) {
                    window.location.href = "/";
                } else {
                    location.reload();
                }
            } else {
                alert("Error deleting: " + (data.error || "Unknown"));
            }
        });
}

/* Inline Title Editing */
function enableTitleEdit(event, id) {
    const heading = event.target;
    // Prevent double clicking / race if already input
    if (heading.tagName === 'INPUT') return;

    const currentTitle = heading.textContent;

    const input = document.createElement("input");
    input.type = "text";
    input.value = currentTitle;
    input.style.fontSize = "1.25rem";
    input.style.color = "#e2e8f0"; // Brighter for input
    input.style.background = "#1e293b";
    input.style.border = "1px solid #475569";
    input.style.borderRadius = "4px";
    input.style.padding = "0.2rem 0.5rem";
    input.style.width = "100%";
    input.style.fontWeight = "bold";
    input.style.fontFamily = "inherit";
    input.style.marginBottom = "0.5rem"; // Match h2 somewhat

    // Replace heading with input
    heading.replaceWith(input);
    input.focus();

    // Handler for saving
    function save() {
        const newTitle = input.value.trim();
        if (!newTitle || newTitle === currentTitle) {
            // Revert
            input.replaceWith(heading);
            return;
        }

        // Optimistic update
        heading.textContent = newTitle;
        input.replaceWith(heading);

        fetch('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversion_id: id, title: newTitle })
        }).then(res => res.json())
            .then(data => {
                if (data.status !== 'ok') {
                    heading.textContent = currentTitle; // Revert on error
                    alert("Error renaming: " + (data.error || "Unknown"));
                } else {
                    // Update sidebar if visible
                    const activeLink = document.querySelector('.conversion-link.active .conv-title');
                    if (activeLink) {
                        activeLink.textContent = newTitle;
                    }
                }
            });
    }

    input.addEventListener("blur", save);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            input.blur(); // Triggers save
        }
        if (e.key === "Escape") {
            input.value = currentTitle; // Revert value
            input.blur();
        }
    });
}

document.addEventListener("DOMContentLoaded", init);
