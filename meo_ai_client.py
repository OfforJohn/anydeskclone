import socketio
import json
import time
import traceback
import sys

# Configuration
SERVER_URL = "http://127.0.0.1:3001"
ROOM_ID = "199"

sio = socketio.Client(logger=True, engineio_logger=True)

# --- AI KEYBOARD MAP (Standard Android Layout) ---
KEYBOARD_LAYOUT = {
    "rows": [
        {"y_range": [0.45, 0.52], "keys": "1234567890"},
        {"y_range": [0.52, 0.60], "keys": "qwertyuiop"},
        {"y_range": [0.60, 0.68], "keys": "asdfghjkl"},
        {"y_range": [0.68, 0.76], "keys": "zxcvbnm"},
    ],
    "special": [
        {"x": [0.4, 0.6], "y": [0.85, 0.95], "key": "SPACE"},
        {"x": [0.8, 1.0], "y": [0.78, 0.88], "key": "ENTER/GO"},
        {"x": [0.0, 0.15], "y": [0.78, 0.88], "key": "SHIFT"},
    ]
}

def guess_key_from_coords(x, y):
    for spec in KEYBOARD_LAYOUT["special"]:
        if spec["x"][0] <= x <= spec["x"][1] and spec["y"][0] <= y <= spec["y"][1]:
            return spec["key"]
    for row in KEYBOARD_LAYOUT["rows"]:
        if row["y_range"][0] <= y <= row["y_range"][1]:
            row_keys = row["keys"]
            key_index = int(x * len(row_keys))
            if 0 <= key_index < len(row_keys):
                return row_keys[key_index].upper()
    return "Unknown"

@sio.event
def connect():
    print(f"[CONNECTED] AI Client Active")
    sio.emit('join', ROOM_ID)

@sio.on('device_click_broadcast')
def on_device_click(data):
    x = data.get('x', 0)
    y = data.get('y', 0)
    guessed_key = guess_key_from_coords(x, y)

    sio.emit('ai_key_guess', {
        "roomId": ROOM_ID,
        "x": x,
        "y": y,
        "guessed_key": guessed_key
    })

    print(f"Captured ({x*100:.1f}%, {y*100:.1f}%) -> AI Guess: '{guessed_key}'")
    sys.stdout.flush() # Force print in background

@sio.event
def disconnect():
    print("[DISCONNECTED]")

if __name__ == "__main__":
    try:
        print(f"Connecting to {SERVER_URL}...")
        # Added wait() which is better for keeping background processes alive
        sio.connect(SERVER_URL, transports=['websocket'])
        sio.wait()
    except Exception as e:
        print(f"[ERROR] {repr(e)}")
        traceback.print_exc()
    except KeyboardInterrupt:
        sio.disconnect()
