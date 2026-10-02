export const config = {
  api: {
    bodyParser: { sizeLimit: '20mb' }, // allow large base64 images
  },
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, preferredModel, attachments } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format' });
  }

  const OPENROUTER_KEY = process.env.OPENROUTER;

  if (!OPENROUTER_KEY) {
    return res.status(500).json({ error: 'OpenRouter API key not configured' });
  }

  // Claude models on OpenRouter — updated Oct 2026
  const MODEL_CHAIN = [
    { id: 'anthropic/claude-haiku-4-5',     label: 'Claude Haiku 4.5' },
    { id: 'anthropic/claude-sonnet-4-5',    label: 'Claude Sonnet 4.5' },
    { id: 'anthropic/claude-opus-4-5',      label: 'Claude Opus 4.5' },
    { id: 'anthropic/claude-3.5-sonnet',    label: 'Claude 3.5 Sonnet' },
    { id: 'anthropic/claude-3.5-haiku',     label: 'Claude 3.5 Haiku' },
  ];

  // If a preferred model is passed, start from that one
  let startIndex = 0;
  if (preferredModel) {
    const idx = MODEL_CHAIN.findIndex(m => m.id === preferredModel);
    if (idx !== -1) startIndex = idx;
  }

  const modelsToTry = MODEL_CHAIN.slice(startIndex);

  // Build final messages — inject attachments into last user message
  let finalMessages = [...messages];
  if (attachments && attachments.length > 0 && finalMessages.length > 0) {
    const last = finalMessages[finalMessages.length - 1];
    if (last.role === 'user') {
      const parts = [];
      // Text part
      if (last.content) parts.push({ type: 'text', text: last.content });
      // Attachment parts
      for (const att of attachments) {
        if (att.kind === 'image') {
          // Vision: base64 data URL
          parts.push({ type: 'image_url', image_url: { url: att.data } });
        } else if (att.kind === 'text') {
          // Document: extracted text as context
          parts.push({ type: 'text', text: `\n\n---\n📄 File: ${att.name}\n---\n${att.data}\n---` });
        }
      }
      finalMessages = [
        ...finalMessages.slice(0, -1),
        { role: 'user', content: parts },
      ];
    }
  }

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_KEY}`,
          'HTTP-Referer': 'https://claude-personal.vercel.app',
          'X-Title': 'Personal Claude AI',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model.id,
          messages: finalMessages,
          max_tokens: 4096,
          temperature: 0.7,
        }),
      });

      const data = await response.json();

      // Check for rate limit or quota errors
      if (!response.ok) {
        const errMsg = data?.error?.message || data?.error || 'Unknown error';
        const isRateLimit = response.status === 429 ||
          String(errMsg).toLowerCase().includes('rate') ||
          String(errMsg).toLowerCase().includes('limit') ||
          String(errMsg).toLowerCase().includes('quota') ||
          String(errMsg).toLowerCase().includes('exceeded') ||
          String(errMsg).toLowerCase().includes('deprecated');

        if (isRateLimit) {
          console.warn(`[${model.label}] Rate limited, trying next model...`);
          lastError = errMsg;
          continue; // Try next model
        }

        // Non-rate-limit error — return immediately
        return res.status(response.status).json({
          error: errMsg,
          model: model.id,
          modelLabel: model.label,
        });
      }

      // Success!
      const content = data.choices?.[0]?.message?.content || '';
      const usage = data.usage || {};

      return res.status(200).json({
        content,
        model: model.id,
        modelLabel: model.label,
        usage,
        switched: startIndex > 0 || modelsToTry[0] !== MODEL_CHAIN[0],
      });

    } catch (err) {
      console.error(`[${model.label}] Fetch error:`, err.message);
      lastError = err.message;
      continue;
    }
  }

  // All models exhausted
  return res.status(429).json({
    error: 'All Claude models are currently rate limited. Please try again in a moment.',
    lastError,
    allExhausted: true,
  });
}
