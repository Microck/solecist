# Solecism

Solecism is a private-server Discord bot that watches configured debate channels and posts compact, tentative logical-fallacy callouts powered by an OpenAI-compatible LLM endpoint.

It is designed as a reasoning coach, not a moderation system. It replies to specific messages with a neutral embed that names the possible fallacy, quotes the exact claim, and gives a short explanation.

## Current Scope

- Discord slash command: `/solecism`
- Automatic tracking only in configured text channels
- Admin-only setup, manual checks, manual start/stop, and emergency stop
- OpenAI-compatible model endpoints such as NVIDIA NIM, Ollama, LM Studio, or vLLM
- SQLite persistence for config, raw discussion context, summaries, events, and feedback
- English or Spanish reply language configured per server

V1 intentionally does not support Discord threads, public dashboards, punishment/moderation actions, or fact-checking.

## Quick Start

```bash
cp .env.example .env
npm install
npm run build
npm run dev
```

For Docker:

```bash
cp .env.example .env
docker compose up --build
```

The LLM endpoint must speak the OpenAI chat completions shape at `/v1/chat/completions`.

## Environment

```bash
DISCORD_TOKEN=replace-me
DISCORD_CLIENT_ID=replace-me
DISCORD_GUILD_ID=replace-me
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_API_KEY=replace-me
LLM_MODEL=meta/llama-3.3-70b-instruct
SMALL_LLM_MODEL=meta/llama-3.3-70b-instruct
DATABASE_PATH=./data/solecism.sqlite
DATABASE_MAX_BYTES=104857600
```

`DISCORD_GUILD_ID` is optional. If unset, slash commands are registered globally and may take longer to appear. Use a guild ID while testing.

## Discord Setup

Enable these in the Discord Developer Portal:

- Message Content Intent
- OAuth scopes: `bot`, `applications.commands`
- Bot permissions: View Channels, Send Messages, Read Message History, Use Slash Commands, Embed Links

After inviting the bot:

1. Run `/solecism setup` and choose language plus sensitivity.
2. Run `/solecism enable-channel` for each debate channel.
3. Use `/solecism start` in a channel to force tracking on during testing.
4. Use `/solecism emergency-stop` if the bot needs to stop speaking server-wide.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The project uses Node 24's built-in `node:sqlite` module, which currently emits an experimental warning.
