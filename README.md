# Opening BOQ

Door and window order list from drawing PDFs. Static PWA plus one Vercel serverless function.

## Deploy
1. Upload all these files to a GitHub repo (keep the `api` folder as is).
2. In Vercel: Add New > Project > import the repo. No build settings needed.
3. Project Settings > Environment Variables:
   - `ANTHROPIC_API_KEY` (required, for Read with AI)
   - `APP_PASSWORD` (recommended, stops strangers spending your credit)
   - `MODEL` (optional, default `claude-sonnet-5-5`)
4. Redeploy, open the URL, then Add to Home Screen.

"Read schedule" works without any key. "Read with AI" sends one page image at a time to your API key.
