# English-Sinhala-Tamil Glossary Application

A full-stack multilingual glossary application with CSV import, AI-powered translations, and administrative deduplication tools.

## Features

- **Multilingual Support**: English, Sinhala, and Tamil translations.
- **AI Integration**: Automatically generate translations and descriptions using Google Gemini.
- **CSV Import**: Batch upload terms from CSV files.
- **Real-time Search**: Fast, responsive search across all three languages.
- **Deduplication**: Clean up duplicate entries in the database.
- **User Authentication**: Secure login via Google Authentication (Firebase).

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons, Framer Motion.
- **Backend**: Node.js (Express), Gemini API.
- **Database/Auth**: Firebase Firestore, Firebase Authentication.
- **Deployment**: Production-ready with bundled Express server and static asset serving.

## Deployment Instructions

To deploy this application to a third-party provider (e.g., Vercel, Railway, Render, or a VPS):

### 1. Environment Variables

Create a project on your hosting platform and set the following environment variables:

- `GEMINI_API_KEY`: Your Google Gemini API key.
- `VITE_FIREBASE_API_KEY`: Firebase API Key.
- `VITE_FIREBASE_AUTH_DOMAIN`: Firebase Auth Domain.
- `VITE_FIREBASE_PROJECT_ID`: Firebase Project ID.
- `VITE_FIREBASE_STORAGE_BUCKET`: Firebase Storage Bucket.
- `VITE_FIREBASE_MESSAGING_SENDER_ID`: Firebase Messaging Sender ID.
- `VITE_FIREBASE_APP_ID`: Firebase App ID.
- `VITE_FIREBASE_DATABASE_ID`: (Optional) Custom Firestore Database ID.

Refer to `.env.example` for the full list.

### 2. Build and Start

The application is configured with a unified build/start process:

```bash
# Install dependencies
npm install

# Build the project (Vite frontend + Express backend)
npm run build

# Start the production server
npm start
```

### 3. Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Firestore Database** and **Authentication** (Google Provider).
3. Set up Firestore Security Rules using the provided `firestore.rules` file in this repository.
4. Add your domain to the "Authorized domains" list in Firebase Auth settings.

## License

© 2026 TRANSLATION.LK. All Rights Reserved.
