// Vercel serverless function — proxies image scan to Anthropic
// API key is stored securely in Vercel Environment Variables, never in client code.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'API key not configured on server.' });
  }

  const { imageBase64, mediaType } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ success: false, error: 'No image data received.' });
  }

  const validType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)
    ? mediaType : 'image/jpeg';

  const promptLines = [
    'You are reading a paper procurement / purchase requisition form.',
    'Extract all available fields and return ONLY a JSON object with these exact keys:',
    '{',
    '  "originator": "",',
    '  "recipientEmail": "",',
    '  "dept": "",',
    '  "vendor": "",',
    '  "priority": "PO1",',
    '  "date": "YYYY-MM-DD",',
    '  "target": "YYYY-MM-DD",',
    '  "remarks": "",',
    '  "items": [',
    '    { "desc": "", "qty": 1, "unitPrice": 0 }',
    '  ]',
    '}',
    'Rules:',
    '- priority must be "PO1" or "PO2" only. Default to "PO1" if unclear.',
    '- All dates in YYYY-MM-DD format. Leave blank "" if not found.',
    '- items: extract every line item you can see. qty and unitPrice must be numbers (no currency symbols).',
    '- If a field is not visible, use an empty string "".',
    '- Return ONLY the JSON, no explanation, no markdown backticks.'
  ];
  const prompt = promptLines.join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: validType, data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ success: false, error: data.error?.message || 'Anthropic API error' });
    }

    const raw = (data.content || []).find(b => b.type === 'text')?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(clean);
      return res.status(200).json({ success: true, data: parsed });
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Could not parse AI response: ' + clean.slice(0, 200) });
    }

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
