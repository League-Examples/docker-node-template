# Pattern: QR Code Generation and Short URL Routing

## When to Use

Any application that manages physical objects, locations, or assets that
benefit from a "scan to view" workflow. Examples: inventory systems,
facility management, event check-in, equipment tracking.

## Overview

Generate QR codes that encode short URLs pointing to the app. When
scanned with a phone camera, the URL opens directly to the object's
detail page. The app provides both a mobile-optimized QR landing page
and redirects to the full detail view.

## Components

### 1. QR Code Service

Uses the `qrcode` npm package to generate QR codes as data URLs or
PNG buffers.

```typescript
import QRCode from 'qrcode';

export class QrService {
  constructor(private baseUrl: string) {}

  async generateDataUrl(path: string): Promise<string> {
    return QRCode.toDataURL(`${this.baseUrl}${path}`, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
  }

  async generateBuffer(path: string): Promise<Buffer> {
    return QRCode.toBuffer(`${this.baseUrl}${path}`, {
      width: 300,
      margin: 2,
    });
  }
}
```

### 2. Short URL Routes

Register short URL patterns that redirect to full detail pages:

```typescript
// Short URLs for QR codes
router.get('/k/:id', (req, res) => res.redirect(`/qr/kit/${req.params.id}`));
router.get('/c/:id', (req, res) => res.redirect(`/qr/computer/${req.params.id}`));

// Mobile-optimized QR landing pages
router.get('/qr/kit/:id', ...);
router.get('/qr/computer/:id', ...);
```

### 3. QR Code Storage

Store the QR code data URL or path on the entity record:

```prisma
model Kit {
  // ...
  qrCode String?  // data URL or path to generated QR image
}
```

Generate on creation and store so QR codes are consistent.

### 4. Mobile QR Layout

A separate React layout (`QrLayout`) optimized for mobile screens:
- No sidebar or navigation
- Large text, touch-friendly buttons
- Key information visible immediately
- Quick action buttons (check out, report issue, etc.)

### 5. Label Printing

Combine QR codes with metadata into printable labels using PDFKit:
- Multiple label formats (sheet labels, individual labels)
- Batch printing (generate labels for all items at a site)

## Dependencies

```
npm install qrcode
npm install -D @types/qrcode
```

## Reference Implementation

- Inventory app: `server/src/services/qr.service.ts`
- Inventory app: `client/src/pages/qr/` (mobile QR layouts)
- Inventory app: `server/src/routes/qr.ts` (short URL routes)
- Inventory app: `server/src/services/label.service.ts` (PDF labels)

## Environment Variables

```
QR_DOMAIN=https://your-app.example.com  # base URL encoded in QR codes
```
