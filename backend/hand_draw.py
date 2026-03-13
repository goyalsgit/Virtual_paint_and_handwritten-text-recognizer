import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode
import urllib.request
import os

# ═══════════════════════════════════════════════════════════════════
# AIR DRAWING APP — Phase 1 (Precision Edition)
#
# KEY IMPROVEMENTS IN THIS VERSION:
# 1. Kalman filter smoothing — removes shake WITHOUT adding lag
# 2. Higher model complexity for better landmark accuracy
# 3. Gesture deadzone — prevents accidental mode switches
# 4. Brush size control via pinch distance (spread = bigger brush)
# 5. Drawing only happens below toolbar — no accidental marks
# 6. Confidence threshold tuned for Mac webcam
# ═══════════════════════════════════════════════════════════════════


# ── SECTION 1: Download model ──────────────────────────────────────
MODEL_PATH = "hand_landmarker.task"
if not os.path.exists(MODEL_PATH):
    print("Downloading hand landmarker model... (one time only)")
    url = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
    urllib.request.urlretrieve(url, MODEL_PATH)
    print("Model downloaded!")


# ── SECTION 2: Kalman Filter for smooth tracking ──────────────────
# A Kalman filter predicts where the finger WILL be based on
# its current velocity. This removes jitter without adding lag.
# Normal averaging adds lag because it waits for past positions.
# Kalman predicts ahead, so it feels instant AND smooth.

class KalmanFilter:
    def __init__(self):
        self.kf = cv2.KalmanFilter(4, 2)
        # State: [x, y, dx, dy] — position + velocity
        # Measurement: [x, y] — just position

        self.kf.measurementMatrix = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0]
        ], np.float32)

        self.kf.transitionMatrix = np.array([
            [1, 0, 1, 0],
            [0, 1, 0, 1],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
        ], np.float32)

        # Process noise — how much we trust the prediction
        # Lower = smoother but more lag. Higher = more responsive.
        self.kf.processNoiseCov = np.eye(4, dtype=np.float32) * 0.03

        # Measurement noise — how much we trust the raw input
        self.kf.measurementNoiseCov = np.eye(2, dtype=np.float32) * 0.5

        self.initialized = False

    def update(self, x, y):
        measurement = np.array([[np.float32(x)], [np.float32(y)]])
        if not self.initialized:
            # First frame — set state directly
            self.kf.statePre = np.array([[x], [y], [0], [0]], np.float32)
            self.kf.statePost = np.array([[x], [y], [0], [0]], np.float32)
            self.initialized = True

        self.kf.correct(measurement)
        predicted = self.kf.predict()
        return int(predicted[0][0]), int(predicted[1][0])

    def reset(self):
        self.initialized = False


kalman = KalmanFilter()


# ── SECTION 3: Setup MediaPipe ─────────────────────────────────────
options = HandLandmarkerOptions(
    base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
    running_mode=RunningMode.VIDEO,
    num_hands=1,
    min_hand_detection_confidence=0.7,
    min_hand_presence_confidence=0.7,
    min_tracking_confidence=0.7,
)
landmarker = HandLandmarker.create_from_options(options)


# ── SECTION 4: Setup webcam ────────────────────────────────────────
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
cap.set(cv2.CAP_PROP_FPS, 30)
# Disable autofocus — constant refocusing hurts tracking accuracy
cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)

ret, frame = cap.read()
if not ret:
    print("ERROR: Cannot open webcam.")
    print("Go to: System Settings → Privacy & Security → Camera → Allow Terminal")
    exit()

frame_height, frame_width = frame.shape[:2]
print(f"Webcam opened at {frame_width}x{frame_height}")


# ── SECTION 5: Canvas ──────────────────────────────────────────────
canvas = np.zeros((frame_height, frame_width, 3), dtype=np.uint8)


# ── SECTION 6: Color palette ───────────────────────────────────────
COLORS = [
    ("White",  (255, 255, 255)),
    ("Red",    (0,   0,   255)),
    ("Green",  (0,   200, 0  )),
    ("Blue",   (255, 50,  50 )),
    ("Yellow", (0,   255, 255)),
    ("Orange", (0,   165, 255)),
    ("Pink",   (203, 192, 255)),
    ("Cyan",   (255, 255, 0  )),
]

TOOLBAR_HEIGHT  = 90
COLOR_BOX_SIZE  = 60
COLOR_BOX_GAP   = 12
TOOLBAR_START_X = 20

ERASER_X = TOOLBAR_START_X + len(COLORS) * (COLOR_BOX_SIZE + COLOR_BOX_GAP) + 20
ERASER_W = 80
CLEAR_X  = ERASER_X + ERASER_W + 10
CLEAR_W  = 80

# Brush size indicator position
BRUSH_INDICATOR_X = CLEAR_X + CLEAR_W + 30


# ── SECTION 7: State variables ─────────────────────────────────────
current_color_index = 0
draw_color   = COLORS[0][1]
brush_size   = 8         # Starting brush size
eraser_mode  = False
eraser_size  = 60

prev_x, prev_y = 0, 0
mode            = "PAUSED"
frame_timestamp = 0
pinch_cooldown  = 0
PINCH_COOLDOWN  = 25     # frames before next pinch registers

font = cv2.FONT_HERSHEY_SIMPLEX


# ── SECTION 8: Gesture detection helpers ──────────────────────────

def is_finger_up(lm, tip_id, pip_id):
    """
    Finger is UP when its tip is higher than its middle knuckle.
    Uses a small threshold to avoid flickering at borderline angles.
    """
    # 0.03 threshold = finger must be clearly up, not borderline
    return (lm[pip_id].y - lm[tip_id].y) > 0.03


def get_pinch_distance(lm):
    """Distance in pixels between thumb tip (4) and index tip (8)."""
    tx = lm[4].x * frame_width
    ty = lm[4].y * frame_height
    ix = lm[8].x * frame_width
    iy = lm[8].y * frame_height
    return ((tx - ix)**2 + (ty - iy)**2) ** 0.5


def get_spread_distance(lm):
    """
    Distance between thumb tip (4) and pinky tip (20).
    Used to control brush size — spread your hand = bigger brush.
    """
    tx = lm[4].x * frame_width
    ty = lm[4].y * frame_height
    px = lm[20].x * frame_width
    py = lm[20].y * frame_height
    return ((tx - px)**2 + (ty - py)**2) ** 0.5


def get_toolbar_hit(x, y):
    """
    Returns what toolbar item the finger is pointing at.
     0-7  = color index
    -2    = eraser button
    -3    = clear button
    -1    = nothing
    """
    if y > TOOLBAR_HEIGHT:
        return -1
    for i in range(len(COLORS)):
        bx = TOOLBAR_START_X + i * (COLOR_BOX_SIZE + COLOR_BOX_GAP)
        if bx <= x <= bx + COLOR_BOX_SIZE:
            return i
    if ERASER_X <= x <= ERASER_X + ERASER_W:
        return -2
    if CLEAR_X <= x <= CLEAR_X + CLEAR_W:
        return -3
    return -1


# ── SECTION 9: Drawing the toolbar UI ─────────────────────────────

def draw_toolbar(display_frame):
    # Toolbar background
    cv2.rectangle(display_frame, (0, 0), (frame_width, TOOLBAR_HEIGHT), (25, 25, 25), -1)
    cv2.line(display_frame, (0, TOOLBAR_HEIGHT), (frame_width, TOOLBAR_HEIGHT), (80, 80, 80), 1)

    # Color boxes
    for i, (name, color) in enumerate(COLORS):
        bx = TOOLBAR_START_X + i * (COLOR_BOX_SIZE + COLOR_BOX_GAP)
        by = 15

        cv2.rectangle(display_frame, (bx, by),
                      (bx + COLOR_BOX_SIZE, by + COLOR_BOX_SIZE), color, -1)

        # White border for selected color
        if i == current_color_index and not eraser_mode:
            cv2.rectangle(display_frame,
                          (bx - 4, by - 4),
                          (bx + COLOR_BOX_SIZE + 4, by + COLOR_BOX_SIZE + 4),
                          (255, 255, 255), 3)
        else:
            cv2.rectangle(display_frame, (bx, by),
                          (bx + COLOR_BOX_SIZE, by + COLOR_BOX_SIZE),
                          (90, 90, 90), 1)

        # Color name below box
        cv2.putText(display_frame, name,
                    (bx + 2, by + COLOR_BOX_SIZE + 14),
                    font, 0.3, (160, 160, 160), 1)

    # Eraser button
    eraser_col = (30, 30, 180) if eraser_mode else (55, 55, 55)
    border_col = (255, 255, 255) if eraser_mode else (100, 100, 100)
    cv2.rectangle(display_frame, (ERASER_X, 15),
                  (ERASER_X + ERASER_W, 75), eraser_col, -1)
    cv2.rectangle(display_frame, (ERASER_X, 15),
                  (ERASER_X + ERASER_W, 75), border_col, 2)
    cv2.putText(display_frame, "ERASE",
                (ERASER_X + 10, 52), font, 0.55, (255, 255, 255), 1)

    # Clear button
    cv2.rectangle(display_frame, (CLEAR_X, 15),
                  (CLEAR_X + CLEAR_W, 75), (40, 40, 40), -1)
    cv2.rectangle(display_frame, (CLEAR_X, 15),
                  (CLEAR_X + CLEAR_W, 75), (100, 100, 100), 2)
    cv2.putText(display_frame, "CLEAR",
                (CLEAR_X + 10, 52), font, 0.55, (255, 255, 255), 1)

    # Brush size indicator
    cv2.putText(display_frame, f"Brush: {brush_size}",
                (BRUSH_INDICATOR_X, 40), font, 0.55, (180, 180, 180), 1)
    # Visual circle showing actual brush size
    indicator_cx = BRUSH_INDICATOR_X + 55
    cv2.circle(display_frame, (indicator_cx, 60), brush_size, draw_color if not eraser_mode else (100, 100, 100), -1)

    # Mode label top right
    if mode == "DRAW":
        mc, ml = (0, 255, 0), "DRAWING"
    elif mode == "ERASE":
        mc, ml = (0, 80, 255), "ERASING"
    elif mode == "SELECT":
        mc, ml = (0, 255, 255), "SELECTING"
    elif mode == "BRUSH":
        mc, ml = (255, 200, 0), "BRUSH SIZE"
    else:
        mc, ml = (130, 130, 130), "PAUSED"

    cv2.putText(display_frame, ml,
                (frame_width - 170, 50), font, 0.85, mc, 2)

    # Bottom hint bar
    hint = "INDEX=Draw  |  PEACE=Erase  |  PINCH+move to toolbar=Pick color  |  SPREAD fingers=Brush size  |  S=Save  Q=Quit"
    cv2.rectangle(display_frame, (0, frame_height - 28),
                  (frame_width, frame_height), (15, 15, 15), -1)
    cv2.putText(display_frame, hint,
                (8, frame_height - 9), font, 0.38, (160, 160, 160), 1)


def draw_hand_skeleton(frame, lm):
    connections = [
        (0,1),(1,2),(2,3),(3,4),
        (0,5),(5,6),(6,7),(7,8),
        (0,9),(9,10),(10,11),(11,12),
        (0,13),(13,14),(14,15),(15,16),
        (0,17),(17,18),(18,19),(19,20),
        (5,9),(9,13),(13,17)
    ]
    for s, e in connections:
        x1 = int(lm[s].x * frame_width)
        y1 = int(lm[s].y * frame_height)
        x2 = int(lm[e].x * frame_width)
        y2 = int(lm[e].y * frame_height)
        cv2.line(frame, (x1, y1), (x2, y2), (0, 180, 0), 1)
    for i, pt in enumerate(lm):
        px = int(pt.x * frame_width)
        py = int(pt.y * frame_height)
        # Index tip = bright green, others = dimmer
        color = (0, 255, 0) if i == 8 else (0, 160, 0)
        radius = 6 if i == 8 else 3
        cv2.circle(frame, (px, py), radius, color, -1)


# ── SECTION 10: Main loop ──────────────────────────────────────────
print("\nAir Drawing — Precision Edition")
print("  Index finger only     = Draw")
print("  Peace sign            = Erase")
print("  Pinch over color      = Select color")
print("  Spread all fingers    = Adjust brush size")
print("  +/-                   = Brush size up/down")
print("  C = Clear | S = Save | Q = Quit\n")

while True:
    ret, frame = cap.read()
    if not ret:
        break

    frame = cv2.flip(frame, 1)
    rgb   = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    rgb.flags.writeable = False

    frame_timestamp += 33
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect_for_video(mp_img, frame_timestamp)
    rgb.flags.writeable = True

    cx, cy = frame_width // 2, frame_height // 2

    if pinch_cooldown > 0:
        pinch_cooldown -= 1

    if result.hand_landmarks:
        lm = result.hand_landmarks[0]
        draw_hand_skeleton(frame, lm)

        # Raw index fingertip position
        raw_x = int(lm[8].x * frame_width)
        raw_y = int(lm[8].y * frame_height)

        # Kalman filtered position — smooth AND responsive
        cx, cy = kalman.update(raw_x, raw_y)

        # Finger states
        index_up  = is_finger_up(lm, 8,  6)
        middle_up = is_finger_up(lm, 12, 10)
        ring_up   = is_finger_up(lm, 16, 14)
        pinky_up  = is_finger_up(lm, 20, 18)
        thumb_up  = is_finger_up(lm, 4,  2)

        pinch_dist  = get_pinch_distance(lm)
        spread_dist = get_spread_distance(lm)

        is_pinching  = pinch_dist < 45
        # All fingers spread = brush size mode
        is_spreading = (spread_dist > 200 and index_up and
                        middle_up and ring_up and pinky_up)

        # ── Gesture decisions ──────────────────────────────────────

        if is_spreading:
            # SPREAD gesture — map spread distance to brush size
            # spread_dist ranges roughly 200-450px
            # brush_size ranges 3-40
            mode = "BRUSH"
            prev_x, prev_y = 0, 0
            kalman.reset()
            brush_size = int(np.interp(spread_dist, [200, 450], [3, 40]))
            # Show spread distance visually
            cv2.line(frame,
                     (int(lm[4].x * frame_width), int(lm[4].y * frame_height)),
                     (int(lm[20].x * frame_width), int(lm[20].y * frame_height)),
                     (255, 200, 0), 2)

        elif is_pinching and pinch_cooldown == 0:
            # PINCH — select toolbar item
            mode = "SELECT"
            prev_x, prev_y = 0, 0
            kalman.reset()

            hit = get_toolbar_hit(cx, cy)
            if hit >= 0:
                current_color_index = hit
                draw_color = COLORS[hit][1]
                eraser_mode = False
                pinch_cooldown = PINCH_COOLDOWN
                print(f"Color: {COLORS[hit][0]}")
            elif hit == -2:
                eraser_mode = True
                pinch_cooldown = PINCH_COOLDOWN
                print("Eraser on")
            elif hit == -3:
                canvas = np.zeros((frame_height, frame_width, 3), dtype=np.uint8)
                pinch_cooldown = PINCH_COOLDOWN
                print("Canvas cleared!")

        elif index_up and not middle_up and not ring_up and not is_pinching:
            # INDEX ONLY — draw or erase
            if cy > TOOLBAR_HEIGHT:
                if eraser_mode:
                    mode = "ERASE"
                    prev_x, prev_y = 0, 0
                    kalman.reset()
                    cv2.circle(canvas, (cx, cy), eraser_size, (0, 0, 0), -1)
                else:
                    mode = "DRAW"
                    if prev_x == 0 and prev_y == 0:
                        prev_x, prev_y = cx, cy
                    # Draw with anti-aliased line for smoother strokes
                    cv2.line(canvas, (prev_x, prev_y), (cx, cy),
                             draw_color, brush_size, cv2.LINE_AA)
                    prev_x, prev_y = cx, cy
            else:
                mode = "PAUSED"
                prev_x, prev_y = 0, 0
                kalman.reset()

        elif index_up and middle_up and not ring_up and not is_pinching:
            # PEACE — erase
            mode = "ERASE"
            prev_x, prev_y = 0, 0
            kalman.reset()
            if cy > TOOLBAR_HEIGHT:
                cv2.circle(canvas, (cx, cy), eraser_size, (0, 0, 0), -1)

        else:
            mode = "PAUSED"
            prev_x, prev_y = 0, 0
            kalman.reset()

        # Cursor dot on fingertip
        if mode == "DRAW":
            cv2.circle(frame, (cx, cy), max(brush_size // 2, 3), draw_color, -1)
            cv2.circle(frame, (cx, cy), max(brush_size // 2, 3) + 1, (0, 0, 0), 1)
        elif mode == "ERASE":
            cv2.circle(frame, (cx, cy), eraser_size, (0, 80, 255), 2)
        elif mode == "SELECT":
            cv2.circle(frame, (cx, cy), 10, (0, 255, 255), -1)
        elif mode == "BRUSH":
            cv2.circle(frame, (cx, cy), brush_size, draw_color, 2)

    else:
        mode = "PAUSED"
        prev_x, prev_y = 0, 0
        kalman.reset()

    # Merge webcam + canvas
    combined = cv2.addWeighted(frame, 0.55, canvas, 1.0, 0)

    # Draw toolbar on top
    draw_toolbar(combined)

    cv2.imshow("Air Drawing — by Devansh Goyal", combined)

    key = cv2.waitKey(1) & 0xFF
    if key == ord('q'):
        print("Quitting...")
        break
    elif key == ord('c'):
        canvas = np.zeros((frame_height, frame_width, 3), dtype=np.uint8)
        print("Canvas cleared!")
    elif key == ord('s'):
        cv2.imwrite("drawing.png", canvas)
        print("Saved as drawing.png!")
    elif key in [ord('+'), ord('=')]:
        brush_size = min(brush_size + 2, 40)
        print(f"Brush: {brush_size}")
    elif key == ord('-'):
        brush_size = max(brush_size - 2, 2)
        print(f"Brush: {brush_size}")


# ── SECTION 11: Cleanup ────────────────────────────────────────────
cap.release()
cv2.destroyAllWindows()
landmarker.close()
print("App closed cleanly.")