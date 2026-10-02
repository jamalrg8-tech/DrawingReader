# Opening BOQ

Door and window order list from drawing PDFs. A static web app plus one Vercel serverless function.

## Deploy
1. Upload all these files to a GitHub repo, keeping the `api` folder as it is.
2. In Vercel: Add New > Project > import the repo. No build settings needed.
3. Project Settings > Environment Variables:
   - `ANTHROPIC_API_KEY` (required for Read drawings). Get it at platform.claude.com > API Keys. Never put it in a file in this repo.
   - `APP_PASSWORD` (recommended, stops strangers using your credit)
   - `MODEL` (optional, default `claude-sonnet-5-5`; `claude-opus-5-5` reads small numbers more accurately but costs more)
4. Redeploy, open the URL, then Add to Home Screen.
5. Check the setup by opening `/api/extract` on your site: it should show `"apiKeySet": true`.

## How it reads
- **Read drawings**: choose the whole set (plans + elevations, one or more PDFs). Each sheet is sent to the AI as an overview plus four zoomed quarters. The app then merges the set: each tagged item once, sizes from schedule > elevation > plan, quantity from how often it is drawn on elevations. Openings outside red revision clouds get qty 0. Rows to check are highlighted.
- **Read schedule**: free and offline, for typed schedule tables.

If Vercel refuses `maxDuration: 300` in `vercel.json`, change it to 60.
