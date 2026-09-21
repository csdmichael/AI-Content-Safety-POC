import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';

import {
  LargeContextApiService,
  TextLargeContextResponse,
  ImageLargeContextResponse,
  APIMConfigResponse,
  ExecutionTraceStep,
} from '../services/large-context-api.service';

type ActiveTab = 'image' | 'text' | 'apim';
type ContentSource = 'user_prompt' | 'retrieved_document' | 'model_completion';
type ImageSafetyOutcome = 'safe' | 'unsafe';

export interface LargeImageCatalogItem {
  id: string;
  title: string;
  category: string;
  fileName: string;
  path: string;
  thumbnailPath: string;
  width: number;
  height: number;
  sizeBytes: number;
  sourceUrl: string;
  license: string;
  expectedSafetyOutcome: ImageSafetyOutcome;
  expectedSafetySignal?: string;
}

interface LargeImageCatalogGroup {
  safety: ImageSafetyOutcome;
  title: string;
  description: string;
  images: LargeImageCatalogItem[];
}

@Component({
  selector: 'app-large-content-page',
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent],
  templateUrl: './large-content-page.component.html',
  styleUrl: './large-content-page.component.scss',
})
export class LargeContentPageComponent implements OnInit {
  private readonly largeContextApi = inject(LargeContextApiService);

  readonly activeTab = signal<ActiveTab>('image');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // --- Image Compressor ---
  readonly imageCatalog: LargeImageCatalogItem[] = [
    { id: 'storybook-castle', title: 'Storybook Castle', category: 'Character & fantasy', fileName: 'storybook-castle.jpg', path: '/large-images/originals/storybook-castle.jpg', thumbnailPath: '/large-images/thumbnails/storybook-castle.webp', width: 4272, height: 2848, sizeBytes: 5_255_335, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sleeping_Beauty_Castle_DLR.jpg', license: 'CC BY-SA 3.0', expectedSafetyOutcome: 'safe' },
    { id: 'character-parade', title: 'Character Parade', category: 'Character & fantasy', fileName: 'character-parade.jpg', path: '/large-images/originals/character-parade.jpg', thumbnailPath: '/large-images/thumbnails/character-parade.webp', width: 5184, height: 3456, sizeBytes: 6_114_432, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Main_Street_Electrical_Parade_(14261249602).jpg', license: 'CC BY 2.0', expectedSafetyOutcome: 'safe' },
    { id: 'silicon-wafer', title: 'Silicon Wafer', category: 'Semiconductor', fileName: 'silicon-wafer.jpg', path: '/large-images/originals/silicon-wafer.jpg', thumbnailPath: '/large-images/thumbnails/silicon-wafer.webp', width: 7118, height: 5122, sizeBytes: 9_290_508, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Exposed_150mm_6%22_wafer_with_hundreds_of_chips.jpg', license: 'CC BY-SA 4.0', expectedSafetyOutcome: 'safe' },
    { id: 'integrated-circuit', title: 'Integrated Circuit Die', category: 'Semiconductor', fileName: 'integrated-circuit.jpg', path: '/large-images/originals/integrated-circuit.jpg', thumbnailPath: '/large-images/thumbnails/integrated-circuit.webp', width: 4636, height: 3076, sizeBytes: 5_314_854, sourceUrl: 'https://commons.wikimedia.org/wiki/File:M27c322-100f1_macro.jpg', license: 'CC BY-SA 4.0', expectedSafetyOutcome: 'safe' },
    { id: 'silicon-researcher', title: 'Cleanroom Wafer Inspection', category: 'Semiconductor', fileName: 'silicon-researcher.jpg', path: '/large-images/originals/silicon-researcher.jpg', thumbnailPath: '/large-images/thumbnails/silicon-researcher.webp', width: 5760, height: 3840, sizeBytes: 6_835_509, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Silicon_wafer_researcher.jpg', license: 'Public domain', expectedSafetyOutcome: 'safe' },
    { id: 'mountain-lake', title: 'Mountain Lake Vista', category: 'Nature', fileName: 'mountain-lake.jpg', path: '/large-images/originals/mountain-lake.jpg', thumbnailPath: '/large-images/thumbnails/mountain-lake.webp', width: 4880, height: 2745, sizeBytes: 5_727_189, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Moraine_Lake_17092005.jpg', license: 'CC BY-SA 3.0', expectedSafetyOutcome: 'safe' },
    { id: 'forest-waterfall', title: 'Forest Waterfall', category: 'Nature', fileName: 'forest-waterfall.jpg', path: '/large-images/originals/forest-waterfall.jpg', thumbnailPath: '/large-images/thumbnails/forest-waterfall.webp', width: 5616, height: 3744, sizeBytes: 5_750_361, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Forest-waterfall-icy-ravine1_-_Virginia_-_ForestWander.jpg', license: 'CC BY-SA 3.0', expectedSafetyOutcome: 'safe' },
    { id: 'desert-dunes', title: 'Sahara Desert Dunes', category: 'Nature', fileName: 'desert-dunes.jpg', path: '/large-images/originals/desert-dunes.jpg', thumbnailPath: '/large-images/thumbnails/desert-dunes.webp', width: 3072, height: 2048, sizeBytes: 6_309_897, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sand_dunes_in_the_desert%2C_Sahara_Desert%2C_Dakhla_Oasis%2C_Egypt.jpg', license: 'CC BY 2.0', expectedSafetyOutcome: 'safe' },
    { id: 'ocean-reef', title: 'Coral Reef Biosphere', category: 'Nature', fileName: 'ocean-reef.jpg', path: '/large-images/originals/ocean-reef.jpg', thumbnailPath: '/large-images/thumbnails/ocean-reef.webp', width: 5312, height: 2988, sizeBytes: 6_390_907, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Corals_in_Eilat_coral_reef_nature_reserve_2.jpg', license: 'CC BY-SA 4.0', expectedSafetyOutcome: 'safe' },
    { id: 'elephant-herd', title: 'African Bush Elephant', category: 'Wildlife', fileName: 'elephant-herd.jpg', path: '/large-images/originals/elephant-herd.jpg', thumbnailPath: '/large-images/thumbnails/elephant-herd.webp', width: 4704, height: 1619, sizeBytes: 5_967_557, sourceUrl: 'https://commons.wikimedia.org/wiki/File:African_bush_elephant,_South_Luangwa_National_Park_(51866154526)_(cropped).jpg', license: 'CC BY 2.0', expectedSafetyOutcome: 'safe' },
    { id: 'city-skyline', title: 'City Night Skyline', category: 'Architecture', fileName: 'city-skyline.jpg', path: '/large-images/originals/city-skyline.jpg', thumbnailPath: '/large-images/thumbnails/city-skyline.webp', width: 6754, height: 2000, sizeBytes: 5_347_231, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Jacksonville_Skyline_Night_Panorama_Digon3.jpg', license: 'CC BY-SA 3.0', expectedSafetyOutcome: 'safe' },
    { id: 'historic-cathedral', title: 'Historic Cathedral Choir', category: 'Architecture', fileName: 'historic-cathedral.jpg', path: '/large-images/originals/historic-cathedral.jpg', thumbnailPath: '/large-images/thumbnails/historic-cathedral.webp', width: 6000, height: 4729, sizeBytes: 13_228_685, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Worcester_Cathedral_choir,_Worcestershire,_UK_-_Diliff.jpg', license: 'CC BY-SA 3.0', expectedSafetyOutcome: 'safe' },
    { id: 'space-nebula', title: 'Tarantula Nebula Deep Space', category: 'Space', fileName: 'space-nebula.jpg', path: '/large-images/originals/space-nebula.jpg', thumbnailPath: '/large-images/thumbnails/space-nebula.webp', width: 3600, height: 2880, sizeBytes: 9_279_797, sourceUrl: 'https://commons.wikimedia.org/wiki/File:A_New_View_of_the_Tarantula_Nebula.jpg', license: 'CC BY 4.0', expectedSafetyOutcome: 'safe' },
    { id: 'unsafe-violence', title: 'Violence Category Test Card', category: 'Controlled safety test', fileName: 'unsafe-violence.jpg', path: '/large-images/originals/unsafe-violence.jpg', thumbnailPath: '/large-images/thumbnails/unsafe-violence.webp', width: 5616, height: 3744, sizeBytes: 9_583_520, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Forest-waterfall-icy-ravine1_-_Virginia_-_ForestWander.jpg', license: 'CC BY-SA 3.0 background', expectedSafetyOutcome: 'unsafe', expectedSafetySignal: 'Violence' },
    { id: 'unsafe-hate', title: 'Hate Category Test Card', category: 'Controlled safety test', fileName: 'unsafe-hate.jpg', path: '/large-images/originals/unsafe-hate.jpg', thumbnailPath: '/large-images/thumbnails/unsafe-hate.webp', width: 7118, height: 5122, sizeBytes: 12_354_546, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Exposed_150mm_6%22_wafer_with_hundreds_of_chips.jpg', license: 'CC BY-SA 4.0 background', expectedSafetyOutcome: 'unsafe', expectedSafetySignal: 'Hate' },
    { id: 'unsafe-sexual', title: 'Sexual Category Test Card', category: 'Controlled safety test', fileName: 'unsafe-sexual.jpg', path: '/large-images/originals/unsafe-sexual.jpg', thumbnailPath: '/large-images/thumbnails/unsafe-sexual.webp', width: 5184, height: 3456, sizeBytes: 7_089_947, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Main_Street_Electrical_Parade_(14261249602).jpg', license: 'CC BY 2.0 background', expectedSafetyOutcome: 'unsafe', expectedSafetySignal: 'Sexual' },
    { id: 'unsafe-self-harm', title: 'Self-Harm Category Test Card', category: 'Controlled safety test', fileName: 'unsafe-self-harm.jpg', path: '/large-images/originals/unsafe-self-harm.jpg', thumbnailPath: '/large-images/thumbnails/unsafe-self-harm.webp', width: 6000, height: 4729, sizeBytes: 12_491_042, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Worcester_Cathedral_choir,_Worcestershire,_UK_-_Diliff.jpg', license: 'CC BY-SA 3.0 background', expectedSafetyOutcome: 'unsafe', expectedSafetySignal: 'SelfHarm' },
  ];
  readonly imageCatalogGroups: LargeImageCatalogGroup[] = [
    {
      safety: 'safe',
      title: 'Expected safe',
      description: 'Benign photos for validating the allowed path.',
      images: this.imageCatalog.filter((image) => image.expectedSafetyOutcome === 'safe'),
    },
    {
      safety: 'unsafe',
      title: 'Expected unsafe',
      description: 'Controlled OCR test cards expected to trigger a safety category.',
      images: this.imageCatalog.filter((image) => image.expectedSafetyOutcome === 'unsafe'),
    },
  ];
  maxDimension = 2048;
  compressionQuality = 80;
  selectedFile: File | null = null;
  imagePreviewUrl: string | null = null;
  readonly selectedCatalogImageId = signal<string | null>(null);
  readonly loadingCatalogImageId = signal<string | null>(null);
  
  // Image metadata
  origName = '';
  origSize = '';
  origDimensions = '';
  origFormat = '';
  
  readonly imageResult = signal<ImageLargeContextResponse | null>(null);
  readonly downloadingImage = signal(false);

  // --- Text Chunking ---
  textInput = '';
  chunkSize = 4000; // Smaller default chunk size makes the overlap and chunks easier to see in the UI
  overlap = 800;
  contentSource: ContentSource = 'user_prompt';
  promptShield = true;
  retrievalUserPrompt = '';
  readonly textResult = signal<TextLargeContextResponse | null>(null);
  readonly textTrace = signal<ExecutionTraceStep[]>([]);
  readonly lastTextTraceStep = computed(() => {
    const trace = this.textTrace();
    return trace.length > 0 ? trace[trace.length - 1] : null;
  });

  // --- APIM Policies ---
  readonly apimConfig = signal<APIMConfigResponse | null>(null);
  activePolicyKey = signal<string>('llm_content_safety');

  // --- Text Presets ---
  readonly textPresets = [
    {
      label: 'Secure Large Document',
      desc: '12,000+ characters of standard corporate guidelines. No content violations.',
      chunkSize: 4000,
      overlap: 800,
      text: this.generateCorporateText(false)
    },
    {
      label: 'Large Document with Mixed Violations',
      desc: '15,000+ characters with safety-category and custom PII signals in separate chunks.',
      chunkSize: 4000,
      overlap: 800,
      text: this.generateCorporateText(true)
    }
  ];

  ngOnInit(): void {
    this.loadApimConfig();
  }

  setTab(tab: ActiveTab): void {
    this.activeTab.set(tab);
    this.error.set(null);
  }

  // --- Image Handling ---
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    this.selectedCatalogImageId.set(null);
    this.processSelectedFile(input.files[0]);
  }

  async selectCatalogImage(image: LargeImageCatalogItem): Promise<void> {
    this.loadingCatalogImageId.set(image.id);
    this.error.set(null);
    try {
      const response = await fetch(image.path);
      if (!response.ok) {
        throw new Error(`Image download failed with status ${response.status}.`);
      }
      const blob = await response.blob();
      const file = new File([blob], image.fileName, {
        type: blob.type || 'image/jpeg',
        lastModified: Date.now(),
      });
      this.selectedCatalogImageId.set(image.id);
      this.processSelectedFile(file);
    } catch (error: any) {
      this.error.set(error?.message || 'Could not load the selected catalog image.');
    } finally {
      this.loadingCatalogImageId.set(null);
    }
  }

  processSelectedFile(file: File): void {
    this.selectedFile = file;
    this.origName = file.name;
    this.origSize = this.formatBytes(file.size);
    this.imageResult.set(null);
    this.error.set(null);

    // Read details
    const reader = new FileReader();
    reader.onload = (e) => {
      this.imagePreviewUrl = e.target?.result as string;
      
      const img = new Image();
      img.onload = () => {
        this.origDimensions = `${img.width}x${img.height}`;
        this.origFormat = file.type.split('/')[1]?.toUpperCase() || 'UNKNOWN';
      };
      img.src = this.imagePreviewUrl;
    };
    reader.readAsDataURL(file);
  }

  async generateTestImage(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      // High-entropy pixels prevent PNG compression from shrinking the fixture below 4 MB.
      const width = 2400;
      const height = 1800;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas 2D context');

      const pixels = ctx.createImageData(width, height);
      let randomState = 0x5f3759df;
      for (let index = 0; index < pixels.data.length; index += 4) {
        randomState ^= randomState << 13;
        randomState ^= randomState >>> 17;
        randomState ^= randomState << 5;
        pixels.data[index] = randomState & 0xff;
        pixels.data[index + 1] = (randomState >>> 8) & 0xff;
        pixels.data[index + 2] = (randomState >>> 16) & 0xff;
        pixels.data[index + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);

      // Draw a colorful gradient grid
      const cols = 24;
      const rows = 18;
      const colWidth = width / cols;
      const rowHeight = height / rows;

      for (let c = 0; colWidth && c < cols; c++) {
        for (let r = 0; rowHeight && r < rows; r++) {
          const red = Math.floor((c / cols) * 255);
          const green = Math.floor((r / rows) * 255);
          const blue = Math.floor(((c + r) / (cols + rows)) * 255);
          ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
          ctx.fillRect(c * colWidth + 5, r * rowHeight + 5, colWidth - 10, rowHeight - 10);
          
          // Draw text
          ctx.fillStyle = '#ffffff';
          ctx.font = '24px monospace';
          ctx.fillText(`C:${c}, R:${r}`, c * colWidth + 15, r * rowHeight + 40);
        }
      }

      // Draw some complex geometric lines and circles
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 500, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(width, height);
      ctx.moveTo(width, 0);
      ctx.lineTo(0, height);
      ctx.stroke();

      // Draw title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 120px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Azure AI Content Safety', width / 2, height / 2 - 100);
      ctx.font = 'bold 80px sans-serif';
      ctx.fillText('Oversized Demo Image (> 4 MB)', width / 2, height / 2 + 50);

      // Convert canvas to blob with maximum quality PNG to ensure it exceeds 4MB
      canvas.toBlob((blob) => {
        if (!blob) {
          this.error.set('Failed to generate image Blob.');
          this.loading.set(false);
          return;
        }
        const file = new File([blob], 'high_res_demo_image.png', { type: 'image/png' });
        this.processSelectedFile(file);
        this.loading.set(false);
      }, 'image/png', 1.0);

    } catch (e: any) {
      this.error.set(e?.message || 'Failed to generate test image.');
      this.loading.set(false);
    }
  }

  async runImageAnalysis(): Promise<void> {
    if (!this.selectedFile) {
      this.error.set('Please select or generate an image first.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.imageResult.set(null);

    try {
      const res = await this.largeContextApi.compressImage(
        this.selectedFile,
        this.maxDimension,
        this.compressionQuality
      );
      this.imageResult.set(res);
    } catch (e: any) {
      this.error.set(e?.message || 'Image compression or safety evaluation failed.');
    } finally {
      this.loading.set(false);
    }
  }

  async downloadCompressedImage(): Promise<void> {
    if (!this.selectedFile || !this.imageResult()) return;

    this.downloadingImage.set(true);
    this.error.set(null);
    try {
      const image = await this.largeContextApi.downloadCompressedImage(
        this.selectedFile,
        this.maxDimension,
        this.compressionQuality,
      );
      const objectUrl = URL.createObjectURL(image);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${this.origName.replace(/\.[^.]+$/, '') || 'image'}-compressed.jpg`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
      this.error.set(e?.message || 'Compressed image download failed.');
    } finally {
      this.downloadingImage.set(false);
    }
  }

  // --- Text Handling ---
  applyTextPreset(preset: any): void {
    this.textInput = preset.text;
    this.chunkSize = preset.chunkSize;
    this.overlap = preset.overlap;
    this.textResult.set(null);
    this.textTrace.set([]);
    this.error.set(null);
  }

  async runTextAnalysis(): Promise<void> {
    if (!this.textInput.trim()) {
      this.error.set('Please enter text or select a preset.');
      return;
    }
    if (this.chunkSize < 100) {
      this.error.set('Chunk size must be at least 100 characters.');
      return;
    }
    if (this.chunkSize > 10_000) {
      this.error.set('Chunk size cannot exceed the 10,000-character Content Safety limit.');
      return;
    }
    if (this.overlap < 0) {
      this.error.set('Overlap cannot be negative.');
      return;
    }
    if (this.overlap >= this.chunkSize) {
      this.error.set('Overlap must be strictly less than the chunk size.');
      return;
    }
    if (this.overlap > Math.floor(this.chunkSize / 2)) {
      this.error.set('Overlap cannot exceed half of the chunk size.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.textResult.set(null);
    const requestStartedAt = Date.now();
    this.textTrace.set([
      {
        timestamp_utc: new Date(requestStartedAt).toISOString(),
        elapsed_ms: 0,
        stage: 'request_sent',
        message: 'Submitting the large document to the safety pipeline.',
        outcome: 'info',
      },
    ]);

    try {
      const res = await this.largeContextApi.analyzeText(
        this.textInput,
        this.chunkSize,
        this.overlap,
        this.contentSource,
        this.promptShield,
        this.contentSource === 'retrieved_document' ? this.retrievalUserPrompt : undefined,
      );
      this.textResult.set(res);
      this.textTrace.set(res.trace);
    } catch (e: any) {
      const message = e?.message || 'Text chunking or safety evaluation failed.';
      this.error.set(message);
      this.textTrace.update((steps) => [
        ...steps,
        {
          timestamp_utc: new Date().toISOString(),
          elapsed_ms: Date.now() - requestStartedAt,
          stage: 'request_failed',
          message,
          outcome: 'blocked',
        },
      ]);
    } finally {
      this.loading.set(false);
    }
  }

  // --- APIM Config ---
  async loadApimConfig(): Promise<void> {
    try {
      const config = await this.largeContextApi.getApimConfig();
      this.apimConfig.set(config);
    } catch {
      // Fail silently, not blocking
    }
  }

  setActivePolicy(key: string): void {
    this.activePolicyKey.set(key);
  }

  getActivePolicyXml(): string {
    const config = this.apimConfig();
    if (!config) return '';
    const key = this.activePolicyKey();
    const policies = config.xml_policies as Record<string, string>;
    return policies[key] || '';
  }

  // --- Utility Helpers ---
  formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  formatSizeChange(reductionPercentage: number): string {
    const direction = reductionPercentage >= 0 ? 'smaller' : 'larger';
    return `${Math.abs(reductionPercentage)}% ${direction}`;
  }

  getOverlapTextRange(chunk: any, nextChunk: any): string {
    if (!chunk || !nextChunk) return '';
    // Show overlapping bounds
    return `Characters [${nextChunk.start_char} to ${chunk.end_char}]`;
  }

  formatTraceStage(stage: string): string {
    return stage.split('_').join(' ');
  }

  // Generate safe/violating long text for demonstration
  private generateCorporateText(withViolations: boolean): string {
    let text = `
================================================================================
CONSOLIDATED ENTERPRISE SECURITY AND COMPLIANCE POLICY GUIDELINES
Document Version: 2026.4.1 -- Classification: Internal Confidential
================================================================================

1. INTRODUCTION AND STATEMENT OF INTENT
The purpose of this document is to establish a rigorous, standardized security posture 
for all cloud operations, customer data handling, and employee conduct across our globally
distributed enterprise networks. With the rapid expansion of multi-cloud architectures, 
heterogeneous API ecosystems, and large-scale artificial intelligence agent automation, 
failing to enforce strict digital guardrails introduces unacceptable operational risks, 
regulatory penalties, and security exposures. This policy binds all employees, contractors, 
vendors, and temporary staff operating on behalf of the corporation.

2. CLOUD INFRASTRUCTURE SECURITY AND NETWORK PROTECTION
All virtual machines, database instances, and containers must be deployed behind managed 
Virtual Networks (VNets) with Private Endpoints enabled. Public IP exposures are prohibited 
except under explicit, peer-reviewed Architectural Board exceptions.
- Network Access Control Lists (NACLs) must be reviewed on a bi-weekly cycle.
- Encryption-at-rest using Customer-Managed Keys (CMK) is mandatory for all Cosmos DB databases, 
  Azure Blob Storage accounts, and persistent volumes.
- All secrets, API keys, tokens, and certificates must be securely stored in Azure Key Vault. 
  Direct hardcoding of credentials in code repositories, environment variables, or config 
  files is classified as a Critical Severity finding and will trigger automatic access revocation.
  
3. API GATEWAY ROUTING AND THREAT PROTECTION
Azure API Management (APIM) must be placed in front of all machine learning models, 
generative AI endpoints, and Content Safety resources. The APIM instance acts as a central 
gateway responsible for sanitizing incoming HTTP headers, enforcing rate-limiting (quota-by-key),
inspecting payload sizes, and caching identical requests. This shielding mitigates backend 
resource exhaustion, buffers peak traffic, and limits the financial risk associated with 
pay-per-request cognitive service endpoints. All incoming traffic must undergo active 
malicious payload scanning before dispatch.

`;

    if (withViolations) {
      text += `
[CRITICAL WARNING - DEMO SECURITY VIOLATION: UNLAWFUL ACTIONS FOUND IN AUDIT]
During our automated compliance scan of the third-party infrastructure repository, 
the system discovered that an anonymous vendor suggested a highly dangerous script 
to purge local servers during an active breach. The instructions literally stated:
"To completely destroy any tracing logs and sabotage the system before eviction, 
an attacker or rogue sysadmin would execute a violent payload to murder all processes, 
kill -9 the system daemon, and set up a bomb script that wipes the main database partition 
using os.system('rm -rf /') to ensure total destruction." 
These violent commands and threats represent an active policy violation and must be flagged.
The captured abusive message also called the incident responder a "moron" and is retained only
to validate the custom profanity detector.

`;
    } else {
      text += `
4. INCIDENT RESPONSE AND DISASTER RECOVERY PROTOCOLS
In the event of an active security incident or detected system intrusion, the Security Operations
Center (SOC) will trigger a multi-phase containment plan. 
- Phase 1 (Isolation): Automatically detach affected subnetworks and rotate all system secrets.
- Phase 2 (Analysis): Retrieve memory snapshots and system logs for forensic analysis inside the VNet.
- Phase 3 (Eviction): Terminate unauthorized active sessions and redeploy compromised workloads from secure images.
- Phase 4 (Recovery): Gradually restore normal traffic while operating under double-monitoring constraints.
Backup replication must be verified with quarterly failover drills.

`;
    }

  const auditEvidence = `
AUDIT EVIDENCE RECORD
Each control owner must attach review evidence, record the approving role, document remediation
dates, and verify that automated checks completed successfully. Evidence records are immutable,
retained according to policy, and reviewed independently during each quarterly assurance cycle.
`;
  while (text.length < 7_200) {
    text += auditEvidence;
  }

    text += `
5. EMPLOYEE AND USER DATA CONFIDENTIALITY RULES (PII AND COMPLIANCE)
To comply with global data protection frameworks (such as GDPR, CCPA, and HIPAA), 
the storage or transmission of Personally Identifiable Information (PII) over insecure 
communication channels is strictly forbidden. 
- Employee emails must use the secure corporately assigned domain names.
- Document storage services must run automated filters to block files containing unmasked Social Security 
  Numbers (SSNs), Credit Card Numbers (PANs), or telephone numbers in bulk.
`;

    if (withViolations) {
      text += `
[CRITICAL AUDIT EXPOSURE - SAMPLE RAW DATA LEAK]
For example, the following PII was discovered unencrypted in an open chat channel:
- Administrator Email: superadmin_emergency@corporate-safety-poc.org
- Support Hotline: +1 (555) 019-2834 (direct cell)
- Primary SSN for Verification: 666-29-0192 (exposed during onboarding system crash)
- Active Credit Card on File: 4111-2293-8472-1029 (Mastercard, exp 09/28)
This leak must be blocked by our custom content safety analyzers.
`;
    } else {
      text += `
- Under no circumstances should raw credit card numbers or phone numbers be logged in support tickets 
  or system diagnostic fields. Support agents are required to manually redact any customer-disclosed 
  credentials before archiving chats.
`;
    }

    text += `
6. POLICY COMPLIANCE ENFORCEMENT AND REVIEW
Compliance with this guidelines document is audited continuously using automated static analyzers 
and Azure Policy configurations. Violations are tracked, reported to departmental vice presidents, 
and must be remediated within 48 hours of detection. Continuous non-compliance will trigger formal 
disciplinary action, up to and including termination of engagement.

This document is reviewed and updated annually by the Enterprise Security Council.
`;

    const targetLength = withViolations ? 15_500 : 12_500;
    while (text.length < targetLength) {
      text += auditEvidence;
    }

    return text.trim();
  }
}
