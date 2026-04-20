from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from time import monotonic
from typing import Deque, Iterable, Optional


@dataclass(frozen=True)
class GestureDetection:
    command: str
    label: str


class GestureRecognizer:
    """Classifies static hand poses and simple swipe motion."""

    def __init__(
        self,
        gesture_cooldown_sec: float,
        swipe_cooldown_sec: float,
        swipe_window_sec: float,
        swipe_min_distance: float,
    ) -> None:
        self.gesture_cooldown_sec = gesture_cooldown_sec
        self.swipe_cooldown_sec = swipe_cooldown_sec
        self.swipe_window_sec = swipe_window_sec
        self.swipe_min_distance = swipe_min_distance
        self.command_cooldowns: dict[str, float] = {}
        self.wrist_history: Deque[tuple[float, float, float]] = deque()

    def classify(self, hand_landmarks, handedness_label: str) -> Optional[GestureDetection]:
        now = monotonic()
        static_detection = self._classify_static(hand_landmarks, handedness_label)
        if static_detection and self._ready_for(static_detection.command, now, self.gesture_cooldown_sec):
            return static_detection

        swipe_detection = self._classify_swipe(hand_landmarks, now)
        if swipe_detection and self._ready_for(swipe_detection.command, now, self.swipe_cooldown_sec):
            return swipe_detection
        return None

    def _ready_for(self, command: str, now: float, cooldown: float) -> bool:
        last_trigger = self.command_cooldowns.get(command, 0.0)
        if now - last_trigger < cooldown:
            return False
        self.command_cooldowns[command] = now
        return True

    def _classify_static(self, hand_landmarks, handedness_label: str) -> Optional[GestureDetection]:
        points = hand_landmarks.landmark
        wrist = points[0]
        thumb_tip, thumb_ip = points[4], points[3]
        index_tip, index_pip = points[8], points[6]
        middle_tip, middle_pip = points[12], points[10]
        ring_tip, ring_pip = points[16], points[14]
        pinky_tip, pinky_pip = points[20], points[18]

        fingers = {
            "thumb": self._is_thumb_extended(points, handedness_label),
            "index": index_tip.y < index_pip.y,
            "middle": middle_tip.y < middle_pip.y,
            "ring": ring_tip.y < ring_pip.y,
            "pinky": pinky_tip.y < pinky_pip.y,
        }

        if all(fingers.values()):
            return GestureDetection("play", "Open Palm")

        if not any(fingers.values()):
            return GestureDetection("pause", "Closed Fist")

        if fingers["thumb"] and not any(fingers[name] for name in ("index", "middle", "ring", "pinky")):
            if thumb_tip.y < thumb_ip.y and thumb_tip.y < wrist.y:
                return GestureDetection("seek_forward_small", "Thumb Up")
            if thumb_tip.y > thumb_ip.y and thumb_tip.y > wrist.y:
                return GestureDetection("seek_backward_small", "Thumb Down")

        if fingers["index"] and fingers["middle"] and not fingers["ring"] and not fingers["pinky"]:
            return GestureDetection("speed_up", "Victory Sign")

        if fingers["index"] and not any(fingers[name] for name in ("thumb", "middle", "ring", "pinky")):
            return GestureDetection("speed_down", "Index Finger")

        return None

    def _classify_swipe(self, hand_landmarks, now: float) -> Optional[GestureDetection]:
        wrist = hand_landmarks.landmark[0]
        self.wrist_history.append((wrist.x, wrist.y, now))

        cutoff = now - self.swipe_window_sec
        while self.wrist_history and self.wrist_history[0][2] < cutoff:
            self.wrist_history.popleft()

        if len(self.wrist_history) < 4:
            return None

        start_x, start_y, _ = self.wrist_history[0]
        end_x, end_y, _ = self.wrist_history[-1]
        delta_x = end_x - start_x
        delta_y = abs(end_y - start_y)

        if abs(delta_x) < self.swipe_min_distance or delta_y > 0.14:
            return None

        self.wrist_history.clear()
        if delta_x > 0:
            return GestureDetection("seek_forward_large", "Swipe Right")
        return GestureDetection("seek_backward_large", "Swipe Left")

    @staticmethod
    def _is_thumb_extended(points: Iterable, handedness_label: str) -> bool:
        points = list(points)
        thumb_tip = points[4]
        thumb_ip = points[3]
        thumb_mcp = points[2]
        if handedness_label == "Right":
            return thumb_tip.x < thumb_ip.x < thumb_mcp.x
        return thumb_tip.x > thumb_ip.x > thumb_mcp.x
