import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

/* ------------------------------------------------------------------ config */

const token = process.env.DISCORD_TOKEN;
const appId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // optional: sofort statt bis zu 1h warten

if (!token || !appId) {
  console.error('[deploy] ERROR: DISCORD_TOKEN and/or CLIENT_ID is missing.');
  process.exit(1);
}

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

async function put(label, route) {
  const body = await rest.put(route, { body: commands });
  console.log(`[deploy] ${label}: ${body.length} commands registered`);
}

try {
  // 1. GLOBAL -> in JEDEM server sichtbar, in dem der bot ist
  await put('GLOBAL (bis zu 1h propagation)', Routes.applicationCommands(appId));

  // 2. optional: zusaetzlich in eine guild, damit's sofort da ist (dev)
  if (guildId) {
    await put(`guild ${guildId} (instant)`, Routes.applicationGuildCommands(appId, guildId));
  }

  console.log(`[deploy] registered: ${commands.map(c => '/' + c.name).join(', ')}`);
} catch (err) {
  dumpError('registration', err);
  process.exit(1);
}

process.exit(0);
