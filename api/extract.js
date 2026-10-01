// Vercel serverless function: sends one drawing sheet to Claude and returns the openings found.
const SYSTEM = `You are a quantity surveyor's assistant reading architectural drawings (plans, elevations, window schedules) to build a door and window order list.
Return ONLY JSON, no prose, in this shape:
{"openings":[{"mark":string|null,"description":string,"type":"Fixed window"|"Openable window"|"Sliding door"|"Single hinged door"|"Double hinged door","width_mm":number|null,"height_mm":number|null,"qty":number,"view":string,"note":string|null}]}
Rules:
- Include every door and window visible on the sheet. If a schedule table exists, use its marks and sizes (schedule columns are usually HEIGHT then WIDTH; trust the column headers).
- Without a schedule, read sizes from dimension strings: the horizontal string above or below an opening is its width, the vertical string beside it is its height. If several identical openings are side by side, give one row with qty.
- Never invent a size. If a dimension is not shown, use null and say why in note.
- type: sliding = panels on a track (arrows or overlapping panels); single hinged = one leaf with a swing line; double hinged = two leaves; fixed = no swing or opening lines; otherwise openable window. If unsure, pick the most likely type and say so in note.
- view: short name of the sheet or elevation, e.g. "Front elevation", "Ground floor plan".
- If red revision clouds mark openings to replace, mention "outlined for replacement" in note for those, and "not outlined" for others.
- Skip title-block text, grid bubbles and level markers.`;

const MODEL = () => process.env.MODEL || 'claude-sonnet-5-5';

async function callClaude(key, image, text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: 'Text extracted from this sheet (may be incomplete):\n' + (text || '') + '\n\nList the openings as JSON.' }
        ] }]
      })
    });
    const raw = await r.text();
    let j; try { j = JSON.parse(raw); } catch (e) { j = {}; }
    if ((r.status === 429 || r.status === 529 || r.status >= 500) && attempt < 2) {
      await new Promise(ok => setTimeout(ok, 2000 * (attempt + 1)));
      continue;
    }
    if (!r.ok) {
      const msg = (j.error && j.error.message) || raw.slice(0, 200) || 'no details';
      throw Object.assign(new Error('Anthropic API ' + r.status + ': ' + msg + ' (model: ' + MODEL() + ')'), { status: 502 });
    }
    return j;
  }
}

function parseOpenings(j) {
  const out = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').replace(/```json|```/g, '').trim();
  const start = out.indexOf('{'), end = out.lastIndexOf('}');
  if (start < 0 || end < start) {
    if (/no (doors|windows|openings)/i.test(out)) return { openings: [] };
    throw new Error('AI did not return JSON' + (j.stop_reason === 'max_tokens' ? ' (answer was cut off, sheet has too many openings)' : '') + ': ' + out.slice(0, 120));
  }
  try { return JSON.parse(out.slice(start, end + 1)); }
  catch (e) {
    // Answer cut off mid-list: keep every complete opening object.
    const items = out.slice(start).match(/\{[^{}]*"description"[^{}]*\}/g) || [];
    const openings = items.map(t => { try { return JSON.parse(t); } catch (x) { return null; } }).filter(Boolean);
    if (openings.length) return { openings, partial: true };
    throw new Error('AI reply was not valid JSON' + (j.stop_reason === 'max_tokens' ? ' (cut off)' : ''));
  }
}

module.exports = async (req, res) => {
  const pw = process.env.APP_PASSWORD;
  const key = process.env.ANTHROPIC_API_KEY;
  // Open /api/extract in a browser to check the setup.
  if (req.method === 'GET') return res.status(200).json({ ok: true, apiKeySet: !!key, passwordSet: !!pw, model: MODEL(), node: process.version });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (pw && req.headers['x-app-password'] !== pw) return res.status(401).json({ error: 'Wrong password' });
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel (add it, then Redeploy)' });
  if (typeof fetch !== 'function') return res.status(500).json({ error: 'Vercel is running an old Node version (' + process.version + '). Set Node.js 20 or newer in Project Settings.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { image, text } = body || {};
  if (!image) return res.status(400).json({ error: 'No image sent' });
  try {
    const j = await callClaude(key, image, text);
    return res.status(200).json(parseOpenings(j));
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
};
