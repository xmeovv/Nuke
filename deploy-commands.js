import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

/* ------------------------------------------------------------------ config */

const token = process.env.DISCORD_TOKEN?.trim();
const appId = process.env.CLIENT_ID?.trim();
const guildId = process.env.GUILD_ID?.trim() || null; // optional: instant fuer eine guild

if (!token || !appId) {
  console.error('[deploy] DISCORD_TOKEN / CLIENT_ID fehlt -> check Railway Variables');
  process.exit(1);
}

const rest = new REST({ version: '10', retries: 5, timeout: 30_000 }).setToken(token);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ put */

async function put(label, route, body, attempts = 4) {
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await rest.put(route, { body });
      console.log(`[deploy] ${label}: ${Array.isArray(res) ? res.length : 0} commands`);
      return true;
    } catch (err) {
      const status = err?.status ?? err?.httpStatus;
      console.error(`[deploy] ${label} attempt ${a}/${attempts} -> ${status ?? '?'} ${err.message}`);

      if (status === 401) { console.error('[deploy] -> DISCORD_TOKEN falsch/revoked'); return false; }
      if (status === 403) { console.error('[deploy] -> CLIENT_ID passt nicht zum Token'); return false; }
      if (status === 404) { console.error('[deploy] -> GUILD_ID existiert nicht / bot nicht drin'); return false; }

      if (status === 429) {
        const wait = ((err.retryAfter ?? err?.rawError?.retry_after ?? 5) * 1000) + 500;
        console.log(`[deploy] rate limited, warte ${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
        continue;
      }

      await sleep(1500 * a);
    }
  }
  return false;
}

/* ------------------------------------------------------------------ run */

// 1. GLOBAL LEEREN -> weg mit den doppelten commands
await put('GLOBAL cleared', Routes.applicationCommands(appId), []);

// 2. nur noch guild commands (ein scope = keine dupes)
if (guildId) {
  await put(`guild ${guildId}`, Routes.applicationGuildCommands(appId, guildId), commands);
} else {
  console.log('[deploy] kein GUILD_ID -> index.js synct beim boot alle guilds');
}

// exit 0 auch bei fehlern -> boot wird nie gekillt
process.exit(0);
