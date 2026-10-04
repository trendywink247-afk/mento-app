"""Explicit operator commands; serving never initializes or exports a store."""

import argparse
import os
from pathlib import Path

from .store import Store, initialize, publish_export


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["init", "serve", "export"])
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--port", type=int, default=18090)
    parser.add_argument("--host", choices=["127.0.0.1", "0.0.0.0"], default="127.0.0.1")
    arguments = parser.parse_args()
    if arguments.command == "init":
        initialize(arguments.database)
        print("New receipt store initialized; historical coverage is unverified")
    elif arguments.command == "export":
        if arguments.output is None:
            parser.error("export requires --output NEW_PRIVATE_FILE")
        publish_export(Store(arguments.database), arguments.output)
        print("Receipt export published; encrypt before off-host transfer")
    else:
        import uvicorn

        from .receiver import create_app

        app = create_app(
            arguments.database,
            os.environ.get("RECEIVER_TOKEN", ""),
            os.environ.get("RECEIVER_PREVIOUS_TOKEN"),
        )
        # TLS/authenticated routing belongs to the separately accepted edge config.
        # No request access log: only the generic startup/shutdown server messages.
        # Container deployment explicitly binds its private interface; the host
        # publication remains loopback-only. Standalone serving defaults loopback.
        uvicorn.run(app, host=arguments.host, port=arguments.port, access_log=False)


if __name__ == "__main__":
    main()
