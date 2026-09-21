import { TestBed } from '@angular/core/testing';

import { LargeContextApiService } from '../services/large-context-api.service';
import { LargeContentPageComponent } from './large-content-page.component';

describe('LargeContentPageComponent image catalog', () => {
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

    component = TestBed.createComponent(LargeContentPageComponent).componentInstance;
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

  it('loads a catalog image into the existing image-analysis pipeline', async () => {
    const catalogImage = component.imageCatalog[0];
    spyOn(window, 'fetch').and.resolveTo(
      new Response(new Blob(['image bytes'], { type: 'image/jpeg' }), { status: 200 }),
    );

    await component.selectCatalogImage(catalogImage);

    expect(window.fetch).toHaveBeenCalledWith(catalogImage.path);
    expect(component.selectedFile?.name).toBe(catalogImage.fileName);
  });
});