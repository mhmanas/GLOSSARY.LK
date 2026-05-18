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
4. **CRITICAL: Production Setup Requirements**:
   - **Authorized Domains**: Go to **Firebase Console** > **Authentication** > **Settings** > **Authorized domains**. Add `glossary.lk` and your Netlify URL.
   - **Identity Toolkit API**: Firebase Auth requires this API to be enabled. Visit [this project-specific link](https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=1096745235194) and click **ENABLE**.
   - **API Key Restrictions**: If you still see "requests are blocked", go to **Google Cloud Console** > **APIs & Services** > **Credentials**, click your API key, and ensure the "Identity Toolkit API" is not restricted or is explicitly allowed.
   - **Google Sign-In**: Ensure the Google sign-in provider is enabled in the Firebase Auth "Sign-in method" tab.

### Admin Management
- **Add Term/Category**: Use the "+" buttons in the header or results area.
- **Clean Duplicates**: Click "Clean Duplicates" to remove entries with identical English terms.
- **Delete All Data**: Click "Delete All Data" and then "CONFIRM DELETE" to permanently wipe the entire database (Terms and Categories).
- **Import/Export**: Use the "Import CSV" button to batch upload terms.

## License

© 2026 TRANSLATION.LK. All Rights Reserved.
