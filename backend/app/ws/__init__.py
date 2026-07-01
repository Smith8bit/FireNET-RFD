# WebSocket subsystem: connection management (manager.py), Postgres
# LISTEN/NOTIFY bridging (pg_listener.py), and per-domain command handlers
# (dispatcher_handlers.py, officers/). No re-exports here; consumers import
# directly from these submodules to avoid import cycles with the WS router.
