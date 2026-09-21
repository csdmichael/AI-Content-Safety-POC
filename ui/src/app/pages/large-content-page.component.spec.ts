import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LargeContextApiService } from '../services/large-context-api.service';
import { LargeContentPageComponent } from './large-content-page.component';

describe('LargeContentPageComponent image catalog', () => {
  let fixture: ComponentFixture<LargeContentPageComponent>;
  let component: LargeContentPageComponent;

  beforeEach(async () => {
    const largeContextApi = jasmine.createSpyObj<LargeContextApiService>('LargeContextApiService', [
      'getApimConfig',
      'compressImage',
      'downloadCompressedImage',
    ]);
    largeContextApi.getApimConfig.and.resolveTo({ recommendations: [], xml_policies: {} });

    await TestBed.configureTestingModule({
      imports: [LargeContentPageComponent],
      providers: [{ provide: LargeContextApiService, useValue: largeContextApi }],
    }).compileComponents();

    fixture = TestBed.createComponent(LargeContentPageComponent);
    component = fixture.componentInstance;
  });

  it('offers 10 to 20 downloadable originals between 5 and 20 MB', () => {
    expect(component.imageCatalog.length).toBeGreaterThanOrEqual(10);
    expect(component.imageCatalog.length).toBeLessThanOrEqual(20);
    expect(
      component.imageCatalog.every(
        (image) => image.sizeBytes >= 5 * 1024 * 1024 && image.sizeBytes <= 20 * 1024 * 1024,
      ),
    ).toBeTrue();
  });

  it('groups samples by expected safety and covers every image safety category', () => {
    expect(component.imageCatalogGroups.map((group) => group.safety)).toEqual(['safe', 'unsafe']);

    const safeImages = component.imageCatalogGroups.find((group) => group.safety === 'safe')?.images ?? [];
    const unsafeImages = component.imageCatalogGroups.find((group) => group.safety === 'unsafe')?.images ?? [];

    expect(safeImages.length).toBeGreaterThan(0);
    expect(safeImages.every((image) => image.expectedSafetyOutcome === 'safe')).toBeTrue();
    expect(unsafeImages.length).toBe(4);
    expect(unsafeImages.every((image) => image.expectedSafetyOutcome === 'unsafe')).toBeTrue();
    expect(unsafeImages.map((image) => image.expectedSafetySignal).sort()).toEqual([
      'Hate',
      'SelfHarm',
      'Sexual',
      'Violence',
    ]);
  });

  it('renders separate safe and unsafe image pickers', () => {
    fixture.detectChanges();

    const groups = fixture.nativeElement.querySelectorAll('[data-safety-group]');
    const unsafeCards = fixture.nativeElement.querySelectorAll(
      '[data-safety-group="unsafe"] .catalog-card',
    );

    expect(groups.length).toBe(2);
    expect(groups[0].getAttribute('data-safety-group')).toBe('safe');
    expect(groups[1].getAttribute('data-safety-group')).toBe('unsafe');
    expect(unsafeCards.length).toBe(4);
  });

  it('loads a catalog image into the existing image-analysis pipeline', async () => {
    const catalogImage = component.imageCatalog[0];
    spyOn(window, 'fetch').and.resolveTo(
      new Response(new Blob(['image bytes'], { type: 'image/jpeg' }), { status: 200 }),
    );

    await component.selectCatalogImage(catalogImage);

    expect(window.fetch).toHaveBeenCalledWith(catalogImage.path);
    expect(component.selectedFile?.name).toBe(catalogImage.fileName);
  });

  it('loads every unsafe fixture into the existing image-analysis pipeline', async () => {
    const unsafeImages = component.imageCatalog.filter(
      (image) => image.expectedSafetyOutcome === 'unsafe',
    );
    const fetchSpy = spyOn(window, 'fetch').and.callFake(async () =>
      new Response(new Blob(['unsafe image bytes'], { type: 'image/jpeg' }), { status: 200 }),
    );

    for (const catalogImage of unsafeImages) {
      await component.selectCatalogImage(catalogImage);
      expect(component.selectedCatalogImageId()).toBe(catalogImage.id);
      expect(component.selectedFile?.name).toBe(catalogImage.fileName);
    }

    expect(fetchSpy.calls.allArgs()).toEqual(unsafeImages.map((image) => [image.path]));
  });
});