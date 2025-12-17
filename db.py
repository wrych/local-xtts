import sqlite3
import json
import uuid
from datetime import datetime
from threading import Lock

DB_FILE = "tts_app.db"
DB_LOCK = Lock()

def get_connection():
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with DB_LOCK:
        conn = get_connection()
        c = conn.cursor()
        
        # Conversions table
        c.execute("""
            CREATE TABLE IF NOT EXISTS conversions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                text TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                total_chunks INTEGER DEFAULT 0,
                processed_chunks INTEGER DEFAULT 0,
                last_played_index INTEGER DEFAULT -1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                speaker TEXT,
                language TEXT,
                estimated_duration REAL DEFAULT 0.0,
                total_duration REAL DEFAULT 0.0
            )
        """)
        
        # Attempt to add new columns if they don't exist (migrations for existing db)
        try:
            c.execute("ALTER TABLE conversions ADD COLUMN speaker TEXT")
        except sqlite3.OperationalError:
            pass # already exists
            
        try:
            c.execute("ALTER TABLE conversions ADD COLUMN language TEXT")
        except sqlite3.OperationalError:
            pass # already exists

        try:
            c.execute("ALTER TABLE conversions ADD COLUMN estimated_duration REAL DEFAULT 0.0")
        except sqlite3.OperationalError:
            pass 

        try:
            c.execute("ALTER TABLE conversions ADD COLUMN total_duration REAL DEFAULT 0.0")
        except sqlite3.OperationalError:
            pass 

        # Chunks table
        c.execute("""
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversion_id TEXT NOT NULL,
                seq_num INTEGER NOT NULL,
                text TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                audio_filename TEXT,
                duration REAL DEFAULT 0.0,
                FOREIGN KEY (conversion_id) REFERENCES conversions (id)
            )
        """)

        try:
            c.execute("ALTER TABLE chunks ADD COLUMN duration REAL DEFAULT 0.0")
        except sqlite3.OperationalError:
            pass 
        
        conn.commit()
        conn.close()

def create_conversion(title: str, text: str, chunks_data: list[str], speaker: str = None, language: str = None, estimated_duration: float = 0.0) -> str:
    """
    Creates a new conversion and its chunks transactionally.
    chunks_data is a listing of text strings.
    Returns the new conversion_id.
    """
    conversion_id = str(uuid.uuid4())
    total_chunks = len(chunks_data)
    
    with DB_LOCK:
        conn = get_connection()
        try:
            # 1. Insert Conversion
            conn.execute("""
                INSERT INTO conversions (id, title, text, status, total_chunks, processed_chunks, speaker, language, estimated_duration)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (conversion_id, title, text, 'queued', total_chunks, 0, speaker, language, estimated_duration))
            
            # 2. Insert Chunks
            chunk_rows = []
            for i, chunk_text in enumerate(chunks_data):
                chunk_rows.append((conversion_id, i, chunk_text, 'pending'))
            
            conn.executemany("""
                INSERT INTO chunks (conversion_id, seq_num, text, status)
                VALUES (?, ?, ?, ?)
            """, chunk_rows)
            
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
            
    return conversion_id

def get_all_conversions():
    with DB_LOCK:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM conversions ORDER BY created_at DESC").fetchall()
        conn.close()
        return [dict(row) for row in rows]

def get_conversion_with_chunks(conversion_id: str):
    """Returns dict with conversion info + list of chunks."""
    with DB_LOCK:
        conn = get_connection()
        conv = conn.execute("SELECT * FROM conversions WHERE id = ?", (conversion_id,)).fetchone()
        if not conv:
            conn.close()
            return None
        
        chunks = conn.execute("SELECT * FROM chunks WHERE conversion_id = ? ORDER BY seq_num ASC", (conversion_id,)).fetchall()
        
        result = dict(conv)
        result["chunks"] = [dict(c) for c in chunks]
        conn.close()
        return result

def get_conversion(conversion_id: str):
    with DB_LOCK:
        conn = get_connection()
        row = conn.execute("SELECT * FROM conversions WHERE id = ?", (conversion_id,)).fetchone()
        conn.close()
        return dict(row) if row else None

def update_chunk_status(conversion_id: str, seq_num: int, status: str, audio_filename: str = None, duration: float = 0.0):
    with DB_LOCK:
        conn = get_connection()
        try:
            # Update specific chunk
            if audio_filename:
                conn.execute("""
                    UPDATE chunks 
                    SET status = ?, audio_filename = ?, duration = ?
                    WHERE conversion_id = ? AND seq_num = ?
                """, (status, audio_filename, duration, conversion_id, seq_num))
            else:
                 conn.execute("""
                    UPDATE chunks 
                    SET status = ?
                    WHERE conversion_id = ? AND seq_num = ?
                """, (status, conversion_id, seq_num))

            # Update conversion progress counter and status
            # Recalculate processed count to be safe or increment? Increment is faster but potentially drift prone.
            # Let's count 'done' chunks to be safe.
            count = conn.execute("""
                SELECT COUNT(*) FROM chunks WHERE conversion_id = ? AND status = 'done'
            """, (conversion_id,)).fetchone()[0]
            
            # Recalculate total duration logic?
            # We want total_duration to trigger accumulation when done.
            # Or we can accumulate on the fly.
            # Let's sum duration for all 'done' chunks
            total_dur = conn.execute("""
                SELECT SUM(duration) FROM chunks WHERE conversion_id = ?
            """, (conversion_id,)).fetchone()[0] or 0.0

            # Check if all done
            total = conn.execute("SELECT total_chunks FROM conversions WHERE id = ?", (conversion_id,)).fetchone()[0]
            
            conv_status = 'processing'
            if count == total:
                conv_status = 'done'
            
            conn.execute("""
                UPDATE conversions 
                SET processed_chunks = ?, status = ?, total_duration = ?
                WHERE id = ?
            """, (count, conv_status, total_dur, conversion_id))
            
            conn.commit()
        finally:
            conn.close()

def update_conversion_progress(conversion_id: str, last_played_index: int):
    with DB_LOCK:
        conn = get_connection()
        conn.execute("UPDATE conversions SET last_played_index = ? WHERE id = ?", (last_played_index, conversion_id))
        conn.commit()
        conn.close()


def update_conversion_title(conversion_id: str, new_title: str):
    with DB_LOCK:
        conn = get_connection()
        conn.execute("UPDATE conversions SET title = ? WHERE id = ?", (new_title, conversion_id))
        conn.commit()
        conn.close()

def delete_conversion(conversion_id: str):
    with DB_LOCK:
        conn = get_connection()
        try:
            conn.execute("DELETE FROM chunks WHERE conversion_id = ?", (conversion_id,))
            conn.execute("DELETE FROM conversions WHERE id = ?", (conversion_id,))
            conn.commit()
        finally:
            conn.close()
