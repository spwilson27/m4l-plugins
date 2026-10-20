// tsplit_ui.js falls back to a `global` object (Node / older runtimes) when Max's Global() is unavailable.
declare var global: { __tsplit_shared_bus?: any } | undefined;
