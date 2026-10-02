// Vercel serverless function: sends one drawing sheet (overview + zoomed quarters) to Claude
// and returns the doors and windows found on it. The browser merges the sheets of a set.
const TYPES = ['Fixed window', 'Openable window', 'Sliding window', 'Sliding door', 'Single hinged door', 'Double hinged door', 'Other'];

const SYSTEM = `You are an experienced quantity surveyor for an aluminium doors and windows company in the UAE, reading architectural and shop drawings to build an order list.

You receive ONE sheet of a drawing set as several images: image 1 is the whole sheet; the next images are zoomed, overlapping quarters of the same sheet (top-left, top-right, bottom-left, bottom-right). Use the zoomed images to read small numbers and tags. Dimension numbers and tags are often drawn as lines, not text, so read them visually digit by digit. Report each physical opening once, even if it appears in two overlapping quarters.

Return ONLY JSON, no prose:
{"sheet_type":"elevation"|"plan"|"schedule"|"section"|"detail"|"other",
 "view":string,
 "has_revision_clouds":boolean,
 "project":{"name":string|null,"frame_colour":string|null,"glass":string|null}|null,
 "openings":[{"mark":string|null,"type":${TYPES.map(t => `"${t}"`).join('|')},"width_mm":number|null,"height_mm":number|null,"qty":number,"view":string,"in_cloud":boolean|null,"description":string,"confidence":"high"|"medium"|"low","note":string|null}]}

What counts:
- Every external or internal door, window, sliding door, louvre or glazed screen drawn on the sheet. Not furniture, wardrobes, cabinets, gates in boundary walls, or openings with no frame.
- One entry per physical opening, qty 1, even when several are identical. The only exception is a schedule table with a quantity column: then one entry per schedule row with that qty.
- A sheet can hold several views (e.g. front and rear elevation): give each opening the "view" it is drawn in.

Marks (tags):
- Eurolux shop drawings tag each opening with "ITEM" and a code in a red hexagon, e.g. ITEM 01, ITEM 5A, ITEM 12B. Use just the code as mark: "01", "5A", "12B". Keep leading zeros as drawn.
- Architect drawings use tags like W-01, D-03, SD-1, WM-22, WM-21a. Use them exactly. If an opening has no tag, mark is null.

Sizes:
- On elevations the opening's width is the horizontal dimension directly above or below it, and its height is the vertical dimension beside it. If there are two vertical dimensions beside one opening (e.g. 1800 and 900), the larger one spanning the whole opening is the height; mention the smaller split (transom or fixed panel) in note.
- Ignore overall building dimensions, grid-line dimensions, floor-to-floor heights, parapet heights, sill-to-floor distances, wall lengths between openings and level markers like +3.400 FFL.
- On plans, only give sizes written right at the opening; otherwise null. Plans mainly show where tagged openings are.
- Schedules: trust the column headers (often HEIGHT then WIDTH).
- Never invent or estimate a size. If you cannot read it confidently, give null or your best reading with confidence "low" and say why in note.

Type:
- "F" written inside a panel means a fixed panel. Two or more panels with arrows on a track = sliding. Diagonal lines meeting at one side (a V or X) = hinged or tilt-and-turn opening sash, which is "Openable window" for windows. A door with one leaf and a swing arc or diagonal = "Single hinged door"; two leaves = "Double hinged door". A window that is all fixed panels = "Fixed window". Mixed fixed + opening panels in one frame = "Openable window" and describe the panels in description, e.g. "2 opening sashes over fixed bottom panels".

Revision clouds:
- Architect drawings may circle the openings to be supplied or replaced with red wavy revision clouds. If the sheet has any, set has_revision_clouds true and set in_cloud true/false for each opening. If there are none, in_cloud is null.

Project: from the title block, read the project name, frame colour (e.g. "RAL 9016 matt") and glass specification if shown, else null.

description: short, useful for ordering, e.g. "2-panel sliding door, one fixed", "casement window with fixed transom". note: anything the estimator should check.`;

const MODEL = () => process.env.MODEL || 'claude-sonnet-5-5';

async function callClaude(key, images, text, label) {
  const content = images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
  content.push({ type: 'text', text: `${label}\nText that could be extracted from this sheet (often incomplete; dimensions drawn as lines are missing):\n${text || '(none)'}\n\nList the openings on this sheet as JSON.` });
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 12000, system: SYSTEM, messages: [{ role: 'user', content }] })
    });
    const raw = await r.text();
    let j; try { j = JSON.parse(raw); } catch (e) { j = {}; }
    if ((r.status === 429 || r.status === 529 || r.status >= 500) && attempt < 2) {
      await new Promise(ok => setTimeout(ok, 3000 * (attempt + 1)));
      continue;
    }
    if (!r.ok) {
      const msg = (j.error && j.error.message) || raw.slice(0, 200) || 'no details';
      throw Object.assign(new Error('Anthropic API ' + r.status + ': ' + msg + ' (model: ' + MODEL() + ')'), { status: 502 });
    }
    return j;
  }
}

function parseSheet(j) {
  const out = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').replace(/```json|```/g, '').trim();
  const start = out.indexOf('{'), end = out.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI did not return a list' + (j.stop_reason === 'max_tokens' ? ' (answer was cut off)' : '') + ': ' + out.slice(0, 120));
  try {
    const s = JSON.parse(out.slice(start, end + 1));
    s.openings = Array.isArray(s.openings) ? s.openings : [];
    return s;
  } catch (e) {
    // Answer cut off mid-list: keep every complete opening.
    const openings = (out.match(/\{[^{}]*"description"[^{}]*\}/g) || []).map(t => { try { return JSON.parse(t); } catch (x) { return null; } }).filter(Boolean);
    if (!openings.length) throw new Error('AI reply was not valid JSON' + (j.stop_reason === 'max_tokens' ? ' (cut off)' : ''));
    const st = (out.match(/"sheet_type"\s*:\s*"(\w+)"/) || [])[1] || 'other';
    const view = (out.match(/"view"\s*:\s*"([^"]*)"/) || [])[1] || '';
    return { sheet_type: st, view, openings, partial: true };
  }
}

module.exports = async (req, res) => {
  const pw = process.env.APP_PASSWORD;
  const key = process.env.ANTHROPIC_API_KEY;
  // Open /api/extract in a browser to check the setup.
  if (req.method === 'GET') return res.status(200).json({ ok: true, apiKeySet: !!key, passwordSet: !!pw, model: MODEL(), node: process.version });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (pw && req.headers['x-app-password'] !== pw) return res.status(401).json({ error: 'Wrong password' });
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel (add it under Settings > Environment Variables, then Redeploy)' });
  if (typeof fetch !== 'function') return res.status(500).json({ error: 'Vercel is running an old Node version (' + process.version + '). Choose Node.js 20 or newer in Project Settings.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { images, image, text, label } = body || {};
  const imgs = Array.isArray(images) && images.length ? images.slice(0, 6) : (image ? [image] : []);
  if (!imgs.length) return res.status(400).json({ error: 'No image sent' });
  try {
    const j = await callClaude(key, imgs, String(text || '').slice(0, 6000), String(label || ''));
    const sheet = parseSheet(j);
    sheet.usage = j.usage;
    return res.status(200).json(sheet);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
};
module.exports.TYPES = TYPES;
module.exports.parseSheet = parseSheet;
