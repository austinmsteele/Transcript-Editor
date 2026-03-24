const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT_MARGIN = 54;
const RIGHT_MARGIN = 54;
const TOP_MARGIN = 56;
const BOTTOM_MARGIN = 56;
const TRANSCRIPT_FONT_SIZE = 12;
const TRANSCRIPT_LINE_HEIGHT = 16;
const NOTE_FONT_SIZE = 11;
const NOTE_LINE_HEIGHT = 14;
const NOTE_BOX_HEIGHT_BASE = 36;
const NOTE_BOX_SIDE_PADDING = 10;
const NOTE_BOX_BOTTOM_GAP = 12;
const CALLOUT_LABEL_TOP_PADDING = 10;
const CALLOUT_BODY_TOP_OFFSET = 26;
const TONE_BOX_MIN_BODY_LINES = 1;

export function buildTranscriptPdfBytes({ title = 'Transcript', exportDate = new Date(), bites = [] } = {}, options = {}) {
  const contentWidth = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN;
  const measureText = typeof options.measureText === 'function'
    ? options.measureText
    : approximatePdfTextWidth;
  const pages = [];
  let commands = [];
  let cursorY = TOP_MARGIN;

  function beginPage() {
    commands = [];
    pages.push(commands);
    cursorY = TOP_MARGIN;
  }

  function ensureSpace(height) {
    if (!pages.length) {
      beginPage();
    }

    if (cursorY + height <= PAGE_HEIGHT - BOTTOM_MARGIN) {
      return;
    }

    beginPage();
  }

  beginPage();
  drawPdfText(commands, PAGE_HEIGHT, String(title || 'Transcript'), LEFT_MARGIN, cursorY, {
    font: 'F2',
    size: 22,
    color: [17, 17, 17]
  });
  cursorY += 30;

  drawPdfText(commands, PAGE_HEIGHT, formatPdfExportDate(exportDate), LEFT_MARGIN, cursorY, {
    font: 'F1',
    size: 10,
    color: [107, 107, 107]
  });
  cursorY += 28;

  for (const bite of bites) {
    const timeLabel = String(bite?.timeLabel || '');
    const speakerName = String(bite?.speakerName || '');
    const transcriptText = String(bite?.text || '').trim();
    const toneMeta = getToneMeta(bite?.tone);
    const producerNote = extractProducerNoteText(bite);
    const transcriptLines = wrapPdfText(
      transcriptText,
      contentWidth,
      TRANSCRIPT_FONT_SIZE,
      '400',
      measureText
    );
    const producerNoteLines = producerNote
      ? wrapPdfParagraphs(
          producerNote,
          contentWidth - NOTE_BOX_SIDE_PADDING * 2,
          NOTE_FONT_SIZE,
          '400',
          measureText
        )
      : [];
    const headerHeight = speakerName ? 30 : 16;
    const transcriptHeight = Math.max(1, transcriptLines.length) * TRANSCRIPT_LINE_HEIGHT;
    const toneBoxHeight = toneMeta
      ? getPdfCalloutHeight([], { minBodyLines: TONE_BOX_MIN_BODY_LINES })
      : 0;
    const toneSectionHeight = toneMeta ? toneBoxHeight + NOTE_BOX_BOTTOM_GAP : 10;
    const noteBoxHeight = producerNoteLines.length ? getPdfCalloutHeight(producerNoteLines) : 0;
    const noteSectionHeight = producerNoteLines.length ? noteBoxHeight + NOTE_BOX_BOTTOM_GAP : 0;
    const dividerHeight = 18;
    const blockHeight = headerHeight + transcriptHeight + toneSectionHeight + noteSectionHeight + dividerHeight;

    ensureSpace(blockHeight);

    drawPdfText(commands, PAGE_HEIGHT, timeLabel, LEFT_MARGIN, cursorY, {
      font: 'F2',
      size: 11,
      color: [17, 17, 17]
    });
    cursorY += 16;

    if (speakerName) {
      drawPdfText(commands, PAGE_HEIGHT, speakerName, LEFT_MARGIN, cursorY, {
        font: 'F1',
        size: 10,
        color: [107, 107, 107]
      });
      cursorY += 14;
    }

    for (const line of transcriptLines) {
      drawPdfText(commands, PAGE_HEIGHT, line, LEFT_MARGIN, cursorY, {
        font: 'F1',
        size: TRANSCRIPT_FONT_SIZE,
        color: [17, 17, 17]
      });
      cursorY += TRANSCRIPT_LINE_HEIGHT;
    }

    if (toneMeta) {
      drawPdfCallout(commands, PAGE_HEIGHT, LEFT_MARGIN, cursorY, contentWidth, {
        title: toneMeta.label,
        fillColor: toneMeta.fillColor,
        strokeColor: toneMeta.strokeColor,
        titleColor: toneMeta.textColor,
        minBodyLines: TONE_BOX_MIN_BODY_LINES
      });
      cursorY += toneSectionHeight;
    } else {
      cursorY += 10;
    }

    if (producerNoteLines.length) {
      drawPdfCallout(commands, PAGE_HEIGHT, LEFT_MARGIN, cursorY, contentWidth, {
        title: 'Producer Note',
        bodyLines: producerNoteLines,
        fillColor: [255, 249, 232],
        strokeColor: [201, 144, 0],
        titleColor: [138, 103, 0],
        bodyColor: [95, 72, 0]
      });
      cursorY += noteBoxHeight + NOTE_BOX_BOTTOM_GAP;
    }

    drawPdfLine(commands, PAGE_HEIGHT, LEFT_MARGIN, cursorY, PAGE_WIDTH - RIGHT_MARGIN, cursorY, {
      color: [217, 217, 217],
      width: 1
    });
    cursorY += 18;
  }

  return buildPdfDocument(pages, PAGE_WIDTH, PAGE_HEIGHT);
}

export function extractProducerNoteText(bite) {
  const explicitNote = collapseMultilineWhitespace(String(bite?.noteText || ''));
  if (explicitNote) {
    return explicitNote;
  }

  const commentText = Array.isArray(bite?.comments)
    ? bite.comments
        .map((entry) => collapseMultilineWhitespace(String(entry || '')))
        .filter(Boolean)
        .join('\n')
    : '';
  if (commentText) {
    return commentText;
  }

  return collapseMultilineWhitespace(String(bite?.notes || ''));
}

function wrapPdfParagraphs(text, maxWidth, fontSize, fontWeight, measureText) {
  const normalizedText = sanitizePdfMultilineText(text);
  if (!normalizedText) {
    return [''];
  }

  const paragraphs = normalizedText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return [''];
  }

  const wrapped = [];
  paragraphs.forEach((paragraph, index) => {
    wrapped.push(...wrapPdfText(paragraph, maxWidth, fontSize, fontWeight, measureText));
    if (index < paragraphs.length - 1) {
      wrapped.push('');
    }
  });

  return wrapped;
}

function wrapPdfText(text, maxWidth, fontSize, fontWeight, measureText) {
  const normalizedText = sanitizePdfText(text).replace(/\s+/g, ' ').trim();
  if (!normalizedText) {
    return [''];
  }

  const words = normalizedText.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (measureText(nextLine, fontSize, fontWeight) <= maxWidth) {
      currentLine = nextLine;
      continue;
    }

    if (!currentLine) {
      lines.push(...splitPdfWord(word, maxWidth, fontSize, fontWeight, measureText));
      currentLine = '';
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function splitPdfWord(word, maxWidth, fontSize, fontWeight, measureText) {
  const fragments = [];
  let currentFragment = '';

  for (const character of word) {
    const nextFragment = currentFragment + character;
    if (measureText(nextFragment, fontSize, fontWeight) <= maxWidth || !currentFragment) {
      currentFragment = nextFragment;
      continue;
    }

    fragments.push(currentFragment);
    currentFragment = character;
  }

  if (currentFragment) {
    fragments.push(currentFragment);
  }

  return fragments;
}

function approximatePdfTextWidth(text, fontSize, fontWeight) {
  const widthMultiplier = fontWeight === '700' ? 0.58 : 0.53;
  return sanitizePdfText(text).length * fontSize * widthMultiplier;
}

function getToneMeta(tone) {
  if (tone === 'red') {
    return {
      label: 'Must Have',
      fillColor: [255, 244, 243],
      strokeColor: [217, 75, 66],
      textColor: [142, 47, 41]
    };
  }

  if (tone === 'yellow') {
    return {
      label: 'High Priority',
      fillColor: [255, 249, 232],
      strokeColor: [201, 144, 0],
      textColor: [138, 103, 0]
    };
  }

  if (tone === 'green') {
    return {
      label: 'Good Bite',
      fillColor: [242, 251, 245],
      strokeColor: [31, 154, 85],
      textColor: [23, 107, 60]
    };
  }

  return null;
}

function getPdfCalloutHeight(bodyLines = [], options = {}) {
  const lines = Array.isArray(bodyLines) ? bodyLines : [];
  const minBodyLines = Math.max(0, Number(options.minBodyLines) || 0);
  return NOTE_BOX_HEIGHT_BASE + Math.max(lines.length, minBodyLines) * NOTE_LINE_HEIGHT;
}

function drawPdfCallout(commands, pageHeight, x, y, width, options = {}) {
  const bodyLines = Array.isArray(options.bodyLines) ? options.bodyLines : [];
  const title = String(options.title || '').trim();
  const titleColor = options.titleColor || [17, 17, 17];
  const bodyColor = options.bodyColor || titleColor;
  const height = getPdfCalloutHeight(bodyLines, options);

  drawPdfRect(commands, pageHeight, x, y, width, height, {
    fillColor: options.fillColor,
    strokeColor: options.strokeColor
  });
  drawPdfText(commands, pageHeight, title, x + NOTE_BOX_SIDE_PADDING, y + CALLOUT_LABEL_TOP_PADDING, {
    font: 'F2',
    size: 10,
    color: titleColor
  });

  let bodyY = y + CALLOUT_BODY_TOP_OFFSET;
  for (const line of bodyLines) {
    drawPdfText(commands, pageHeight, line, x + NOTE_BOX_SIDE_PADDING, bodyY, {
      font: 'F1',
      size: NOTE_FONT_SIZE,
      color: bodyColor
    });
    bodyY += NOTE_LINE_HEIGHT;
  }

  return height;
}

function drawPdfText(commands, pageHeight, text, x, y, options = {}) {
  const safeText = escapePdfText(sanitizePdfText(text));
  if (!safeText) return;

  const font = options.font || 'F1';
  const size = options.size || 12;
  const color = formatPdfColor(options.color || [0, 0, 0]);
  const pdfY = pageHeight - y - size;

  commands.push('BT');
  commands.push(`/${font} ${size} Tf`);
  commands.push(`${color} rg`);
  commands.push(`1 0 0 1 ${formatPdfNumber(x)} ${formatPdfNumber(pdfY)} Tm`);
  commands.push(`(${safeText}) Tj`);
  commands.push('ET');
}

function drawPdfRect(commands, pageHeight, x, y, width, height, options = {}) {
  const fillColor = formatPdfColor(options.fillColor || [255, 255, 255]);
  const strokeColor = formatPdfColor(options.strokeColor || [217, 217, 217]);
  const pdfY = pageHeight - y - height;

  commands.push('q');
  commands.push(`${fillColor} rg`);
  commands.push(`${strokeColor} RG`);
  commands.push('1 w');
  commands.push(`${formatPdfNumber(x)} ${formatPdfNumber(pdfY)} ${formatPdfNumber(width)} ${formatPdfNumber(height)} re`);
  commands.push('B');
  commands.push('Q');
}

function drawPdfLine(commands, pageHeight, x1, y1, x2, y2, options = {}) {
  const strokeColor = formatPdfColor(options.color || [217, 217, 217]);
  const width = options.width || 1;

  commands.push('q');
  commands.push(`${strokeColor} RG`);
  commands.push(`${formatPdfNumber(width)} w`);
  commands.push(`${formatPdfNumber(x1)} ${formatPdfNumber(pageHeight - y1)} m`);
  commands.push(`${formatPdfNumber(x2)} ${formatPdfNumber(pageHeight - y2)} l`);
  commands.push('S');
  commands.push('Q');
}

function buildPdfDocument(pages, pageWidth, pageHeight) {
  const objects = [];
  let nextObjectId = 1;
  const fontRegularId = nextObjectId++;
  const fontBoldId = nextObjectId++;
  const pageEntries = pages.map((commands) => ({
    contentId: nextObjectId++,
    pageId: nextObjectId++,
    content: commands.join('\n')
  }));
  const pagesId = nextObjectId++;
  const catalogId = nextObjectId++;

  objects[fontRegularId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[fontBoldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  for (const entry of pageEntries) {
    objects[entry.contentId] = `<< /Length ${entry.content.length} >>\nstream\n${entry.content}\nendstream`;
    objects[entry.pageId] = [
      '<< /Type /Page',
      `/Parent ${pagesId} 0 R`,
      `/MediaBox [0 0 ${pageWidth} ${pageHeight}]`,
      `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >>`,
      `/Contents ${entry.contentId} 0 R`,
      '>>'
    ].join('\n');
  }

  objects[pagesId] = `<< /Type /Pages /Kids [${pageEntries.map((entry) => `${entry.pageId} 0 R`).join(' ')}] /Count ${pageEntries.length} >>`;
  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (let objectId = 1; objectId < objects.length; objectId += 1) {
    offsets[objectId] = pdf.length;
    pdf += `${objectId} 0 obj\n${objects[objectId]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';

  for (let objectId = 1; objectId < objects.length; objectId += 1) {
    pdf += `${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function formatPdfExportDate(date) {
  const safeDate = date instanceof Date && !Number.isNaN(date.getTime())
    ? date
    : new Date(date);
  if (Number.isNaN(safeDate.getTime())) {
    return '';
  }

  const month = String(safeDate.getMonth() + 1).padStart(2, '0');
  const day = String(safeDate.getDate()).padStart(2, '0');
  const year = String(safeDate.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function formatPdfColor(rgb) {
  return rgb.map((value) => formatPdfNumber((Math.max(0, Math.min(255, Number(value) || 0))) / 255)).join(' ');
}

function formatPdfNumber(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, '');
}

function escapePdfText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function sanitizePdfText(value) {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '');
}

function sanitizePdfMultilineText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/g, '')
    .trim();
}

function collapseMultilineWhitespace(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, index, allLines) => line || (index > 0 && allLines[index - 1]))
    .join('\n')
    .trim();
}
