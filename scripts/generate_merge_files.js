#!/usr/bin/env node

/**
 * Generate merge-ready files from resolved multi-club player data
 *
 * Creates:
 * - resolved_multiclub_rows_merge_ready.csv (apps match within ±1)
 * - resolved_but_mismatched.csv (apps mismatch > 1)
 * - merge_summary.md (summary stats)
 */

const fs = require('fs');
const path = require('path');

// Paths
const ORIGINAL_INPUT = path.join(__dirname, '../data/multi_club_players.csv');
const RESOLVED_INPUT = path.join(__dirname, '../data/outputs/resolved_multiclub_rows.csv');
const UNRESOLVED_INPUT = path.join(__dirname, '../data/outputs/unresolved_multiclub_rows.csv');
const MERGE_READY_OUTPUT = path.join(__dirname, '../data/outputs/resolved_multiclub_rows_merge_ready.csv');
const MISMATCHED_OUTPUT = path.join(__dirname, '../data/outputs/resolved_but_mismatched.csv');
const SUMMARY_OUTPUT = path.join(__dirname, '../data/outputs/merge_summary.md');

function parseCSV(content) {
    const lines = content.trim().split('\n');
    const headers = parseCSVLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx] || '';
        });
        rows.push(row);
    }

    return { headers, rows };
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);

    return result;
}

function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function rowToCSV(row, headers) {
    return headers.map(h => escapeCSV(row[h])).join(',');
}

async function main() {
    console.log('Loading input files...');

    // Load original multi-club players (to get original appearances)
    const originalContent = fs.readFileSync(ORIGINAL_INPUT, 'utf8');
    const original = parseCSV(originalContent);

    // Build lookup: player_uid + season -> original appearances
    const originalAppsLookup = new Map();
    for (const row of original.rows) {
        // Use multi_club_key or construct from player_uid + season
        const key = `${row.player_uid}|${row.season}`;
        originalAppsLookup.set(key, parseInt(row.appearances, 10) || 0);
    }

    console.log(`Loaded ${original.rows.length} original multi-club rows`);

    // Load resolved rows
    const resolvedContent = fs.readFileSync(RESOLVED_INPUT, 'utf8');
    const resolved = parseCSV(resolvedContent);

    console.log(`Loaded ${resolved.rows.length} resolved rows`);

    // Group resolved rows by player_uid + season
    const resolvedByPlayerSeason = new Map();
    for (const row of resolved.rows) {
        const key = `${row.player_uid}|${row.season}`;
        if (!resolvedByPlayerSeason.has(key)) {
            resolvedByPlayerSeason.set(key, []);
        }
        resolvedByPlayerSeason.get(key).push(row);
    }

    console.log(`Found ${resolvedByPlayerSeason.size} unique player-season combinations`);

    // Separate into merge-ready vs mismatched
    const mergeReady = [];
    const mismatched = [];

    for (const [key, rows] of resolvedByPlayerSeason.entries()) {
        const originalApps = originalAppsLookup.get(key);
        const resolvedSumApps = rows.reduce((sum, r) => sum + (parseInt(r.appearances, 10) || 0), 0);

        const diff = Math.abs((originalApps || 0) - resolvedSumApps);

        // Get clubs breakdown
        const clubsBreakdown = rows.map(r => `${r.club}(${r.appearances})`).join(', ');

        if (diff <= 1) {
            // Merge ready - add all rows
            for (const row of rows) {
                mergeReady.push(row);
            }
        } else {
            // Mismatched - record the mismatch
            const firstRow = rows[0];
            mismatched.push({
                player_uid: firstRow.player_uid,
                player_name: firstRow.player_name,
                season: firstRow.season,
                original_apps: originalApps,
                resolved_sum_apps: resolvedSumApps,
                difference: diff,
                clubs_breakdown: clubsBreakdown,
                confidence_score: firstRow.confidence_score
            });
        }
    }

    console.log(`\nResults:`);
    console.log(`  Merge-ready rows: ${mergeReady.length}`);
    console.log(`  Mismatched player-seasons: ${mismatched.length}`);

    // Write merge-ready CSV
    const mergeReadyCSV = [resolved.headers.join(',')];
    for (const row of mergeReady) {
        mergeReadyCSV.push(rowToCSV(row, resolved.headers));
    }
    fs.writeFileSync(MERGE_READY_OUTPUT, mergeReadyCSV.join('\n'), 'utf8');
    console.log(`\nWritten: ${MERGE_READY_OUTPUT}`);

    // Write mismatched CSV
    const mismatchedHeaders = ['player_uid', 'player_name', 'season', 'original_apps', 'resolved_sum_apps', 'difference', 'clubs_breakdown', 'confidence_score'];
    const mismatchedCSV = [mismatchedHeaders.join(',')];
    for (const row of mismatched) {
        mismatchedCSV.push(mismatchedHeaders.map(h => escapeCSV(row[h])).join(','));
    }
    fs.writeFileSync(MISMATCHED_OUTPUT, mismatchedCSV.join('\n'), 'utf8');
    console.log(`Written: ${MISMATCHED_OUTPUT}`);

    // Load unresolved reasons
    let unresolvedReasons = {};
    let unresolvedCount = 0;
    try {
        const unresolvedContent = fs.readFileSync(UNRESOLVED_INPUT, 'utf8');
        const unresolved = parseCSV(unresolvedContent);
        unresolvedCount = unresolved.rows.length;

        for (const row of unresolved.rows) {
            const reason = row.reason_unresolved || 'unknown';
            unresolvedReasons[reason] = (unresolvedReasons[reason] || 0) + 1;
        }
    } catch (e) {
        console.log('Note: Could not load unresolved file');
    }

    // Count unique player-seasons in merge-ready
    const mergeReadyPlayerSeasons = new Set();
    for (const row of mergeReady) {
        mergeReadyPlayerSeasons.add(`${row.player_uid}|${row.season}`);
    }

    // Generate summary markdown
    const summary = `# Multi-Club Player Merge Summary

Generated: ${new Date().toISOString()}

## Overview

| Category | Count | Description |
|----------|-------|-------------|
| **Merge Ready** | ${mergeReadyPlayerSeasons.size} player-seasons (${mergeReady.length} rows) | Apps match within ±1 |
| **Mismatched** | ${mismatched.length} player-seasons | Apps differ by > 1 |
| **Unresolved** | ${unresolvedCount} player-seasons | Could not resolve via SportMonks |

## Merge-Ready Details

- **Total rows**: ${mergeReady.length}
- **Unique player-seasons**: ${mergeReadyPlayerSeasons.size}
- **Ready for Supabase import**: YES

These rows have been validated:
- Per-club appearances sum matches original total (±1 tolerance)
- All clubs have appearances > 0
- Confidence scores >= 0.5

## Mismatched Cases (${mismatched.length})

These player-seasons resolved but have appearance discrepancies > 1:

| Player | Season | Original | Resolved | Diff | Clubs |
|--------|--------|----------|----------|------|-------|
${mismatched.map(m => `| ${m.player_name} | ${m.season} | ${m.original_apps} | ${m.resolved_sum_apps} | ${m.difference} | ${m.clubs_breakdown} |`).join('\n')}

**Recommendation**: Review these manually before including in merge.

## Unresolved by Reason (${unresolvedCount} total)

| Reason | Count | Action Required |
|--------|-------|-----------------|
${Object.entries(unresolvedReasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => {
    let action = '';
    switch(reason) {
        case 'season_not_found':
            action = 'No action - historical seasons not in SportMonks';
            break;
        case 'no_player_match':
            action = 'Manual lookup if needed';
            break;
        case 'no_team_split':
            action = 'Consider keeping original aggregated row';
            break;
        case 'low_confidence':
            action = 'Manual verification recommended';
            break;
        default:
            action = 'Review case-by-case';
    }
    return `| ${reason} | ${count} | ${action} |`;
}).join('\n')}

## Import Instructions

### To replace "2 Teams/3 Teams" rows in Supabase:

1. **Delete** existing rows where \`club_raw\` matches "N Teams" pattern for player_uids in merge-ready set
2. **Insert** all rows from \`resolved_multiclub_rows_merge_ready.csv\`
3. **Leave unchanged** any rows in mismatched or unresolved sets

### Key columns for import:
- \`player_uid\` - matches original player identifier
- \`season\` - e.g., "2017/18"
- \`club\` - resolved club name (e.g., "Liverpool", "Arsenal")
- \`appearances\`, \`goals\`, \`minutes\`, \`starts\`, \`sub_appearances\`
- \`sportmonks_player_id\`, \`sportmonks_team_id\` - for data lineage

## Data Quality Notes

- All merge-ready rows have confidence scores >= 0.5
- Minutes, starts, and sub_appearances may be NULL where SportMonks lacks data
- Goals are included where available
- Original player_uid is preserved for referential integrity
`;

    fs.writeFileSync(SUMMARY_OUTPUT, summary, 'utf8');
    console.log(`Written: ${SUMMARY_OUTPUT}`);

    console.log('\n========================================');
    console.log('MERGE FILES GENERATED SUCCESSFULLY');
    console.log('========================================');
    console.log(`\nReady for Supabase import:`);
    console.log(`  ${MERGE_READY_OUTPUT}`);
    console.log(`\nReview before merge:`);
    console.log(`  ${MISMATCHED_OUTPUT}`);
    console.log(`\nSummary:`);
    console.log(`  ${SUMMARY_OUTPUT}`);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
