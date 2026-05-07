import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Interaction,
  Message,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import type { AppConfig } from './config.js';
import type { FeedbackValue, ReplyLanguage, Sensitivity } from './domain.js';
import { buildReplyText } from './reply.js';
import { FallacyEngine } from './engine.js';
import type { Storage } from './storage.js';

export function createClient(storage: Storage, engine: FallacyEngine): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message.guildId || message.author.bot || message.channel.type === ChannelType.PublicThread) return;
      if (!message.content.trim()) return;

      const decision = await engine.handleMessage(message.guildId, {
        id: message.id,
        channelId: message.channelId,
        authorId: message.author.id,
        content: message.content,
        createdAt: message.createdAt,
      });

      if (decision.kind !== 'post') return;

      const guildConfig = storage.getGuildConfig(message.guildId);
      const replyText = buildReplyText(decision.assessment, guildConfig.language ?? 'en');
      await message.reply({
        embeds: [buildFallacyEmbed(replyText)],
        components: [feedbackRow(decision.eventId)],
        allowedMentions: { repliedUser: false },
      });
    } catch (error) {
      // Automatic mode must fail silent in Discord. Provider timeouts and parsing errors
      // belong in container logs, not in the debate channel.
      console.error('automatic message handling failed', {
        messageId: message.id,
        channelId: message.channelId,
        error,
      });
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton()) {
        await handleFeedbackButton(storage, interaction);
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'solecism') return;
      await handleCommand(storage, engine, interaction);
    } catch (error) {
      console.error('interaction failed', error);
      if (interaction.isRepliable()) {
        const content = error instanceof Error ? error.message : 'Unexpected error';
        if (interaction.replied || interaction.deferred) await interaction.followUp({ content, ephemeral: true });
        else await interaction.reply({ content, ephemeral: true });
      }
    }
  });

  return client;
}

export async function registerCommands(config: AppConfig): Promise<void> {
  const command = new SlashCommandBuilder()
    .setName('solecism')
    .setDescription('Configure and inspect Solecism')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('setup')
        .setDescription('Set required server defaults')
        .addStringOption((option) =>
          option
            .setName('language')
            .setDescription('Reply language')
            .setRequired(true)
            .addChoices({ name: 'English', value: 'en' }, { name: 'Spanish', value: 'es' }),
        )
        .addStringOption((option) =>
          option
            .setName('sensitivity')
            .setDescription('Detection sensitivity')
            .setRequired(false)
            .addChoices(
              { name: 'Conservative', value: 'conservative' },
              { name: 'Balanced', value: 'balanced' },
              { name: 'Active', value: 'active' },
            ),
        ),
    )
    .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Show current Solecism status'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('enable-channel')
        .setDescription('Enable automatic tracking in a channel')
        .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disable-channel')
        .setDescription('Disable tracking in a channel')
        .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true)),
    )
    .addSubcommand((subcommand) => subcommand.setName('start').setDescription('Force tracking on in the current channel'))
    .addSubcommand((subcommand) => subcommand.setName('stop').setDescription('Force tracking off in the current channel'))
    .addSubcommand((subcommand) => subcommand.setName('emergency-stop').setDescription('Disable Solecism server-wide'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('check')
        .setDescription('Manually check a message by ID')
        .addStringOption((option) => option.setName('message-id').setDescription('Message ID').setRequired(true)),
    );

  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
    : Routes.applicationCommands(config.discordClientId);

  await rest.put(route, {
    body: [command.toJSON()],
  });
}

async function handleCommand(
  storage: Storage,
  engine: FallacyEngine,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) throw new Error('Solecism only works in servers.');
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'setup') {
    const language = interaction.options.getString('language', true) as ReplyLanguage;
    const sensitivity = (interaction.options.getString('sensitivity') ?? 'active') as Sensitivity;
    const config = storage.updateGuildConfig({
      guildId: interaction.guildId,
      language,
      sensitivity,
      emergencyStopped: false,
    });
    await interaction.reply({ content: statusText(storage, config.guildId), ephemeral: true });
    return;
  }

  if (subcommand === 'status') {
    await interaction.reply({ content: statusText(storage, interaction.guildId), ephemeral: true });
    return;
  }

  if (subcommand === 'enable-channel') {
    const channel = interaction.options.getChannel('channel', true);
    storage.setChannelMode(interaction.guildId, channel.id, 'auto');
    await interaction.reply({ content: `Enabled automatic tracking in <#${channel.id}>.`, ephemeral: true });
    return;
  }

  if (subcommand === 'disable-channel') {
    const channel = interaction.options.getChannel('channel', true);
    storage.removeChannel(interaction.guildId, channel.id);
    await interaction.reply({ content: `Disabled tracking in <#${channel.id}>.`, ephemeral: true });
    return;
  }

  if (subcommand === 'start') {
    storage.setChannelMode(interaction.guildId, interaction.channelId, 'forced_on');
    await interaction.reply({ content: 'Forced Solecism tracking on in this channel.', ephemeral: true });
    return;
  }

  if (subcommand === 'stop') {
    storage.setChannelMode(interaction.guildId, interaction.channelId, 'forced_off');
    await interaction.reply({ content: 'Forced Solecism tracking off in this channel.', ephemeral: true });
    return;
  }

  if (subcommand === 'emergency-stop') {
    storage.updateGuildConfig({ guildId: interaction.guildId, emergencyStopped: true });
    await interaction.reply({ content: 'Solecism is stopped server-wide.', ephemeral: true });
    return;
  }

  if (subcommand === 'check') {
    await interaction.deferReply({ ephemeral: true });
    const messageId = interaction.options.getString('message-id', true);
    const channel = interaction.channel;
    if (!channel?.isTextBased()) throw new Error('Run this command in a text channel.');
    const message = (await channel.messages.fetch(messageId)) as Message;
    const assessment = await engine.checkMessage(interaction.guildId, {
      id: message.id,
      channelId: message.channelId,
      authorId: message.author.id,
      content: message.content,
      createdAt: message.createdAt,
    });
    const guildConfig = storage.getGuildConfig(interaction.guildId);
    const reply = assessment.isFallacy
      ? buildReplyText(assessment, guildConfig.language ?? 'en')
      : 'No fallacy found for that message.';
    await interaction.editReply(reply);
  }
}

async function handleFeedbackButton(storage: Storage, interaction: Interaction & { customId: string }): Promise<void> {
  if (!interaction.isButton() || !interaction.guildId) return;
  const memberPermissions = interaction.memberPermissions;
  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Only admins can record Solecism feedback.', ephemeral: true });
    return;
  }

  const [, value, eventIdText] = interaction.customId.split(':');
  if (!isFeedbackValue(value)) throw new Error('Invalid feedback value.');
  const eventId = Number(eventIdText);
  if (!Number.isInteger(eventId)) throw new Error('Invalid feedback event ID.');
  storage.recordFeedback(eventId, interaction.user.id, value);
  await interaction.reply({ content: `Recorded feedback: ${value}.`, ephemeral: true });
}

function buildFallacyEmbed(replyText: string): EmbedBuilder {
  return new EmbedBuilder().setColor(0x6b7280).setDescription(replyText);
}

function feedbackRow(eventId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`fallacy-feedback:useful:${eventId}`).setLabel('Useful').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`fallacy-feedback:wrong:${eventId}`).setLabel('Wrong').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`fallacy-feedback:noisy:${eventId}`).setLabel('Noisy').setStyle(ButtonStyle.Secondary),
  );
}

function statusText(storage: Storage, guildId: string): string {
  const config = storage.getGuildConfig(guildId);
  const channels = storage.listEnabledChannels(guildId);
  return [
    `Setup complete: ${config.setupComplete ? 'yes' : 'no'}`,
    `Language: ${config.language ?? 'not configured'}`,
    `Sensitivity: ${config.sensitivity}`,
    `Emergency stopped: ${config.emergencyStopped ? 'yes' : 'no'}`,
    `Channels: ${channels.length ? channels.map((channel) => `<#${channel.channelId}> (${channel.mode})`).join(', ') : 'none'}`,
    `Database size: ${storage.databaseSizeBytes()} bytes`,
  ].join('\n');
}

function isFeedbackValue(value: string | undefined): value is FeedbackValue {
  return value === 'useful' || value === 'wrong' || value === 'noisy';
}
