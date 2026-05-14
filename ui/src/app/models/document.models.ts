export type DocumentFormat = 'png' | 'jpg' | 'pdf' | 'docx' | 'ppt';

export interface SafetyCategoryResult {
  category: 'safe' | 'review' | 'blocked';
  confidence: number;
  reason: string;
  categories?: { category: string; severity: number }[];
}

export interface ContentDocument {
  id: string;
  fileName: string;
  format: DocumentFormat;
  relativePath: string;
  expectedContentSafetyOutcome: 'pass' | 'fail';
  seedText: string;
  processed?: SafetyCategoryResult;
  blobPreviewUrl?: string;
}

export interface DocumentManifest {
  totalDocuments: number;
  expectedFailCount: number;
  expectedPassCount: number;
  documents: ContentDocument[];
}

export interface ApiCategoryAnalysis {
  category: string;
  severity: number;
}

export interface ApiAnalysisPayload {
  categoriesAnalysis?: ApiCategoryAnalysis[];
}

export interface ApiResultRecord {
  id: string;
  fileName: string;
  format: DocumentFormat;
  blobUrl?: string;
  expectedContentSafetyOutcome: 'pass' | 'fail';
  textAnalysisDecision?: 'safe' | 'blocked';
  textMaxSeverity?: number;
  textAnalysis?: ApiAnalysisPayload;
  imageAnalysisDecision?: 'safe' | 'blocked';
  imageMaxSeverity?: number;
  imageAnalysis?: ApiAnalysisPayload;
  processedAtUtc?: string;
}

export interface ApiResultsResponse {
  count: number;
  results: ApiResultRecord[];
}

export interface AppConfig {
  resourceGroupName: string;
  apiBaseUrl: string;
  blobStorage: {
    accountName: string;
    endpointUrl: string;
    privateEndpointUrl: string;
    containerName: string;
  };
  contentSafety: {
    endpointUrl: string;
    privateEndpointUrl: string;
    apiVersion: string;
  };
  cosmosDb: {
    accountEndpoint: string;
    privateEndpointUrl: string;
    databaseName: string;
    containerName: string;
  };
  network: {
    vnetResourceId: string;
    subnetResourceId: string;
  };
}
