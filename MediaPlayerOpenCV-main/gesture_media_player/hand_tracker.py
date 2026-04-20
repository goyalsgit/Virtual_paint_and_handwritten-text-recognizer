from __future__ import annotations

import threading
from time import sleep
from typing import Optional

import cv2
import mediapipe as mp

from .config import GestureConfig
from .gestures import GestureDetection, GestureRecognizer


class HandTracker:
    def __init__(self, config: GestureConfig, command_queue) -> None:
        self.config = config
        self.command_queue = command_queue
        self._capture: Optional[cv2.VideoCapture] = None
        self._thread: Optional[threading.Thread] = None
        self._running = threading.Event()
        self._frame_lock = threading.Lock()
        self._latest_frame = None
        self._latest_label = "Waiting for hand..."
        self._latest_error: Optional[str] = None

        self.mp_hands = mp.solutions.hands
        self.mp_draw = mp.solutions.drawing_utils
        self.recognizer = GestureRecognizer(
            gesture_cooldown_sec=config.gesture_cooldown_sec,
            swipe_cooldown_sec=config.swipe_cooldown_sec,
            swipe_window_sec=config.swipe_window_sec,
            swipe_min_distance=config.swipe_min_distance,
        )

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._running.set()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running.clear()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        if self._capture is not None:
            self._capture.release()
            self._capture = None

    def get_latest_preview(self):
        with self._frame_lock:
            frame = None if self._latest_frame is None else self._latest_frame.copy()
            label = self._latest_label
            error = self._latest_error
        return frame, label, error

    def _run_loop(self) -> None:
        self._capture = cv2.VideoCapture(self.config.camera_index)
        self._capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.config.camera_width)
        self._capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config.camera_height)

        if not self._capture.isOpened():
            self._set_error("Unable to open webcam. Check camera permissions and index.")
            return

        with self.mp_hands.Hands(
            max_num_hands=1,
            min_detection_confidence=self.config.min_detection_confidence,
            min_tracking_confidence=self.config.min_tracking_confidence,
        ) as hands:
            while self._running.is_set():
                ok, frame = self._capture.read()
                if not ok:
                    self._set_error("Webcam frame could not be read.")
                    sleep(0.1)
                    continue

                frame = cv2.flip(frame, 1)
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = hands.process(rgb_frame)

                label = "Show a gesture"
                if results.multi_hand_landmarks and results.multi_handedness:
                    hand_landmarks = results.multi_hand_landmarks[0]
                    handedness = results.multi_handedness[0].classification[0].label
                    detection = self.recognizer.classify(hand_landmarks, handedness)
                    if detection is not None:
                        self.command_queue.put(detection)
                        label = detection.label
                    else:
                        label = "Hand detected"

                    self.mp_draw.draw_landmarks(
                        frame,
                        hand_landmarks,
                        self.mp_hands.HAND_CONNECTIONS,
                    )
                else:
                    self.recognizer.wrist_history.clear()

                self._set_preview(frame, label)
                sleep(0.01)

    def _set_preview(self, frame, label: str) -> None:
        with self._frame_lock:
            self._latest_frame = frame
            self._latest_label = label
            self._latest_error = None

    def _set_error(self, message: str) -> None:
        with self._frame_lock:
            self._latest_error = message
            self._latest_label = "Camera unavailable"
