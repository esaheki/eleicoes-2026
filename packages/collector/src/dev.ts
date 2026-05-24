import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.local from repo root if present
const envPath = resolve(__dirname, '../../../.env.local');
if (existsSync(envPath)) config({ path: envPath });

// Defaults for local dev — override with real keys in .env.local
process.env.DRY_RUN ??= 'true';
process.env.COLLECTOR_MODE ??= 'news';
process.env.KEYWORDS ??= 'eleições2026,presidente2026,Lula,Flávio,Zema,Caiado,PT,PL,NOVO,PSD';
process.env.RSS_FEEDS ??= 'https://www.cartacapital.com.br/feed/,https://jovempan.com.br/feed/rss/,https://agenciabrasil.ebc.com.br/rss/politica/feed.xml,https://rss.uol.com.br/feed/noticias.xml,https://feeds.folha.uol.com.br/poder/rss091.xml';
process.env.X_SEARCH_TERMS ??= 'Lula 2026,Flávio Bolsonaro,eleições2026,Zema presidente,Caiado presidente';
process.env.X_LANG_FILTER ??= 'pt';
process.env.X_MAX_TWEETS_PER_TERM ??= '100';
process.env.X_APIFY_ACTOR ??= 'xquik~x-tweet-scraper';
process.env.YOUTUBE_SEARCH_TERMS ??= 'Lula 2026,Flávio Bolsonaro 2026,eleições presidenciais 2026';
process.env.YOUTUBE_MAX_VIDEOS_PER_RUN ??= '5';
process.env.YOUTUBE_MAX_COMMENTS_PER_VIDEO ??= '50';

import { handler } from './index';

handler().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
