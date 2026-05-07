# Solecism

Discord bot for detecting likely logical fallacies in configured debate channels.

Solecism watches normal Discord messages, waits for discussion-shaped context, and posts short tentative callouts when a specific message appears to contain a logical fallacy. It is a reasoning coach, not a moderation bot: it does not delete messages, punish users, fact-check claims, or decide who is right.

## What It Does

- tracks only admin-configured text channels
- uses cheap message-shape filters before calling an LLM
- confirms debate context before assessing fallacies
- replies with a compact embed that includes label, exact quote, and short explanation
- supports English or Spanish reply language per server
- stores server config, raw context, summaries, events, and feedback in SQLite
- works with OpenAI-compatible endpoints such as NVIDIA NIM, Ollama, LM Studio, or vLLM
- backs off when the model provider returns rate limits or times out

## Commands

All commands are under `/solecism` and require Discord administrator permissions.

- `/solecism setup`
- `/solecism status`
- `/solecism enable-channel`
- `/solecism disable-channel`
- `/solecism start`
- `/solecism stop`
- `/solecism emergency-stop`
- `/solecism check`

## Main Flow

1. An admin invites the bot with Message Content Intent enabled.
2. An admin runs `/solecism setup`.
3. An admin enables one or more debate channels with `/solecism enable-channel`.
4. Solecism stores incoming messages from those channels.
5. Cheap heuristics decide whether a message is argument-shaped.
6. A cached debate classifier decides whether the channel segment is actually a debate.
7. The fallacy assessor checks the target message with recent context.
8. If the result clears validation, Solecism replies to the original message.

## Discord Setup

Enable this in the Discord Developer Portal:

- Message Content Intent

Invite permissions:

- View Channels
- Send Messages
- Read Message History
- Use Slash Commands
- Embed Links

OAuth scopes:

- `bot`
- `applications.commands`

Use `DISCORD_GUILD_ID` while testing so slash command updates appear immediately. If it is unset, commands are registered globally and may take longer to appear.

## Local Development

### Requirements

- Node.js 24
- npm
- Docker and Docker Compose
- an OpenAI-compatible chat completions endpoint

### Install

```bash
npm install
```

### Common Files and Paths

- `.env`
- `data/solecism.sqlite`
- `src/`

### Scripts

```bash
npm run dev
npm run build
npm run typecheck
npm test
```

### Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f --tail 80 solecism
```

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

## Operational Notes

- Automatic mode fails silent in Discord when the LLM provider is down or rate-limited.
- Provider failures trigger a per-channel backoff instead of retrying on every message.
- Debate classification is cached briefly per channel to avoid burning provider quota.
- Manual `/solecism check` can inspect any message, but automatic mode only assesses argument-shaped messages.
- The project uses Node 24's built-in `node:sqlite` module, which currently emits an experimental warning.
