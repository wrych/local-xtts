import os
import re
import threading
from datetime import datetime

import numpy as np
import soundfile as sf
import librosa

from config import TARGET_SAMPLE_RATE
import db
from providers import LocalTTSProvider, GoogleTTSProvider

class ProviderRegistry:
    def __init__(self):
        self._providers = {
            "local": LocalTTSProvider(),
            "google": GoogleTTSProvider()
        }

    def get_provider(self, provider_id: str) -> any:
        return self._providers.get(provider_id)

    def list_providers(self) -> list[dict]:
        return [
            {"id": "local", "name": "Local (XTTS)"},
            {"id": "google", "name": "Google Cloud"}
        ]

REGISTRY = ProviderRegistry()


def split_into_chunks(text: str):
    """
    Split text into one sentence per chunk, respecting paragraphs.
    Logic must match frontend `splitSentences` to align indices.
    """
    if not text:
        return []

    # 1. Split by double newlines (paragraphs)
    paragraphs = re.split(r"\n\s*\n", text)
    
    all_chunks = []
    
    for para in paragraphs:
        # Normalize whitespace in paragraph
        clean_para = re.sub(r"\s+", " ", para).strip()
        if not clean_para:
            continue
            
        # Split by . ? !
        sentences = re.split(r"(?<=[.!?])\s+", clean_para)
        for s in sentences:
            if s.strip():
                all_chunks.append(s.strip())

    return all_chunks


def _normalize_wav(input_path: str, target_sr: int = TARGET_SAMPLE_RATE):
    """Load audio, resample, mono, float32."""
    audio, sr = librosa.load(input_path, sr=None, mono=True)
    if sr != target_sr:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
        sr = target_sr
    return audio.astype(np.float32), sr


def _concat_wavs(input_files, output_file: str, target_sr: int = TARGET_SAMPLE_RATE):
    """Normalize all WAV chunks before concatenation."""
    if not input_files:
        raise ValueError("No input files for concatenation")

    final_audio = []

    for path in input_files:
        audio, _ = _normalize_wav(path, target_sr=target_sr)
        final_audio.append(audio)

    final_audio = np.concatenate(final_audio, axis=-1)
    sf.write(output_file, final_audio, target_sr, subtype="PCM_16")


# Job Queue
JOB_QUEUE = None

def _init_queue():
    global JOB_QUEUE
    if JOB_QUEUE is None:
        import queue
        JOB_QUEUE = queue.Queue()
        # Start worker thread
        thread = threading.Thread(target=_job_worker, daemon=True)
        thread.start()

def start_job(
    title: str,
    text: str,
    speaker: str,
    language: str,
    provider: str,
    use_cuda: bool,
    static_folder: str,
) -> str:
    """
    Create a job, add to queue, return conversion_id.
    """
    _init_queue()

    chunks_text = split_into_chunks(text)
    
    # Calculate estimated duration
    # Avg reading speed ~ 150 words per minute => 2.5 words per second
    words = len(text.split())
    estimated_seconds = words / 2.5
    
    # Create DB entry
    conversion_id = db.create_conversion(title, text, chunks_text, speaker=speaker, language=language, provider=provider, estimated_duration=estimated_seconds)
    
    rel_job_dir = f"jobs/{conversion_id}"
    job_dir = os.path.join(static_folder, rel_job_dir)
    os.makedirs(job_dir, exist_ok=True)

    # Add to queue
    job_data = {
        "conversion_id": conversion_id,
        "chunks_text": chunks_text,
        "speaker": speaker,
        "language": language,
        "provider": provider,
        "use_cuda": use_cuda,
        "job_dir": job_dir,
        "rel_job_dir": rel_job_dir
    }
    JOB_QUEUE.put(job_data)

    return conversion_id

def _job_worker():
    """Consumes jobs from the queue sequentially."""
    while True:
        job = JOB_QUEUE.get()
        try:
            _process_job(job)
        except Exception as e:
            print(f"[ERROR] Worker exception: {e}")
        finally:
            JOB_QUEUE.task_done()

def _process_job(job):
    """Generate each sentence for the job."""
    conversion_id = job["conversion_id"]
    chunks_text = job["chunks_text"]
    speaker = job["speaker"]
    language = job["language"]
    provider_id = job["provider"]
    use_cuda = job["use_cuda"]
    job_dir = job["job_dir"]
    rel_job_dir = job["rel_job_dir"]

    # Mark conversion as processing (if not already handled by logic elsewhere, 
    # but strictly speaking it might have been 'queued' for a while)
    # The current db logic defaults to 'queued'.
    # We should update it to 'processing' now.
    # Note: db.py updates status implicitly when chunks are updated? 
    # db.update_chunk_status updates the whole conversion status if all done.
    # But strictly, we should set it to processing at start if we want correct UI status.
    # However, existing logic didn't do this explicitly at start, it relied on implicit or stayed queued?
    # Let's add an explicit update to processing.
    # We need a db function for that or just update one chunk.
    # Let's stick to existing flow to minimize side effects, 
    # update_chunk_status(..., 'processing') below handles individual chunks.
    # Ideally should update conversion status too.
    
    try:
        provider = REGISTRY.get_provider(provider_id)
        if not provider:
            raise ValueError(f"Provider {provider_id} not found")

        total = len(chunks_text)
        if total == 0:
            return

        for idx, chunk_text in enumerate(chunks_text):
            db.update_chunk_status(conversion_id, idx, 'processing')
            
            filename = f"part_{idx}.wav"
            part_path = os.path.join(job_dir, filename)
            
            try:
                provider.synthesize(
                    text=chunk_text,
                    output_path=part_path,
                    voice=speaker,
                    language=language,
                    use_cuda=use_cuda
                )
                
                # Calculate duration
                # Use soundfile used in _concat_wavs or just open
                info = sf.info(part_path)
                duration = info.duration

                # Success
                rel_path = f"{rel_job_dir}/{filename}"
                db.update_chunk_status(conversion_id, idx, 'done', audio_filename=rel_path, duration=duration)
                
            except Exception as e:
                print(f"Error processing chunk {idx}: {e}")
                db.update_chunk_status(conversion_id, idx, 'error')

    except Exception as e:
        print(f"Job failed: {e}")
        pass


def generate_full_audio(conversion_id: str, static_folder: str):
    """
    On-demand full audio generation.
    Returns relative URL to the full file.
    """
    data = db.get_conversion_with_chunks(conversion_id)
    if not data:
        raise ValueError("Conversion not found")

    chunks = data['chunks']
    if not chunks:
        raise ValueError("No chunks found")

    # Format: YYYY-MM-DD_{title}.wav
    created_at = data.get("created_at", "")
    if not created_at:
        date_str = datetime.now().strftime("%Y-%m-%d")
    else:
        # created_at is likely "YYYY-MM-DD HH:MM:SS" string from SQLite
        date_str = str(created_at)[:10]

    title = data.get("title", f"conversion_{conversion_id}")
    # Sanitize title
    safe_title = re.sub(r'[^a-zA-Z0-9_\-]', '_', title)
    safe_title = re.sub(r'_+', '_', safe_title).strip('_')

    job_dir = os.path.join(static_folder, f"jobs/{conversion_id}")
    output_filename = f"{date_str}_{safe_title}.wav"
    final_path = os.path.join(job_dir, output_filename)

    # Check if already exists
    if os.path.exists(final_path):
        return f"jobs/{conversion_id}/{output_filename}"

    part_files = []
    for c in chunks:
        if c['status'] != 'done' or not c['audio_filename']:
             raise ValueError(f"Chunk {c['seq_num']} is not ready")
        
        # db stores relative path like "jobs/uuid/part_0.wav"
        # we need absolute for processing
        abs_path = os.path.join(static_folder, "..", c['audio_filename']) 
        # Wait, if audio_filename is "jobs/...", and we are in "static", it should be static_folder + audio_filename?
        # Verify how we stored it.
        # Stored as: f"{rel_job_dir}/{filename}" -> "jobs/{id}/part_{idx}.wav"
        # So absolute path is static_folder + "/" + stored_path (usually) or simply join.
        # But static_folder passed to start_job was `app.static_folder`.
        
        # Let's be safe: content of audio_filename is relative to static root.
        p = os.path.join(static_folder, c['audio_filename'].replace("jobs/", "", 1)) 
        # Wait, "jobs/..." is inside static.
        # If static_folder is "C:/.../static", and filename is "jobs/123/part.wav"
        # os.path.join("C:/.../static", "jobs/123/part.wav") works.
        
        # Actually let's just assume `audio_filename` is relative to static root.
        # But in _process, we constructed `rel_job_dir` as "jobs/{id}". 
        # And `job_dir` as `join(static_folder, rel_job_dir)`.
        # So `audio_filename` in DB is `jobs/{id}/part.wav`.
        # `static_folder` is `.../static`.
        # `join(static_folder, audio_filename)` is correct.
        
        p = os.path.join(static_folder, c['audio_filename'])
        if not os.path.exists(p):
             # Try simpler path if double nested? No rely on logic.
             raise ValueError(f"Missing file for chunk {c['seq_num']}")
        part_files.append(p)

    _concat_wavs(part_files, final_path)
    return f"jobs/{conversion_id}/{output_filename}"
