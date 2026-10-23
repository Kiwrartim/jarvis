import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const PORT = 8787;

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tts: false, stt: false }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Frontend connected');

  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data.toString());

      if (parsed.type === 'interrupt') return;

      const userPrompt = parsed.text || parsed.prompt || parsed.content || parsed.message;
      const msgId = parsed.id || 'msg_' + Date.now();

      if (!userPrompt) return;

      console.log('User prompt:', userPrompt);

      ws.send(JSON.stringify({ type: 'start', id: msgId }));

      // Fetch streaming output from Ollama
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5:1.5b',
          prompt: `You are JARVIS. Respond in 1-2 brief sentences.\n\nUser: ${userPrompt}\nJARVIS:`,
          options: { num_ctx: 1024 },
          stream: true
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkText = decoder.decode(value, { stream: true });
        const lines = chunkText.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            const token = json.response;

            if (token) {
              // Send stream chunks for Chrome's text HUD and WebSpeech TTS engine
              ws.send(JSON.stringify({
                type: 'text',
                id: msgId,
                text: token,
                delta: token
              }));

              ws.send(JSON.stringify({
                type: 'speak',
                id: msgId,
                text: token,
                delta: token
              }));
            }
          } catch (e) {
            // Ignore partial chunks
          }
        }
      }

      ws.send(JSON.stringify({ type: 'done', id: msgId }));

    } catch (err) {
      console.error('Bridge error:', err);
    }
  });
});

server.listen(PORT, () => {
  console.log(`JARVIS Chrome-native bridge running on http://localhost:${PORT}`);
});