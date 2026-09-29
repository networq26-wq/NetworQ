# NetworQ Realtime Voice Server (Hugging Face `speech-to-speech`)

This backend powers **Q Voice Intelligence** using the open-source Hugging Face `speech-to-speech` pipeline (VAD + Whisper STT + LLM + Neural TTS) over WebSocket.

---

### Option 1: Run Locally (Mac with Apple Silicon or Linux GPU)

1. **Install dependencies:**
   ```bash
   pip install -r voice_server/requirements.txt
   ```

2. **Start the Voice Server:**
   ```bash
   python voice_server/serve.py
   ```
   The WebSocket server starts on `ws://localhost:8765/v1/realtime`.

3. **Open NetworQ:**
   Q in `App.tsx` connects to `ws://localhost:8765/v1/realtime` and shows `● S2S Live Server`.

---

### Option 2: Deploy to Hugging Face Spaces (Free Cloud GPU)

1. Create a new Space on [Hugging Face](https://huggingface.co/new-space) (select **Docker** or **Gradio/Python**).
2. Push the files from `voice_server/` to your Space repository.
3. In NetworQ, set your Space URL in `.env`:
   ```bash
   EXPO_PUBLIC_VOICE_WS_URL=wss://<your-username>-networq-voice.hf.space/v1/realtime
   ```

---

### Zero-Downtime Fallback:
If the WebSocket server is offline, Q automatically runs via the client-side executive engine so that voice commands, CRM actions, and networking features continue to work with zero disruption.
