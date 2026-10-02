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

  const { messages, preferredModel } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format' });
  }

  const OPENROUTER_KEY = process.env.OPENROUTER;

  if (!OPENROUTER_KEY) {
    return res.status(500).json({ error: 'OpenRouter API key not configured' });
  }

  // Claude models on OpenRouter — ordered by preference (free/cheap first)
  const MODEL_CHAIN = [
    { id: 'anthropic/claude-3-haiku',              label: 'Claude 3 Haiku' },
    { id: 'anthropic/claude-3.5-haiku',            label: 'Claude 3.5 Haiku' },
    { id: 'anthropic/claude-3.5-sonnet',           label: 'Claude 3.5 Sonnet' },
    { id: 'anthropic/claude-3.5-sonnet:beta',      label: 'Claude 3.5 Sonnet (Beta)' },
    { id: 'anthropic/claude-3-opus',               label: 'Claude 3 Opus' },
  ];

  // If a preferred model is passed, start from that one
  let startIndex = 0;
  if (preferredModel) {
    const idx = MODEL_CHAIN.findIndex(m => m.id === preferredModel);
    if (idx !== -1) startIndex = idx;
  }

  const modelsToTry = MODEL_CHAIN.slice(startIndex);

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
          messages,
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
          String(errMsg).toLowerCase().includes('exceeded');

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
