export type DocumentFormat = 'png' | 'jpg' | 'pdf' | 'docx' | 'ppt';

export interface SafetyCategoryResult {
  category: 'safe' | 'review' | 'blocked';
  confidence: number;
  reason: string;
}

export interface ContentDocument {
  id: string;
  fileName: string;
  format: DocumentFormat;
  relativePath: string;
  expectedContentSafetyOutcome: 'pass' | 'fail';
  seedText: string;
  processed?: SafetyCategoryResult;
}

export interface DocumentManifest {
  totalDocuments: number;
  expectedFailCount: number;
  expectedPassCount: number;
  documents: ContentDocument[];
}

export interface AppConfig {
  resourceGroupName: string;
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
