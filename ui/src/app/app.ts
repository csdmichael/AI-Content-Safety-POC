import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import {
  IonApp,
  IonContent,
  IonFooter,
  IonHeader,
  IonImg,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar
} from '@ionic/angular/standalone';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    IonApp,
    IonContent,
    IonFooter,
    IonHeader,
    IonImg,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    IonTitle,
    IonToolbar
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly router = inject(Router);
  readonly activeSegment = signal(this.segmentFromUrl(this.router.url));

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.activeSegment.set(this.segmentFromUrl(event.urlAfterRedirects)));
  }

  private segmentFromUrl(url: string): string {
    const segment = url.split('?')[0].split('/')[1];
    return segment || 'home';
  }
}
