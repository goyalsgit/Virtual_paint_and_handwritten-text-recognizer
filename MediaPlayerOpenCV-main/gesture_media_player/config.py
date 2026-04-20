from dataclasses import dataclass


@dataclass(frozen=True)
class GestureConfig:
    camera_index: int = 0
    camera_width: int = 640
    camera_height: int = 360
    min_detection_confidence: float = 0.7
    min_tracking_confidence: float = 0.6
    gesture_cooldown_sec: float = 1.1
    swipe_cooldown_sec: float = 1.4
    swipe_window_sec: float = 0.55
    swipe_min_distance: float = 0.18


@dataclass(frozen=True)
class PlayerConfig:
    skip_small_ms: int = 10_000
    skip_large_ms: int = 20_000
    speed_step: float = 0.25
    min_speed: float = 0.5
    max_speed: float = 2.0
