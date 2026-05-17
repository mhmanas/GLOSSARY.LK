# Security Specification - English-Sinhala-Tamil Glossary

## Data Invariants
1. A glossary term must always be associated with a valid existing category.
2. Only verified administrative users can create, update, or delete categories and terms.
3. Timestamps (`createdAt`, `updatedAt`) must be strictly controlled by the server time.
4. Categories and terminology are public records; anyone can read them.

## The Dirty Dozen Payloads

1. **Unauthorized Category Creation**: Guest user attempts to create a category.
2. **Unauthorized Term Creation**: Logged-in non-admin attempts to create a term.
3. **Identity Spoofing**: User attempts to create an admin entry for themselves.
4. **ID Poisoning**: Attempting to create a term with a 1KB string as a document ID.
5. **Orphaned Term**: Creating a term with a `categoryId` that does not exist.
6. **Immutability Breach**: Attempting to update the `createdAt` field of an existing term.
7. **Type Mismatch**: Sending an integer for the `english` term field.
8. **Size Violation**: Sending a 1MB string for the `sinhala` term field.
9. **Timestamp Fraud**: Sending a client-side date for `createdAt` instead of `request.time`.
10. **Shadow Field Injection**: Adding an `isVerified: true` field to a term.
11. **Admin Access Leak**: Guest attempting to list the `admins` collection.
12. **Status Shortcut**: (N/A for this app, but let's test bypassing validation helpers).

## Test Runner (Conceptual)

```typescript
// firestore.rules.test.ts
// Verifies that all "Dirty Dozen" payloads return PERMISSION_DENIED.

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

// ... (Standard setup code)

test('non-admin cannot create category', async () => {
  const db = getUnauthenticatedDb();
  await assertFails(addDoc(collection(db, 'categories'), { nameEn: 'Test' }));
});

test('admin can create category', async () => {
  const db = getAdminAuthenticatedDb(); // Using mhmanas@gmail.com
  await assertSucceeds(addDoc(collection(db, 'categories'), { 
    nameEn: 'Legal', 
    nameSi: 'නීතිමය', 
    nameTa: 'சட்டம்' 
  }));
});

test('term must have valid categoryId', async () => {
  const db = getAdminAuthenticatedDb();
  await assertFails(addDoc(collection(db, 'terms'), { 
    categoryId: 'non-existent',
    english: 'Test',
    sinhala: 'ටෙස්ට්',
    tamil: 'தேர்வு',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
});
```
