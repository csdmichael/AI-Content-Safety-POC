import { Routes } from '@angular/router';

import { DocumentsPageComponent } from './pages/documents-page.component';
import { ResultsPageComponent } from './pages/results-page.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'documents' },
  { path: 'documents', component: DocumentsPageComponent },
  { path: 'results', component: ResultsPageComponent }
];
