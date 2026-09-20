import { Routes } from '@angular/router';

import { DocumentsPageComponent } from './pages/documents-page.component';
import { ResultsPageComponent } from './pages/results-page.component';
import { HomePageComponent } from './pages/home-page.component';
import { AgentSafetyPageComponent } from './pages/agent-safety-page.component';
import { LargeContentPageComponent } from './pages/large-content-page.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: HomePageComponent },
  { path: 'documents', component: DocumentsPageComponent },
  { path: 'results', component: ResultsPageComponent },
  { path: 'agent-safety', component: AgentSafetyPageComponent },
  { path: 'large-content', component: LargeContentPageComponent }
];
