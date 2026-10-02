export const config = {
  api: {
    bodyParser: { sizeLimit: '30mb' },
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

  const { messages, preferredModel, attachments } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format' });
  }

  const OPENROUTER_KEY = process.env.OPENROUTER;

  if (!OPENROUTER_KEY) {
    return res.status(500).json({
      error: 'OpenRouter API key is missing. Please add OPENROUTER to your environment variables or .env file.'
    });
  }

  // Claude models on OpenRouter (verified active model IDs)
  const MODEL_CHAIN = [
    { id: 'anthropic/claude-haiku-4.5',   label: 'Claude Haiku 4.5' },
    { id: 'anthropic/claude-sonnet-4.5',  label: 'Claude Sonnet 4.5' },
    { id: 'anthropic/claude-sonnet-4',    label: 'Claude Sonnet 4' },
    { id: 'anthropic/claude-sonnet-4.6',  label: 'Claude Sonnet 4.6' },
    { id: 'anthropic/claude-opus-4.5',    label: 'Claude Opus 4.5' },
  ];

  // If a preferred model is requested, try that one first, then fallback to others
  let modelsToTry = [...MODEL_CHAIN];
  if (preferredModel && preferredModel !== 'auto') {
    const preferred = MODEL_CHAIN.find(m => m.id === preferredModel);
    if (preferred) {
      modelsToTry = [preferred, ...MODEL_CHAIN.filter(m => m.id !== preferredModel)];
    }
  }

  // Build final messages — inject attachments into the last user message
  let finalMessages = [...messages];
  if (attachments && attachments.length > 0 && finalMessages.length > 0) {
    const last = finalMessages[finalMessages.length - 1];
    if (last.role === 'user') {
      const parts = [];

      // Text prompt
      if (last.content) {
        parts.push({ type: 'text', text: last.content });
      }

      // Attachment parts (images as vision URLs, documents/spreadsheets/pdfs as text context)
      for (const att of attachments) {
        if (att.kind === 'image') {
          parts.push({
            type: 'image_url',
            image_url: { url: att.data },
          });
        } else {
          // pdf, excel, csv, text or any other document format
          const typeLabel = (att.kind || 'document').toUpperCase();
          parts.push({
            type: 'text',
            text: `\n\n--- Attached ${typeLabel}: ${att.name || 'Document'} ---\n${att.data}\n-----------------------------------\n`,
          });
        }
      }

      finalMessages = [
        ...finalMessages.slice(0, -1),
        { role: 'user', content: parts },
      ];
    }
  }

  let lastError = null;
  let triedCount = 0;

  for (const model of modelsToTry) {
    triedCount++;
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
          max_tokens: 2000,
          temperature: 0.7,
        }),
      });

      let data;
      const rawText = await response.text();
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { error: { message: `Received non-JSON response from provider (${response.status}): ${rawText.slice(0, 150)}` } };
      }

      // Check for errors (rate limit, credit shortage, deprecated, not found)
      if (!response.ok) {
        const errMsg = data?.error?.message || data?.error || 'Provider request failed';
        const errStr = String(errMsg).toLowerCase();

        const shouldFallback = response.status === 429 ||
          response.status === 402 ||
          response.status === 404 ||
          errStr.includes('rate') ||
          errStr.includes('limit') ||
          errStr.includes('quota') ||
          errStr.includes('credit') ||
          errStr.includes('afford') ||
          errStr.includes('deprecated') ||
          errStr.includes('not found') ||
          errStr.includes('unauthorized') === false && response.status >= 500;

        if (shouldFallback && triedCount < modelsToTry.length) {
          console.warn(`[${model.label}] Notice: ${errMsg}. Trying next Claude model...`);
          lastError = errMsg;
          continue; // Switch to next Claude model in the chain
        }

        // Return error if no fallback or non-recoverable
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
        switched: triedCount > 1,
      });

    } catch (err) {
      console.error(`[${model.label}] Network error:`, err.message);
      lastError = err.message;
      if (triedCount < modelsToTry.length) continue;
    }
  }

  // All models failed
  return res.status(503).json({
    error: lastError || 'All Claude models are currently busy or rate-limited. Please try again in a few moments.',
    allExhausted: true,
  });
}
