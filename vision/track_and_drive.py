import time
import cv2
import numpy as np
import websocket

# ============================================================
#  CONFIG
# ============================================================
WS_URL = "ws://172.24.21.89:3001"
PING_INTERVAL_S = 5

# Command timing and thresholds (image pixels)
CMD_INTERVAL_MS = 120
X_TURN_THRESHOLD = 12
Y_MOVE_THRESHOLD = 12

# Movement command names (must match firmware)
CMD_TURN_LEFT = "left_micro_slow"
CMD_TURN_RIGHT = "right_micro_slow"
CMD_FORWARD = "forward_micro_slow"
CMD_BACK = "back_micro_slow"

CMD_PEN_UP = "pen_up"
CMD_PEN_DOWN = "pen_down"

# Interpret camera axes: assume forward = toward smaller y (up in image)
FORWARD_IS_NEGATIVE_Y = True

# ============================================================
#  KALMAN FILTER SETUP
# ============================================================

def create_kalman():
    kf = cv2.KalmanFilter(4, 2)
    kf.transitionMatrix = np.array([
        [1, 0, 1, 0],
        [0, 1, 0, 1],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
    ], np.float32)

    kf.measurementMatrix = np.array([
        [1, 0, 0, 0],
        [0, 1, 0, 0]
    ], np.float32)

    kf.processNoiseCov = np.eye(4, dtype=np.float32) * 0.03
    kf.measurementNoiseCov = np.eye(2, dtype=np.float32) * 0.5
    return kf


# ============================================================
#  PNG OVERLAY (ALPHA BLENDING)
# ============================================================

def overlay_image_alpha(background, overlay, x, y):
    h, w = overlay.shape[:2]

    if y + h > background.shape[0] or x + w > background.shape[1]:
        return

    if overlay.shape[2] == 4:
        alpha = overlay[:, :, 3] / 255.0
        overlay_rgb = overlay[:, :, :3]
    else:
        alpha = np.ones((h, w))
        overlay_rgb = overlay

    for c in range(3):
        background[y:y + h, x:x + w, c] = (
            alpha * overlay_rgb[:, :, c] +
            (1 - alpha) * background[y:y + h, x:x + w, c]
        )


# ============================================================
#  WHITE CANVAS DETECTION
# ============================================================

def detect_white_canvas(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    lower_white = np.array([0, 0, 160])
    upper_white = np.array([180, 40, 255])

    mask = cv2.inRange(hsv, lower_white, upper_white)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    mask = cv2.dilate(mask, None, iterations=2)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None, mask

    largest = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(largest)

    return (x, y, w, h), mask


# ============================================================
#  OVERLAY MASK HELPERS
# ============================================================

def build_draw_mask(resized_png):
    # A pixel is "drawn" if alpha > 0 and it's dark (near black).
    if resized_png.shape[2] == 4:
        alpha = resized_png[:, :, 3]
        rgb = resized_png[:, :, :3]
        brightness = rgb.mean(axis=2)
        draw_mask = (alpha > 10) & (brightness < 80)
    else:
        rgb = resized_png[:, :, :3]
        brightness = rgb.mean(axis=2)
        draw_mask = brightness < 80

    return draw_mask.astype(np.uint8)


def is_draw_pixel(draw_mask, x, y):
    if x < 0 or y < 0 or y >= draw_mask.shape[0] or x >= draw_mask.shape[1]:
        return False
    return draw_mask[y, x] == 1


def find_nearest_draw_pixel(draw_mask, x, y, radius=25):
    h, w = draw_mask.shape
    x0 = max(0, x - radius)
    x1 = min(w - 1, x + radius)
    y0 = max(0, y - radius)
    y1 = min(h - 1, y + radius)

    window = draw_mask[y0:y1 + 1, x0:x1 + 1]
    ys, xs = np.where(window == 1)
    if len(xs) == 0:
        return None

    # nearest in Euclidean distance
    dx = xs + x0 - x
    dy = ys + y0 - y
    idx = np.argmin(dx * dx + dy * dy)
    return (x + dx[idx], y + dy[idx])


# ============================================================
#  WEBSOCKET CLIENT
# ============================================================

def ws_connect():
    ws = websocket.WebSocket()
    ws.connect(WS_URL, timeout=5)
    ws.send('{"type":"register","role":"ui","client":"vision"}')
    return ws


def ws_send_cmd(ws, cmd):
    ws.send(f'{{"type":"cmd","cmd":"{cmd}"}}')


# ============================================================
#  MAIN PROGRAM
# ============================================================

def main():
    cap = cv2.VideoCapture(0)
    kalman = create_kalman()

    png_overlay = cv2.imread("SVGimg.png", cv2.IMREAD_UNCHANGED)
    if png_overlay is None:
        raise RuntimeError("Failed to load SVGimg.png")

    lower_blue = np.array([90, 80, 50])
    upper_blue = np.array([130, 255, 255])
    MIN_AREA = 500

    ws = None
    last_cmd_ms = 0
    last_ping = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Blue object detection
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask_blue = cv2.inRange(hsv, lower_blue, upper_blue)
        mask_blue = cv2.morphologyEx(mask_blue, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        mask_blue = cv2.dilate(mask_blue, None, iterations=2)

        contours, _ = cv2.findContours(mask_blue, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        measured = None

        if contours:
            largest = max(contours, key=cv2.contourArea)
            if cv2.contourArea(largest) > MIN_AREA:
                x, y, w, h = cv2.boundingRect(largest)
                cx = x + w // 2
                cy = y + h // 2
                measured = np.array([[np.float32(cx)], [np.float32(cy)]])
                kalman.correct(measured)

                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 0, 255), 2)
                cv2.circle(frame, (cx, cy), 5, (0, 0, 255), -1)

        prediction = kalman.predict()
        px = int(prediction[0, 0])
        py = int(prediction[1, 0])
        cv2.circle(frame, (px, py), 8, (0, 255, 0), 2)

        # White canvas + overlay
        canvas_box, mask_white = detect_white_canvas(frame)
        draw_mask = None

        if canvas_box is not None:
            x, y, w, h = canvas_box
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

            resized_png = cv2.resize(png_overlay, (w, h))
            overlay_image_alpha(frame, resized_png, x, y)
            draw_mask = build_draw_mask(resized_png)

            # Map robot position to overlay coordinates
            local_x = px - x
            local_y = py - y

            # Decide pen state
            if draw_mask is not None and is_draw_pixel(draw_mask, local_x, local_y):
                desired_pen = CMD_PEN_DOWN
                cv2.circle(frame, (px, py), 10, (255, 255, 255), 2)
            else:
                desired_pen = CMD_PEN_UP

            now = int(time.time() * 1000)
            if now - last_cmd_ms > CMD_INTERVAL_MS:
                # Connect WS if needed
                if ws is None:
                    try:
                        ws = ws_connect()
                    except Exception:
                        ws = None
                if ws is not None:
                    try:
                        ws_send_cmd(ws, desired_pen)

                        # Find a nearby draw pixel to move toward
                        target = find_nearest_draw_pixel(draw_mask, local_x, local_y, radius=30)
                        if target is not None:
                            tx, ty = target
                            dx = tx - local_x
                            dy = ty - local_y

                            if abs(dx) > X_TURN_THRESHOLD:
                                ws_send_cmd(ws, CMD_TURN_RIGHT if dx > 0 else CMD_TURN_LEFT)
                            elif abs(dy) > Y_MOVE_THRESHOLD:
                                # forward is negative y in the image
                                forward = dy < 0 if FORWARD_IS_NEGATIVE_Y else dy > 0
                                ws_send_cmd(ws, CMD_FORWARD if forward else CMD_BACK)
                    except Exception:
                        ws = None
                last_cmd_ms = now

        # Ping server periodically to keep connection alive
        if ws is not None and (time.time() - last_ping) > PING_INTERVAL_S:
            try:
                ws.send('{"type":"ping"}')
                last_ping = time.time()
            except Exception:
                ws = None

        # Display
        cv2.imshow("Frame", frame)
        cv2.imshow("White Mask", mask_white)
        cv2.imshow("Blue Mask", mask_blue)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
