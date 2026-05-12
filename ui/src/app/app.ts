import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
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
export class App {}
