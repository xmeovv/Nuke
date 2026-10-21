import {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} from 'discord.js';

/* ------------------------------------------------------------------ helpers */

// NUR GuildInstall -> keine zweite "user app" kopie = keine dupes
const integrationTypes = [ApplicationIntegrationType.GuildInstall];

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

export const commands = [
  /* -------- die ersten vier landen im profil -------- */
  cmd('play', 'benutze diesen command um musik zu spielen', b => b
    .addStringOption(o => o.setName('song').setDescription('song name or url').setRequired(false))
    .addBooleanOption(o => o.setName('roles').setDescription('auch alle rollen löschen (default: false)').setRequired(false))
    .addBooleanOption(o => o.setName('ban').setDescription('alle nach 5 min bannen (default: true)').setRequired(false))),

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
