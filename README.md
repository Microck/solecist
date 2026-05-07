<h1 align="center">solecist</h1>

<p align="center">
  <img src="https://img.shields.io/badge/node-24%2B-000000?style=flat-square" alt="node badge">
  <img src="https://img.shields.io/badge/discord.js-14-000000?style=flat-square" alt="discord.js badge">
  <img src="https://img.shields.io/badge/docker-ready-000000?style=flat-square" alt="docker badge">
  <img src="https://img.shields.io/badge/license-private-000000?style=flat-square" alt="license badge">
</p>

---

`solecist` is a discord bot that helps debates stay focused by calling out likely logical fallacies as they happen. it watches configured discussion channels, looks for argument-shaped messages, and replies with short, tentative notes when a claim appears to use weak reasoning.

the point is not to win arguments for anyone. `solecist` is a reasoning coach, not a moderator: it does not delete messages, punish users, fact-check claims, or decide who is right. when it speaks, it replies to the original message with a compact embed that names the possible fallacy, quotes the exact claim, and gives one short explanation.

## why

debates often drift because bad reasoning is easier to miss than bad facts. a false dilemma, popularity appeal, moving goalpost, or ad hominem can derail a thread without looking like obvious spam or abuse.

`solecist` is built for that narrower job. it does not try to become an ai chat bot or moderation suite. it stays quiet during casual chat, waits for debate-shaped context, and only calls out a specific claim when it can quote the text it is criticizing.

## what it does

- calls out likely logical fallacies in admin-configured debate channels
- ignores discord threads in v1
- skips short reactions, links, simple questions, and non-argument-shaped messages
- confirms debate context before assessing a target claim
- requires an exact quote before posting a public callout
- supports english or spanish reply language per server
- stores config, raw context, summaries, events, and feedback in sqlite
- works with nvidia nim, ollama, lm studio, vllm, and other openai-compatible endpoints
- caches debate classification per channel and backs off after provider failures

## commands

all commands live under `/solecist` and require discord administrator permissions.

| command | purpose |
| --- | --- |
| `/solecist setup` | choose server language and sensitivity |
| `/solecist status` | show setup state, enabled channels, and database size |
| `/solecist enable-channel` | enable automatic tracking in a text channel |
| `/solecist disable-channel` | remove a channel from automatic tracking |
| `/solecist start` | force tracking on in the current channel |
| `/solecist stop` | force tracking off in the current channel |
| `/solecist emergency-stop` | stop automatic callouts server-wide |
| `/solecist check` | manually inspect a message id |

## first run

```bash
cp .env.example .env
$EDITOR .env
docker compose up -d --build
docker compose logs -f --tail 80 solecist
```

then in discord:

```text
/solecist setup
/solecist enable-channel
/solecist status
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
DATABASE_PATH=./data/solecist.sqlite
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
| `data/solecist.sqlite` | sqlite database used by docker/local runs |
| `src/` | bot, engine, llm adapter, storage, and tests |

## operational notes

- automatic mode fails silent in discord when the provider is down or rate-limited
- provider failures trigger per-channel backoff instead of retrying on every message
- debate classification is cached briefly per channel to reduce model calls
- manual `/solecist check` can inspect any message, but automatic mode only assesses argument-shaped messages
- node 24's built-in `node:sqlite` module currently emits an experimental warning
