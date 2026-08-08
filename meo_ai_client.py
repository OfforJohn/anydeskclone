import socketio
import json
import time
import traceback
import sys
import math

# Configuration
SERVER_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3001"
AI_ROOM = "ai-room"

print(f"DEBUG: Starting AI Client. Connecting to {SERVER_URL}", flush=True)

sio = socketio.Client(logger=True, engineio_logger=True)

# --- AGGRESSIVE AI KEYBOARD & PIN LAYOUTS ---
BUTTONS = [
    # Calibrated for User Device (Down-shifted Y)
    {"key": "1", "x": 0.25, "y": 0.50}, {"key": "2", "x": 0.50, "y": 0.50}, {"key": "3", "x": 0.75, "y": 0.50},
    {"key": "4", "x": 0.25, "y": 0.60}, {"key": "5", "x": 0.50, "y": 0.60}, {"key": "6", "x": 0.75, "y": 0.60},
    {"key": "7", "x": 0.25, "y": 0.70}, {"key": "8", "x": 0.50, "y": 0.70}, {"key": "9", "x": 0.75, "y": 0.70},
    {"key": "0", "x": 0.50, "y": 0.80}, {"key": "DEL", "x": 0.25, "y": 0.80}, {"key": "OK", "x": 0.75, "y": 0.80},
    {"key": "Q", "x": 0.05, "y": 0.60}, {"key": "W", "x": 0.15, "y": 0.60}, {"key": "E", "x": 0.25, "y": 0.60},
    {"key": "R", "x": 0.35, "y": 0.60}, {"key": "T", "x": 0.45, "y": 0.60}, {"key": "Y", "x": 0.55, "y": 0.60},
    {"key": "U", "x": 0.65, "y": 0.60}, {"key": "I", "x": 0.75, "y": 0.60}, {"key": "O", "x": 0.85, "y": 0.60}, {"key": "P", "x": 0.95, "y": 0.60},
    {"key": "A", "x": 0.10, "y": 0.68}, {"key": "S", "x": 0.20, "y": 0.68}, {"key": "D", "x": 0.30, "y": 0.68},
    {"key": "F", "x": 0.40, "y": 0.68}, {"key": "G", "x": 0.50, "y": 0.68}, {"key": "H", "x": 0.60, "y": 0.68},
    {"key": "J", "x": 0.70, "y": 0.68}, {"key": "K", "x": 0.80, "y": 0.68}, {"key": "L", "x": 0.90, "y": 0.68},
    {"key": "Z", "x": 0.15, "y": 0.76}, {"key": "X", "x": 0.25, "y": 0.76}, {"key": "C", "x": 0.35, "y": 0.76},
    {"key": "V", "x": 0.45, "y": 0.76}, {"key": "B", "x": 0.55, "y": 0.76}, {"key": "N", "x": 0.65, "y": 0.76}, {"key": "M", "x": 0.75, "y": 0.76},
    {"key": "SPACE", "x": 0.50, "y": 0.85}, {"key": "ENTER", "x": 0.90, "y": 0.85},

    # --- Android Pattern Grid (3x3) ---
    {"key": "P1", "x": 0.25, "y": 0.35}, {"key": "P2", "x": 0.50, "y": 0.35}, {"key": "P3", "x": 0.75, "y": 0.35},
    {"key": "P4", "x": 0.25, "y": 0.50}, {"key": "P5", "x": 0.50, "y": 0.50}, {"key": "P6", "x": 0.75, "y": 0.50},
    {"key": "P7", "x": 0.25, "y": 0.65}, {"key": "P8", "x": 0.50, "y": 0.65}, {"key": "P9", "x": 0.75, "y": 0.65},
]

def calculate_distance(x1, y1, x2, y2):
    return math.sqrt((x2 - x1)**2 + (y2 - y1)**2)

def guess_nearest_button(x, y):
    # RENDER FIX: Even if coords are 0 (blocked screen), we should still report "Restricted"
    # instead of doing nothing. However, if we have coordinates, we guess aggressively.
    if x == 0 and y == 0:
        return "SECURE SCREEN"

    nearest_btn = "Area"
    min_dist = 0.25 # Aggressive snapping radius
    for btn in BUTTONS:
        dist = calculate_distance(x, y, btn["x"], btn["y"])
        if dist < min_dist:
            min_dist = dist
            nearest_btn = btn["key"]
    return nearest_btn

@sio.event
def connect():
    print(f"[CONNECTED] AI Active on {SERVER_URL}")
    sio.emit('join', AI_ROOM)

@sio.on('device_click_broadcast')
def on_device_click(data):
    print(f"DEBUG: Received click event: {data}", flush=True)
    x, y = data.get('x', 0), data.get('y', 0)
    click_id = data.get('clickId')
    incoming_room = data.get('roomId')

    guessed_key = guess_nearest_button(x, y)

    print(f"DEBUG: Guessed key '{guessed_key}' for ID:{click_id} in Room:{incoming_room}", flush=True)

    sio.emit('ai_key_guess', {
        "roomId": incoming_room,
        "x": x,
        "y": y,
        "guessed_key": guessed_key,
        "clickId": click_id
    })
    sys.stdout.flush()

# Fallback listener for generic 'device_click' events
@sio.on('device_click')
def on_direct_click(data):
    on_device_click(data)

@sio.on('*')
def catch_all(event, data):
    print(f"AI-DEBUG: Caught random event '{event}': {data}", flush=True)

@sio.on('device_unlock_broadcast')
def on_device_unlock(data):
    points = data.get('points', [])
    click_id = data.get('clickId')
    incoming_room = data.get('roomId')

    if not points:
        return

    # Analyze points to find which pattern dots were hit
    hit_dots = []
    for p in points:
        dot = guess_nearest_button(p['x'], p['y'])
        if dot.startswith("P") and (not hit_dots or hit_dots[-1] != dot):
            hit_dots.append(dot)

    pattern_str = " -> ".join(hit_dots) if hit_dots else "Unknown Pattern"

    print(f"DEBUG: Pattern detected: {pattern_str} in Room:{incoming_room}", flush=True)

    sio.emit('ai_key_guess', {
        "roomId": incoming_room,
        "x": points[0]['x'],
        "y": points[0]['y'],
        "guessed_key": f"PATTERN: {pattern_str}",
        "clickId": click_id
    })
    sys.stdout.flush()

@sio.event
def disconnect():
    print("[DISCONNECTED]")

if __name__ == "__main__":
    try:
        print(f"Connecting to {SERVER_URL}...")
        sio.connect(SERVER_URL)
        sio.wait()
    except Exception as e:
        print(f"[ERROR] {repr(e)}")
        sys.stdout.flush()
    except KeyboardInterrupt:
        sio.disconnect()
