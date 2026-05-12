import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Realistic safe content samples
const safeContent = [
  "Company Q1 Financial Report: Revenue increased by 15% this quarter. The marketing team delivered excellent results with their new campaign strategies. We project continued growth for Q2.",
  "Project Status Update: The development team has successfully completed Phase 2 of the product roadmap. All testing milestones met. Ready for deployment next week.",
  "Team Meeting Notes: Discussed quarterly objectives and resource allocation. Great collaboration from all departments. Follow-up actions assigned to respective leads.",
  "Customer Success Story: Our client reduced operational costs by 40% after implementing our solution. They report high satisfaction with our support team.",
  "Technical Documentation: API endpoint specifications for v2.0 release. Includes rate limiting of 1000 requests per minute and authentication requirements.",
  "Marketing Analysis: Consumer behavior patterns show increasing preference for digital channels. Mobile app adoption up 25% year-over-year.",
  "Training Materials: Best practices for customer onboarding. Includes step-by-step guides and FAQ section for new users.",
  "Policy Document: Annual leave guidelines and time-off request procedures. Managers to approve requests within 48 hours.",
  "Product Features: Introducing new dashboard with real-time analytics. Supports multiple integrations with third-party platforms.",
  "Research Findings: Study on workplace productivity shows correlation between flexible schedules and employee satisfaction metrics.",
  "Event Announcement: Industry conference registration open. Early bird pricing available until end of month.",
  "Quarterly Review: All departments performing above expectations. Special recognition to high-performing team members.",
];

// Content with risk flags (for testing)
const riskyContent = [
  "WARNING: Critical security vulnerability detected. System requires immediate patching to prevent exploitation.",
  "Alert: Fraudulent activity detected on account. Contact support immediately to secure your credentials.",
  "Notice: This content discusses controversial political topics that some may find objectionable.",
  "Discussion about harmful conspiracy theories circulating online. These theories have been debunked by experts.",
  "Article mentions illegal activities. Note: Content is purely for educational and informational purposes.",
];

// Generate function
const generateManifest = async () => {
  const documents = [];
  const formats = ['png', 'jpg', 'pdf', 'docx', 'ppt'];
  let docCount = 1;
  let passCount = 0;
  let failCount = 0;

  // Create 100 documents with realistic distribution
  for (let i = 0; i < 100; i++) {
    const format = formats[i % 5];
    const fileNum = String(i + 1).padStart(3, '0');
    const shouldFail = failCount < 50 && (i < 50 || Math.random() > 0.3);

    let seedText;
    let outcome;

    if (shouldFail && failCount < 50) {
      seedText = riskyContent[Math.floor(Math.random() * riskyContent.length)];
      outcome = 'fail';
      failCount++;
    } else if (passCount < 50) {
      seedText = safeContent[Math.floor(Math.random() * safeContent.length)];
      outcome = 'pass';
      passCount++;
    } else {
      seedText = safeContent[Math.floor(Math.random() * safeContent.length)];
      outcome = 'pass';
    }

    documents.push({
      id: `doc-${String(docCount).padStart(3, '0')}`,
      fileName: `doc_${fileNum}.${format}`,
      format: format,
      relativePath: `data/${format}/doc_${fileNum}.${format}`,
      expectedContentSafetyOutcome: outcome,
      seedText: seedText,
      category: shouldFail ? 'risk-test' : 'safe-content',
    });

    docCount++;
  }

  const manifest = {
    totalDocuments: 100,
    expectedFailCount: failCount,
    expectedPassCount: passCount,
    generatedAt: new Date().toISOString(),
    documents: documents,
  };

  await fs.writeFile(
    path.join(__dirname, 'data/manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`✓ Generated manifest with ${failCount} risky and ${passCount} safe documents`);
};

await generateManifest();
