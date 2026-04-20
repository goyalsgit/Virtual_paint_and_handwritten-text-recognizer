from __future__ import annotations

from pathlib import Path
from typing import Optional

import vlc

from .config import PlayerConfig


class MediaPlayerController:
    def __init__(self, config: PlayerConfig) -> None:
        self.config = config
        self.instance = vlc.Instance()
        self.player = self.instance.media_player_new()
        self.current_file: Optional[Path] = None
        self._video_frame = None
        self.current_rate = 1.0

    def attach_video_frame(self, widget) -> None:
        self._video_frame = widget
        widget.update_idletasks()
        self.player.set_hwnd(widget.winfo_id())

    def load(self, file_path: str) -> None:
        media = self.instance.media_new(file_path)
        self.player.set_media(media)
        self.current_file = Path(file_path)
        if self._video_frame is not None:
            self.player.set_hwnd(self._video_frame.winfo_id())
        self.current_rate = 1.0
        self.play()

    def play(self) -> None:
        self.player.play()
        self.player.set_rate(self.current_rate)

    def pause(self) -> None:
        self.player.set_pause(1)

    def stop(self) -> None:
        self.player.stop()

    def toggle(self) -> None:
        if self.is_playing():
            self.pause()
        else:
            self.play()

    def is_playing(self) -> bool:
        return bool(self.player.is_playing())

    def has_media(self) -> bool:
        return self.current_file is not None

    def get_duration_ms(self) -> int:
        duration = self.player.get_length()
        return max(duration, 0)

    def get_position_ms(self) -> int:
        position = self.player.get_time()
        return max(position, 0)

    def set_position_ms(self, position_ms: int) -> None:
        duration = self.get_duration_ms()
        if duration <= 0:
            return
        bounded = max(0, min(position_ms, duration))
        self.player.set_time(int(bounded))

    def seek_relative(self, delta_ms: int) -> None:
        self.set_position_ms(self.get_position_ms() + delta_ms)

    def set_rate(self, new_rate: float) -> float:
        bounded = max(self.config.min_speed, min(new_rate, self.config.max_speed))
        self.current_rate = round(bounded, 2)
        self.player.set_rate(self.current_rate)
        return self.current_rate

    def increase_rate(self) -> float:
        return self.set_rate(self.current_rate + self.config.speed_step)

    def decrease_rate(self) -> float:
        return self.set_rate(self.current_rate - self.config.speed_step)

    @staticmethod
    def format_time(milliseconds: int) -> str:
        total_seconds = max(milliseconds // 1000, 0)
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        if hours:
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        return f"{minutes:02d}:{seconds:02d}"
