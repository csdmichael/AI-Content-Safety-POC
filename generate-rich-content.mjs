import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { Packer, Document, Paragraph, TextRun, PageBreak, HeadingLevel } from 'docx';
import PptxGenJS from 'pptxgenjs';
import { createReadStream, createWriteStream } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');

// Business content for "safe" documents
const businessContent = [
  {
    title: 'Q3 2025 Financial Report',
    content: `Executive Summary

Our company achieved strong financial performance in Q3 2025, with revenue growth of 15% year-over-year. Total revenue reached $2.3 billion, exceeding market expectations by 12%.

Key Performance Indicators:
• Revenue: $2.3B (↑15% YoY)
• Profit Margin: 22% (↑3% improvement)
• Operating Expenses: $1.8B (↓8% optimization)
• Market Share: 18.5% (↑2.1% growth)
• Customer Satisfaction: 94% (↑4% increase)

Strategic Initiatives:
1. Cloud Migration: Successfully migrated 85% of infrastructure
2. AI Integration: Deployed machine learning across 12 business units
3. Talent Development: Hired 250 engineers, retention rate 96%
4. Market Expansion: Entered 8 new markets in APAC region

Outlook:
We project Q4 revenue of $2.5B with continued growth momentum. Investment in R&D will increase to 18% of budget to support innovation initiatives.`
  },
  {
    title: 'Product Development Roadmap 2026',
    content: `Product Strategy

Our 2026 roadmap focuses on AI-powered features, enhanced security, and improved user experience across all product lines.

Phase 1: Q1 2026 - AI Assistant Launch
• Natural language query interface
• Predictive analytics dashboard
• Automated report generation
• Machine learning model training

Phase 2: Q2 2026 - Security Enhancement
• Multi-factor authentication overhaul
• End-to-end encryption for all data
• Compliance with GDPR, CCPA, SOC 2 Type II
• Zero-trust security architecture

Phase 3: Q3 2026 - Platform Expansion
• Mobile application launch (iOS/Android)
• API marketplace development
• Partner integration program
• Enterprise deployment options

Phase 4: Q4 2026 - Performance Optimization
• Database optimization for 10x speed increase
• Auto-scaling infrastructure
• Real-time collaboration features
• Advanced analytics engine

Risk Assessment:
• Technical Risk: 15% (mitigation: extensive testing)
• Market Risk: 8% (mitigation: customer feedback loops)
• Resource Risk: 12% (mitigation: talent acquisition plan)

Success Metrics:
- 40% increase in user engagement
- 50% reduction in support tickets
- 99.99% system uptime
- NPS score above 70`
  },
  {
    title: 'Company Culture and Values',
    content: `Our Values

At the heart of our organization are five core values that guide every decision and action we take.

Innovation: We encourage creative thinking and calculated risk-taking. Our innovation lab processes 500+ ideas monthly, with 10% moving to prototyping stage.

Integrity: We maintain the highest ethical standards in all business dealings. Our ethics committee reviews quarterly compliance across 15 departments.

Collaboration: We believe in the power of diverse teams working together. Cross-functional projects show 40% better outcomes than siloed approaches.

Excellence: We strive for exceptional quality in everything we do. Our defect rate is 0.02%, among the lowest in the industry.

Sustainability: We're committed to environmental and social responsibility. Carbon neutral operations achieved in 2024, targeting carbon negative by 2027.

People Development:
• Average training hours per employee: 48 hours/year
• Leadership development program: 85% internal promotions
• Diversity: 52% women, 48 different nationalities
• Employee satisfaction: 92% (industry average: 74%)

Community Impact:
• $5M annual charitable donations
• 2,000 employee volunteer hours per quarter
• STEM education programs supporting 500+ students
• Environmental conservation projects in 12 countries`
  },
  {
    title: 'Customer Success Stories',
    content: `Case Studies

Acme Corporation Transformation:
Our comprehensive solution helped Acme reduce operational costs by 35% while improving customer satisfaction by 28%. Implementation took 4 months with zero downtime. Key metrics:
- Processing time: 8 hours → 45 minutes (89% reduction)
- Error rate: 5% → 0.3% (94% improvement)
- Customer retention: 88% → 96% (9% increase)
- ROI: 320% in first year

Global Finance Inc. Digital Modernization:
By migrating to our cloud platform, GFI enhanced security while scaling to support 10M+ transactions daily. Results:
- System availability: 95% → 99.97%
- Average response time: 2s → 150ms
- Compliance certifications: 8 new standards achieved
- Cost savings: $12M annually

Tech Startup Rapid Growth:
Supporting a high-growth startup from 50 to 500 employees with infrastructure that scales seamlessly.
- User base growth: 100K → 5M (5000% expansion)
- Infrastructure cost per user: $0.50 → $0.08 (84% improvement)
- Feature release cycle: 2 weeks → 3 days
- System uptime: 99.95% maintained throughout growth`
  }
];

// Risk test content for "risky" documents
const riskyContent = [
  {
    title: 'Security Vulnerability Alert - CRITICAL',
    content: `URGENT SECURITY NOTICE

A critical vulnerability has been discovered in your system requiring immediate action.

Vulnerability Details:
Type: Remote Code Execution (RCE)
Severity: CRITICAL (CVSS 9.8)
Affected Versions: 2.0 - 2.5 (patch available: 2.6)
Attack Vector: Network-based exploit

Immediate Action Required:
1. Isolate affected systems from network
2. Apply security patch 2.6 immediately
3. Verify no unauthorized access occurred
4. Review access logs for last 30 days
5. Change all administrative credentials

This is a security advisory. Please treat seriously and take immediate protective measures.`
  },
  {
    title: 'Fraud Alert Investigation Report',
    content: `FRAUD DETECTION REPORT

This document details suspected fraudulent activity detected on account.

Alert Type: Unusual Transaction Pattern
Detection Date: May 12, 2026
Alert Level: High Priority

Suspicious Activity:
- Multiple wire transfers to offshore accounts
- Access from 15 different geographic locations
- Login attempts at 3 AM UTC
- Attempted modification of account permissions
- File download of 2GB sensitive data

Investigation Status: Active

Recommended Actions:
1. Verify recent transactions with account holder
2. Temporary freeze of account pending verification
3. Password reset required
4. Multi-factor authentication mandatory
5. Full account audit initiated

Note: This is a fraud alert for security purposes only.`
  },
  {
    title: 'Controversial Topics Discussion',
    content: `EDITORIAL DISCUSSION: Complex Global Issues

This document discusses various controversial and complex global topics for analytical purposes.

Topic 1: Political Polarization
Modern societies are increasingly divided along political lines. This document examines the mechanics of political disagreement without endorsing any particular viewpoint.

Topic 2: Religious Discourse
Various religious perspectives exist globally. This analysis presents multiple viewpoints objectively.

Topic 3: Conspiracy Theories
While most conspiracy theories lack evidence, understanding their origins and spread is important for media literacy and critical thinking.

Topic 4: Health Misinformation
Distinguishing between evidence-based health information and unsupported claims is crucial for public health.

Academic Note: This document is for educational and analytical purposes, examining societal phenomena without promoting any harmful positions.`
  },
  {
    title: 'Illegal Activity Reference Document',
    content: `COMPLIANCE AND LEGAL REFERENCE

For law enforcement and compliance purposes only.

This document references various illegal activities as they relate to regulatory frameworks and enforcement measures.

Categories of Illegal Activity (for regulatory reference):
- Fraud schemes (for detection purposes)
- Money laundering patterns (for identification)
- Theft and robbery (for prevention strategies)
- Unauthorized access (for security protocols)
- Document forgery (for verification)

Legal Framework:
All activities referenced are prohibited under applicable law codes. This document is created solely for:
1. Law enforcement training
2. Regulatory compliance
3. Fraud prevention
4. Security awareness

Note: This reference document is for authorized personnel only in legal and compliance contexts.`
  }
];

// Image generation functions
async function generateAnimalPNG() {
  const svg = `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <rect width="800" height="600" fill="#87CEEB"/>
      <!-- Lion -->
      <circle cx="200" cy="300" r="50" fill="#D2B48C"/>
      <circle cx="200" cy="280" r="35" fill="#F5DEB3"/>
      <circle cx="185" cy="290" r="8" fill="#000"/>
      <circle cx="215" cy="290" r="8" fill="#000"/>
      <circle cx="200" cy="310" r="6" fill="#000"/>
      <polyline points="185,320 180,330 185,335" stroke="#000" fill="none" stroke-width="2"/>
      <polyline points="200,320 200,330 200,335" stroke="#000" fill="none" stroke-width="2"/>
      <polyline points="215,320 220,330 215,335" stroke="#000" fill="none" stroke-width="2"/>
      <!-- Giraffe -->
      <rect x="400" y="200" width="30" height="150" fill="#F4A460"/>
      <circle cx="415" cy="180" r="20" fill="#D2B48C"/>
      <circle cx="410" cy="175" r="5" fill="#000"/>
      <circle cx="420" cy="175" r="5" fill="#000"/>
      <line x1="415" y1="190" x2="415" y2="200" stroke="#000" stroke-width="2"/>
      <!-- Elephant -->
      <ellipse cx="600" cy="320" rx="60" ry="50" fill="#808080"/>
      <circle cx="600" cy="280" r="35" fill="#808080"/>
      <circle cx="590" cy="275" r="6" fill="#000"/>
      <circle cx="610" cy="275" r="6" fill="#000"/>
      <path d="M 600 300 Q 595 330 590 360" stroke="#808080" stroke-width="15" fill="none"/>
      <!-- Sun -->
      <circle cx="700" cy="100" r="40" fill="#FFD700"/>
      <!-- Grass -->
      <rect y="500" width="800" height="100" fill="#228B22"/>
    </svg>
  `;
  return Buffer.from(svg);
}

async function generateCartoonCharacterJPG() {
  const svg = `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <rect width="800" height="600" fill="#FFB6C1"/>
      <!-- Happy Character -->
      <circle cx="200" cy="200" r="60" fill="#FFD700"/>
      <circle cx="185" cy="190" r="12" fill="#000"/>
      <circle cx="215" cy="190" r="12" fill="#000"/>
      <circle cx="200" cy="220" r="8" fill="#000"/>
      <path d="M 185 230 Q 200 245 215 230" stroke="#000" stroke-width="3" fill="none"/>
      <!-- Robot -->
      <rect x="400" y="150" width="80" height="100" fill="#C0C0C0" stroke="#000" stroke-width="2"/>
      <circle cx="420" cy="180" r="15" fill="#0000FF"/>
      <circle cx="460" cy="180" r="15" fill="#0000FF"/>
      <rect x="410" y="220" width="15" height="40" fill="#C0C0C0"/>
      <rect x="455" y="220" width="15" height="40" fill="#C0C0C0"/>
      <!-- Stars -->
      <polygon points="600,100 610,120 630,120 615,135 620,155 600,140 580,155 585,135 570,120 590,120" fill="#FFD700"/>
      <polygon points="150,400 160,420 180,420 165,435 170,455 150,440 130,455 135,435 120,420 140,420" fill="#FFD700"/>
      <polygon points="650,400 660,420 680,420 665,435 670,455 650,440 630,455 635,435 620,420 640,420" fill="#FFD700"/>
    </svg>
  `;
  return Buffer.from(svg);
}

async function generateNaturePNG() {
  const svg = `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="skyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#87CEEB;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#E0F6FF;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#skyGradient)"/>
      <!-- Mountains -->
      <polygon points="0,400 200,150 400,400" fill="#8B4513"/>
      <polygon points="300,400 500,180 700,400" fill="#A0522D"/>
      <polygon points="600,400 750,250 800,400" fill="#8B4513"/>
      <!-- Trees -->
      <rect x="100" y="320" width="20" height="80" fill="#654321"/>
      <polygon points="110,320 80,280 140,280" fill="#228B22"/>
      <polygon points="110,300 70,250 150,250" fill="#32CD32"/>
      <rect x="500" y="330" width="15" height="70" fill="#654321"/>
      <polygon points="507,330 485,295 530,295" fill="#228B22"/>
      <!-- River -->
      <path d="M 0 450 Q 150 470 300 450 T 600 460 T 800 450" stroke="#4169E1" stroke-width="30" fill="none"/>
      <!-- Flowers -->
      <circle cx="200" cy="410" r="5" fill="#FF1493"/>
      <circle cx="350" cy="420" r="5" fill="#FFD700"/>
      <circle cx="600" cy="415" r="5" fill="#FF69B4"/>
      <!-- Sun -->
      <circle cx="100" cy="80" r="50" fill="#FFD700"/>
    </svg>
  `;
  return Buffer.from(svg);
}

async function generateOceanLifeJPG() {
  const svg = `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="oceanGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#1E90FF;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#000080;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#oceanGradient)"/>
      <!-- Fish 1 -->
      <ellipse cx="200" cy="200" rx="40" ry="25" fill="#FF6347"/>
      <polygon points="240,200 280,190 280,210" fill="#FF6347"/>
      <circle cx="190" cy="195" r="5" fill="#000"/>
      <!-- Fish 2 -->
      <ellipse cx="500" cy="350" rx="35" ry="20" fill="#FFD700"/>
      <polygon points="535,350 570,345 570,355" fill="#FFD700"/>
      <circle cx="490" cy="347" r="4" fill="#000"/>
      <!-- Whale -->
      <ellipse cx="400" cy="500" rx="80" ry="40" fill="#4169E1"/>
      <circle cx="360" cy="485" r="8" fill="#000"/>
      <path d="M 420 460 L 430 420 L 435 460" stroke="#4169E1" stroke-width="8" fill="none"/>
      <!-- Bubbles -->
      <circle cx="100" cy="100" r="8" fill="#87CEEB" opacity="0.6"/>
      <circle cx="150" cy="250" r="6" fill="#87CEEB" opacity="0.6"/>
      <circle cx="650" cy="150" r="7" fill="#87CEEB" opacity="0.6"/>
      <!-- Seaweed -->
      <path d="M 700 400 Q 710 450 700 550" stroke="#228B22" stroke-width="8" fill="none"/>
      <path d="M 750 400 Q 760 450 750 550" stroke="#32CD32" stroke-width="8" fill="none"/>
    </svg>
  `;
  return Buffer.from(svg);
}

// PDF generation with multiple pages
function generatePDF(title, content) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title
    doc.fontSize(24).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text('Generated: ' + new Date().toISOString().split('T')[0], { align: 'center', color: '#666' });
    doc.moveDown(1);

    // Content sections
    const lines = content.split('\n\n');
    lines.forEach((section, idx) => {
      const trimmed = section.trim();
      if (trimmed.length === 0) return;

      if (trimmed.match(/^[A-Z][A-Za-z\s]+:$/)) {
        // Heading
        doc.fontSize(14).font('Helvetica-Bold').text(trimmed, { indent: 0 });
        doc.moveDown(0.3);
      } else if (trimmed.startsWith('•') || trimmed.startsWith('-')) {
        // Bullet point
        doc.fontSize(11).font('Helvetica').text(trimmed, { indent: 20 });
        doc.moveDown(0.2);
      } else if (trimmed.match(/^\d+\./)) {
        // Numbered item
        doc.fontSize(11).font('Helvetica').text(trimmed, { indent: 20 });
        doc.moveDown(0.2);
      } else {
        // Regular paragraph
        doc.fontSize(11).font('Helvetica').text(trimmed, { align: 'justify' });
        doc.moveDown(0.4);
      }

      // Add page break if near bottom
      if (doc.y > 700) {
        doc.addPage();
        doc.moveDown(1);
      }
    });

    doc.end();
  });
}

// DOCX generation with multiple pages
function generateDOCX(title, content) {
  const paragraphs = [];
  
  // Add title
  paragraphs.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 400 }
    })
  );

  // Add date
  paragraphs.push(
    new Paragraph({
      text: 'Generated: ' + new Date().toISOString().split('T')[0],
      spacing: { after: 400 }
    })
  );

  // Add content
  const sections = content.split('\n\n');
  sections.forEach((section) => {
    const trimmed = section.trim();
    if (trimmed.length === 0) return;

    if (trimmed.match(/^[A-Z][A-Za-z\s]+:$/)) {
      paragraphs.push(
        new Paragraph({
          text: trimmed,
          heading: HeadingLevel.HEADING_2,
          spacing: { after: 200 }
        })
      );
    } else {
      paragraphs.push(
        new Paragraph({
          text: trimmed,
          spacing: { after: 300 }
        })
      );
    }
  });

  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBuffer(doc);
}

// PPT generation with multiple slides
function generatePPT(title, content) {
  const prs = new PptxGenJS();
  prs.defineLayout({ name: 'TITLE_SLIDE', master: 'BLANK' });

  // Slide 1: Title
  let slide = prs.addSlide();
  slide.background = { fill: '0070C0' };
  slide.addText(title, { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 54, bold: true, color: 'FFFFFF', align: 'center' });

  // Slide 2+: Content
  const sections = content.split('\n\n');
  let currentSlide = null;
  let textY = 1;

  sections.forEach((section, idx) => {
    const trimmed = section.trim();
    if (trimmed.length === 0) return;

    if (textY > 6) {
      currentSlide = prs.addSlide();
      textY = 0.5;
    } else if (!currentSlide) {
      currentSlide = prs.addSlide();
    }

    if (trimmed.match(/^[A-Z][A-Za-z\s]+:$/)) {
      currentSlide.addText(trimmed, { x: 0.5, y: textY, w: 9, h: 0.4, fontSize: 24, bold: true, color: '0070C0' });
      textY += 0.5;
    } else {
      currentSlide.addText(trimmed, { x: 0.8, y: textY, w: 8.5, h: 0.5, fontSize: 14, color: '000000' });
      textY += 0.6;
    }
  });

  return new Promise((resolve, reject) => {
    try {
      const tempPath = path.join(__dirname, `temp_${Date.now()}.pptx`);
      prs.writeFile({ fileName: tempPath }).then(() => {
        fs.readFile(tempPath).then(buffer => {
          fs.unlink(tempPath).then(() => resolve(buffer)).catch(reject);
        }).catch(reject);
      }).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

// Main generation function
async function generateRichContent() {
  try {
    console.log('Reading manifest...');
    const manifestPath = path.join(dataDir, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));

    console.log('Generating rich content for all 100 files...');
    let successCount = 0;
    let failCount = 0;

    for (const doc of manifest.documents) {
      try {
        let buffer;
        const contentItem = doc.expectedContentSafetyOutcome === 'risky' 
          ? riskyContent[Math.floor(Math.random() * riskyContent.length)]
          : businessContent[Math.floor(Math.random() * businessContent.length)];

        switch (doc.format) {
          case 'pdf':
            buffer = await generatePDF(contentItem.title, contentItem.content);
            break;
          case 'docx':
            buffer = await generateDOCX(contentItem.title, contentItem.content);
            break;
          case 'ppt':
            buffer = await generatePPT(contentItem.title, contentItem.content);
            break;
          case 'png':
            const pngType = Math.random() > 0.66 ? (Math.random() > 0.5 ? 'animal' : 'nature') : 'cartoon';
            if (pngType === 'animal') {
              buffer = await generateAnimalPNG();
            } else if (pngType === 'nature') {
              buffer = await generateNaturePNG();
            } else {
              buffer = await generateCartoonCharacterJPG();
            }
            buffer = await sharp(buffer).png().toBuffer();
            break;
          case 'jpg':
            const jpgType = Math.random() > 0.66 ? (Math.random() > 0.5 ? 'ocean' : 'nature') : 'cartoon';
            if (jpgType === 'ocean') {
              buffer = await generateOceanLifeJPG();
            } else if (jpgType === 'nature') {
              buffer = await generateNaturePNG();
            } else {
              buffer = await generateCartoonCharacterJPG();
            }
            buffer = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
            break;
        }

        const filePath = path.join(dataDir, doc.relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, buffer);
        console.log(`✓ Generated ${doc.fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);
        successCount++;
      } catch (err) {
        console.error(`✗ Failed to generate ${doc.fileName}: ${err.message}`);
        failCount++;
      }
    }

    console.log(`\nGeneration complete: ${successCount} successful, ${failCount} failed`);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

generateRichContent();
