# WhatsApp Bot for POS

## Run

From `server/`:

- **Foreground:** `npm run whatsapp`
- **With PM2:** `npm run whatsapp:pm2` (then `pm2 logs pos-whatsapp`)

## Voice commands

Send a **voice message** instead of text (e.g. say "add product Milk 50"). The bot will transcribe it and run the same commands.

**Setup (use one or both):**

- **Gemini (free tier):** Add to `server/.env`: `GEMINI_API_KEY=your-key` — get a key at [Google AI Studio](https://aistudio.google.com). Used first if set.
- **OpenAI Whisper:** Add to `server/.env`: `OPENAI_API_KEY=sk-your-key`. Needs ffmpeg to convert ogg → mp3.

Without either key, the bot replies asking you to add a key or type the command.

## Optional: Restrict who can run commands

In `server/.env` add:

```env
ALLOWED_WHATSAPP_NUMBERS=923001234567,923009876543
```

Use your country code + number (no spaces). Only these numbers will be able to run add/delete/list etc.; others get "Not authorized." Leave this unset to allow all numbers.

## PM2

- Start bot only: `pm2 start ecosystem.config.cjs --only pos-whatsapp`
- Start API + bot: `pm2 start ecosystem.config.cjs`
- Logs: `pm2 logs`
- Stop: `pm2 stop all`
