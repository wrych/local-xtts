# app.py

import os
import re
from datetime import datetime

from flask import Flask, request, render_template, jsonify, url_for, redirect

from config import SPEAKERS, LANGUAGES
from tts_service import start_job, generate_full_audio
import db

app = Flask(__name__, static_folder="static", template_folder="templates")

# Initialize DB
db.init_db()

@app.route("/", methods=["GET", "POST"])
def index():
    # Sidebar data
    conversions = db.get_all_conversions()
    
    if request.method == "POST":
        text = request.form.get("text", "")
        title = request.form.get("title", "New Conversion")
        speaker = request.form.get("speaker", SPEAKERS[0])
        language = request.form.get("language", "en")
        use_cuda = request.form.get("use_cuda") == "on"
        
        if text.strip():
            static_folder = app.static_folder
            conversion_id = start_job(
                title=title,
                text=text,
                speaker=speaker,
                language=language,
                use_cuda=use_cuda,
                static_folder=static_folder,
            )
            return redirect(url_for("conversion", conversion_id=conversion_id))
        else:
            return render_template("index.html", error="Text is empty", conversions=conversions, speakers=SPEAKERS, languages=LANGUAGES)

    # Show "New Conversion" page
    return render_template(
        "index.html",
        mode="new",
        conversions=conversions,
        speakers=SPEAKERS,
        languages=LANGUAGES,
        # Defaults
        speaker=SPEAKERS[0],
        language="en",
        use_cuda=True,
        title=f"Conversion {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    )

@app.route("/conversion/<conversion_id>")
def conversion(conversion_id):
    conversions = db.get_all_conversions()
    data = db.get_conversion_with_chunks(conversion_id)
    
    if not data:
        return redirect(url_for("index"))
    
    return render_template(
        "index.html",
        mode="view",
        conversions=conversions,
        conversion=data,
        job_id=conversion_id, # For JS compatibility
        text=data["text"],
        title=data["title"],
        last_played_index=data["last_played_index"]
    )

@app.route("/status/<conversion_id>", methods=["GET"])
def status(conversion_id):
    data = db.get_conversion_with_chunks(conversion_id)
    if not data:
        return jsonify({"error": "Unknown job ID"}), 404

    chunks = data["chunks"]
    total = len(chunks)
    
    # Calculate progress based on 'done' chunks
    done_count = sum(1 for c in chunks if c["status"] == "done")
    progress = (done_count / total) if total else 0.0
    
    # Construct chunk URLs
    chunk_urls = []
    # We need to map seq_num to url. Chunks are ordered by seq_num in `get_conversion_with_chunks`.
    # But list index might not match seq_num if gaps? (Unlikely with creating logic).
    # Safe to assuming list index i maps to seq_num i.
    
    # We need to return a sparse list or full list where pending are null?
    # Frontend triggers `playFromIndex`. If `sentenceAudioUrls[idx]` is set, it plays.
    
    chunk_urls_map = {}
    for c in chunks:
        if c["status"] == "done" and c["audio_filename"]:
            chunk_urls_map[c["seq_num"]] = url_for("static", filename=c["audio_filename"])
            
    # Convert map to list if frontend expects list (it does `data.chunk_urls.forEach((url, idx)`)
    # We must ensure list covers up to max index.
    max_idx = total - 1
    url_list = [None] * total
    for seq, url in chunk_urls_map.items():
        if seq < total:
            url_list[seq] = url
            
    # Check full audio
    audio_url = None
    # If we had a specific field for full audio in DB, we'd use it. 
    # Current DB logic doesn't store 'full_audio_path' in conversions table explicitly?
    # We can check if `full_{id}.wav` exists or generate it on demand.
    # For now, client calls `/generate_full`.
    
    return jsonify({
        "status": data["status"],
        "total": total,
        "done": done_count,
        "progress": progress,
        "chunk_urls": url_list,
        # "saved_filename": ... 
    })

@app.route("/generate_full/<conversion_id>", methods=["POST"])
def generate_full(conversion_id):
    try:
        static_folder = app.static_folder
        rel_path = generate_full_audio(conversion_id, static_folder)
        return jsonify({
            "status": "ok",
            "audio_url": url_for("static", filename=rel_path)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/progress", methods=["POST"])
def update_progress():
    data = request.json
    conversion_id = data.get("conversion_id")
    index = data.get("index")
    if conversion_id is not None and index is not None:
        db.update_conversion_progress(conversion_id, int(index))
        return jsonify({"status": "ok"})
    return jsonify({"error": "Missing data"}), 400

@app.route("/api/rename", methods=["POST"])
def rename_conversion():
    data = request.json
    conversion_id = data.get("conversion_id")
    new_title = data.get("title")
    if conversion_id and new_title:
        db.update_conversion_title(conversion_id, new_title)
        return jsonify({"status": "ok"})
    return jsonify({"error": "Missing data"}), 400

@app.route("/api/jobs/status", methods=["GET"])
def get_jobs_status():
    conversions = db.get_all_conversions()
    # Filter for active jobs only (queued, processing, converting)
    # Status strings used in UI: queued, processing, done. 
    # 'converting' was a class name but status might be 'processing'.
    active_jobs = []
    
    for c in conversions:
        if c["status"] in ["queued", "processing", "converting"]:
            # Recalculate progress if needed, or trust stored fields
            # db.get_all_conversions returns rows with 'processed_chunks' and 'total_chunks'
            # Note: processed_chunks in DB is updated by update_chunk_status.
            
            total = c["total_chunks"]
            processed = c["processed_chunks"]
            progress = (processed / total) if total > 0 else 0
            
            active_jobs.append({
                "id": c["id"],
                "status": c["status"],
                "progress": progress,
                "processed": processed,
                "total": total
            })
            
    return jsonify({"jobs": active_jobs})

@app.route("/api/delete", methods=["POST"])
def delete_conversion():
    data = request.json
    conversion_id = data.get("conversion_id")
    if conversion_id:
        db.delete_conversion(conversion_id)
        return jsonify({"status": "ok"})
    return jsonify({"error": "Missing data"}), 400

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
