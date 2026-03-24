import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTranscriptPdfBytes, extractProducerNoteText } from '../transcript-pdf.js';

function measureText(text, fontSize, fontWeight) {
  const widthMultiplier = fontWeight === '700' ? 0.58 : 0.53;
  return String(text || '').length * fontSize * widthMultiplier;
}

test('extractProducerNoteText reads saved app comments', () => {
  assert.equal(
    extractProducerNoteText({
      comments: ['  First producer note  ', '', 'Second note']
    }),
    'First producer note\nSecond note'
  );
});

test('buildTranscriptPdfBytes includes producer notes in a yellow box', () => {
  const pdfBytes = buildTranscriptPdfBytes(
    {
      title: 'Episode Draft',
      exportDate: new Date('2026-03-23T10:00:00Z'),
      bites: [
        {
          timeLabel: '00:00 - 00:08',
          speakerName: 'Host',
          text: 'Keep this line for the cold open.',
          tone: 'none',
          comments: ['Producer note goes here']
        }
      ]
    },
    { measureText }
  );
  const pdf = new TextDecoder().decode(pdfBytes);

  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /Producer Note/);
  assert.match(pdf, /Producer note goes here/);
  assert.match(pdf, /1 0\.976 0\.91 rg/);
  assert.match(pdf, /0\.788 0\.565 0 RG/);
});

test('buildTranscriptPdfBytes renders good bite tone as a full-width callout', () => {
  const pdfBytes = buildTranscriptPdfBytes(
    {
      title: 'Episode Draft',
      exportDate: new Date('2026-03-23T10:00:00Z'),
      bites: [
        {
          timeLabel: '00:00 - 00:08',
          speakerName: 'Host',
          text: 'Keep this line for the cold open.',
          tone: 'green',
          comments: []
        }
      ]
    },
    { measureText }
  );
  const pdf = new TextDecoder().decode(pdfBytes);

  assert.match(pdf, /Good Bite/);
  assert.match(pdf, /0\.949 0\.984 0\.961 rg/);
  assert.match(pdf, /0\.122 0\.604 0\.333 RG/);
  assert.match(pdf, /54(?:\.0+)? [\d.]+ 504(?:\.0+)? 50(?:\.0+)? re/);
});
