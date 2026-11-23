"""OS-backed process lock shared by realtime capture and bounded backfill."""
from __future__ import annotations

import os
from pathlib import Path

DESKTOP_LOCK_PATH = Path(os.environ.get("HUOJI_CAPTURE_LOCK_PATH") or
                         Path(__file__).resolve().parent / ".data" / "desktop.capture.lock")


class CaptureBusy(RuntimeError):
    pass


def lock_path(state_path: Path) -> Path:
    return Path(str(state_path.resolve()) + ".capture.lock")


class CaptureLock:
    def __init__(self, state_path: Path):
        self.path = lock_path(state_path)
        self.paths = [DESKTOP_LOCK_PATH, self.path]
        self.files = []

    def __enter__(self):
        try:
            for path in self.paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                stream = open(path, "a+b")
                try:
                    stream.seek(0, os.SEEK_END)
                    if not stream.tell():
                        stream.write(b"\0")
                        stream.flush()
                    stream.seek(0)
                    if os.name == "nt":
                        import msvcrt
                        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BaseException:
                    stream.close()
                    raise
                self.files.append(stream)
        except BaseException as exc:
            self.__exit__()
            if isinstance(exc, OSError):
                raise CaptureBusy("CAPTURE_LOCK_BUSY") from exc
            raise
        return self

    def __exit__(self, *args):
        for stream in reversed(self.files):
            try:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass  # closing the handle also releases its OS lock
            finally:
                stream.close()
        self.files = []
