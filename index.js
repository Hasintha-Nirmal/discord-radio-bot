require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
  PermissionFlagsBits,
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require("@discordjs/voice");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

// Set FFMPEG_PATH so any voice internal utilities locate ffmpeg-static
process.env.FFMPEG_PATH = ffmpegPath;

// ─── Station Data ───────────────────────────────────────────────────────────
const stations = require("./stations.json");

// ─── FFmpeg Stream Helper ────────────────────────────────────────────────────
// Spawns ffmpeg-static with custom user-agent and auto-reconnect to stream radio audio
function createRadioStream(url) {
  const ffmpeg = spawn(
    ffmpegPath,
    [
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "-i", url,
      "-analyzeduration", "0",
      "-loglevel", "warning",
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  );

  ffmpeg.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.warn("[FFmpeg]", msg);
  });

  ffmpeg.on("error", (err) => {
    console.error("[FFmpeg Error]", err.message);
  });

  ffmpeg.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.log(`[FFmpeg] Exited with code ${code}`);
    }
  });

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });

  resource._ffmpegProcess = ffmpeg;
  return resource;
}

// ─── Bot Client ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ─── State Per Guild ─────────────────────────────────────────────────────────
const guildState = new Map();

function getState(guildId) {
  if (!guildState.has(guildId)) {
    const player = createAudioPlayer();
    
    // Debug logging for player state
    player.on("stateChange", (oldState, newState) => {
      console.log(`[Guild ${guildId} Player] ${oldState.status} ➔ ${newState.status}`);
    });

    guildState.set(guildId, {
      player,
      currentStation: null,
      connection: null,
      resource: null,
      volume: 1.0,
    });
  }
  return guildState.get(guildId);
}

function cleanupGuildStream(state) {
  if (state.resource?._ffmpegProcess) {
    try {
      state.resource._ffmpegProcess.kill("SIGKILL");
    } catch {}
    state.resource._ffmpegProcess = null;
  }
  state.resource = null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatUptime() {
  const s = Math.floor(process.uptime());
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

function buildNowPlayingEmbed(station, voiceChannelName, volume = 100) {
  return new EmbedBuilder()
    .setTitle(`${station.emoji} දැන් වාදනය වේ • Now Playing`)
    .setDescription(`## ${station.name}\n\`\`\`${station.frequency}\`\`\``)
    .addFields(
      { name: "📻 Genre", value: station.genre, inline: true },
      { name: "🔊 Voice Channel", value: voiceChannelName, inline: true },
      { name: "🎚️ Volume", value: `\`${volume}%\``, inline: true },
      { name: "🌐 Official Site", value: `[Visit Website](${station.website})`, inline: true }
    )
    .setColor(station.color)
    .setThumbnail(station.image)
    .setFooter({ text: "Use !stop to disconnect • !vol <1-100> to set volume • !list for stations" })
    .setTimestamp();
}

function buildErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor("#E63946");
}

// ─── Bot Ready Event ─────────────────────────────────────────────────────────
client.on("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📻 Serving ${client.guilds.cache.size} server(s)`);

  const statuses = [
    { text: "Radio | !list", type: ActivityType.Listening },
    { text: `${Object.keys(stations).length} LK Stations`, type: ActivityType.Watching },
    { text: "!help for commands", type: ActivityType.Playing },
  ];
  let i = 0;
  const setActivity = () => {
    const s = statuses[i % statuses.length];
    client.user.setActivity(s.text, { type: s.type });
    i++;
  };

  setActivity();
  setInterval(setActivity, 30000);
});

// ─── Message Handler ─────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("!") || message.author.bot) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const guildId = message.guild?.id;
  if (!guildId) return;

  const voiceChannel = message.member?.voice?.channel;
  const state = getState(guildId);

  // ── !help ──────────────────────────────────────────────────────────────────
  if (command === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📻 Sri Lankan Radio Bot — Commands")
      .setColor("#457B9D")
      .setDescription("Your 24/7 high-fidelity Sri Lankan Live Radio companion for Discord!")
      .addFields(
        { name: "🎵 `!play <station>`", value: "Play a live radio station (e.g. `!play hiru`, `!play sirasa`).", inline: false },
        { name: "⏹️ `!stop`", value: "Stop playback and leave the voice channel.", inline: false },
        { name: "📋 `!list`", value: "Show all available radio channels.", inline: false },
        { name: "🎙️ `!now`", value: "Show currently playing station information.", inline: false },
        { name: "🎚️ `!vol <1-100>`", value: "Adjust the radio playback volume.", inline: false },
        { name: "📊 `!ping`", value: "Check bot latency and uptime.", inline: false }
      )
      .setFooter({ text: "Example: !play hiru • !vol 80" })
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ── !list ──────────────────────────────────────────────────────────────────
  if (command === "list") {
    const fields = Object.entries(stations).map(([key, s]) => ({
      name: `${s.emoji} \`!play ${key}\` — **${s.name}**`,
      value: `\`${s.frequency}\` • ${s.genre}`,
      inline: false,
    }));

    const embed = new EmbedBuilder()
      .setTitle("📻 ශ්‍රී ලාංකීය රේඩියෝ නාලිකා — Available Stations")
      .setDescription("Join a voice channel and use **!play <name>** to tune in live!")
      .addFields(fields)
      .setColor("#F4A261")
      .setFooter({ text: `${Object.keys(stations).length} stations loaded • Enjoy HD Streaming!` })
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ── !now ───────────────────────────────────────────────────────────────────
  if (command === "now") {
    if (!state.currentStation) {
      return message.channel.send({
        embeds: [buildErrorEmbed("Nothing Playing", "No radio station is currently playing.\nUse `!play <station>` to start listening!")],
      });
    }
    const vc = message.guild.channels.cache.get(state.connection?.joinConfig?.channelId);
    return message.channel.send({
      embeds: [buildNowPlayingEmbed(state.currentStation, vc?.name ?? "Voice Channel", Math.round(state.volume * 100))],
    });
  }

  // ── !volume / !vol ─────────────────────────────────────────────────────────
  if (command === "volume" || command === "vol") {
    const val = parseInt(args[0], 10);
    if (isNaN(val) || val < 1 || val > 100) {
      return message.channel.send({
        embeds: [buildErrorEmbed("Invalid Volume", `Current volume is **${Math.round(state.volume * 100)}%**.\nUsage: \`!vol <1-100>\``)],
      });
    }

    state.volume = val / 100;
    if (state.resource?.volume) {
      state.resource.volume.setVolume(state.volume);
    }

    return message.channel.send({
      embeds: [new EmbedBuilder()
        .setTitle("🎚️ Volume Adjusted")
        .setDescription(`Volume set to **${val}%**`)
        .setColor("#2D6A4F")],
    });
  }

  // ── !ping ──────────────────────────────────────────────────────────────────
  if (command === "ping") {
    const embed = new EmbedBuilder()
      .setTitle("🏓 Pong!")
      .addFields(
        { name: "📶 Latency", value: `\`${client.ws.ping}ms\``, inline: true },
        { name: "⏱️ Uptime", value: `\`${formatUptime()}\``, inline: true },
        { name: "📻 Loaded Stations", value: `\`${Object.keys(stations).length}\``, inline: true }
      )
      .setColor("#2D6A4F")
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ── !play ──────────────────────────────────────────────────────────────────
  if (command === "play") {
    if (!voiceChannel) {
      return message.channel.send({
        embeds: [buildErrorEmbed(
          "Not in Voice Channel",
          "කරුණාකර පළමුව Voice Channel එකකට සම්බන්ධ වන්න!\nPlease join a **Voice Channel** first!"
        )],
      });
    }

    const permissions = voiceChannel.permissionsFor(message.guild.members.me);
    if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
      return message.channel.send({
        embeds: [buildErrorEmbed("Permission Denied", "I need **Connect** and **Speak** permissions in your voice channel.")],
      });
    }

    const stationKey = args[0]?.toLowerCase();
    if (!stationKey || !stations[stationKey]) {
      const list = Object.keys(stations).map((k) => `\`${k}\``).join(", ");
      return message.channel.send({
        embeds: [buildErrorEmbed(
          "Invalid Station",
          `Available stations: ${list}\n\nUse **!list** to see all details.`
        )],
      });
    }

    const station = stations[stationKey];
    await message.channel.sendTyping();

    try {
      // Clean up previous ffmpeg child process if active
      cleanupGuildStream(state);

      // Join or get voice connection
      let connection = getVoiceConnection(guildId);
      if (!connection || connection.joinConfig.channelId !== voiceChannel.id) {
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guildId,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfDeaf: true,
        });
        state.connection = connection;
      }

      // Wait for voice connection to become ready
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      } catch {
        connection.destroy();
        cleanupGuildStream(state);
        return message.channel.send({
          embeds: [buildErrorEmbed("Connection Failed", "Could not connect to the voice channel in time. Please try again.")],
        });
      }

      // Create stream via FFmpeg
      console.log(`[Stream] Starting stream for ${station.name}: ${station.url}`);
      const resource = createRadioStream(station.url);
      state.resource = resource;
      if (resource.volume) {
        resource.volume.setVolume(state.volume);
      }

      state.player.play(resource);
      connection.subscribe(state.player);
      state.currentStation = station;

      // Handle player errors and fallback stream
      state.player.removeAllListeners("error");
      state.player.on("error", async (err) => {
        console.error(`[Player Error] ${station.name}:`, err.message);
        if (station.fallback_url) {
          console.log(`[Fallback] Switching to backup URL for ${station.name}`);
          try {
            cleanupGuildStream(state);
            const fallbackResource = createRadioStream(station.fallback_url);
            state.resource = fallbackResource;
            if (fallbackResource.volume) {
              fallbackResource.volume.setVolume(state.volume);
            }
            state.player.play(fallbackResource);
            message.channel.send({
              embeds: [new EmbedBuilder()
                .setTitle("⚠️ Switched to Fallback Stream")
                .setDescription(`Reconnected **${station.name}** via backup server.`)
                .setColor("#F4A261")],
            });
          } catch (fallbackErr) {
            console.error("[Fallback Error]", fallbackErr.message);
          }
        }
      });

      // Handle connection disconnection
      connection.removeAllListeners("stateChange");
      connection.on("stateChange", (_, newState) => {
        if (newState.status === VoiceConnectionStatus.Disconnected) {
          console.log(`[Voice] Disconnected from ${guildId}`);
          cleanupGuildStream(state);
          try {
            connection.destroy();
          } catch {}
          state.currentStation = null;
          state.connection = null;
        }
      });

      return message.channel.send({
        embeds: [buildNowPlayingEmbed(station, voiceChannel.name, Math.round(state.volume * 100))],
      });
    } catch (err) {
      console.error("[Play Error]", err);
      cleanupGuildStream(state);
      return message.channel.send({
        embeds: [buildErrorEmbed(
          "Playback Error",
          `Failed to play **${station.name}**.\n\`\`\`${err.message}\`\`\`\nPlease try another station or retry.`
        )],
      });
    }
  }

  // ── !stop ──────────────────────────────────────────────────────────────────
  if (command === "stop") {
    const connection = getVoiceConnection(guildId);
    if (!connection) {
      return message.channel.send({
        embeds: [buildErrorEmbed("Not Playing", "Bot is not in any voice channel!\nBot හඬ නාලිකාවක නැත!")],
      });
    }

    cleanupGuildStream(state);
    state.player.stop();
    try {
      connection.destroy();
    } catch {}
    state.currentStation = null;
    state.connection = null;

    const embed = new EmbedBuilder()
      .setTitle("🛑 රේඩියෝව නතර කරන ලදී • Radio Stopped")
      .setDescription("Bot has left the voice channel.\nBot හඬ නාලිකාවෙන් ඉවත් විය.")
      .setColor("#E63946")
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }
});

// ─── Global Error Handling ───────────────────────────────────────────────────
client.on("error", (err) => console.error("[Client Error]", err));

process.on("unhandledRejection", (err) => {
  console.error("[Unhandled Rejection]", err);
});

process.on("exit", () => {
  for (const state of guildState.values()) {
    cleanupGuildStream(state);
  }
});

async function startBot(retries = 5, delay = 4000) {
  if (!process.env.BOT_TOKEN) {
    console.error("❌ BOT_TOKEN is missing in .env file!");
    process.exit(1);
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📡 Connecting to Discord (attempt ${attempt}/${retries})...`);
      await client.login(process.env.BOT_TOKEN);
      console.log("🚀 RadioLK Bot is online and ready!");
      return;
    } catch (err) {
      console.error(`⚠️ Connection attempt ${attempt} failed: ${err.message}`);
      if (attempt < retries) {
        console.log(`⏳ Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        console.error("❌ All login attempts failed. Please verify your internet connection or BOT_TOKEN.");
        process.exit(1);
      }
    }
  }
}

startBot();

