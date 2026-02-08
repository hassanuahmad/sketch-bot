import base64
import json
import time

import cv2
import numpy as np
import websocket

# ============================================================
#  CONFIG
# ============================================================
WS_URL = "ws://172.24.21.89:3001"
PNG_PATH = "/Users/hassanuahmad/Desktop/sketch-bot/public/sketches/latest.png"
PING_INTERVAL_S = 5
STREAM_FPS = 8
STREAM_WIDTH = 640
STREAM_JPEG_QUALITY = 70

# Command timing and thresholds (image pixels)
CMD_INTERVAL_MS = 150
X_TURN_THRESHOLD = 14
Y_MOVE_THRESHOLD = 14
MOVE_MS = 140
TURN_MS = 120

# Movement command names (must match firmware)
CMD_TURN_LEFT = "left"
CMD_TURN_RIGHT = "right"
CMD_FORWARD = "forward"
CMD_BACK = "backward"

# Interpret camera axes: assume forward = toward smaller y (up in image)
FORWARD_IS_NEGATIVE_Y = True

# ============================================================
#  KALMAN FILTER SETUP
# ============================================================


def create_kalman():
    kf = cv2.KalmanFilter(4, 2)
    kf.transitionMatrix = np.array(
        [[1, 0, 1, 0], [0, 1, 0, 1], [0, 0, 1, 0], [0, 0, 0, 1]], np.float32
    )

    kf.measurementMatrix = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], np.float32)

    kf.processNoiseCov = np.eye(4, dtype=np.float32) * 0.03
    kf.measurementNoiseCov = np.eye(2, dtype=np.float32) * 0.5
    return kf


# ============================================================
#  PNG OVERLAY (ALPHA BLENDING)
# ============================================================


def overlay_image_alpha(background, overlay, x, y):
    h, w = overlay.shape[:2]

    if x < 0 or y < 0:
        return
    if y + h > background.shape[0] or x + w > background.shape[1]:
        # Clamp overlay to background bounds.
        h = min(h, background.shape[0] - y)
        w = min(w, background.shape[1] - x)
        if h <= 0 or w <= 0:
            return
        overlay = overlay[:h, :w]

    if overlay.shape[2] == 4:
        alpha = overlay[:, :, 3] / 255.0
        overlay_rgb = overlay[:, :, :3]
    else:
        alpha = np.ones((h, w))
        overlay_rgb = overlay

    for c in range(3):
        background[y : y + h, x : x + w, c] = (
            alpha * overlay_rgb[:, :, c]
            + (1 - alpha) * background[y : y + h, x : x + w, c]
        )


# ============================================================
#  WHITE CANVAS DETECTION
# ============================================================


def detect_white_canvas(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 40, 120)

    kernel = np.ones((5, 5), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=2)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    best_quad = None
    best_score = 0

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 30000:
            continue

        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)

        if len(approx) != 4:
            continue

        x, y, w, h = cv2.boundingRect(approx)
        aspect = w / float(h)
        if not (0.4 < aspect < 2.5):
            continue

        cx = x + w / 2
        cy = y + h / 2
        frame_h, frame_w = frame.shape[:2]
        center_dist = abs(cx - frame_w / 2) + abs(cy - frame_h / 2)

        score = area - center_dist

        if score > best_score:
            best_score = score
            best_quad = approx.reshape(4, 2)

    return best_quad, edges


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

    window = draw_mask[y0 : y1 + 1, x0 : x1 + 1]
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
    ws.send('{"type":"register","role":"vision","client":"vision"}')
    return ws


def ws_send_cmd(ws, cmd, ms):
    print(f"WS cmd -> {cmd} {ms}ms")
    ws.send(f'{{"type":"cmd","cmd":"{cmd}","ms":{ms}}}')


# ============================================================
#  MAIN PROGRAM
# ============================================================


def main():
    cap = cv2.VideoCapture(0)
    kalman = create_kalman()

    png_overlay = cv2.imread(PNG_PATH, cv2.IMREAD_UNCHANGED)
    if png_overlay is None:
        raise RuntimeError(f"Failed to load {PNG_PATH}")

    lower_blue = np.array([85, 50, 40])
    upper_blue = np.array([140, 255, 255])
    MIN_AREA = 300

    ws = None
    last_cmd_ms = 0
    last_ping = 0
    last_ws_attempt = 0
    last_stream_ts = 0.0

    canvas_locked = False
    canvas_poly = None
    prev_gray = None

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Blue object detection (raw frame)
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask_blue = cv2.inRange(hsv, lower_blue, upper_blue)
        mask_blue = cv2.morphologyEx(
            mask_blue, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)
        )
        mask_blue = cv2.dilate(mask_blue, None, iterations=2)

        contours, _ = cv2.findContours(
            mask_blue, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        measured = None
        blue_center = None
        x_b = y_b = w_b = h_b = 0

        if contours:
            largest = max(contours, key=cv2.contourArea)
            if cv2.contourArea(largest) > MIN_AREA:
                x_b, y_b, w_b, h_b = cv2.boundingRect(largest)
                cx = x_b + w_b // 2
                cy = y_b + h_b // 2
                blue_center = (cx, cy)

        prediction = kalman.predict()
        px = int(prediction[0, 0])
        py = int(prediction[1, 0])
        cv2.circle(frame, (px, py), 8, (0, 255, 0), 2)

        # Canvas detection + tracking
        canvas_edges = None
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if not canvas_locked:
            detected_poly, canvas_edges = detect_white_canvas(frame)

            if detected_poly is not None:
                canvas_poly = detected_poly.astype(np.float32)
                canvas_locked = True
                prev_gray = gray.copy()
        else:
            new_pts, status, _ = cv2.calcOpticalFlowPyrLK(
                prev_gray,
                gray,
                canvas_poly.reshape(-1, 1, 2),
                None,
                winSize=(21, 21),
                maxLevel=3,
                criteria=(
                    cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT,
                    30,
                    0.01,
                ),
            )

            if status.sum() == 4:
                canvas_poly = new_pts.reshape(4, 2)
            else:
                canvas_locked = False

            prev_gray = gray.copy()

        canvas_box = None
        draw_mask = None
        desired_pen = None

        if canvas_locked and canvas_poly is not None:
            cv2.polylines(frame, [canvas_poly.astype(int)], True, (0, 255, 0), 2)

            x, y, w, h = cv2.boundingRect(canvas_poly.astype(int))
            canvas_box = (x, y, w, h)

            resized_png = cv2.resize(png_overlay, (w, h))
            overlay_image_alpha(frame, resized_png, x, y)
            draw_mask = build_draw_mask(resized_png)

            # Map robot position to overlay coordinates
            local_x = px - x
            local_y = py - y

            # Decide pen state (visual only; firmware keeps pen down)
            if draw_mask is not None and is_draw_pixel(draw_mask, local_x, local_y):
                desired_pen = "down"
                cv2.circle(frame, (px, py), 10, (255, 255, 255), 2)
            else:
                desired_pen = "up"

            # Only update blue detection if inside canvas
            if blue_center is not None:
                inside = cv2.pointPolygonTest(canvas_poly, blue_center, False) >= 0
                if inside:
                    cx, cy = blue_center
                    measured = np.array([[np.float32(cx)], [np.float32(cy)]])
                    kalman.correct(measured)
                    cv2.rectangle(
                        frame, (x_b, y_b), (x_b + w_b, y_b + h_b), (0, 0, 255), 2
                    )
                    cv2.circle(frame, (cx, cy), 5, (0, 0, 255), -1)

            now = int(time.time() * 1000)
            if now - last_cmd_ms > CMD_INTERVAL_MS:
                # Connect WS if needed
                if ws is None and (time.time() - last_ws_attempt) > 2:
                    last_ws_attempt = time.time()
                    try:
                        ws = ws_connect()
                        print(f"WS connected: {WS_URL}")
                    except Exception as error:
                        print(f"WS connect failed: {error}")
                        ws = None
                if ws is not None:
                    try:
                        # Find a nearby draw pixel to move toward
                        target = find_nearest_draw_pixel(
                            draw_mask, local_x, local_y, radius=30
                        )
                        if target is not None:
                            tx, ty = target
                            dx = tx - local_x
                            dy = ty - local_y
                            cv2.circle(frame, (x + tx, y + ty), 6, (255, 0, 255), 2)

                            if abs(dx) > X_TURN_THRESHOLD:
                                ws_send_cmd(
                                    ws,
                                    CMD_TURN_RIGHT if dx > 0 else CMD_TURN_LEFT,
                                    TURN_MS,
                                )
                            elif abs(dy) > Y_MOVE_THRESHOLD:
                                # forward is negative y in the image
                                forward = dy < 0 if FORWARD_IS_NEGATIVE_Y else dy > 0
                                ws_send_cmd(
                                    ws,
                                    CMD_FORWARD if forward else CMD_BACK,
                                    MOVE_MS,
                                )
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

        # HUD text
        ws_status = "connected" if ws is not None else "disconnected"
        canvas_status = "yes" if canvas_box is not None else "no"
        pen_status = "down" if desired_pen == "down" else "up"
        cv2.putText(
            frame,
            f"WS: {ws_status}",
            (12, 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 0),
            2,
        )
        cv2.putText(
            frame,
            f"Canvas: {canvas_status}",
            (12, 46),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 0),
            2,
        )
        cv2.putText(
            frame,
            f"Pen: {pen_status}",
            (12, 70),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 0),
            2,
        )

        # Display
        cv2.imshow("Frame", frame)
        if not canvas_locked and canvas_edges is not None:
            cv2.imshow("Canvas Edges", canvas_edges)
        cv2.imshow("Blue Mask", mask_blue)
        if draw_mask is not None:
            cv2.imshow("Draw Mask", draw_mask * 255)

        # Stream annotated frame to UI (MJPEG over WS)
        if ws is not None and (time.time() - last_stream_ts) > (1 / STREAM_FPS):
            try:
                h, w = frame.shape[:2]
                target_w = min(STREAM_WIDTH, w)
                target_h = int(h * (target_w / w))
                resized = cv2.resize(frame, (target_w, target_h))
                ok, buf = cv2.imencode(
                    ".jpg",
                    resized,
                    [cv2.IMWRITE_JPEG_QUALITY, STREAM_JPEG_QUALITY],
                )
                if ok:
                    payload = {
                        "type": "vision_frame",
                        "format": "jpeg",
                        "data": base64.b64encode(buf).decode("ascii"),
                    }
                    ws.send(json.dumps(payload))
                    last_stream_ts = time.time()
            except Exception:
                ws = None

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
