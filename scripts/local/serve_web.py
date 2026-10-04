"""Serve an exported SPA from this checkout, exclusively on loopback :18081."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


def export_directory(value):
    path = Path(value)
    path = (path if path.is_absolute() else ROOT / path).resolve()
    allowed = {ROOT / "apps/mobile/dist", ROOT / "apps/mobile/dist-own"}
    if path not in allowed or not (path / "index.html").is_file():
        raise ValueError("Serve only this checkout's exported dist or dist-own directory")
    return path


class SpaHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = Path(self.translate_path(self.path)).resolve()
        directory = Path(self.directory).resolve()
        if not path.is_relative_to(directory):
            self.send_error(403, "Outside export directory")
            return None
        if not path.exists() and not Path(urlsplit(self.path).path).suffix:
            self.path = "/index.html"
        return super().send_head()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument("--port", type=int, choices=[18081], default=18081)
    args = parser.parse_args()
    directory = export_directory(args.directory)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(SpaHandler, directory=str(directory)))
    print("Isolated exported SPA listening on http://localhost:18081", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
