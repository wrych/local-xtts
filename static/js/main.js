// static/js/main.js
let sentences = [];
let sentenceAudioUrls = [];
let globalDone = 0;      // how many chunks are generated (from backend)
let audio = null;
let currentIndex = null; // index currently playing (or to be played)
let playedUntil = -1;    // highest index fully played
let waitingForNext = false;
let totalLogicalSentences = 0;

// Config from backend
// JOB_ID, FULL_TEXT, LAST_PLAYED_INDEX, MODE are defined in index.html

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
    if (audio && !audio.paused && currentIndex !== null) {
        // const el = container.querySelector(`.sentence[data-index="${currentIndex}"]`);
        // if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

function ensureAudio() {
    if (!audio) {
        audio = new Audio();
        audio.addEventListener("ended", onAudioEnded);
        audio.addEventListener("play", () => {
            updateSentenceStyles(totalLogicalSentences);
            updateControls();
        });
        audio.addEventListener("pause", () => {
            updateSentenceStyles(totalLogicalSentences);
            updateControls();
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
    if (!btn) return;

    // enable play/pause if we have sentences to play (even if not ready yet, for buffering)
    const canPlay = totalLogicalSentences > 0;
    btn.disabled = !canPlay;

    if (waitingForNext) {
        btn.textContent = "Buffering";
        btn.classList.add("buffering");
    } else if (audio && !audio.paused) {
        btn.textContent = "Pause";
        btn.classList.remove("buffering");
    } else {
        btn.textContent = "Play";
        btn.classList.remove("buffering");
    }
}

function setupControls() {
    const btn = document.getElementById("btn-play-pause");
    const speed = document.getElementById("playback-speed");

    if (btn) {
        btn.addEventListener("click", () => {
            ensureAudio();
            if (!audio.paused) {
                audio.pause();
                return;
            }

            // Start playing

            // if nothing selected, start from current index or 0
            if (currentIndex == null) currentIndex = 0;
            // if we finished, restart
            if (currentIndex >= totalLogicalSentences) currentIndex = 0;

            if (sentenceAudioUrls[currentIndex]) {
                playFromIndex(currentIndex);
            } else {
                // Buffer
                waitingForNext = true;
                updateControls();
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
        };

        speed.addEventListener("change", updateSpeed);
        speed.addEventListener("input", updateSpeed);
    }
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

        // Update Top Metadata
        if (metaStatus) metaStatus.textContent = data.status;
        if (metaProgress) metaProgress.textContent = `${data.done} / ${total} (${pct}%)`;

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
                    // Optionally remove or keep full? 
                    // User said "remove bottom bar", but sidebar one logic "show ... under entry" implies persistent or during processing.
                    // Usually progress bars disappear when done or turn green.
                    // The requirement: "show the progress bar under the entry... and up to date status information"
                    // Let's keep it visible if it's there, maybe fade it out or just leave it full.
                    // Actually, if it's done, the status text says "Done".
                    // Let's hide it if done to clean up, or keep it full green. 
                    // I will remove it if done to look cleaner.
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
                // We need to know the download URL. 
                // The backend status/ returns `chunk_urls` but not `full_audio_url` explicitly unless we added it.
                // But we can trigger generation if needed. 
                // Let's check `generate_full` endpoint.
                // We can just set the href to a generated path if we know it, or call generate API once.

                // Hack: Call generate_full once to get the link if we don't have it.
                // Or updates status endpoint to return it.
                // For now, let's call generate_full logic if link is empty.
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
    if (MODE !== 'view' || !JOB_ID || !FULL_TEXT) return;

    // sentences-container is always visible
    sentences = splitSentences(FULL_TEXT);
    totalLogicalSentences = sentences.filter(s => s !== PARAGRAPH_DELIMITER).length;
    renderSentences();

    // Restore played state
    if (typeof LAST_PLAYED_INDEX !== 'undefined' && LAST_PLAYED_INDEX >= 0) {
        playedUntil = LAST_PLAYED_INDEX;
    }

    updateSentenceStyles(totalLogicalSentences);
    setupControls();
    updateSentenceStyles(totalLogicalSentences);
    setupControls();
    pollStatus();
    pollSidebar();
}

async function pollSidebar() {
    try {
        const res = await fetch("/api/jobs/status");
        if (res.ok) {
            const data = await res.json();
            // data.jobs is array of {id, status, progress, processed, total}

            // 1. Update active jobs provided by backend
            const activeIds = new Set();
            data.jobs.forEach(job => {
                activeIds.add(job.id);
                updateSidebarItem(job);
            });

            // 2. Ideally we might want to clean up bars for jobs that are active in UI but not in returned list (meaning they finished or failed).
            // But the backend only returns "active" (queued, processing). 
            // So if a job was processing and is now done, it won't be in the list.
            // We should check all sidebar items with progress bars. If their ID is not in activeIds, remove the bar/update status?
            // Actually, we can rely on specific "done" checks, or just let them be.
            // If they are done, we might want to refresh simply or just remove the bar.

            document.querySelectorAll(".sidebar-progress-bar").forEach(bar => {
                const link = bar.closest(".conversion-link");
                if (link && link.id) {
                    const id = link.id.replace("conv-", "");
                    if (!activeIds.has(id)) {
                        // Job is no longer active (completed or deleted or error)
                        // Verify if it is actually done?
                        // We don't have new status here.
                        // We can just query /status/id for that specific one? Too many requests.
                        // Or we can assume if it disappeared from /api/jobs/status, it's done (if we trust the endpoint filter).
                        // Let's remove the bar if it's not in active list.
                        bar.remove();

                        // Also update status dot to done (remove it)
                        const statusText = link.querySelector(".conv-status-text");
                        if (statusText) statusText.innerHTML = "";
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

    // Update status text
    const statusText = link.querySelector(".conv-status-text");
    if (statusText) {
        // Only update if changed or simply overwrite
        statusText.innerHTML = `<span class="status-indicator legend-dot ${job.status}"></span>${job.status} (${job.processed}/${job.total})`;
    }

    // Update classes
    link.classList.remove("conv-item-queued", "conv-item-processing", "conv-item-done", "conv-item-converting");
    link.classList.add(`conv-item-${job.status}`);

    // Update Progress Bar
    let progBar = link.querySelector(".sidebar-progress-bar");
    const pct = (job.progress * 100).toFixed(1);

    if (!progBar) {
        if (job.status !== 'done') {
            progBar = document.createElement("div");
            progBar.className = "sidebar-progress-bar";
            const inner = document.createElement("div");
            inner.className = "sidebar-progress-inner";
            progBar.appendChild(inner);
            link.appendChild(progBar);
        }
    }

    if (progBar) {
        const inner = progBar.querySelector(".sidebar-progress-inner");
        if (inner) inner.style.width = pct + "%";
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
