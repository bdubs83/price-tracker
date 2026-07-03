# Official Price Comparison Tool

Standalone Vite React app for a private Skool group price comparison workflow. Public visitors only see the verification screen; approved members sign in through the Firebase-backed member session flow.

## What Is Included

- Verified member login gate with Firebase custom-token sessions
- Admin portal for Skool CSV replacement, vendor/product activation, PDF import review placeholder, manual price editing, and CSV export
- Seed data with 3 sample vendors, 8 products, aliases, shipping, payment methods, and varied availability
- Cart optimizer for single-vendor, split-vendor, partial-vendor, and table comparisons
- WhatsApp order-message generator with copy fallback
- Firebase Hosting, Firestore rules, Storage rules, and Cloud Functions scaffolding
- Server-side placeholders for Zapier member webhook and Gemini PDF extraction

## Development

```bash
npm install
npm run dev
npm run test
npm run build
```

## Firebase Setup

1. Create a Firebase project with Hosting, Auth, Firestore, Storage, and Functions.
2. Copy `.env.example` to `.env.local` and fill the `VITE_FIREBASE_*` values.
3. Set function secrets:

```bash
firebase functions:secrets:set GOOGLE_AI_API_KEY
firebase functions:secrets:set ZAPIER_WEBHOOK_SECRET
```

4. Deploy:

```bash
npm run build
firebase deploy
```

## Data Collections

The intended Firestore collections are `users`, `approvedMembers`, `admins`, `vendors`, `products`, `vendorPriceItems`, `priceLists`, `priceHistory`, `shippingRules`, and `appSettings`.

## Security Notes

Private vendor/product/price data is guarded by Firestore rules for verified members and admins. PDF uploads and AI extraction are admin-only. API keys remain server-side in Cloud Functions.

This app is strictly for price comparison and vendor contact organization. It does not provide medical advice, dosing advice, legality advice, or product-quality guarantees.
