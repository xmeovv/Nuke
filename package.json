import 'dotenv/config';
import {
  REST, Routes, SlashCommandBuilder,
  ApplicationIntegrationType, InteractionContextType,
} from 'discord.js';

/* ------------------------------------------------------------------ config */

const token = process.env.DISCORD_TOKEN;
const appId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // optional: sofort statt bis zu 1h warten

if (!token || !appId) {
  console.error('[deploy] ERROR: DISCORD_TOKEN and/or CLIENT_ID is missing.');
  process.exit(1);
}

/* ---------------------------------------------------------------- helpers */

const integrationTypes = [
  ApplicationIntegrationType.UserInstall,
  ApplicationIntegrationType.GuildInstall,
];

// boilerplate killer: jede command kriegt integration types + guild context
const cmd = (name, description, build) => {
  const b = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setIntegrationTypes(...integrationTypes)
    .setContexts(InteractionContextType.Guild);
  build?.(b);
  return b;
};

/* --------------------------------------------------------------- commands */

const commands = [
  /* -------- die ersten vier landen im profil -------- */
  cmd('play', 'benutze diesen command um musik zu spielen', b => b
    .addStringOption(o => o.setName('song').setDescription('song name or url').setRequired(false))
    .addBooleanOption(o => o.setName('roles').setDescription('auch alle rollen löschen (default: false)').setRequired(false))),

  cmd('skip', 'skip the current track'),

  cmd('play-file', 'play a song from an uploaded file', b => b
    .addAttachmentOption(o => o.setName('file').setDescription('mp3 / flac / wav').setRequired(true))),

  cmd('stop', 'stop playback and clear the queue'),

  /* -------- der rest ist fake -------- */
  cmd('queue', 'show the current queue'),
  cmd('nowplaying', 'show what is currently playing'),
  cmd('pause', 'pause playback'),
  cmd('resume', 'resume playback'),
  cmd('clear', 'clear the queue'),
  cmd('shuffle', 'shuffle the queue'),
  cmd('join', 'join your voice channel'),
  cmd('leave', 'leave the voice channel'),
  cmd('help', 'list all commands'),
  cmd('loop', 'set the loop mode', b => b
    .addStringOption(o => o.setName('mode').setDescription('off / track / queue').setRequired(false)
      .addChoices(
        { name: 'off', value: 'off' },
        { name: 'track', value: 'track' },
        { name: 'queue', value: 'queue' },
      ))),
  cmd('volume', 'set the volume', b => b
    .addIntegerOption(o => o.setName('level').setDescription('1-100')
      .setMinValue(1).setMaxValue(100).setRequired(false))),
  cmd('seek', 'jump to a position in the track', b => b
    .addStringOption(o => o.setName('time').setDescription('e.g. 1:23').setRequired(false))),
  cmd('remove', 'remove a track from the queue', b => b
    .addIntegerOption(o => o.setName('position').setDescription('queue position').setRequired(false))),
  cmd('lyrics', 'show lyrics', b => b
    .addStringOption(o => o.setName('song').setDescription('song name').setRequired(false))),
].map(c => c.toJSON());

/* --------------------------------------------------------------- register */

const rest = new REST({ version: '10' }).setToken(token);

function dumpError(label, err) {
  console.error(`[deploy] ${label} failed`);
  if (err?.status) console.error(`[deploy] status: ${err.status}`);
  if (err?.code) console.error(`[deploy] code: ${err.code}`);
  console.error('[deploy]', err?.rawError ?? err);

  if (err?.status === 401) console.error('[deploy] -> DISCORD_TOKEN wrong or revoked');
  if (err?.status === 403) console.error('[deploy] -> CLIENT_ID does not belong to this token');
}

try {
  const route = guildId
    ? Routes.applicationGuildCommands(appId, guildId)
    : Routes.applicationCommands(appId);

  const body = await rest.put(route, { body: commands });
  console.log(`[deploy] OK - ${body.length} commands registered ${guildId ? `in guild ${guildId} (instant)` : 'GLOBAL (up to 1h to propagate)'}.`);
  console.log(`[deploy] registered: ${commands.map(c => '/' + c.name).join(', ')}`);
} catch (err) {
  dumpError('registration', err);
  process.exit(1);
}

process.exit(0);