import sqlite3
import os
import json
from datetime import datetime
from app.config import BASE_DIR

DB_PATH = os.path.join(BASE_DIR, "storage", "orders.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        customer_name TEXT,
        customer_phone TEXT,
        customer_note TEXT,
        original_filename TEXT,
        image_path TEXT,
        preview_path TEXT,
        gcode_path TEXT,
        width_mm REAL NOT NULL,
        height_mm REAL NOT NULL,
        material_key TEXT NOT NULL,
        material_name TEXT NOT NULL,
        mode TEXT NOT NULL,
        estimated_minutes REAL NOT NULL,
        total_price INTEGER NOT NULL,
        status TEXT NOT NULL,
        payment_ref TEXT NOT NULL
    )
    """)
    conn.commit()
    conn.close()

def create_order(order_data: dict) -> dict:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO orders (
        id, created_at, customer_name, customer_phone, customer_note,
        original_filename, image_path, preview_path, gcode_path,
        width_mm, height_mm, material_key, material_name, mode,
        estimated_minutes, total_price, status, payment_ref
    ) VALUES (
        :id, :created_at, :customer_name, :customer_phone, :customer_note,
        :original_filename, :image_path, :preview_path, :gcode_path,
        :width_mm, :height_mm, :material_key, :material_name, :mode,
        :estimated_minutes, :total_price, :status, :payment_ref
    )
    """, order_data)
    conn.commit()
    conn.close()
    return order_data

def get_order(order_id: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def update_order_status(order_id: str, new_status: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE orders SET status = ? WHERE id = ?", (new_status, order_id))
    conn.commit()
    conn.close()
    return get_order(order_id)

def list_orders(limit: int = 50):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def find_orders_by_query(query: str):
    """Tìm kiếm đơn hàng theo mã đơn hoặc số điện thoại để tra cứu tiến trình"""
    q = query.strip()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM orders 
        WHERE id = ? OR customer_phone = ? OR (customer_phone != '' AND customer_phone LIKE ?)
        ORDER BY created_at DESC LIMIT 5
    """, (q, q, f"%{q}%"))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

