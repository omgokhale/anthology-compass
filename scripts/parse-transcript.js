#!/usr/bin/env node
/**
 * parse-transcript.js
 *
 * Parses a markdown transcript file into a clean JSON array of speaker turns.
 *
 * Format expected:
 *   Speaker Name
 *   Their text content...
 *
 *   Another Speaker
 *   More content...
 *
 * Usage:
 *   node scripts/parse-transcript.js input.md > parsed-turns.json
 */

const fs = require("fs");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node parse-transcript.js <input.md>");
  process.exit(1);
}

const content = fs.readFileSync(inputPath, "utf-8");
const lines = content.split("\n");

const turns = [];
let currentSpeaker = null;
let currentText = [];

for (const line of lines) {
  const trimmed = line.trim();

  // Skip empty lines between turns
  if (!trimmed) {
    if (currentSpeaker && currentText.length > 0) {
      turns.push({
        speaker: currentSpeaker,
        text: currentText.join(" ").trim(),
      });
      currentSpeaker = null;
      currentText = [];
    }
    continue;
  }

  // Skip header line (e.g., "Fascilitator: Erin")
  if (trimmed.match(/^(Fascilitator|Facilitator):/i)) {
    continue;
  }

  // Check if this line is a speaker name (single word/name, no punctuation at end)
  // Heuristic: if the line is short (<25 chars), has no sentence-ending punctuation,
  // and the next line exists, it's likely a speaker name
  const isSpeakerName =
    trimmed.length < 25 &&
    !trimmed.match(/[.!?]$/) &&
    !currentText.length; // Only recognize at turn start

  if (isSpeakerName) {
    // Flush previous turn if exists
    if (currentSpeaker && currentText.length > 0) {
      turns.push({
        speaker: currentSpeaker,
        text: currentText.join(" ").trim(),
      });
      currentText = [];
    }
    currentSpeaker = trimmed;
  } else {
    // Accumulate text for current speaker
    currentText.push(trimmed);
  }
}

// Flush final turn
if (currentSpeaker && currentText.length > 0) {
  turns.push({
    speaker: currentSpeaker,
    text: currentText.join(" ").trim(),
  });
}

// Output JSON
console.log(JSON.stringify(turns, null, 2));
