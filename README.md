<div align="center">
  <img src=".github/assets/solecism-logo.svg" alt="solecism logo" width="520">
</div>

<p align="center">
  <img src="https://img.shields.io/badge/node-24%2B-000000?style=flat-square" alt="node badge">
  <img src="https://img.shields.io/badge/discord.js-14-000000?style=flat-square" alt="discord.js badge">
  <img src="https://img.shields.io/badge/docker-ready-000000?style=flat-square" alt="docker badge">
  <img src="https://img.shields.io/badge/license-private-000000?style=flat-square" alt="license badge">
</p>

---

`solecism` is a private-server discord bot that watches configured debate channels and calls out likely logical fallacies with short, tentative replies. it uses cheap local message-shape filters first, then an openai-compatible model endpoint only when a message looks like part of a real argument.

the bot is a reasoning coach, not a moderator. it does not delete messages, punish users, fact-check claims, or decide who is right. when it speaks, it replies to the original message with a compact embed that names the possible fallacy, quotes the exact claim, and gives one short explanation.

## why

most debate bots either respond to every message or wait for explicit commands. both are awkward for normal discord chat. `solecism` sits between those modes: it only watches channels admins enable, ignores casual chatter, confirms debate-shaped context, and backs off when the model provider is slow or rate-limited.

that makes the first version useful for small servers where people want a live reasoning assistant without turning the channel into a moderation queue.

## what it does

- tracks only admin-configured text channels
- ignores discord threads in v1
- skips short reactions, links, simple questions, and non-argument-shaped messages
- confirms debate context before assessing a target message
- supports english or spanish reply language per server
- stores config, raw context, summaries, events, and feedback in sqlite
- works with nvidia nim, ollama, lm studio, vllm, and other openai-compatible endpoints
- caches debate classification per channel and backs off after provider failures

## commands

all commands live under `/solecism` and require discord administrator permissions.

| command | purpose |
| --- | --- |
| `/solecism setup` | choose server language and sensitivity |
| `/solecism status` | show setup state, enabled channels, and database size |
| `/solecism enable-channel` | enable automatic tracking in a text channel |
| `/solecism disable-channel` | remove a channel from automatic tracking |
| `/solecism start` | force tracking on in the current channel |
| `/solecism stop` | force tracking off in the current channel |
| `/solecism emergency-stop` | stop automatic callouts server-wide |
| `/solecism check` | manually inspect a message id |

## first run

```bash
cp .env.example .env
$EDITOR .env
docker compose up -d --build
docker compose logs -f --tail 80 solecism
```

then in discord:

```text
/solecism setup
/solecism enable-channel
/solecism status
```

use `DISCORD_GUILD_ID` while testing so command updates appear immediately. if it is unset, slash commands are registered globally and may take longer to appear.

## discord setup

enable this privileged intent in the discord developer portal:

- message content intent

oauth scopes:

- `bot`
- `applications.commands`

bot permissions:

- view channels
- send messages
- read message history
- use slash commands
- embed links

## configuration

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

the model endpoint must support the openai-style `/v1/chat/completions` contract. for local ollama, point `LLM_BASE_URL` at the ollama `/v1` endpoint and use any installed chat model.

## local development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

common paths:

| path | purpose |
| --- | --- |
| `.env` | local secrets and runtime configuration |
| `data/solecism.sqlite` | sqlite database used by docker/local runs |
| `src/` | bot, engine, llm adapter, storage, and tests |

## operational notes

- automatic mode fails silent in discord when the provider is down or rate-limited
- provider failures trigger per-channel backoff instead of retrying on every message
- debate classification is cached briefly per channel to reduce model calls
- manual `/solecism check` can inspect any message, but automatic mode only assesses argument-shaped messages
- node 24's built-in `node:sqlite` module currently emits an experimental warning
