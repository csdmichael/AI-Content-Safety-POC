import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read the manifest to know what files to create
const manifest = JSON.parse(await fs.readFile(path.join(__dirname, 'data/manifest.json'), 'utf8'));

// Helper to create directory if it doesn't exist
const ensureDir = async (dir) => {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    // directory might already exist
  }
};

// Generate realistic PNG with canvas-like data (1024x768)
const createRealisticPNG = async (filePath, seedText) => {
  // PNG header
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  
  // Create IHDR chunk for 1024x768 image
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1024, 0); // width
  ihdr.writeUInt32BE(768, 4);  // height
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type (RGB)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  
  const chunkData = Buffer.concat([Buffer.from('IHDR'), ihdr]);
  
  // Simple CRC calculation (simplified)
  const crcValue = 0x8095fea3; // Precalculated for this IHDR
  
  const ihdrChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x0d]), // length
    chunkData,
    Buffer.alloc(4).fill(0) // CRC placeholder
  ]);
  
  // Create minimal IDAT chunk with compressed image data
  const idatData = Buffer.from([
    0x78, 0x9c, 0xed, 0xc1, 0x01, 0x0d, 0x00, 0x00,
    0x00, 0xc2, 0xa0, 0xf5, 0x4f, 0xed, 0x61, 0x0d,
    0xa0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0xff
  ]);
  
  const idatChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, idatData.length]), 
    Buffer.from('IDAT'),
    idatData,
    Buffer.alloc(4) // CRC
  ]);
  
  // IEND chunk
  const iendChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('IEND'),
    Buffer.from([0xae, 0x42, 0x60, 0x82])
  ]);
  
  const pngData = Buffer.concat([pngSignature, ihdrChunk, idatChunk, iendChunk]);
  await fs.writeFile(filePath, pngData);
};

// Create realistic JPEG
const createRealisticJPEG = async (filePath, seedText) => {
  // JPEG SOI marker + basic structure
  const jpegData = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x01, 0x00,
    0x01, 0x00, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F,
    0x00, 0xFB, 0xD1, 0x40, 0xFF, 0xD9
  ]);
  await fs.writeFile(filePath, jpegData);
};

// Create realistic PDF with actual text content
const createRealisticPDF = async (filePath, seedText) => {
  const content = `${seedText}\n\nDocument Reference ID: ${Math.random().toString(36).substr(2, 9)}\nGenerated: ${new Date().toISOString()}\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.`;
  
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources 4 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>
endobj
5 0 obj
<< /Length ${content.length + 100} >>
stream
BT
/F1 12 Tf
50 750 Td
(${content.replace(/[()\\]/g, '\\$&').substring(0, 200)}) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000203 00000 n 
0000000290 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${content.length + 400}
%%EOF`;
  
  await fs.writeFile(filePath, pdfContent);
};

// Create realistic DOCX (ZIP XML structure)
const createRealisticDOCX = async (filePath, seedText) => {
  const fullText = `${seedText}\n\nDocument Content:\nThis is a realistic Word document containing multiple paragraphs of content. The document includes the initial seed text followed by additional body text to simulate a real document structure.\n\nAdditional Information:\nThis document has been created for testing purposes. It contains sufficient content to be analyzed by content safety systems.`;
  
  const escapeXml = (str) => {
    const map = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;'
    };
    return str.replace(/[<>&"']/g, c => map[c]);
  };

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>${escapeXml(fullText)}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;
  
  await fs.writeFile(filePath, xml);
};

// Create realistic PPT
const createRealisticPPT = async (filePath, seedText) => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
  </p:sldIdLst>
  <p:notesMasterIdLst/>
  <p:handoutMasterIdLst/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:showPropLst/>
  <p:extLst/>
</p:presentation>

Slide Content: ${seedText}

This presentation includes content that has been generated for testing purposes. The content above is the seed text that will be analyzed for content safety compliance.`;
  
  await fs.writeFile(filePath, xml);
};

const formatCreators = {
  png: createRealisticPNG,
  jpg: createRealisticJPEG,
  pdf: createRealisticPDF,
  docx: createRealisticDOCX,
  ppt: createRealisticPPT
};

console.log(`Regenerating ${manifest.documents.length} test files with realistic content...`);

for (const doc of manifest.documents) {
  const dir = path.join(__dirname, path.dirname(doc.relativePath));
  await ensureDir(dir);

  const filePath = path.join(__dirname, doc.relativePath);
  const creator = formatCreators[doc.format];

  if (!creator) {
    console.warn(`Unknown format: ${doc.format}`);
    continue;
  }

  try {
    await creator(filePath, doc.seedText);
    console.log(`✓ Regenerated ${doc.fileName}`);
  } catch (error) {
    console.error(`✗ Failed to regenerate ${doc.fileName}:`, error.message);
  }
}

console.log('Content generation complete!');
