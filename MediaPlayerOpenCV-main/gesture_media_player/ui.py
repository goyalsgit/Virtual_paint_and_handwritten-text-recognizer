from __future__ import annotations

import argparse
import queue
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import cv2
from PIL import Image, ImageTk

from .config import GestureConfig, PlayerConfig
from .gestures import GestureDetection
from .hand_tracker import HandTracker
from .player import MediaPlayerController


class GestureMediaPlayerApp:
    def __init__(self, root: tk.Tk, camera_index: int = 0) -> None:
        self.root = root
        self.root.title("MediaPipe Gesture Media Player")
        self.root.geometry("1360x820")
        self.root.minsize(1180, 720)
        self.root.configure(bg="#111827")

        self.command_queue: "queue.Queue[GestureDetection]" = queue.Queue()
        self.player_config = PlayerConfig()
        self.player = MediaPlayerController(self.player_config)
        self.tracker = HandTracker(
            GestureConfig(camera_index=camera_index),
            command_queue=self.command_queue,
        )

        self.selected_file_var = tk.StringVar(value="No video selected")
        self.gesture_var = tk.StringVar(value="Waiting for hand...")
        self.status_var = tk.StringVar(value="Open a video file to start playback.")
        self.rate_var = tk.StringVar(value="1.00x")
        self.time_var = tk.StringVar(value="00:00 / 00:00")
        self.progress_var = tk.DoubleVar(value=0.0)
        self._dragging_progress = False
        self._webcam_image = None

        self._build_layout()
        self._apply_style()
        self.player.attach_video_frame(self.video_panel)
        self.tracker.start()

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.root.after(50, self._poll_gesture_commands)
        self.root.after(60, self._refresh_webcam_preview)
        self.root.after(200, self._refresh_player_state)

    def _build_layout(self) -> None:
        container = tk.Frame(self.root, bg="#111827")
        container.pack(fill="both", expand=True, padx=18, pady=18)
        container.grid_columnconfigure(0, weight=5)
        container.grid_columnconfigure(1, weight=2)
        container.grid_rowconfigure(0, weight=1)

        left_panel = tk.Frame(container, bg="#111827")
        left_panel.grid(row=0, column=0, sticky="nsew", padx=(0, 16))
        left_panel.grid_columnconfigure(0, weight=1)
        left_panel.grid_rowconfigure(1, weight=1)

        right_panel = tk.Frame(container, bg="#0f172a")
        right_panel.grid(row=0, column=1, sticky="nsew")
        right_panel.grid_columnconfigure(0, weight=1)

        self._build_header(left_panel)
        self._build_video_area(left_panel)
        self._build_controls(left_panel)
        self._build_sidebar(right_panel)

    def _build_header(self, parent: tk.Widget) -> None:
        header = tk.Frame(parent, bg="#111827")
        header.grid(row=0, column=0, sticky="ew", pady=(0, 14))
        header.grid_columnconfigure(0, weight=1)

        title = tk.Label(
            header,
            text="Gesture Media Player",
            font=("Segoe UI Semibold", 24),
            bg="#111827",
            fg="#f8fafc",
        )
        title.grid(row=0, column=0, sticky="w")

        subtitle = tk.Label(
            header,
            text="Control local videos with MediaPipe hand gestures and the desktop controls below.",
            font=("Segoe UI", 10),
            bg="#111827",
            fg="#94a3b8",
        )
        subtitle.grid(row=1, column=0, sticky="w", pady=(4, 0))

        open_button = ttk.Button(header, text="Open Video", command=self.open_video)
        open_button.grid(row=0, column=1, rowspan=2, sticky="e")

    def _build_video_area(self, parent: tk.Widget) -> None:
        video_card = tk.Frame(parent, bg="#0f172a", highlightthickness=1, highlightbackground="#1e293b")
        video_card.grid(row=1, column=0, sticky="nsew")
        video_card.grid_columnconfigure(0, weight=1)
        video_card.grid_rowconfigure(0, weight=1)

        self.video_panel = tk.Frame(video_card, bg="black")
        self.video_panel.grid(row=0, column=0, sticky="nsew", padx=12, pady=12)

        footer = tk.Frame(video_card, bg="#0f172a")
        footer.grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 14))
        footer.grid_columnconfigure(0, weight=1)

        file_label = tk.Label(
            footer,
            textvariable=self.selected_file_var,
            font=("Segoe UI", 10),
            bg="#0f172a",
            fg="#cbd5e1",
            anchor="w",
        )
        file_label.grid(row=0, column=0, sticky="ew")

        time_label = tk.Label(
            footer,
            textvariable=self.time_var,
            font=("Consolas", 10),
            bg="#0f172a",
            fg="#f8fafc",
        )
        time_label.grid(row=0, column=1, sticky="e")

    def _build_controls(self, parent: tk.Widget) -> None:
        controls = tk.Frame(parent, bg="#111827")
        controls.grid(row=2, column=0, sticky="ew", pady=(14, 0))
        controls.grid_columnconfigure(0, weight=1)

        slider = ttk.Scale(
            controls,
            from_=0,
            to=1000,
            variable=self.progress_var,
            orient="horizontal",
        )
        slider.grid(row=0, column=0, columnspan=7, sticky="ew", pady=(0, 12))
        slider.bind("<ButtonPress-1>", self._on_progress_press)
        slider.bind("<ButtonRelease-1>", self._on_progress_release)

        ttk.Button(controls, text="Play", command=self.play).grid(row=1, column=0, padx=(0, 8), sticky="ew")
        ttk.Button(controls, text="Pause", command=self.pause).grid(row=1, column=1, padx=8, sticky="ew")
        ttk.Button(controls, text="-10s", command=lambda: self.seek(-self.player_config.skip_small_ms)).grid(
            row=1, column=2, padx=8, sticky="ew"
        )
        ttk.Button(controls, text="+10s", command=lambda: self.seek(self.player_config.skip_small_ms)).grid(
            row=1, column=3, padx=8, sticky="ew"
        )
        ttk.Button(controls, text="Speed -", command=self.speed_down).grid(row=1, column=4, padx=8, sticky="ew")
        ttk.Button(controls, text="Speed +", command=self.speed_up).grid(row=1, column=5, padx=8, sticky="ew")

        speed_label = tk.Label(
            controls,
            textvariable=self.rate_var,
            font=("Segoe UI Semibold", 11),
            bg="#111827",
            fg="#f8fafc",
        )
        speed_label.grid(row=1, column=6, sticky="e")

    def _build_sidebar(self, parent: tk.Widget) -> None:
        title = tk.Label(
            parent,
            text="Live Gesture Console",
            font=("Segoe UI Semibold", 18),
            bg="#0f172a",
            fg="#f8fafc",
        )
        title.grid(row=0, column=0, sticky="w", padx=16, pady=(16, 8))

        webcam_frame = tk.Frame(parent, bg="#020617", highlightthickness=1, highlightbackground="#1e293b")
        webcam_frame.grid(row=1, column=0, sticky="ew", padx=16)
        self.webcam_label = tk.Label(
            webcam_frame,
            text="Starting webcam...",
            font=("Segoe UI", 11),
            bg="#020617",
            fg="#cbd5e1",
            width=38,
            height=16,
        )
        self.webcam_label.pack(fill="both", expand=True, padx=10, pady=10)

        gesture_header = tk.Label(
            parent,
            text="Detected Gesture",
            font=("Segoe UI", 11),
            bg="#0f172a",
            fg="#94a3b8",
        )
        gesture_header.grid(row=2, column=0, sticky="w", padx=16, pady=(14, 4))

        gesture_value = tk.Label(
            parent,
            textvariable=self.gesture_var,
            font=("Segoe UI Semibold", 16),
            bg="#0f172a",
            fg="#38bdf8",
        )
        gesture_value.grid(row=3, column=0, sticky="w", padx=16)

        status_header = tk.Label(
            parent,
            text="Player Status",
            font=("Segoe UI", 11),
            bg="#0f172a",
            fg="#94a3b8",
        )
        status_header.grid(row=4, column=0, sticky="w", padx=16, pady=(14, 4))

        status_label = tk.Label(
            parent,
            textvariable=self.status_var,
            font=("Segoe UI", 11),
            bg="#0f172a",
            fg="#e2e8f0",
            wraplength=320,
            justify="left",
        )
        status_label.grid(row=5, column=0, sticky="w", padx=16)

        legend = tk.Label(
            parent,
            text=(
                "Gesture Legend\n"
                "Open Palm  -> Play\n"
                "Closed Fist -> Pause\n"
                "Thumb Up -> +10s\n"
                "Thumb Down -> -10s\n"
                "Victory Sign -> Speed +\n"
                "Index Finger -> Speed -\n"
                "Swipe Right -> +20s\n"
                "Swipe Left -> -20s"
            ),
            font=("Consolas", 10),
            bg="#111827",
            fg="#cbd5e1",
            justify="left",
            padx=14,
            pady=14,
        )
        legend.grid(row=6, column=0, sticky="ew", padx=16, pady=(18, 16))

    def _apply_style(self) -> None:
        style = ttk.Style(self.root)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure(
            "TButton",
            font=("Segoe UI Semibold", 10),
            padding=(12, 8),
        )
        style.configure(
            "Horizontal.TScale",
            troughcolor="#1e293b",
            background="#38bdf8",
        )

    def open_video(self) -> None:
        file_path = filedialog.askopenfilename(
            title="Select a video file",
            filetypes=[
                ("Video files", "*.mp4 *.avi *.mkv *.mov *.wmv *.flv"),
                ("All files", "*.*"),
            ],
        )
        if not file_path:
            return

        try:
            self.player.load(file_path)
        except Exception as exc:
            messagebox.showerror("Video Error", f"Could not load the video.\n\n{exc}")
            self.status_var.set("Failed to load the selected video.")
            return

        self.selected_file_var.set(Path(file_path).name)
        self.status_var.set("Video loaded. Gesture control is active.")
        self.gesture_var.set("Ready")
        self.rate_var.set(f"{self.player.current_rate:.2f}x")

    def play(self) -> None:
        if not self.player.has_media():
            self.status_var.set("Load a video first, then use the player controls or gestures.")
            return
        self.player.play()
        self.status_var.set("Playing video.")

    def pause(self) -> None:
        if not self.player.has_media():
            self.status_var.set("Load a video first, then use the player controls or gestures.")
            return
        self.player.pause()
        self.status_var.set("Video paused.")

    def seek(self, delta_ms: int) -> None:
        if not self.player.has_media():
            self.status_var.set("Load a video first, then use gesture seeking.")
            return
        self.player.seek_relative(delta_ms)
        direction = "forward" if delta_ms >= 0 else "backward"
        self.status_var.set(f"Seeked {direction} by {abs(delta_ms) // 1000} seconds.")

    def speed_up(self) -> None:
        if not self.player.has_media():
            self.status_var.set("Load a video first, then adjust playback speed.")
            return
        rate = self.player.increase_rate()
        self.rate_var.set(f"{rate:.2f}x")
        self.status_var.set(f"Playback speed increased to {rate:.2f}x.")

    def speed_down(self) -> None:
        if not self.player.has_media():
            self.status_var.set("Load a video first, then adjust playback speed.")
            return
        rate = self.player.decrease_rate()
        self.rate_var.set(f"{rate:.2f}x")
        self.status_var.set(f"Playback speed reduced to {rate:.2f}x.")

    def _poll_gesture_commands(self) -> None:
        while True:
            try:
                detection = self.command_queue.get_nowait()
            except queue.Empty:
                break
            self._handle_gesture_command(detection)
        self.root.after(50, self._poll_gesture_commands)

    def _handle_gesture_command(self, detection: GestureDetection) -> None:
        self.gesture_var.set(detection.label)
        command = detection.command

        if command == "play":
            self.play()
        elif command == "pause":
            self.pause()
        elif command == "speed_up":
            self.speed_up()
        elif command == "speed_down":
            self.speed_down()
        elif command == "seek_forward_small":
            self.seek(self.player_config.skip_small_ms)
        elif command == "seek_backward_small":
            self.seek(-self.player_config.skip_small_ms)
        elif command == "seek_forward_large":
            self.seek(self.player_config.skip_large_ms)
        elif command == "seek_backward_large":
            self.seek(-self.player_config.skip_large_ms)

    def _refresh_webcam_preview(self) -> None:
        frame, label, error = self.tracker.get_latest_preview()
        if frame is not None:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = Image.fromarray(rgb_frame).resize((360, 240))
            photo = ImageTk.PhotoImage(image=image)
            self.webcam_label.configure(image=photo, text="")
            self.webcam_label.image = photo
            self._webcam_image = photo
            if label and label != "Hand detected":
                self.gesture_var.set(label)
        elif error:
            self.webcam_label.configure(image="", text=error)
            self.status_var.set(error)

        self.root.after(60, self._refresh_webcam_preview)

    def _refresh_player_state(self) -> None:
        duration = self.player.get_duration_ms()
        current = self.player.get_position_ms()
        self.time_var.set(
            f"{self.player.format_time(current)} / {self.player.format_time(duration)}"
        )
        self.rate_var.set(f"{self.player.current_rate:.2f}x")

        if duration > 0 and not self._dragging_progress:
            self.progress_var.set((current / duration) * 1000)

        self.root.after(200, self._refresh_player_state)

    def _on_progress_press(self, _event) -> None:
        self._dragging_progress = True

    def _on_progress_release(self, _event) -> None:
        duration = self.player.get_duration_ms()
        if duration > 0:
            position_ms = int((self.progress_var.get() / 1000) * duration)
            self.player.set_position_ms(position_ms)
        self._dragging_progress = False

    def on_close(self) -> None:
        self.tracker.stop()
        self.player.stop()
        self.root.destroy()


def launch_app() -> None:
    parser = argparse.ArgumentParser(description="Gesture-controlled media player")
    parser.add_argument("--camera-index", type=int, default=0, help="Webcam index to use")
    args = parser.parse_args()

    root = tk.Tk()
    GestureMediaPlayerApp(root, camera_index=args.camera_index)
    root.mainloop()
