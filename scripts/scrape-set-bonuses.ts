/**
 * Scrape set bonus descriptions from eso-hub.com using Cheerio.
 * Populates the set_bonuses table in the SQLite database.
 *
 * Run with: npx tsx scripts/scrape-set-bonuses.ts
 *
 * The eso-hub.com pages are Next.js rendered. The bonus text appears in the DOM
 * in a format like:
 *   (2 items) Adds 1096 Maximum Magicka(3 items) Adds 657 Critical Chance...
 * inside a tooltip-style card.
 *
 * We split on the "(N items)" pattern to extract individual bonuses.
 */

import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const DB_PATH = join(PROJECT_ROOT, 'data', 'eso_sets.db');

// ---- Helpers ----

/** Convert a set name to a URL slug for eso-hub.com */
function nameToSlug(name: string): string {
  return name
    .normalize('NFD')                   // decompose accented chars (â -> a + combining accent)
    .replace(/[\u0300-\u036f]/g, '')    // remove combining diacritical marks
    .toLowerCase()
    .replace(/['\u2019\u2018]/g, '')   // remove apostrophes (curly and straight)
    .replace(/[^a-z0-9\s-]/g, '')      // remove other special chars
    .replace(/\s+/g, '-')              // spaces -> hyphens
    .replace(/-+/g, '-')               // collapse multiple hyphens
    .replace(/^-|-$/g, '');            // trim leading/trailing hyphens
}

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse a bonus description to extract stat info.
 * Examples:
 *   "Adds 1096 Maximum Magicka"      -> stat bonus
 *   "Adds 129 Spell Damage"          -> stat bonus
 *   "When you deal damage, ..."      -> proc bonus
 *   "Gain Minor Slayer at all times" -> unique bonus
 */
function parseBonusDescription(desc: string): {
  bonus_type: string;
  stat_type: string | null;
  stat_value: number | null;
} {
  // Common stat bonus pattern: "Adds <number> <stat>"
  const addsMatch = desc.match(/^Adds\s+(\d[\d,]*)\s+(.+)$/i);
  if (addsMatch) {
    return {
      bonus_type: 'stat',
      stat_type: addsMatch[2].trim(),
      stat_value: parseInt(addsMatch[1].replace(/,/g, ''), 10),
    };
  }

  // Proc-style bonuses
  const procPatterns = [
    /^when\s+you/i, /^after\s+/i, /^dealing\s+/i, /^taking\s+/i,
    /^while\s+/i, /^upon\s+/i, /^applying\s+/i, /^activating\s+/i,
    /^casting\s+/i, /^blocking\s+/i, /^healing\s+/i, /^consuming\s+/i,
    /^completing\s+/i, /^your\s+.*(chance|proc|trigger)/i,
  ];
  for (const pattern of procPatterns) {
    if (pattern.test(desc)) {
      return { bonus_type: 'proc', stat_type: null, stat_value: null };
    }
  }

  // Gain Minor/Major buffs
  if (/^gain\s+/i.test(desc)) {
    return { bonus_type: 'unique', stat_type: null, stat_value: null };
  }

  // "Increases ... by N ..."
  const increaseMatch = desc.match(/(?:increase|reduce|restore)s?\s+.*?by\s+(\d[\d,]*)\s*(.*)/i);
  if (increaseMatch) {
    return {
      bonus_type: 'stat',
      stat_type: increaseMatch[2]?.trim() || null,
      stat_value: parseInt(increaseMatch[1].replace(/,/g, ''), 10),
    };
  }

  return { bonus_type: 'unique', stat_type: null, stat_value: null };
}

interface SetRow {
  set_id: number;
  name_en: string;
}

interface BonusData {
  pieces_required: number;
  description: string;
  bonus_type: string;
  stat_type: string | null;
  stat_value: number | null;
}

/**
 * Extract bonuses from the page HTML using Cheerio.
 * The eso-hub.com page contains bonus text in format:
 *   (2 items) Adds 1096 Maximum Magicka(3 items) Adds 657 Critical Chance...
 * We find elements containing "(N items)" and split on that pattern.
 */
function extractBonusesFromHtml(html: string): { pieces: number; text: string }[] {
  const $ = cheerio.load(html);
  const results: { pieces: number; text: string }[] = [];
  const seen = new Set<string>();

  // Find all elements whose text content contains "(N items)"
  $('*').each((_index, el) => {
    const $el = $(el);

    // Skip container elements with lots of children (we want the most specific element)
    if ($el.children().length > 10) return;

    const text = $el.text().trim();
    if (!text.includes('item)') && !text.includes('items)')) return;
    if (text.length > 2000) return; // skip huge containers

    // Split on the "(N items)" pattern to get individual bonuses
    const parts = text.split(/\((\d)\s*items?\)/i);

    // parts will be like: ["prefix...", "2", " Adds 1096 Maximum Magicka", "3", " Adds 657 ...", ...]
    for (let i = 1; i < parts.length; i += 2) {
      const pieces = parseInt(parts[i], 10);
      const desc = (parts[i + 1] || '').trim();

      if (pieces >= 1 && pieces <= 12 && desc.length > 3 && desc.length < 500) {
        let cleanDesc = desc
          .replace(/\(\d\s*items?\).*$/i, '')
          .replace(/\s*Compare this armor set with other sets.*/i, '')
          .replace(/\s*Tooltips by ESO-Hub\.com.*/i, '')
          .replace(/\s*ESO-Hub\.com.*/i, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (cleanDesc.length > 3) {
          const key = `${pieces}:${cleanDesc}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ pieces, text: cleanDesc });
          }
        }
      }
    }
  });

  return results;
}

/**
 * Fetch a set page from eso-hub.com and extract bonuses using Cheerio.
 */
async function scrapeSetPage(slug: string): Promise<BonusData[] | null> {
  const url = `https://eso-hub.com/en/sets/${slug}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      console.error(`  HTTP ${response.status} for ${url}`);
      return null;
    }

    const html = await response.text();

    // Check for Cloudflare challenge
    if (html.includes('challenge-platform') || html.includes('Just a moment')) {
      console.error(`  Cloudflare challenge detected for ${url}, skipping`);
      return null;
    }

    const rawBonuses = extractBonusesFromHtml(html);

    if (rawBonuses.length === 0) {
      return null;
    }

    // Group by pieces_required — take the first set of bonuses
    const firstOccurrence: BonusData[] = [];
    const seenPieces = new Set<number>();

    for (const b of rawBonuses) {
      if (seenPieces.has(b.pieces)) {
        break;
      }
      seenPieces.add(b.pieces);

      const parsed = parseBonusDescription(b.text);
      firstOccurrence.push({
        pieces_required: b.pieces,
        description: b.text,
        bonus_type: parsed.bonus_type,
        stat_type: parsed.stat_type,
        stat_value: parsed.stat_value,
      });
    }

    return firstOccurrence.length > 0 ? firstOccurrence : null;
  } catch (err: any) {
    if (
      err.message?.includes('net::ERR_') ||
      err.message?.includes('aborted') ||
      err.message?.includes('Timeout') ||
      err.message?.includes('ERR_CONNECTION')
    ) {
      return null;
    }
    throw err;
  }
}

// ---- Main ----

async function main() {
  console.log('=== ESO Set Bonus Scraper (Cheerio) ===');
  console.log(`Database: ${DB_PATH}\n`);

  // Open database
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Get all sets
  const sets = db.prepare('SELECT set_id, name_en FROM sets ORDER BY set_id').all() as SetRow[];
  console.log(`Found ${sets.length} sets in database.\n`);

  if (sets.length === 0) {
    console.log('No sets found in database. Run import-all-sets.ts first.');
    db.close();
    return;
  }

  // Prepare insert statement
  const insertBonus = db.prepare(`
    INSERT OR IGNORE INTO set_bonuses (set_id, pieces_required, bonus_type, stat_type, stat_value, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Check which sets already have bonuses (to support resume)
  const existingBonuses = new Set<number>();
  const existingRows = db.prepare('SELECT DISTINCT set_id FROM set_bonuses').all() as { set_id: number }[];
  for (const row of existingRows) {
    existingBonuses.add(row.set_id);
  }
  if (existingBonuses.size > 0) {
    console.log(`Resuming: ${existingBonuses.size} sets already have bonuses, skipping them.\n`);
  }

  // Filter to sets that need scraping
  const setsToScrape = sets.filter(s => !existingBonuses.has(s.set_id));
  console.log(`Sets to scrape: ${setsToScrape.length}\n`);

  if (setsToScrape.length === 0) {
    console.log('All sets already have bonuses. Nothing to do.');
    db.close();
    return;
  }

  // ---- Phase 1: Test with Mother's Sorrow ----
  console.log("\n--- Phase 1: Testing with Mother's Sorrow ---");
  const testSlug = 'mothers-sorrow';

  const testBonuses = await scrapeSetPage(testSlug);
  if (testBonuses && testBonuses.length > 0) {
    console.log(`SUCCESS: Found ${testBonuses.length} bonuses for Mother's Sorrow:`);
    for (const b of testBonuses) {
      console.log(`  ${b.pieces_required}pc: ${b.description} [${b.bonus_type}${b.stat_type ? `, ${b.stat_type}=${b.stat_value}` : ''}]`);
    }
    console.log('');
  } else {
    console.log("FAILED: Could not extract bonuses for Mother's Sorrow.");
    console.log('Aborting: fix the selectors first.');
    db.close();
    return;
  }

  // ---- Phase 2: Scrape all sets ----
  console.log('--- Phase 2: Scraping all sets ---\n');

  let scraped = 0;
  let failed = 0;
  const totalToScrape = setsToScrape.length;
  const failedSets: { set_id: number; name: string; slug: string }[] = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < setsToScrape.length; i++) {
    const set = setsToScrape[i];
    const slug = nameToSlug(set.name_en);

    try {
      const bonuses = await scrapeSetPage(slug);

      if (bonuses && bonuses.length > 0) {
        // Insert bonuses into DB (commit after each set for resume support)
        const insertBatch = db.transaction((items: BonusData[]) => {
          for (const b of items) {
            insertBonus.run(
              set.set_id,
              b.pieces_required,
              b.bonus_type,
              b.stat_type,
              b.stat_value,
              b.description,
            );
          }
        });
        insertBatch(bonuses);
        scraped++;
      } else {
        failed++;
        failedSets.push({ set_id: set.set_id, name: set.name_en, slug });
      }
    } catch (err: any) {
      failed++;
      failedSets.push({ set_id: set.set_id, name: set.name_en, slug });
      console.error(`  ERROR scraping [${set.set_id}] ${set.name_en}: ${err.message}`);
    }

    // Progress report
    const total = i + 1;
    if (total % 25 === 0 || total === totalToScrape) {
      const pct = ((total / totalToScrape) * 100).toFixed(1);
      console.log(`  Progress: ${total}/${totalToScrape} (${pct}%) - Success: ${scraped}, Failed: ${failed}`);
    }

    // Polite delay between requests (600-1000ms)
    await sleep(600 + Math.random() * 400);

    // Longer pause every batch to avoid rate limiting
    if (total % BATCH_SIZE === 0 && total < totalToScrape) {
      console.log(`  ... pausing 5s after batch ${Math.floor(total / BATCH_SIZE)}...`);
      await sleep(5000);
    }
  }

  // ---- Phase 3: Retry failed sets with alternate slugs ----
  if (failedSets.length > 0 && failedSets.length < setsToScrape.length) {
    console.log(`\n--- Phase 3: Retrying ${failedSets.length} failed sets with alternate slugs ---\n`);

    const retryFailed: typeof failedSets = [];

    for (let i = 0; i < failedSets.length; i++) {
      const { set_id, name, slug: originalSlug } = failedSets[i];

      // Generate alternate slug patterns
      const altSlugs: string[] = [];

      // Remove leading "the-"
      if (originalSlug.startsWith('the-')) {
        altSlugs.push(originalSlug.replace(/^the-/, ''));
      }

      // Replace apostrophes with hyphens instead of removing
      const dashApostrophe = name.toLowerCase()
        .replace(/['\u2019\u2018]/g, '-')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (dashApostrophe !== originalSlug) {
        altSlugs.push(dashApostrophe);
      }

      // Try with "set" suffix removed (some set names include "Set" at the end)
      if (originalSlug.endsWith('-set')) {
        altSlugs.push(originalSlug.replace(/-set$/, ''));
      }

      let found = false;
      for (const altSlug of altSlugs) {
        try {
          const bonuses = await scrapeSetPage(altSlug);
          if (bonuses && bonuses.length > 0) {
            const insertBatch = db.transaction((items: BonusData[]) => {
              for (const b of items) {
                insertBonus.run(set_id, b.pieces_required, b.bonus_type, b.stat_type, b.stat_value, b.description);
              }
            });
            insertBatch(bonuses);
            scraped++;
            failed--;
            found = true;
            break;
          }
        } catch {
          // continue to next slug
        }
        await sleep(600);
      }

      if (!found) {
        retryFailed.push({ set_id, name, slug: originalSlug });
      }

      if ((i + 1) % 25 === 0) {
        console.log(`  Retried ${i + 1}/${failedSets.length}...`);
      }
    }

    if (retryFailed.length > 0) {
      console.log(`\nSets that could not be scraped (${retryFailed.length}):`);
      for (const s of retryFailed.slice(0, 50)) {
        console.log(`  - [${s.set_id}] ${s.name} (slug: ${s.slug})`);
      }
      if (retryFailed.length > 50) {
        console.log(`  ... and ${retryFailed.length - 50} more`);
      }
    }
  }

  // Final stats
  const totalBonuses = (db.prepare('SELECT COUNT(*) as count FROM set_bonuses').get() as { count: number }).count;
  const setsWithBonuses = (db.prepare('SELECT COUNT(DISTINCT set_id) as count FROM set_bonuses').get() as { count: number }).count;

  console.log('\n=== Final Results ===');
  console.log(`Total sets in DB: ${sets.length}`);
  console.log(`Sets scraped this run: ${scraped}`);
  console.log(`Sets failed this run: ${failed}`);
  console.log(`Sets skipped (already had bonuses): ${existingBonuses.size}`);
  console.log(`Total sets with bonuses: ${setsWithBonuses}`);
  console.log(`Total bonus rows in DB: ${totalBonuses}`);

  // Update metadata
  const setMeta = db.prepare('INSERT OR REPLACE INTO import_metadata (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  setMeta.run('set_bonuses_scraped', 'true');
  setMeta.run('set_bonuses_count', String(totalBonuses));
  setMeta.run('set_bonuses_scrape_date', new Date().toISOString());
  setMeta.run('set_bonuses_source', 'eso-hub.com');
  setMeta.run('sets_with_bonuses_count', String(setsWithBonuses));

  db.close();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
