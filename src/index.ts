import { loadConfig } from './config.js';
import { createClient, registerCommands } from './discord.js';
import { FallacyEngine } from './engine.js';
import { OpenAiCompatibleLlmClient } from './llm.js';
import { Storage } from './storage.js';

const config = loadConfig();
const storage = new Storage(config.databasePath, config.databaseMaxBytes);
const llm = new OpenAiCompatibleLlmClient({
  baseUrl: config.llmBaseUrl,
  apiKey: config.llmApiKey,
  model: config.llmModel,
  smallModel: config.smallLlmModel,
});
const engine = new FallacyEngine(storage, llm);
const client = createClient(storage, engine);

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await registerCommands(config);
await client.login(config.discordToken);
console.log('Solecism is running.');

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down.`);
  client.destroy();
  storage.close();
  process.exit(0);
}
